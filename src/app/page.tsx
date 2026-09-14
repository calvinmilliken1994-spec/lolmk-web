import { Hero } from "@/components/sections/hero";
import { NextEventBanner } from "@/components/sections/next-event-banner";
import { StatsStrip } from "@/components/sections/stats-strip";
import { EventCalendar } from "@/components/sections/event-calendar";
import { PhotoHighlights } from "@/components/sections/photo-highlights";
import { Socials } from "@/components/sections/socials";
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

  // Tournaments get the marquee slot; label it honestly when the featured
  // event isn't literally the soonest one on the calendar.
  const bannerEyebrow =
    featuredEvent?.kind === "tournament" && featuredEvent.id !== nextEvent?.id
      ? "Upcoming tournament"
      : "Next event";

  // Organization JSON-LD, sourced from the same socials data the page
  // already renders — never invent URLs that aren't shown on the page.
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "LoLMK",
    url: "https://lolmk.gg",
    logo: "https://lolmk.gg/logo.png",
    description:
      "The largest English-speaking League of Legends community in Korea.",
    sameAs: socials.map((s) => s.href),
  };

  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger -- static, server-derived JSON-LD only.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd).replace(/</g, "\\u003c") }}
      />
      <Hero
        nextEventLabel={nextEventLabel}
        nextEventIsLive={nextEventIsLive}
        discordOnline={discordOnline}
      />
      <NextEventBanner event={featuredEvent} eyebrow={bannerEyebrow} />
      <StatsStrip stats={stats} />
      <EventCalendar upcoming={upcoming} recurring={recurring} />
      <PhotoHighlights posts={igPosts} />
      <Socials socials={socials} />
      {/* <FinalCta /> */}
    </>
  );
}
