import eventsData from "@/data/events.json";
import type { CommunityEvent, RecurringSchedule } from "@/types/event";
import { getDiscordEvents } from "@/lib/discord-events";

interface EventsFile {
  upcoming: CommunityEvent[];
  recurring: RecurringSchedule[];
}

const data = eventsData as EventsFile;

function sortByStart(a: CommunityEvent, b: CommunityEvent) {
  return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

export async function getUpcomingEvents(): Promise<CommunityEvent[]> {
  const live = await getDiscordEvents();
  if (live && live.length > 0) return live;
  return data.upcoming.slice().sort(sortByStart);
}

export async function getRecurringSchedule(): Promise<RecurringSchedule[]> {
  return data.recurring;
}

export async function getNextEvent(): Promise<CommunityEvent | null> {
  const upcoming = await getUpcomingEvents();
  return upcoming[0] ?? null;
}

/**
 * The event to feature in the banner below the hero. Tournaments are the
 * marquee events — bigger, more info to surface — so the soonest upcoming
 * tournament takes priority over an earlier but smaller event. Falls back to
 * the chronologically next event when nothing tournament-sized is scheduled.
 */
export async function getFeaturedEvent(): Promise<CommunityEvent | null> {
  const upcoming = await getUpcomingEvents();
  const nextTournament = upcoming.find((e) => e.kind === "tournament");
  return nextTournament ?? upcoming[0] ?? null;
}
