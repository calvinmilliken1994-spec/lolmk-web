# Riftbound build log

One entry per task: what was built, deviations from `docs/RIFTBOUND.md` and
`docs/design/control-deck-v2/`, decisions, and known issues. Newest last.

## Task 4 — Control Deck v2 shared kit

**Built**

- `tailwind.config.ts`: the "New tokens" from `tokens.md`. `success` and
  `warning` became nested colours (`DEFAULT` keeps the old value, so
  `bg-success`, `text-warning`, `bg-success/10` still work), adding
  `success-surface`, `success-ink`, `warning-surface`,
  `warning-surface-strong`, `warning-tile`, `warning-line`,
  `warning-line-quiet`, `warning-ink`. New: `deck-rail`, `deck-tile`, `link`,
  `onair-surface`, `primary-disabled`, `primary-disabled-ink`, `venue-row`,
  `venue-row-alt`, `venue-card`, `venue-time`, `venue-time-ink`. The `#0D1225`
  clock stand-in was not added (tokens.md says replace it with the card-back
  tile).
- `src/components/control-deck/`:
  - `types.ts`: `DeckDefinition<S>`, `DeckPhase`, `DeckPrimaryAction`,
    `DeckSceneDef`, `DeckWorkspaceProps`, `DeckRun`.
  - `use-deck-state.ts`: `useDeckState({ initial, url, intervalMs, parse })`.
    2s poll, `fetchSeq` stale-response guard, `run(fn)` with pending state and
    an immediate refresh, `lastSyncedAt`. `run` surfaces both thrown errors
    (SR/Mayhem actions) and `{ ok: false, error }` results (Riftbound
    actions), and resolves to the action's result so callers can read data
    such as `swapDraftPairing` warnings.
  - `deck-shell.tsx` (`DeckShell`), `deck-top-bar.tsx` (`DeckTopBar`),
    `phase-rail.tsx` (`PhaseRail`), `status.tsx` (`PrimaryAction`,
    `OnAirChip`, `SyncIndicator`, `AlertStrip`, `ActivityLog`,
    `DeckKicker`), `broadcast-column.tsx` (`BroadcastColumn`, `ScenePreview`,
    `TakeButton`, `SceneProgram`, `SceneGrid`, `BroadcastNote`),
    `live-frame.tsx` (`LiveFrame`), `score-pad.tsx` (`ScorePad`,
    `padButtons`), `index.ts` barrel.
- `/tools/deck-preview` (behind `isToolsSession`): `DeckShell` with mock data
  copied from `desk-round-live.html`. **TODO: delete
  `src/app/tools/deck-preview/` once the Riftbound desk runs on DeckShell.**

**Verified**

- Rendered the reference HTML and the kit side by side in headless Chrome at
  1440×1000 and compared element boxes. Header (86px), rail (225px),
  workspace (842px), broadcast column (373px), every table tile, the alert
  strip, activity rows, preview/TAKE/program monitors, the scene grid and the
  tool slot land on the same pixels. Remaining differences are under 3px of
  text width (see Known issues).
- At 1000px the workspace goes first at full width, then rail, then broadcast
  column; no horizontal overflow.
- ScorePad Bo1 / Bo3 / Bo5, phone (`pairs`) and desk (`row`) layouts, with and
  without the Riftbound extras.
- `npm run typecheck` clean. The new files lint clean.

**Deviations and why**

- Column sizes: the reference HTML is content-box (rail 200px, workspace basis
  560px, broadcast 340–420px, each plus padding and border); Tailwind is
  border-box. The shell uses the rendered outer sizes (225 / 600 / 373–453px)
  so the layout lands on the same pixels.
- The table-jump input in the reference renders 172×34 (content-box 150×32
  plus padding and border). The PNG shows 172 wide, so the mock uses 172×34.
- The Auto-follow checkbox gets explicit `m-[3px] ml-1`: the reference relies
  on the browser's default checkbox margins, which Tailwind's preflight
  removes.
- Type sizes and a few spacings use arbitrary values (`text-[13px]`,
  `py-[3px]`, `h-[22px]`, …). The desk uses 8–40px sizes with
  `line-height: normal`, and the fontSize scale's tokens (`caption`,
  `body-sm`, `label`) carry their own line heights and tracking that would
  shift the layout. Colours are tokens only. The only inline styles are the
  progress-bar width and the LiveFrame iframe transform.
- The monitors in the preview page show mock scenes through
  `LiveFrame src={null}`: there is no `/rblive` screen yet, so the real iframe
  path can't be compared. With a `src`, LiveFrame is the
  SrLivePreview/MayhemLivePreview iframe, scaled from 1920×1080.
- The preview page covers the site header (`fixed inset-0 z-[60]`, like the
  live screens) so the deck can be compared against the 1440×1000 frame.
  `DeckShell` itself doesn't, so on a real tools page the 64px site header
  sits above it. Decide whether the desk pages hide the site header.
- `PhaseRail` highlights the *selected* phase (the live one by default). The
  spec only describes the live row; clicking another phase to view it moves
  the highlight there.
- ScorePad order: the desk layout follows `sr-desk-live` (`A 2–0, A 2–1,
  B 2–1, B 2–0`), the phone layout follows `judge-score-pad` (A and B side
  by side per score). The Riftbound extras are the time-out leads (`1–0` in
  Bo3; `1–0`, `2–0`, `2–1` in Bo5), `Draw` at level games (Bo1 `0–0`, Bo3
  `1–1`, Bo5 `2–2`) and `Other…`. Bo5 Riftbound isn't in the spec; it follows
  the same pattern.
- `ActivityLog` shows Undo on the newest *reversible* entry, so a newer
  non-reversible entry (a judge call) doesn't hide it. Times are KST.

**Decisions**

- `DeckDefinition.primaryAction` returns `null` when there is no primary step
  (top cut pending, per `behaviour.md`); the button is then hidden.
- `DeckDefinition.autoFollow` is kept for describing what auto-follow will do
  next; the switch itself stays server-side (rb-service).
- `TAKE` is disabled while preview equals program.
- SR's `useRunner` and MayhemAdmin's poll were left untouched; they move onto
  `useDeckState` when those desks are ported.

**Known issues / TODO**

- Chakra Petch weight 400 isn't loaded (`src/app/layout.tsx` loads 500/600/700,
  matching `assets/brand/typography.md`). The reference uses 400 for most mono
  labels, so ours render at 500 and run ~1.5% wider (e.g. the status chip is
  2px wider). Adding 400 would also thin every unweighted mono label on the
  public site, so it was left for a decision.
- `←` and `→` render with Inter's arrow glyph here and a fallback font in the
  reference, so "← Riftbound" is ~3px wider.
- The PNG export was drawn with JetBrains Mono; mono text follows the HTML
  (Chakra Petch) per README rule 4.
- The Riftbound mock offers an "Announcement" scene (from the reference);
  `RbScene` has no announcement scene. Add it or drop the button when the real
  desk is built.
- Every page, including `/`, logs an existing React hydration attribute
  mismatch in dev; it isn't from this kit.
- Delete `/tools/deck-preview` (see above).
- `npm run lint` still fails on 22 existing errors in other files (19
  unescaped `'`, 2 `require()` imports, 1 `prefer-const`).

## Task 5 — Riftbound admin list and desk (Setup, Check-in)

**Built**

- `/tools/riftbound` (list + Create, `RbAdminList`, SrAdminList pattern, Archive but no Delete) and `/tools/riftbound/[slug]` (`RbDesk`: DeckShell + Riftbound DeckDefinition, polling `/api/rb/admin-state`). Riftbound added to the `/tools` index.
- Phases: Setup, Check-in, Swiss rounds, Top cut, Complete. Primary action labels and blocked reasons follow behaviour.md and are covered by `scripts/test-rb-setup.ts` (79 checks).
- Setup workspace: `RbSetupChecklist` (six steps) with the panel on the right: Event basics, `RbFormatStep` (Auto hints and Locks note as in the reference), Players (member search, guest, bulk paste, Legend), Check-in, Judges (optional table ranges, QR + link to `/tools/riftbound/[slug]/floor`), Venue screen (QR + link to `/rblive/[slug]`, "Mark tested").
- Check-in workspace: searchable list, tap to check in/undo, running count, walk-in guest.
- Locked settings are read-only with the reason shown (`rbLocks`).
- Pure logic lives in `rb-setup-model.ts` / `rb-deck-model.ts` (testable under node).

**Deviations and why**

- Added `date`, `venue`, `judges`, `venueTestedAt` to `RbTournamentConfig`: Event basics and the Judges/Venue steps need somewhere to store them. `venueTestedAt` is set only by `markVenueTested`; `updateConfig` strips it.
- Member search uses `/api/mayhem/member-search`: no `/api/members` route exists.
- Judges are a free-text roster in config, not a role; judges still sign in as tools admins.
- QR codes are rendered client-side (`qrcode-generator`, new dependency) from the page's own origin.
- `getCurrentAdmin()` now also returns `discordUserId` (needed for audit actors).
- Swiss rounds, Top cut and Complete phases show a placeholder workspace; the round desk is a later task. The primary action for those phases already works.
- Setup step cards are 82px tall to match the reference. Measured at 1440×1000 with a common fallback font, the header, rail, both sections and all controls matched the reference positions. Fonts differ in dev because web fonts were not loaded in the headless check.

**Known issues / TODO**

- Not exercised against a real Postgres; the page was visually checked with mock state only (a temporary preview page, removed).
- Same Chakra Petch 400 / arrow-glyph caveats as Task 4.
- Round desk, floor view and venue screen contents are still pending.
- `npm run lint` still has pre-existing issues elsewhere; the new files lint clean.
