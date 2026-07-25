import { Hero } from "@/components/sections/hero";
import { NextEventBanner } from "@/components/sections/next-event-banner";
import { StatsStrip } from "@/components/sections/stats-strip";
import { EventCalendar } from "@/components/sections/event-calendar";
import { PhotoHighlights } from "@/components/sections/photo-highlights";
import { Socials } from "@/components/sections/socials";
import { AboutBlurb } from "@/components/sections/about-blurb";
// FinalCta ("Ready when you are") hidden for now — uncomment to bring back.
// import { FinalCta } from "@/components/sections/final-cta";
import { getCommunityStats } from "@/lib/stats";
import {
  getUpcomingEvents,
  getRecurringSchedule,
  getNextEvent,
  getFeaturedEvent,
} from "@/lib/events";
import { getSocials } from "@/lib/socials";
import { getInstagramPosts } from "@/lib/instagram";
import { formatKstDate } from "@/lib/format";

const DEFAULT_EVENT_DURATION_MS = 3 * 60 * 60 * 1000; // 3 hours

function isEventLiveNow(
  startsAt: string,
  endsAt: string | undefined,
  isLiveFlag: boolean | undefined,
): boolean {
  if (isLiveFlag) return true;
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return false;
  const end = endsAt
    ? new Date(endsAt).getTime()
    : start + DEFAULT_EVENT_DURATION_MS;
  const now = Date.now();
  return now >= start && now <= end;
}

export default async function HomePage() {
  const [stats, upcoming, recurring, nextEvent, featuredEvent, socials, igPosts] =
    await Promise.all([
      getCommunityStats(),
      getUpcomingEvents(),
      getRecurringSchedule(),
      getNextEvent(),
      getFeaturedEvent(),
      getSocials(),
      getInstagramPosts(6),
    ]);

  const nextEventLabel = nextEvent
    ? `${nextEvent.title} · ${formatKstDate(nextEvent.startsAt)}`
    : "Next up: TBA";

  // An event counts as "live" if Discord reports it active, or if right now
  // (at build / 5-min revalidation time) falls inside its start–end window.
  // Events without an explicit end get a 3-hour default window.
  const nextEventIsLive = nextEvent
    ? isEventLiveNow(nextEvent.startsAt, nextEvent.endsAt, nextEvent.isLive)
    : false;

  const discordOnline = stats.find((s) => s.id === "discord-online")?.value ?? null;
  const discordMembers = stats.find((s) => s.id === "members")?.value ?? null;

  // Tournaments get the marquee slot; label it honestly when the featured
  // event isn't literally the soonest one on the calendar.
  const bannerEyebrow =
    featuredEvent?.kind === "tournament" && featuredEvent.id !== nextEvent?.id
      ? "Upcoming tournament"
      : "Next event";

  return (
    <>
      <Hero nextEventLabel={nextEventLabel} nextEventIsLive={nextEventIsLive} />
      <NextEventBanner
        event={featuredEvent}
        eyebrow={bannerEyebrow}
        online={discordOnline}
        members={discordMembers}
      />
      <StatsStrip stats={stats} />
      <EventCalendar upcoming={upcoming} recurring={recurring} />
      <PhotoHighlights posts={igPosts} />
      <Socials socials={socials} />
      <AboutBlurb />
      {/* <FinalCta /> */}
    </>
  );
}
