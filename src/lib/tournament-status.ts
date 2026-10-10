import "server-only";
import type { ChampionRecord } from "@/types/champion";
import type { CommunityEvent, RecurringSchedule } from "@/types/event";
import type { MayhemPublic } from "@/types/mayhem";
import type { SrPublicTournament } from "@/types/sr-tournament";
import { getRealChampions } from "@/lib/champions";
import { getRecurringSchedule, getUpcomingEvents } from "@/lib/events";
import { getMayhemPublic, listMayhemEvents } from "@/lib/mayhem-db";
import { listPublicEvents, type RbPublicEventSummary } from "@/lib/rb-db";
import {
  getPublicTournamentBySlug,
  getTeamCountsBySlug,
  listPublicTournaments,
  listSignupOpenTournaments,
} from "@/lib/sr-db";

/**
 * Tournament status, derived from data and nothing else.
 *
 * The /tournaments status bar, the format plate chips and the format-page
 * empty states all read from here, so a change in the DB (a tournament going
 * live, a final being reported, an event being scheduled in Discord) moves all
 * of them at once. Nothing in this file is hand-set copy about state: every
 * label is computed from a record, and a value we don't have is left out.
 *
 * Sources, all read-only:
 *   - Summoner's Rift: sr_tournaments via sr-db's public projections
 *   - ARAM Mayhem: the published mayhem_events row via mayhem-db
 *   - Riftbound: rb_tournaments via rb-db's listPublicEvents
 *   - Scheduled cups: Discord scheduled events (tournament-kind only)
 *   - Results: the Hall of Champions records (champions.ts)
 * Test tournaments are filtered out in each of those queries.
 */

export type FormatKey = "sr" | "aram" | "rb";

export const FORMAT_NAMES: Record<FormatKey, string> = {
  sr: "Summoner's Rift",
  aram: "ARAM Mayhem",
  rb: "Riftbound",
};

export const FORMAT_HREFS: Record<FormatKey, string> = {
  sr: "/tournaments/summoners-rift",
  aram: "/tournaments/aram",
  rb: "/tournaments/riftbound",
};

export interface StatusCell {
  k: string;
  v: string;
  href?: string;
}

/** A tournament being played right now. */
export interface LiveEntry {
  name: string;
  href: string;
  sub: string;
  cells: StatusCell[];
}

/** A tournament or cup with a known (or pending) date. */
export interface NextEntry {
  name: string;
  /** Exact start, ISO. Present for Discord events and timed records. */
  startsAt?: string;
  /** KST calendar day, "YYYY-MM-DD", for records that only store a date. */
  date?: string;
  href: string;
  external?: boolean;
  sub: string;
  cells: StatusCell[];
}

export interface FormatState {
  format: FormatKey;
  live: LiveEntry | null;
  next: NextEntry | null;
  signupsOpen: boolean;
  lastResult: ChampionRecord | null;
}

export interface FormatChip {
  tone: "red" | "neutral";
  pulse: boolean;
  label: string;
}

export interface StatusBarData {
  mode: "live" | "next" | "offseason";
  title: string;
  sub: string;
  cta: { label: string; href: string; external?: boolean };
  cells: StatusCell[];
}

// ---------------------------------------------------------------------------
// Date helpers (KST is the source of truth for every displayed date)
// ---------------------------------------------------------------------------

const KST = "Asia/Seoul";
const kstDay = new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit" });
const kstWeekday = new Intl.DateTimeFormat("en-GB", { timeZone: KST, weekday: "short" });
const kstWeekdayLong = new Intl.DateTimeFormat("en-GB", { timeZone: KST, weekday: "long" });
const kstDayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: KST, day: "numeric", month: "short" });
const kstTime = new Intl.DateTimeFormat("en-US", { timeZone: KST, hour: "numeric", minute: "2-digit" });
const kstMonthYear = new Intl.DateTimeFormat("en-GB", { timeZone: KST, month: "long", year: "numeric" });
const kstMonthShortYear = new Intl.DateTimeFormat("en-GB", { timeZone: KST, month: "short", year: "numeric" });

/** "YYYY-MM-DD" in KST for an instant. */
function kstDateKey(d: Date): string {
  return kstDay.format(d);
}

/** A date-only "YYYY-MM-DD" (already KST) as an instant at KST noon, safe for formatting. */
function dateOnlyToInstant(date: string): Date {
  return new Date(`${date}T12:00:00+09:00`);
}

function nextInstant(n: Pick<NextEntry, "startsAt" | "date">): Date | null {
  if (n.startsAt) return new Date(n.startsAt);
  if (n.date) return dateOnlyToInstant(n.date);
  return null;
}

/** "Sun 11 Oct, 1:00 PM KST" or, for date-only records, "Sun 11 Oct". */
export function formatKstWhen(n: Pick<NextEntry, "startsAt" | "date">): string | null {
  const d = nextInstant(n);
  if (!d || Number.isNaN(d.getTime())) return null;
  const day = `${kstWeekday.format(d)} ${kstDayMonth.format(d)}`;
  return n.startsAt ? `${day}, ${kstTime.format(d)} KST` : day;
}

/** "September 2026". */
export function formatMonthYear(iso: string): string {
  return kstMonthYear.format(new Date(iso));
}

/** "Sep 2026". */
export function formatMonthShortYear(iso: string): string {
  return kstMonthShortYear.format(new Date(iso));
}

/** Whole KST calendar days from now until the instant (0 = today). */
function daysUntil(d: Date, now: Date): number {
  const a = Date.parse(`${kstDateKey(now)}T00:00:00Z`);
  const b = Date.parse(`${kstDateKey(d)}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Discord scheduled events → formats
// ---------------------------------------------------------------------------

function eventFormat(e: CommunityEvent): FormatKey | null {
  const text = `${e.title} ${e.description}`.toLowerCase();
  if (/riftbound|poro cup/.test(text)) return "rb";
  if (/\baram\b|mayhem/.test(text)) return "aram";
  if (/summoner'?s rift|\b5v5\b/.test(text)) return "sr";
  return null;
}

function discordNext(events: CommunityEvent[], format: FormatKey, now: Date): NextEntry | null {
  const e = events.find(
    (ev) =>
      ev.kind === "tournament" &&
      eventFormat(ev) === format &&
      new Date(ev.startsAt).getTime() >= now.getTime() - 3 * 60 * 60 * 1000,
  );
  if (!e) return null;
  const firstLine = e.description.split("\n").map((s) => s.trim()).find(Boolean);
  const cells: StatusCell[] = [];
  const when = formatKstWhen({ startsAt: e.startsAt });
  if (when) cells.push({ k: "When", v: when });
  if (e.location && !/^discord( voice| stage)?$/i.test(e.location)) cells.push({ k: "Where", v: e.location });
  return {
    name: e.title,
    startsAt: e.startsAt,
    href: e.cta?.href ?? FORMAT_HREFS[format],
    external: Boolean(e.cta?.href?.startsWith("http")),
    sub: firstLine ?? FORMAT_NAMES[format],
    cells,
  };
}

// ---------------------------------------------------------------------------
// Per-format derivation
// ---------------------------------------------------------------------------

function srShape(t: Pick<SrPublicTournament, "format" | "best_of">): string {
  return `${t.format === "double_elim" ? "Double elimination" : "Single elimination"}, best of ${t.best_of}`;
}

async function srState(events: CommunityEvent[], results: ChampionRecord[], now: Date): Promise<FormatState> {
  const [listed, signups] = await Promise.all([
    listPublicTournaments().catch(() => [] as SrPublicTournament[]),
    listSignupOpenTournaments().catch(() => []),
  ]);
  const fields = await getTeamCountsBySlug(listed.map((t) => t.slug)).catch(() => new Map<string, number>());

  let live: LiveEntry | null = null;
  const running = listed.find((t) => t.status === "in_progress" || t.status === "bracket_published");
  if (running) {
    const full = await getPublicTournamentBySlug(running.slug).catch(() => null);
    const cells: StatusCell[] = [];
    if (full) {
      const open = full.matches.filter(
        (m) => m.status !== "completed" && m.status !== "bye",
      );
      const current = open.sort((a, b) => a.match_number - b.match_number)[0];
      if (current) cells.push({ k: "Stage", v: srStageLabel(current.bracket, current.round_number) });
      cells.push({ k: "Matches left", v: String(open.length) });
    }
    cells.push({ k: "Format", v: srShape(running) });
    const field = fields.get(running.slug);
    if (field) cells.push({ k: "Field", v: `${field} teams` });
    live = {
      name: running.name,
      href: `/tournaments/summoners-rift/${running.slug}`,
      sub: `Summoner's Rift, ${srShape(running).toLowerCase()}`,
      cells,
    };
  }

  let next: NextEntry | null = discordNext(events, "sr", now);
  if (!next) {
    // A drawn-but-unplayed field, or a scheduled tournament with a start date.
    const upcoming = listed.find(
      (t) => t.status === "seeding" || (t.start_at && new Date(t.start_at) > now && t.status !== "completed"),
    ) ?? signups.find((t) => t.start_at && new Date(t.start_at) > now);
    if (upcoming && upcoming !== running) {
      const cells: StatusCell[] = [];
      const when = upcoming.start_at ? formatKstWhen({ startsAt: upcoming.start_at }) : null;
      if (when) cells.push({ k: "When", v: when });
      cells.push({ k: "Where", v: "Online, KR server" });
      cells.push({ k: "Format", v: srShape(upcoming) });
      const field = fields.get(upcoming.slug);
      if (field) cells.push({ k: "Field", v: `${field} teams` });
      next = {
        name: upcoming.name,
        startsAt: upcoming.start_at ?? undefined,
        href: FORMAT_HREFS.sr,
        sub: "Summoner's Rift",
        cells,
      };
    }
  }

  return {
    format: "sr",
    live,
    next,
    signupsOpen: signups.length > 0,
    lastResult: results.find((r) => r.formatKey === "sr") ?? null,
  };
}

function srStageLabel(bracket: string, round: number): string {
  if (bracket === "grand_final") return "Grand final";
  if (bracket === "third_place") return "Third place";
  if (bracket === "lower") return `Lower bracket, round ${round}`;
  return `Upper bracket, round ${round}`;
}

const MAYHEM_STAGE_LABEL: Record<MayhemPublic["stage"], string> = {
  collecting: "Signups",
  randomized: "Teams drawn",
  group_stage: "Group stage",
  knockout: "Knockout",
  completed: "Finished",
};

async function aramState(events: CommunityEvent[], results: ChampionRecord[], now: Date): Promise<FormatState> {
  const summaries = await listMayhemEvents(true).catch(() => []);
  const current = summaries[0];
  const data = current ? await getMayhemPublic(current.id).catch(() => null) : null;

  let live: LiveEntry | null = null;
  if (data && (data.stage === "randomized" || data.stage === "group_stage" || data.stage === "knockout")) {
    const open = data.matches.filter((m) => m.status !== "completed" && m.status !== "bye");
    const cells: StatusCell[] = [{ k: "Stage", v: MAYHEM_STAGE_LABEL[data.stage] }];
    if (data.matches.length > 0) cells.push({ k: "Matches left", v: String(open.length) });
    cells.push({ k: "Format", v: data.team_format === "premade" ? "Premade teams" : "Random teams" });
    if (data.teams.length > 0) {
      cells.push({ k: "Field", v: `${data.teams.length} teams, ${data.player_count} players` });
    } else if (data.player_count > 0) {
      cells.push({ k: "Field", v: `${data.player_count} players` });
    }
    live = { name: data.title, href: FORMAT_HREFS.aram, sub: "ARAM Mayhem", cells };
  }

  return {
    format: "aram",
    live,
    next: discordNext(events, "aram", now),
    signupsOpen: Boolean(data && data.stage === "collecting" && data.registration_open),
    lastResult: results.find((r) => r.formatKey === "aram") ?? null,
  };
}

function rbShape(e: RbPublicEventSummary): string | null {
  const parts: string[] = [];
  if (typeof e.swissRounds === "number") parts.push(`${e.swissRounds}-round Swiss`);
  else parts.push("Swiss");
  parts.push(`best of ${e.bestOf}`);
  if (typeof e.topCut === "number" && e.topCut > 0) parts.push(`top ${e.topCut} cut`);
  return parts.join(", ");
}

async function rbState(events: CommunityEvent[], results: ChampionRecord[], now: Date): Promise<FormatState> {
  const list = await listPublicEvents().catch(() => [] as RbPublicEventSummary[]);
  const todayKey = kstDateKey(now);

  let live: LiveEntry | null = null;
  const running = list.find((e) => e.status === "in_progress");
  if (running) {
    const cells: StatusCell[] = [];
    const shape = rbShape(running);
    if (shape) cells.push({ k: "Format", v: shape });
    if (running.venue) cells.push({ k: "Where", v: running.venue });
    if (running.players > 0) cells.push({ k: "Field", v: `${running.players} players` });
    live = { name: running.name, href: FORMAT_HREFS.rb, sub: "Riftbound", cells };
  }

  let next: NextEntry | null = discordNext(events, "rb", now);
  if (!next) {
    const upcoming = list.find((e) => e.status === "registration" && e.date && e.date >= todayKey);
    if (upcoming && upcoming.date) {
      const cells: StatusCell[] = [];
      const when = formatKstWhen({ date: upcoming.date });
      if (when) cells.push({ k: "When", v: when });
      if (upcoming.venue) cells.push({ k: "Where", v: upcoming.venue });
      const shape = rbShape(upcoming);
      if (shape) cells.push({ k: "Format", v: shape });
      if (upcoming.players > 0) cells.push({ k: "Field", v: `${upcoming.players} players registered` });
      next = { name: upcoming.name, date: upcoming.date, href: FORMAT_HREFS.rb, sub: "Riftbound", cells };
    }
  }

  return {
    format: "rb",
    live,
    next,
    signupsOpen: list.some((e) => e.status === "registration"),
    lastResult: results.find((r) => r.formatKey === "rb") ?? null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface TournamentOverview {
  states: Record<FormatKey, FormatState>;
  results: ChampionRecord[];
  recurring: RecurringSchedule[];
  now: string;
}

export async function getTournamentOverview(now: Date = new Date()): Promise<TournamentOverview> {
  const [events, results, recurring] = await Promise.all([
    getUpcomingEvents().catch(() => [] as CommunityEvent[]),
    getRealChampions().catch(() => [] as ChampionRecord[]),
    getRecurringSchedule().catch(() => [] as RecurringSchedule[]),
  ]);
  const [sr, aram, rb] = await Promise.all([
    srState(events, results, now),
    aramState(events, results, now),
    rbState(events, results, now),
  ]);
  return { states: { sr, aram, rb }, results, recurring, now: now.toISOString() };
}

/** The status chip on a format plate. */
export function formatChip(state: FormatState, now: Date = new Date()): FormatChip {
  if (state.live) return { tone: "red", pulse: true, label: "Live now" };
  if (state.next) {
    const d = nextInstant(state.next);
    if (d) {
      const days = daysUntil(d, now);
      if (days >= 0 && days <= 6) {
        const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${kstWeekdayLong.format(d)}`;
        return { tone: "red", pulse: true, label: `${state.next.name} ${when}` };
      }
      const label = formatKstWhen({ date: kstDateKey(d) });
      if (label) return { tone: "neutral", pulse: false, label: `Next: ${label}` };
    }
  }
  if (state.signupsOpen) return { tone: "neutral", pulse: false, label: "Signups open" };
  if (state.lastResult) {
    return { tone: "neutral", pulse: false, label: `Last run ${formatMonthYear(state.lastResult.date)}` };
  }
  return { tone: "neutral", pulse: false, label: "Between seasons" };
}

const FORMAT_ORDER: FormatKey[] = ["sr", "aram", "rb"];

/** The weekly in-house night from the same schedule the homepage shows. */
function weeklyInHouse(recurring: RecurringSchedule[]): string | null {
  const r = recurring.find((x) => /in-?house/i.test(x.title));
  return r ? r.cadence : null;
}

/**
 * The broadcast lower third at the top of /tournaments, or on a format page
 * when `only` is passed. Mode is derived here, never set by hand.
 */
export function deriveStatusBar(overview: TournamentOverview, only?: FormatKey): StatusBarData {
  const keys = only ? [only] : FORMAT_ORDER;

  const live = keys.map((k) => overview.states[k].live).find(Boolean);
  if (live) {
    return {
      mode: "live",
      title: live.name,
      sub: live.sub,
      cta: { label: "Open the bracket", href: live.href },
      cells: live.cells.slice(0, 4),
    };
  }

  const nexts = keys
    .map((k) => overview.states[k].next)
    .filter((n): n is NextEntry => Boolean(n))
    .sort((a, b) => (nextInstant(a)?.getTime() ?? Infinity) - (nextInstant(b)?.getTime() ?? Infinity));
  const next = nexts[0];
  if (next) {
    return {
      mode: "next",
      title: next.name,
      sub: next.sub,
      cta: { label: "Event details", href: next.href, external: next.external },
      cells: next.cells.slice(0, 4),
    };
  }

  const results = only ? overview.results.filter((r) => r.formatKey === only) : overview.results;
  const last = results[0];
  const cells: StatusCell[] = [];
  if (last) {
    cells.push({ k: "Last winner", v: last.champion.name });
    const fmt = last.formatKey ? FORMAT_NAMES[last.formatKey] : last.game;
    cells.push({ k: "Won", v: `${fmt}, ${formatMonthYear(last.date)}` });
  }
  const weekly = weeklyInHouse(overview.recurring);
  if (weekly) cells.push({ k: "Weekly in-house night", v: weekly });
  return {
    mode: "offseason",
    title: last ? `${last.champion.name} hold the crown` : "Between seasons",
    sub: last ? `${last.tournament}` : "The next tournament is announced in Discord first.",
    cta: last
      ? { label: "See the results", href: "/tournaments#hall-of-champions" }
      : { label: "Join the Discord", href: "https://discord.gg/lolmk", external: true },
    cells,
  };
}
