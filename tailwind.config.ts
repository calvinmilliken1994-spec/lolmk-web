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

        success: "#22C55E",
        warning: "#F59E0B",
        danger: "#EF4444",
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
