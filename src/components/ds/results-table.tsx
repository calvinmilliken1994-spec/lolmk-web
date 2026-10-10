import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * ResultsTable: a real <table> in a horizontally scrolling box (min width
 * 720px). The Hall of Champions uses When / Format / Champion / Runner-up /
 * link; the Locker reuses it with its own columns.
 *
 * A column whose every cell is empty is dropped, so a field we don't record
 * (e.g. runner-up for older results) never renders as a column of blanks.
 */

export interface ResultsColumn {
  key: string;
  label: string;
  /** Visually hidden header (e.g. the link column). */
  srOnlyLabel?: boolean;
  tone?: "muted" | "gold";
  align?: "right";
}

export type ResultsRow = Record<string, ReactNode | { label: string; href: string } | null | undefined> & {
  id: string;
};

function isLink(v: unknown): v is { label: string; href: string } {
  return typeof v === "object" && v !== null && "href" in v && "label" in v;
}

export function ResultsTable({
  columns,
  rows,
  caption,
  className,
}: {
  columns: ResultsColumn[];
  rows: ResultsRow[];
  caption?: string;
  className?: string;
}) {
  const shown = columns.filter((c) => rows.some((r) => r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== ""));
  if (rows.length === 0) return null;
  return (
    <div className={cn("overflow-x-auto border border-ds-line", className)}>
      <table className="w-full min-w-[720px] border-collapse font-heading text-[16px]">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="bg-ds-surface text-left text-ds-label text-ds-text-dim">
            {shown.map((c) => (
              <th key={c.key} scope="col" className={cn("px-6 py-3.5 font-medium", c.align === "right" && "text-right")}>
                {c.srOnlyLabel ? <span className="sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-ds-line-soft">
              {shown.map((c) => {
                const v = row[c.key];
                return (
                  <td
                    key={c.key}
                    className={cn(
                      "px-6 py-[18px]",
                      c.tone === "muted" && "text-ds-text-muted",
                      c.tone === "gold" && "font-bold text-ds-gold",
                      c.align === "right" && "text-right",
                    )}
                  >
                    {isLink(v) ? (
                      /^https?:\/\//.test(v.href) ? (
                        <a href={v.href} target="_blank" rel="noreferrer" className="ds-link font-semibold text-ds-text">
                          {v.label}
                        </a>
                      ) : (
                        <Link href={v.href} className="ds-link font-semibold text-ds-text">
                          {v.label}
                        </Link>
                      )
                    ) : (
                      (v as ReactNode) ?? null
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
