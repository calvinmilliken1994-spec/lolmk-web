"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getCurrentAdmin, isToolsSession } from "@/lib/tools-auth";
import { ensureSchema, newId, withTransaction } from "@/lib/rb-db";
import { createPgStore } from "@/lib/rb-pg-store";
import * as svc from "@/lib/rb-service";
import type { RbActionResult, RbConfigPatch, RbContext, ReportInput, SwissReportInput } from "@/lib/rb-service";
import type { RbDeskFlagKind, RbExportFormat, RbScene } from "@/types/riftbound";

/**
 * Riftbound admin write layer (server actions). Each action:
 *   1. requires a tools session (isToolsSession) and resolves the acting
 *      admin (getCurrentAdmin) — Discord id + display name for the audit row
 *   2. runs one Postgres transaction on a checked-out client
 *   3. delegates to src/lib/rb-service.ts, which locks the rows it touches
 *      with FOR UPDATE (tournament -> rounds -> matches -> players), checks
 *      the rules in docs/RIFTBOUND.md, writes the audit row in the same
 *      transaction and applies auto-follow
 *   4. revalidates the admin, floor, public and venue pages after COMMIT
 *
 * Expected failures come back as { ok: false, error } rather than a thrown
 * Error: Next redacts thrown server-action messages in production, and the
 * floor has to show messages such as "Reported by <name> at <time>".
 */

function refresh(slug: string | null) {
  revalidatePath("/tools/riftbound");
  revalidatePath("/tournaments");
  revalidatePath("/tournaments/riftbound");
  if (slug) {
    revalidatePath(`/tools/riftbound/${slug}`);
    revalidatePath(`/tools/riftbound/${slug}/floor`);
    revalidatePath(`/tournaments/riftbound/${slug}`);
    // The venue screen polls /api/rb/state (force-dynamic); this only
    // refreshes its server-rendered first paint.
    revalidatePath(`/rblive/${slug}`);
  }
}

async function run<T>(op: (ctx: RbContext) => Promise<T>): Promise<RbActionResult<T>> {
  if (!(await isToolsSession())) return { ok: false, error: "Not authorized." };
  const admin = await getCurrentAdmin();
  if (!admin) return { ok: false, error: "Not authorized." };
  const actor = { discordId: admin.discordUserId, name: admin.username };
  await ensureSchema();

  let slug: string | null = null;
  try {
    const data = await withTransaction(async (client) => {
      const ctx: RbContext = {
        store: createPgStore(client),
        actor,
        now: () => Date.now(),
        newId,
        newSeed: () => randomUUID(),
        slug: null,
      };
      const out = await op(ctx);
      slug = ctx.slug;
      return out;
    });
    refresh(slug);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof svc.RbUserError) return { ok: false, error: e.message };
    throw e;
  }
}

const isUniqueViolation = (e: unknown, constraint: string) =>
  typeof e === "object" &&
  e !== null &&
  (e as { code?: string }).code === "23505" &&
  String((e as { constraint?: string }).constraint ?? "").includes(constraint);

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export async function createTournament(input: { name: string; config?: RbConfigPatch }) {
  // Two concurrent creates can both see a slug as free; the loser hits the
  // unique index. Retry with a fresh slug rather than surfacing a raw error.
  for (let attempt = 0; ; attempt++) {
    try {
      return await run((ctx) => svc.createTournament(ctx, input));
    } catch (e) {
      if (attempt < 4 && isUniqueViolation(e, "rb_tournaments_slug_unique")) continue;
      throw e;
    }
  }
}

export async function updateConfig(input: { tournamentId: string; name?: string; config?: RbConfigPatch }) {
  return run((ctx) => svc.updateConfig(ctx, input));
}

export async function markVenueTested(tournamentId: string) {
  return run((ctx) => svc.markVenueTested(ctx, { tournamentId }));
}

export async function addPlayer(input: {
  tournamentId: string;
  displayName: string;
  memberDiscordId?: string | null;
  legend?: string | null;
}) {
  return run((ctx) => svc.addPlayer(ctx, input));
}

export async function bulkAddPlayers(input: { tournamentId: string; names: string[] }) {
  return run((ctx) => svc.bulkAddPlayers(ctx, input));
}

export async function updatePlayer(input: {
  playerId: string;
  displayName?: string;
  memberDiscordId?: string | null;
  legend?: string | null;
}) {
  return run((ctx) => svc.updatePlayer(ctx, input));
}

export async function removePlayer(playerId: string) {
  return run((ctx) => svc.removePlayer(ctx, { playerId }));
}

// ---------------------------------------------------------------------------
// Check-in
// ---------------------------------------------------------------------------

export async function openCheckIn(tournamentId: string) {
  return run((ctx) => svc.openCheckIn(ctx, { tournamentId }));
}

export async function checkIn(playerId: string) {
  return run((ctx) => svc.checkIn(ctx, { playerId }));
}

export async function undoCheckIn(playerId: string) {
  return run((ctx) => svc.undoCheckIn(ctx, { playerId }));
}

export async function closeCheckInAndPairRound1(tournamentId: string) {
  return run((ctx) => svc.closeCheckInAndPairRound1(ctx, { tournamentId }));
}

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

export async function publishRound(roundId: string) {
  return run((ctx) => svc.publishRound(ctx, { roundId }));
}

export async function unpublishRound(roundId: string) {
  return run((ctx) => svc.unpublishRound(ctx, { roundId }));
}

export async function swapDraftPairing(input: { roundId: string; playerA: string; playerB: string }) {
  return run((ctx) => svc.swapDraftPairing(ctx, input));
}

export async function startClock(roundId: string) {
  return run((ctx) => svc.startClock(ctx, { roundId }));
}

export async function pauseClock(roundId: string) {
  return run((ctx) => svc.pauseClock(ctx, { roundId }));
}

export async function resumeClock(roundId: string) {
  return run((ctx) => svc.resumeClock(ctx, { roundId }));
}

export async function adjustClock(roundId: string, deltaMs: number) {
  return run((ctx) => svc.adjustClock(ctx, { roundId, deltaMs }));
}

export async function closeRound(roundId: string) {
  return run((ctx) => svc.closeRound(ctx, { roundId }));
}

export async function pairNextRound(tournamentId: string) {
  return run((ctx) => svc.pairNextRound(ctx, { tournamentId }));
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export async function reportResult(input: SwissReportInput) {
  return run((ctx) => svc.reportResult(ctx, input));
}

export async function undoResult(matchId: string) {
  return run((ctx) => svc.undoResult(ctx, { matchId }));
}

export async function setDrop(playerId: string, options: { dq?: boolean } = {}) {
  return run((ctx) => svc.setDrop(ctx, { playerId, dq: options.dq }));
}

export async function undoDrop(playerId: string) {
  return run((ctx) => svc.undoDrop(ctx, { playerId }));
}

export async function addExtension(matchId: string, ms: number, reason: string) {
  return run((ctx) => svc.addExtension(ctx, { matchId, ms, reason }));
}

export async function flagTable(matchId: string, kind: RbDeskFlagKind, note: string) {
  return run((ctx) => svc.flagTable(ctx, { matchId, kind, note }));
}

export async function acknowledgeFlag(matchId: string, flagId: string) {
  return run((ctx) => svc.acknowledgeFlag(ctx, { matchId, flagId }));
}

// ---------------------------------------------------------------------------
// Top cut
// ---------------------------------------------------------------------------

export async function cutToTop(tournamentId: string) {
  return run((ctx) => svc.cutToTop(ctx, { tournamentId }));
}

export async function reportTopCutResult(input: ReportInput) {
  return run((ctx) => svc.reportTopCutResult(ctx, input));
}

export async function undoTopCutResult(matchId: string) {
  return run((ctx) => svc.undoTopCutResult(ctx, { matchId }));
}

// ---------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------

export async function completeEvent(tournamentId: string) {
  return run((ctx) => svc.completeEvent(ctx, { tournamentId }));
}

export async function archiveEvent(tournamentId: string) {
  return run((ctx) => svc.archiveEvent(ctx, { tournamentId }));
}

// ---------------------------------------------------------------------------
// Broadcast
// ---------------------------------------------------------------------------

export async function setScene(tournamentId: string, scene: RbScene) {
  return run((ctx) => svc.setScene(ctx, { tournamentId, scene }));
}

export async function setAutoFollow(tournamentId: string, enabled: boolean) {
  return run((ctx) => svc.setAutoFollow(ctx, { tournamentId, enabled }));
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export async function exportRecords(tournamentId: string, kind: "matches" | "games", format: RbExportFormat) {
  return run((ctx) => svc.exportRecords(ctx, { tournamentId, kind, format }));
}
