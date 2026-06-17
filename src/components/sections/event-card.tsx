"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, MapPin, Calendar, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatKstDateTime } from "@/lib/format";
import type { CommunityEvent, EventKind } from "@/types/event";

const KIND_LABEL: Record<EventKind, string> = {
  tournament: "Tournament",
  "in-house": "In-house",
  scrim: "Scrim",
  meetup: "Meetup",
  "watch-party": "Watch party",
};

function kindBadgeVariant(kind: EventKind): "red" | "blue" | "default" {
  if (kind === "tournament") return "red";
  if (kind === "watch-party") return "blue";
  return "default";
}

const EXPAND_THRESHOLD = 180;
function shouldShowExpand(description: string): boolean {
  return description.length > EXPAND_THRESHOLD || description.includes("\n");
}

const URL_RE = /(https?:\/\/[^\s)]+)/g;
type LinkifyPart = { kind: "text"; value: string } | { kind: "link"; url: string };

function linkify(text: string): LinkifyPart[] {
  const parts: LinkifyPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const i = match.index ?? 0;
    if (i > lastIndex) parts.push({ kind: "text", value: text.slice(lastIndex, i) });
    parts.push({ kind: "link", url: match[0] });
    lastIndex = i + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ kind: "text", value: text.slice(lastIndex) });
  return parts;
}

export function EventCard({ event }: { event: CommunityEvent }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const showExpand = event.description ? shouldShowExpand(event.description) : false;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) dlg.showModal();
    if (!open && dlg.open) dlg.close();
  }, [open]);

  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === e.currentTarget) setOpen(false);
  }

  const ctaIsExternal = event.cta?.href.startsWith("http");

  return (
    <>
      <Card
        interactive
        className="flex flex-col md:flex-row md:items-stretch gap-0 p-0 overflow-hidden"
      >
        <div className="md:w-48 shrink-0 bg-elevated border-r border-line-subtle p-6 flex flex-col justify-center">
          <Calendar strokeWidth={1.5} className="h-5 w-5 text-brand-red mb-2" />
          <p className="font-display text-heading-lg text-ink leading-tight">
            {formatKstDateTime(event.startsAt)}
          </p>
        </div>
        <div className="flex-1 p-6 flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap gap-2">
            <Badge variant={kindBadgeVariant(event.kind)}>{KIND_LABEL[event.kind]}</Badge>
            {event.isLive && (
              <Badge variant="red" pulse>
                Live now
              </Badge>
            )}
          </div>
          <h3 className="font-heading text-heading-lg text-ink">{event.title}</h3>
          {event.description && (
            <div className="text-body-sm text-ink-secondary">
              <p className="line-clamp-2 whitespace-pre-line break-words">
                {event.description}
              </p>
              {showExpand && (
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="mt-2 text-body-sm font-medium text-brand-blue-bright hover:text-ink inline-flex items-center gap-1"
                >
                  Read full details
                  <span aria-hidden>→</span>
                </button>
              )}
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-4 pt-2">
            <span className="inline-flex items-center gap-2 text-caption text-ink-muted font-mono break-all">
              <MapPin strokeWidth={1.5} className="h-4 w-4 shrink-0" />
              {event.location}
            </span>
            {event.cta && (
              <a
                href={event.cta.href}
                target={ctaIsExternal ? "_blank" : undefined}
                rel={ctaIsExternal ? "noreferrer" : undefined}
                className="text-body-sm font-medium text-brand-red-bright hover:text-brand-red-hover inline-flex items-center gap-1 ml-auto"
              >
                {event.cta.label}
                <ArrowUpRight strokeWidth={1.5} className="h-4 w-4" />
              </a>
            )}
          </div>
        </div>
      </Card>

      <dialog
        ref={dialogRef}
        onClick={onBackdropClick}
        onClose={() => setOpen(false)}
        aria-labelledby={`event-${event.id}-title`}
        className="bg-transparent text-ink p-0 m-auto max-w-2xl w-[calc(100vw-2rem)] backdrop:bg-base/85 backdrop:backdrop-blur-sm"
      >
        <div className="bg-surface border border-line-strong shadow-none">
          <div className="flex items-start justify-between gap-4 p-6 border-b border-line-subtle">
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant={kindBadgeVariant(event.kind)}>{KIND_LABEL[event.kind]}</Badge>
              {event.isLive && (
                <Badge variant="red" pulse>
                  Live now
                </Badge>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="p-1 -mr-1 -mt-1 text-ink-muted hover:text-ink transition-colors"
            >
              <X strokeWidth={1.5} className="h-5 w-5" />
            </button>
          </div>

          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            <div className="space-y-3">
              <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
                {formatKstDateTime(event.startsAt)}
              </p>
              <h2
                id={`event-${event.id}-title`}
                className="font-heading text-display-sm text-ink leading-tight"
              >
                {event.title}
              </h2>
              <p className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
                <MapPin strokeWidth={1.5} className="h-4 w-4 shrink-0" />
                <span className="break-words">{event.location}</span>
              </p>
            </div>

            {event.description && (
              <div className="text-body-md text-ink-secondary whitespace-pre-line break-words leading-relaxed">
                {linkify(event.description).map((part, i) =>
                  part.kind === "text" ? (
                    <span key={i}>{part.value}</span>
                  ) : (
                    <a
                      key={i}
                      href={part.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-blue-bright underline underline-offset-4 hover:text-ink break-all"
                    >
                      {part.url}
                    </a>
                  ),
                )}
              </div>
            )}

            {event.cta && (
              <div className="flex flex-wrap gap-3 pt-2 border-t border-line-subtle">
                <a
                  href={event.cta.href}
                  target={ctaIsExternal ? "_blank" : undefined}
                  rel={ctaIsExternal ? "noreferrer" : undefined}
                  className="inline-flex items-center gap-2 bg-brand-red hover:bg-brand-red-hover active:bg-brand-red-muted text-ink px-6 py-3 font-semibold rounded-md transition-colors"
                >
                  {event.cta.label}
                  <ArrowUpRight strokeWidth={1.5} className="h-4 w-4" />
                </a>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="inline-flex items-center gap-2 border border-line-strong text-ink hover:border-brand-red px-6 py-3 font-semibold rounded-md transition-colors"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
