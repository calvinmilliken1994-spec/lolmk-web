# TOURNAMENT.md

Complete spec for LoLMK's tournament system. Read this file in full before building tournament features (auth, team application, admin dashboard, bracket generation, or the public tournament pages).

> **Plan of record: web-first.** The **website owns the data**. Members log in with Discord, captains create and manage teams on the site, and admins run the tournament from a web dashboard. Discord is used for **authentication** (and, optionally later, announcements) — it is no longer the source of truth. This replaces the earlier bot-first / SQLite-on-the-bot design; see [Why web-first](#why-web-first-what-changed).

## Architecture at a glance

```
Members & captains (browser)              Admins (browser)
        │  Discord OAuth (Auth.js)                │
        ▼                                         ▼
   Next.js App Router  ──── Server Actions (writes) ────┐
   (Vercel)            ──── Server Components (reads) ───┤
        │                                                ▼
        │                                    Hosted Postgres  (source of truth)
        │                                    + Object Storage (team logos)
        ▼                                                ▲
   Team logo uploads ──► Storage (Vercel Blob / Supabase)│
                                                         │
   (optional) Discord bot ──── same DB client ───────────┘
              announcements · /myteam convenience · Riot rank checks
```

**Single source of truth: the Postgres database.** The website reads and writes it directly through `src/lib/` helpers and Server Actions. No always-on bot is required to ship team creation or the admin dashboard — the entire flow runs on Vercel + a managed database.

## Why web-first (what changed)

The previous version of this spec put a Discord bot + local SQLite at the center, with the website as a read-only client of the bot's HTTP API. We're inverting that. Reasons:

- **Hosting.** A Discord gateway bot must run 24/7 and cannot live on Vercel — it implied a second always-on host plus a bot↔web API. A web-first design runs entirely on Vercel + a managed DB.
- **The features we now want are web-shaped.** Team application forms, captain roster editing, logo uploads, and a live admin bracket dashboard are all far easier as native web UI than as Discord slash-command modals.
- **One clear owner.** Two systems both writing team data (bot SQLite + web) would drift. A single Postgres DB that the web app owns — and that an optional bot reads/writes as a *client* — keeps one source of truth.
- **Managed Postgres is now as easy as SQLite used to be.** Supabase/Neon free tiers give us Postgres + storage + realtime with no ops.

The bot doesn't disappear — it becomes an **optional** same-DB client for Discord-side niceties (announcements, `/myteam`, Riot rank verification). Ship it only when wanted.

## Tech stack

- **App**: existing Next.js (App Router) + TypeScript, on Vercel.
- **Auth**: **Auth.js (NextAuth v5)** with the Discord provider. Guild-membership gate + role-based admin (see [Authentication](#authentication--access-control)).
- **Database**: **hosted Postgres** — **Supabase** (recommended; bundles Postgres + Storage + Realtime) or **Neon** (+ Vercel Blob for storage).
- **Query layer**: **Kysely** (typed SQL) or **Drizzle** — typed, migration-friendly, keeps the door open. Wrapped behind `src/lib/` per the repo's data-access convention.
- **Writes**: Next.js **Server Actions** (form mutations). No separate API server.
- **File storage**: Supabase Storage or Vercel Blob for team logos.
- **Bracket rendering**: **`@g-loot/react-tournament-brackets`**, themed to the LoLMK palette (`brand-red`, `brand-blue`, `bg-surface`). Only build a custom SVG bracket if the library can't match the broadcast look after styling.
- **Live updates**: on-demand revalidation (`revalidateTag`) for near-real-time; **Supabase Realtime** (or SSE) for a truly live bracket if wanted.

## Authentication & access control

Auth is the foundation — build it first. Everything else is gated on it.

### Discord OAuth (Auth.js)

- Provider: Discord. Scopes: `identify email guilds` (add `guilds.members.read` to read the user's roles in the LoLMK guild without a bot token).
- Sessions: **JWT strategy** is simplest (no session tables). Store `discordId`, `isMember`, and `isAdmin` on the token in the `jwt` callback; expose them on `session.user`.

### "Only verified LoLMK members" gate

Enforced in the Auth.js **`signIn` callback** — reject the sign-in if the user isn't in the guild:

- **Lightweight:** the `guilds` scope returns the user's guild list — require `DISCORD_GUILD_ID` to be present.
- **Preferred (also yields roles):** call `GET /users/@me/guilds/{guild}/member` with the user's `guilds.members.read` token, **or** look the member up with the bot token (`DISCORD_BOT_TOKEN`, already configured). This returns their **roles**, letting us require a "Member/Verified" role and detect admins in the same call.

A user who isn't a guild member (or lacks the member role, if we require one) never gets a session. This makes the nav's "Log in with Discord" verified badge real.

### Roles

- **Member** — any verified guild member. Can log in, create/manage their own team.
- **Admin/Organizer** — identified by a specific Discord **role id** (`ADMIN_ROLE_ID`) detected at login and flagged on the session. Gates `/admin` and all mutation actions there. Store nothing hand-maintained; derive from Discord roles so access follows the server.

Guard every Server Action and admin route by re-checking the session server-side (never trust the client). Captain-only actions compare `session.user.discordId` to `team.captain_discord_id`.

## Database schema

Postgres. Mirrors `src/types/tournament.ts` (the website's typed contract) — keep the two in sync. Timestamps are `timestamptz`; ids are `text` (nanoid/ulid) unless noted. If you use Auth.js **database** sessions instead of JWT, add its adapter tables; JWT sessions need none of that.

```sql
CREATE TABLE tournaments (
  id                TEXT PRIMARY KEY,               -- e.g. "q1-2026"
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  game              TEXT NOT NULL DEFAULT 'Riftbound',
  season            TEXT NOT NULL,
  format            TEXT NOT NULL DEFAULT 'double_elim',  -- double_elim | single_elim
  status            TEXT NOT NULL DEFAULT 'draft',
     -- draft | signups_open | signups_closed | bracket_released | in_progress | completed
  max_teams         INTEGER NOT NULL DEFAULT 16,
  signup_deadline   TIMESTAMPTZ,
  start_date        TIMESTAMPTZ,
  end_date          TIMESTAMPTZ,
  description       TEXT,
  prize_description TEXT,
  rules_url         TEXT,
  champion_team_id  TEXT,                           -- set when status = completed
  created_by        TEXT NOT NULL,                  -- admin discord id
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE teams (
  id                  TEXT PRIMARY KEY,
  tournament_id       TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  tag                 TEXT NOT NULL,                -- 2-4 char abbreviation
  slug                TEXT NOT NULL,
  logo_url            TEXT,                         -- PERMANENT storage URL (never a raw Discord CDN url)
  color               TEXT,                         -- optional hex
  captain_discord_id  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | withdrawn
  seed                INTEGER,
  rejected_reason     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  UNIQUE (tournament_id, slug),
  UNIQUE (tournament_id, tag)
);

CREATE TABLE players (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  discord_id        TEXT NOT NULL,
  discord_username  TEXT NOT NULL,                  -- snapshot at signup time
  ign               TEXT NOT NULL,                  -- in-game name on KR
  role              TEXT NOT NULL,                  -- TOP | JUNGLE | MID | ADC | SUPPORT | FILL
  peak_rank         TEXT,
  current_rank      TEXT,
  rank_verified     BOOLEAN NOT NULL DEFAULT false, -- true once Riot API confirms (Phase 5)
  is_captain        BOOLEAN NOT NULL DEFAULT false,
  is_substitute     BOOLEAN NOT NULL DEFAULT false,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, discord_id)
);

CREATE TABLE matches (
  id                    TEXT PRIMARY KEY,
  tournament_id         TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket               TEXT NOT NULL,              -- upper | lower | grand_final | grand_final_reset
  round_number          INTEGER NOT NULL,
  match_number          INTEGER NOT NULL,
  team_a_id             TEXT REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id             TEXT REFERENCES teams(id) ON DELETE SET NULL,
  team_a_score          INTEGER,
  team_b_score          INTEGER,
  winner_id             TEXT REFERENCES teams(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | forfeit | bye
  advances_to_match_id  TEXT REFERENCES matches(id) ON DELETE SET NULL,
  drops_to_match_id     TEXT REFERENCES matches(id) ON DELETE SET NULL,
  scheduled_at          TIMESTAMPTZ,
  played_at             TIMESTAMPTZ,
  vod_url               TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_tournament ON teams(tournament_id);
CREATE INDEX idx_teams_status     ON teams(tournament_id, status);
CREATE INDEX idx_players_team     ON players(team_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_status   ON matches(tournament_id, status);
```

Admins are **not** a table — they're derived from a Discord role at login (`ADMIN_ROLE_ID`). Completed tournaments also feed the public **Hall of Champions** (`src/data/champions.json` today, this table later — see `src/lib/champions.ts`).

### Ranks (exact enum strings)

```
IRON_IV … IRON_I, BRONZE_IV … BRONZE_I, SILVER_IV … SILVER_I,
GOLD_IV … GOLD_I, PLATINUM_IV … PLATINUM_I, EMERALD_IV … EMERALD_I,
DIAMOND_IV … DIAMOND_I, MASTER, GRANDMASTER, CHALLENGER
```

### Roles (exact enum strings)

```
TOP, JUNGLE, MID, ADC, SUPPORT, FILL
```

## Tournament status flow

```
draft → signups_open → signups_closed → bracket_released → in_progress → completed
                ↑                                ↓
                └──────── (admin can reopen) ─────┘
```

Admin-controlled transitions, validated server-side (e.g. `bracket_released` requires ≥ 4 approved teams).

## Team application flow (website)

The captain's path, gated behind Discord login. This is the core of the web-first plan.

1. **Log in.** Captain signs in with Discord. Non-members are rejected at the gate.
2. **Apply.** On `/tournaments/[slug]` (when `status = signups_open`), an authenticated captain hits **"Create a team"** → `/tournaments/[slug]/apply`. The captain is `session.user`; they don't re-enter their own identity.
3. **Fill the roster.** The form collects:
   - Team **name** (unique within tournament) and **tag** (2-4 chars, unique within tournament).
   - Optional **team color** and **logo** (see [Logo upload](#team-logo-upload)).
   - **Full roster** — 5 starters, each with **IGN**, **role** (TOP/JUNGLE/MID/ADC/SUPPORT/FILL), and **current + peak rank**. Optional substitutes. Roles are assigned here at application time.
   - Players are referenced by Discord — the captain adds members (by picking from guild members or entering a Discord handle/id); `discord_username` is snapshotted.
4. **Submit for review.** A Server Action validates and inserts the `team` (`status = pending`) + `players`. **A team is only held for review if the roster is complete** (5 valid starters, unique roles as required, captain among them).
5. **Balance check + approval.** The team sits in `pending` until an **admin** reviews it on the dashboard — checking roster completeness and **balance** (ranks are shown per player). Admin **approves** (`status = approved`, `approved_at` set) or **rejects** (`rejected_reason` recorded). The captain sees the status on their **My Team** page.

Validation rules: unique name & tag within the tournament; tag alphanumeric 2-4 chars; exactly 5 starters (subs optional); one role each (FILL allowed); captain must be one of the roster; every player must be a verified guild member.

## Captain self-service — "My Team"

Once logged in, a captain manages their entry at **`/tournaments/[slug]/my-team`** (captain-only, guarded by `captain_discord_id === session.user.discordId`):

- **Roster & roles.** Set at application; **editable afterwards** — reassign roles, and **swap in substitutes** when needed (add/replace a player row). Edits after `signups_closed` may be restricted or re-trigger review, at admin discretion.
- **Logo.** Upload/replace the team logo directly (see below).
- **Status visibility.** Sees pending / approved / rejected (+ reason) and, once live, their bracket path.

## Team logo upload

Captains upload a logo directly from the site (an upload control on the apply form and My Team page).

**⚠️ The trap:** never store a raw `cdn.discordapp.com` URL — Discord attachment URLs are signed and **expire**. Always **re-host**.

Pipeline:

1. Client uploads the image to **our storage** (Supabase Storage or Vercel Blob) via a Server Action / signed upload.
2. **Normalize** server-side with `sharp`: re-encode to a square ~256×256 PNG/WebP, strip EXIF. Disallow or rasterize SVG (script-injection risk). Enforce type + size limits.
3. Store the **permanent** storage URL in `teams.logo_url`.
4. **Moderate.** Logos are public user-generated content — gate them behind the same admin approval as the team (the logo appears in the review UI; admins can `clear-logo` later). 
5. Add the storage host to `next.config` `images.remotePatterns`. Fallback everywhere is the initials-in-colored-box crest (already implemented in the Hall of Champions).

## Admin dashboard

`/admin` (and `/admin/tournaments/[slug]`), gated by the admin role. Server Actions do the writes; guard each one server-side.

- **Team review:** queue of `pending` teams with rosters + ranks; **Approve / Reject (with reason)**. This is the balance-check surface.
- **Tournament lifecycle:** create/edit tournaments; advance `status`.
- **Bracket:** run the draw (seeds approved teams, generates matches — see algorithm below); reset if needed.
- **Live match reporting:** set winners/scores; the engine advances winners and drops losers automatically.
- **Live updates:** after each write, `revalidateTag('tournament:<slug>')` so public pages refresh on next load. For a truly live bracket during finals, push changes with **Supabase Realtime** (or SSE) to open bracket pages.

## Bracket generation

Runs server-side (Server Action / admin route), not a bot command. When the admin draws:

1. Pull `status = 'approved'` teams for the tournament.
2. Validate count (4, 8, 16 supported cleanly; 6/12 with byes later; other counts error).
3. Fisher-Yates shuffle → assign seeds `1..N`.
4. Generate match records: upper-bracket single-elim shape; double-elim lower bracket; grand final + conditional reset.
5. Populate round-1 upper-bracket team slots only; wire every match's `advances_to_match_id` / `drops_to_match_id`.
6. Set status → `bracket_released`.

### Match counts (double elim)

| Teams | Upper | Lower | Grand finals | Total |
|---|---|---|---|---|
| 4 | 3 | 2 | 2 | 7 |
| 8 | 7 | 6 | 2 | 15 |
| 16 | 15 | 14 | 2 | 31 |

(Total includes the conditional grand-final reset, played only if the lower-bracket team wins the first grand final.)

## Match reporting

Admin reports a result on the dashboard. The Server Action:

1. Re-checks admin permission and that the match isn't already `completed`.
2. Validates the winner is `team_a_id` or `team_b_id`.
3. Writes `winner_id`, scores, `status = completed`, `played_at = now()`.
4. **Advances** the winner into `advances_to_match_id`'s next open slot.
5. **Drops** the loser into `drops_to_match_id` (upper-bracket losses); lower-bracket losses are elimination.
6. If it's the grand final: upper-bracket team wins → tournament `completed`, set `champion_team_id` (and add to Hall of Champions); lower-bracket team wins → enable the reset match.
7. Revalidate / push so the public bracket updates.

**Unreport** is allowed only if downstream matches (advance + drop) are still `scheduled`.

## Website page flow

### `/tournaments` (hub)
- Featured current tournament + **Hall of Champions** (past winners) + "how it works".
- Auth-aware CTA: **"Create a team"** when `signups_open` and logged in; **"Log in with Discord to enter"** when logged out; "Signups closed" otherwise.

### `/tournaments/[slug]`
Renders by status:
- **Pre-bracket** (`draft` / `signups_open` / `signups_closed`): hero + status + deadline countdown; **team grid** of approved (and pending, subtly marked) teams; apply CTA.
- **Bracket-released / in_progress**: bracket visualization is the hero; sidebar with upcoming matches + recent results; team grid below.
- **Completed**: champion banner, final bracket, final standings, VOD links, photos.

### `/tournaments/[slug]/apply` — captain application form (auth required).
### `/tournaments/[slug]/my-team` — captain roster/logo management (captain only).
### `/tournaments/[slug]/teams/[teamSlug]` — public team page: logo, roster, match history.

## Team card & roster modal spec

### Team card (in grid)
- Square or 3:4 portrait. `bg-surface`; hover `bg-elevated`. 1px `border`; hover `border-strong`. Sharp corners.
- Logo top-center (80px, or initials-in-colored-box fallback). Team name in Bebas Neue `display-sm` all-caps. Tag below in `label` style. Captain in `body-sm`. Player-count badge ("5/5" or "5/5 +2") bottom-right. Pending badge top-right (`brand-red-muted`) only if pending. Click → roster modal.

### Roster modal (pop-out)
- Backdrop blur; `bg-surface`, max-width 640px, sharp corners, `border`.
- Header: logo (96px), name (Bebas `display-md`), tag (`label`), captain with `brand-red` "C" badge, close button.
- **STARTERS** section; each row: avatar (40px, Discord CDN), IGN (`heading-md` 600), Discord username (`body-sm` muted), role chip, and peak rank (Bebas, bright) over current rank (`body-sm` muted) on the right.
- **SUBSTITUTES** section at 70% opacity.
- Optional 4px `team.color` stripe at the bottom.
- Close on X, backdrop click, Esc.

### Role badge colors
Keep uniform/subtle (`bg-elevated` + `text-primary`); FILL gets `brand-blue-muted` + `brand-blue-bright`. Lane icons instead of color are a later upgrade.

## Optional Discord bot (same-DB client)

Only if/when wanted — **not required** for any of the above. Runs on Railway/Fly/VPS, connects to the **same Postgres**:

- Posts announcements (new tournament, signups open, team approved, match results, champion crowned).
- Convenience `/myteam` read commands and DMs.
- Riot API **rank verification** worker (writes `players.rank_verified`).

It is a consumer of the DB the website owns, never a competing writer of truth.

## Environment variables (website)

```
# Auth.js (Discord OAuth)
AUTH_SECRET=
AUTH_DISCORD_ID=
AUTH_DISCORD_SECRET=

# Membership / role gating
DISCORD_GUILD_ID=
DISCORD_BOT_TOKEN=          # already used for events/stats; also used for member+role lookups
ADMIN_ROLE_ID=              # Discord role id that grants /admin
MEMBER_ROLE_ID=             # optional: require this role to log in at all

# Database
DATABASE_URL=               # Postgres (Supabase/Neon) connection string

# Object storage (pick one)
BLOB_READ_WRITE_TOKEN=      # Vercel Blob
# or
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Riot API (Phase 5, rank verification)
RIOT_API_KEY=
```

## Data-access convention

Per `CLAUDE.md`: components never touch the DB directly. All reads/writes go through `src/lib/` helpers (`tournaments.ts`, `teams.ts`, `matches.ts`, `champions.ts`) wrapping Kysely/Drizzle. Server Actions call these helpers. Types live once in `src/types/tournament.ts`.

## Backups

Managed Postgres handles this: enable **Supabase/Neon automated daily backups + point-in-time recovery**. Before risky operations (bracket reset, tournament delete) take a manual snapshot. Storage (logos) is separately durable in the bucket.

## Phasing (web-first)

Each phase is independently shippable.

### Phase 1 — Auth + membership gate
Auth.js Discord login; reject non-guild-members; expose `isMember` / `isAdmin` on the session. Real "logged in" state; the nav verified badge becomes real. Smallest piece — de-risks the guild gate. Needs: **guild id** and the **admin role id/name**.

### Phase 2 — DB + team application
Provision Postgres; schema + migrations; `src/lib` data helpers. Apply form + Server Action; teams land as `pending`.

### Phase 3 — Admin review + My Team
Admin dashboard: review queue, approve/reject (+ balance check). Captain My Team: edit roster, subs, roles. **Team logo upload** (storage + `sharp` normalize + moderation).

### Phase 4 — Bracket + live admin
Bracket draw + public bracket render (`@g-loot/react-tournament-brackets`). Admin match reporting with auto-advancement. Live updates via `revalidateTag` (upgrade to Supabase Realtime for finals).

### Phase 5 — Optional bot + Riot verification
Discord bot as same-DB client (announcements, `/myteam`). Riot API rank verification writing `players.rank_verified`.

## Open questions

- **Admin identity:** confirm the exact Discord **role name/id** that should grant `/admin`, and whether logging in at all requires a specific member role or just guild membership.
- **Rank trust:** captain-entered ranks for now, Riot-verified later — acceptable for balancing early tournaments?
- **Logos:** required at application or optional with the initials fallback? (Recommend optional + fallback.)
- **Match confirmation:** admin-reported only, or require both captains to confirm results? (Recommend admin-only; add confirmation if disputes arise.)
- **Odd team counts:** support 6/12 with byes, or restrict to 4/8/16 initially?
- **Team persistence:** do teams/rosters carry across tournaments, or is each tournament a fresh entry? (Affects cross-tournament history on team pages.)
