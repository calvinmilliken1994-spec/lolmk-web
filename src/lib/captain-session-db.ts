import { sql } from "@vercel/postgres";
import { createHash } from "node:crypto";
import { decryptField, encryptField, randomToken } from "@/lib/admin-session-db";

/**
 * Team-captain session store — a SEPARATE table and a SEPARATE cookie from
 * the admin session store in admin-session-db.ts.
 *
 * This separation is the whole security design, so it is worth spelling out
 * why a shared table with a "role" column would have been wrong:
 *
 * `isToolsSession()` short-circuits and returns true WITHOUT re-checking
 * Discord whenever a session was verified within the last REVERIFY_INTERVAL_MS
 * (5 minutes). That is a deliberate, sensible cache — but it means the mere
 * EXISTENCE of a row in `admin_sessions` grants admin access for up to five
 * minutes. If captains were issued rows in that same table, every captain
 * would hold admin rights during their session's cache window. Adding a
 * capability column would work only if every read path checked it correctly
 * forever; a different table cannot be got wrong by omission.
 *
 * So: captains authenticate through their own OAuth callback, receive their
 * own `lolmk-captain-session` cookie, and land in `captain_sessions`. There
 * is no code path by which a captain session satisfies the admin gate, and
 * no code path by which an admin session satisfies the captain gate — an
 * admin who also wants to manage a team signs in on both.
 *
 * Encryption of the stored Discord tokens reuses admin-session-db's
 * AES-256-GCM helpers (same SESSION_ENCRYPTION_KEY); that is key material,
 * not authorization, and duplicating the crypto would only add a second
 * place to get it wrong.
 */

let schemaReady: Promise<void> | null = null;

export function ensureCaptainSessionSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS captain_sessions (
          token_hash text PRIMARY KEY,
          discord_user_id text NOT NULL,
          discord_username text NOT NULL,
          discord_avatar text,
          access_token_enc text NOT NULL,
          refresh_token_enc text NOT NULL,
          token_expires_at timestamptz NOT NULL,
          last_verified_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS captain_sessions_expires_idx ON captain_sessions(expires_at);`;
      await sql`
        CREATE TABLE IF NOT EXISTS captain_oauth_states (
          state_hash text PRIMARY KEY,
          next_path text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CaptainSession {
  tokenHash: string;
  discordUserId: string;
  discordUsername: string;
  discordAvatar: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h, same outer bound as admin sessions

export async function createCaptainSession(input: {
  discordUserId: string;
  discordUsername: string;
  discordAvatar: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<string> {
  await ensureCaptainSessionSchema();
  const token = randomToken();
  await sql`
    INSERT INTO captain_sessions
      (token_hash, discord_user_id, discord_username, discord_avatar, access_token_enc, refresh_token_enc, token_expires_at, expires_at)
    VALUES (
      ${hashToken(token)}, ${input.discordUserId}, ${input.discordUsername}, ${input.discordAvatar},
      ${encryptField(input.accessToken)}, ${encryptField(input.refreshToken)}, ${input.tokenExpiresAt.toISOString()},
      now() + interval '1 second' * ${SESSION_MAX_AGE_SECONDS}
    )
  `;
  return token;
}

export async function getCaptainSessionByToken(rawToken: string): Promise<CaptainSession | null> {
  await ensureCaptainSessionSchema();
  const { rows } = await sql`
    SELECT * FROM captain_sessions WHERE token_hash = ${hashToken(rawToken)} AND expires_at > now()
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  try {
    return {
      tokenHash: r.token_hash,
      discordUserId: r.discord_user_id,
      discordUsername: r.discord_username,
      discordAvatar: r.discord_avatar,
      accessToken: decryptField(r.access_token_enc),
      refreshToken: decryptField(r.refresh_token_enc),
      tokenExpiresAt: new Date(r.token_expires_at),
      lastVerifiedAt: new Date(r.last_verified_at),
      expiresAt: new Date(r.expires_at),
    };
  } catch {
    return null;
  }
}

export async function touchCaptainVerified(tokenHash: string): Promise<void> {
  await sql`UPDATE captain_sessions SET last_verified_at = now() WHERE token_hash = ${tokenHash}`;
}

export async function updateCaptainTokens(input: {
  tokenHash: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<void> {
  await sql`
    UPDATE captain_sessions SET
      access_token_enc = ${encryptField(input.accessToken)},
      refresh_token_enc = ${encryptField(input.refreshToken)},
      token_expires_at = ${input.tokenExpiresAt.toISOString()}
    WHERE token_hash = ${input.tokenHash}
  `;
}

export async function deleteCaptainSessionByHash(tokenHash: string): Promise<void> {
  await ensureCaptainSessionSchema();
  await sql`DELETE FROM captain_sessions WHERE token_hash = ${tokenHash}`;
}

export async function deleteCaptainSession(rawToken: string): Promise<void> {
  await deleteCaptainSessionByHash(hashToken(rawToken));
}

export async function createCaptainOAuthState(nextPath: string): Promise<string> {
  await ensureCaptainSessionSchema();
  const state = randomToken();
  await sql`
    INSERT INTO captain_oauth_states (state_hash, next_path) VALUES (${hashToken(state)}, ${nextPath})
  `;
  return state;
}

export async function consumeCaptainOAuthState(state: string): Promise<string | null> {
  await ensureCaptainSessionSchema();
  const { rows } = await sql`
    DELETE FROM captain_oauth_states
    WHERE state_hash = ${hashToken(state)} AND created_at > now() - interval '15 minutes'
    RETURNING next_path
  `;
  return rows[0]?.next_path ?? null;
}

export async function sweepExpiredCaptainSessions(): Promise<void> {
  await ensureCaptainSessionSchema();
  await sql`DELETE FROM captain_sessions WHERE expires_at <= now()`;
  await sql`DELETE FROM captain_oauth_states WHERE created_at <= now() - interval '15 minutes'`;
}
