// Runs the actual delete Server Action against isolated, in-memory PostgreSQL.
// Auth and Next.js cache invalidation are stubbed; no live DB or credentials.
// Run: node scripts/test-sr-tournament-delete.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const schema = readFileSync("src/lib/sr-db.ts", "utf8");
const types = readFileSync("src/types/sr-tournament.ts", "utf8");
const bounds = Object.fromEntries(["MIN_TEAMS", "MAX_TEAMS"].map((key) => [
  key, types.match(new RegExp(`export const SR_${key} = (\\d+);`))[1],
]));
const invalidations = [];
const client = {
  query: (text, params) => db.query(text, params),
  sql: (parts, ...params) => client.query(parts.reduce(
    (text, part, i) => text + (i ? `$${i}` : "") + part, "",
  ), params),
  release() {},
};
const dependencies = {
  "@vercel/postgres": { sql: { connect: async () => client } },
  "next/cache": { revalidatePath: (path) => invalidations.push(path) },
  "@/lib/tools-auth": {
    isToolsSession: async () => true,
    getCurrentAdmin: async () => ({ discordUserId: "test-admin", username: "Test" }),
  },
};
const source = readFileSync("src/app/tools/summoners-rift/actions.ts", "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const exports = {};
runInNewContext(outputText, { exports, require: (name) => dependencies[name] ?? {} });

try {
  // Reuse production DDL, including CHECKs, RESTRICT FKs and cascade order.
  for (const match of schema.matchAll(/CREATE TABLE IF NOT EXISTS sr_(?:tournaments|teams|matches|audit_log) \([\s\S]*?\n\s*\);/g)) {
    await db.exec(match[0].replace(/\$\{(MIN_TEAMS|MAX_TEAMS)\}/g, (_, key) => bounds[key]));
  }
  await db.exec(schema.match(/ALTER TABLE sr_tournaments ADD COLUMN IF NOT EXISTS active_match_id text/)[0]);
  for (const name of ["champion_same_tournament", "active_match"]) {
    const ddl = schema.match(new RegExp(
      `ALTER TABLE sr_tournaments\\s+ADD CONSTRAINT sr_tournaments_${name}_fkey[\\s\\S]*?(?=\x60)`,
    ));
    assert.ok(ddl, `Production ${name} FK must be included`);
    await db.exec(ddl[0]);
  }

  await db.query("INSERT INTO sr_tournaments (id, slug, name) VALUES ('completed', 'completed-test', 'Test')");
  await db.query("INSERT INTO sr_teams (id, tournament_id, name) VALUES ('champion', 'completed', 'Champion'), ('runner-up', 'completed', 'Runner-up')");
  await db.query(`INSERT INTO sr_matches
    (id, tournament_id, bracket, round_number, match_number, team_a_id, team_b_id, winner_id, status)
    VALUES ('final', 'completed', 'upper', 1, 1, 'champion', 'runner-up', 'champion', 'completed')`);
  await db.query("INSERT INTO sr_audit_log (tournament_id, action) VALUES ('completed', 'test')");
  await db.query("UPDATE sr_tournaments SET status = 'completed', champion_team_id = 'champion', active_match_id = 'final' WHERE id = 'completed'");

  try {
    await exports.deleteTournament("completed");
  } catch (error) {
    throw new Error(`Completed tournament deletion failed: ${error.message}`);
  }
  for (const table of ["sr_tournaments", "sr_teams", "sr_matches", "sr_audit_log"]) {
    const { rows } = await db.query(`SELECT count(*)::int AS count FROM ${table}`);
    assert.equal(rows[0].count, 0, `${table} must be emptied by deletion`);
  }
  assert.ok(invalidations.includes("/tournaments/summoners-rift/completed-test"));
  console.log("PASS: completed tournament, champion, active match and audit entries deleted.");

  for (const status of ["draft", "seeding", "bracket_published", "in_progress", "archived"]) {
    await db.query("INSERT INTO sr_tournaments (id, slug, name, status) VALUES ($1, $1, 'Test', $1)", [status]);
    invalidations.length = 0;
    await exports.deleteTournament(status);
    assert.equal((await db.query("SELECT id FROM sr_tournaments WHERE id = $1", [status])).rows.length, 0);
    assert.ok(invalidations.includes(`/tournaments/summoners-rift/${status}`));
  }
  console.log("PASS: all non-completed statuses delete and invalidate their public route.");

  invalidations.length = 0;
  await assert.rejects(exports.deleteTournament("missing"), /Tournament not found/);
  assert.equal(invalidations.length, 0);
  console.log("PASS: missing tournament is rejected without cache invalidation.");

  await db.query("INSERT INTO sr_tournaments (id, slug, name) VALUES ('rollback', 'rollback-test', 'Test')");
  await db.query("INSERT INTO sr_teams (id, tournament_id, name) VALUES ('rollback-champion', 'rollback', 'Champion')");
  await db.query("UPDATE sr_tournaments SET status = 'completed', champion_team_id = 'rollback-champion' WHERE id = 'rollback'");
  const query = client.query;
  client.query = async (text, params) => {
    if (text.includes("DELETE FROM sr_tournaments")) throw new Error("Injected deletion failure");
    return query(text, params);
  };
  try {
    await assert.rejects(exports.deleteTournament("rollback"), /Injected deletion failure/);
  } finally {
    client.query = query;
  }
  const { rows: restored } = await db.query("SELECT status, champion_team_id FROM sr_tournaments WHERE id = 'rollback'");
  assert.deepEqual(restored, [{ status: "completed", champion_team_id: "rollback-champion" }]);
  assert.equal(invalidations.length, 0);
  console.log("PASS: deletion failure rolls back status and champion without cache invalidation.");

  dependencies["@/lib/tools-auth"].isToolsSession = async () => false;
  await assert.rejects(exports.deleteTournament("rollback"), /Not authorized/);
  assert.equal((await db.query("SELECT id FROM sr_tournaments WHERE id = 'rollback'")).rows.length, 1);
  assert.equal(invalidations.length, 0);
  console.log("PASS: unauthenticated deletion is denied and leaves the tournament intact.");
} finally {
  await db.close();
}
