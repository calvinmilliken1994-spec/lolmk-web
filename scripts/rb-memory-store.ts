// The in-memory RbStore the Riftbound scenario scripts run against (no
// database). Deliberately strict: every write needs a lock taken earlier in
// the same call, locks follow tournament -> rounds -> matches -> players, and
// a failed call rolls back completely. Shared by test-rb-scenario.ts and
// test-rb-cut.ts.

import type { RbActor, RbAuditAction, RbMatch, RbPlayer, RbRound, RbTournament, RbTournamentFull } from "../src/types/riftbound";
import type {
  RbMatchPatch,
  RbPlayerPatch,
  RbRoundPatch,
  RbStore,
  RbTournamentPatch,
} from "../src/lib/rb-service";

const LEVEL = { tournament: 0, round: 1, match: 2, player: 3 } as const;
type Kind = keyof typeof LEVEL;

export interface AuditRow {
  tournamentId: string;
  action: RbAuditAction;
  detail: Record<string, unknown> | null;
  actor: RbActor;
  call: number;
}

export class MemoryStore implements RbStore {
  tournaments = new Map<string, RbTournament>();
  players = new Map<string, RbPlayer>();
  rounds = new Map<string, RbRound>();
  matches = new Map<string, RbMatch>();
  audits: AuditRow[] = [];

  // Per-call transaction state.
  call = 0;
  private snapshot: string | null = null;
  private locked = new Set<string>(); // "kind:id"
  private maxLevel = -1;
  writes = 0;

  begin() {
    this.call++;
    this.snapshot = JSON.stringify({
      t: [...this.tournaments],
      p: [...this.players],
      r: [...this.rounds],
      m: [...this.matches],
      a: this.audits,
    });
    this.locked.clear();
    this.maxLevel = -1;
    this.writes = 0;
  }
  rollback() {
    const s = JSON.parse(this.snapshot as string);
    this.tournaments = new Map(s.t);
    this.players = new Map(s.p);
    this.rounds = new Map(s.r);
    this.matches = new Map(s.m);
    this.audits = s.a;
  }

  private lock(kind: Kind, ids: string[]) {
    if (LEVEL[kind] < this.maxLevel) {
      throw new Error(`lock order violation: ${kind} after level ${this.maxLevel}`);
    }
    this.maxLevel = LEVEL[kind];
    for (const id of ids) this.locked.add(`${kind}:${id}`);
  }
  private requireLock(kind: Kind, id: string) {
    if (!this.locked.has(`${kind}:${id}`)) throw new Error(`write to ${kind} ${id} without a row lock`);
    this.writes++;
  }
  private clone<T>(v: T): T {
    return structuredClone(v);
  }
  private checkMatch(m: RbMatch) {
    if ((m.player_b_id === null) !== (m.status === "bye")) throw new Error(`constraint: bye iff no opponent (${m.id})`);
    if (m.player_b_id !== null && m.player_a_id === m.player_b_id) throw new Error("constraint: distinct players");
    for (const o of this.matches.values()) {
      if (o.id === m.id) continue;
      if (o.round_id === m.round_id && o.table_number === m.table_number) throw new Error("constraint: table unique");
      if (m.idempotency_key && o.idempotency_key === m.idempotency_key) throw new Error("constraint: idempotency key unique");
    }
    if (m.status === "completed" && !(m.reported_by_id && m.reported_by_name && m.reported_at)) {
      throw new Error("constraint: completed has reporter");
    }
  }

  async findMatchRef(matchId: string) {
    const m = this.matches.get(matchId);
    return m ? { tournamentId: m.tournament_id, roundId: m.round_id } : null;
  }
  async findRoundTournamentId(roundId: string) {
    return this.rounds.get(roundId)?.tournament_id ?? null;
  }
  async findPlayerTournamentId(playerId: string) {
    return this.players.get(playerId)?.tournament_id ?? null;
  }
  async slugTaken(slug: string) {
    return [...this.tournaments.values()].some((t) => t.slug.toLowerCase() === slug.toLowerCase());
  }

  async lockTournament(id: string) {
    this.lock("tournament", [id]);
    const t = this.tournaments.get(id);
    return t ? this.clone(t) : null;
  }
  async lockRounds(tid: string) {
    const rs = [...this.rounds.values()].filter((r) => r.tournament_id === tid).sort((a, b) => a.number - b.number);
    this.lock("round", rs.map((r) => r.id));
    return this.clone(rs);
  }
  async lockRound(tid: string, rid: string) {
    const r = this.rounds.get(rid);
    this.lock("round", [rid]);
    return r && r.tournament_id === tid ? this.clone(r) : null;
  }
  async lockTournamentMatches(tid: string) {
    const num = (m: RbMatch) => this.rounds.get(m.round_id)?.number ?? 0;
    const ms = [...this.matches.values()]
      .filter((m) => m.tournament_id === tid)
      .sort((a, b) => num(a) - num(b) || a.table_number - b.table_number);
    this.lock("match", ms.map((m) => m.id));
    return this.clone(ms);
  }
  async lockMatch(tid: string, mid: string) {
    const m = this.matches.get(mid);
    this.lock("match", [mid]);
    return m && m.tournament_id === tid ? this.clone(m) : null;
  }
  async lockPlayers(tid: string) {
    const ps = [...this.players.values()].filter((p) => p.tournament_id === tid).sort((a, b) => (a.id < b.id ? -1 : 1));
    this.lock("player", ps.map((p) => p.id));
    return this.clone(ps);
  }
  async findMatchByIdempotencyKey(key: string) {
    const m = [...this.matches.values()].find((x) => x.idempotency_key === key);
    return m ? this.clone(m) : null;
  }

  async insertTournament(t: RbTournament) {
    if (await this.slugTaken(t.slug)) throw new Error("constraint: slug unique");
    this.writes++;
    this.tournaments.set(t.id, this.clone(t));
    this.locked.add(`tournament:${t.id}`);
  }
  async updateTournament(id: string, patch: RbTournamentPatch) {
    this.requireLock("tournament", id);
    const t = this.tournaments.get(id) as RbTournament;
    Object.assign(t, this.clone(patch));
    if (t.status === "completed" && !t.champion_player_id) throw new Error("constraint: completed has champion");
  }
  async deleteTournament(tid: string) {
    this.requireLock("tournament", tid);
    for (const [id, row] of this.matches) {
      if (row.tournament_id !== tid) continue;
      this.requireLock("match", id);
      this.matches.delete(id);
    }
    for (const [id, row] of this.rounds) {
      if (row.tournament_id !== tid) continue;
      this.requireLock("round", id);
      this.rounds.delete(id);
    }
    for (const [id, row] of this.players) {
      if (row.tournament_id !== tid) continue;
      this.requireLock("player", id);
      this.players.delete(id);
    }
    this.audits = this.audits.filter((row) => row.tournamentId !== tid);
    this.tournaments.delete(tid);
  }
  async insertPlayer(p: RbPlayer) {
    this.requireLock("tournament", p.tournament_id);
    this.players.set(p.id, this.clone(p));
    this.locked.add(`player:${p.id}`);
  }
  async updatePlayer(tid: string, id: string, patch: RbPlayerPatch) {
    this.requireLock("player", id);
    Object.assign(this.players.get(id) as RbPlayer, this.clone(patch));
  }
  async deletePlayer(tid: string, id: string) {
    this.requireLock("player", id);
    if ([...this.matches.values()].some((m) => m.player_a_id === id || m.player_b_id === id)) {
      throw new Error("constraint: player referenced by a match (RESTRICT)");
    }
    this.players.delete(id);
  }
  async insertRound(r: RbRound) {
    this.requireLock("tournament", r.tournament_id);
    if ([...this.rounds.values()].some((x) => x.tournament_id === r.tournament_id && x.number === r.number)) {
      throw new Error("constraint: round number unique");
    }
    this.rounds.set(r.id, this.clone(r));
    this.locked.add(`round:${r.id}`);
  }
  async updateRound(tid: string, id: string, patch: RbRoundPatch) {
    this.requireLock("round", id);
    Object.assign(this.rounds.get(id) as RbRound, this.clone(patch));
  }
  async deleteRound(tid: string, id: string) {
    this.requireLock("round", id);
    if ([...this.matches.values()].some((m) => m.round_id === id)) throw new Error("constraint: round has matches (RESTRICT)");
    this.rounds.delete(id);
  }
  async insertMatch(m: RbMatch) {
    this.requireLock("round", m.round_id);
    this.checkMatch(m);
    this.matches.set(m.id, this.clone(m));
    this.locked.add(`match:${m.id}`);
  }
  async updateMatch(tid: string, id: string, patch: RbMatchPatch) {
    this.requireLock("match", id);
    const next = { ...(this.matches.get(id) as RbMatch), ...this.clone(patch) };
    this.checkMatch(next);
    this.matches.set(id, next);
  }
  async deleteRoundMatches(tid: string, roundId: string) {
    for (const m of [...this.matches.values()].filter((x) => x.round_id === roundId)) {
      this.requireLock("match", m.id);
      this.matches.delete(m.id);
    }
  }
  async writeAudit(tournamentId: string, action: RbAuditAction, detail: Record<string, unknown> | null, actor: RbActor) {
    if (!actor?.discordId?.trim() || !actor?.name?.trim()) throw new Error("audit without actor");
    this.audits.push({ tournamentId, action, detail: this.clone(detail), actor: { ...actor }, call: this.call });
  }

  full(tid: string): RbTournamentFull {
    const num = (m: RbMatch) => this.rounds.get(m.round_id)?.number ?? 0;
    return this.clone({
      tournament: this.tournaments.get(tid) as RbTournament,
      players: [...this.players.values()].filter((p) => p.tournament_id === tid),
      rounds: [...this.rounds.values()].filter((r) => r.tournament_id === tid).sort((a, b) => a.number - b.number),
      matches: [...this.matches.values()]
        .filter((m) => m.tournament_id === tid)
        .sort((a, b) => num(a) - num(b) || a.table_number - b.table_number),
    });
  }
}

