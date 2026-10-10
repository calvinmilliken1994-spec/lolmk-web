import { ChampionSplit } from "@/components/ds/champion-split";
import { fieldLabel, formatLabel } from "@/components/ds/hall-of-champions";
import { StatusBar } from "@/components/ds/status-bar";
import {
  deriveStatusBar,
  formatMonthYear,
  type FormatKey,
  type StatusCell,
  type TournamentOverview,
} from "@/lib/tournament-status";

/**
 * The top of a format page: the StatusBar for that format (live, next or
 * off-season, derived from data) and, when nothing is live, the format's
 * last result. Never an empty box.
 */
export function FormatStatus({
  overview,
  format,
  weekly,
}: {
  overview: TournamentOverview;
  format: FormatKey;
  weekly?: StatusCell | null;
}) {
  const state = overview.states[format];
  const status = deriveStatusBar(overview, format, { weekly });
  const last = state.live ? null : state.lastResult;
  return (
    <section aria-label="Status" className="ds-container space-y-7">
      <StatusBar data={status} />
      {last && (
        <ChampionSplit
          champion={last.champion.name}
          caption={`${formatLabel(last)}, ${formatMonthYear(last.date)}`}
          facts={[
            { k: "Runner-up", v: last.runnerUp?.name },
            { k: "Field", v: fieldLabel(last) },
            { k: "Venue", v: last.venue },
          ]}
          cta={last.links?.[0] ? { label: "Open the bracket", href: last.links[0].href } : null}
        />
      )}
    </section>
  );
}
