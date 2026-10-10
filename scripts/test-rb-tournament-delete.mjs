// Actual Riftbound Server Actions, service, store and schema on isolated PostgreSQL.
// Only Discord auth and Next cache invalidation are stubbed. No production DB.
// Run: node scripts/test-rb-tournament-delete.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { PGlite } from "@electric-sql/pglite";
import ts from "typescript";

const db = new PGlite();
const invalidations = [];
let authorized = true;
let failDelete = false;
const client = {
  async query(text, params) {
    if (failDelete && text.includes("DELETE FROM rb_tournaments")) throw new Error("Injected deletion failure");
    return db.query(text, params);
  },
  sql(parts, ...params) {
    return this.query(parts.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, ""), params);
  },
  release() {},
};
const sql = client.sql.bind(client);
sql.query = client.query.bind(client);
sql.connect = async () => client;
const dependencies = {
  "@vercel/postgres": { sql },
  "next/cache": { revalidatePath: (url) => invalidations.push(url) },
  "@/lib/tools-auth": {
    isToolsSession: async () => authorized,
    getCurrentAdmin: async () => ({ discordUserId: "test-admin", username: "Test" }),
  },
};
const cache = new Map();
const nativeRequire = createRequire(import.meta.url);
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(outputText, {
    exports, Date, console, process,
    require(name) {
      if (dependencies[name]) return dependencies[name];
      if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
      if (name.startsWith(".")) return load(path.resolve(path.dirname(file), `${name}.ts`));
      return nativeRequire(name);
    },
  });
  return exports;
}
const actions = load("src/app/tools/riftbound/actions.ts");
const reads = load("src/lib/rb-db.ts");

async function seed(id, status = "completed") {
  await db.query("INSERT INTO rb_tournaments (id, slug, name) VALUES ($1, $1, 'Test')", [id]);
  await db.query("INSERT INTO rb_players (id, tournament_id, display_name) VALUES ($1, $2, 'Champion'), ($3, $2, 'Runner-up')", [`${id}-a`, id, `${id}-b`]);
  await db.query("INSERT INTO rb_rounds (id, tournament_id, number, status) VALUES ($1, $2, 1, 'closed')", [`${id}-round`, id]);
  await db.query(`INSERT INTO rb_matches
    (id, tournament_id, round_id, table_number, player_a, player_b, status, reported_by_id, reported_by_name, reported_at)
    VALUES ($1, $2, $3, 1, $4, $5, 'completed', 'test-admin', 'Test', now())`,
  [`${id}-match`, id, `${id}-round`, `${id}-a`, `${id}-b`]);
  await db.query("INSERT INTO rb_audit_log (tournament_id, action, actor_discord_id, actor_name) VALUES ($1, 'test', 'test-admin', 'Test')", [id]);
  await db.query("UPDATE rb_tournaments SET status = $1, champion_player_id = $2 WHERE id = $3", [status, `${id}-a`, id]);
}
async function counts(id) {
  return Promise.all(["rb_tournaments", "rb_players", "rb_rounds", "rb_matches", "rb_audit_log"].map(async (table) => {
    const { rows } = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE ${table === "rb_tournaments" ? "id" : "tournament_id"} = $1`, [id]);
    return rows[0].count;
  }));
}

try {
  assert.equal(typeof actions.deleteEvent, "function", "Riftbound must expose an authenticated Delete action");
  await reads.ensureSchema();
  await seed("keep");
  await seed("remove");
  assert.equal((await actions.deleteEvent("remove")).ok, true);
  assert.deepEqual(await counts("remove"), [0, 0, 0, 0, 0]);
  assert.deepEqual(await counts("keep"), [1, 2, 1, 1, 1]);
  assert.ok(invalidations.includes("/tools/riftbound/remove"));
  assert.ok(invalidations.includes("/tournaments"));
  console.log("PASS: completed event deletion satisfies CHECK/RESTRICT constraints and leaves other events intact.");

  assert.equal((await actions.archiveEvent("keep")).ok, true);
  assert.deepEqual(await counts("keep"), [1, 2, 1, 1, 2]);
  assert.equal((await db.query("SELECT status FROM rb_tournaments WHERE id = 'keep'")).rows[0].status, "archived");
  assert.equal((await reads.listChampionEvents()).length, 1);
  assert.equal((await reads.listTournaments()).length, 0);
  assert.equal((await reads.listTournaments(true)).length, 1);
  assert.equal((await actions.deleteEvent("keep")).ok, true);
  assert.deepEqual(await counts("keep"), [0, 0, 0, 0, 0]);
  console.log("PASS: archive preserves records and champion history; archived events can be permanently deleted.");

  for (const status of ["draft", "registration", "in_progress"]) {
    await seed(status, status);
    assert.equal((await actions.deleteEvent(status)).ok, true);
    assert.deepEqual(await counts(status), [0, 0, 0, 0, 0]);
  }
  console.log("PASS: draft, check-in and in-progress events can be deleted explicitly.");

  invalidations.length = 0;
  const missing = await actions.deleteEvent("missing");
  assert.equal(missing.ok, false);
  assert.equal(missing.error, "Tournament not found.");
  assert.equal(invalidations.length, 0);
  await seed("rollback");
  failDelete = true;
  await assert.rejects(actions.deleteEvent("rollback"), /Injected deletion failure/);
  failDelete = false;
  assert.deepEqual(await counts("rollback"), [1, 2, 1, 1, 1]);
  const { rows: restored } = await db.query("SELECT status, champion_player_id FROM rb_tournaments WHERE id = 'rollback'");
  assert.deepEqual(restored, [{ status: "completed", champion_player_id: "rollback-a" }]);
  assert.equal(invalidations.length, 0);
  console.log("PASS: missing event errors stay readable; failed deletion rolls back all cleanup.");

  authorized = false;
  const denied = await actions.deleteEvent("rollback");
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "Not authorized.");
  assert.deepEqual(await counts("rollback"), [1, 2, 1, 1, 1]);
  assert.equal(invalidations.length, 0);
  console.log("PASS: unauthenticated deletion is denied before any writes.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
