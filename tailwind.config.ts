import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Backgrounds — used as bg-base / bg-surface / bg-elevated
        base: "#0A0E1A",
        surface: "#10162A",
        elevated: "#1A2240",

        // Text — used as text-ink, text-ink-secondary, text-ink-muted, text-ink-disabled
        ink: {
          DEFAULT: "#F5F5F7",
          secondary: "#B8BCC8",
          muted: "#8B8D98",
          disabled: "#4A4D5A",
        },

        // Borders — used as border-line, border-line-strong, border-line-subtle
        line: {
          DEFAULT: "#1F2937",
          strong: "#2D3A52",
          subtle: "#141B2E",
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

        success: {
          DEFAULT: "#22C55E",
          // Control Deck v2: base `success` is too dark for 10–12px text.
          surface: "#0F2A1A",
          ink: "#4ADE80",
        },
        warning: {
          DEFAULT: "#F59E0B",
          // Control Deck v2: judge calls, alert strip, flagged tables.
          surface: "#2E210A",
          "surface-strong": "#241A08",
          tile: "#1C1710",
          line: "#8A6418",
          "line-quiet": "#6B4A12",
          ink: "#F5B54A",
        },
        danger: "#EF4444",

        // Redesign design system (docs/redesign-handover.md, Phase 1). Public
        // subpages (Tournaments, Members, How-tos, About, Locker) use these.
        // Namespaced under `ds` so the homepage and /tools, which keep the
        // older tokens above, don't shift. Ground is the existing `base`
        // (#0A0E1A), within a shade of the handover's #0B1021, so it's kept.
        //   bg-ds-ground, bg-ds-surface, bg-ds-surface-2,
        //   border-ds-line / -line-soft / -line-strong,
        //   text-ds-text / -text-muted / -text-dim,
        //   bg-ds-red, bg-ds-blue, text-ds-gold, bg-ds-online
        ds: {
          ground: "#0A0E1A",
          surface: "#121A33",
          "surface-2": "#172142",
          line: "#23305A",
          "line-soft": "#1E2A52",
          "line-strong": "#3A4C85",
          text: "#EEF1F8",
          "text-muted": "#A3ACC6",
          "text-dim": "#8792B3",
          red: "#BA263C",
          blue: "#283D74",
          gold: "#D9B25F",
          online: "#3FB57A",
          // Format plate art-zone tints (Phase 2 FormatPlate).
          "art-sr": "#2A1426",
          "art-aram": "#15224A",
          "art-rb": "#1C1D33",
        },

        // Control Deck v2 (docs/design/control-deck-v2/tokens.md).
        deck: {
          rail: "#0D1222", // phase rail + broadcast column background
          tile: "#141B32", // table tile, "playing" state
        },
        link: "#7F97D6", // links + PREVIEW label on dark surfaces
        "onair-surface": "#2A0D16", // ON AIR chip, program-scene button
        "primary-disabled": {
          DEFAULT: "#3A1520",
          ink: "#D9A0AA",
        },
        venue: {
          row: "#121931",
          "row-alt": "#0E1428",
          card: "#151C36",
          time: "#8E1C2E",
          "time-ink": "#FFC2CC",
        },
      },
      fontFamily: {
        display: ["var(--font-bebas-neue)", "Impact", "sans-serif"],
        heading: ["var(--font-space-grotesk)", "system-ui", "sans-serif"],
        sans: ["var(--font-inter)", "Pretendard", "system-ui", "sans-serif"],
        mono: ["var(--font-chakra)", "ui-monospace", "monospace"],
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
        label: ["0.8125rem", { lineHeight: "1.4", letterSpacing: "0.08em", fontWeight: "500" }],
        caption: ["0.75rem", { lineHeight: "1.4", fontWeight: "400" }],
        score: ["3.5rem", { lineHeight: "1", letterSpacing: "0.02em", fontWeight: "400" }],

        // Redesign type scale (handover Phase 1). Bebas sizes pair with
        // font-display; labels pair with font-heading and are sentence case.
        "ds-h1": ["clamp(72px, 11vw, 160px)", { lineHeight: "0.86", fontWeight: "400" }],
        "ds-h2": ["clamp(56px, 7vw, 104px)", { lineHeight: "0.88", fontWeight: "400" }],
        "ds-plate": ["52px", { lineHeight: "0.95", fontWeight: "400" }],
        "ds-stat": ["48px", { lineHeight: "1", fontWeight: "400" }],
        "ds-tag": ["22px", { lineHeight: "1", fontWeight: "400" }],
        "ds-label": ["13px", { lineHeight: "1.35", fontWeight: "500" }],
        "ds-ui": ["15px", { lineHeight: "1.3", fontWeight: "500" }],
        "ds-ui-lg": ["19px", { lineHeight: "1.25", fontWeight: "600" }],
        "ds-body": ["16px", { lineHeight: "1.55", fontWeight: "400" }],
        "ds-deck": ["18px", { lineHeight: "1.55", fontWeight: "400" }],
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        md: "4px",
        full: "9999px",
      },
      maxWidth: {
        content: "80rem",
        wide: "90rem",
        // Decks and body copy on redesigned pages (56–60ch).
        deck: "58ch",
      },
      transitionTimingFunction: {
        "out-soft": "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "marquee": {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        // Gentle attention flash for the timer when a round hits 00:00.
        "time-flash": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        // Staggered listing entrance for ARAM Mayhem team/roster reveals on
        // /mayhemlive — fade in while sliding up slightly.
        "fade-slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Bracket card entrance (SR live screen) — referenced via the
        // arbitrary `animate-[reveal-fade-in_...]` utility, which needs a
        // matching keyframes name here even though there's no `reveal-fade-in`
        // entry in the `animation` map below.
        "reveal-fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Round 1 reveal rows (SR live screen) — whole-row entrance,
        // alternating left/right by row index.
        "reveal-from-left": {
          "0%": { opacity: "0", transform: "translateX(-60px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "reveal-from-right": {
          "0%": { opacity: "0", transform: "translateX(60px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.6s ease-in-out infinite",
        "marquee": "marquee 40s linear infinite",
        "time-flash": "time-flash 1.1s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
