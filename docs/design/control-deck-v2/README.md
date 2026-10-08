# Control Deck v2 — design handoff

Visual spec for the redesigned operator UI ("control deck"), the judge phone view, and the Riftbound venue screen. Riftbound ships it first; SR and ARAM Mayhem move onto the same shell afterwards.

This folder is a **design reference**, not code to copy. Read this file first, then `tokens.md`, `components.md`, `behaviour.md`.

## What's here

| Path | What it is |
|---|---|
| `screens/*.html` | Static HTML of every approved screen, flattened from the design canvas. Open `screens/index.html` in a browser to see all of them. |
| `screens/png/` | Exported PNGs of the same screens (added by Calvin from the design canvas). Treat these as the visual ground truth if they differ from the HTML. |
| `tokens.md` | Every colour/font in the screens mapped to the existing Tailwind tokens, plus the few new tokens this design needs. |
| `components.md` | The shared `components/control-deck/` kit: what each component is, where it appears, and its props. |
| `behaviour.md` | Rules the static screens can't show: primary-action logic, auto-follow, judge reporting flow, venue scene rules. |

## Screens

| File | Frame | Notes |
|---|---|---|
| `desk-round-live.html` | 1440×1000, fluid | Riftbound desk during a live round. The canonical shell. |
| `desk-setup.html` | 1440×1000, fluid | Same shell, Setup phase: checklist + Format step open. |
| `judge-tables.html` | 390×844 | Judge phone: table list. Links through the flow. |
| `judge-score-pad.html` | 390×844 | Judge phone: score pad for one table. |
| `judge-review.html` | 390×844 | Judge phone: review card shown to both players, then submit. |
| `venue-pairings.html` | 1920×1080, fixed | Alphabetical pairings, 3 columns. |
| `venue-clock.html` | 1920×1080, fixed | Round clock + round rail. |
| `venue-time.html` | 1920×1080, fixed | Time-called takeover + tables still playing. |
| `venue-standings.html` | 1920×1080, fixed | Final Swiss standings; the column split is the cut line. |
| `venue-top8.html` | 1920×1080, fixed | Top 8 single-elim bracket. |
| `venue-champion.html` | 1920×1080, fixed | Champion. |
| `sr-desk-live.html` | 1440×1000, fluid | SR on the new shell: live phase, match queue. |
| `mayhem-desk-teams.html` | 1440×1000, fluid | Mayhem on the new shell: teams phase, reveal controls. |

## Fidelity rules

1. **Match layout, hierarchy, spacing, type scale and colour exactly.** These screens were approved as-is. Measure from the HTML (open devtools) when unsure.
2. **Do not copy the markup.** The HTML uses inline styles because it came out of a design tool. Rebuild with Tailwind using the tokens in `tokens.md`, in the repo's existing component style. No inline `style=` except for genuinely dynamic values (progress widths, bracket positions).
3. **All data in the screens is fake.** Player names, Legends, records, team names, judges and times are placeholders. Bind to real types/state.
4. **Mono font is Chakra Petch** (`font-mono`, `--font-chakra`), matching `src/app/layout.tsx`. The canvas was drawn with JetBrains Mono from `assets/brand/typography.md`, which is out of date on this point; the static files have already been switched to Chakra Petch.
5. **Venue screens are fixed 1920×1080** and scaled to fit the viewport, the same way the existing SR/Mayhem live screens are. Desk screens are fluid; the columns wrap at narrow widths.
6. **Riftbound art.** The clock scene's diagonal-line background is a stand-in. Use the existing timer assets in `public/images/timer/` (`riftboundcardback-tile.png`) there.
7. **Brand red is reserved** for ON AIR, TAKE, the primary action, and venue-screen accents. Status colours never use brand red. See `tokens.md`.

## Where this goes in the repo

Put this folder at `docs/design/control-deck-v2/` and reference it from `CLAUDE.md` / `.hermes.md` as the authoritative UI spec for tool admin pages, the judge view and Riftbound live screens. Note that the "What NOT to build" list in `CLAUDE.md` and the missing `assets/TOURNAMENT.md` reference need updating before this work starts.

## Build order (UI side)

1. Shared kit in `src/components/control-deck/` (see `components.md`) + `useDeckState` hook extracted from the duplicated poll/`fetchSeq`/`run` logic in `sr-admin-detail.tsx` and `mayhem-admin.tsx`.
2. Riftbound desk (setup + round live) and judge view together; they share result actions.
3. Riftbound venue screen (`/rblive/[slug]`).
4. Port Mayhem, then SR, onto the shell. **UI-only**: their server actions and schemas stay as they are, apart from audit actor columns.

Engine, schema and Swiss rules are specified separately in the Riftbound handover (`docs/RIFTBOUND.md`).
