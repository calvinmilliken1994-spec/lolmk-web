// Riftbound tournament operations: every admin mutation's rules, written
// once against a small storage interface (RbStore).
//
// Why this exists separately from src/app/tools/riftbound/actions.ts: the
// actions file is the Next server-action shell (auth, transaction, cache
// revalidation) and cannot run outside Next. Everything that decides what a
// mutation is allowed to do lives here, so scripts/test-rb-scenario.ts can
// drive a whole event against an in-memory store with no database.
//
// Contract every operation follows:
//   1. Lock before reading invariants, in the order documented in rb-db.ts:
//      tournament -> rounds -> matches -> players. The Postgres store takes
//      these with SELECT ... FOR UPDATE.
//   2. Write an audit row with ctx.actor in the same transaction.
//   3. Apply auto-follow (docs/RIFTBOUND.md "Auto-follow") server-side.
//   4. Fail with RbUserError for anything an admin can fix; the action shell
//      turns it into { ok: false, error }.
//
// Rules: docs/RIFTBOUND.md. Pairing and standings: swiss-engine.ts. Top-cut
// bracket: bracket-engine.ts (single elimination, rebuilt from the stored
// seeds plus the reported results each time it is needed).
//
// Relative imports (not "@/") so the Node test scripts can load this file.

import { replayTopCut } from "./rb-cut";
import {
  clockAdjustPatch,
  clockPausePatch,
  clockResumePatch,
  clockStartPatch,
  formatGameExport,
  formatMatchExport,
  type RbClockPatch,
} from "./rb-db";
import {
  computeStandings,
  createRng,
  pairRound,
  resolveRoundCount,
  resolveTopCutSize,
  topCutSeeds,
  validateManualPairings,
  type Pairing,
  type SwissConfig,
  type SwissMatchResult,
  type SwissPlayer,
  type SwissStanding,
  type SwissWarning,
} from "./swiss-engine";
import type {
  RbActor,
  RbAuditAction,
  RbDeskFlag,
  RbDeskFlagKind,
  RbEnforcementLevel,
  RbExportFormat,
  RbMatch,
  RbMatchFlag,
  RbPlayer,
  RbRound,
  RbRoundStage,
  RbScene,
  RbScoringConfig,
  RbTournament,
  RbTournamentConfig,
  RbTournamentFull,
} from "../types/riftbound";
import { DEFAULT_RB_CONFIG, RB_DESK_FLAG_KINDS, RB_SCENES } from "../types/riftbound";

// ---------------------------------------------------------------------------
// Errors, results, context
// ---------------------------------------------------------------------------

/** An expected failure with a message safe to show the admin. */
export class RbUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RbUserError";
  }
}

function fail(message: string): never {
  throw new RbUserError(message);
}

/** Run a pure helper that throws plain Errors (rb-db clock patches) as user errors. */
function asUserError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof RbUserError) throw e;
    throw new RbUserError(e instanceof Error ? e.message : String(e));
  }
}

/** What every server action returns. Server-action errors are redacted in production, so expected failures travel as data. */
export type RbActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type RbTournamentPatch = Partial<
  Pick<
    RbTournament,
    "name" | "status" | "config" | "scene" | "auto_follow" | "auto_follow_paused" | "champion_player_id"
  >
>;
export type RbPlayerPatch = Partial<
  Pick<RbPlayer, "display_name" | "member_discord_id" | "legend" | "status" | "dropped_after_round">
>;
export type RbRoundPatch = Partial<
  Pick<RbRound, "status" | "started_at" | "paused_at" | "paused_total_ms" | "duration_ms">
>;
export type RbMatchPatch = Partial<Omit<RbMatch, "id" | "tournament_id" | "round_id">>;

/**
 * Storage used by the operations. Every `lock*` method must take a row lock
 * (SELECT ... FOR UPDATE) held until the surrounding transaction ends. The
 * `find*` methods are unlocked lookups used only to learn which tournament to
 * lock first.
 */
export interface RbStore {
  findMatchRef(matchId: string): Promise<{ tournamentId: string; roundId: string } | null>;
  findRoundTournamentId(roundId: string): Promise<string | null>;
  findPlayerTournamentId(playerId: string): Promise<string | null>;
  slugTaken(slug: string): Promise<boolean>;

  lockTournament(tournamentId: string): Promise<RbTournament | null>;
  lockRounds(tournamentId: string): Promise<RbRound[]>;
  lockRound(tournamentId: string, roundId: string): Promise<RbRound | null>;
  lockTournamentMatches(tournamentId: string): Promise<RbMatch[]>;
  lockMatch(tournamentId: string, matchId: string): Promise<RbMatch | null>;
  lockPlayers(tournamentId: string): Promise<RbPlayer[]>;
  findMatchByIdempotencyKey(key: string): Promise<RbMatch | null>;

  insertTournament(t: RbTournament): Promise<void>;
  updateTournament(tournamentId: string, patch: RbTournamentPatch): Promise<void>;
  /** Explicit hard deletion while the caller holds the tournament/state locks. */
  deleteTournament(tournamentId: string): Promise<void>;
  insertPlayer(p: RbPlayer): Promise<void>;
  updatePlayer(tournamentId: string, playerId: string, patch: RbPlayerPatch): Promise<void>;
  deletePlayer(tournamentId: string, playerId: string): Promise<void>;
  insertRound(r: RbRound): Promise<void>;
  updateRound(tournamentId: string, roundId: string, patch: RbRoundPatch): Promise<void>;
  deleteRound(tournamentId: string, roundId: string): Promise<void>;
  insertMatch(m: RbMatch): Promise<void>;
  updateMatch(tournamentId: string, matchId: string, patch: RbMatchPatch): Promise<void>;
  deleteRoundMatches(tournamentId: string, roundId: string): Promise<void>;
  writeAudit(
    tournamentId: string,
    action: RbAuditAction,
    detail: Record<string, unknown> | null,
    actor: RbActor,
  ): Promise<void>;
}

export interface RbContext {
  store: RbStore;
  actor: RbActor;
  now: () => number;
  newId: (prefix: string) => string;
  newSeed: () => string;
  /** Set by the operation to the slug of the tournament it touched (for cache revalidation). */
  slug: string | null;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isoAt = (ctx: RbContext) => new Date(ctx.now()).toISOString();

async function audit(
  ctx: RbContext,
  t: RbTournament,
  action: RbAuditAction,
  detail: Record<string, unknown> | null,
): Promise<void> {
  await ctx.store.writeAudit(t.id, action, detail, ctx.actor);
}

async function lockTournamentOrFail(ctx: RbContext, tournamentId: string): Promise<RbTournament> {
  const t = await ctx.store.lockTournament(tournamentId);
  if (!t) fail("Tournament not found.");
  ctx.slug = t.slug;
  return t;
}

interface LockedState {
  t: RbTournament;
  rounds: RbRound[];
  matches: RbMatch[];
  players: RbPlayer[];
}

/** Lock a whole tournament in the documented order. */
async function lockState(ctx: RbContext, tournamentId: string): Promise<LockedState> {
  const t = await lockTournamentOrFail(ctx, tournamentId);
  const rounds = await ctx.store.lockRounds(t.id);
  const matches = await ctx.store.lockTournamentMatches(t.id);
  const players = await ctx.store.lockPlayers(t.id);
  return { t, rounds, matches, players };
}

function requireNotFinished(t: RbTournament): void {
  if (t.status === "completed" || t.status === "archived") fail("This event is finished.");
}

function requireInProgress(t: RbTournament): void {
  if (t.status !== "in_progress") fail("The event isn't running.");
}

function requireBeforeRound1(t: RbTournament, rounds: RbRound[]): void {
  if ((t.status !== "draft" && t.status !== "registration") || rounds.length > 0) {
    fail("Players can only be changed before Round 1 is paired.");
  }
}

/**
 * Auto-follow on a phase change: move the program scene and clear any manual
 * pause. A manual scene change only pauses auto-follow until the next phase
 * change, so the phase change itself applies.
 */
async function followPhase(ctx: RbContext, t: RbTournament, scene: RbScene): Promise<void> {
  if (!t.auto_follow) return;
  await ctx.store.updateTournament(t.id, { scene, auto_follow_paused: false });
  t.scene = scene;
  t.auto_follow_paused = false;
}

const isParticipant = (p: RbPlayer) => p.status === "active" || p.status === "dropped" || p.status === "dq";
const isGone = (p: RbPlayer) => p.status === "dropped" || p.status === "dq";

function swissConfigOf(t: RbTournament): Partial<SwissConfig> {
  return { ...t.config.scoring, swissRounds: t.config.swissRounds, topCut: t.config.topCut };
}

const byNumber = (a: RbRound, b: RbRound) => a.number - b.number;
const byTable = (a: RbMatch, b: RbMatch) => a.table_number - b.table_number;

/** Reported Swiss results (and byes) from rounds that are no longer drafts. */
function swissResults(rounds: RbRound[], matches: RbMatch[]): SwissMatchResult[] {
  const visible = new Map(
    rounds.filter((r) => r.stage === "swiss" && r.status !== "draft").map((r) => [r.id, r.number]),
  );
  const out: SwissMatchResult[] = [];
  for (const m of matches) {
    const round = visible.get(m.round_id);
    if (round === undefined || m.status === "pending") continue;
    out.push({
      round,
      playerA: m.player_a_id,
      playerB: m.player_b_id,
      gamesA: m.games_a,
      gamesB: m.games_b,
      gamesDrawn: m.games_drawn,
      decidedOnTime: m.decided_on_time,
    });
  }
  return out;
}

function swissPlayers(players: RbPlayer[]): SwissPlayer[] {
  return players.filter(isParticipant).map((p) => ({ id: p.id, dropped: isGone(p) }));
}

/** Swiss standings for an admin view. Uses the stored tiebreak seed, so they reproduce exactly. */
export function computeRbStandings(full: RbTournamentFull): SwissStanding[] {
  const { tournament: t, rounds, matches, players } = full;
  if (!t.config.tiebreakSeed) return [];
  return computeStandings(
    swissPlayers(players),
    swissResults(rounds, matches),
    swissConfigOf(t),
    createRng(`${t.config.tiebreakSeed}:standings`),
  );
}

function standingsOf(s: LockedState): SwissStanding[] {
  return computeRbStandings({ tournament: s.t, rounds: s.rounds, matches: s.matches, players: s.players });
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanName(raw: string, what: string): string {
  const name = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!name) fail(`${what} is required.`);
  if (name.length > 60) fail(`${what} must be 60 characters or fewer.`);
  return name;
}

function cleanOptional(raw: string | null | undefined, max: number, what: string): string | null {
  if (raw === null || raw === undefined) return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.length > max) fail(`${what} must be ${max} characters or fewer.`);
  return v;
}

const kst = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso)) + " KST";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** The config fields an admin may edit. The seeds are set by the system only. */
export type RbEditableConfig = Omit<RbTournamentConfig, "tiebreakSeed" | "topCutSeedIds" | "venueTestedAt" | "scoring"> & {
  scoring: RbScoringConfig;
};
export type RbConfigPatch = Partial<Omit<RbEditableConfig, "scoring">> & {
  scoring?: Partial<RbScoringConfig>;
};

const ENFORCEMENT: RbEnforcementLevel[] = ["casual", "competitive", "professional"];

function validateConfig(c: RbTournamentConfig): void {
  if (c.bestOf !== 1 && c.bestOf !== 3) fail("Matches are best of 1 or best of 3.");
  if (!Number.isInteger(c.roundMinutes) || c.roundMinutes < 10 || c.roundMinutes > 180) {
    fail("Round length must be 10–180 minutes.");
  }
  if (c.swissRounds !== "auto" && (!Number.isInteger(c.swissRounds) || c.swissRounds < 1 || c.swissRounds > 15)) {
    fail("Swiss rounds must be Auto or 1–15.");
  }
  if (!["auto", 0, 4, 8].includes(c.topCut)) fail("Top cut must be Auto, none, 4 or 8.");
  if (typeof c.powerPairFinalRound !== "boolean") fail("Power pairing must be on or off.");
  if (!ENFORCEMENT.includes(c.enforcementLevel)) fail("Unknown rules enforcement level.");
  const s = c.scoring;
  const ints = [s.winPoints, s.drawPoints, s.lossPoints, s.byeGamesWon, s.byeGamesLost];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) fail("Points and bye games must be whole numbers ≥ 0.");
  if (!(s.winPoints > s.drawPoints && s.drawPoints >= s.lossPoints)) {
    fail("Points must rank win > draw ≥ loss.");
  }
  if (!(s.winPercentFloor >= 0 && s.winPercentFloor < 1)) fail("The win-percentage floor must be between 0 and 1.");
  if (c.date !== null && !(/^\d{4}-\d{2}-\d{2}$/.test(c.date) && !Number.isNaN(Date.parse(c.date)))) {
    fail("The event date must be a valid date.");
  }
  if (c.venue !== null && (typeof c.venue !== "string" || c.venue.length > 80)) {
    fail("The venue must be 80 characters or fewer.");
  }
  validateJudges(c.judges);
}

function validateJudges(judges: RbTournamentConfig["judges"]): void {
  if (!Array.isArray(judges) || judges.length > 30) fail("Add at most 30 judges.");
  const table = (n: number | null) => n === null || (Number.isInteger(n) && n >= 1 && n <= 999);
  const ids = new Set<string>();
  for (const j of judges) {
    if (!j || typeof j.id !== "string" || !j.id || ids.has(j.id)) fail("Each judge needs a unique id.");
    ids.add(j.id);
    if (typeof j.name !== "string" || !j.name.trim() || j.name.length > 40) fail("Judge names are 1–40 characters.");
    if (!table(j.from) || !table(j.to)) fail("Table numbers must be whole numbers from 1 to 999.");
    if (j.from === null && j.to !== null) fail(`${j.name}: set a first table before a last table.`);
    if (j.from !== null && j.to !== null && j.to < j.from) fail(`${j.name}: the last table can't be before the first.`);
  }
}

function mergeConfig(base: RbTournamentConfig, patch: RbConfigPatch): RbTournamentConfig {
  // Runtime guard: the seeds are never editable, whatever the caller sends.
  const rest = { ...(patch as Record<string, unknown>) };
  delete rest.tiebreakSeed;
  delete rest.topCutSeedIds;
  delete rest.venueTestedAt;
  delete rest.scoring;
  return {
    ...base,
    ...(rest as Partial<RbTournamentConfig>),
    scoring: { ...base.scoring, ...(patch.scoring ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function createTournament(
  ctx: RbContext,
  input: { name: string; config?: RbConfigPatch },
): Promise<{ id: string; slug: string }> {
  const name = cleanName(input.name, "Tournament name");
  const config = mergeConfig(DEFAULT_RB_CONFIG, input.config ?? {});
  validateConfig(config);

  const id = ctx.newId("rbt");
  const base = slugify(name) || id;
  let slug = base;
  for (let n = 2; await ctx.store.slugTaken(slug); n++) slug = `${base}-${n}`;

  const at = isoAt(ctx);
  const t: RbTournament = {
    id,
    slug,
    name,
    status: "draft",
    config,
    scene: "idle",
    auto_follow: true,
    auto_follow_paused: false,
    champion_player_id: null,
    created_at: at,
    updated_at: at,
  };
  await ctx.store.insertTournament(t);
  await audit(ctx, t, "tournament.create", { name, slug, config: { ...config, tiebreakSeed: undefined } });
  ctx.slug = slug;
  return { id, slug };
}

/**
 * Lock rules:
 *   - match format, round length and scoring: until Round 1 is paired
 *   - Swiss round count: until the final Swiss round is paired; once Round 1
 *     is paired it must be a number no lower than the rounds already paired
 *   - power pairing of the final round: until the final round is paired
 *   - top cut size: until the cut is made
 *   - enforcement level and name: until the event finishes
 */
export async function updateConfig(
  ctx: RbContext,
  input: { tournamentId: string; name?: string; config?: RbConfigPatch },
): Promise<RbTournament> {
  const s = await lockState(ctx, input.tournamentId);
  const { t } = s;
  requireNotFinished(t);

  const patch = input.config ?? {};
  const next = mergeConfig(t.config, patch);
  validateConfig(next);

  const swissPaired = s.rounds.filter((r) => r.stage === "swiss").length;
  const round1Paired = swissPaired > 0;
  const finalPaired = round1Paired && typeof t.config.swissRounds === "number" && swissPaired >= t.config.swissRounds;
  const changed = (k: keyof RbTournamentConfig) => JSON.stringify(next[k]) !== JSON.stringify(t.config[k]);

  if (round1Paired && (changed("bestOf") || changed("roundMinutes") || changed("scoring"))) {
    fail("Match format, round length and scoring are locked once Round 1 is paired.");
  }
  if (changed("swissRounds")) {
    if (finalPaired) fail("The round count is locked once the final round is paired.");
    if (round1Paired) {
      if (next.swissRounds === "auto") fail("The round count was fixed when Round 1 was paired.");
      if ((next.swissRounds as number) < swissPaired) {
        fail(`${swissPaired} rounds are already paired; the count can't go below that.`);
      }
    }
  }
  if (changed("powerPairFinalRound") && finalPaired) {
    fail("Power pairing can't change once the final round is paired.");
  }
  if (changed("topCut") && t.config.topCutSeedIds) fail("The cut has already been made.");

  const update: RbTournamentPatch = { config: next };
  if (input.name !== undefined) update.name = cleanName(input.name, "Tournament name");
  await ctx.store.updateTournament(t.id, update);
  await audit(ctx, t, "tournament.update", { name: update.name, config: patch });
  return { ...t, ...update };
}

export async function addPlayer(
  ctx: RbContext,
  input: { tournamentId: string; displayName: string; memberDiscordId?: string | null; legend?: string | null },
): Promise<RbPlayer> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  const rounds = await ctx.store.lockRounds(t.id);
  const players = await ctx.store.lockPlayers(t.id);
  requireBeforeRound1(t, rounds);
  const player = newPlayer(ctx, t, players, input.displayName, input.memberDiscordId, input.legend);
  await ctx.store.insertPlayer(player);
  await audit(ctx, t, "player.add", { playerId: player.id, name: player.display_name, member: Boolean(player.member_discord_id) });
  return player;
}

function newPlayer(
  ctx: RbContext,
  t: RbTournament,
  existing: RbPlayer[],
  rawName: string,
  memberDiscordId?: string | null,
  legend?: string | null,
): RbPlayer {
  const name = cleanName(rawName, "Player name");
  if (existing.some((p) => p.display_name.toLowerCase() === name.toLowerCase())) {
    fail(`"${name}" is already registered.`);
  }
  const member = cleanOptional(memberDiscordId, 32, "Discord id");
  if (member && existing.some((p) => p.member_discord_id === member)) fail("That member is already registered.");
  return {
    id: ctx.newId("rbp"),
    tournament_id: t.id,
    display_name: name,
    member_discord_id: member,
    legend: cleanOptional(legend, 60, "Legend"),
    status: "registered",
    dropped_after_round: null,
    created_at: isoAt(ctx),
  };
}

/** One name per entry (blank lines ignored). Names already registered, or repeated, are skipped and reported back. */
export async function bulkAddPlayers(
  ctx: RbContext,
  input: { tournamentId: string; names: string[] },
): Promise<{ added: RbPlayer[]; skipped: string[] }> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  const rounds = await ctx.store.lockRounds(t.id);
  const players = await ctx.store.lockPlayers(t.id);
  requireBeforeRound1(t, rounds);
  if (input.names.length > 512) fail("Add at most 512 players at once.");

  const known = [...players];
  const added: RbPlayer[] = [];
  const skipped: string[] = [];
  for (const raw of input.names) {
    if (!raw || !raw.trim()) continue;
    const name = cleanName(raw, "Player name");
    if (known.some((p) => p.display_name.toLowerCase() === name.toLowerCase())) {
      skipped.push(name);
      continue;
    }
    const p = newPlayer(ctx, t, known, name);
    await ctx.store.insertPlayer(p);
    known.push(p);
    added.push(p);
  }
  if (added.length === 0 && skipped.length === 0) fail("No names to add.");
  await audit(ctx, t, "player.add", { bulk: true, added: added.map((p) => p.display_name), skipped });
  return { added, skipped };
}

async function lockPlayerScope(
  ctx: RbContext,
  playerId: string,
): Promise<LockedState & { player: RbPlayer }> {
  const tid = await ctx.store.findPlayerTournamentId(playerId);
  if (!tid) fail("Player not found.");
  const s = await lockState(ctx, tid);
  const player = s.players.find((p) => p.id === playerId);
  if (!player) fail("Player not found.");
  return { ...s, player };
}

export async function updatePlayer(
  ctx: RbContext,
  input: { playerId: string; displayName?: string; memberDiscordId?: string | null; legend?: string | null },
): Promise<RbPlayer> {
  const { t, rounds, players, player } = await lockPlayerScope(ctx, input.playerId);
  requireBeforeRound1(t, rounds);
  const others = players.filter((p) => p.id !== player.id);
  const patch: RbPlayerPatch = {};
  if (input.displayName !== undefined) {
    const name = cleanName(input.displayName, "Player name");
    if (others.some((p) => p.display_name.toLowerCase() === name.toLowerCase())) fail(`"${name}" is already registered.`);
    patch.display_name = name;
  }
  if (input.memberDiscordId !== undefined) {
    const member = cleanOptional(input.memberDiscordId, 32, "Discord id");
    if (member && others.some((p) => p.member_discord_id === member)) fail("That member is already registered.");
    patch.member_discord_id = member;
  }
  if (input.legend !== undefined) patch.legend = cleanOptional(input.legend, 60, "Legend");
  await ctx.store.updatePlayer(t.id, player.id, patch);
  await audit(ctx, t, "player.update", { playerId: player.id, ...patch, member_discord_id: undefined });
  return { ...player, ...patch };
}

export async function removePlayer(ctx: RbContext, input: { playerId: string }): Promise<void> {
  const { t, rounds, player } = await lockPlayerScope(ctx, input.playerId);
  requireBeforeRound1(t, rounds);
  await ctx.store.deletePlayer(t.id, player.id);
  await audit(ctx, t, "player.remove", { playerId: player.id, name: player.display_name });
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export async function openCheckIn(ctx: RbContext, input: { tournamentId: string }): Promise<void> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  if (t.status !== "draft") fail("Check-in can only be opened from draft.");
  await ctx.store.updateTournament(t.id, { status: "registration" });
  await audit(ctx, t, "tournament.status", { from: t.status, to: "registration" });
}

async function setCheckIn(ctx: RbContext, playerId: string, checkedIn: boolean): Promise<RbPlayer> {
  const { t, player } = await lockPlayerScope(ctx, playerId);
  if (t.status !== "registration") fail("Check-in isn't open.");
  const from = checkedIn ? "registered" : "checked_in";
  if (player.status !== from) {
    fail(checkedIn ? `${player.display_name} is already checked in.` : `${player.display_name} isn't checked in.`);
  }
  const status = checkedIn ? "checked_in" : "registered";
  await ctx.store.updatePlayer(t.id, player.id, { status });
  await audit(ctx, t, "player.check_in", { playerId: player.id, undo: !checkedIn });
  return { ...player, status };
}

export const checkIn = (ctx: RbContext, input: { playerId: string }) => setCheckIn(ctx, input.playerId, true);
export const undoCheckIn = (ctx: RbContext, input: { playerId: string }) => setCheckIn(ctx, input.playerId, false);

/**
 * Close check-in: checked-in players become active (players who never
 * checked in stay `registered` and are not part of the event), the Swiss
 * round count is fixed, the tiebreak seed is generated, and Round 1 is
 * paired as a draft.
 */
export async function closeCheckInAndPairRound1(
  ctx: RbContext,
  input: { tournamentId: string },
): Promise<{ round: RbRound; warnings: SwissWarning[] }> {
  const s = await lockState(ctx, input.tournamentId);
  const { t } = s;
  if (t.status !== "registration") fail("Check-in isn't open.");
  if (s.rounds.length > 0) fail("Round 1 is already paired.");
  const checkedIn = s.players.filter((p) => p.status === "checked_in");
  if (checkedIn.length < 2) fail("At least 2 players must be checked in.");

  const config: RbTournamentConfig = {
    ...t.config,
    swissRounds: resolveRoundCount(checkedIn.length, swissConfigOf(t)),
    tiebreakSeed: ctx.newSeed(),
  };
  await ctx.store.updateTournament(t.id, { status: "in_progress", config });
  t.status = "in_progress";
  t.config = config;
  for (const p of checkedIn) {
    await ctx.store.updatePlayer(t.id, p.id, { status: "active" });
    p.status = "active";
  }
  await audit(ctx, t, "tournament.status", {
    from: "registration",
    to: "in_progress",
    players: checkedIn.length,
    swissRounds: config.swissRounds,
    noShows: s.players.filter((p) => p.status === "registered").map((p) => p.id),
  });
  return createSwissRound(ctx, s, 1);
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

function makeMatch(
  ctx: RbContext,
  t: RbTournament,
  round: RbRound,
  table: number,
  a: string,
  b: string | null,
  flags: RbMatchFlag[] = [],
): RbMatch {
  return {
    id: ctx.newId("rbm"),
    tournament_id: t.id,
    round_id: round.id,
    table_number: table,
    player_a_id: a,
    player_b_id: b,
    games_a: b === null ? t.config.scoring.byeGamesWon : 0,
    games_b: b === null ? t.config.scoring.byeGamesLost : 0,
    games_drawn: 0,
    decided_on_time: false,
    extension_ms: 0,
    started_at: null,
    status: b === null ? "bye" : "pending",
    reported_by_id: null,
    reported_by_name: null,
    reported_at: null,
    idempotency_key: null,
    flags,
  };
}

function newRound(ctx: RbContext, t: RbTournament, number: number, stage: RbRoundStage, seed: string | null): RbRound {
  return {
    id: ctx.newId("rbr"),
    tournament_id: t.id,
    number,
    stage,
    status: "draft",
    started_at: null,
    paused_at: null,
    paused_total_ms: 0,
    duration_ms: stage === "swiss" ? t.config.roundMinutes * 60_000 : null,
    pairing_seed: seed,
    created_at: isoAt(ctx),
  };
}

/** Pair Swiss round `number` as a draft from the locked state (which it updates). */
async function createSwissRound(
  ctx: RbContext,
  s: LockedState,
  number: number,
): Promise<{ round: RbRound; warnings: SwissWarning[] }> {
  const { t } = s;
  const swissRounds = t.config.swissRounds as number;
  const seed = ctx.newSeed();
  const out = pairRound({
    players: swissPlayers(s.players),
    matchHistory: swissResults(s.rounds, s.matches),
    standings: standingsOf(s),
    roundNumber: number,
    isFinalRound: number === swissRounds,
    powerPairFinal: t.config.powerPairFinalRound,
    seed,
  });
  const round = newRound(ctx, t, number, "swiss", seed);
  await ctx.store.insertRound(round);
  s.rounds.push(round);
  let table = 1;
  for (const [a, b] of out.pairings) {
    const m = makeMatch(ctx, t, round, table++, a, b);
    await ctx.store.insertMatch(m);
    s.matches.push(m);
  }
  await audit(ctx, t, "round.pair", {
    round: number,
    stage: "swiss",
    tables: out.pairings.length,
    bye: out.byeId,
    final: number === swissRounds,
    warnings: out.warnings,
  });
  return { round, warnings: out.warnings };
}

async function lockRoundScope(ctx: RbContext, roundId: string): Promise<LockedState & { round: RbRound }> {
  const tid = await ctx.store.findRoundTournamentId(roundId);
  if (!tid) fail("Round not found.");
  const s = await lockState(ctx, tid);
  const round = s.rounds.find((r) => r.id === roundId);
  if (!round) fail("Round not found.");
  return { ...s, round };
}

const roundMatches = (s: LockedState, round: RbRound) => s.matches.filter((m) => m.round_id === round.id).sort(byTable);

export async function publishRound(ctx: RbContext, input: { roundId: string }): Promise<void> {
  const { t, round } = await lockRoundScope(ctx, input.roundId);
  requireInProgress(t);
  if (round.status !== "draft") fail("Only a draft round can be published.");
  await ctx.store.updateRound(t.id, round.id, { status: "published" });
  await audit(ctx, t, "round.publish", { round: round.number, stage: round.stage });
  // The bracket is the venue's view of the whole cut: publishing a cut round keeps it up.
  await followPhase(ctx, t, round.stage === "top_cut" ? "top_cut" : "pairings");
}

/** Back to draft, clock reset. Only while no table in the round has a reported result. */
export async function unpublishRound(ctx: RbContext, input: { roundId: string }): Promise<void> {
  const s = await lockRoundScope(ctx, input.roundId);
  const { t, round } = s;
  requireInProgress(t);
  if (round.status !== "published" && round.status !== "live") fail("Only a published round can be unpublished.");
  const reported = roundMatches(s, round).filter((m) => m.status === "completed").length;
  if (reported > 0) fail(`${reported} table(s) already have results. Undo them first.`);
  await ctx.store.updateRound(t.id, round.id, {
    status: "draft",
    started_at: null,
    paused_at: null,
    paused_total_ms: 0,
  });
  await audit(ctx, t, "round.unpublish", { round: round.number });
}

/**
 * Swap two players' seats in a draft Swiss round (either may be the bye).
 * Returns validateManualPairings' warnings for the resulting pairings; the
 * swap is applied regardless and audited as an override.
 */
export async function swapDraftPairing(
  ctx: RbContext,
  input: { roundId: string; playerA: string; playerB: string },
): Promise<{ warnings: SwissWarning[] }> {
  const s = await lockRoundScope(ctx, input.roundId);
  const { t, round } = s;
  requireInProgress(t);
  if (round.status !== "draft") fail("Pairings can only be changed while the round is a draft.");
  if (round.stage !== "swiss") fail("Top-cut pairings follow the bracket and can't be swapped.");
  if (input.playerA === input.playerB) fail("Pick two different players.");

  const ms = roundMatches(s, round);
  const seat = (id: string) => {
    for (const m of ms) {
      if (m.player_a_id === id) return { m, side: "a" as const };
      if (m.player_b_id === id) return { m, side: "b" as const };
    }
    return fail("Both players must be in this round.");
  };
  const x = seat(input.playerA);
  const y = seat(input.playerB);
  const put = (m: RbMatch, side: "a" | "b", id: string) => {
    if (side === "a") m.player_a_id = id;
    else m.player_b_id = id;
  };
  put(x.m, x.side, input.playerB);
  put(y.m, y.side, input.playerA);

  const note = `Swapped ${input.playerA} and ${input.playerB}`;
  for (const m of x.m === y.m ? [x.m] : [x.m, y.m]) {
    m.flags = [...m.flags, { kind: "override", note }];
    await ctx.store.updateMatch(t.id, m.id, { player_a_id: m.player_a_id, player_b_id: m.player_b_id, flags: m.flags });
  }

  const pairings: Pairing[] = ms.map((m) => [m.player_a_id, m.player_b_id]);
  const history = swissResults(s.rounds, s.matches).map((r) => ({ playerA: r.playerA, playerB: r.playerB }));
  const warnings = validateManualPairings(pairings, history, standingsOf(s));
  await audit(ctx, t, "round.override", { round: round.number, swap: [input.playerA, input.playerB], warnings });
  return { warnings };
}

async function applyClock(
  ctx: RbContext,
  roundId: string,
  action: "clock.start" | "clock.pause" | "clock.resume" | "clock.adjust",
  build: (round: RbRound) => RbClockPatch,
  detail: Record<string, unknown> = {},
): Promise<RbRound> {
  const { t, round } = await lockRoundScope(ctx, roundId);
  requireInProgress(t);
  if (action === "clock.start") {
    if (round.status !== "published") fail("Publish the round before starting the clock.");
  } else if (action === "clock.adjust") {
    if (round.status !== "published" && round.status !== "live") fail("The round isn't running.");
  } else if (round.status !== "live") {
    fail("The clock isn't running for this round.");
  }
  const patch: RbRoundPatch = { ...asUserError(() => build(round)) };
  if (action === "clock.start") patch.status = "live";
  await ctx.store.updateRound(t.id, round.id, patch);
  await audit(ctx, t, action, { round: round.number, ...detail });
  if (action === "clock.start") await followPhase(ctx, t, "pairings_clock");
  return { ...round, ...patch };
}

export const startClock = (ctx: RbContext, input: { roundId: string }) =>
  applyClock(ctx, input.roundId, "clock.start", (r) => clockStartPatch(r, ctx.now()));
export const pauseClock = (ctx: RbContext, input: { roundId: string }) =>
  applyClock(ctx, input.roundId, "clock.pause", (r) => clockPausePatch(r, ctx.now()));
export const resumeClock = (ctx: RbContext, input: { roundId: string }) =>
  applyClock(ctx, input.roundId, "clock.resume", (r) => clockResumePatch(r, ctx.now()));
export const adjustClock = (ctx: RbContext, input: { roundId: string; deltaMs: number }) =>
  applyClock(ctx, input.roundId, "clock.adjust", (r) => clockAdjustPatch(r, input.deltaMs), {
    deltaMs: input.deltaMs,
  });

export async function closeRound(ctx: RbContext, input: { roundId: string }): Promise<void> {
  const s = await lockRoundScope(ctx, input.roundId);
  const { t, round } = s;
  requireInProgress(t);
  if (round.status !== "published" && round.status !== "live") fail("Only a published or live round can be closed.");
  const open = roundMatches(s, round).filter((m) => m.status === "pending");
  if (open.length > 0) {
    fail(`${open.length} table(s) still have no result: ${open.map((m) => m.table_number).join(", ")}.`);
  }
  await ctx.store.updateRound(t.id, round.id, { status: "closed" });
  await audit(ctx, t, "round.close", { round: round.number, stage: round.stage });
  await followPhase(ctx, t, round.stage === "top_cut" ? "top_cut" : "standings");
}

/** Pair the next Swiss round, or the next top-cut round once the cut is made. */
export async function pairNextRound(
  ctx: RbContext,
  input: { tournamentId: string },
): Promise<{ round: RbRound; warnings: SwissWarning[] }> {
  const s = await lockState(ctx, input.tournamentId);
  const { t } = s;
  requireInProgress(t);
  const latest = [...s.rounds].sort(byNumber).at(-1);
  if (!latest) fail("Round 1 hasn't been paired.");
  if (latest.status !== "closed") fail(`Round ${latest.number} isn't closed yet.`);

  if (t.config.topCutSeedIds) {
    const round = await createTopCutRound(ctx, s);
    return { round, warnings: [] };
  }
  const swissCount = s.rounds.filter((r) => r.stage === "swiss").length;
  const total = t.config.swissRounds as number;
  if (swissCount >= total) fail(`All ${total} Swiss rounds are played. Cut to the top or complete the event.`);
  return createSwissRound(ctx, s, swissCount + 1);
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * A legal final score. Drawn games never count toward the wins needed.
 *   - Nobody may exceed the wins needed (2 in Bo3, 1 in Bo1), and only one
 *     player may reach it.
 *   - If nobody reached it, the match ended on time, or it is a draw
 *     (equal game wins, e.g. an intentional draw reported as 0–0).
 *   - Top cut needs a winner and has no time limit.
 */
export function validateReportedScore(
  bestOf: 1 | 3,
  a: number,
  b: number,
  drawn: number,
  decidedOnTime: boolean,
  requireWinner: boolean,
): void {
  if (![a, b, drawn].every((n) => Number.isInteger(n) && n >= 0)) fail("Game counts must be whole numbers ≥ 0.");
  const needed = bestOf === 3 ? 2 : 1;
  if (a > needed || b > needed) fail(`In a best of ${bestOf} nobody can win more than ${needed} game(s).`);
  if (a === needed && b === needed) fail(`Only one player can reach ${needed} win(s).`);
  if (drawn > 5) fail("More than 5 drawn games isn't a plausible result.");
  const won = a === needed || b === needed;
  if (requireWinner) {
    if (decidedOnTime) fail("Top-cut matches have no time limit.");
    if (!won) fail(`A top-cut match needs a winner with ${needed} win(s).`);
    return;
  }
  if (!won && !decidedOnTime && a !== b) {
    fail(`Nobody has ${needed} win(s). Mark it as decided on time, or report a draw.`);
  }
}

export interface ReportInput {
  matchId: string;
  gamesA: number;
  gamesB: number;
  gamesDrawn: number;
  idempotencyKey: string;
}
export interface SwissReportInput extends ReportInput {
  decidedOnTime: boolean;
  dropA?: boolean;
  dropB?: boolean;
}
export interface ReportOutcome {
  match: RbMatch;
  /** True when this idempotency key was already recorded: nothing changed, the original result is returned. */
  duplicate: boolean;
}

async function lockMatchScope(
  ctx: RbContext,
  matchId: string,
): Promise<{ t: RbTournament; round: RbRound; match: RbMatch }> {
  const ref = await ctx.store.findMatchRef(matchId);
  if (!ref) fail("Match not found.");
  const t = await lockTournamentOrFail(ctx, ref.tournamentId);
  const round = await ctx.store.lockRound(t.id, ref.roundId);
  const match = await ctx.store.lockMatch(t.id, matchId);
  if (!round || !match) fail("Match not found.");
  return { t, round, match };
}

async function report(
  ctx: RbContext,
  input: SwissReportInput,
  stage: RbRoundStage,
): Promise<ReportOutcome> {
  const key = (input.idempotencyKey ?? "").trim();
  if (!key || key.length > 100) fail("A submission key (1–100 characters) is required.");
  const { t, round, match } = await lockMatchScope(ctx, input.matchId);

  // Checked under the match lock, so two copies of one submission serialise
  // here and the second sees the first.
  const prior = await ctx.store.findMatchByIdempotencyKey(key);
  if (prior) {
    if (prior.id === match.id) return { match: prior, duplicate: true };
    fail(`This submission was already recorded for another table (table ${prior.table_number}).`);
  }

  requireInProgress(t);
  if (round.stage !== stage) {
    fail(stage === "swiss" ? "This is a top-cut table; report it as a top-cut result." : "This is a Swiss table.");
  }
  if (round.status === "draft") fail("This round hasn't been published.");
  if (round.status === "closed") fail("This round is closed.");
  if (match.status === "bye") fail("This table is a bye.");
  if (match.status === "completed") {
    fail(`Reported by ${match.reported_by_name} at ${kst(match.reported_at as string)}.`);
  }
  validateReportedScore(t.config.bestOf, input.gamesA, input.gamesB, input.gamesDrawn, input.decidedOnTime, stage === "top_cut");

  const flags = [...match.flags];
  const drops = [input.dropA ? match.player_a_id : null, input.dropB ? match.player_b_id : null].filter(
    (id): id is string => Boolean(id),
  );
  if (drops.length) {
    const players = await ctx.store.lockPlayers(t.id);
    for (const id of drops) {
      const p = players.find((x) => x.id === id);
      if (!p || p.status !== "active") continue;
      await ctx.store.updatePlayer(t.id, id, { status: "dropped", dropped_after_round: round.number });
      flags.push({ kind: "drop", playerId: id });
      await audit(ctx, t, "player.drop", { playerId: id, afterRound: round.number, viaReport: match.id });
    }
  }

  const patch: RbMatchPatch = {
    status: "completed",
    games_a: input.gamesA,
    games_b: input.gamesB,
    games_drawn: input.gamesDrawn,
    decided_on_time: input.decidedOnTime,
    reported_by_id: ctx.actor.discordId,
    reported_by_name: ctx.actor.name,
    reported_at: isoAt(ctx),
    idempotency_key: key,
    flags,
  };
  await ctx.store.updateMatch(t.id, match.id, patch);
  await audit(ctx, t, "match.report", {
    matchId: match.id,
    round: round.number,
    stage,
    table: match.table_number,
    gamesA: input.gamesA,
    gamesB: input.gamesB,
    gamesDrawn: input.gamesDrawn,
    decidedOnTime: input.decidedOnTime,
    drops,
  });
  return { match: { ...match, ...patch }, duplicate: false };
}

export const reportResult = (ctx: RbContext, input: SwissReportInput) => report(ctx, input, "swiss");
export const reportTopCutResult = (ctx: RbContext, input: ReportInput) =>
  report(ctx, { ...input, decidedOnTime: false }, "top_cut");

/** Clear a reported result while its round is still open. Drops recorded with it stay; use undoDrop. */
async function undo(ctx: RbContext, matchId: string, stage: RbRoundStage): Promise<void> {
  const { t, round, match } = await lockMatchScope(ctx, matchId);
  requireInProgress(t);
  if (round.stage !== stage) fail(stage === "swiss" ? "This is a top-cut table." : "This is a Swiss table.");
  if (round.status === "closed") fail("This round is closed; results can't be undone.");
  if (match.status !== "completed") fail("This table has no result to undo.");
  await ctx.store.updateMatch(t.id, match.id, {
    status: "pending",
    games_a: 0,
    games_b: 0,
    games_drawn: 0,
    decided_on_time: false,
    reported_by_id: null,
    reported_by_name: null,
    reported_at: null,
    idempotency_key: null,
  });
  await audit(ctx, t, "match.undo", {
    matchId: match.id,
    round: round.number,
    table: match.table_number,
    previous: {
      gamesA: match.games_a,
      gamesB: match.games_b,
      gamesDrawn: match.games_drawn,
      decidedOnTime: match.decided_on_time,
      reportedBy: match.reported_by_name,
      reportedAt: match.reported_at,
    },
  });
}

export const undoResult = (ctx: RbContext, input: { matchId: string }) => undo(ctx, input.matchId, "swiss");
export const undoTopCutResult = (ctx: RbContext, input: { matchId: string }) => undo(ctx, input.matchId, "top_cut");

/**
 * Mark a top-cut table as in progress (the venue's LIVE tag), or take the mark
 * off. Display only: it never blocks or changes a result.
 */
export async function setMatchStarted(ctx: RbContext, input: { matchId: string; started: boolean }): Promise<void> {
  const { t, round, match } = await lockMatchScope(ctx, input.matchId);
  requireInProgress(t);
  if (round.stage !== "top_cut") fail("Only top-cut matches are marked as started.");
  if (round.status !== "published" && round.status !== "live") fail("The round isn't running.");
  if (match.status !== "pending") fail("This match already has a result.");
  if (input.started === (match.started_at !== null)) return;
  await ctx.store.updateMatch(t.id, match.id, { started_at: input.started ? isoAt(ctx) : null });
  await audit(ctx, t, input.started ? "match.start" : "match.unstart", {
    matchId: match.id,
    round: round.number,
    table: match.table_number,
  });
}

/** Throw away a draft round and pair it again (after a drop or an undone drop changed the field). */
async function repairDraft(ctx: RbContext, s: LockedState, draft: RbRound): Promise<void> {
  await ctx.store.deleteRoundMatches(s.t.id, draft.id);
  await ctx.store.deleteRound(s.t.id, draft.id);
  s.matches = s.matches.filter((m) => m.round_id !== draft.id);
  s.rounds = s.rounds.filter((r) => r.id !== draft.id);
  if (draft.stage === "swiss") await createSwissRound(ctx, s, draft.number);
  else await createTopCutRound(ctx, s);
}

/**
 * Drop (or disqualify) a player. They are never paired again. A draft round
 * that contains them is re-paired. In the top cut nobody replaces them: a
 * pending top-cut match is awarded to the opponent, and a later round gives
 * the opponent a bye.
 */
export async function setDrop(ctx: RbContext, input: { playerId: string; dq?: boolean }): Promise<void> {
  const s = await lockPlayerScope(ctx, input.playerId);
  const { t, player } = s;
  requireInProgress(t);
  if (player.status !== "active") fail(`${player.display_name} isn't an active player.`);

  const latest = [...s.rounds].sort(byNumber).at(-1);
  const draft = latest && latest.status === "draft" ? latest : null;
  const afterRound = latest ? (draft ? latest.number - 1 : latest.number) : 0;
  const status = input.dq ? "dq" : "dropped";
  await ctx.store.updatePlayer(t.id, player.id, { status, dropped_after_round: afterRound });
  player.status = status;
  player.dropped_after_round = afterRound;

  // Top cut: award a pending match in a running round to the opponent.
  const needed = t.config.bestOf === 3 ? 2 : 1;
  for (const r of s.rounds.filter((x) => x.stage === "top_cut" && (x.status === "published" || x.status === "live"))) {
    for (const m of roundMatches(s, r)) {
      if (m.status !== "pending" || (m.player_a_id !== player.id && m.player_b_id !== player.id)) continue;
      const aWins = m.player_b_id === player.id;
      const patch: RbMatchPatch = {
        status: "completed",
        games_a: aWins ? needed : 0,
        games_b: aWins ? 0 : needed,
        games_drawn: 0,
        decided_on_time: false,
        reported_by_id: ctx.actor.discordId,
        reported_by_name: ctx.actor.name,
        reported_at: isoAt(ctx),
        flags: [...m.flags, { kind: input.dq ? "dq" : "drop", playerId: player.id }],
      };
      await ctx.store.updateMatch(t.id, m.id, patch);
      Object.assign(m, patch);
      await audit(ctx, t, "match.report", { matchId: m.id, round: r.number, stage: "top_cut", forfeit: player.id });
    }
  }

  await audit(ctx, t, input.dq ? "player.dq" : "player.drop", { playerId: player.id, afterRound });
  if (draft && roundMatches(s, draft).some((m) => m.player_a_id === player.id || m.player_b_id === player.id)) {
    await repairDraft(ctx, s, draft);
  }
}

/** Re-enter a dropped player before the next round starts (only a draft round may exist since the drop; it is re-paired). */
export async function undoDrop(ctx: RbContext, input: { playerId: string }): Promise<void> {
  const s = await lockPlayerScope(ctx, input.playerId);
  const { t, player } = s;
  requireInProgress(t);
  if (player.status !== "dropped" && player.status !== "dq") fail(`${player.display_name} hasn't dropped.`);
  if (t.config.topCutSeedIds) fail("Drops can't be undone after the cut.");
  const after = player.dropped_after_round ?? 0;
  const later = s.rounds.filter((r) => r.number > after);
  if (later.some((r) => r.status !== "draft")) fail("A round has started since this drop.");

  await ctx.store.updatePlayer(t.id, player.id, { status: "active", dropped_after_round: null });
  player.status = "active";
  player.dropped_after_round = null;
  await audit(ctx, t, "player.undrop", { playerId: player.id, wasAfterRound: after });
  for (const draft of later) await repairDraft(ctx, s, draft);
}

export async function addExtension(
  ctx: RbContext,
  input: { matchId: string; ms: number; reason: string },
): Promise<RbMatch> {
  if (!Number.isInteger(input.ms) || input.ms <= 0 || input.ms > 30 * 60_000) {
    fail("An extension must be between 1 ms and 30 minutes.");
  }
  const reason = cleanOptional(input.reason, 200, "Reason");
  if (!reason) fail("Give a reason for the extension.");
  const { t, round, match } = await lockMatchScope(ctx, input.matchId);
  requireInProgress(t);
  if (round.status !== "published" && round.status !== "live") fail("The round isn't running.");
  if (round.duration_ms === null) fail("This round has no time limit.");
  if (match.status !== "pending") fail("This table is finished.");
  const extension_ms = match.extension_ms + input.ms;
  await ctx.store.updateMatch(t.id, match.id, { extension_ms });
  await audit(ctx, t, "match.extension", {
    matchId: match.id,
    round: round.number,
    table: match.table_number,
    ms: input.ms,
    totalMs: extension_ms,
    reason,
  });
  return { ...match, extension_ms };
}

export async function flagTable(
  ctx: RbContext,
  input: { matchId: string; kind: RbDeskFlagKind; note: string },
): Promise<RbDeskFlag> {
  if (!RB_DESK_FLAG_KINDS.includes(input.kind)) fail("Unknown flag kind.");
  const note = cleanOptional(input.note, 500, "Note") ?? "";
  const { t, round, match } = await lockMatchScope(ctx, input.matchId);
  requireNotFinished(t);
  const flag: RbDeskFlag = {
    kind: input.kind,
    id: ctx.newId("flag"),
    note,
    raised_by_name: ctx.actor.name,
    raised_at: isoAt(ctx),
    acknowledged_by_name: null,
    acknowledged_at: null,
  };
  await ctx.store.updateMatch(t.id, match.id, { flags: [...match.flags, flag] });
  await audit(ctx, t, "match.flag", { matchId: match.id, round: round.number, table: match.table_number, flagId: flag.id, kind: flag.kind, note });
  return flag;
}

const isDeskFlag = (f: RbMatchFlag): f is RbDeskFlag => "id" in f && RB_DESK_FLAG_KINDS.includes(f.kind as RbDeskFlagKind);

export async function acknowledgeFlag(ctx: RbContext, input: { matchId: string; flagId: string }): Promise<void> {
  const { t, round, match } = await lockMatchScope(ctx, input.matchId);
  const flag = match.flags.find((f) => isDeskFlag(f) && f.id === input.flagId) as RbDeskFlag | undefined;
  if (!flag) fail("Flag not found.");
  if (flag.acknowledged_at) fail(`Already acknowledged by ${flag.acknowledged_by_name}.`);
  const flags = match.flags.map((f) =>
    f === flag ? { ...flag, acknowledged_by_name: ctx.actor.name, acknowledged_at: isoAt(ctx) } : f,
  );
  await ctx.store.updateMatch(t.id, match.id, { flags });
  await audit(ctx, t, "match.flag_ack", { matchId: match.id, round: round.number, table: match.table_number, flagId: flag.id });
}

// ---------------------------------------------------------------------------
// Top cut
// ---------------------------------------------------------------------------

export { replayTopCut };

async function createTopCutRound(ctx: RbContext, s: LockedState): Promise<RbRound> {
  const { t } = s;
  const seeds = t.config.topCutSeedIds as string[];
  const cutRounds = s.rounds.filter((r) => r.stage === "top_cut");
  const replay = replayTopCut(seeds, t.config.bestOf, s.rounds, s.matches);
  if (replay.championId || cutRounds.length >= replay.levels.length) fail("The top cut is finished. Complete the event.");
  const level = replay.levels[cutRounds.length];
  const seedOf = (id: string) => seeds.indexOf(id);
  const gone = new Set(s.players.filter(isGone).map((p) => p.id));

  const number = Math.max(0, ...s.rounds.map((r) => r.number)) + 1;
  const round = newRound(ctx, t, number, "top_cut", null);
  await ctx.store.insertRound(round);
  s.rounds.push(round);
  let table = 1;
  for (const bm of level) {
    const present = [bm.team_a_id, bm.team_b_id].filter((id): id is string => Boolean(id));
    if (present.length === 0) fail("The previous top-cut round has no result yet.");
    let m: RbMatch;
    if (present.length === 1 || bm.status === "bye") {
      m = makeMatch(ctx, t, round, table++, present[0], null);
    } else {
      // Higher seed listed first; they choose who plays first in game 1.
      const [hi, lo] = present.sort((a, b) => seedOf(a) - seedOf(b));
      if (gone.has(hi) || gone.has(lo)) {
        // Nobody replaces a player who dropped after the cut: the opponent advances.
        const stays = gone.has(hi) ? lo : hi;
        const left = stays === hi ? lo : hi;
        m = makeMatch(ctx, t, round, table++, stays, null, [{ kind: "drop", playerId: left }]);
      } else {
        m = makeMatch(ctx, t, round, table++, hi, lo);
      }
    }
    await ctx.store.insertMatch(m);
    s.matches.push(m);
  }
  await audit(ctx, t, "round.pair", { round: number, stage: "top_cut", level: cutRounds.length + 1, tables: level.length });
  return round;
}

/** Make the cut from the final Swiss standings and pair the first top-cut round as a draft. */
export async function cutToTop(ctx: RbContext, input: { tournamentId: string }): Promise<{ seeds: string[]; round: RbRound }> {
  const s = await lockState(ctx, input.tournamentId);
  const { t } = s;
  requireInProgress(t);
  if (t.config.topCutSeedIds) fail("The cut has already been made.");
  const swiss = s.rounds.filter((r) => r.stage === "swiss");
  const total = t.config.swissRounds as number;
  if (swiss.length < total || swiss.some((r) => r.status !== "closed")) {
    fail(`Finish and close all ${total} Swiss rounds first.`);
  }
  const participants = s.players.filter(isParticipant).length;
  const size = resolveTopCutSize(participants, swissConfigOf(t));
  if (size === 0) fail("This event has no top cut. Complete the event instead.");
  const seeds = topCutSeeds(standingsOf(s), size);
  if (seeds.length < 2) fail("Not enough players remain for a top cut.");

  t.config = { ...t.config, topCutSeedIds: seeds };
  await ctx.store.updateTournament(t.id, { config: t.config });
  await audit(ctx, t, "cut.make", { size, seeds });
  const round = await createTopCutRound(ctx, s);
  await followPhase(ctx, t, "top_cut");
  return { seeds, round };
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

/**
 * Decide the champion and complete the event. With a top cut: the final's
 * winner (the final round is closed here if it is still open). Without one:
 * Swiss rank 1 among players who haven't dropped.
 */
export async function completeEvent(ctx: RbContext, input: { tournamentId: string }): Promise<{ championId: string }> {
  const s = await lockState(ctx, input.tournamentId);
  const { t } = s;
  requireInProgress(t);
  let championId: string | null = null;

  if (t.config.topCutSeedIds) {
    const replay = replayTopCut(t.config.topCutSeedIds, t.config.bestOf, s.rounds, s.matches);
    if (!replay.championId) fail("The top-cut final has no result yet.");
    championId = replay.championId;
    for (const r of s.rounds.filter((x) => x.stage === "top_cut" && x.status !== "closed")) {
      if (roundMatches(s, r).some((m) => m.status === "pending")) fail(`Round ${r.number} still has open tables.`);
      await ctx.store.updateRound(t.id, r.id, { status: "closed" });
      await audit(ctx, t, "round.close", { round: r.number, stage: "top_cut", viaComplete: true });
    }
  } else {
    const swiss = s.rounds.filter((r) => r.stage === "swiss");
    const total = t.config.swissRounds as number;
    if (swiss.length < total || swiss.some((r) => r.status !== "closed")) {
      fail(`Finish and close all ${total} Swiss rounds first.`);
    }
    const size = resolveTopCutSize(s.players.filter(isParticipant).length, swissConfigOf(t));
    if (size > 0) fail(`This event has a top ${size} cut. Make the cut, or set the top cut to none.`);
    championId = standingsOf(s).find((x) => !x.dropped)?.playerId ?? null;
    if (!championId) fail("No player is left to be champion.");
  }

  await ctx.store.updateTournament(t.id, { status: "completed", champion_player_id: championId });
  await audit(ctx, t, "tournament.complete", { championId });
  await followPhase(ctx, t, "champion");
  return { championId };
}

/** Permanent cleanup of test events. No audit can survive its own event deletion. */
export async function deleteEvent(ctx: RbContext, input: { tournamentId: string }): Promise<void> {
  const { t } = await lockState(ctx, input.tournamentId);
  await ctx.store.deleteTournament(t.id);
}

export async function archiveEvent(ctx: RbContext, input: { tournamentId: string }): Promise<void> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  if (t.status !== "completed" && t.status !== "draft") fail("Only a completed (or never-started) event can be archived.");
  await ctx.store.updateTournament(t.id, { status: "archived" });
  await audit(ctx, t, "tournament.archive", { from: t.status });
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

/** Manual scene change. Pauses auto-follow until the next phase change. */
export async function setScene(ctx: RbContext, input: { tournamentId: string; scene: RbScene }): Promise<void> {
  if (!RB_SCENES.includes(input.scene)) fail("Unknown scene.");
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  if (t.status === "archived") fail("This event is archived.");
  await ctx.store.updateTournament(t.id, { scene: input.scene, auto_follow_paused: t.auto_follow });
  await audit(ctx, t, "scene.set", { from: t.scene, to: input.scene, autoFollowPaused: t.auto_follow });
}

/** The operator confirmed the venue screen displays correctly. Clears nothing; marking again just moves the time. */
export async function markVenueTested(ctx: RbContext, input: { tournamentId: string }): Promise<{ at: string }> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  requireNotFinished(t);
  const at = isoAt(ctx);
  await ctx.store.updateTournament(t.id, { config: { ...t.config, venueTestedAt: at } });
  await audit(ctx, t, "venue.tested", { at });
  return { at };
}

export async function setAutoFollow(ctx: RbContext, input: { tournamentId: string; enabled: boolean }): Promise<void> {
  const t = await lockTournamentOrFail(ctx, input.tournamentId);
  if (t.status === "archived") fail("This event is archived.");
  await ctx.store.updateTournament(t.id, { auto_follow: input.enabled, auto_follow_paused: false });
  await audit(ctx, t, "auto_follow.toggle", { enabled: input.enabled });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export async function exportRecords(
  ctx: RbContext,
  input: { tournamentId: string; kind: "matches" | "games"; format: RbExportFormat },
): Promise<{ filename: string; contentType: string; content: string }> {
  if (input.kind !== "matches" && input.kind !== "games") fail("Export matches or games.");
  if (input.format !== "csv" && input.format !== "json") fail("Export as CSV or JSON.");
  const s = await lockState(ctx, input.tournamentId);
  const full: RbTournamentFull = { tournament: s.t, rounds: s.rounds, matches: s.matches, players: s.players };
  const content = input.kind === "matches" ? formatMatchExport(full, input.format) : formatGameExport(full, input.format);
  await audit(ctx, s.t, "export.download", { kind: input.kind, format: input.format });
  return {
    filename: `${s.t.slug}-${input.kind}.${input.format}`,
    contentType: input.format === "csv" ? "text/csv; charset=utf-8" : "application/json",
    content,
  };
}
