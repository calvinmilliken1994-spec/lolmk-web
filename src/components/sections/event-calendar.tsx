import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EventCard } from "@/components/sections/event-card";
import type { CommunityEvent, RecurringSchedule } from "@/types/event";

interface EventCalendarProps {
  upcoming: CommunityEvent[];
  recurring: RecurringSchedule[];
}

export function EventCalendar({ upcoming, recurring }: EventCalendarProps) {
  return (
    <section className="container-wide py-24">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
        <div className="max-w-2xl">
          <p className="text-label uppercase text-ink-muted mb-4">Event Calendar</p>
          <h2 className="font-heading text-display-md text-ink">Events</h2>
          <p className="mt-4 text-body-md text-ink-secondary">
            Tournaments, watch parties, and meetups. Times are KST — Events
            convert to your local time.
          </p>
        </div>
        <Link
          href="https://discord.gg/lolmk"
          target="_blank"
          rel="noreferrer"
          className="text-body-sm text-ink-secondary hover:text-ink inline-flex items-center gap-2"
        >
          Full calendar in Discord
          <ArrowUpRight strokeWidth={1.5} className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {upcoming.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>

        <Card className="lg:col-span-1 p-8 h-fit">
          <p className="text-label uppercase text-ink-muted mb-4">Every week</p>
          <h3 className="font-heading text-heading-lg text-ink mb-6">Recurring schedule</h3>
          <ul className="space-y-6">
            {recurring.map((item) => (
              <li
                key={item.id}
                className="border-b border-line-subtle pb-6 last:border-b-0 last:pb-0"
              >
                <p className="font-heading text-heading-md text-ink">{item.title}</p>
                <p className="text-caption font-mono text-ink-muted mt-1">
                  {item.cadence} · {item.time}
                </p>
                <p className="text-body-sm text-ink-secondary mt-2">{item.description}</p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}
