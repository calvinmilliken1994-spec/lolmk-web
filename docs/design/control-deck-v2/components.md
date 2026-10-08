# Components

Shared kit lives in `src/components/control-deck/`. Tool-specific pieces live with their tool (`src/components/riftbound/`, `src/components/sr/`, `src/components/mayhem/`). Prop shapes below are sketches; adjust to the real types.

## Shell (shared)

### `DeckShell`
The four-zone layout used by every tool's admin page. See `desk-round-live.html`.
- Top bar → `DeckTopBar`
- Left → `PhaseRail` (200px)
- Centre → the current phase's workspace (`children`)
- Right → `BroadcastColumn` (340–420px)
- Columns wrap below ~1100px; the rail and broadcast column stack under the workspace.

```ts
<DeckShell definition={deckDef} state={state}>{workspace}</DeckShell>
```

### `DeckDefinition` (per tool)
```ts
interface DeckDefinition<S> {
  tool: 'riftbound' | 'sr' | 'mayhem';
  phases(state: S): Phase[];                 // id, label, status: done|live|next|off, meta?
  primaryAction(state: S): PrimaryAction;    // label, enabled, reason?, run()
  scenes: SceneDef[];                        // id, label, available(state)
  autoFollow(prev: S, next: S): SceneId | null;
  workspace(phaseId: string): ComponentType;
}
```

### `DeckTopBar`
Back link, event name, status chip (mono, e.g. `ROUND 3 / 5 · LIVE`), optional clock with Pause/Adjust, `OnAirChip`, `SyncIndicator`, `PrimaryAction`.

### `PrimaryAction`
One button, always the single next step. When blocked: disabled styling (`primary-disabled`) and the reason underneath in `warning-ink` (e.g. "5 tables outstanding"). When enabled: `brand-red`, with an optional neutral hint underneath.

### `PhaseRail`
Vertical list. Dot states: done (`success`), live (`brand-red-bright`, row highlighted with `brand-blue-bright` border), next (hollow), off (struck through, `ink-disabled`). Every row is clickable to view that phase's workspace.

### `BroadcastColumn`
- Header: "BROADCAST" kicker + Auto-follow checkbox.
- `ScenePreview`: iframe of the live screen with `?scene=<id>&preview=1` (client-side scene override; writes nothing). Border `brand-blue-bright`.
- TAKE button: calls the tool's existing `setScene` action.
- `SceneProgram`: the existing live-preview iframe (`SrLivePreview` / `MayhemLivePreview` generalised to `LiveFrame`). Border `brand-red`.
- Scene grid: 2 columns. Program scene = `onair-surface` + red border; preview scene = `brand-blue-muted` + blue border; unavailable = dashed `line`.
- Optional tool slot below the grid (UBR1 reveal for SR, team reveal for Mayhem, "auto-follow next" summary for Riftbound).

### `OnAirChip`, `SyncIndicator`, `ActivityLog`
- `OnAirChip`: red dot + "ON AIR" + current scene name.
- `SyncIndicator`: "● Synced Ns ago"; turns `warning-ink` after 10s without a successful poll.
- `ActivityLog`: newest first, mono timestamp, actor name, description; **Undo** only on the latest reversible entry.

### `ScorePad`
Buttons for **valid final scores only**, so an impossible score can't be entered.
- Bo1: `A wins` / `B wins` (Mayhem today).
- Bo3: `A 2–0`, `A 2–1`, `B 2–1`, `B 2–0`; Riftbound adds `A 1–0`, `B 1–0`, `Draw`, `Other…`.
- Bo5: same pattern.
- Player-A buttons use `brand-blue-muted`, Player-B buttons use `elevated`, so the two sides read apart at a glance.

### `useDeckState`
Extract from the duplicated logic in `sr-admin-detail.tsx` / `mayhem-admin.tsx`: 2s poll, `fetchSeq` stale-response guard, `run(fn)` wrapper with pending state, `lastSyncedAt`.

## Riftbound

| Component | Screen | Notes |
|---|---|---|
| `RbSetupChecklist` | desk-setup | Step cards: done ✓ (`success-surface`), open (number on `brand-blue`), todo (hollow), warn ! (`warning-surface`). |
| `RbFormatStep` | desk-setup | Segmented controls, Auto with computed hint, Locks note. |
| `RbRoundWorkspace` | desk-round-live | Filter chips, keyboard table jump, progress bar, `AlertStrip`, `TableGrid`. |
| `TableTile` | desk-round-live | States: reported / playing / flagged / bye. Click opens a desk `ScorePad` sheet. |
| `AlertStrip` | desk-round-live | Warning surface, Acknowledge button. |
| `JudgeTableList` | judge-tables | Server clock, search, Mine/All/Flagged, outstanding then reported. |
| `JudgeScorePad` | judge-score-pad | Player cards, `ScorePad`, on-time + drop toggles, Extension, Flag to desk. |
| `JudgeReviewCard` | judge-review | Large result card, "show both players", Submit, sending identity + idempotency id. |
| `VenueFrame` | all venue | Fixed 1920×1080, scaled to fit, LoLMK logo header. |
| `VenuePairings` | venue-pairings | Alphabetical, 3 columns × 11 rows; auto-pages when players > 33. |
| `VenueClock` | venue-clock | Server-time countdown, round rail (Swiss rounds + top cut). |
| `VenueTimeCalled` | venue-time | Three-step rules, tables still playing, extension note. |
| `VenueStandings` | venue-standings | Two columns of 8; left header = cut. Mid-event: top 16 by rank, no cut header. |
| `VenueTopCut` | venue-top8 | Reuse `bracket-engine` single-elim data. Absolutely-positioned cards + connector lines. LIVE tag on in-progress match. |
| `VenueChampion` | venue-champion | Name, Legend, seed, final score, Swiss + playoff records. |

## SR (port)

| Component | Screen | Notes |
|---|---|---|
| `SrMatchQueue` | sr-desk-live | Now playing (with `ScorePad`), Up next (readiness + Start), Waiting (dashed). Replaces the full bracket list as the default live view. |
| UBR1 reveal | sr-desk-live | Moves from the bracket panel into the broadcast column tool slot. |

## Mayhem (port)

| Component | Screen | Notes |
|---|---|---|
| `MayhemTeamsWorkspace` | mayhem-desk-teams | Team cards: on screen (solid) vs hidden (dashed). Re-roll locked once reveal starts (confirm this rule; see `behaviour.md`). |
| Team reveal | mayhem-desk-teams | Broadcast column tool slot: progress segments, auto-reveal toggle, Hide last, Restart. |
