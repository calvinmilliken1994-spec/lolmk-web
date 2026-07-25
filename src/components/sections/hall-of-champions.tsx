import { Trophy, Crown, Users, CalendarDays, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChampionRecord, ChampionTeam } from "@/types/champion";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function initials(team: ChampionTeam): string {
  if (team.tag) return team.tag.slice(0, 3).toUpperCase();
  return team.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
}

function Crest({ team, size = "md" }: { team: ChampionTeam; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-20 w-20 text-heading-lg" : "h-12 w-12 text-body-sm";
  return (
    <span
      className={`flex ${box} shrink-0 items-center justify-center border border-brand-red bg-brand-red-muted font-display tracking-wide text-ink`}
      aria-hidden
    >
      {initials(team)}
    </span>
  );
}

function DetailCell({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string;
}) {
  return (
    <div className="p-6 flex flex-col gap-1">
      <span className="inline-flex items-center gap-2 text-label uppercase text-ink-muted">
        <Icon strokeWidth={1.5} className="h-4 w-4" />
        {label}
      </span>
      <span className="font-heading text-heading-md text-ink">{value}</span>
    </div>
  );
}

export function HallOfChampions({
  latest,
  past,
}: {
  latest: ChampionRecord | null;
  past: ChampionRecord[];
}) {
  return (
    <section className="container-wide py-24 border-t border-line-subtle">
      <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="max-w-2xl">
          <p className="text-label uppercase text-ink-muted mb-4 inline-flex items-center gap-2">
            <Trophy strokeWidth={1.5} className="h-4 w-4 text-warning" />
            Hall of Champions
          </p>
          <h2 className="font-heading text-display-md text-ink">Every crown, kept.</h2>
          <p className="mt-4 text-body-md text-ink-secondary">
            The teams that took the title. Winners are added here after each
            tournament final.
          </p>
        </div>
      </div>

      {latest ? (
        <>
          <FeaturedChampion record={latest} />
          {past.length > 0 && (
            <div className="mt-12">
              <p className="text-label uppercase text-ink-muted mb-4">Past winners</p>
              <ul className="divide-y divide-line-subtle border-y border-line-subtle">
                {past.map((r) => (
                  <PastChampionRow key={r.id} record={r} />
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <EmptyHall />
      )}
    </section>
  );
}

function FeaturedChampion({ record }: { record: ChampionRecord }) {
  return (
    <article className="border border-line bg-surface">
      <div className="relative overflow-hidden border-b border-line p-8 md:p-10">
        <div
          aria-hidden
          className="absolute -top-24 -right-16 h-72 w-72 rounded-full bg-warning/10 blur-3xl pointer-events-none"
        />
        <div className="relative flex flex-col gap-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="inline-flex items-center gap-2 text-label uppercase text-warning">
                <Crown strokeWidth={1.5} className="h-4 w-4" />
                Reigning champion
              </span>
              <p className="mt-2 font-mono text-caption uppercase tracking-wider text-ink-muted">
                {record.tournament} · {record.game} · {DATE_FMT.format(new Date(record.date))}
              </p>
            </div>
            {record.placeholder && (
              <Badge variant="outline">Sample — replace with results</Badge>
            )}
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-6">
            <Crest team={record.champion} size="lg" />
            <div className="min-w-0">
              <h3 className="font-display text-display-sm md:text-display-md text-ink leading-none">
                {record.champion.name}
              </h3>
              {record.champion.players && record.champion.players.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {record.champion.players.map((p) => (
                    <span
                      key={p}
                      className="px-3 py-1 border border-line bg-elevated text-body-sm text-ink-secondary"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line-subtle">
        {record.runnerUp && (
          <DetailCell icon={Trophy} label="Runner-up" value={record.runnerUp.name} />
        )}
        {record.format && <DetailCell icon={CalendarDays} label="Format" value={record.format} />}
        {typeof record.teams === "number" && (
          <DetailCell icon={Users} label="Field" value={`${record.teams} teams`} />
        )}
      </div>

      {record.links && record.links.length > 0 && (
        <div className="flex flex-wrap gap-4 border-t border-line-subtle px-6 py-4">
          {record.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-body-sm font-medium text-brand-red-bright hover:text-brand-red-hover"
            >
              {l.label}
              <ExternalLink strokeWidth={1.5} className="h-4 w-4" />
            </a>
          ))}
        </div>
      )}
    </article>
  );
}

function PastChampionRow({ record }: { record: ChampionRecord }) {
  return (
    <li className="flex items-center gap-4 py-5">
      <Crest team={record.champion} />
      <div className="min-w-0 flex-1">
        <p className="font-heading text-heading-md text-ink truncate">
          {record.champion.name}
        </p>
        <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
          {record.tournament} · {DATE_FMT.format(new Date(record.date))}
        </p>
      </div>
      <Crown strokeWidth={1.5} className="h-5 w-5 text-warning shrink-0" />
    </li>
  );
}

function EmptyHall() {
  return (
    <div className="border border-dashed border-line-strong bg-surface p-12 text-center flex flex-col items-center gap-4">
      <Trophy strokeWidth={1} className="h-14 w-14 text-ink-muted opacity-40" />
      <div className="space-y-1">
        <p className="font-heading text-heading-lg text-ink">The hall is waiting.</p>
        <p className="text-body-md text-ink-secondary max-w-md">
          The first champions go up here after the next tournament final. Follow
          along in Discord to see who takes the crown.
        </p>
      </div>
    </div>
  );
}
