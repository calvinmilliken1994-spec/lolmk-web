import { sql } from "@vercel/postgres";
import { randomBytes, createHash, createCipheriv, createDecipheriv } from "node:crypto";

/**
 * Discord OAuth admin session store (Vercel Postgres).
 *
 * Sessions are opaque, random, server-side tokens. The browser cookie holds
 * the raw token; only its SHA-256 hash is ever stored or looked up in
 * Postgres (token_hash is the primary key, not the token itself) — a DB
 * leak alone does not hand out valid session cookies.
 *
 * Discord access/refresh tokens are stored AES-256-GCM encrypted, keyed by
 * SESSION_ENCRYPTION_KEY (a 32-byte key, separate from DISCORD_CLIENT_SECRET
 * so rotating one doesn't force rotating the other). A DB leak alone does
 * not hand out working Discord tokens either — though note this protects
 * against DB-only compromise, not compromise of the running app + its env,
 * which could decrypt everything.
 */

let schemaReady: Promise<void> | null = null;

export function ensureSessionSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS admin_sessions (
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
      await sql`CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);`;
      await sql`
        CREATE TABLE IF NOT EXISTS admin_oauth_states (
          state_hash text PRIMARY KEY,
          next_path text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        );
      `;
    })().catch((e) => {
      schemaReady = null; // let the next call retry instead of caching a failure forever
      throw e;
    });
  }
  return schemaReady;
}

// ---------------------------------------------------------------------------
// Token generation / hashing
// ---------------------------------------------------------------------------

export function randomToken(): string {
  return randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---------------------------------------------------------------------------
// Encryption for Discord access/refresh tokens at rest
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  const raw = process.env.SESSION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      "SESSION_ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32` and add it to .env.local.",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("SESSION_ENCRYPTION_KEY must be 32 bytes (64 hex chars) — generate with `openssl rand -hex 32`.");
  }
  return key;
}

const ENC_VERSION = "v1";

function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, iv.toString("hex"), tag.toString("hex"), ciphertext.toString("hex")].join(":");
}

function decrypt(payload: string): string {
  const [version, ivHex, tagHex, ciphertextHex] = payload.split(":");
  if (version !== ENC_VERSION || !ivHex || !tagHex || !ciphertextHex) {
    throw new Error("Malformed encrypted token payload.");
  }
  const key = getEncryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(), // throws on tag mismatch — tampered/corrupted ciphertext is rejected, not silently returned
  ]);
  return plaintext.toString("utf8");
}

// Exported so discord-auth.ts's row-locked refresh transaction (which reads/writes
// admin_sessions via a single checked-out client, not the module-level `sql` tag)
// can encrypt/decrypt fields itself instead of going through the sql-tag-based
// helpers here, which would use a different connection and defeat the lock.
export const encryptField = encrypt;
export const decryptField = decrypt;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface AdminSession {
  /** Raw token as presented by the caller — NOT stored; used only to derive tokenHash for lookups by the caller of getSession. */
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

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h outer lifetime — re-verification against
// Discord (REVERIFY_INTERVAL_MS in discord-auth.ts) happens far more often than this within
// that window; this just bounds how long a session can exist at all before requiring a fresh login.

/** Creates a session, returns the RAW token — caller sets this in the cookie, never persists it. */
export async function createSession(input: {
  discordUserId: string;
  discordUsername: string;
  discordAvatar: string | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<string> {
  await ensureSessionSchema();
  const token = randomToken();
  const tokenHash = hashToken(token);
  await sql`
    INSERT INTO admin_sessions
      (token_hash, discord_user_id, discord_username, discord_avatar, access_token_enc, refresh_token_enc, token_expires_at, expires_at)
    VALUES (
      ${tokenHash}, ${input.discordUserId}, ${input.discordUsername}, ${input.discordAvatar},
      ${encrypt(input.accessToken)}, ${encrypt(input.refreshToken)}, ${input.tokenExpiresAt.toISOString()},
      now() + interval '1 second' * ${SESSION_MAX_AGE_SECONDS}
    )
  `;
  return token;
}

/** Looks up a session by the RAW token from the cookie; hashes it before the DB query. */
export async function getSession(rawToken: string): Promise<AdminSession | null> {
  const tokenHash = hashToken(rawToken);
  return getSessionByHash(tokenHash);
}

/** Looks up a session directly by its already-computed hash — used when only the
 * hash is on hand (e.g. re-reading current DB state from within reverifySession,
 * which never has the raw token: AdminSession never carries it). */
export async function getSessionByHash(tokenHash: string): Promise<AdminSession | null> {
  await ensureSessionSchema();
  const { rows } = await sql`
    SELECT * FROM admin_sessions WHERE token_hash = ${tokenHash} AND expires_at > now()
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  try {
    return {
      tokenHash: r.token_hash,
      discordUserId: r.discord_user_id,
      discordUsername: r.discord_username,
      discordAvatar: r.discord_avatar,
      accessToken: decrypt(r.access_token_enc),
      refreshToken: decrypt(r.refresh_token_enc),
      tokenExpiresAt: new Date(r.token_expires_at),
      lastVerifiedAt: new Date(r.last_verified_at),
      expiresAt: new Date(r.expires_at),
    };
  } catch {
    // Decryption failure (corrupted row, tampered ciphertext, or key rotated
    // without a migration) — treat as no valid session rather than throwing
    // out of an auth check.
    return null;
  }
}

export async function touchSessionVerified(
  tokenHash: string,
  update?: { accessToken: string; refreshToken: string; tokenExpiresAt: Date; bumpVerifiedAt?: boolean },
): Promise<void> {
  if (update) {
    const bump = update.bumpVerifiedAt !== false;
    if (bump) {
      await sql`
        UPDATE admin_sessions SET
          last_verified_at = now(),
          access_token_enc = ${encrypt(update.accessToken)},
          refresh_token_enc = ${encrypt(update.refreshToken)},
          token_expires_at = ${update.tokenExpiresAt.toISOString()}
        WHERE token_hash = ${tokenHash}
      `;
    } else {
      await sql`
        UPDATE admin_sessions SET
          access_token_enc = ${encrypt(update.accessToken)},
          refresh_token_enc = ${encrypt(update.refreshToken)},
          token_expires_at = ${update.tokenExpiresAt.toISOString()}
        WHERE token_hash = ${tokenHash}
      `;
    }
  } else {
    await sql`UPDATE admin_sessions SET last_verified_at = now() WHERE token_hash = ${tokenHash}`;
  }
}

export async function deleteSessionByHash(tokenHash: string): Promise<void> {
  await ensureSessionSchema();
  await sql`DELETE FROM admin_sessions WHERE token_hash = ${tokenHash}`;
}

export async function deleteSession(rawToken: string): Promise<void> {
  await deleteSessionByHash(hashToken(rawToken));
}

export async function sweepExpired(): Promise<void> {
  await ensureSessionSchema();
  await sql`DELETE FROM admin_sessions WHERE expires_at <= now()`;
  await sql`DELETE FROM admin_oauth_states WHERE created_at <= now() - interval '15 minutes'`;
}

// ---------------------------------------------------------------------------
// OAuth `state` — CSRF protection for the redirect round-trip.
//
// Browser-bound, not just single-use: the raw state value is split into two
// halves that travel by different channels — one half in the `state` query
// param that round-trips through Discord, the other half in a short-lived
// HttpOnly cookie set on the SAME response that starts the redirect. The
// callback must present a cookie whose value matches what was issued
// alongside that specific state, or the exchange is rejected before any
// code is redeemed. This is what makes it CSRF protection rather than mere
// replay protection: an attacker who tricks a victim into visiting a
// forged callback URL (with a state value the attacker generated
// themselves via their own login attempt) does not have the victim's
// state-linked cookie, so the mismatch is caught even though the state
// value itself would otherwise look "valid" (unexpired, unused, present in
// the DB).
// ---------------------------------------------------------------------------

export async function createOAuthState(nextPath: string): Promise<string> {
  await ensureSessionSchema();
  const state = randomToken();
  const stateHash = hashToken(state);
  await sql`INSERT INTO admin_oauth_states (state_hash, next_path) VALUES (${stateHash}, ${nextPath})`;
  return state; // raw value: half goes in the state param, caller also cookies it
}

export async function consumeOAuthState(state: string): Promise<string | null> {
  await ensureSessionSchema();
  const stateHash = hashToken(state);
  const { rows } = await sql`
    DELETE FROM admin_oauth_states
    WHERE state_hash = ${stateHash} AND created_at > now() - interval '15 minutes'
    RETURNING next_path
  `;
  return rows[0]?.next_path ?? null;
}
