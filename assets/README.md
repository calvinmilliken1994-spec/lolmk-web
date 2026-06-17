# assets/README.md

This folder is the source of truth for LoLMK's visual identity, tone, and design references. **Read this file (and the linked files below) before making any styling or branding decisions.**

## How to use this folder

- **Brand specifics** (colors, type, voice) live in `brand/`. These are rules.
- **Inspiration and references** (screenshots, moodboard) live in `references/`. These are the vibe.
- **UI conventions** (component styles, spacing, patterns) live in `ui/`. These keep the site consistent.

When in doubt: the references show the *feel*, the brand docs define the *rules*. If they conflict, the brand docs win.

## Folder map

```
assets/
├── README.md                    (this file)
├── brand/
│   ├── logo/                    (logo files: SVG, PNG, dark/light variants)
│   ├── colors.md                (hex values + usage rules)
│   ├── typography.md            (font choices + weight/size scale)
│   └── voice.md                 (tone of voice, vocabulary, do/don't)
├── references/
│   ├── inspiration/             (screenshots from sites we want to feel like)
│   ├── moodboard.md             (written description of the vibe)
│   └── competitors.md           (other community sites — what to do/avoid)
└── ui/
    ├── components.md            (button styles, cards, spacing scale, radii)
    └── patterns/                (screenshots of layouts/sections we like)
```

## The vibe in one paragraph

LoLMK should feel like the intersection of LCK broadcast graphics and a modern SaaS landing page. Dark, confident, esports-y. Sharp edges, deep navy backgrounds, one bold accent color used sparingly. Generous whitespace. Typography does heavy lifting — confident headlines, clean body text. Avoid the generic AI-website look: no pastel gradients, no oversized rounded cards, no default Tailwind purple, no glassmorphism.

The audience is mixed (new expats, tourists, long-time players), so the site needs to feel premium and legitimate at first glance, then practical and useful once you start reading.

## Reference sites to study

Screenshots of these should live in `references/inspiration/`. When adding screenshots, name them like `t1-homepage-full.png` and `t1-homepage-hero.png` so it's clear what's being referenced.

- **T1** — current esports gold standard for site design
- **Gen.G** — clean, modern, content-forward
- **LCK official site** — broadcast graphic language
- **100 Thieves** — premium esports brand feel
- **Cloud9** — sharp, confident layouts
- **lolesports.com** — Riot's official tournament hub (good reference for tournament pages)

When in doubt, reference one of these directly: "make this section feel like the events grid on T1's site."

## Required reading order for Claude Code

1. This file (`assets/README.md`)
2. `brand/colors.md`
3. `brand/typography.md`
4. `brand/voice.md`
5. `ui/components.md`
6. `references/moodboard.md`
7. Glance through `references/inspiration/` before designing any new section

## Status

This folder is being filled in incrementally. If a referenced file doesn't exist yet, ask before making assumptions about its contents. Don't invent brand decisions — flag the gap and we'll fill it in together.

### Currently filled in

- [ ] `brand/logo/` — needs logo files
- [ ] `brand/colors.md` — needs filling in
- [ ] `brand/typography.md` — needs filling in
- [ ] `brand/voice.md` — needs filling in
- [ ] `references/inspiration/` — needs reference screenshots
- [ ] `references/moodboard.md` — needs filling in
- [ ] `references/competitors.md` — optional, fill in if useful
- [ ] `ui/components.md` — needs filling in
- [ ] `ui/patterns/` — optional, fill in as patterns emerge
