# TOURNAMENT.md

Complete spec for LoLMK's tournament system. The bot owns the data, the website displays it. Read this file in full before building tournament features (admin commands, signup flow, bracket generation, or the public tournament page).

## Architecture at a glance

```
Admins & captains (Discord slash commands + modals)
        ↓
Discord bot (discord.js v14, single Node.js process)
        ↓
SQLite (better-sqlite3, single file: tournaments.db)
        ↓
Bot's internal HTTP API (Express/Hono, 3-4 read endpoints)
        ↓
Website API routes (Next.js, cache 30-60s)
        ↓
Tournament pages (/tournaments, /tournaments/[slug])
```

**Single source of truth: SQLite file on the bot host.** The website never talks to Discord for tournament data. Discord is the interface; SQLite is the database.

## Why SQLite (not Postgres, not Discord-only)

- Free, zero external services
- Single file = trivial backups (copy the file)
- `better-sqlite3` is synchronous, blazing fast, no connection pooling concerns
- No rate limits, unlike pulling from Discord on every page load
- Migrates to Postgres in a single day if/when scale demands it
- Sufficient for 8–16 teams per tournament, quarterly cadence

## Tech stack

- **Bot**: Node.js + TypeScript + discord.js v14
- **Database**: SQLite via `better-sqlite3`
- **Migrations**: simple SQL files run on startup, or `kysely` for typed queries + migrations
- **Internal API**: Hono or Express, single port (e.g. 3001), bearer-token auth for the website only
- **Hosting**: Railway, Fly.io, or a small VPS. SQLite file lives on persistent disk.
- **Website**: existing Next.js app, reads via `fetch` from the bot's API with 30-60s revalidation

## Database schema

Run on bot startup if tables don't exist.

```sql
CREATE TABLE tournaments (
  id TEXT PRIMARY KEY,                   -- e.g. "q1-2026"
  slug TEXT UNIQUE NOT NULL,             -- URL slug, matches id by convention
  name TEXT NOT NULL,                    -- "Q1 2026 Tournament"
  season TEXT NOT NULL,                  -- "Q1 2026"
  format TEXT NOT NULL DEFAULT 'double_elim',  -- double_elim, single_elim (future)
  status TEXT NOT NULL DEFAULT 'draft',  -- draft, signups_open, signups_closed, bracket_released, in_progress, completed
  max_teams INTEGER NOT NULL DEFAULT 16,
  signup_deadline TEXT,                  -- ISO 8601
  start_date TEXT,                       -- ISO 8601
  end_date TEXT,                         -- ISO 8601
  description TEXT,
  prize_description TEXT,
  rules_url TEXT,
  champion_team_id TEXT,                 -- set when status = completed
  created_by TEXT NOT NULL,              -- Discord ID
  created_at TEXT NOT NULL,              -- ISO 8601
  updated_at TEXT NOT NULL
);

CREATE TABLE teams (
  id TEXT PRIMARY KEY,                   -- ulid or nanoid
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  tag TEXT NOT NULL,                     -- 2-4 char abbreviation, e.g. "APX"
  slug TEXT NOT NULL,                    -- URL slug derived from name
  logo_url TEXT,                         -- optional, captain-provided
  color TEXT,                            -- optional hex code for team branding
  captain_discord_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, withdrawn
  seed INTEGER,                          -- assigned at draw time, NULL before
  rejected_reason TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  UNIQUE (tournament_id, slug),
  UNIQUE (tournament_id, tag)
);

CREATE TABLE players (
  id TEXT PRIMARY KEY,                   -- ulid or nanoid
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  discord_username TEXT NOT NULL,        -- snapshot at signup time
  ign TEXT NOT NULL,                     -- in-game name on KR
  role TEXT NOT NULL,                    -- TOP, JUNGLE, MID, ADC, SUPPORT, FILL
  peak_rank TEXT,                        -- e.g. "DIAMOND_II", "MASTER", "GRANDMASTER", "CHALLENGER"
  current_rank TEXT,
  is_captain INTEGER NOT NULL DEFAULT 0, -- 0 or 1
  is_substitute INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  UNIQUE (team_id, discord_id)
);

CREATE TABLE matches (
  id TEXT PRIMARY KEY,                   -- ulid or nanoid
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  bracket TEXT NOT NULL,                 -- upper, lower, grand_final, grand_final_reset
  round_number INTEGER NOT NULL,         -- 1, 2, 3, ...
  match_number INTEGER NOT NULL,         -- unique within tournament for display ordering
  team_a_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  team_a_score INTEGER,
  team_b_score INTEGER,
  winner_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- scheduled, in_progress, completed, forfeit
  advances_to_match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  drops_to_match_id TEXT REFERENCES matches(id) ON DELETE SET NULL,
  scheduled_at TEXT,
  played_at TEXT,
  vod_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tournament_admins (
  tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  discord_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',    -- head_admin, admin
  added_at TEXT NOT NULL,
  PRIMARY KEY (tournament_id, discord_id)
);

CREATE INDEX idx_teams_tournament ON teams(tournament_id);
CREATE INDEX idx_teams_status ON teams(tournament_id, status);
CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_matches_tournament ON matches(tournament_id);
CREATE INDEX idx_matches_status ON matches(tournament_id, status);
```

### Ranks (use exact enum strings)

```
IRON_IV, IRON_III, IRON_II, IRON_I,
BRONZE_IV ... BRONZE_I,
SILVER_IV ... SILVER_I,
GOLD_IV ... GOLD_I,
PLATINUM_IV ... PLATINUM_I,
EMERALD_IV ... EMERALD_I,
DIAMOND_IV ... DIAMOND_I,
MASTER,
GRANDMASTER,
CHALLENGER
```

### Roles (use exact enum strings)

```
TOP, JUNGLE, MID, ADC, SUPPORT, FILL
```

## Tournament status flow

```
draft → signups_open → signups_closed → bracket_released → in_progress → completed
                ↑                                ↓
                └──── (admin can reopen) ─────────
```

Admin-controlled transitions. The bot validates that prerequisites are met before advancing (e.g. `bracket_released` requires at least 4 approved teams).

## Discord bot commands

All commands use Discord slash commands, gated by Discord roles. Define a `TOURNAMENT_ADMIN` role; all admin commands require it. Captain commands check team ownership at runtime.

### Tournament management (admin)

| Command | Purpose |
|---|---|
| `/tournament create` | Modal: name, season, max_teams, signup_deadline, start_date, description |
| `/tournament edit <id>` | Modal pre-filled with current values |
| `/tournament status <id> <status>` | Transition status; validates prerequisites |
| `/tournament list` | List all tournaments with status |
| `/tournament delete <id>` | Confirmation required; cascades to teams/matches |

### Team management (admin)

| Command | Purpose |
|---|---|
| `/team list <tournament>` | Show all teams with status |
| `/team approve <team>` | Approve pending signup; notifies captain |
| `/team reject <team> <reason>` | Reject pending signup with reason |
| `/team remove <team>` | Hard remove (use sparingly, prefer reject/withdraw) |
| `/team edit <team>` | Modal to edit team name, tag, logo, color |
| `/team set-captain <team> <user>` | Transfer captaincy |

### Captain commands

| Command | Purpose |
|---|---|
| `/signup <tournament>` | Opens modal — captain submits team details + roster |
| `/myteam roster` | Shows current roster |
| `/myteam edit-logo <url>` | Update team logo URL |
| `/myteam swap-player <out> <in>` | Swap a player (only before signup deadline) |
| `/myteam withdraw <reason>` | Captain-initiated withdrawal |

### Bracket commands (admin)

| Command | Purpose |
|---|---|
| `/bracket draw <tournament>` | Generates random double-elim bracket; sets seeds; transitions status to `bracket_released` |
| `/bracket reset <tournament>` | Wipes bracket back to `signups_closed`; confirmation required |
| `/bracket view <tournament>` | Posts current bracket state as a Discord embed |

### Match commands (admin)

| Command | Purpose |
|---|---|
| `/match report <match> <winner> <score>` | Records result; advances winner; drops loser (or eliminates) |
| `/match unreport <match>` | Undoes a result; only valid if no downstream matches have results |
| `/match schedule <match> <datetime>` | Set scheduled time |
| `/match set-vod <match> <url>` | Attach VOD link after the match |

### Public/read-only commands

| Command | Purpose |
|---|---|
| `/tournaments` | List active and recent tournaments with website links |
| `/standings <tournament>` | Current standings or bracket summary |
| `/team info <team>` | Show team roster |
| `/schedule <tournament>` | Upcoming matches |

## Signup flow (modal-driven)

Captain runs `/signup tournament:q1-2026`. Bot opens a modal with these fields:

1. Team name (text input)
2. Team tag (text input, 2-4 chars, uppercase enforced)
3. Captain confirmation — Discord auto-fills from command user
4. Players — 5 lines of "discord_mention | ign | role | current_rank | peak_rank"

Modal validation:
- Team name unique within tournament
- Tag unique within tournament, alphanumeric, 2-4 chars
- Exactly 5 players (Top, Jungle, Mid, ADC, Support) — substitutes added after approval
- Captain must be one of the 5 listed players
- All Discord IDs must be valid members of the server

On submit:
- Team created with `status = pending`
- Players inserted
- Announcement posted to admin review channel with embed + Approve/Reject buttons
- Captain receives DM confirmation

Admins click Approve/Reject buttons in the review channel (or run `/team approve`). On approval:
- Team status → `approved`
- Captain DM'd
- Public team-created announcement posted to tournament announcement channel
- Discord role `Q1 2026 — <Team Name>` auto-created and assigned to all roster members
- Captain gets `Q1 2026 — Captain` role

## Bracket generation algorithm

When `/bracket draw` runs:

1. Pull all teams where `status = 'approved'` for the tournament
2. Validate count: 4, 6, 8, 12, 16 (otherwise error — odd-count handling with byes is added in a later phase if needed)
3. Shuffle teams with Fisher-Yates
4. Assign seeds 1..N in shuffle order
5. Generate match records:
   - Upper bracket: standard single-elim shape with N teams
   - Lower bracket: standard double-elim lower bracket shape (depends on N)
   - Grand finals: 1 match + 1 conditional reset match
6. Populate `team_a_id` and `team_b_id` for round 1 of upper bracket only; all other matches start with null teams
7. Populate `advances_to_match_id` and `drops_to_match_id` for every match (this is the wiring)
8. Set tournament status → `bracket_released`
9. Post bracket image/embed to Discord announcement channel
10. Ping all captains via team roles

### Match counts by team count (double elim)

| Teams | Upper matches | Lower matches | Grand finals | Total |
|---|---|---|---|---|
| 4 | 3 | 2 | 2 | 7 |
| 8 | 7 | 6 | 2 | 15 |
| 16 | 15 | 14 | 2 | 31 |

(Counts include the conditional grand-final reset match — only played if the lower-bracket team wins the first grand finals.)

### Bracket library

Use **`@g-loot/react-tournament-brackets`** on the website for rendering. Theme it to match the LoLMK palette (`brand-red`, `brand-blue`, `bg-surface`). Only build a custom SVG bracket if the library cannot match the lolesports broadcast visual target after styling.

## Match reporting flow

Admin runs `/match report match_id:<auto-complete> winner:<team A | team B> score:<2-0 | 2-1>` after a match concludes.

Bot performs:

1. Validate caller has admin permission
2. Validate match exists and status != `completed`
3. Validate winner is one of `team_a_id` or `team_b_id`
4. Update match: `winner_id`, `team_a_score`, `team_b_score`, `status = completed`, `played_at = now`
5. Advance winner:
   - Find `advances_to_match_id`
   - Insert winner into the next available team slot (a or b) on that match
6. Drop loser (for upper bracket matches):
   - Find `drops_to_match_id`
   - Insert loser into the next available team slot on that match
   - For lower bracket losses, loser is eliminated (no drop target)
7. If this was the grand finals:
   - If upper-bracket team won: mark tournament `completed`, set `champion_team_id`
   - If lower-bracket team won: enable grand_final_reset match
8. Post result announcement to Discord channel
9. The website's next data fetch (within 30-60s cache TTL) picks up the changes

### Match unreport

Only allowed if the match's downstream matches (winner advance + loser drop) are both still `scheduled` (no results reported on them yet). Otherwise the admin must unreport downstream first.

## Bot internal HTTP API

The bot exposes a small read-only HTTP API on a port (e.g. 3001) for the website to consume. Bearer-token auth — token shared between bot and website via env var.

| Endpoint | Returns |
|---|---|
| `GET /api/tournaments` | List all tournaments (id, slug, name, season, status, dates) |
| `GET /api/tournaments/:slug` | Full tournament + all teams + all players + all matches |
| `GET /api/tournaments/:slug/teams` | Just teams + players for the pre-bracket view |
| `GET /api/tournaments/:slug/bracket` | Just the matches for the bracket view |
| `GET /api/tournaments/:slug/team/:teamSlug` | Single team + roster |

All endpoints return JSON. Response shapes match the TypeScript types in `src/types/tournament.ts` on the website side (shared types should be defined once and ideally shared via a small package, or duplicated if monorepo isn't set up).

### Website caching

Website API routes wrap these endpoints and apply Next.js fetch caching:

```ts
const res = await fetch(`${BOT_API}/tournaments/${slug}`, {
  headers: { Authorization: `Bearer ${BOT_API_TOKEN}` },
  next: { revalidate: 60 }, // refresh every 60 seconds
});
```

During an active tournament weekend, drop the revalidate to 30s. After the tournament completes, bump to 3600 (1 hour) since data is static.

## Website page flow

### `/tournaments` (hub)

- Featured current tournament (large card)
- Past tournaments grid
- "How tournaments work" section
- Sign-up CTA when signups are open

### `/tournaments/[slug]`

Conditionally renders based on tournament status:

**Pre-bracket (`draft`, `signups_open`, `signups_closed`)**
- Hero with tournament name + status badge + signup deadline countdown
- Team grid (12-16 cards in a responsive grid: 4 cols desktop, 2 cols tablet, 1 col mobile)
- "Sign up via Discord" CTA → links to Discord with instructions on running `/signup`
- "Bracket draw on [date]" announcement when signups_closed

**Bracket-released (`bracket_released`, `in_progress`)**
- Hero with tournament name + status badge
- Full bracket visualization (hero of the page)
- Sidebar: upcoming matches + recent results
- Team grid below bracket (cards still clickable for rosters)

**Completed (`completed`)**
- Hero with champion banner (winning team featured)
- Final bracket
- MVP / awards section if data exists
- Photo gallery from the tournament
- Final standings table
- VOD links collected from match records

### `/tournaments/[slug]/teams/[teamSlug]`

- Team logo, name, tag
- Captain + full roster
- Match history within this tournament
- Cross-tournament history (placeholder for Phase 2 when teams persist across tournaments)

## Team card and roster modal spec

### Team card (in grid)

- Aspect ratio: 3:4 portrait or square
- Background: `bg-surface`; hover → `bg-elevated`
- Border: 1px `border-default`; hover → `border-strong`
- Layout:
  - Logo top-center (80px circle, or initials-in-colored-box fallback if no logo)
  - Team name in Bebas Neue `display-sm`, all caps, `text-primary`
  - Team tag below in `label` style (uppercase, tracked, `text-muted`)
  - Captain name in `body-sm`, `text-secondary`
  - Player count badge bottom-right ("5/5" or "5/5 +2")
  - Status badge top-right (only shown if pending — `brand-red-muted` background)
- Cursor: pointer
- Click → opens team modal

### Team roster modal (pop-out)

- Backdrop: `bg-overlay`, blur 4px
- Container: `bg-surface`, max-width 640px, full-width on mobile, sharp corners, `border-default` border
- Header section:
  - Team logo (96px circle, left)
  - Team name in Bebas Neue `display-md`, all caps
  - Team tag below in `label` style
  - Captain name with `brand-red` "C" badge
  - Close button top-right
- Starters section heading: "STARTERS" in `label` style
- Each player row:
  - Avatar (40px circle, from Discord CDN)
  - Player IGN in `heading-md`, weight 600
  - Discord username in `body-sm`, `text-muted` (smaller, below IGN)
  - Role badge — color-coded chip with role name
  - Right side: peak rank (Bebas Neue, bright) and current rank (`body-sm`, muted) stacked
- Substitutes section: same row style, with "SUBSTITUTES" label above, 70% opacity
- Footer: optional 4px team color stripe at the bottom if `team.color` is set
- Close behaviors: X button, click backdrop, Esc key

### Role badge colors

Match the lane/role aesthetic. These can be subtle since role isn't a brand moment:

- TOP: `bg-elevated` + `text-primary`
- JUNGLE: `bg-elevated` + `text-primary`
- MID: `bg-elevated` + `text-primary`
- ADC: `bg-elevated` + `text-primary`
- SUPPORT: `bg-elevated` + `text-primary`
- FILL: `brand-blue-muted` + `brand-blue-bright`

Keep them uniform unless visual differentiation becomes important — broadcast tournaments often use lane icons instead of color, which is a Phase 2 upgrade.

## Project structure (bot)

Separate repo or `apps/bot` if monorepo. Suggested layout:

```
LoLMK-bot/
├── src/
│   ├── commands/
│   │   ├── tournament/
│   │   │   ├── create.ts
│   │   │   ├── edit.ts
│   │   │   ├── status.ts
│   │   │   ├── list.ts
│   │   │   └── delete.ts
│   │   ├── team/
│   │   │   ├── list.ts
│   │   │   ├── approve.ts
│   │   │   ├── reject.ts
│   │   │   ├── remove.ts
│   │   │   ├── edit.ts
│   │   │   └── set-captain.ts
│   │   ├── captain/
│   │   │   ├── signup.ts
│   │   │   ├── myteam-roster.ts
│   │   │   ├── myteam-edit-logo.ts
│   │   │   ├── myteam-swap-player.ts
│   │   │   └── myteam-withdraw.ts
│   │   ├── bracket/
│   │   │   ├── draw.ts
│   │   │   ├── reset.ts
│   │   │   └── view.ts
│   │   ├── match/
│   │   │   ├── report.ts
│   │   │   ├── unreport.ts
│   │   │   ├── schedule.ts
│   │   │   └── set-vod.ts
│   │   └── public/
│   │       ├── tournaments.ts
│   │       ├── standings.ts
│   │       ├── team-info.ts
│   │       └── schedule.ts
│   ├── modals/
│   │   ├── tournament-create.ts
│   │   ├── tournament-edit.ts
│   │   ├── team-edit.ts
│   │   └── signup.ts
│   ├── events/
│   │   ├── ready.ts
│   │   ├── interactionCreate.ts        (slash command + modal + button router)
│   │   └── guildMemberRemove.ts        (handle captains leaving server)
│   ├── lib/
│   │   ├── db.ts                       (better-sqlite3 instance)
│   │   ├── migrations.ts               (run SQL on startup)
│   │   ├── bracket.ts                  (bracket generation logic)
│   │   ├── permissions.ts              (admin/captain role checks)
│   │   ├── notifications.ts            (channel/DM announcements)
│   │   └── validate.ts                 (input validation)
│   ├── api/                            (HTTP API for website)
│   │   ├── server.ts                   (Hono/Express setup)
│   │   ├── routes/
│   │   │   ├── tournaments.ts
│   │   │   ├── teams.ts
│   │   │   └── matches.ts
│   │   └── auth.ts                     (bearer token middleware)
│   ├── types/
│   │   ├── tournament.ts
│   │   ├── team.ts
│   │   ├── match.ts
│   │   └── shared.ts                   (synced with website types)
│   ├── config.ts                       (env vars, channel IDs, role IDs)
│   └── index.ts                        (bot entry, register commands, start API)
├── data/                               (.gitignored — SQLite file lives here)
│   └── tournaments.db
├── migrations/                         (.sql files)
│   ├── 001_initial_schema.sql
│   └── ...
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

## Environment variables

### Bot

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=

# Channel IDs
ANNOUNCEMENT_CHANNEL_ID=
ADMIN_REVIEW_CHANNEL_ID=
TOURNAMENT_LOG_CHANNEL_ID=

# Role IDs
TOURNAMENT_ADMIN_ROLE_ID=
HEAD_ADMIN_ROLE_ID=

# Database
DATABASE_PATH=./data/tournaments.db

# Internal API
API_PORT=3001
API_TOKEN=                              # generated, shared with website
```

### Website (add to existing .env)

```
BOT_API_URL=https://bot.lolmk.com       # or localhost:3001 in dev
BOT_API_TOKEN=                          # matches bot's API_TOKEN
```

## Backup strategy

The SQLite file is the entire database. Treat it like gold.

- **Automated backup**: cron job copies `tournaments.db` to a backup directory hourly, retains last 168 (1 week). Optionally also uploads to S3/R2/Backblaze daily.
- **Manual backup before risky operations**: admin command `/db backup` triggers a snapshot copy on demand. Useful before `/bracket reset` or `/tournament delete`.
- **Verify backups occasionally**: spin up the bot pointing at a backup file in a staging env to confirm it works.

## Migration story (if you outgrow SQLite)

When to migrate (none of these apply yet):
- Concurrent writes from multiple bot processes (you'd run more than one bot — unlikely)
- Website needs to write to the DB (member self-edit profiles, for instance)
- Cross-server scaling needed
- Real-time subscriptions for live bracket updates

Migration path: `better-sqlite3` → `pg` (node-postgres) is mostly a connection string change. SQL syntax is 95% compatible. Use Kysely from day one to make the migration trivial — same query builder works for both.

## Phasing

### Phase 1 — Minimum viable tournament

Goal: run Q1 2026 with admin-driven operations.

- DB schema + migrations
- `/tournament create`, `/tournament status`, `/tournament list`
- `/team create` (admin), `/team approve`, `/team list`
- Bot HTTP API with tournament + teams + bracket endpoints
- Website renders `/tournaments/[slug]` for both pre-bracket and bracket states
- `/bracket draw` for 4/8/16 teams
- `/match report` with bracket advancement

Captains don't self-serve yet; admins enter teams. Ship this first, run a real tournament with it.

### Phase 2 — Captain self-service

- `/signup` modal
- Admin approve/reject buttons in admin channel
- `/myteam` commands
- Auto-role assignment on approval
- Notification system (DMs, channel posts)

### Phase 3 — Polish

- `/match unreport`, schedule changes
- VOD attachment
- Photo gallery integration with tournament page
- Standings table for round-robin (if format expands)
- Cross-tournament team/player history

### Phase 4 — Future ideas

- Riot API integration for rank verification
- Live bracket updates via websockets
- Captain dashboard on the website (requires website auth — Discord OAuth)
- Tournament templates for recurring formats

## Open questions

- Are tournaments single-server only (just LoLMK's Discord) or could the bot run for other communities? Phase 1 assumes single-server. Architecture supports multi-server with a small `server_id` column addition.
- Do we want team logos enforced (require upload at signup) or optional (placeholder if missing)? Phase 1: optional with placeholder.
- Should match results require confirmation from both team captains, or is admin-reported sufficient? Phase 1: admin-only. Captain confirmation is a Phase 3 polish if disputes arise.
- Tiebreaker rules for round-robin format? Not relevant for Phase 1 (double elim only).
- Do we ever need to support odd team counts with byes (6, 12)? Phase 1: yes, but only for even-power-of-2 plus 6 and 12. Other counts error out.
