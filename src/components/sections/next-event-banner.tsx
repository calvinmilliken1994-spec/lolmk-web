import { ArrowRight } from "lucide-react";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatKstDateTime } from "@/lib/format";
import { classifyEvent, type EventTone } from "@/lib/event-format";
import type { CommunityEvent } from "@/types/event";

interface NextEventBannerProps {
  event: CommunityEvent | null;
  online: string | null;
  members: string | null;
  /** Small label above the title, e.g. "Next event" or "Upcoming tournament". */
  eyebrow?: string;
}

const KST_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", day: "numeric" });
const KST_MONTH = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "short" });

const TONE_PILL: Record<EventTone, string> = {
  red: "bg-brand-red-muted border-brand-red text-brand-red-bright",
  blue: "bg-brand-blue-muted border-brand-blue text-brand-blue-bright",
  warning: "bg-warning/15 border-warning/50 text-warning",
  success: "bg-success/15 border-success/50 text-success",
  default: "bg-elevated border-line-strong text-ink-secondary",
};

export function NextEventBanner({
  event,
  online,
  members,
  eyebrow = "Next event",
}: NextEventBannerProps) {
  if (!event) return null;

  const start = new Date(event.startsAt);
  const day = KST_DAY.format(start);
  const month = KST_MONTH.format(start).toUpperCase();

  // Same location-aware tag the calendar uses (Online Riftbound vs Riftbound
  // Tournament, etc.) so the label reads identically across the site.
  const tag = classifyEvent(event);
  const meta = [formatKstDateTime(event.startsAt), event.location]
    .filter(Boolean)
    .join("   ·   ");

  const signupsFull = event.signups === "full";
  const ctaLabel = signupsFull
    ? "View bracket & standings"
    : event.cta?.label ?? "View details";
  const ctaHref = event.cta?.href ?? "https://discord.gg/lolmk";
  const hasPresence = Boolean(online && online !== "—");

  return (
    <section className="border-b border-line-subtle bg-surface">
      <div className="container-wide py-5 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
        {/* Event */}
        <div className="flex items-center gap-5 min-w-0">
          <div className="shrink-0 w-14 text-center">
            <div className="font-display text-[2.5rem] leading-[0.9] text-brand-red-bright">
              {day}
            </div>
            <div className="text-caption font-mono uppercase tracking-wider text-ink-muted">
              {month}
            </div>
          </div>
          <div className="h-12 w-px shrink-0 bg-line" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
              <span
                className={cn(
                  "inline-flex items-center border px-2.5 py-1 rounded-sm text-[0.7rem] font-mono uppercase tracking-wider",
                  TONE_PILL[tag.tone],
                )}
              >
                {tag.label}
              </span>
              <span className="text-label uppercase text-ink-muted">{eyebrow}</span>
              {signupsFull && (
                <span className="inline-flex items-center border border-line-strong bg-elevated px-2.5 py-1 rounded-sm text-[0.7rem] font-mono uppercase tracking-wider text-ink-muted">
                  Signups full
                </span>
              )}
            </div>
            <p className="font-heading text-heading-md text-ink truncate">{event.title}</p>
            <p className="text-body-sm text-ink-secondary mt-0.5 truncate">{meta}</p>
          </div>
        </div>

        {/* Presence + actions */}
        <div className="flex items-center gap-4 flex-wrap lg:shrink-0">
          {hasPresence && (
            <div className="flex items-center gap-3 rounded-sm border border-[#5865F2]/60 bg-[#5865F2]/10 px-4 py-2.5">
              <DiscordIcon className="h-5 w-5 text-[#5865F2]" />
              <div className="leading-tight">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-success" />
                  <span className="text-caption font-mono text-ink">{online} online now</span>
                </span>
                {members && members !== "—" && (
                  <span className="block text-[0.7rem] font-mono uppercase tracking-wider text-ink-muted">
                    {members} members
                  </span>
                )}
              </div>
            </div>
          )}
          <a
            href={ctaHref}
            target="_blank"
            rel="noreferrer"
            className="text-body-sm text-ink-secondary hover:text-ink whitespace-nowrap"
          >
            Read full details
          </a>
          <a
            href={ctaHref}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "primary", size: "sm" }), "whitespace-nowrap")}
          >
            {ctaLabel}
            <ArrowRight strokeWidth={2} className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}
