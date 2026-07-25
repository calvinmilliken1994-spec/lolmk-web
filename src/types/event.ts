export type EventKind = "tournament" | "in-house" | "scrim" | "meetup" | "watch-party";

export interface CommunityEvent {
  id: string;
  title: string;
  kind: EventKind;
  startsAt: string;
  endsAt?: string;
  location: string;
  description: string;
  cta?: { label: string; href: string };
  isLive?: boolean;
  /** Game a tournament is played in (e.g. "Riftbound"), shown as a tag. */
  game?: string;
  /**
   * Signup state for tournaments. "external" = handled off-site for now,
   * "full" = capacity reached. Drives the banner's CTA and "Signups full"
   * badge; the slot becomes on-site registration when that ships.
   */
  signups?: "open" | "full" | "external";
}

export interface RecurringSchedule {
  id: string;
  title: string;
  cadence: string;
  time: string;
  description: string;
}
