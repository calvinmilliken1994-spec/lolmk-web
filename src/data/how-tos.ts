/**
 * How-to guides, in reading order for a new arrival (account, English
 * client, RP, PC bang). The articles themselves are pages under
 * src/app/how-tos/<slug>/; this file holds what the index, the article
 * header and the table of contents need.
 *
 * readTime: rendered article word count at 200 words a minute, rounded up
 * (898, 335, 462 and 430 words when measured on 10 Oct 2026). Re-measure
 * when an article changes substantially.
 *
 * lastChecked: only where the article itself states it. Guides that don't
 * say when they were last checked have null and show no date (see
 * OPEN_QUESTIONS.md).
 */

export interface GuideTocEntry {
  id: string;
  label: string;
}

export interface Guide {
  slug: string;
  /** Index title. */
  title: string;
  /** Article headline (the page's h1). */
  headline: string;
  /** Article deck under the headline. */
  deck: string;
  /** One line for the index. */
  summary: string;
  readTimeMinutes: number;
  /** "YYYY-MM", or null when the article doesn't say. */
  lastChecked: string | null;
  toc: GuideTocEntry[];
}

export const GUIDES: Guide[] = [
  {
    slug: "make-kr-account",
    title: "Make a KR account",
    headline: "Making a real Korean server account.",
    deck: "Riot Korea ties every account to a verified Korean identity. This page explains exactly what that means, who can clear it, and who currently can't.",
    summary:
      "What a Residence Card (ARC) does, why short-term visitors get stuck, and why buying an account isn't the answer.",
    readTimeMinutes: 5,
    lastChecked: "2026-09",
    toc: [
      { id: "dont-buy", label: "Don't buy an account" },
      { id: "identity-verification", label: "Korean identity verification" },
      { id: "the-sequence", label: "The sequence" },
      { id: "no-shortcut", label: "No general shortcut" },
    ],
  },
  {
    slug: "client-english",
    title: "Switch the client to English",
    headline: "Switching the client to English.",
    deck: "A KR account defaults to Korean. Language is a client setting, separate from your account region, so switching it doesn't move your server or reset your rank.",
    summary:
      "Set the Riot Client and League to English while staying on the KR server, without touching your rank or region.",
    readTimeMinutes: 2,
    lastChecked: null,
    toc: [
      { id: "riot-client", label: "From the Riot Client" },
      { id: "launch-flag", label: "If the setting won't stick" },
    ],
  },
  {
    slug: "buy-rp",
    title: "Buy RP in Korea",
    headline: "Buying RP on the KR server.",
    deck: "Riot Korea's payment menu looks nothing like NA or EUW's. Here's what actually clears for a foreign resident, and what almost always fails.",
    summary: "Payment methods that actually clear on the KR store, and why most foreign cards get declined.",
    readTimeMinutes: 3,
    lastChecked: "2026-09",
    toc: [
      { id: "payment-methods", label: "Payment methods" },
      { id: "no-korean-banking", label: "Without Korean banking" },
      { id: "monthly-cap", label: "The monthly cap" },
    ],
  },
  {
    slug: "pc-bang",
    title: "PC bang guide",
    headline: "PC bangs, for foreigners.",
    deck: "PC bangs (PC방, internet cafes built around gaming) are everywhere in Korea and genuinely worth trying. Here's how sign-in actually works and where it does and doesn't help you.",
    summary: "What sign-in looks like as a foreigner, and where a PC bang seat does and doesn't help you.",
    readTimeMinutes: 3,
    lastChecked: null,
    toc: [
      { id: "sign-in", label: "What sign-in looks like" },
      { id: "what-to-expect", label: "What to expect" },
    ],
  },
];
