# Tokens

Every colour in `screens/*.html`, mapped to `tailwind.config.ts`. Use the token, never the hex.

## Existing tokens (use as-is)

| Hex | Token | Used for |
|---|---|---|
| `#0A0E1A` | `base` | Page background, venue background, preview/program frames |
| `#10162A` | `surface` | Top bar, cards, table tiles (reported), inputs |
| `#1A2240` | `elevated` | Active phase row, playing state pills, venue seed boxes |
| `#F5F5F7` | `ink` | Primary text |
| `#B8BCC8` | `ink-secondary` | Secondary text, inactive buttons |
| `#8B8D98` | `ink-muted` | Labels, kickers, timestamps |
| `#4A4D5A` | `ink-disabled` | Disabled controls, skipped phases |
| `#1F2937` | `line` | Column dividers, quiet borders |
| `#2D3A52` | `line-strong` | Default button/card borders |
| `#141B2E` | `line-subtle` | Bye tile pill background |
| `#BA263C` | `brand-red` | ON AIR border, TAKE, primary action, venue accents |
| `#E94560` | `brand-red-bright` | ON AIR dot, live/current markers, venue kickers |
| `#5A1422` | `brand-red-muted` | Disabled primary action border |
| `#283D74` | `brand-blue` | Venue table-number blocks, open checklist step badge |
| `#4A65A8` | `brand-blue-bright` | Selected / focused / preview borders, active segmented option |
| `#1A2547` | `brand-blue-muted` | Selected segmented option fill, "Player A" pad buttons |
| `#22C55E` | `success` | Done dots, reported progress bar |

## New tokens this design needs

Add these to `tailwind.config.ts` rather than writing hex inline. Names are suggestions; keep them consistent.

| Hex | Proposed token | Used for |
|---|---|---|
| `#0D1222` | `deck-rail` | Phase rail and broadcast column background |
| `#141B32` | `deck-tile` | Table tile in "playing" state |
| `#7F97D6` | `link` | Links and "PREVIEW" label on dark surfaces (brand-blue-bright fails contrast for small text) |
| `#2A0D16` | `onair-surface` | ON AIR chip fill, program-scene button fill |
| `#3A1520` / `#D9A0AA` | `primary-disabled` / `primary-disabled-ink` | Primary action when blocked |
| `#0F2A1A` / `#4ADE80` | `success-surface` / `success-ink` | Reported pills, done badges (the base `success` is too dark for 10–12px text) |
| `#2E210A`, `#241A08`, `#1C1710` | `warning-surface`, `warning-surface-strong`, `warning-tile` | Judge-call pills, alert strip, flagged tile |
| `#8A6418`, `#6B4A12` | `warning-line`, `warning-line-quiet` | Flagged tile border, alert strip border |
| `#F5B54A` | `warning-ink` | Warning text ("5 tables outstanding", judge call) |
| `#121931`, `#0E1428` | `venue-row`, `venue-row-alt` | Venue zebra rows (pairings, standings) |
| `#151C36` | `venue-card` | Bracket card row (winner / undecided) |
| `#8E1C2E` | `venue-time` | Time-called takeover panel |
| `#FFC2CC` | `venue-time-ink` | Step numbers on the time-called scene |
| `#0D1225` | (clock stand-in pattern only) | Replace with the card-back tile, then drop |

## Type

| Role | Family / token | Sizes seen |
|---|---|---|
| Display: clocks, scores, scene titles | Bebas Neue, `font-display` | Desk clock 40px; venue 34–460px |
| Headings, button labels, names on venue | Space Grotesk, `font-heading` | 15–40px, weight 600–700 |
| Body, player names on desk/phone | Inter, `font-sans` | 12–16px desk, 26–30px venue names |
| Kickers, table numbers, records, timestamps | Chakra Petch, `font-mono` | 10–22px, often uppercase with 0.06–0.1em tracking |

Use the existing `fontSize` scale where it matches (`label`, `caption`, `body-sm`, `heading-md`, `display-xl`). Venue sizes are bigger than anything in the scale; define them locally in the venue components rather than adding global tokens.

## Shape and spacing

- Radius: `rounded-sm` (2px) everywhere. Nothing is pill-shaped except status dots.
- Desk gutters: 20px main padding, 16px side columns, 8–10px grid gaps.
- Venue: 72px side padding, 48px top/bottom; skewed panels at `skewX(-14deg)`, skewed tags at `-12deg`.
- Touch targets on the judge view are at least 44px tall; pad buttons are 52–60px.
