# Moodboard

A written description of the LoLMK visual vibe. When designing a new section or component, read this and imagine the result fitting in.

## The one-line vibe

**LCK broadcast graphics meets a modern SaaS landing page, dark mode, with the confidence of an esports org and the warmth of a community.**

## What it should feel like

You land on the site. The hero is dark, almost black, with a single bold brand-red accent on the primary CTA. The headline is large, tight, confident — set in Bebas Neue, all caps, like a match-card title. There's a live counter showing how many people are in Discord right now. A small KST clock ticks in the corner. The whole page feels like the loading screen of a major LCK match — high production value, clear hierarchy, no clutter.

You scroll. Sections breathe. There's room around everything. Cards have sharp edges, subtle borders, no drop shadows. When you hover an event card, it lifts almost imperceptibly and the border brightens. Tournament standings tables look like real broadcast graphics — tabular numbers, clear rank changes, team logos with proper space around them.

There's nothing accidentally cute. No giant rounded buttons. No pastel anything. No "playful" typography. No mascot waving at you.

But it's not cold either. Photo strips show real people at real meetups. Member cards link to real streamers with real personalities. The how-to articles are written like a friend explaining something over coffee, not a help-desk article generator.

## Visual references

These should live in `references/inspiration/` as actual screenshots. When designing, look at them.

### Direct esports references

- **T1's website** — clean, dark, news-forward. Look at how they handle player cards and roster pages. Reference for: tournament hub, member directory.
- **Gen.G** — content-forward, modern, photo-heavy. Reference for: hero treatments, photo highlights.
- **100 Thieves** — premium feel, sharp typography, big imagery. Reference for: section transitions, "lifestyle" energy.
- **lolesports.com** — Riot's official tournament hub. Reference for: bracket displays, standings tables, schedule layouts.
- **LCK.com** — broadcast-graphic visual language. Reference for: live event displays, score graphics.

### SaaS / tech references

For interface patterns, forms, and information density, look at:

- **Linear** — typography, spacing, dark theme that doesn't feel oppressive. Reference for: how-to article layout, navigation.
- **Vercel's marketing pages** — confident dark hero treatments. Reference for: landing page hero, CTA hierarchy.
- **Stripe** — clarity in complex info. Reference for: how-to articles, structured docs.

### What to specifically avoid

Anti-references — what we are *not*:

- Generic Discord-server landing pages with cartoon mascots
- Twitch streamer personal sites with overlapping decorative elements
- Reddit-style information dumps
- Riot's own community pages (too brand-heavy, we want our own identity)
- Anything that uses "League cyan" or "League gold" as a primary color (we're not the official brand — our identity is the logo's red and navy)

## Color feel

Most of the page is **calm dark**. Deep navy-black background. Subtle borders. Off-white text. The eye should rest, not work.

**Brand red is the spice.** It appears intentionally — primary CTA, active nav, the "LIVE NOW" badge during a tournament. Maybe two or three red moments per viewport. Never a wall of red.

**Brand blue is the secondary spice.** Used for KR-specific badges, info callouts, section accents, and the occasional structural moment. Cooler, deeper, more technical feel. The two brand colors only meet at full saturation in intentional brand moments (hero, tournament hero card, footer) — otherwise let one dominate per section.

When in doubt: more dark, less color. Restraint reads as confidence.

## Typography feel

Headlines do work. They're large, tight, and they say something specific. They don't whisper, and they don't shout.

Body copy is calm, generous, easy to read. We don't use small text to fit more in — we use whitespace to give it room.

Numbers feel deliberate — tabular, aligned, monospace where it matters (stats, scores, timestamps).

## Spacing feel

Generous. Sections are separated by 96–128px on desktop. Cards have 24–32px of internal padding. Things don't crowd each other.

The grid is wide but not infinite. Content max-width around 1280–1440px so things don't sprawl on ultra-wide monitors.

## Motion feel

Subtle. We don't have stuff flying in.

- Page transitions: instant or 150ms fade.
- Hover states: 150ms ease, color and border shifts only.
- Card lift on hover: 2–4px translate-y, 200ms ease.
- Counters that increment: animate over 800ms when they enter the viewport.

If a motion would feel out of place on the LCK broadcast graphics, it's out of place here.

## Photo feel

Photos are real. People at meetups, at LoL Park, at PC bangs, at tournaments. We don't use stock photography. We don't use AI-generated images. We don't use blurred-out crowd shots.

When photos are dim or color-mismatched (because they were taken at a PC bang at 2am), embrace it — the lower-light, slightly-grainy reality reads as authentic. Don't over-process them.

## Iconography feel

Lucide icons (line-style, 1.5px stroke). No filled icons. No emoji-style icons. No 3D icons. Consistent stroke width across the whole site.

## Edge cases & gut checks

When you're not sure if something fits the vibe, ask:

1. Would this look out of place if it appeared during an LCK broadcast cutaway?
2. Does this section feel confident, or does it feel like it's trying to be liked?
3. Is there one thing the eye lands on first, or is it a soup of competing elements?
4. If we removed all color from this page, would the layout still work? (It should — color is decoration, not structure.)

If any answer is "no," redesign.
