import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Trophy, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BracketFlow } from "@/components/sections/bracket-flow";
import { TeamGrid } from "@/components/sections/team-grid";
import { getTournamentBySlug } from "@/lib/tournaments";

export const metadata: Metadata = {
  title: "Q1 2026 Tournament — Preview",
  description:
    "Placeholder preview of the tournament page. Real data ships when the bot HTTP API is wired up.",
  robots: { index: false, follow: false },
};

const KST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default async function TournamentPreviewPage() {
  // Preview pages are dev-only — hidden from production deployments.
  if (process.env.NODE_ENV === "production") notFound();

  const data = await getTournamentBySlug("preview");
  if (!data) notFound();

  const { tournament, teams, matches } = data;
  const champion = tournament.champion_team_id
    ? teams.find((t) => t.id === tournament.champion_team_id) ?? null
    : null;
  const approvedTeams = teams.filter((t) => t.status === "approved");

  return (
    <>
      <section className="relative overflow-hidden border-b border-line-subtle">
        <div
          aria-hidden
          className="absolute inset-0 grain pointer-events-none"
        />
        <div
          aria-hidden
          className="absolute -top-32 left-1/2 h-[500px] w-[1100px] -translate-x-1/2 bg-gradient-to-br from-brand-red/15 via-transparent to-brand-blue/15 blur-3xl pointer-events-none"
        />
        <div className="container-wide relative pt-24 pb-16">
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Badge variant="red">Preview</Badge>
            <Badge variant="default">Q1 2026</Badge>
            <Badge variant="blue">Double elim · 12 teams</Badge>
            <Badge variant="outline">{tournament.status}</Badge>
          </div>

          <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95] mb-6">
            {tournament.name}
          </h1>

          {tournament.description && (
            <p className="text-body-lg text-ink-secondary max-w-[60ch] mb-8">
              {tournament.description}
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl">
            <div>
              <p className="text-label uppercase text-ink-muted mb-1">Format</p>
              <p className="font-heading text-heading-md text-ink">Double elim</p>
            </div>
            <div>
              <p className="text-label uppercase text-ink-muted mb-1">Teams</p>
              <p className="font-heading text-heading-md text-ink">
                {approvedTeams.length}
              </p>
            </div>
            <div>
              <p className="text-label uppercase text-ink-muted mb-1">Dates</p>
              <p className="font-heading text-heading-md text-ink">
                {tournament.start_date
                  ? KST_DATE.format(new Date(tournament.start_date))
                  : "TBA"}
                {tournament.end_date
                  ? ` – ${KST_DATE.format(new Date(tournament.end_date))}`
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-label uppercase text-ink-muted mb-1">Matches</p>
              <p className="font-heading text-heading-md text-ink">
                {matches.length}
              </p>
            </div>
          </div>

          {tournament.prize_description && (
            <div className="mt-8 max-w-2xl border-l-2 border-brand-red pl-4">
              <p className="text-label uppercase text-ink-muted mb-1">Prizes</p>
              <p className="text-body-md text-ink-secondary">
                {tournament.prize_description}
              </p>
            </div>
          )}
        </div>
      </section>

      {champion && (
        <section className="bg-surface border-b border-line-subtle">
          <div className="container-wide py-12 flex flex-col md:flex-row md:items-center gap-6">
            <Trophy
              strokeWidth={1.5}
              className="h-12 w-12 text-brand-red shrink-0"
            />
            <div className="flex-1">
              <p className="text-label uppercase text-ink-muted">Champion</p>
              <p className="font-display text-display-md text-ink leading-tight">
                {champion.name}
              </p>
              <p className="text-body-sm text-ink-secondary font-mono">
                [{champion.tag}] · captain &lt;@{champion.captain_discord_id}&gt;
              </p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-label uppercase text-ink-muted">Seed</span>
              <span className="font-display text-display-md text-ink leading-none">
                #{champion.seed}
              </span>
            </div>
          </div>
        </section>
      )}

      <section className="mx-auto w-full max-w-[2200px] px-4 md:px-8 lg:px-12 py-16">
        <div className="space-y-2 mb-8">
          <p className="text-label uppercase text-ink-muted">Bracket</p>
          <h2 className="font-heading text-display-md text-ink">
            Tournament flow
          </h2>
        </div>

        <BracketFlow matches={matches} teams={teams} />
      </section>

      <section className="container-wide py-16 border-t border-line-subtle">
        <div className="flex items-baseline justify-between mb-8">
          <div className="space-y-2">
            <p className="text-label uppercase text-ink-muted">Teams &amp; rosters</p>
            <h2 className="font-heading text-display-md text-ink">
              Click any team to view roster
            </h2>
          </div>
          <span className="text-body-sm text-ink-muted">
            {approvedTeams.length} approved
          </span>
        </div>
        <TeamGrid teams={approvedTeams} />
      </section>

      <section className="container-wide py-12 border-t border-line-subtle">
        <div className="max-w-3xl border border-line p-6 bg-surface">
          <div className="flex items-start gap-4">
            <MapPin
              strokeWidth={1.5}
              className="h-5 w-5 text-brand-blue-bright shrink-0 mt-1"
            />
            <div className="space-y-2">
              <p className="font-heading text-heading-md text-ink">
                This is preview data
              </p>
              <p className="text-body-sm text-ink-secondary">
                Hand-authored placeholder so you can show others how the tournament
                page will look. Once the Discord bot's HTTP API is connected,{" "}
                <code className="font-mono text-brand-blue-bright">
                  src/lib/tournaments.ts
                </code>{" "}
                swaps from reading{" "}
                <code className="font-mono text-brand-blue-bright">
                  src/data/tournament-preview.json
                </code>{" "}
                to a{" "}
                <code className="font-mono text-brand-blue-bright">fetch()</code>{" "}
                call — no UI changes needed.
              </p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
