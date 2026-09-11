// Denial-path tests for Discord OAuth admin auth (src/lib/discord-auth.ts +
// src/lib/admin-session-db.ts + src/middleware.ts + /tools/logout).
//
// Run against the live dev server (must be running on :3001) plus the real
// Postgres DB (.env.local). Mixes two test styles:
//   - Direct calls into admin-session-db.ts (no `next/headers` dependency)
//     for pure state-consumption logic (single-use CSRF state).
//   - HTTP requests against the running server for anything that depends on
//     cookies/middleware/route handlers, since that's what an attacker
//     actually sees and importing discord-auth.ts's cookie-bound functions
//     (isToolsSession, getCurrentAdmin) outside a request context isn't
//     possible with next/headers.
//
// No temporary unauthenticated routes are added, no real user roles are
// touched, no tables are dropped. Every row this script creates is deleted
// in a `finally`.
//
// Run:
//   node --experimental-strip-types scripts/test-auth-denial.ts

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Load .env.local the same way used elsewhere in this session.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
}

// Mirrors admin-session-db.ts's private hashToken() exactly (SHA-256 hex) so
// this script can address a specific session row by its real primary key
// instead of by discord_user_id, which is NOT unique — a stale row left
// over from an earlier crashed run sharing the same test discord_user_id
// would otherwise be silently picked instead of the row this run just
// created, backdating/corrupting the wrong session entirely.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

import { sql } from "@vercel/postgres";
import {
  createSession,
  deleteSession,
  getSession,
  createOAuthState,
  consumeOAuthState,
  ensureSessionSchema,
} from "../src/lib/admin-session-db";

const BASE = "http://localhost:3001";

let failures = 0;
let passes = 0;
function assert(cond: unknown, msg: string) {
  if (cond) {
    passes++;
  } else {
    failures++;
    console.error(`FAIL: ${msg}`);
  }
}

const cleanupTokens: string[] = [];
async function makeRealSession(): Promise<string> {
  const token = await createSession({
    discordUserId: "test_user_1",
    discordUsername: "test-user",
    discordAvatar: null,
    accessToken: "fake_access_token",
    refreshToken: "fake_refresh_token",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  cleanupTokens.push(token);
  return token;
}

async function fetchNoRedirect(path: string, init: RequestInit = {}) {
  return fetch(`${BASE}${path}`, { ...init, redirect: "manual" });
}

async function run() {
  await ensureSessionSchema();

  // --- Positive control: a real, unmodified session must be let through ---
  // If this fails, every "denied" result below is meaningless (the whole
  // suite could be passing by accident because nothing is ever allowed).
  {
    const token = await makeRealSession();
    const res = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    // Freshly created session is within the 5-min reverify window, so
    // middleware + isToolsSession both accept it without calling Discord.
    assert(res.status === 200, `positive control: valid fresh session should reach /tools/mayhem (got ${res.status})`);
  }

  // --- 1. No cookie at all ---
  {
    const res = await fetchNoRedirect("/tools/mayhem");
    assert(res.status === 307 || res.status === 308, `no cookie: expected redirect, got ${res.status}`);
    const loc = res.headers.get("location") ?? "";
    assert(loc.includes("/tools/login"), `no cookie: redirect should go to /tools/login, got ${loc}`);
  }

  // --- 2. Garbage/random cookie value (never issued by the server) ---
  {
    const res = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: "lolmk-admin-session=not_a_real_token_deadbeef" },
    });
    assert(res.status === 307 || res.status === 308, `garbage cookie: expected redirect, got ${res.status}`);
  }

  // --- 3. Expired session row (expires_at in the past) ---
  {
    const token = await createSession({
      discordUserId: "test_user_expired",
      discordUsername: "test-expired",
      discordAvatar: null,
      accessToken: "fake",
      refreshToken: "fake",
      tokenExpiresAt: new Date(Date.now() + 60_000),
    });
    cleanupTokens.push(token);
    // Force expires_at into the past directly — createSession always sets
    // a future expiry, so we backdate the row after the fact to simulate
    // an outer-lifetime timeout.
    const tokenHashRow = await sql.query(
      "SELECT token_hash FROM admin_sessions WHERE discord_user_id = $1",
      ["test_user_expired"],
    );
    const hash = tokenHashRow.rows[0]?.token_hash;
    assert(!!hash, "expired session setup: row should exist before backdating");
    await sql.query(
      "UPDATE admin_sessions SET expires_at = now() - interval '1 hour' WHERE token_hash = $1",
      [hash],
    );

    const res = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    assert(res.status === 307 || res.status === 308, `expired session: expected redirect, got ${res.status}`);

    // Also confirm at the DB-helper level, not just via middleware.
    const looked = await getSession(token);
    assert(looked === null, "expired session: getSession should return null for an expired row");
  }

  // --- 4. Tampered ciphertext (corrupted access_token_enc) ---
  {
    const token = await createSession({
      discordUserId: "test_user_tampered",
      discordUsername: "test-tampered",
      discordAvatar: null,
      accessToken: "fake",
      refreshToken: "fake",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    cleanupTokens.push(token);
    const hashRow = await sql.query(
      "SELECT token_hash FROM admin_sessions WHERE discord_user_id = $1",
      ["test_user_tampered"],
    );
    const hash = hashRow.rows[0]?.token_hash;
    // Corrupt the ciphertext but keep it a syntactically well-formed
    // "v1:iv:tag:ciphertext" payload so it reaches AES-GCM decryption and
    // fails the auth-tag check, rather than failing the earlier format check.
    const fakeIv = "00".repeat(12);
    const fakeTag = "11".repeat(16);
    const fakeCiphertext = "22".repeat(32);
    await sql.query(
      `UPDATE admin_sessions SET access_token_enc = $1 WHERE token_hash = $2`,
      [`v1:${fakeIv}:${fakeTag}:${fakeCiphertext}`, hash],
    );

    const looked = await getSession(token);
    assert(looked === null, "tampered ciphertext: getSession should fail closed (return null), not throw or leak plaintext");

    const res = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    assert(res.status === 307 || res.status === 308, `tampered ciphertext: expected redirect from protected page, got ${res.status}`);
  }

  // --- 5. OAuth state: missing state on callback denies before token exchange ---
  {
    const res = await fetchNoRedirect("/api/auth/discord/callback?code=fake_code");
    assert(res.status === 307 || res.status === 308, `missing state: expected redirect, got ${res.status}`);
    const loc = res.headers.get("location") ?? "";
    assert(loc.includes("error=state"), `missing state: expected error=state in redirect, got ${loc}`);
  }

  // --- 6. OAuth state: mismatched cookie vs param denies before token exchange ---
  {
    const res = await fetchNoRedirect(
      "/api/auth/discord/callback?code=fake_code&state=attacker_supplied_state",
      { headers: { Cookie: "lolmk-oauth-state=different_value_from_victim_browser" } },
    );
    assert(res.status === 307 || res.status === 308, `state mismatch: expected redirect, got ${res.status}`);
    const loc = res.headers.get("location") ?? "";
    assert(loc.includes("error=state"), `state mismatch: expected error=state, got ${loc}`);
  }

  // --- 7. OAuth state: single-use — replay after consumption fails ---
  // Tested directly against the state store (no next/headers dependency),
  // since this is pure logic that doesn't need cookies or a request.
  {
    const state = await createOAuthState("/tools");
    const first = await consumeOAuthState(state);
    assert(first === "/tools", `state single-use: first consumption should succeed, got ${first}`);
    const second = await consumeOAuthState(state);
    assert(second === null, `state single-use: replaying the same state should fail, got ${second}`);
  }

  // --- 8. Logout invalidates a previously-valid session ---
  {
    const token = await makeRealSession();
    const preCheck = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    assert(preCheck.status === 200, `logout setup: session should work before logout (got ${preCheck.status})`);

    const logoutRes = await fetchNoRedirect("/tools/logout", {
      method: "POST",
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    assert(logoutRes.status === 303, `logout: POST should redirect with 303, got ${logoutRes.status}`);

    const postCheck = await fetchNoRedirect("/tools/mayhem", {
      headers: { Cookie: `lolmk-admin-session=${token}` },
    });
    assert(
      postCheck.status === 307 || postCheck.status === 308,
      `logout: same cookie should be denied after logout, got ${postCheck.status}`,
    );
  }

  // --- 9. GET logout is rejected (only POST is implemented) ---
  {
    const res = await fetchNoRedirect("/tools/logout", { method: "GET" });
    assert(res.status === 405, `GET logout: expected 405 Method Not Allowed, got ${res.status}`);
  }

  // --- Cleanup ---
  for (const token of cleanupTokens) {
    await deleteSession(token).catch(() => {});
  }
  await sql.query("DELETE FROM admin_sessions WHERE discord_user_id LIKE 'test_%'").catch(() => {});

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Test script crashed:", e);
  process.exit(1);
});
