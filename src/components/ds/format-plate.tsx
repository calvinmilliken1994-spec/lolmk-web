import Link from "next/link";
import { cn } from "@/lib/utils";
import { LiveDot } from "@/components/ds/live-dot";
import type { FormatChip, FormatKey } from "@/lib/tournament-status";

/**
 * FormatPlate: one card per tournament format on /tournaments.
 * 210px art zone (tint + texture + giant outlined format code, cropped by
 * the bottom edge) with the derived status chip, then title, description,
 * a three-row definition list and a full-width footer link.
 */

const ART: Record<FormatKey, { code: string; bg: string; stroke: string }> = {
  sr: { code: "SR", bg: "bg-ds-art-sr", stroke: "rgba(186,38,60,0.75)" },
  aram: { code: "ARAM", bg: "bg-ds-art-aram", stroke: "rgba(120,146,220,0.7)" },
  rb: { code: "RB", bg: "bg-ds-art-rb", stroke: "rgba(217,178,95,0.65)" },
};

export interface FormatPlateProps {
  format: FormatKey;
  title: string;
  description: string;
  facts: { k: string; v: string }[];
  chip: FormatChip;
  link: { label: string; href: string };
}

export function FormatPlate({ format, title, description, facts, chip, link }: FormatPlateProps) {
  const art = ART[format];
  return (
    <article className="cut-plate flex min-w-0 flex-[1_1_340px] flex-col border border-ds-line bg-ds-surface transition-[transform,border-color] duration-[250ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] hover:-translate-y-1 hover:border-ds-line-strong motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className={cn("texture-art relative h-[210px] overflow-hidden", art.bg)}>
        <div
          aria-hidden
          className="absolute -bottom-[58px] -left-1.5 select-none font-display text-[280px] leading-none text-transparent"
          style={{ WebkitTextStroke: `1.5px ${art.stroke}` }}
        >
          {art.code}
        </div>
        <span
          className={cn(
            "absolute left-[18px] top-[18px] inline-flex min-h-7 items-center gap-2 px-3 font-heading text-ds-label font-semibold",
            chip.tone === "red" ? "bg-ds-red text-white" : "bg-ds-line-soft text-[#C9D0E3]",
          )}
        >
          {chip.pulse && <LiveDot size="sm" />}
          {chip.label}
        </span>
      </div>
      <div className="flex flex-auto flex-col gap-3 px-7 pt-[26px]">
        <h2 className="m-0 font-display text-ds-plate font-normal text-white">{title}</h2>
        <p className="m-0 text-ds-body text-ds-text-muted">{description}</p>
        {facts.length > 0 && (
          <dl className="mb-0 mt-2 font-heading text-ds-ui">
            {facts.map((f) => (
              <div key={f.k} className="flex justify-between gap-4 border-t border-ds-line-soft py-[11px]">
                <dt className="text-ds-text-dim">{f.k}</dt>
                <dd className="m-0 text-right font-semibold text-ds-text">{f.v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <Link
        href={link.href}
        className="mt-4 flex min-h-14 items-center border-t border-ds-line px-7 font-heading text-ds-ui font-semibold text-white transition-colors duration-150 hover:bg-ds-surface-2"
      >
        {link.label}
      </Link>
    </article>
  );
}
