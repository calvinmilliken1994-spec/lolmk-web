# TOURNAMENT.md

Complete spec for LoLMK's tournament system. Read this file in full before building tournament features (auth, team application, admin dashboard, bracket generation, or the public tournament pages).

> **Plan of record: web-first.** The **website owns the data**. Members log in with Discord, captains create and manage teams on the site, and admins run the tournament from a web dashboard. Discord is used for **authentication** (and, optionally later, announcements) — it is no longer the source of truth. This replaces the earlier bot-first / SQLite-on-the-bot design; see [Why web-first](#why-web-first-what-changed).

> **Scope: League of Legends only (for now).** This system covers LoLMK's **League of Legends** tournaments — 5v5 on **Summoner's Rift**, **ARAM** on Howling Abyss, and other custom/fun gamemodes. **Riftbound is explicitly out of scope** and handled separately; it may be added as its own tournament type in the future, but nothing here should assume it. Roles and ranks below are League concepts and only apply to League modes.

## Architecture at a glance

```
Members / Captains (browser)              Admins (browser)
        │  Discord OAuth (Auth.js)                │
        ▼                                         ▼
   Next.js App Router  ──── Server Actions (writes) ────┐
   (Vercel)            ──── Server Components (reads) ───┤   ← ALL db access is server-side
        │                                                ▼
        │                              Supabase Postgres  (source of truth, via Supavisor pooler)
        │                              + Supabase Storage (team logos)
        ▼                                                ▲
   Team logo uploads ──► Storage (normalized, moderated) │
                                                         │
   Bot token (REST, no gateway) ── cached member directory + optional announcements
```

**Single source of truth: Supabase Postgres.** The website reads and writes it directly through `src/lib/` helpers and Server Actions, **all server-side**. No always-on bot is required to ship any of this — the whole flow runs on Vercel + Supabase.

## Why web-first (what changed)

Previously this spec put a Discord bot + local SQLite at the center, with the website as a read-only client. We inverted that:

- **Hosting.** A gateway bot must run 24/7 and can't live on Vercel. Web-first runs entirely on Vercel + Supabase.
- **The features are web-shaped.** Team application forms, captain roster editing, logo uploads, and a live admin bracket dashboard are far easier as native web UI than Discord modals.
- **One clear owner.** A single Postgres DB the web app owns — with the bot token used only for REST lookups/announcements — keeps one source of truth.

## Tech stack

- **App**: existing Next.js (App Router) + TypeScript, on Vercel.
- **Auth**: **Auth.js (NextAuth v5)** + Discord provider. Guild-membership gate, role-based Member / Captain / Admin (see [Authentication](#authentication--access-control)).
- **Database**: **Supabase Postgres**. Serverless code connects through the **Supavisor pooler** (pooled string, port `6543`, transaction mode). Migrations use the **direct** connection (`5432`).
- **Query layer**: **Kysely** or **Drizzle** (typed SQL + migrations), wrapped behind `src/lib/` per the repo's data-access convention.
- **Writes**: Next.js **Server Actions**. No separate API server.
- **File storage**: **Supabase Storage** for team logos.
- **Bracket rendering**: **`@g-loot/react-tournament-brackets`**, themed to the LoLMK palette. Verify React 19 / Next 15 compatibility before committing; fall back to a custom SVG bracket if needed.
- **Live bracket (optional, later)**: push updates **server → client via SSE** rather than exposing a browser DB client; or Supabase Realtime restricted by RLS to public bracket columns only.

## Data security model

The rule that keeps this leak-proof: **only the bracket (and a minimal set of public team display fields) is ever public. Everything else — rosters under review, `rejected_reason`, admin data, member directory — is admin-only.**

- **All DB access is server-side** (Server Components for reads, Server Actions for writes) using the server connection. **The Supabase browser client is never shipped.** The browser never talks to the database, so it can only ever receive what a server component chose to render.
- **Public read surface** is explicit and narrow: the bracket (matches + team name/tag/logo/seed) and, once approved, the public team pages. Server helpers select only those fields.
- **RLS is enabled as defense-in-depth**, even though the app doesn't rely on it (no anon client). If Realtime is added later, RLS read policies scoped to public columns become load-bearing.
- **Pooled vs direct**: serverless → Supavisor (`6543`); migrations → direct (`5432`).

## Authentication & access control

Auth is the foundation — build it first. Everything else gates on it.

### Discord OAuth (Auth.js)

- Provider: Discord. Scopes: `identify guilds` (+ `guilds.members.read` to read the user's roles in the LoLMK guild without a bot token).
- Sessions: **JWT strategy, short-lived** (see re-check below). Store `discordId`, `isMember`, `isCaptain`, `isAdmin` on the token; expose on `session.user`.

### Membership gate — only verified LoLMK members

Enforced in the Auth.js **`signIn` callback**: resolve the user's roles in the LoLMK guild — via their `guilds.members.read` token **or** a bot-token member lookup (`GET /guilds/{id}/members/{user}`) — and **reject the sign-in unless they hold the `LoLMK Verified` role**. Since that role is auto-granted on joining, this is effectively "must be a verified member," and the same lookup sets the `isCaptain` / `isAdmin` flags below. No verified role → no session.

### Roles

Derived from Discord roles at login (and re-checked, below) — nothing hand-maintained.

- **Member — the `LoLMK Verified` role** (`MEMBER_ROLE_ID`). Auto-granted to everyone who joins the Discord and **required to log in** — being verified in the server *is* the login gate. Members can log in and view public pages.
- **Captain — the `Captain` role** (`CAPTAIN_ROLE_ID`), **granted by admins** to members who may run a team. **Only Captains can create a team, and only one active team per Captain** (see [One team per captain](#captain-self-service--my-team)).
- **Admin — the `Tournament Admin` role** (`ADMIN_ROLE_ID`). Runs `/admin`: reviews/approves teams, seeds brackets, reports matches, disbands teams.

Guard every Server Action and admin route by re-checking the session **server-side**. Captain-only actions compare `session.user.discordId` to `team.captain_discord_id`.

### Membership & role re-checks (important)

JWTs cache role state, so we must re-verify to avoid stale access and members who leave the server:

- **Short sessions** (e.g. ≤ 30 min) so role/membership changes propagate quickly on refresh.
- **Re-verify on every sensitive action** — before team create/edit/disband and any admin mutation, do a fresh bot-token member lookup: confirm the actor is still in the guild and still holds the required role. Deny + clear the session if not.
- **"Member left the guild" handling** — if a captain or rostered player is no longer a member (detected at re-check, or via a periodic sweep of active teams), flag the team for admin attention and block further captain actions. A team whose captain has left is surfaced to admins to reassign or disband. (This restores the old bot's `guildMemberRemove` safeguard.)

## Database schema

Supabase Postgres. Mirrors `src/types/tournament.ts` (the website's typed contract) — keep them in sync. Timestamps `timestamptz`; ids `text` (nanoid/ulid). JWT sessions need no Auth.js adapter tables.

```sql
CREATE TABLE tournaments (
  id                TEXT PRIMARY KEY,               -- e.g. "spring-2026"
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  game              TEXT NOT NULL DEFAULT 'League of Legends',
  mode              TEXT NOT NULL DEFAULT 'sr_5v5', -- sr_5v5 | aram | custom
  season            TEXT NOT NULL,
  format            TEXT NOT NULL DEFAULT 'double_elim',  -- double_elim | single_elim
  status            TEXT NOT NULL DEFAULT 'draft',
     -- draft | signups_open | signups_closed | bracket_released | in_progress | completed
  max_teams         INTEGER NOT NULL DEFAULT 16,
  team_size         INTEGER NOT NULL DEFAULT 5,     -- starters expected (mode-dependent)
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
  tag                 TEXT NOT NULL,                -- 2-4 chars
  slug                TEXT NOT NULL,
  logo_url            TEXT,                         -- PERMANENT storage URL (never a raw Discord CDN url)
  color               TEXT,                         -- optional hex
  captain_discord_id  TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | withdrawn
  seed                INTEGER,
  rejected_reason     TEXT,                         -- internal, never public
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at         TIMESTAMPTZ,
  UNIQUE (tournament_id, lower(slug)),              -- case-insensitive
  UNIQUE (tournament_id, lower(tag))
);

-- One ACTIVE team per captain per tournament (rejected/withdrawn don't count).
CREATE UNIQUE INDEX one_active_team_per_captain
  ON teams (tournament_id, captain_discord_id)
  WHERE status IN ('pending', 'approved');

CREATE TABLE players (
  id                TEXT PRIMARY KEY,
  team_id           TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  tournament_id     TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE, -- denormalized for the constraint below
  discord_id        TEXT NOT NULL,
  discord_username  TEXT NOT NULL,                  -- snapshot at add time
  ign               TEXT NOT NULL,                  -- KR summoner name
  role              TEXT,                           -- TOP | JUNGLE | MID | ADC | SUPPORT | FILL (nullable: sr_5v5 only)
  peak_rank         TEXT,
  current_rank      TEXT,
  rank_verified     BOOLEAN NOT NULL DEFAULT false, -- true once Riot RSO/API confirms (later)
  is_captain        BOOLEAN NOT NULL DEFAULT false,
  is_substitute     BOOLEAN NOT NULL DEFAULT false,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, discord_id),
  UNIQUE (tournament_id, discord_id)               -- a player can be on only ONE team per tournament
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

-- Append-only audit trail for admin/captain actions (disputes, accountability).
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_discord_id TEXT NOT NULL,
  action        TEXT NOT NULL,                      -- team.approve, team.reject, team.disband, bracket.seed, match.report, ...
  entity        TEXT NOT NULL,                      -- e.g. "team:abc" / "match:xyz"
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_teams_tournament ON teams(tournament_id);
CREATE INDEX idx_teams_status     ON teams(tournament_id, status);
CREATE INDEX idx_players_team     ON players(team_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_status   ON matches(tournament_id, status);
```

Admins/captains are **not** tables — they're derived from Discord roles at login and re-checked. Completed tournaments feed the public **Hall of Champions** (interim data lives in `src/data/champions.json` via `src/lib/champions.ts`; once tournaments run through the DB, the champion is derived from the completed tournament + winning team, and the JSON becomes a backfill of pre-system history).

### Ranks (League — exact enum strings)

```
IRON_IV … IRON_I, BRONZE_IV … BRONZE_I, SILVER_IV … SILVER_I,
GOLD_IV … GOLD_I, PLATINUM_IV … PLATINUM_I, EMERALD_IV … EMERALD_I,
DIAMOND_IV … DIAMOND_I, MASTER, GRANDMASTER, CHALLENGER
```

### Roles (League 5v5 — exact enum strings)

```
TOP, JUNGLE, MID, ADC, SUPPORT, FILL
```

Roles apply to **`sr_5v5`** only. For **ARAM** and **custom** modes, `role` is left null and the roster is just the players.

## Tournament status flow

```
draft → signups_open → signups_closed → bracket_released → in_progress → completed
                ↑                                ↓
                └──────── (admin can reopen) ─────┘
```

Admin-controlled, validated server-side (e.g. `bracket_released` requires ≥ 4 approved teams).

## Team application flow (website)

Teams are formed **off-site** — captains recruit and everyone agrees before anyone is added on the website. The site records the agreed roster; it is not a matchmaking tool.

1. **Captain role.** A member asks an admin for the **Captain** role. Only Captains see "Create a team."
2. **Log in & apply.** On `/tournaments/[slug]` (when `signups_open`), a Captain hits **"Create a team"** → `/tournaments/[slug]/apply`. The Captain is `session.user` — they don't re-enter their own identity.
3. **Build the roster.** The form collects team **name** + **tag** (both unique, case-insensitive, within the tournament), optional **color** and **logo** ([Logo upload](#team-logo-upload)), and the roster. Players are added via a **typeahead member picker** backed by the cached guild-member directory (search nickname/username → resolves to the Discord ID). For each player: **IGN**, **rank** (current + peak), and — for `sr_5v5` — **role**. Roster size + whether roles are required follow the tournament's `mode`/`team_size`.
4. **Validation (server-side).**
   - Every player is a **current, verified guild member** (re-checked against the directory at submit).
   - **No player is already on another team** in this tournament (`UNIQUE(tournament_id, discord_id)` + a friendly pre-check).
   - Name/tag unique (case-insensitive); tag 2-4 alphanumeric; captain is on the roster; expected roster size met.
   - The Captain has **no other active team** in this tournament.
5. **Submit for review.** Inserts the `team` (`status = pending`) + `players`. **Held for admin review** — nothing goes into a bracket until approved.
6. **Balance check + approval.** An admin reviews roster completeness and **balance** (ranks shown per player) on the dashboard, then **approves** (`approved`, `approved_at`) or **rejects** (`rejected_reason`, internal). The captain sees status on My Team.

### Member directory (handle resolution)

The picker is powered by a **cached guild-member directory**: a bot application with the **`GUILD_MEMBERS` privileged intent** calls `GET /guilds/{id}/members` over REST (no gateway process needed — the same bot token used for events/stats), and the result is cached in the DB and refreshed on a schedule (and on-demand before a big signup window). This gives fast typeahead and lets us verify membership at submit time.

## Captain self-service — "My Team"

At **`/tournaments/[slug]/my-team`** (captain-only; guarded by `captain_discord_id === session.user.discordId`), a captain can:

- **One team, and only one.** A Captain may create and hold exactly **one active team per tournament** (DB-enforced).
- **Edit the roster & roles** — reassign roles and **swap in substitutes** when needed. The one-team-per-player rule still applies to any newly added player. **After a team is approved, any roster change (including a sub swap) sends it back to `pending` and re-enters admin review** — the balance check runs again before the team is re-confirmed.
- **Upload/replace the team logo** ([below](#team-logo-upload)).
- **Disband the team** — captain-initiated teardown (status → `withdrawn`; removed from the bracket if already drawn). **Admins can disband any team** as well (audited).
- **See status** — pending / approved / rejected (+ reason) and, once live, their bracket path.

## Team logo upload

Captains upload a logo directly from the site (on the apply form and My Team).

**⚠️ The trap:** never store a raw `cdn.discordapp.com` URL — Discord attachment URLs are signed and **expire**. Always **re-host**.

Pipeline: client uploads to **Supabase Storage** via a Server Action → **normalize with `sharp`** (square ~256×256 PNG/WebP, strip EXIF; disallow/rasterize SVG; type + size limits) → store the **permanent** URL in `teams.logo_url` → the logo is public only after the team is **approved** (it appears in the admin review UI; admins can clear it). Orphaned uploads (team never submitted) are swept periodically. Fallback everywhere is the initials-in-colored-box crest (already implemented in the Hall of Champions). Add the storage host to `next.config` `images.remotePatterns`.

## Admin dashboard

`/admin` (+ `/admin/tournaments/[slug]`), gated by the Admin role, every action re-checked server-side and **audited**.

- **Team review** — queue of `pending` teams with rosters + ranks; **Approve / Reject (with reason)**. The balance-check surface.
- **Tournament lifecycle** — create/edit tournaments; advance `status`.
- **Bracket** — **"Seed bracket (random)"** button runs the draw (below); reset if needed.
- **Live match reporting** — set winners/scores; the engine advances winners and drops losers.
- **Disband** — remove any team (audited).
- **Live updates** — after each write, `revalidateTag('tournament:<slug>')` so public pages refresh on next load. For finals, optionally push via SSE.

## Bracket generation

Runs server-side (Server Action), triggered by the admin **"Seed bracket (random)"** button — only after every team has been reviewed. Volume is small and handled internally, so there's no waitlist/over-subscription logic.

1. Pull `status = 'approved'` teams.
2. **Random** Fisher-Yates shuffle → assign seeds `1..N`.
3. If `N` isn't a power of two, **byes are added at random**: the shuffle decides which top seeds get a round-1 bye up to the next power of two (a `bye` match auto-advances). No fixed 4/8/16 requirement.
4. Generate match records: upper-bracket single-elim shape; double-elim lower bracket; grand final + conditional reset.
5. Populate round-1 upper-bracket slots (with byes auto-resolved); wire every match's `advances_to_match_id` / `drops_to_match_id`.
6. Status → `bracket_released`.

### Match counts (double elim, no byes)

| Teams | Upper | Lower | Grand finals | Total |
|---|---|---|---|---|
| 4 | 3 | 2 | 2 | 7 |
| 8 | 7 | 6 | 2 | 15 |
| 16 | 15 | 14 | 2 | 31 |

(Total includes the conditional grand-final reset, played only if the lower-bracket team wins the first grand final.)

## Match reporting

Admin reports a result on the dashboard. The Server Action re-checks admin permission, validates the match isn't `completed` and the winner is a participant, writes the score + `winner_id` + `completed`/`played_at`, **advances** the winner and **drops** the loser (upper-bracket losses; lower-bracket losses eliminate), handles the grand final (upper wins → tournament `completed` + `champion_team_id` + Hall of Champions; lower wins → enable reset), writes an **audit** row, and revalidates. **Withdrawals/forfeits** after the draw resolve like a loss for the absent team (`forfeit`), auto-advancing the opponent. **Unreport** is allowed only if downstream matches are still `scheduled`.

## IGN & rank verification — options

How much we trust the ranks captains enter. Pick per phase:

- **A. Manual (recommended to start).** Captains type IGNs + ranks; admins eyeball at review. Zero integration.
- **B. Riot RSO — "Sign in with Riot" (recommended target).** Players link their Riot account via OAuth; proves account ownership **and** lets us pull verified rank from the ranked API, setting `rank_verified`. Requires a Riot dev app with **production RSO approval** (lead time — apply early).
- **C. Ranked-API lookup (augment, not identity).** Look the summoner up on KR (Summoner-V4 / League-V4) to confirm it exists and auto-fill/validate the displayed rank — but this does **not** prove the Discord user owns it. Good paired with A.

Plan: ship **A**, layer in **C** to auto-fill rank display, move to **B** when stakes justify the RSO approval.

### Member profiles (future)

A lightweight middle ground that also improves signup UX. Let each verified member set their **IGN** once on a profile, and have the site pull their **current rank** from the Riot ranked API (League-V4 by summoner name on KR) on a refresh cadence. Team application then **pre-fills** each player's IGN + rank from their profile instead of the captain typing it — fewer errors, always-current ranks. It's self-asserted IGN + API-validated rank (not proof of ownership — that's RSO/B), but a strong bridge. Sketch:

```sql
CREATE TABLE profiles (            -- future enhancement
  discord_id      TEXT PRIMARY KEY,
  ign             TEXT,
  region          TEXT NOT NULL DEFAULT 'KR',
  current_rank    TEXT,
  peak_rank       TEXT,
  rank_updated_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Because every member already logs in with Discord, profiles need no extra auth — just a `/profile` page and a scheduled rank-refresh job.

## Website page flow

### `/tournaments` (hub)
- Featured current tournament + **Hall of Champions** + "how it works".
- Auth-aware CTA: **"Create a team"** when `signups_open` **and** the viewer is a Captain; **"Log in with Discord"** when logged out; "Ask an admin for the Captain role to enter" for members without it; "Signups closed" otherwise.

### `/tournaments/[slug]`
Renders by status: **pre-bracket** (hero + status + deadline; team grid of approved teams; apply CTA) · **bracket-released / in_progress** (bracket is the hero; sidebar of upcoming matches + recent results; team grid below) · **completed** (champion banner, final bracket, standings, VODs, photos).

### `/tournaments/[slug]/apply` — captain application (Captain role required).
### `/tournaments/[slug]/my-team` — captain roster/logo/disband (captain only).
### `/tournaments/[slug]/teams/[teamSlug]` — public team page: logo, roster, match history (approved teams only).

**Teams are per-tournament and start fresh every time.** Rosters don't carry over between tournaments (members come and go), so there's no persistent team identity or cross-tournament history — each tournament is a clean slate.

## Team card & roster modal spec

### Team card (grid)
Square or 3:4 portrait; `bg-surface`, hover `bg-elevated`; 1px `border`, hover `border-strong`; sharp corners. Logo top-center (80px, or initials-in-colored-box fallback). Name in Bebas Neue `display-sm` all-caps; tag below in `label` style; captain in `body-sm`; player-count badge ("5/5" or "5/5 +2") bottom-right; pending badge top-right only if pending. Click → roster modal.

### Roster modal (pop-out)
Backdrop blur; `bg-surface`, max-width 640px, sharp corners, `border`. Header: logo (96px), name (Bebas `display-md`), tag (`label`), captain with `brand-red` "C" badge, close button. **STARTERS** section; each row: avatar (40px, Discord CDN), IGN (`heading-md` 600), Discord username (`body-sm` muted), role chip (5v5 only), peak rank (Bebas, bright) over current rank (`body-sm` muted) on the right. **SUBSTITUTES** section at 70% opacity. Optional 4px `team.color` stripe at the bottom. Close on X, backdrop, Esc.

### Role badge colors
Uniform/subtle (`bg-elevated` + `text-primary`); FILL gets `brand-blue-muted` + `brand-blue-bright`. Lane icons instead of color are a later upgrade. (Hidden entirely for ARAM/custom modes.)

## Optional Discord bot (later)

Not required for anything above. If added, it's a **client** of the same Supabase DB (or just uses the bot token via REST): posts announcements (signups open, team approved, results, champion crowned), convenience `/myteam` reads, and — with Riot RSO — a rank-verification worker. Never a competing writer of truth.

## Environment variables (website)

```
# Auth.js (Discord OAuth)
AUTH_SECRET=
AUTH_DISCORD_ID=
AUTH_DISCORD_SECRET=

# Membership / role gating
DISCORD_GUILD_ID=
DISCORD_BOT_TOKEN=          # events/stats + member directory + role lookups (GUILD_MEMBERS intent enabled)
MEMBER_ROLE_ID=             # "LoLMK Verified" — REQUIRED to log in
CAPTAIN_ROLE_ID=            # "Captain" — may create a team
ADMIN_ROLE_ID=              # "Tournament Admin" — runs /admin

# Supabase Postgres
DATABASE_URL=               # Supavisor POOLED connection (port 6543) — used by serverless
DIRECT_URL=                 # direct connection (port 5432) — used by migrations only

# Supabase Storage (team logos)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=  # server-side only, never exposed to the browser

# Riot (verification — Phase 5)
RIOT_API_KEY=
```

## Data-access convention

Per `CLAUDE.md`: components never touch the DB directly. All reads/writes go through `src/lib/` helpers (`tournaments.ts`, `teams.ts`, `matches.ts`, `members.ts`, `champions.ts`) wrapping Kysely/Drizzle; Server Actions call these helpers. Types live once in `src/types/tournament.ts`.

## Backups

Supabase-managed: enable **automated daily backups + point-in-time recovery**. Snapshot manually before risky ops (bracket reset, disband, tournament delete). Storage (logos) is durable in the bucket.

## Phasing (web-first)

Each phase is independently shippable.

### Phase 1 — Auth + roles
Auth.js Discord login gated on the `LoLMK Verified` role; expose `isMember` / `isCaptain` / `isAdmin`; short sessions + re-check on sensitive actions. Real "logged in" state; the nav verified badge becomes real. **Needs from you: the guild ID and the numeric role IDs for `LoLMK Verified`, `Captain`, and `Tournament Admin`.**

### Phase 2 — DB + member directory + team application
Provision Supabase (pooler + storage); schema + migrations; `src/lib` helpers. Cached guild-member directory (bot token, `GUILD_MEMBERS` intent). Apply form (Captain-gated) + Server Action; multi-team + one-team-per-captain checks; teams land `pending`.

### Phase 3 — Admin review + My Team
Admin dashboard: review queue, approve/reject, balance check, disband, audit log. Captain My Team: edit roster/roles, subs, **logo upload** (Storage + `sharp` + moderation), disband.

### Phase 4 — Bracket + live admin
Random draw with random byes ("Seed bracket" button) + public bracket render. Admin match reporting with auto-advancement + forfeits. Live via `revalidateTag` (SSE for finals).

### Phase 5 — Verification + optional bot
Riot RSO account linking + rank verification (`rank_verified`); ranked-API auto-fill. Optional Discord bot (announcements, `/myteam`) as a same-DB client.

## Open questions

- **Numeric role IDs:** roles are decided — `LoLMK Verified` (login), `Captain` (create teams), `Tournament Admin` (admin). Still need the **numeric Discord role IDs + guild ID** for config.
- **Mode roster rules:** for ARAM / custom modes, confirm team size and whether subs are allowed (defaults: `team_size` from the tournament, roles only for `sr_5v5`).
- **IGN verification timing:** ship manual (A) first, or start the Riot **RSO** (B) production approval now given its lead time? The [member-profiles](#member-profiles-future) approach can bridge it.
