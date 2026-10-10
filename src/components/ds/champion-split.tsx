import Link from "next/link";
import { Trophy } from "lucide-react";

/**
 * ChampionSplit: the most recent completed tournament across all formats.
 * Red panel (~60%, diagonal right edge, straightened below 760px) with the
 * champion; blue side with a 2×2 definition list and one outline CTA.
 * Facts with no value are omitted, never shown as placeholders.
 */

export interface ChampionSplitProps {
  champion: string;
  /** "ARAM Mayhem, September 2026" */
  caption: string;
  facts: { k: string; v: string | null | undefined }[];
  cta?: { label: string; href: string } | null;
}

export function ChampionSplit({ champion, caption, facts, cta }: ChampionSplitProps) {
  const known = facts.filter((f): f is { k: string; v: string } => Boolean(f.v));
  const external = cta ? /^https?:\/\//.test(cta.href) : false;
  const ctaCls =
    "inline-flex min-h-12 items-center self-start border border-white px-[22px] font-heading text-ds-ui font-semibold text-white transition-colors duration-150 hover:bg-white/10";
  return (
    <div className="flex flex-wrap overflow-hidden bg-ds-blue">
      <div className="relative min-w-0 flex-[1.5_1_520px] overflow-hidden bg-ds-red px-8 pb-12 pt-11 sm:pl-12 sm:pr-[120px] min-[760px]:[clip-path:polygon(0_0,100%_0,calc(100%-72px)_100%,0_100%)]">
        <div
          aria-hidden
          className="absolute -top-10 right-[60px] select-none font-display text-[360px] leading-none text-transparent"
          style={{ WebkitTextStroke: "1.5px rgba(255,255,255,0.16)" }}
        >
          1
        </div>
        <p className="relative m-0 flex items-center gap-2.5 font-heading text-ds-ui font-semibold text-white">
          <Trophy aria-hidden strokeWidth={1.75} className="h-5 w-5" />
          Latest champion
        </p>
        <p className="relative mb-0 mt-[18px] font-display text-[clamp(80px,10vw,150px)] leading-[0.84] text-white [overflow-wrap:anywhere]">
          {champion}
        </p>
        <p className="relative mb-0 mt-[18px] font-heading text-ds-ui-lg font-medium text-white">{caption}</p>
      </div>
      <div className="flex min-w-0 flex-[1_1_340px] flex-col justify-between gap-8 px-8 pb-12 pt-11 sm:pl-8 sm:pr-12">
        {known.length > 0 && (
          <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-7 font-heading">
            {known.map((f) => (
              <div key={f.k}>
                <dt className="text-[14px] text-[#C3CCE8]">{f.k}</dt>
                <dd className="mb-0 ml-0 mt-1 text-[22px] font-semibold text-white">{f.v}</dd>
              </div>
            ))}
          </dl>
        )}
        {cta &&
          (external ? (
            <a href={cta.href} target="_blank" rel="noreferrer" className={ctaCls}>
              {cta.label}
            </a>
          ) : (
            <Link href={cta.href} className={ctaCls}>
              {cta.label}
            </Link>
          ))}
      </div>
    </div>
  );
}
