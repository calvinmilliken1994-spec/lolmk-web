import { StatStrip, type StatCell } from "@/components/ds/stat-strip";

/**
 * A StatStrip whose cells arrive as a promise, for use inside <Suspense> so
 * a slow Discord call doesn't hold up the rest of the page. Renders nothing
 * when every cell turned out unknown.
 */
export async function AsyncStatStrip({ cells }: { cells: Promise<StatCell[]> }) {
  const resolved = await cells;
  if (resolved.length === 0) return null;
  return <StatStrip cells={resolved} countUp />;
}
