import Link from "next/link";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/ds/live-dot";
import { StatStrip, statCells } from "@/components/ds/stat-strip";
import type { StatusBarData } from "@/lib/tournament-status";

/**
 * StatusBar: the broadcast lower third at the top of /tournaments and the
 * empty state on format pages. The data (mode included) is derived
 * server-side in src/lib/tournament-status.ts; this component only renders.
 */

const TAG: Record<StatusBarData["mode"], { label: string; tone: "red" | "blue"; pulse: boolean }> = {
  live: { label: "Live now", tone: "red", pulse: true },
  next: { label: "Next up", tone: "red", pulse: true },
  offseason: { label: "Off-season", tone: "blue", pulse: false },
};

export function StatusBar({ data, className }: { data: StatusBarData; className?: string }) {
  const tag = TAG[data.mode];
  const external = data.cta.external || /^https?:\/\//.test(data.cta.href);
  const ctaCls =
    "inline-flex min-h-12 items-center border border-ds-text px-6 font-heading text-ds-ui font-semibold text-white transition-colors duration-150 hover:bg-white/10";
  return (
    <div className={cn("cut-bar border border-ds-line bg-ds-surface", className)}>
      <div className="flex flex-wrap items-stretch">
        <div
          className={cn(
            "flex min-w-[180px] flex-[0_0_auto] items-center gap-3.5 px-7 py-6",
            tag.tone === "blue" ? "bg-ds-blue" : "bg-ds-red",
          )}
        >
          <LiveDot pulse={tag.pulse} tone={tag.pulse ? "white" : "grey"} />
          <span className="font-display text-[30px] leading-none tracking-[0.04em] text-white">
            {tag.label}
          </span>
        </div>
        <div className="min-w-0 flex-[1_1_360px] px-8 py-[22px]">
          <p className="m-0 font-display text-[clamp(40px,5vw,60px)] leading-[0.95] text-white [overflow-wrap:anywhere]">
            {data.title}
          </p>
          {data.sub && <p className="mb-0 mt-1.5 text-ds-body text-ds-text-muted">{data.sub}</p>}
        </div>
        <div className="flex flex-[0_0_auto] items-center px-8 py-[22px]">
          {external ? (
            <a href={data.cta.href} target="_blank" rel="noreferrer" className={ctaCls}>
              {data.cta.label}
            </a>
          ) : (
            <Link href={data.cta.href} className={ctaCls}>
              {data.cta.label}
            </Link>
          )}
        </div>
      </div>
      <StatStrip
        compact
        bordered={false}
        className="border-t border-ds-line"
        cells={statCells(data.cells.slice(0, 4))}
      />
    </div>
  );
}
