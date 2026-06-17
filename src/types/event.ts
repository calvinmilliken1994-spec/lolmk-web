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
}

export interface RecurringSchedule {
  id: string;
  title: string;
  cadence: string;
  time: string;
  description: string;
}
