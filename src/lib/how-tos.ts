import { GUIDES, type Guide } from "@/data/how-tos";

export type { Guide, GuideTocEntry } from "@/data/how-tos";

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function getGuides(): Guide[] {
  return GUIDES;
}

export function getGuide(slug: string): Guide | null {
  return GUIDES.find((g) => g.slug === slug) ?? null;
}

/** Position in the reading order, 1-based. */
export function guideNumber(slug: string): number {
  return GUIDES.findIndex((g) => g.slug === slug) + 1;
}

/** "September 2026" from "2026-09"; null passes through. */
export function formatLastChecked(value: string | null): string | null {
  if (!value) return null;
  const [y, m] = value.split("-").map(Number);
  if (!y || !m) return null;
  return MONTH_FMT.format(new Date(Date.UTC(y, m - 1, 1)));
}

/** The most recent lastChecked across all guides, formatted, or null. */
export function latestLastChecked(): string | null {
  const dates = GUIDES.map((g) => g.lastChecked).filter((d): d is string => Boolean(d)).sort();
  return formatLastChecked(dates[dates.length - 1] ?? null);
}
