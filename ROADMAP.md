# ROADMAP.md

The plan for building LoLMK's website in phases. Phase 1 ships a complete, useful site with no backend. Phase 2 and 3 are deferred until the community needs the features.

---

## Phase 1 — MVP (current)

Goal: ship a polished, professional site that recruits, informs, and showcases. No backend. All content lives in the repo as markdown/JSON. Admins update content by pushing to GitHub; the site rebuilds automatically.

### Pages to build

- [ ] **`/` — Landing page**
  - Hero with logo, tagline, primary CTAs (KakaoTalk + Discord)
  - Live stats strip (Discord online count, member count, next event countdown) — static for now, structured for live data later
  - "Three pillars" cards → Members / Tournaments / How-tos
  - Event calendar section (upcoming + recurring schedule)
  - Photo highlights horizontal strip (recent event photos)
  - Featured members grid (4–6 cards)
  - Socials inline (Instagram link/embed, Kakao, Discord)
  - About blurb
  - Final CTA
- [ ] **`/tournaments` — Tournament hub**
  - Featured current/upcoming tournament card
  - Live standings table for the active tournament
  - Bracket view for the active tournament
  - "Past tournaments" archive grid
  - "How tournaments work" blurb
  - Register CTA
- [ ] **`/tournaments/[slug]` — Individual tournament page**
  - Tournament info (dates, format, prize)
  - Status-driven rendering: pre-bracket (team grid + roster modals) vs bracket-released (bracket hero) vs completed (champion banner)
  - Teams roster grid with clickable team cards → roster pop-out
  - Standings table for round-robin formats
  - Bracket visualization via `@g-loot/react-tournament-brackets`, themed to brand
  - Match history with scores and VOD links
  - Awards / MVP / recap
  - **Data source**: read-only HTTP API exposed by the LoLMK Discord bot (see `assets/TOURNAMENT.md`)
- [ ] **`/members` — Member directory**
  - Filter by role (Streamers / Content Creators / Community Leaders / Active Members)
  - Card per person (avatar, IGN, role, social links)
  - Data source: `src/data/members.json`
- [ ] **`/how-tos` — Knowledge base index**
  - Categorized list of guides
  - Categories: Getting Started on KR, Playing on KR, Living the Community
- [ ] **`/how-tos/[slug]` — Individual guide**
  - MDX rendering with table of contents
  - Last updated date
  - Related guides at bottom
- [ ] **`/shop`**
  - Grid of items (image, name, price, description)
  - "Buy" buttons link externally to actual stores (Printful, Etsy, Coupang, Gmarket, etc.)
  - No on-site checkout
- [ ] **`/about`**
  - Story, mission, admin team, contact
- [ ] **`/404` and `/500`** — branded error pages

### Initial how-to articles to write

Highest-traffic SEO and most-asked Discord questions. Write at least these for launch:

- How to make a KR account from abroad
- How to make a KR account from inside Korea
- How to switch the LoL client to English on KR
- How to buy RP in Korea (foreigner-friendly payment methods)
- PC bang guide for foreigners
- KR server etiquette and common Korean pings
- How to get to LoL Park / LCK ticket guide

### Routes scaffolded but not built (placeholders)

These routes exist with "Coming soon" content so the URLs are reserved and navigation can link to them later. Do not flesh them out in Phase 1.

- `/members/[slug]` — individual member profile pages
- `/tournaments/[slug]/teams/[teamSlug]` — team profile pages
- `/scrims` — organized scrim signup
- `/in-houses` — in-house game signup
- `/lck` — LCK watch party hub

---

## LoLMK Tournament Bot (separate project, runs in parallel)

A Discord bot + SQLite database that owns all tournament data. The website's `/tournaments` pages read from a small HTTP API the bot exposes. Full spec lives in `assets/TOURNAMENT.md` — read that before building any tournament feature.

### Bot Phase 1 — Minimum viable tournament

Goal: run Q1 2026 with admin-driven operations end-to-end.

- [ ] Node.js + TypeScript + discord.js v14 project scaffolded
- [ ] SQLite schema + migration runner (`better-sqlite3`)
- [ ] Tournament management commands: `/tournament create`, `/tournament status`, `/tournament list`, `/tournament edit`
- [ ] Team management (admin): `/team create`, `/team approve`, `/team reject`, `/team list`, `/team edit`
- [ ] Bracket generation: `/bracket draw` for 4 / 8 / 16 teams (double elim)
- [ ] Match reporting: `/match report` with automatic advancement and loser drop
- [ ] Internal HTTP API on port 3001 with bearer-token auth (Hono or Express)
- [ ] Endpoints: `GET /tournaments`, `GET /tournaments/:slug`, `GET /tournaments/:slug/bracket`
- [ ] Backup cron: SQLite file copy hourly, retain 168
- [ ] Deploy to Railway / Fly.io / VPS with persistent disk

### Bot Phase 2 — Captain self-service

- [ ] `/signup` modal flow for captains
- [ ] Admin approve/reject buttons in review channel
- [ ] `/myteam` commands: roster, edit-logo, swap-player, withdraw
- [ ] Auto-role assignment on team approval (Q{quarter} {year} — {Team Name} roles)
- [ ] Notification layer: announcements, captain DMs, admin pings

### Bot Phase 3 — Polish

- [ ] `/match unreport` with downstream-match validation
- [ ] `/match schedule`, `/match set-vod`
- [ ] Photo upload/attachment pipeline tied to tournament page
- [ ] Public commands: `/standings`, `/team info`, `/schedule`, `/tournaments`
- [ ] 6-team and 12-team brackets with byes

### Bot Phase 4 — Future

- [ ] Riot API integration for IGN verification and live rank lookup
- [ ] Live bracket updates via websockets pushed to website
- [ ] Captain dashboard on the website (requires Discord OAuth)
- [ ] Tournament templates and cloning
- [ ] Multi-server support (if other communities ever want it)

---

## Phase 2 — Content management (when admin team grows)

Trigger: when more than 2–3 admins need to update content and pushing to GitHub becomes a bottleneck.

- [ ] Add headless CMS (Sanity or Payload recommended)
- [ ] Migrate `src/content/` and `src/data/` to CMS-backed
- [ ] Keep `src/lib/` helper signatures identical — only the implementation changes
- [ ] Admin dashboard for non-technical contributors
- [ ] Image upload pipeline for events and tournaments
- [ ] Draft/publish workflow

---

## Phase 3 — Interactive features (when community needs them)

Trigger: when specific features are clearly requested or needed.

- [ ] **Authentication** — Supabase Auth or Clerk. Discord OAuth as primary login.
- [ ] **Tournament signups** — team registration form, captain submits roster, admin approves
- [ ] **Live tournament data** — real-time bracket updates, score reporting
- [ ] **Scrim/in-house RSVP** — date picker, attendance tracking, role/lane preferences
- [ ] **Member self-edit profiles** — members claim their profile via Discord OAuth, edit their own bio/socials
- [ ] **Shop with on-site checkout** — Stripe or Toss Payments + inventory
- [ ] **LCK hub** — full page with watch party schedule, ticket guides, current standings

---

## Phase 4 — Stretch / "if it makes sense"

Ideas that may or may not happen depending on community direction.

- Event RSVPs with attendance count and reminders
- Member spotlight blog/news section
- Community-submitted guides with editorial review
- LFG (looking-for-group) board for duo/team finding
- Korean-language version of the site
- Mobile app (only if web isn't enough — usually it is)

---

## Decisions log

Track major architectural or product decisions here so future contributors understand why things are the way they are.

- **2026-05** — Chose markdown-first content for Phase 1. Rationale: zero backend cost, fast to ship, works well for current content volume. Migration path to CMS is clear via `src/lib/` abstraction.
- **2026-05** — No standalone gallery page. Rationale: photos contextualize better when attached to their tournament or event. A central gallery becomes a maintenance burden with low payoff.
- **2026-05** — No standalone socials page. Rationale: only Instagram is active currently. Inline links on landing page is sufficient until more platforms are added.
- **2026-05** — Shop links externally. Rationale: avoids backend, payment processing, and inventory complexity until shop volume justifies it.
- **2026-05** — Tournament data lives in SQLite on the Discord bot host (not Postgres, not Discord-as-DB). Rationale: zero external services, single-file backups, no rate-limit risk, sufficient for 8–16 team quarterly tournaments. Migration to Postgres is a 1-day job if scale demands it. Full spec in `assets/TOURNAMENT.md`.
- **2026-05** — Discord bot owns all tournament data writes; website is read-only via a small HTTP API the bot exposes. Rationale: clean separation, admins manage from Discord where they already are, website never blocks on Discord rate limits.
