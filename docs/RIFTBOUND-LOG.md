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

## Task 6 — Riftbound round desk (Swiss rounds workspace)

The task number isn't in the brief; 6 follows Task 5 and sits before the venue screen (task 8). Rename if it's wrong.

**Built**

- `RbRoundWorkspace` (`rb-round-workspace.tsx`) for the Swiss rounds phase, one view per state of the latest Swiss round:
  - **Draft**: pairings list, select-to-swap or drag-onto (both call `swapDraftPairing`), warnings inline on the table they belong to (rematch, point mismatch, second bye). Primary action in the top bar: Publish Round N.
  - **Published / live / time**: filter chips (All / Outstanding / Flagged with counts), keyboard table jump, progress bar with judges, `AlertStrip` per open desk flag (Acknowledge), `TableGrid` of `TableTile`s (reported with the reporter's name, playing, waiting, flagged, over time, bye), `ActivityLog`.
  - **Closed**: standings summary (rank, record, points, OMW/GW/OGW, cut line after the last Swiss round), then the primary action (Pair Round N+1, Cut to Top X, or Complete event).
- `RbTableSheet`: opens from a tile. `ScorePad` (desk row layout, Riftbound variant, Bo3 or Bo1), "Other…" with games A/B/drawn, drop toggles (take effect with the result), extension controls (+1/+3/+5 with a reason, `addExtension`), flag to desk, acknowledge, and Undo result for a reported table.
- Top-bar clock from `clockRemainingMs`: Pause/Resume (`pauseClock`/`resumeClock`) and ± Adjust (`RbClockSheet`, ±1/±5 min via `adjustClock`). Shown while the latest round is published (full time, Adjust only) or live. The status chip reads `ROUND 3 / 5 · TIME` once time is called (derived).
- `RbBroadcast`: scene grid → Preview, TAKE (`setScene`), Auto-follow checkbox (`setAutoFollow`), "auto-follow next" panel with the next two transitions from behaviour.md, plus the paused/off notes. Preview loads `/rblive/[slug]?scene=<id>&preview=1` once `RB_VENUE_SCREEN_READY` is flipped to true; until then both monitors show a placeholder.
- Desk idempotency key: `newDeskKey()` → `desk-<uuid>`. The table sheet makes one when it opens and reuses it for retries; the keyboard path makes one per submit. It falls back to `getRandomValues` because the desk is often opened over plain http on the LAN, where `crypto.randomUUID` doesn't exist.
- Keyboard jump: type digits (anywhere on the desk when no field has focus, or in the field), then `a` A 2–0, `s` A 2–1, `k` B 2–1, `l` B 2–0, `d` draw (Bo1: `a`, `l`, `d`). Result keys submit immediately; Enter opens the sheet; Esc clears. Reported, bye and unknown tables are refused with the reason on the progress line.
- Shared kit additions: `DeckSheet` (right-hand sheet: Esc, backdrop, focus trap and restore) and `useNow`.
- `rb-round-model.ts` holds the pure logic (tiles, filters, result keys, draft warnings, activity + Undo rule, auto-follow next, formatting, desk key). `scripts/test-rb-round.ts` covers it (96 checks).
- `src/lib/rb-clock.ts`: the clock section of `rb-db.ts` moved here unchanged and re-exported from `rb-db.ts`. `rb-db.ts` imports the Postgres driver, so a client component couldn't import `clockRemainingMs` from it.
- `rb-actions.ts` + `RbDesk({ actions, stateUrl })`: the desk takes its server actions as a prop (default: the real ones), and `makeRbDeckDefinition(actions)` does too. This is what let the desk be driven without a database (see Verified).

**Verified**

- `tsc --noEmit` clean. `scripts/test-rb-round.ts` (96), `test-rb-setup.ts` (79) and `test-rb-clock.ts` (74) pass. The new and changed files lint clean (`next lint` reports nothing for them).
- 1440×1000 against `desk-round-live.html`: rendered both in Chrome and compared element boxes. Header, table jump input, progress bar, all 16 tiles (tile 1 at 245,280 193×93), activity section and the TAKE button land on the same pixels; the broadcast column is 1px narrower (kit flex rounding). Text widths differ by 1–3px (Chakra Petch 400 and the arrow glyph, see Task 4).
- **Walkthrough of one full round** (Playwright against a throwaway page that ran the real `rb-service` operations on an in-memory store; the page was deleted before the commit, so it can't be repeated from the repo). 31 players, Round 1:
  1. Draft: 15 tables + bye, "No warnings", Publish Round 1 enabled. Swapped two players by select and two by drag; each audited as `round.override`.
  2. Published (then Undo from the log back to draft, then published again): tiles read WAITING, program moved to Pairings, auto-follow next listed "Clock started → Pairings + clock".
  3. Started the clock: 60:00 counting down, program → Pairings + clock, Close Round 1 disabled with "15 tables outstanding".
  4. Table 1 through the sheet (A 2–0): stored with a `desk-…` key and the reporter; the tile shows REPORTED + reporter. Tables 2 and 3 through the keyboard (`2 s`, then `3 l` typed with nothing focused). Re-keying a reported table, and table 99, were refused with a message.
  5. Judge call on table 4: AlertStrip, flagged tile, Flagged filter, Acknowledge.
  6. Table 5: +3:00 extension on the tile, then a result with a drop. Undo (the only Undo button) cleared the result and the drop together.
  7. Pause held the clock and the tiles read Paused; Resume; ± Adjust +5 → ~64:xx.
  8. Moved the clock back 66 min: chip TIME, tiles OVER TIME, 00:00, auto-follow next → "Round closed → Standings". Table 5, with its +3:00, still read PLAYING.
  9. Reported the rest by keyboard, closed the round (program → Standings), closed summary shown, primary action "Pair Round 2".
  10. The Round 2 draft showed a forced rematch inline. Clock scene into Preview → TAKE (`setScene`; auto-follow paused and the panel said so); Auto-follow toggled off and on; Announcement stayed unavailable.
  11. Separately ran all five rounds through the same service: after Round 5 the summary shows the cut line below rank 8 and the primary action is "Cut to Top 8".
  77 checks passed in the scripted run.
- Not run against Postgres or with a real Discord session (no local database; `POSTGRES_URL` points at hosted data, which I didn't touch). The SQL store and the auth gate are still exercised only by the earlier tasks' tests.

**Deviations and why**

- **Announcement scene**: shown in the grid but unavailable (dashed). `RbScene` and the `rb_tournaments_scene_check` constraint have no `announcement`, and it would need text storage plus a venue renderer. Add it with the venue screen if wanted. The grid also gets a Champion button, only once the event is complete (the reference has seven buttons; `champion` is a stored scene).
- **Top-cut bracket** scene is unavailable until the cut is made (the existing availability rule, now `rbSceneAvailable`); the reference shows it selectable mid-event.
- `RB_SCENE_LABEL.top_cut` renamed "Top cut" → "Top-cut bracket" (reference label; also used by the ON AIR chip).
- The phase rail still has the five phases from Task 5 (Swiss rounds with `R3/5`), not one row per round as in the reference. There is no round picker, so only the latest Swiss round can be viewed.
- Activity shows four lines (reference), stretching to include the newest undoable entry so Undo can't be pushed out of view.
- Undo covers: the newest report of a table in an open round (it also undoes drops recorded with it), un-publishing a round with no results and no clock started, and a plain drop while only a draft round exists after it. Disqualification is never offered. Un-publish isn't offered once the clock runs, although `unpublishRound` would allow it.
- Result keys submit immediately without a confirm; the log's Undo is the safety net. `decided_on_time` isn't asked: the desk sets it exactly for scores where nobody reached the wins needed and the games aren't level (a time-out lead), which is when the server requires it.
- Draft warnings are recomputed from state with `validateManualPairings` (plus a second-bye check it doesn't do) rather than taken from the swap response, so they survive a reload and another admin's swaps.
- The sheet's note field is shared by the extension reason and the flag note (default "Judge call").
- The Next dev overlay's "1 Issue" is the existing hydration warning that every page logs (Task 4), not from this work.

**Known issues / TODO**

- Flip `RB_VENUE_SCREEN_READY` in `rb-broadcast.tsx` when `/rblive/[slug]` exists, and check the iframe scaling.
- The top-bar clock subtracts server timestamps from the browser's clock, so a desk machine with a skewed clock shows a skewed countdown. `admin-state` could return the server time for an offset.
- Top cut and Complete phases are still placeholders.
- `/tools/deck-preview` is still there (Task 4 TODO; the Riftbound desk now runs on `DeckShell`, SR and Mayhem don't).
- `npm run lint` still fails on 22 existing errors in unrelated files (`react/no-unescaped-entities`, `require()`, `prefer-const`), which also stops `next build` at its lint step. `.eslintrc.json` was untracked before this task and is left out of the commit.
- No browser test of two desks reporting the same table at once; that relies on the server's row locks and the `Reported by …` message, covered in `test-rb-scenario.ts`.
