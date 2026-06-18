import { Hero } from "@/components/sections/hero";
import { StatsStrip } from "@/components/sections/stats-strip";
import { EventCalendar } from "@/components/sections/event-calendar";
import { PhotoHighlights } from "@/components/sections/photo-highlights";
import { Socials } from "@/components/sections/socials";
import { AboutBlurb } from "@/components/sections/about-blurb";
// FinalCta ("Ready when you are") hidden for now — uncomment to bring back.
// import { FinalCta } from "@/components/sections/final-cta";
import { getCommunityStats } from "@/lib/stats";
import { getUpcomingEvents, getRecurringSchedule, getNextEvent } from "@/lib/events";
import { getSocials } from "@/lib/socials";
import { getInstagramPosts } from "@/lib/instagram";
import { formatKstDate } from "@/lib/format";

export default async function HomePage() {
  const [stats, upcoming, recurring, nextEvent, socials, igPosts] = await Promise.all([
    getCommunityStats(),
    getUpcomingEvents(),
    getRecurringSchedule(),
    getNextEvent(),
    getSocials(),
    getInstagramPosts(6),
  ]);

  const nextEventLabel = nextEvent
    ? `${nextEvent.title} · ${formatKstDate(nextEvent.startsAt)}`
    : "Next up: TBA";

  return (
    <>
      <Hero nextEventLabel={nextEventLabel} />
      <StatsStrip stats={stats} />
      <EventCalendar upcoming={upcoming} recurring={recurring} />
      <PhotoHighlights posts={igPosts} />
      <Socials socials={socials} />
      <AboutBlurb />
      {/* <FinalCta /> */}
    </>
  );
}
