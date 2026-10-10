import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { ChampionSplit } from "@/components/ds/champion-split";
import { PageHeader } from "@/components/ds/page-header";
import { ResultsTable } from "@/components/ds/results-table";
import { cn } from "@/lib/utils";
import {
  FORMAT_HREFS,
  FORMAT_NAMES,
  formatMonthShortYear,
  formatMonthYear,
} from "@/lib/tournament-status";
import type { ChampionRecord } from "@/types/champion";

/**
 * Hall of champions: PageHeader at h2, the latest result as a
 * ChampionSplit, then every completed tournament in a ResultsTable.
 * Records come from the DB (test tournaments excluded) plus the legacy
 * file; nothing here is hand-written.
 */

export function formatLabel(r: ChampionRecord): string {
  return r.formatKey ? FORMAT_NAMES[r.formatKey] : r.game;
}

export function fieldLabel(r: ChampionRecord): string | null {
  if (!r.teams) return null;
  return r.formatKey === "rb" ? `${r.teams} players` : `${r.teams} teams`;
}

function primaryLink(r: ChampionRecord): { label: string; href: string } | null {
  const link = r.links?.[0];
  if (link) return { label: /recap|watch/i.test(link.label) ? "Watch the recap" : "Open the bracket", href: link.href };
  return r.formatKey ? { label: "See the format", href: FORMAT_HREFS[r.formatKey] } : null;
}

export function HallOfChampions({
  results,
  next,
}: {
  results: ChampionRecord[];
  /** Shown as the empty state when nothing has been won yet. */
  next?: { name: string; when: string | null; href: string } | null;
}) {
  const latest = results[0] ?? null;
  return (
    <section aria-labelledby="hall-of-champions-title" id="hall-of-champions" className="scroll-mt-24">
      <PageHeader
        level="h2"
        id="hall-of-champions-title"
        tag="Hall of champions"
        title="Every crown, kept."
        deck="Winners go up here after each final."
      />
      <div className="ds-container mt-10">
        {latest ? (
          <>
            <ChampionSplit
              champion={latest.champion.name}
              caption={`${formatLabel(latest)}, ${formatMonthYear(latest.date)}`}
              facts={[
                { k: "Runner-up", v: latest.runnerUp?.name },
                { k: "Field", v: fieldLabel(latest) },
                { k: "Venue", v: latest.venue },
              ]}
              cta={primaryLink(latest)}
            />
            <ResultsTable
              className="mt-7"
              caption="Every completed LoLMK tournament, newest first"
              columns={[
                { key: "when", label: "When", tone: "muted" },
                { key: "format", label: "Format" },
                { key: "champion", label: "Champion", tone: "gold" },
                { key: "runnerUp", label: "Runner-up", tone: "muted" },
                { key: "link", label: "Link", srOnlyLabel: true, align: "right" },
              ]}
              rows={results.map((r) => {
                const link = r.links?.[0];
                return {
                  id: r.id,
                  when: formatMonthShortYear(r.date),
                  format: formatLabel(r),
                  champion: r.champion.name,
                  runnerUp: r.runnerUp?.name ?? null,
                  link: link ? { label: /recap/i.test(link.label) ? "Recap" : "Bracket", href: link.href } : null,
                };
              })}
            />
          </>
        ) : (
          <div className="cut-plate flex flex-wrap items-center justify-between gap-6 border border-ds-line bg-ds-surface px-8 py-8">
            <p className="m-0 max-w-deck text-ds-deck text-ds-text-muted">
              {next
                ? `No finals recorded yet. Next up: ${next.name}${next.when ? `, ${next.when}` : ""}.`
                : "No finals recorded yet. The first champion goes up here after the next final."}
            </p>
            {next ? (
              <Link href={next.href} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
                Event details
              </Link>
            ) : (
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              >
                Join the Discord
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
