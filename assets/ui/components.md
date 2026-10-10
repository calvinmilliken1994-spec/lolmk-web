# Components

> **2026 redesign (wins for public subpages).** See `docs/redesign-handover.md` and the rules block in `CLAUDE.md`.
>
> - **Shapes:** one cut corner is the signature. Plates and panels `cut-plate` (top-right 28px), primary buttons `cut-btn` (bottom-right 10px), status bar `cut-bar` (bottom-right 20px), page tag `cut-tag` (slanted right edge), avatars `cut-avatar`. Art zones use `texture-art`. No border-radius except status dots.
> - **Copy and layout:** no identical icon + title + blurb + "Read more" card grids, no `▸` bullets, no `→` appended to link text, no gradient blobs, glassmorphism or soft drop shadows.
> - **Data:** every number shown is real; unknown values are omitted, never "TBA". Empty states show the last result or the next event, plus one action.
> - **Access:** body contrast at least 4.5:1, visible keyboard focus, touch targets at least 44px.
> - **Shared components** (Phase 2): `PageHeader`, `StatStrip`, `StatusBar`, `FormatPlate`, `ChampionSplit`, `ResultsTable` in `src/components/ds/`.

Conventions for building UI components on LoLMK. These rules keep the site visually consistent regardless of who (or what) writes the code.

## Spacing scale

Use only these values. No magic numbers.

| Token | Pixel | Tailwind | Use |
|---|---|---|---|
| `space-0` | 0 | `0` | No space. |
| `space-1` | 4px | `1` | Tight gaps inside dense UI (badges, label + value). |
| `space-2` | 8px | `2` | Small gaps in buttons, between icon and label. |
| `space-3` | 12px | `3` | Form field internal padding. |
| `space-4` | 16px | `4` | Default gap between related items. |
| `space-6` | 24px | `6` | Card padding, gap between cards. |
| `space-8` | 32px | `8` | Section internal spacing. |
| `space-12` | 48px | `12` | Spacing between subsections. |
| `space-16` | 64px | `16` | Spacing between major sections (mobile). |
| `space-24` | 96px | `24` | Spacing between major sections (desktop). |
| `space-32` | 128px | `32` | Hero / major spacing moments (desktop). |

**Skip values.** Never use `space-5`, `space-7`, `space-9`, etc. If you feel like you need them, you don't — pick the nearest standard value.

## Border radius

Sharp by default. We're esports, not Stripe.

| Token | Pixel | Use |
|---|---|---|
| `radius-none` | 0 | Default for most elements. Cards, panels, buttons. |
| `radius-sm` | 2px | Slight softening when 0px feels too aggressive (form inputs). |
| `radius-md` | 4px | Maximum default radius. Used for primary buttons. |
| `radius-full` | 9999px | Pills, avatars, status dots only. |

**Never** use `rounded-lg`, `rounded-xl`, `rounded-2xl`, etc. The site loses its identity instantly.

## Buttons

### Primary

Used for the most important action on a page or section. **One per visual area.**

- Background: `brand-red` (`#BA263C`)
- Text: `text-primary` (`#F5F5F7`)
- Padding: `space-3` vertical, `space-6` horizontal
- Radius: `radius-md` (4px) on older pages. Redesigned pages: no radius, bottom-right 10px cut (`cut-btn`), min height 44px (52px in bands), Space Grotesk 600.
- Font: `body-md`, weight 600
- Hover: background → `brand-red-hover`, no scale, no shadow
- Active: background → `brand-red-muted`
- Disabled: background `border-default`, text `text-disabled`

```tsx
<Button variant="primary">Join the Discord</Button>
```

### Secondary

Less important actions. Most CTAs on the page.

- Background: transparent
- Border: 1px `border-strong`
- Text: `text-primary`
- Hover: border → `brand-red`, text stays
- Same padding/radius/font as primary

### Ghost

Tertiary actions, nav items, "View all" links.

- Background: transparent
- Border: none
- Text: `text-secondary`
- Hover: text → `text-primary`, optional underline
- Same padding as primary, but reduced if inline

### Sizes

- `sm` — `space-2` vertical, `space-4` horizontal, `body-sm`
- `md` (default) — as above
- `lg` — `space-4` vertical, `space-8` horizontal, `body-lg`

## Cards

The default content container.

- Background: `bg-surface` (`#10162A`)
- Border: 1px `border-default`
- Radius: `radius-none` (0px)
- Padding: `space-6` (24px) default, `space-8` (32px) for major cards
- Hover (when interactive): border → `border-strong`, transform `translate-y(-2px)`, transition 200ms ease

```tsx
<Card>
  <CardTitle>...</CardTitle>
  <CardBody>...</CardBody>
</Card>
```

**Don't** add drop shadows. Shadows fight the dark theme. The border is enough.

## Badges / tags

Small status indicators.

- Padding: `space-1` vertical, `space-2` horizontal
- Radius: `radius-sm` (2px)
- Font: `label` (uppercase, tracked, 13px, weight 500)
- Variants:
  - `default`: `bg-elevated` background, `text-secondary` text
  - `red`: `brand-red-muted` background, `brand-red-bright` text — for live/active/brand moments (e.g. `LIVE NOW`, `Q1 2026`)
  - `blue`: `brand-blue-muted` background, `brand-blue-bright` text — for KR-specific or info content (e.g. `KR ONLY`, `LCK`)
  - `success` / `danger` / `warning`: same pattern, semantic colors

Examples: `LIVE NOW`, `Q1 2026`, `STREAMER`, `KR ONLY`, `NEW`

## Forms

### Text inputs

- Background: `bg-elevated`
- Border: 1px `border-default`
- Radius: `radius-sm` (2px)
- Padding: `space-3`
- Font: `body-md`
- Focus: border → `brand-red`, no glow, no shadow
- Placeholder: `text-muted`

### Labels

- Above the input
- Font: `label` (uppercase, tracked)
- Color: `text-secondary`
- Margin-bottom: `space-2`

### Error states

- Border: `danger`
- Helper text below input in `danger` color, `body-sm` size

## Navigation

### Header

- Sticky to top
- Background: `bg-base` with subtle backdrop-blur when scrolled
- Border-bottom: 1px `border-subtle` (only when scrolled)
- Height: 64px desktop, 56px mobile
- Logo left, nav center or right, primary CTA far right

### Nav links

- Font: `body-md`, weight 500
- Color: `text-secondary` default, `text-primary` on hover
- Active state: `text-primary` + 2px `brand-red` underline (offset 4px)
- Padding: `space-2` vertical, `space-4` horizontal

### Mobile nav

- Hamburger triggers full-screen overlay (not slide-in panel)
- Background: `bg-base`
- Links: `display-sm` size, stacked, generous spacing
- Close button top-right

## Layout containers

- Max content width: 1280px (`max-w-7xl` in Tailwind)
- Wide max for landing hero/photo strips: 1440px (`max-w-[90rem]`)
- Page horizontal padding: `space-4` mobile, `space-8` tablet, `space-12` desktop
- Sections separated by: `space-16` mobile, `space-24` desktop

## Tables (standings, rosters)

Standings tables are a major visual element — they need to feel broadcast-grade.

- Background: `bg-surface`
- Border: 1px `border-default` outer; `border-subtle` between rows
- Header row: `bg-elevated` background, `label` font (uppercase, tracked), `text-secondary` color
- Data rows: `body-md`, `text-primary`
- Numbers: `font-mono` or `tabular-nums`, right-aligned
- Hover row: `bg-elevated` background
- Rank changes: ▲ in `success`, ▼ in `danger`, — in `text-muted`

## Iconography

- Library: **Lucide React** (line icons, 1.5px stroke)
- Default size: 20px (`w-5 h-5`)
- Inline with text: 16px (`w-4 h-4`)
- Hero/large: 32px (`w-8 h-8`)
- Stroke width: `strokeWidth={1.5}` consistently
- Color: inherit from parent text color

**Don't** mix icon libraries. Don't use filled icons. Don't use 3D / colored / illustrated icons.

## Imagery

- Aspect ratios: `16:9` for event/tournament hero images, `1:1` for member avatars, `4:5` for portrait member photos
- Treatment: minimal — slight contrast lift if needed, no heavy filters
- Loading: blur-up placeholder via Next.js `<Image>` `placeholder="blur"`
- Lightbox: simple — dark overlay, image centered, close button, arrow nav. No fancy zoom.

## Motion

- Default duration: 150ms for color, 200ms for transform, 300ms for opacity fades
- Default easing: `ease-out` for entrances, `ease-in` for exits, `ease-in-out` rare
- Reduced motion: respect `prefers-reduced-motion` — disable transforms, keep color transitions

## Component file structure

When creating a component:

```
src/components/ui/button.tsx           ← primitive
src/components/sections/event-card.tsx ← composed section component
src/components/layout/header.tsx       ← layout component
```

Each component:
- One default export
- Props typed via `interface`, not inline
- Variants via `cva` (class-variance-authority) when there are 3+ variants
- Forward refs where DOM access is plausible

## Accessibility baseline

- All interactive elements keyboard-accessible
- Focus visible — 2px `brand-red` outline, 2px offset
- Color contrast: meet WCAG AA at minimum
- Korean text uses `lang="ko"` attribute
- Images have meaningful `alt` text (or empty `alt=""` if decorative)

## Things to never do

- Never use `border-radius` higher than `4px` outside of pills/avatars (redesigned pages: no radius at all except status dots)
- Never use Discord blurple (`#5865F2`); Discord buttons are brand red with the Discord mark
- Never use drop shadows on dark backgrounds
- Never use animated gradients
- Never use stock photography or AI-generated imagery
- Never inline a hex value — always use a token
- Never skip the spacing scale
- Never use ALL CAPS for body copy (only labels)
- Never use more than one primary CTA per visual area
- Never break a tournament standings table — they must feel like a broadcast graphic
