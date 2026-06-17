# Colors

LoLMK's color system. Dark-first, high-contrast, brand-derived from the logo (red shield + navy shield + Taegeuk colors). Use these tokens in Tailwind config and CSS variables — never hardcode hex values in components.

## Palette

### Backgrounds (dark theme)

The base background is a deep navy that visually relates to the logo's blue without competing with it.

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#0A0E1A` | Primary page background. Deep navy-black, not pure black. |
| `bg-surface` | `#10162A` | Cards, panels, sections that need to lift off the page. |
| `bg-elevated` | `#1A2240` | Hovered cards, dropdowns, modals — one step up from surface. |
| `bg-overlay` | `#0A0E1ACC` | Backdrop overlay (80% opacity of `bg-base`) for modals. |

### Borders & dividers

| Token | Hex | Usage |
|---|---|---|
| `border-default` | `#1F2937` | Standard card borders, section dividers. |
| `border-strong` | `#2D3A52` | Emphasized borders, active state outlines. |
| `border-subtle` | `#141B2E` | Barely-there separators when you want structure without weight. |

### Text

| Token | Hex | Usage |
|---|---|---|
| `text-primary` | `#F5F5F7` | Main body text and headings. Off-white, not pure white. |
| `text-secondary` | `#B8BCC8` | Secondary copy, captions, metadata. |
| `text-muted` | `#8B8D98` | Tertiary text, timestamps, placeholder. |
| `text-disabled` | `#4A4D5A` | Disabled state. |

### Brand red (primary accent — from logo shield + Taegeuk)

This is the eye-catcher. CTAs, active nav, "LIVE NOW" badges, brand moments. **Use sparingly** — if everything is red, nothing is.

| Token | Hex | Usage |
|---|---|---|
| `brand-red` | `#BA263C` | Primary brand red, sampled directly from the logo shield. Primary CTAs, active states, brand highlights. |
| `brand-red-hover` | `#D63E54` | Hover state on red elements (lighter, slightly less saturated). |
| `brand-red-muted` | `#5A1422` | Subtle red — for tinted backgrounds, badge fills at low opacity, accent borders. |
| `brand-red-bright` | `#E94560` | Optional brighter variant for highlights against dark backgrounds when contrast needs to push. Use rarely — most of the time `brand-red` is right. |

### Brand blue (secondary accent — from logo shield + Taegeuk)

A deep, slightly desaturated navy from the logo. Cooler, more technical feel. Used for KR-specific content, info callouts, secondary highlights, and section accents.

| Token | Hex | Usage |
|---|---|---|
| `brand-blue` | `#283D74` | Brand navy blue, sampled from the logo. Section dividers with weight, KR-specific badges, secondary accent fills. |
| `brand-blue-bright` | `#4A65A8` | Hover state and links in body copy — bright enough to read clearly on dark backgrounds while keeping the brand identity. |
| `brand-blue-muted` | `#1A2547` | Subtle blue — for tinted backgrounds, info callout fills. |

**Important**: `brand-blue` itself is too dark to use as a link color or text accent on `bg-base` — accessibility-wise it doesn't have enough contrast against the background. When you need a blue for body links or interactive text, use `brand-blue-bright`. Use `brand-blue` for *fills* (badges, dividers, surfaces with intent) where the contrast comes from neighboring elements.

### Semantic (status colors)

| Token | Hex | Usage |
|---|---|---|
| `success` | `#22C55E` | Confirmations, win indicators in standings. |
| `warning` | `#F59E0B` | Cautions, pending states. |
| `danger` | `#EF4444` | Errors, loss indicators in standings. **Note**: visually distinct from `brand-red` — danger is a brighter, more orange-leaning red so the brand color isn't read as an error. |

## Usage rules

1. **Default to `bg-base` for pages.** Lift up to `bg-surface` only when an element needs to be a distinct container.
2. **Borders before backgrounds.** When separating elements, prefer a 1px `border-default` over a different background. Keeps the page calm.
3. **Red is the primary brand moment.** Most of the page should be neutral. `brand-red` should pull the eye to one or two intentional spots per viewport. CTAs, active nav, "live now" indicators.
4. **Blue is the secondary supporter.** Use `brand-blue` for KR-themed badges (e.g. `KR ONLY`, `LCK`), section accents, and structural moments where the brand identity should show without stealing attention from the primary CTA. The two colors should rarely sit side-by-side at full saturation — let one dominate per section.
5. **Red + blue together = full brand moment.** Use the combination only when you want the logo identity to be obvious — hero sections, tournament hero cards, footer accents. Otherwise, pick one per section.
6. **No gradients on backgrounds.** Solid colors only for surfaces. Gradients allowed only on small decorative elements (hero glow, button hover, the shield-style split) and only between the brand red and brand blue, or between a brand color and a darker version of itself.
7. **Never use pure black (`#000`) or pure white (`#FFF`).** They feel cheap and create harsh contrast. Use the tokens above. (The logo's outlines are pure black, but those are stroke details on the logo itself, not page elements.)

## Tailwind config snippet

Drop this into `tailwind.config.ts`:

```ts
theme: {
  extend: {
    colors: {
      bg: {
        base: "#0A0E1A",
        surface: "#10162A",
        elevated: "#1A2240",
      },
      border: {
        DEFAULT: "#1F2937",
        strong: "#2D3A52",
        subtle: "#141B2E",
      },
      text: {
        primary: "#F5F5F7",
        secondary: "#B8BCC8",
        muted: "#8B8D98",
        disabled: "#4A4D5A",
      },
      brand: {
        red: {
          DEFAULT: "#BA263C",
          hover: "#D63E54",
          muted: "#5A1422",
          bright: "#E94560",
        },
        blue: {
          DEFAULT: "#283D74",
          bright: "#4A65A8",
          muted: "#1A2547",
        },
      },
      success: "#22C55E",
      warning: "#F59E0B",
      danger: "#EF4444",
    },
  },
}
```

## Reference combinations that work

- **Default page**: `bg-base` background + `bg-surface` cards + `border-default` borders + `text-primary` headings + `text-secondary` body
- **Primary CTA**: `brand-red` background + `text-primary` text + `brand-red-hover` on hover
- **Secondary CTA**: transparent background + 1px `border-strong` + `text-primary` text + border shifts to `brand-red` on hover
- **Active nav state**: `text-primary` text + 2px `brand-red` underline (offset 4px)
- **KR-specific badge**: `brand-blue-muted` background + `brand-blue-bright` text, `label` font (uppercase, tracked)
- **Live tournament badge**: `brand-red-muted` background + `brand-red-bright` text, with a pulsing dot
- **Tournament W/L badge**: `success` (W) or `danger` (L) at 20% opacity background + full opacity text
- **Hero accent gradient** (rare, intentional moments): linear gradient from `brand-red` to `brand-blue` at low opacity, behind hero text
- **Body link**: `brand-blue-bright` text, underline offset 4px, hover → `text-primary`

## Logo + page integration

Because the logo has its own white/red/blue palette baked in, treat it as a self-contained element:

- The `logo_white.png` version (red shield + blue shield + black outlines + white wordmark) works on `bg-base` and `bg-surface` directly.
- For monochrome contexts (footer, very small sizes, single-color marketing), request a single-color variant from design.
- Don't recolor the logo via CSS filters. If you need a variant, use a proper logo file.

## Open questions

- Do we ever invert to a light-theme variant? Currently planned: dark only. The logo would still work with the same palette + a light background.
- The `brand-red` (`#BA263C`) and `danger` (`#EF4444`) are close enough that a colorblind user might confuse them in tight UI (e.g. a red CTA next to a red error message). When designing forms with errors, prefer keeping CTAs visually separated from error states, or test both side-by-side before shipping.
- Confirm the white-bg version of the logo will exist for any light-on-light moments (press kit, partner deck), or if everything will live on dark.
