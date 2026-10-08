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

## Task 7 — Riftbound judges' floor view (`/tools/riftbound/[slug]/floor`)

The brief gave no task number; 7 follows Task 6 and the venue screen is task 8 (Task 6 refers to it). Rename if it's wrong.

**Built**

- `/tools/riftbound/[slug]/floor` (`page.tsx`): redirects to `/tools/login?next=…` without `isToolsSession()`, and also needs `getCurrentAdmin()` for the "Sends as <name>" line. Unknown slug is a 404. It renders `RbFloor`, a phone-first column (max 480px, full-screen over the site header like the desk).
- **Table list** (`judge-tables`): header with tournament, judge and signed-in name, Online/Offline, "Round N", "x of y outstanding · your tables 1–6" and the round clock; search (table-number prefix or player name); Mine / All / Flagged; OUTSTANDING (open flags first, then by table) and REPORTED below. Reported rows show the reporter only when it isn't you (reference: "Iris 2–0 Jun · Jin"). Byes aren't listed.
- **Score pad** (`judge-score-pad`): Table N, both players with their record going in (from the standings), the Riftbound Bo3/Bo1 `ScorePad` (pairs layout), "Decided on time" (on by default once the table is past its end time), drop toggles (only for active players), "+ Extension" (+1/+3/+5 min, `addExtension`) and "Flag to desk" (No-show, Judge call, Deck check, Need head judge; `flagTable`). "Other…" opens a games stepper.
- **Review card** (`judge-review`): the result at 96px for both players to read, the show-both-players line, Submit, "Sends as <name> · retries if offline" and `id xxxx`, the first four characters of the idempotency key.
- **Submissions** (`use-rb-submissions.ts`, `rb-floor-model.ts`): a submission shows Sending / Sent ✓ / Failed · will retry (or Rejected) in a strip above the bottom edge of the list, the table's row is locked while it is active, and "Sent" fades after 4s.
  - One key per pad opening (`floor-<uuid>`), kept when you go Back from the review. A second submission for the same table is refused by the queue (`rbEnqueue`), and `inFlight` blocks overlapping sends of one key, so a double tap sends one request.
  - A thrown error (offline, server down) leaves it Failed and it is sent again every 5s, on the browser's `online` event, and once after a refresh, always with the same key. The server already ignores a key it has recorded (`findMatchByIdempotencyKey`, checked before the "Reported by" test), so a retry after a lost response is a no-op.
  - `{ ok: false }` answers aren't retried: "Reported by …" becomes a conflict banner ("Table 7 · Reported by Jin at 14:02:11 KST.") on the list; anything else (round closed, bad score) is Rejected with Retry/Discard.
  - Unfinished submissions are written to `sessionStorage` (`rb-floor-pending:<slug>`) on every change and read back after a refresh; whatever was mid-flight comes back as Failed and is sent again.
- If the poll shows someone else reported the table while the pad or review is open, it says "Reported by X at T." and returns to the list.
- Polling is `useDeckState` at 2s on `/api/rb/admin-state`. The route now also returns `serverNow`; the floor uses the difference from the phone's clock, so the countdown follows the server's clock.
- Each step pushes a history entry, so the phone's Back button goes pad → list instead of leaving the page.
- `scripts/test-rb-floor.ts`: 103 checks on `rb-floor-model.ts` (round choice, judge ranges, list order, search and filters, going-in records, review text, queue classification, double-tap guard, sessionStorage round trip).

**Verified**

- `tsc --noEmit` clean. The new and changed files lint clean (`npm run lint` still fails on 22 pre-existing errors elsewhere). `test-rb-floor` (103), `test-rb-round` (96), `test-rb-setup` (79), `test-rb-clock` (74) pass.
- 390×844 against the three reference HTMLs, rendered in Chrome and compared element by element. List header 390×102, search input 358×46, pad header 390×73, back link, "Table N" title, "+ Extension" and "Flag to desk" (175×48 at the same positions), review header and result card (358×293 at 16,93) all match to the pixel. Differences: see Deviations.
- **Walkthrough, 69 checks** (Playwright with a touch, 390×844 mobile context against a throwaway page that ran the real `rb-service` operations on an in-memory store, deleted before the commit, so not repeatable from the repo):
  1. Header, range "your tables 1–6", judge call listed first, Mine only 1–6, All shows other judges' tables marked "not your table", Flagged, search by number (finds a table outside the range) and by name.
  2. Table → pad → phone Back → pad → score → review → Change → review → Submit **double-tapped**: one request, one `match.report` in the audit log, key `floor-…` on the match, "id" on the card equal to the key's first four characters, reporter "Ray".
  3. **Offline**: set the context offline, Submit: "Failed · will retry", Offline in the header, entry in sessionStorage, the table locked, nothing on the server. Back online and **refreshed**: delivered once, with the original key, storage emptied.
  4. **Refresh while sending keeps failing** (POSTs aborted): after the reload the submission is still there as Failed, tried again with the same key, nothing on the server; once POSTs work again it is delivered once with the original key.
  5. **Lost response**: the server recorded the result, the response was dropped; the phone showed Failed, retried with the same key, got the duplicate: still one report, ends as Sent.
  6. **Conflict**: Jin reported the table while the phone couldn't poll; Submit shows "Reported by Jin at hh:mm:ss KST", returns to the list, doesn't retry, Jin's result isn't overwritten; Dismiss clears it. A second case where the poll sees it while the pad is open returns to the list with the same message.
  7. Extension +3:00 stored; the four flag kinds; a Deck check flag stored with the raiser; flagged tables rise to the top.
  8. Past the end time (clock moved back 66 min): rows read "Time called", Decided on time is on by default, a 1–0 is stored with `decided_on_time`.
  - Every button, link and select on the list, pad, review, extension sheet and flag sheet measured at least 44×44px (checkboxes through their 44px labels).

**Deviations and why**

- **Flag kinds**: the brief names no-show, judge call, deck check, need head judge, but `RbDeskFlagKind` only had `judge_call | dispute | other`. Added `no_show`, `deck_check`, `head_judge` (flags are stored in jsonb, so no migration); `dispute` and `other` stay for old data. `FLAG_LABEL` has all six. The desk's table sheet still offers only Judge call and Dispute.
- **Filter chips are 44px tall** (reference 40, brief says ≥44), so the rows start 4px lower than the reference. The search input is 46px with its border, as in the reference. Outstanding rows are 66px and reported rows 50px, matching the reference's content-box sizes. ScorePad buttons are 60px (kit border-box) against 62px in the reference.
- **"Playing · game 3"**: nothing records game numbers, so the second line shows "Playing · 04:10 left" (that table's own time, including its extension).
- **Mine and search**: the reference shows table 7 "not your table" under Mine, which only makes sense if search ignores the filter. A non-empty search therefore looks at every table. A judge with no range, or not on the roster, sees all tables under Mine.
- **Who is judging**: matched by name (case-insensitive) against the roster. If the signed-in name isn't on it, a "Judging as" select appears and the pick is remembered in `localStorage`. This path is covered by unit tests of `rbJudgeFor` but wasn't clicked in the browser run (the test judge matched by name).
- **Header** shows the tournament name as written, uppercased ("PORO CUP"), where the reference has "POROCUP".
- **Decided on time** can't be turned off for a time-out lead (e.g. 1–0): the server rejects that score without it, so the review card shows it as on.
- **Rejected** (not in the spec): a third failure state for answers the server gave and won't change, with Retry and Discard, so they don't loop and don't disappear.
- **"Other…"** has no reference; I made a games stepper sheet (44px buttons).
- The pad shows the table's open flag or extension under the title (not in the reference).
- **Server clock**: `admin-state` and the floor page return `serverNow`. The desk (Task 6) still uses the browser clock for its countdown; that TODO from Task 6 stands.
- The reference only draws Mine/All/Flagged and OUTSTANDING/REPORTED; the empty states, banners and the submissions strip are mine.

**Known issues / TODO**

- Not run against Postgres, a real Discord session, a real phone, or Next's real server-action client. The harness called the same `rb-service` operations through `fetch`; that `reportResult`/`flagTable`/`addExtension` server actions reject (rather than hang) when the phone is offline is an assumption about Next's client, and `{ ok: false }` handling relies on `actions.ts` as read, not as run. Do this check on the first real device test.
- A request that hangs forever (connection open, no answer) keeps its key in flight and nothing retries it until a refresh. Server actions can't be aborted from the client; a timeout that marks it Failed would need `Promise.race` and care that the original may still land (the duplicate check makes that safe).
- Next serialises server-action calls from one page, so a stuck send queues the next result behind it.
- The Next dev overlay badge sits over the bottom-left of the phone screen in dev (it covers part of "+ Extension"); production has none.
- No table-sheet-style "undo" on the floor: a wrong submitted result is undone from the desk.
- Only the latest running Swiss round is shown; top-cut matches aren't on the floor (`reportTopCutResult` exists).

## Task 8 — Riftbound venue screen (`/rblive/[slug]`)

Numbered 8 as Tasks 6 and 7 anticipated; the brief gave no number.

**Built**

- `/rblive/[slug]` (`page.tsx`, noindex, no auth: public data only). `RbVenueScreen` polls `/api/rb/state` every 2s, like `SrLiveScreen`: a 404 shows "Not live yet", any other failure keeps the last good scene. A scene change fades out and in over 200ms (instant under reduced motion).
- `VenueFrame`: a fixed 1920×1080 stage scaled to fit the window with `min(w/1920, h/1080)`, centred and letterboxed. In the desk's 1920×1080 iframes the scale is 1; `LiveFrame` then shrinks the iframe, as with SR.
- Clock: `/api/rb/state` now also returns `serverNow`. The screen keeps its offset from the server's clock and computes everything from `clockRemainingMs`, so a skewed venue PC still shows the right time. No countdown is stored.
- Scenes (`rb-venue-scenes.tsx`, logic in `rb-venue-model.ts`):
  - `pairings`: one row per player, alphabetical (case-insensitive), "vs <opponent>" and the table number in the blue box; byes show "Bye". 3 columns × 11 rows = 33 per page, columns fill top to bottom, auto-page every 12s with "PAGE n / m" when there are more.
  - `pairings_clock`: the same with "TIME REMAINING" and the clock in the header.
  - `clock`: the round pill ("ROUND 3 OF 5", "TOP CUT ROUND n"), the 460px clock, PAUSED when paused, "SWISS · BEST OF n", and the round rail (every Swiss round plus "TOP n" when a cut is planned; done rounds full blue, the running round red and filled by clock progress). Background: `riftboundcardback-tile.png` tiled and rotated like the timer's `TimerBackground`, at 5% opacity.
  - **Time called** (`time-called`): drawn when the stored scene is `pairings_clock` or `clock` and the running Swiss round's clock has hit zero. Nothing is written. Pausing, an adjusted clock, an unstarted clock and a closed round all keep the normal scene. It lists pending tables that are out of time and, underneath, "Table N has +M:SS extension" for pending tables still running on an extension.
  - `standings`: top 16 as 8 + 8. Mid-event: "STANDINGS", "After round n of m", left header "1 – 8" with no cut header. Once every Swiss round is closed: "FINAL SWISS STANDINGS" and the left header becomes "TOP X · ADVANCING" in red with red ranks for the cut (X from `resolveTopCutSize`; none for tiny fields).
  - `idle`, `starting_soon`, `announcement`: left copy over the slabs and the logo at right, taken from `venue-champion.html`'s layout.
  - `champion` and `top_cut` (see Deviations).
- `?scene=<id>&preview=1` overrides the scene on the client only. Nothing on the page can write: the only network calls are GETs of `/api/rb/state`. Unknown scene ids are ignored. `?text=` feeds the announcement and `?at=<ISO time>` the starting-soon countdown (both only used with `?scene=`).
- `RB_VENUE_SCREEN_READY` is now true in `rb-broadcast.tsx`, so the Task 6 desk's Preview and Program monitors load `/rblive/<slug>?scene=<id>&preview=1` and `/rblive/<slug>`.
- `scripts/test-rb-venue.ts`: 74 checks (scene choice and derived time-called, rounds, alphabetical paging, the rail, time-called tables and extensions, the standings split and cut header).

**Verified**

- `tsc --noEmit` clean. No lint messages in any new or changed file (`npm run lint` still fails on 22 old errors elsewhere, so `next build` still stops at lint). `test-rb-venue` (74), `test-rb-floor` (103), `test-rb-round` (96), `test-rb-setup` (79), `test-rb-clock` (74) pass.
- At 1920×1080 in Chrome, the real route with `/api/rb/state` answered by a script (no database here), each scene was compared with its reference:
  - Pairings (clock) and Time called: every text element within the first 60 matches the reference's position and height (0 differences over 3px).
  - Clock: checked by eye against the PNG, plus the rail's positions (the automatic comparison was shifted by the reference's "Background:" footnote, which I dropped, so its header numbers aren't usable). Standings: checked by eye against the PNG. Header, both column headers, row positions and rank colours match; the deck line under each name is missing (see Deviations).
  - Idle, starting soon, announcement, champion and a 50-player pairings page (page indicator showing) were looked at; no clipping.
- Scaling: 1280×720 fills the window (scale 0.667); 1000×1000 letterboxes top and bottom.
- Polling: a 500 keeps the clock scene; a 404 shows "Not live yet"; the next good answer brings the scene back.
- The Task 6 iframes were **not** exercised against the desk. I only confirmed that the URLs `rb-broadcast.tsx` builds (`/rblive/<slug>?scene=<id>&preview=1`, `/rblive/<slug>`) are what the page serves. The desk harness from Task 6 was deleted, so the desk Preview/Program were not opened in a browser.

**Deviations and why**

- **No deck line** under standings names: the reference shows a legend ("Jinx", "Annie"), which is private by the public projection rule, so it isn't in `/api/rb/state`. Names are vertically centred instead.
- **Standings dummy data**: tiebreaker percentages come from the real standings; the sample values in the reference are fake.
- **Clock background** is a rotated, 5%-opacity tile like the timer (the asset is the League card back), not the diagonal stand-in lines.
- **`top_cut` shows the standings** and **`champion`** is a simple version (name, "CHAMPION", logo, "N PLAYERS · M ROUNDS · TOP X"). The brief didn't list them but the stored scene can be set to them, and a blank screen on TAKE would be worse. The bracket (`venue-top8.html`) and the champion's final score, Swiss and playoff records are not built; they need top-cut match data this screen doesn't read yet.
- **`starting_soon` and `announcement`** aren't in `RbScene` (Task 6 already marks the announcement scene unavailable), so the program can't select them and the stored scene never shows them; they're reachable only through `?scene=`. Starting soon needs `&at=<ISO>`; without it only the title shows. They use the champion reference's layout, because they have no reference of their own. I first tried SR-style centred text, which collided with the slabs.
- **Time-called**: tables on an extension are in the footnote only, as in the reference (table 6 isn't in the list). With more than 8 pending tables the squares shrink (4 columns, then 6 above 16) so the list stays on the screen. The three rules are fixed text.
- **Muted**: the SR screen's `?muted=1` exists to silence lock-in cues. The Riftbound screen has no audio, so there is no sound button and nothing to mute; `muted` is ignored.
- Logo is `/logo.svg` (the SR screens' logo) rather than the references' `logo.png`.
- `serverNow` was added to a public route (the number is harmless; the floor's equivalent was added in Task 7).

**Known issues / TODO**

- The pairings page shows the **stored** current round only: the latest running Swiss round, else the latest Swiss round. The top-cut bracket scene is still to be built.
- `Time called` is round-level. A table that was extended is only listed once its own time runs out; there is no separate tone for "extension running".
- The paging timer restarts when the number of pages changes, and pages are not synchronised across screens (each display pages on its own).
- Not tested on a real venue display, with real data from Postgres, or with the desk open; fonts load through next/font as on the other live screens (the references use the same families).
- The dev overlay's hydration warning on `<html>` also appears on `/srlive/*`; it is in the root layout, not this page.

## Task 9 — Top cut: desk workspace, venue bracket and champion scenes, Hall of Champions

**Built**

- `src/lib/rb-cut.ts` (pure): `replayTopCut` (moved here from `rb-service.ts`, which re-exports it), `rbCutView` (the bracket as absolutely positioned cards and connector lines, in the pixels of `venue-top8.html`: cards 460 wide, 70px rows, level-0 cards 200 apart, columns 600 apart for a top 8 and 800 for a top 4), `rbChampionSummary` (name, Legend, seed, final score, Swiss record, playoff record) and `rbChampionRecord` (the Hall of Champions row).
- Desk, Top cut phase: `rb-cut-model.ts` + `rb-cut-workspace.tsx`. Match queue of the current cut round, each table with Start match / Report result (the existing `ScorePad`, Bo3 or Bo1, no draws), no clock; reported list; scaled bracket; earlier rounds; activity log. "Undo latest result" (top of the workspace) clears the newest result of an open round. The primary action was already there from Task 6 (Publish → Close → Pair → "Complete event" once the final has a result).
- Venue: `VenueTopCut` (`rb-bracket.tsx` draws the cards: higher seed first, seed cell, name, Swiss record, score; losers and empty seats dimmed; red border plus a LIVE tag on a started, unreported table; supports 4 and 8; a top 2 or an unreadable cut falls back to standings) and a full `VenueChampion` (name, Legend · Seed, FINAL score and opponent, SWISS, PLAYOFFS, "N PLAYERS · M ROUNDS · TOP X").
- "Started" state: `rb_matches.started_at` (nullable), set by the new `setMatchStarted` operation (audit `match.start` / `match.unstart`). Display only: it never blocks a result. Added to `RbMatch`, the public match, the pg store, and an idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in `ensureSchema`. Only top-cut tables in a running round that have no result can be marked.
- `/api/rb/state` now also returns `champion` (summary), which is null until the event is completed.
- `completeEvent` already stored `status = completed` and `champion_player_id` (and followed the scene to champion). That is what SR does as well (its Hall reads completed tournaments back), so nothing extra is written: `getRiftboundChampions` in `champions.ts` reads completed Riftbound events (`listChampionEvents` in `rb-db.ts`) and `getChampions` merges them with the SR and legacy rows. A failing lookup returns no rows, the same as the SR lookup.
- Auto-follow: publishing or closing a top-cut round keeps the program on `top_cut` (it was Pairings / Standings, which are wrong for a bracket); the desk's "Auto-follow next" panel and `rbAutoFollow` say the same.
- Tests: `scripts/test-rb-cut.ts` (148 checks: a 4-player and an 8-player cut played to a champion through the real operations, LIVE tag, undo, seeds, bracket positions, winners/losers, summary, Hall row). The in-memory store was moved out of `test-rb-scenario.ts` to `scripts/rb-memory-store.ts` so both can use it.

**Verified**

- `tsc --noEmit` clean; no lint messages in any new or changed file (`npm run lint` still fails on the 22 old errors elsewhere). All seven `scripts/test-rb-*.ts` suites pass (cut 148, round 96, setup 79, clock 74, floor 103, venue 74, scenario 1003).
- In Chrome at 1920×1080 against a temporary harness (real `rb-service` over the in-memory store, desk and venue in a browser, since deleted): a 4-player and an 8-player cut were each played on the desk from "Cut to Top N" to "Complete event" by clicking only (publish, mark live, report through the ScorePad, undo and re-report the newest result, close, pair, complete): 25 and 34 checks, no page errors. The venue showed the LIVE tag on exactly the started table, and a champion with Legend, seed, final score, Swiss and playoff records.
- `top_cut` and `champion` were compared with `venue-top8.png` and `venue-champion.png` by eye (header, labels, card positions, connector lines, dimming, slabs, text positions). Not a pixel diff: the data differs from the reference's.

**Deviations and why**

- LIVE tag says "LIVE", not "LIVE · GAME 2": games in progress aren't recorded, only the result.
- Logo is `/logo.svg` (as Task 8), not the reference's `logo.png`, so the artwork differs slightly.
- A top 4 uses a 800px column pitch (the reference only shows a top 8) so the bracket fills the stage.
- Bye cards (only if a player dropped after the cut) show "Bye"; the player who advances is shown on the next card.
- The Hall row's date is the tournament's `updated_at`; the runner-up is the other finalist.

**Decisions**

- Task number 9 follows Task 8 (the brief gave none).
- "Started" is stored on the match (`started_at`), not derived, because nothing else says a table is in play; it is display-only so it can never block a result.
- The Hall of Champions reads completed events back (SR's pattern) instead of a separate champions write, so there is one source of truth and nothing to keep in sync.
- The Hall mapping lives in `rb-cut.ts` (not `champions.ts`) because `champions.ts` uses `@/` imports the Node test scripts can't load.
- The Legend is public only through the champion summary, and only once the event is completed.
- `replayTopCut` moved to `rb-cut.ts` so the desk, venue and service share one bracket; `rb-service.ts` re-exports it.
- The in-memory store moved to `scripts/rb-memory-store.ts` so two test scripts share it.

**Known issues / TODO**

- Not verified: the SQL (the new column, `listChampionEvents`, the insert) against a real Postgres; the Hall of Champions rendered with a Riftbound row (the mapping is tested, the page wasn't opened); the desk's Preview/Program iframes (still the Task 6/8 gap; the harness has no `/rblive` database behind it).
- Undo works on any result while the round is open (service rule); "Undo latest result" is just the shortcut for the newest.
- The Legend appears on the venue champion scene only after completion.
