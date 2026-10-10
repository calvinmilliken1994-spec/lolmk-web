import { sql, type VercelPoolClient } from "@vercel/postgres";
import { randomUUID } from "node:crypto";
import type {
  MemberDirectoryCategory,
  MemberDirectoryEntry,
  MemberPlayMode,
  MemberPreferredRole,
  MemberProfile,
  MemberRiotId,
  RiotPlatform,
} from "@/types/member-profile";
import { MEMBER_PLAY_MODES, RIOT_PLATFORMS } from "@/types/member-profile";
import { SR_PLAYER_ROLES } from "@/types/sr-tournament";
import { resolveRiotAccount } from "@/lib/riot";
import { splitDisplayName } from "@/lib/member-display";
import { isKnownChampionId } from "@/lib/ddragon";

/**
 * Verified-member profile persistence.
 *
 * Two separate concerns live in `member_profiles`, deliberately mixed into
 * one row rather than split, because they're written by two different
 * triggers:
 *
 *   - CACHED IDENTITY (display_name, avatar_url, is_admin, directory_category,
 *     last_login_at) — written ONLY by upsertLoginProfile(), called from the
 *     OAuth callback on every successful sign-in. This is what lets the
 *     public directory render a staff member's current name/avatar without
 *     that person being online right now.
 *   - SELF-AUTHORED CONTENT (bio, preferred_roles, main_champions,
 *     favorite_champion, play_modes, directory_opt_in) — written only by
 *     updateProfile(), called from the profile page's own server actions,
 *     scoped to the caller's own discord_user_id exactly like the captain
 *     roster actions are scoped to captain_discord_id.
 *
 * A profile row's mere EXISTENCE is not publication: getDirectoryEntries()
 * additionally requires directory_opt_in = true. Logging in once enrolls a
 * person (a row exists so they *could* appear); it is not consent to being
 * listed. directory_category only decides which section a listed person
 * appears in (Admins, Game coordinators, or Members when null).
 */

let schemaReady: Promise<void> | null = null;

export function ensureMemberProfileSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const platformList = RIOT_PLATFORMS.map((p) => `'${p}'`).join(",");
      const roleList = SR_PLAYER_ROLES.map((r) => `'${r}'`).join(",");
      const playModeList = MEMBER_PLAY_MODES.map((m) => `'${m}'`).join(",");

      await sql.query(`
        CREATE TABLE IF NOT EXISTS member_profiles (
          discord_user_id text PRIMARY KEY,
          display_name text NOT NULL,
          avatar_url text,
          is_admin boolean NOT NULL DEFAULT false,
          directory_category text,
          bio text NOT NULL DEFAULT '',
          preferred_roles text[] NOT NULL DEFAULT '{}',
          main_champions text[] NOT NULL DEFAULT '{}',
          favorite_champion text,
          play_modes text[] NOT NULL DEFAULT '{}',
          directory_opt_in boolean NOT NULL DEFAULT false,
          last_login_at timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT member_profiles_directory_category_check
            CHECK (directory_category IS NULL OR directory_category IN ('admin','coordinator')),
          CONSTRAINT member_profiles_bio_length_check CHECK (char_length(bio) <= 500)
        );
      `);
      await sql`CREATE INDEX IF NOT EXISTS member_profiles_directory_idx
        ON member_profiles(directory_category) WHERE directory_opt_in = true;`;

      await sql.query(`
        CREATE TABLE IF NOT EXISTS member_riot_ids (
          id text PRIMARY KEY,
          discord_user_id text NOT NULL REFERENCES member_profiles(discord_user_id) ON DELETE CASCADE,
          game_name text NOT NULL,
          tag_line text NOT NULL,
          platform text NOT NULL,
          puuid text,
          is_primary boolean NOT NULL DEFAULT false,
          last_resolved_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT member_riot_ids_platform_check CHECK (platform IN (${platformList})),
          CONSTRAINT member_riot_ids_gamename_nonblank_check CHECK (trim(game_name) <> ''),
          CONSTRAINT member_riot_ids_tagline_nonblank_check CHECK (trim(tag_line) <> '')
        );
      `);
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS member_riot_ids_unique
        ON member_riot_ids (discord_user_id, lower(game_name), lower(tag_line), platform);`;
      // Partial unique index: at most one primary Riot ID per member. A
      // member with zero Riot IDs simply has no row satisfying WHERE
      // is_primary, which is fine — nothing requires one to exist.
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS member_riot_ids_one_primary
        ON member_riot_ids (discord_user_id) WHERE is_primary;`;
      await sql`CREATE INDEX IF NOT EXISTS member_riot_ids_member_idx ON member_riot_ids(discord_user_id);`;

      // Referenced above so the CHECK constraints stay honest if the role/
      // play-mode vocabularies ever grow — this line exists purely so
      // `roleList` isn't reported unused; the actual validation of these
      // array columns' CONTENTS happens in application code (normaliseRoles/
      // normalisePlayModes below), matching how sr-db.ts validates ranks in
      // the write layer rather than via a Postgres array CHECK.
      void roleList;
      void playModeList;
    })().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

export function newMemberRiotId(): string {
  return `mriot_${randomUUID().slice(0, 12)}`;
}

function normaliseRoles(values: unknown): MemberPreferredRole[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set(SR_PLAYER_ROLES as string[]);
  const seen = new Set<string>();
  const out: MemberPreferredRole[] = [];
  for (const v of values) {
    const s = String(v).toUpperCase();
    if (allowed.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s as MemberPreferredRole);
    }
  }
  return out;
}

function normalisePlayModes(values: unknown): MemberPlayMode[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set(MEMBER_PLAY_MODES as string[]);
  const seen = new Set<string>();
  const out: MemberPlayMode[] = [];
  for (const v of values) {
    const s = String(v).toUpperCase();
    if (allowed.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s as MemberPlayMode);
    }
  }
  return out;
}

function normaliseChampionList(values: unknown, max: number): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const id = String(v ?? "").trim();
    if (id && isKnownChampionId(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (out.length >= max) break;
    }
  }
  return out;
}

function rowToProfile(row: Record<string, unknown>): MemberProfile {
  return {
    discordUserId: row.discord_user_id as string,
    displayName: row.display_name as string,
    avatarUrl: (row.avatar_url as string) ?? null,
    bio: (row.bio as string) ?? "",
    preferredRoles: normaliseRoles(row.preferred_roles),
    mainChampions: Array.isArray(row.main_champions) ? (row.main_champions as string[]) : [],
    favoriteChampion: (row.favorite_champion as string) ?? null,
    playModes: normalisePlayModes(row.play_modes),
    directoryOptIn: Boolean(row.directory_opt_in),
    directoryCategory: (row.directory_category as MemberDirectoryCategory) ?? null,
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

/**
 * Enrolls or refreshes a member's cached identity. Called from the OAuth
 * callback on EVERY successful login — this is the only write path for the
 * cached-identity columns, and it is how a staff member "enrolls" simply by
 * signing in. Never touches directory_opt_in or any self-authored field.
 */
export async function upsertLoginProfile(input: {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  directoryCategory: MemberDirectoryCategory;
}): Promise<void> {
  await ensureMemberProfileSchema();
  await sql`
    INSERT INTO member_profiles (discord_user_id, display_name, avatar_url, is_admin, directory_category)
    VALUES (${input.discordUserId}, ${input.displayName}, ${input.avatarUrl}, ${input.isAdmin}, ${input.directoryCategory})
    ON CONFLICT (discord_user_id) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url,
      is_admin = EXCLUDED.is_admin,
      directory_category = EXCLUDED.directory_category,
      last_login_at = now()
  `;
}

export async function getProfile(discordUserId: string): Promise<MemberProfile | null> {
  await ensureMemberProfileSchema();
  const { rows } = await sql`SELECT * FROM member_profiles WHERE discord_user_id = ${discordUserId}`;
  if (rows.length === 0) return null;
  return rowToProfile(rows[0]);
}

const MAX_BIO_LENGTH = 500;
const MAX_MAIN_CHAMPIONS = 5;

export async function updateProfile(
  discordUserId: string,
  input: {
    bio?: string;
    preferredRoles?: string[];
    mainChampions?: string[];
    favoriteChampion?: string | null;
    playModes?: string[];
    directoryOptIn?: boolean;
  },
): Promise<void> {
  await ensureMemberProfileSchema();
  const bio = input.bio === undefined ? undefined : input.bio.trim().slice(0, MAX_BIO_LENGTH);
  const favoriteChampion =
    input.favoriteChampion === undefined
      ? undefined
      : input.favoriteChampion && isKnownChampionId(input.favoriteChampion)
        ? input.favoriteChampion
        : null;

  // Any signed-in member can opt into the directory (2026 redesign: the
  // Members page has a "Members (opted in)" section alongside Admins and
  // Game coordinators). Sign-in itself is already limited to admins and
  // verified members by the OAuth callback.
  const { rows: existingRows } = await sql`
    SELECT 1 FROM member_profiles WHERE discord_user_id = ${discordUserId}
  `;
  if (existingRows.length === 0) throw new Error("Profile not found. Sign in first.");
  const directoryOptIn = input.directoryOptIn === undefined ? undefined : input.directoryOptIn;

  // Array-valued columns can't go through the tagged-template `sql` helper
  // (its bind values are single primitives per interpolation, same
  // constraint sr-db.ts documents at its ANY($1::text[]) call sites) — use
  // sql.query(text, params) with explicit ::text[] casts instead.
  await sql.query(
    `UPDATE member_profiles SET
       bio = COALESCE($1, bio),
       preferred_roles = CASE WHEN $2 THEN $3::text[] ELSE preferred_roles END,
       main_champions = CASE WHEN $4 THEN $5::text[] ELSE main_champions END,
       favorite_champion = CASE WHEN $6 THEN $7 ELSE favorite_champion END,
       play_modes = CASE WHEN $8 THEN $9::text[] ELSE play_modes END,
       directory_opt_in = CASE WHEN $10 THEN $11 ELSE directory_opt_in END,
       updated_at = now()
     WHERE discord_user_id = $12`,
    [
      bio ?? null,
      input.preferredRoles !== undefined,
      normaliseRoles(input.preferredRoles),
      input.mainChampions !== undefined,
      normaliseChampionList(input.mainChampions, MAX_MAIN_CHAMPIONS),
      input.favoriteChampion !== undefined,
      favoriteChampion ?? null,
      input.playModes !== undefined,
      normalisePlayModes(input.playModes),
      directoryOptIn !== undefined,
      directoryOptIn ?? false,
      discordUserId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Riot IDs
// ---------------------------------------------------------------------------

function rowToRiotId(row: Record<string, unknown>): MemberRiotId {
  return {
    id: row.id as string,
    discordUserId: row.discord_user_id as string,
    gameName: row.game_name as string,
    tagLine: row.tag_line as string,
    platform: row.platform as RiotPlatform,
    puuid: (row.puuid as string) ?? null,
    isPrimary: Boolean(row.is_primary),
    lastResolvedAt: row.last_resolved_at ? new Date(row.last_resolved_at as string).toISOString() : null,
    createdAt: new Date(row.created_at as string).toISOString(),
  };
}

export async function listRiotIds(discordUserId: string): Promise<MemberRiotId[]> {
  await ensureMemberProfileSchema();
  const { rows } = await sql`
    SELECT * FROM member_riot_ids WHERE discord_user_id = ${discordUserId}
    ORDER BY is_primary DESC, created_at ASC
  `;
  return rows.map(rowToRiotId);
}

const MAX_RIOT_IDS = 5;

export async function addRiotId(
  discordUserId: string,
  input: { gameName: string; tagLine: string; platform: string },
): Promise<string> {
  await ensureMemberProfileSchema();
  const gameName = input.gameName.trim();
  const tagLine = input.tagLine.trim().replace(/^#/, "");
  if (!gameName || !tagLine) throw new Error("Enter both the Riot name and tag.");
  if (gameName.length > 32 || tagLine.length > 8) throw new Error("That Riot ID looks too long.");
  if (!(RIOT_PLATFORMS as readonly string[]).includes(input.platform)) {
    throw new Error("Choose a valid region.");
  }

  return await withTransaction(async (client) => {
    const { rows: countRows } = await client.query(
      `SELECT count(*)::int AS c FROM member_riot_ids WHERE discord_user_id = $1`,
      [discordUserId],
    );
    if (countRows[0].c >= MAX_RIOT_IDS) {
      throw new Error(`You can link up to ${MAX_RIOT_IDS} Riot IDs.`);
    }
    const { rows: existingRows } = await client.query(
      `SELECT count(*)::int AS c FROM member_riot_ids WHERE discord_user_id = $1`,
      [discordUserId],
    );
    const isFirst = existingRows[0].c === 0;
    const id = newMemberRiotId();
    try {
      await client.query(
        `INSERT INTO member_riot_ids (id, discord_user_id, game_name, tag_line, platform, is_primary)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, discordUserId, gameName, tagLine, input.platform, isFirst],
      );
    } catch (e) {
      if ((e as Error).message.includes("member_riot_ids_unique")) {
        throw new Error("That Riot ID is already linked to your profile.");
      }
      throw e;
    }
    return id;
  });
}

export async function removeRiotId(discordUserId: string, riotIdId: string): Promise<void> {
  await ensureMemberProfileSchema();
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM member_riot_ids WHERE id = $1 AND discord_user_id = $2 RETURNING is_primary`,
      [riotIdId, discordUserId],
    );
    if (rows.length === 0) throw new Error("Riot ID not found.");
    if (rows[0].is_primary) {
      // Promote the oldest remaining link to primary so a member is never
      // left with zero primary while still having a linked account.
      await client.query(
        `UPDATE member_riot_ids SET is_primary = true
         WHERE id = (
           SELECT id FROM member_riot_ids WHERE discord_user_id = $1 ORDER BY created_at ASC LIMIT 1
         )`,
        [discordUserId],
      );
    }
  });
}

export async function setPrimaryRiotId(discordUserId: string, riotIdId: string): Promise<void> {
  await ensureMemberProfileSchema();
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM member_riot_ids WHERE id = $1 AND discord_user_id = $2`,
      [riotIdId, discordUserId],
    );
    if (rows.length === 0) throw new Error("Riot ID not found.");
    await client.query(`UPDATE member_riot_ids SET is_primary = false WHERE discord_user_id = $1`, [discordUserId]);
    await client.query(`UPDATE member_riot_ids SET is_primary = true WHERE id = $1`, [riotIdId]);
  });
}

/**
 * Resolve a linked Riot ID to a PUUID via the Riot API. This is a
 * corroboration step, not identity verification — see riot.ts and
 * MemberRiotId's doc comment. Returns a result object instead of throwing
 * so the caller can render "not configured"/"not found" as ordinary states.
 */
export async function resolveMemberRiotId(
  discordUserId: string,
  riotIdId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  await ensureMemberProfileSchema();
  const { rows } = await sql`
    SELECT * FROM member_riot_ids WHERE id = ${riotIdId} AND discord_user_id = ${discordUserId}
  `;
  if (rows.length === 0) throw new Error("Riot ID not found.");
  const riotId = rowToRiotId(rows[0]);

  const result = await resolveRiotAccount(riotId.gameName, riotId.tagLine, riotId.platform);
  if (!result.ok) return result;

  await sql`
    UPDATE member_riot_ids SET puuid = ${result.puuid}, last_resolved_at = now()
    WHERE id = ${riotIdId} AND discord_user_id = ${discordUserId}
  `;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public directory
// ---------------------------------------------------------------------------

/**
 * Admins + Game Coordinators who have BOTH logged in at least once (a row
 * exists) AND explicitly opted into being listed. Never reads member data
 * for anyone else — there is no "everyone who's ever logged in" query
 * anywhere in this file.
 */
export async function getDirectoryEntries(): Promise<{
  admins: MemberDirectoryEntry[];
  coordinators: MemberDirectoryEntry[];
  members: MemberDirectoryEntry[];
}> {
  await ensureMemberProfileSchema();
  // The primary linked Riot ID (if any) is joined in for the card's
  // secondary line. Only game_name/tag_line leave this query, never the id.
  const { rows } = await sql`
    SELECT p.display_name, p.avatar_url, p.directory_category, p.bio, p.preferred_roles,
           p.favorite_champion, r.game_name AS riot_game_name, r.tag_line AS riot_tag_line
    FROM member_profiles p
    LEFT JOIN member_riot_ids r ON r.discord_user_id = p.discord_user_id AND r.is_primary
    WHERE p.directory_opt_in = true
    ORDER BY p.display_name ASC
  `;
  const admins: MemberDirectoryEntry[] = [];
  const coordinators: MemberDirectoryEntry[] = [];
  const members: MemberDirectoryEntry[] = [];
  for (const row of rows) {
    const split = splitDisplayName(row.display_name as string);
    const linkedRiotId =
      row.riot_game_name && row.riot_tag_line
        ? `${row.riot_game_name as string}#${row.riot_tag_line as string}`
        : null;
    const entry: MemberDirectoryEntry = {
      displayName: split.name,
      riotId: linkedRiotId ?? split.riotId,
      avatarUrl: (row.avatar_url as string) ?? null,
      category: (row.directory_category as "admin" | "coordinator" | null) ?? "member",
      bio: (row.bio as string) ?? "",
      preferredRoles: normaliseRoles(row.preferred_roles),
      favoriteChampion: (row.favorite_champion as string) ?? null,
    };
    if (entry.category === "admin") admins.push(entry);
    else if (entry.category === "coordinator") coordinators.push(entry);
    else members.push(entry);
  }
  return { admins, coordinators, members };
}

async function withTransaction<T>(fn: (client: VercelPoolClient) => Promise<T>): Promise<T> {
  const client = await sql.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
