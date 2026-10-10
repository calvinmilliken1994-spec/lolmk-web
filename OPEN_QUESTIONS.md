# Open questions

Things the redesign could not settle from the code, the database or the handover. Each entry says where it came from and what's needed to close it. Nothing here was filled in with guessed data.

## Architecture

### 1. The handover's data model doesn't match the repo (Phase 0)

`docs/redesign-handover.md` says the Discord bot owns all SQLite writes and the site reads through the bot's internal HTTP API with bearer auth. In this repo:

- The site reads and writes **Neon Postgres** directly through `@vercel/postgres` in `src/lib/*-db.ts` (`sr_*`, `mayhem_*`, `rb_*`, `member_*` tables).
- The writers are the `/tools` admin pages and the captain/member flows, not the bot.
- `C:/projects/LoLMK-bot` (SQLite + Hono API) is not a git repo, has an empty `data/` directory and no `.env`, and nothing in the site calls it.

**Decision (Calvin, 10 Oct 2026):** use the real stack. New public reads are read-only helpers in `src/lib/*-db.ts`. The only new write path is the `is_test` flag. **No bot API endpoints were added in any phase.**

**Needs:** update the handover's Stack line, or confirm the bot is meant to take over these tables later.

## Data

### 2. ARAM Mayhem Sep 2026 result isn't in the database (Phase 0)

The handover asks to seed "Sep 2026, Team Raptor, Gen.G GGX". The only `mayhem_events` row is the live `mayhem-main` (stage `collecting`, no champion), and seeding a real event needs rosters and matches we don't have.

**Decision (Calvin):** leave it out until it's entered through `/tools`. The Hall of Champions and the ARAM plate show nothing for ARAM until then.

**Needs:** a way to record a finished Mayhem event in `/tools` (today `mayhem-main` is a single live event that gets reset), or a completed archived event row created through the admin flow.

### 3. Poro Cup (11 Oct) is not a Discord scheduled event (Phase 0)

Homepage events come from Discord scheduled events (`src/lib/discord-events.ts`), with `src/data/events.json` used only when Discord is unreachable. On 10 Oct the guild had one scheduled event: "Riftbound Online!" on 14 Oct. The Poro Cup isn't there, and the only `rb_tournaments` row was "Poro Cup Test" (now flagged `is_test`).

No second events source was added.

**Needs:** create the Poro Cup as a scheduled event in Discord (it then appears on the homepage, in the Tournaments status bar and on the Riftbound plate). If it's run through `/tools/riftbound`, create the real tournament there with a date and venue.

### 4. Test data flagged in production (Phase 0, done)

With Calvin's approval, two prod rows were flagged after adding the column:

- `sr_tournaments` `test-2` ("LOLMK FALL TOURNAMENT 2026", champion "team c")
- `rb_tournaments` `poro-cup-test` ("Poro Cup Test")

They no longer appear in public listings, on public detail pages or in the Hall of Champions. The venue screens (`/srlive`, `/rblive`) still serve them by slug so rehearsals work. There is no `/tools` toggle for the flag yet. Set it with SQL, or add a toggle later.

### 5. The legacy champions file held only a demo row (Phase 0)

`src/data/champions.json` had one placeholder record dated 2025. It is now an empty array. Pre-2026 results can be added there (champion, tournament, date, game) when someone has the real data.

## Repo housekeeping

### 6. `CLAUDE.md` and `ROADMAP.md` are gitignored and missing locally (Phase 0)

Commit `3fc138c` removed root-level markdown from git ("kept locally, gitignored"), and `.gitignore` ignores `/*.md`. Neither file exists in this checkout, so they were read from `3fc138c^`. `OPEN_QUESTIONS.md` is whitelisted in `.gitignore` so it can be committed.

In Phase 1, `CLAUDE.md` was restored locally from `3fc138c^` and the redesign rules were appended. It stays gitignored, so the same rules are also in `assets/brand/colors.md`, `assets/brand/typography.md` and `assets/ui/components.md`, which are committed.

**Needs:** decide whether `CLAUDE.md` should be tracked again.

## Design system

### 7. Redesign tokens are namespaced, not replacements (Phase 1)

The handover's token names (`surface`, `line`, `text`, …) collide with existing Tailwind tokens used by the homepage and `/tools` with different values (`surface` `#10162A`, `line` `#1F2937`). Overwriting them would change the homepage, which must stay as it is. The new tokens live under `ds` (`bg-ds-surface`, `border-ds-line`, …). The handover's `ground` `#0B1021` is within a shade of the existing `#0A0E1A`, so the existing value is kept, as the handover allows.

**Needs:** when the homepage is redesigned, fold the old tokens into `ds` and drop the namespace.

### 8. Locker nav item waits for Phase 5 (Phase 2)

The handover's nav is Tournaments, Members, How-tos, Locker, About, with the signed-in avatar linking to `/locker`. `/locker` doesn't exist until Phase 5, so in Phase 2 the nav has no Locker item and the avatar links to `/members/profile`. Both switch in Phase 5.

## Tournaments

### 9. "Message an admin on Kakao" points at the community open chat (Phase 3)

The handover's signup band has an outline button "Message an admin on Kakao". The only Kakao link in the repo is the community open chat (`open.kakao.com/o/gIPbdi3e`, from `src/data/socials.json`), so the button uses that. **Needs:** an admin-specific Kakao link if there is one.

### 10. Hall of champions is empty until a real final is recorded (Phase 3)

After the Phase 0 test-data cleanup there is no completed, non-test tournament in the DB, and the legacy champions file only held a demo row (#5). The Hall of champions therefore shows its empty state, and the off-season status bar has no "Last winner" cell. Entering the September 2026 ARAM Mayhem result (#2) fills both automatically.

## Members, How-tos, About

### 11. Members stats: Admins and Game coordinators count the people listed, not the Discord role (Phase 4)

The handover asks for Admins and Game coordinators counts in the Members header. The site can only see members who have signed in (`member_profiles`); counting everyone with the Discord role needs the guild member list, which requires the bot's privileged Server Members intent. The stats count the people shown in each section, and a zero count is omitted. No profile has the coordinator category yet, because `DISCORD_COORDINATOR_ROLE_ID` isn't set. **Needs:** the coordinator role ID, and a decision on whether role totals matter enough to need the member list.

### 12. Any signed-in member can now opt into Members (Phase 4)

The handover adds a "Members (opted in)" section, so `updateProfile` no longer requires an admin or coordinator category to opt in. Sign-in is still limited to admins and verified members by the OAuth callback. The editor's toggle now reads "Show me on Members".

### 13. Champion splash art on member cards (Phase 4)

Cards use the member's favourite champion's splash from Riot Data Dragon (`ddragon.leagueoflegends.com/cdn/img/champion/splash/<Id>_0.jpg`). Riot's Legal Jibber Jabber policy (checked 10 Oct 2026) allows non-commercial fan use of game assets when the site shows its notice, so the footer now carries the policy's exact notice. **Needs:** confirmation that nothing on the site is paywalled or sold in a way that makes it commercial under that policy (the old /shop linked out to merch).

### 14. Two guides don't state when they were last checked (Phase 4)

"Make a KR account" and "Buy RP" say "Last checked: September 2026", so they carry `lastChecked: 2026-09`. "Switch the client to English" and "PC bang guide" don't, so they show no date rather than an invented one. The guides are TSX pages rather than MDX, so `lastChecked` and `readTime` live in `src/data/how-tos.ts` instead of frontmatter. Read times are the rendered word counts at 200 words a minute. **Needs:** check dates for the two guides.

### 15. About: partner details and history (Phase 4)

The partners section names Gen.G GGX and the Naver Riftbound TCG cafe with one plain line each and no links, because the repo has no URL for either. The history timeline is left out until Calvin supplies milestones, as the handover says. **Needs:** partner URLs and any copy you want for them.

