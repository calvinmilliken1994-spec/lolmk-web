import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatStrip, type StatCell } from "@/components/ds/stat-strip";

/**
 * PageHeader: the one header for every redesigned public page.
 *
 *   slanted tag  →  Bebas title  →  Inter deck  →  StatStrip
 *
 * `level="h1"` is the page header; `level="h2"` is the same component at
 * section scale (e.g. Hall of champions). No other H1 styling should exist
 * on redesigned pages.
 */

export interface PageHeaderProps {
  tag: string;
  tagTone?: "red" | "blue";
  title: ReactNode;
  deck?: ReactNode;
  stats?: StatCell[];
  /** Rendered in place of `stats` (a Suspense boundary or a loading skeleton). */
  statsSlot?: ReactNode;
  /** Right-aligned beside the tag (e.g. "Edit profile"). */
  actions?: ReactNode;
  /** Sits to the left of the title (e.g. the Locker avatar). */
  media?: ReactNode;
  level?: "h1" | "h2";
  /** id for the heading, for aria-labelledby on the enclosing section. */
  id?: string;
  className?: string;
  /** Wrap in its own <section> with page padding (default). */
  standalone?: boolean;
}

export function PageTag({ tone = "red", children }: { tone?: "red" | "blue"; children: ReactNode }) {
  return (
    <div
      className={cn(
        "cut-tag inline-block pb-1.5 pl-3.5 pr-[26px] pt-2 font-display text-ds-tag tracking-[0.06em] text-white",
        tone === "blue" ? "bg-ds-blue" : "bg-ds-red",
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  tag,
  tagTone = "red",
  title,
  deck,
  stats,
  statsSlot,
  actions,
  media,
  level = "h1",
  id,
  className,
  standalone = true,
}: PageHeaderProps) {
  const Heading = level;
  const body = (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <PageTag tone={tagTone}>{tag}</PageTag>
        {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      </div>
      <div className={cn("mt-5", media && "flex flex-col gap-6 sm:flex-row sm:items-end sm:gap-8")}>
        {media && <div className="shrink-0">{media}</div>}
        <Heading
          id={id}
          className={cn(
            "m-0 font-display font-normal text-ds-text [overflow-wrap:anywhere]",
            level === "h1" ? "text-ds-h1 tracking-[0.005em]" : "text-ds-h2",
          )}
        >
          {title}
        </Heading>
      </div>
      {deck && (
        <p
          className={cn(
            "mb-0 max-w-deck text-ds-deck text-ds-text-muted",
            level === "h1" ? "mt-6" : "mt-[18px]",
          )}
        >
          {deck}
        </p>
      )}
      {statsSlot ? (
        <div className="mt-9">{statsSlot}</div>
      ) : (
        stats && stats.length > 0 && <StatStrip cells={stats} className="mt-9" countUp />
      )}
    </>
  );

  if (!standalone) return <div className={className}>{body}</div>;
  return (
    <section
      className={cn(
        "ds-container",
        level === "h1"
          ? "pb-10 pt-[clamp(48px,7vw,88px)]"
          : "pt-[clamp(80px,9vw,120px)]",
        className,
      )}
    >
      {body}
    </section>
  );
}
