import { Card } from "@/components/ui/card";
import { EventCard } from "@/components/sections/event-card";
import type { CommunityEvent, RecurringSchedule } from "@/types/event";

interface EventCalendarProps {
  upcoming: CommunityEvent[];
  recurring: RecurringSchedule[];
}

export function EventCalendar({ upcoming, recurring }: EventCalendarProps) {
  return (
    <section id="events" className="container-wide py-24 scroll-mt-20">
      <div className="max-w-2xl mb-12">
        <p className="text-label uppercase text-ink-muted mb-4">On the calendar</p>
        <h2 className="font-heading text-display-md text-ink">Upcoming events</h2>
        <p className="mt-4 text-body-md text-ink-secondary">
          Online Riftbound nights, in-person tournaments, watch parties, and
          meetups. Tap any event for full details and to RSVP. Times are KST.
        </p>
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
