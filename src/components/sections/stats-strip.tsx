import { StatStrip, statCells } from "@/components/ds/stat-strip";
import type { CommunityStat } from "@/types/stat";

interface StatsStripProps {
  stats: CommunityStat[];
}

/**
 * Homepage stats band, on the shared StatStrip. Stats whose value is
 * unknown (Discord unreachable, nothing scheduled) are omitted rather than
 * shown as a dash or "TBA".
 */
export function StatsStrip({ stats }: StatsStripProps) {
  const cells = statCells(
    stats.map((stat) => ({
      k: stat.label,
      v: isKnown(stat.value) ? stat.value : null,
      hint: stat.hint || undefined,
      dot: stat.id === "discord-online" ? ("online" as const) : undefined,
    })),
  );
  if (cells.length === 0) return null;
  return (
    <section aria-label="LoLMK in numbers" className="border-y border-ds-line bg-ds-surface">
      <div className="container-wide">
        <StatStrip cells={cells} bordered={false} className="border-x border-ds-line" countUp />
      </div>
    </section>
  );
}

function isKnown(value: string): boolean {
  const v = value.trim();
  return v !== "" && v !== "—" && v !== "-" && v.toUpperCase() !== "TBA";
}
