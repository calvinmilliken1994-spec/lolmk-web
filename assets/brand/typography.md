# Typography

LoLMK's type system. Confident headlines, clean body, one display moment that echoes the logo's chunky slab-style "KOREA" wordmark. All fonts are free and load via Google Fonts or `next/font`.

## Font choices

### Logo wordmark — slab/varsity style (in the logo itself)

The "KOREA" wordmark in the logo is a heavy slab-serif / college-varsity style with thick black outlines and white fill. This is **part of the logo, not the site typography**. Don't try to recreate it in CSS — when you need that wordmark, use the logo file.

But the logo's energy informs our display font choice (see below).

### Display — Bebas Neue (NEW, primary brand display)

Used for hero headlines, tournament names, scores, "LIVE NOW" type moments, and section kickers. Tall, condensed, all-caps by default. Reads like a stadium scoreboard or a fight-night card. Pairs naturally with the chunky energy of the logo wordmark without trying to imitate it.

- Weight to load: 400 (it's a single-weight font)
- Always uppercase or near-uppercase
- Tracking: slightly open (`0.02em` on display sizes, `0.05em` on smaller sizes)
- Use for: hero headlines, tournament names, score counters, large numbers

### Display — Space Grotesk (secondary display)

Used for section titles, card titles, and any heading where Bebas Neue would feel too shouty. Geometric, slightly condensed, modern. The workhorse for headings inside content.

- Weights to load: 500, 600, 700
- Tracking: tight (`-0.02em` for large sizes)
- Use for: section titles, card titles, page H1s on inner pages

### UI / Body — Inter

Used for everything else: nav, body copy, buttons, forms, tables. Workhorse font. Reads well at small sizes, has excellent multilingual support including Korean fallbacks.

- Weights to load: 400, 500, 600
- Tracking: normal

### Monospace — JetBrains Mono

Used sparingly for: code in how-to guides, tournament timestamps, score displays where alignment matters, and small "KR server stats" callouts where a technical feel is wanted.

- Weights to load: 400, 500
- Tracking: normal

### Korean fallback — Pretendard

When rendering Korean text, fall back to Pretendard. It pairs well with Inter and Space Grotesk visually. Set in the CSS font-stack so Korean glyphs render correctly without manual switching.

```css
font-family: "Inter", "Pretendard", system-ui, sans-serif;
```

## Type scale

Mobile-first scale. Display sizes use Bebas Neue or Space Grotesk depending on context (noted in the table). Body uses Inter unless noted.

| Token | Size | Line height | Weight | Font | Usage |
|---|---|---|---|---|---|
| `display-xl` | 96px / 6rem | 0.95 | 400 | **Bebas Neue** | Hero headline only. One per page. All caps. |
| `display-lg` | 72px / 4.5rem | 1.0 | 400 | **Bebas Neue** | Major brand moments, tournament names, large scores. |
| `display-md` | 56px / 3.5rem | 1.05 | 700 | Space Grotesk | Section titles on landing page, page H1s. |
| `display-sm` | 40px / 2.5rem | 1.1 | 600 | Space Grotesk | Inner-page section titles. |
| `heading-lg` | 28px / 1.75rem | 1.2 | 600 | Space Grotesk | Card titles, modal titles. |
| `heading-md` | 22px / 1.375rem | 1.3 | 600 | Space Grotesk | Smaller card titles, list group headers. |
| `heading-sm` | 18px / 1.125rem | 1.35 | 500 | Inter | Small headers, table headers. |
| `body-lg` | 18px / 1.125rem | 1.6 | 400 | Inter | Lead paragraphs, hero supporting text. |
| `body-md` | 16px / 1rem | 1.6 | 400 | Inter | Default body. |
| `body-sm` | 14px / 0.875rem | 1.5 | 400 | Inter | Captions, metadata, secondary info. |
| `label` | 13px / 0.8125rem | 1.4 | 500 | Inter | Form labels, badge text. Uppercase + tracked. |
| `caption` | 12px / 0.75rem | 1.4 | 400 | Inter | Timestamps, footnotes. |
| `score` | 56px / 3.5rem | 1.0 | 400 | **Bebas Neue** | Tournament scores, match results. Tabular-nums. |

### Mobile adjustments

On viewports under 768px, scale down the display sizes:

- `display-xl`: 64px (Bebas Neue)
- `display-lg`: 48px (Bebas Neue)
- `display-md`: 40px (Space Grotesk)
- `display-sm`: 30px (Space Grotesk)

Body sizes stay the same — readability over scale.

## Stylistic conventions

- **Bebas Neue is always uppercase.** It's designed that way. Don't apply `text-transform: lowercase` to it.
- **Bebas Neue tracking**: open it slightly. At display sizes, `letter-spacing: 0.02em`. At smaller sizes (under 32px), `letter-spacing: 0.05em` for legibility.
- **Headings (Space Grotesk)**: tight tracking (`-0.02em` on display sizes, `-0.01em` on heading sizes). Makes them feel deliberate.
- **All-caps labels**: badges, kicker text, tags. Use Inter at 11–13px, weight 500, tracking `0.08em`. Example: `LIVE NOW`, `Q1 2026 TOURNAMENT`, `STREAMER`.
- **Numbers in tables/standings**: use `font-variant-numeric: tabular-nums` so columns align cleanly. For large scores, use Bebas Neue with tabular-nums.
- **Korean + English pairing**: when shown together, English is primary, Korean is secondary. Korean in `text-secondary` color, slightly smaller. Korean text never uses Bebas Neue (no Korean glyphs) — fall back to Pretendard.

## When to use which display font

This is the most important typography decision on the site. Bebas Neue and Space Grotesk both handle big text but feel different:

- **Use Bebas Neue when**: the moment is brand-forward, broadcast-style, or about a number/event. Hero headlines, tournament names, scores, "LIVE NOW," "Q2 2026," "FINALS."
- **Use Space Grotesk when**: the moment is informational and needs to be readable in mixed case. Section titles like "Upcoming Events," "Featured Members," "How LoLMK Works." Article H1s. Card titles.

If you're not sure: Bebas Neue for the *moment*, Space Grotesk for the *content*.

## Hierarchy rules

- **One `display-xl` per page maximum.** Usually the hero. Don't compete with it.
- **Don't skip levels.** Going from `display-lg` straight to `body-md` looks lazy. Use a heading level in between.
- **Body copy max width**: 65–75 characters per line. Use `max-w-prose` in Tailwind or explicit `max-w-[65ch]`.
- **Line length matters more than font size.** A 14px body in a 50ch column reads better than a 16px body in a 100ch column.
- **Don't mix Bebas Neue and Space Grotesk in the same heading.** Pick one per element.

## Tailwind config snippet

```ts
fontFamily: {
  display: ["var(--font-bebas-neue)", "Impact", "sans-serif"],
  heading: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
  sans: ["var(--font-inter)", "Pretendard", "system-ui", "sans-serif"],
  mono: ["var(--font-jetbrains-mono)", "monospace"],
},
fontSize: {
  "display-xl": ["6rem", { lineHeight: "0.95", letterSpacing: "0.02em", fontWeight: "400" }],
  "display-lg": ["4.5rem", { lineHeight: "1", letterSpacing: "0.02em", fontWeight: "400" }],
  "display-md": ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.02em", fontWeight: "700" }],
  "display-sm": ["2.5rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
  "heading-lg": ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" }],
  "heading-md": ["1.375rem", { lineHeight: "1.3", fontWeight: "600" }],
  "heading-sm": ["1.125rem", { lineHeight: "1.35", fontWeight: "500" }],
  "body-lg": ["1.125rem", { lineHeight: "1.6", fontWeight: "400" }],
  "body-md": ["1rem", { lineHeight: "1.6", fontWeight: "400" }],
  "body-sm": ["0.875rem", { lineHeight: "1.5", fontWeight: "400" }],
  "label": ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0.08em", fontWeight: "500" }],
  "caption": ["0.75rem", { lineHeight: "1.4", fontWeight: "400" }],
  "score": ["3.5rem", { lineHeight: "1", letterSpacing: "0.02em", fontWeight: "400" }],
},
```

When using Bebas Neue (`font-display`) in Tailwind, also apply `uppercase` since it's intended to be all-caps:

```tsx
<h1 className="font-display text-display-xl uppercase">LoL Meetup Korea</h1>
```

## Loading fonts in Next.js

Use `next/font/google` in `app/layout.tsx`:

```ts
import { Inter, Space_Grotesk, Bebas_Neue, JetBrains_Mono } from "next/font/google";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });
const bebasNeue = Bebas_Neue({ subsets: ["latin"], weight: ["400"], variable: "--font-bebas-neue", display: "swap" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains-mono", display: "swap" });
```

For Pretendard (Korean), self-host the subset or use the CDN:
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css" />
```

## Open questions

- Bebas Neue is a single-weight free font with no italic. If we ever need a heavier or lighter variant, the closest paid alternatives are Druk, Gotham Condensed, or Tungsten. Skip until we hit a real limitation.
- The logo's "KOREA" wordmark is a custom slab serif — we are intentionally **not** using a slab serif on the site because it would compete with the logo. Bebas Neue gives us the same broadcast/sport energy in a sans, so the logo and headlines complement rather than duplicate each other.
- If we ever want extra emphasis at small sizes (badges, kicker text), Inter at weight 600 with tracking is enough. Don't add a fifth font.
