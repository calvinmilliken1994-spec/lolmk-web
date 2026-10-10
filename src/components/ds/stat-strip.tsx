import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * StatStrip: label/value cells on a 1px-gap grid. The `line` background shows
 * through the gap, so the dividers come from the grid, not from borders.
 *
 * Cells with no value must not be passed in. Callers filter unknowns out
 * (see `statCells`), so nothing ever renders "TBA" or a dash.
 */

export interface StatCell {
  /** Label, sentence case. */
  k: string;
  /** Value. Strings render in Bebas (default) or Space Grotesk (compact). */
  v: ReactNode;
  /** Renders the value as a link in the same style. */
  href?: string;
  /** Optional one-line note under the value. */
  hint?: string;
  /** Small coloured dot before the label (e.g. green for "Online now"). */
  dot?: "online";
  /** Gold value; only for champion results. */
  tone?: "gold";
}

/** Drops cells whose value is null, undefined or empty, so unknowns are omitted. */
export function statCells(
  cells: Array<Omit<StatCell, "v"> & { v: ReactNode | null | undefined }>,
): StatCell[] {
  return cells.filter(
    (c): c is StatCell => c.v !== null && c.v !== undefined && c.v !== "",
  );
}

interface StatStripProps {
  cells: StatCell[];
  /** Status-bar variant: values in Space Grotesk 19px 600. */
  compact?: boolean;
  /** Outer 1px border (headers); the status bar supplies its own frame. */
  bordered?: boolean;
  className?: string;
  /** Data hook for the count-up animation and tests. */
  countUp?: boolean;
}

const COLS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function StatStrip({ cells, compact, bordered = true, className, countUp }: StatStripProps) {
  if (cells.length === 0) return null;
  return (
    <dl
      className={cn(
        "grid grid-cols-1 gap-px bg-ds-line",
        COLS[Math.min(cells.length, 4)],
        bordered && "border border-ds-line",
        className,
      )}
    >
      {cells.map((cell) => (
        <div key={cell.k} className="min-w-0 bg-ds-surface px-7 pb-5 pt-[18px]">
          <dt className="flex items-center gap-2 font-heading text-ds-label text-ds-text-dim">
            {cell.dot === "online" && (
              <span aria-hidden className="h-[7px] w-[7px] shrink-0 rounded-full bg-ds-online" />
            )}
            {cell.k}
          </dt>
          <dd
            className={cn(
              "m-0 min-w-0",
              compact
                ? "mt-1 font-heading text-ds-ui-lg text-ds-text"
                : "mt-1.5 font-display text-ds-stat tabular text-ds-text",
              cell.tone === "gold" && "text-ds-gold",
            )}
            data-count-up={countUp && !compact ? "" : undefined}
          >
            {cell.href ? (
              <StatLink href={cell.href}>{cell.v}</StatLink>
            ) : (
              cell.v
            )}
          </dd>
          {cell.hint && (
            <p className="mt-1.5 truncate text-body-sm text-ds-text-dim">{cell.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

function StatLink({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:\/\//.test(href);
  const cls = "ds-link text-ds-text hover:text-white";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}
