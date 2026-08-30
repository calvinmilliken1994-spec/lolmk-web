import type { CommunityEvent } from "@/types/event";

// ---------------------------------------------------------------------------
// Signup-link detection
//
// Discord event descriptions often carry the real RSVP link inline — a Luma
// page or a Google Form. We detect those and point the RSVP button at whatever
// is found, falling back to the event's own CTA (usually the Discord event) and
// then the server invite. Priority: Luma > Google Form > event CTA > invite.
// ---------------------------------------------------------------------------

export type SignupProvider = "luma" | "google-form" | "discord" | "generic";

const URL_RE = /(https?:\/\/[^\s)]+)/g;
// Trailing sentence punctuation that shouldn't be part of a pasted URL.
const TRAILING_PUNCT_RE = /[.,;!?]+$/;

function extractUrls(text: string): string[] {
  return [...text.matchAll(URL_RE)].map((m) => m[0].replace(TRAILING_PUNCT_RE, ""));
}

export interface SignupLink {
  provider: SignupProvider;
  url: string;
}

/** Find an external signup link (Luma or Google Form) in free text. */
export function detectSignupLink(text: string | null | undefined): SignupLink | null {
  if (!text) return null;
  const urls = extractUrls(text);
  const luma = urls.find((u) => /(^|\/\/|\.)lu\.ma\//i.test(u) || /luma\.com/i.test(u));
  if (luma) return { provider: "luma", url: luma };
  const gform = urls.find((u) => /docs\.google\.com\/forms|forms\.gle/i.test(u));
  if (gform) return { provider: "google-form", url: gform };
  return null;
}

export interface ResolvedRsvp {
  label: string;
  href: string;
  provider: SignupProvider;
  /** True when signups are closed — render as a disabled state, not a link. */
  closed: boolean;
}

const PROVIDER_LABEL: Record<SignupProvider, string> = {
  luma: "RSVP on Luma",
  "google-form": "Sign up",
  discord: "RSVP on Discord",
  generic: "RSVP",
};

/**
 * Decide where a given event's RSVP button should send people. Prefers a
 * detected external signup (Luma / Google Form) over the event's own CTA.
 */
export function resolveRsvp(event: CommunityEvent): ResolvedRsvp {
  if (event.signups === "full") {
    return { label: "Signups full", href: event.cta?.href ?? "#", provider: "generic", closed: true };
  }

  const detected = detectSignupLink(event.description);
  if (detected) {
    return { label: PROVIDER_LABEL[detected.provider], href: detected.url, provider: detected.provider, closed: false };
  }

  if (event.cta) {
    const provider: SignupProvider = event.cta.href.includes("discord") ? "discord" : "generic";
    return { label: event.cta.label, href: event.cta.href, provider, closed: false };
  }

  return { label: PROVIDER_LABEL.discord, href: "https://discord.gg/lolmk", provider: "discord", closed: false };
}

// ---------------------------------------------------------------------------
// Event tagging
//
// A single "tournament" kind isn't descriptive enough: an in-house night in a
// Discord voice channel and an in-person League tournament read very
// differently. We split them by location: Discord/online locations are the
// casual online sessions; anything with a real venue is the competitive
// tournament.
// ---------------------------------------------------------------------------

export type EventTone = "red" | "blue" | "warning" | "success" | "default";

export interface EventTag {
  label: string;
  tone: EventTone;
}

const ONLINE_LOCATION_RE = /discord|voice|stage|online|\bvc\b|twitch|stream/i;

/** True when the event happens online (Discord voice/stage, stream, etc.). */
export function isOnlineEvent(event: Pick<CommunityEvent, "location">): boolean {
  return ONLINE_LOCATION_RE.test(event.location);
}

/**
 * Derive a descriptive, colour-coded tag for an event. Tournaments split into
 * "Online <game>" (Discord-hosted, chill) vs "<game> Tournament" (IRL,
 * competitive); other kinds keep intuitive labels and distinct tones.
 */
export function classifyEvent(event: CommunityEvent): EventTag {
  const online = isOnlineEvent(event);
  const game = event.game ?? "League of Legends";

  switch (event.kind) {
    case "tournament":
      return online
        ? { label: `Online ${game}`, tone: "blue" }
        : { label: `${game} Tournament`, tone: "red" };
    case "in-house":
      return { label: `${game} In-house`, tone: "blue" };
    case "scrim":
      return { label: "Scrim", tone: "blue" };
    case "watch-party":
      return { label: "Watch Party", tone: "warning" };
    case "meetup":
      return { label: "Meetup", tone: "success" };
    default:
      return { label: "Event", tone: "default" };
  }
}
