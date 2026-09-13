import { sql } from "@vercel/postgres";
import { createHash } from "node:crypto";
import { decryptField, encryptField, randomToken } from "@/lib/admin-session-db";

/**
 * Verified-member session store — a SEPARATE table and SEPARATE cookie from
 * both admin_sessions and captain_sessions, for the exact reason
 * captain-session-db.ts documents at length: isToolsSession() trusts mere
 * row-existence in admin_sessions for up to REVERIFY_INTERVAL_MS, so a
 * member must never be able to land a row there. A member session grants
 * nothing under /tools and nothing under /captain.
 *
 * Unlike the admin/captain session which only ever represents ONE role, a
 * member session's holder may or may not also be an admin — `is_admin` is
 * cached here (refreshed on every reverify, same cadence as the role check
 * itself) purely so the UI can show the "Admin Tools" nav entry without an
 * extra round trip. It is NOT an authorization signal: nothing under
 * /tools reads this column, and getCurrentAdmin()/isToolsSession() in
 * discord-auth.ts are completely unaffected by anything in this file.
 */

let schemaReady: Promise<void> | null = null;

export function ensureMemberSessionSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS member_sessions (
          token_hash text PRIMARY KEY,
          discord_user_id text NOT NULL,
          display_name text NOT NULL,
          avatar_url text,
          is_admin boolean NOT NULL DEFAULT false,
          directory_category text,
          access_token_enc text NOT NULL,
          refresh_token_enc text NOT NULL,
          token_expires_at timestamptz NOT NULL,
          last_verified_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          expires_at timestamptz NOT NULL,
          CONSTRAINT member_sessions_directory_category_check
            CHECK (directory_category IS NULL OR directory_category IN ('admin','coordinator'))
        );
      `;
      await sql`CREATE INDEX IF NOT EXISTS member_sessions_expires_idx ON member_sessions(expires_at);`;
      await sql`
        CREATE TABLE IF NOT EXISTS member_oauth_states (
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

export interface MemberSession {
  tokenHash: string;
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  directoryCategory: "admin" | "coordinator" | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  lastVerifiedAt: Date;
  expiresAt: Date;
}

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h, same outer bound as admin/captain sessions

export async function createMemberSession(input: {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  directoryCategory: "admin" | "coordinator" | null;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<string> {
  await ensureMemberSessionSchema();
  const token = randomToken();
  await sql`
    INSERT INTO member_sessions
      (token_hash, discord_user_id, display_name, avatar_url, is_admin, directory_category,
       access_token_enc, refresh_token_enc, token_expires_at, expires_at)
    VALUES (
      ${hashToken(token)}, ${input.discordUserId}, ${input.displayName}, ${input.avatarUrl},
      ${input.isAdmin}, ${input.directoryCategory},
      ${encryptField(input.accessToken)}, ${encryptField(input.refreshToken)}, ${input.tokenExpiresAt.toISOString()},
      now() + interval '1 second' * ${SESSION_MAX_AGE_SECONDS}
    )
  `;
  return token;
}

export async function getMemberSessionByToken(rawToken: string): Promise<MemberSession | null> {
  await ensureMemberSessionSchema();
  const { rows } = await sql`
    SELECT * FROM member_sessions WHERE token_hash = ${hashToken(rawToken)} AND expires_at > now()
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  try {
    return {
      tokenHash: r.token_hash,
      discordUserId: r.discord_user_id,
      displayName: r.display_name,
      avatarUrl: r.avatar_url,
      isAdmin: r.is_admin,
      directoryCategory: r.directory_category,
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

export async function touchMemberVerified(
  tokenHash: string,
  update?: {
    displayName: string;
    avatarUrl: string | null;
    isAdmin: boolean;
    directoryCategory: "admin" | "coordinator" | null;
  },
): Promise<void> {
  if (update) {
    await sql`
      UPDATE member_sessions SET
        last_verified_at = now(),
        display_name = ${update.displayName},
        avatar_url = ${update.avatarUrl},
        is_admin = ${update.isAdmin},
        directory_category = ${update.directoryCategory}
      WHERE token_hash = ${tokenHash}
    `;
  } else {
    await sql`UPDATE member_sessions SET last_verified_at = now() WHERE token_hash = ${tokenHash}`;
  }
}

export async function updateMemberTokens(input: {
  tokenHash: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
}): Promise<void> {
  await sql`
    UPDATE member_sessions SET
      access_token_enc = ${encryptField(input.accessToken)},
      refresh_token_enc = ${encryptField(input.refreshToken)},
      token_expires_at = ${input.tokenExpiresAt.toISOString()}
    WHERE token_hash = ${input.tokenHash}
  `;
}

export async function deleteMemberSessionByHash(tokenHash: string): Promise<void> {
  await ensureMemberSessionSchema();
  await sql`DELETE FROM member_sessions WHERE token_hash = ${tokenHash}`;
}

export async function deleteMemberSession(rawToken: string): Promise<void> {
  await deleteMemberSessionByHash(hashToken(rawToken));
}

export async function createMemberOAuthState(nextPath: string): Promise<string> {
  await ensureMemberSessionSchema();
  const state = randomToken();
  await sql`
    INSERT INTO member_oauth_states (state_hash, next_path) VALUES (${hashToken(state)}, ${nextPath})
  `;
  return state;
}

export async function consumeMemberOAuthState(state: string): Promise<string | null> {
  await ensureMemberSessionSchema();
  const { rows } = await sql`
    DELETE FROM member_oauth_states
    WHERE state_hash = ${hashToken(state)} AND created_at > now() - interval '15 minutes'
    RETURNING next_path
  `;
  return rows[0]?.next_path ?? null;
}

export async function sweepExpiredMemberSessions(): Promise<void> {
  await ensureMemberSessionSchema();
  await sql`DELETE FROM member_sessions WHERE expires_at <= now()`;
  await sql`DELETE FROM member_oauth_states WHERE created_at <= now() - interval '15 minutes'`;
}
