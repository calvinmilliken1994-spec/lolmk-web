# CLAUDE.md

Instructions for Claude Code working on the LoLMK website. Read this file at the start of every session.

## What is LoLMK

LoLMK is the largest English-speaking League of Legends community on the Korean (KR) server. The audience is a mix of:

- New expats and arrivals in Korea looking for community
- Tourists visiting short-term who want to play on the KR server
- Long-time KR server players (foreigners and bilingual Koreans)

The site serves three goals simultaneously: **recruit new members, act as a hub for existing members, and showcase events and content.**

## Before you write any code

1. Read `assets/README.md` and the linked brand/reference files. These are the source of truth for visual style, tone, and color decisions. Do not invent a design language — match the references.
2. Read `ROADMAP.md` to understand what is in scope for the current phase vs. what is intentionally deferred.
3. If you are working on tournament features (admin commands, signup flow, bracket generation, or the public tournament page), read `assets/TOURNAMENT.md` in full. It is the complete spec for that subsystem and the bot/website data contract.
4. If something is ambiguous, ask before building. Do not guess at brand decisions, tournament rules, or community-specific terminology.

## Visual direction

Sleek and esports-y. Think LCK broadcast graphics meets a modern SaaS landing page. Specifically:

- Dark theme primary (deep navy / near-black backgrounds)
- One bold accent color used sparingly for CTAs and highlights
- Sharp corners over rounded (border-radius 4px max, prefer 0–2px)
- Generous whitespace, confident typography
- No generic AI-website aesthetic (avoid pastel gradients, oversized rounded cards, default Tailwind purple, glassmorphism cliches)

Detailed color values, typography pairings, and component conventions live in `assets/brand/`.

## Stack

- **Framework**: Next.js (App Router) with TypeScript
- **Styling**: Tailwind CSS
- **Content**: MDX/Markdown for guides and event recaps
- **Components**: shadcn/ui as the base primitive layer, customized to brand
- **Hosting target**: Vercel (free tier)
- **Package manager**: pnpm preferred, npm acceptable

## Architectural principles

These are non-negotiable. Follow them from day one so the site can grow without restructuring.

### 1. Data access goes through `src/lib/` helpers

Components must never read files, fetch APIs, or query databases directly. All data access is wrapped in functions inside `src/lib/`:

```ts
// src/lib/tournaments.ts
export async function getTournaments() { /* ... */ }
export async function getTournamentBySlug(slug: string) { /* ... */ }
```

Today these helpers read markdown and JSON. Later they may hit a CMS or database. Components stay identical.

### 2. Content separated from code

Markdown for guides and events lives in `src/content/`. Structured data (members, socials, shop items) lives in `src/data/` as JSON or TS. Never hardcode this content inside components.

### 3. Routes scaffold the future

Some routes exist as placeholders for features deferred to later phases (see `ROADMAP.md`). Don't delete them. They're intentional.

### 4. Components are layered

- `components/ui/` — primitives (Button, Card, Badge). Mostly shadcn-derived.
- `components/sections/` — composed sections (Hero, EventCalendar, TournamentBracket).
- `components/layout/` — Header, Footer, Nav.

Sections use primitives. Pages compose sections. Pages should be thin.

### 5. TypeScript types live in `src/types/`

Shared types (Tournament, Member, Event, HowTo) are defined once and imported. Don't redefine inline.

## What to build now (MVP)

Listed in priority order. See `ROADMAP.md` for full detail.

1. Project scaffolding: Next.js + Tailwind + shadcn setup, base layout with Header/Footer, theme tokens wired to brand colors.
2. Landing page (`/`) — does the heaviest lift. Includes event calendar, photo highlights, social links, featured members section.
3. `/tournaments` hub + `/tournaments/[slug]` template
4. `/members` directory
5. `/how-tos` index + `/how-tos/[slug]` template
6. `/shop` (grid linking out to external stores — no checkout on-site)
7. `/about`
8. `/404` and `/500` custom error pages

## What NOT to build now

Listed in `ROADMAP.md` under Phase 2 / Phase 3. If you find yourself reaching for these, stop and ask:

- User authentication
- Database-backed RSVPs or signups
- On-site shop checkout
- Member profile self-edit
- Live tournament bracket updates
- Standalone gallery page
- Standalone socials page

## Conventions

- **Imports**: use absolute imports via `@/` alias (e.g. `import { Button } from "@/components/ui/button"`).
- **File naming**: kebab-case for files, PascalCase for component exports.
- **Server vs client components**: default to server components; mark client components explicitly with `"use client"` only when needed (interactivity, hooks).
- **Images**: use Next.js `<Image>` component with proper width/height. Public images go in `public/images/[category]/`.
- **Dates**: store as ISO strings, render with timezone awareness (KST is the source of truth, auto-convert client-side for visitors).
- **Korean text**: when displayed, pair with English. Use `lang` attributes appropriately for SEO and accessibility.

## Communication

- If a task is large, propose a plan first and wait for confirmation before implementing.
- If brand decisions feel underspecified, ask. Don't pick colors or fonts without checking `assets/brand/`.
- Flag any time you're about to violate the architectural principles above — there may be a good reason, but it should be a conscious choice.
