"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Dices,
  ExternalLink,
  ImageOff,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  ScrollText,
  Trash2,
  Trophy,
  Unlock,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ErrorBanner,
  Field,
  inputClass,
  isoToLocalInput,
  localInputToIso,
  StatusBadge,
  useRunner,
} from "@/components/sr/sr-shared";
import { TeamLogoUpload } from "@/components/sr/team-logo-upload";
import type {
  SrAuditLogEntry,
  SrMatch,
  SrTeam,
  SrTournamentFull,
} from "@/types/sr-tournament";
import {
  addTeam,
  generateBracket,
  removeTeam,
  reportMatchResult,
  rollSeeds,
  setSignupsOpen,
  setTeamStatus,
  undoMatchResult,
  unlockSeeds,
  updateTeam,
  updateTournament,
} from "@/app/tools/summoners-rift/actions";

const TABS = ["Setup", "Teams", "Bracket", "Audit"] as const;
type Tab = (typeof TABS)[number];

const BRACKET_LABEL: Record<SrMatch["bracket"], string> = {
  upper: "Upper",
  lower: "Lower",
  grand_final: "Grand final",
  third_place: "Third place",
};

export function SrAdminDetail({
  initial,
  audit,
  blobConfigured,
}: {
  initial: SrTournamentFull;
  audit: SrAuditLogEntry[];
  blobConfigured: boolean;
}) {
  const router = useRouter();
  const { pending, error, setError, run } = useRunner();
  const [tab, setTab] = useState<Tab>("Setup");

  // Props come straight from the server component on every render. Every
  // action in actions.ts calls revalidatePath("/tools/summoners-rift") after
  // COMMIT, so the RSC payload for this route is re-fetched and these props
  // update on their own — deliberately NOT copied into useState, which
  // would freeze the first render's snapshot and go stale the moment an
  // action succeeded.
  const { tournament, teams, matches } = initial;
  const refresh = () => router.refresh();
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  return (
    <div className="min-h-screen bg-base text-ink">
      <header className="sticky top-0 z-10 border-b border-line-subtle bg-base/90 backdrop-blur-md">
        <div className="container-wide flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href="/tools/summoners-rift"
              className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink shrink-0"
            >
              <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
              All tournaments
            </Link>
            <div className="h-4 w-px bg-line shrink-0" />
            <h1 className="font-display text-heading-lg leading-none truncate">
              {tournament.name}
            </h1>
            <StatusBadge status={tournament.status} pulse />
          </div>
          <a
            href={`/tournaments/summoners-rift/${tournament.slug}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-body-sm text-brand-blue-bright hover:text-ink"
          >
            <ExternalLink strokeWidth={1.75} className="h-4 w-4" />
            Public page
          </a>
        </div>
        <nav className="container-wide flex gap-1 overflow-x-auto pb-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "shrink-0 rounded-sm px-3.5 py-2 text-label uppercase tracking-wider transition-colors",
                tab === t
                  ? "bg-brand-red text-ink"
                  : "text-ink-secondary hover:bg-elevated hover:text-ink",
              )}
            >
              {t}
              {t === "Teams" && ` (${teams.length})`}
            </button>
          ))}
        </nav>
      </header>

      <main className="container-wide py-8 space-y-6">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {tab === "Setup" && (
          <SetupPanel
            data={initial}
            pending={pending}
            run={run}
            refresh={refresh}
          />
        )}
        {tab === "Teams" && (
          <TeamsPanel
            data={initial}
            pending={pending}
            run={run}
            refresh={refresh}
            blobConfigured={blobConfigured}
          />
        )}
        {tab === "Bracket" && (
          <BracketPanel
            data={initial}
            teamById={teamById}
            pending={pending}
            run={run}
            refresh={refresh}
          />
        )}
        {tab === "Audit" && <AuditPanel entries={audit} />}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

interface PanelProps {
  data: SrTournamentFull;
  pending: boolean;
  run: (fn: () => Promise<unknown>, onDone?: () => void) => void;
  refresh: () => void;
}

function SetupPanel({ data, pending, run, refresh }: PanelProps) {
  const { tournament, teams } = data;
  const [name, setName] = useState(tournament.name);
  const [bestOf, setBestOf] = useState<1 | 3 | 5>(tournament.best_of);
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(tournament.third_place_match);
  const [grandFinalReset, setGrandFinalReset] = useState(tournament.grand_final_reset);
  const [startAt, setStartAt] = useState(isoToLocalInput(tournament.start_at));
  const [endAt, setEndAt] = useState(isoToLocalInput(tournament.end_at));

  const isDraft = tournament.status === "draft";
  const hasBracket = data.matches.length > 0;
  const canRollSeeds = !tournament.seed_locked && teams.length >= tournament.min_teams;
  const canGenerate = tournament.seed_locked && tournament.status === "seeding";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr] items-start">
      <form
        className="border border-line bg-surface p-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              updateTournament(tournament.id, {
                name,
                ...(!hasBracket
                  ? { bestOf, thirdPlaceMatch, grandFinalReset }
                  : {}),
                // Dates are only submitted while in draft — actions.ts
                // rejects any date change afterward, so sending them
                // unconditionally would make every post-draft save fail.
                ...(isDraft
                  ? { startAt: localInputToIso(startAt), endAt: localInputToIso(endAt) }
                  : {}),
              }),
            refresh,
          );
        }}
      >
        <p className="font-heading text-heading-md text-ink">Settings</p>
        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Series length">
            <select
              className={inputClass}
              value={bestOf}
              disabled={hasBracket}
              onChange={(e) => setBestOf(Number(e.target.value) as 1 | 3 | 5)}
            >
              <option value={1}>Best of 1</option>
              <option value={3}>Best of 3</option>
              <option value={5}>Best of 5</option>
            </select>
          </Field>
          <Field label="Format" hint="Format is fixed at creation — it decides the whole bracket shape.">
            <input
              className={inputClass}
              value={tournament.format === "double_elim" ? "Double elimination" : "Single elimination"}
              disabled
              readOnly
            />
          </Field>
          <Field
            label="Starts (local)"
            hint={isDraft ? undefined : "Locked: dates can only change while in draft."}
          >
            <input
              type="datetime-local"
              className={inputClass}
              value={startAt}
              disabled={!isDraft}
              onChange={(e) => setStartAt(e.target.value)}
            />
          </Field>
          <Field label="Ends (local)">
            <input
              type="datetime-local"
              className={inputClass}
              value={endAt}
              disabled={!isDraft}
              onChange={(e) => setEndAt(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          {tournament.format === "single_elim" && (
            <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={thirdPlaceMatch}
                disabled={hasBracket}
                onChange={(e) => setThirdPlaceMatch(e.target.checked)}
              />
              Third-place match
            </label>
          )}
          <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={grandFinalReset}
              disabled={tournament.format !== "double_elim" || hasBracket}
              onChange={(e) => setGrandFinalReset(e.target.checked)}
            />
            Grand final reset
          </label>
          <p className="text-caption text-ink-muted">
            {hasBracket
              ? "Bracket settings are locked after generation."
              : "Format flags apply when the bracket is generated."}
          </p>
          <div className="flex items-center gap-3 border-t border-line-subtle pt-3">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending || (!isDraft && !tournament.signups_open)}
              onClick={() =>
                run(() => setSignupsOpen(tournament.id, !tournament.signups_open), refresh)
              }
            >
              {tournament.signups_open ? "Close signups" : "Open signups"}
            </Button>
            <span className="text-caption text-ink-muted">
              Captain signups are {tournament.signups_open ? "open" : "closed"}.
            </span>
          </div>
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save settings
        </Button>
      </form>

      <div className="border border-line bg-surface p-6 space-y-5">
        <p className="font-heading text-heading-md text-ink">Run order</p>
        <ol className="space-y-4">
          <Step
            n={1}
            title="Add teams"
            done={teams.length >= tournament.min_teams}
            detail={`${teams.length} of ${tournament.min_teams}–${tournament.max_teams} required.`}
          />
          <Step
            n={2}
            title="Roll seeds"
            done={tournament.seed_locked}
            detail="Randomly assigns seeds 1..N and locks them."
          >
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !canRollSeeds}
                onClick={() => run(() => rollSeeds(tournament.id), refresh)}
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Dices className="h-4 w-4" />}
                Roll seeds
              </Button>
              {tournament.status === "seeding" && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => run(() => unlockSeeds(tournament.id), refresh)}
                >
                  <Unlock className="h-4 w-4" />
                  Unlock
                </Button>
              )}
            </div>
          </Step>
          <Step
            n={3}
            title="Generate bracket"
            done={data.matches.length > 0}
            detail="Builds every match and publishes the bracket publicly."
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={pending || !canGenerate}
              onClick={() => run(() => generateBracket(tournament.id), refresh)}
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Workflow className="h-4 w-4" />}
              Generate bracket
            </Button>
          </Step>
          <Step
            n={4}
            title="Report results"
            done={tournament.status === "completed"}
            detail="Use the Bracket tab as matches finish."
          />
        </ol>
        <div className="border-t border-line-subtle pt-4 text-caption text-ink-muted space-y-1">
          <p>
            Slug: <span className="font-mono">{tournament.slug}</span>
          </p>
          <p>
            Seeds: {tournament.seed_locked ? "locked" : "not rolled"} · Matches:{" "}
            {data.matches.length}
          </p>
        </div>
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  detail,
  done,
  children,
}: {
  n: number;
  title: string;
  detail: string;
  done: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center border text-caption font-mono",
          done
            ? "border-success bg-success/15 text-success"
            : "border-line bg-elevated text-ink-muted",
        )}
      >
        {n}
      </span>
      <div className="space-y-2 min-w-0">
        <p className="font-heading text-body-md text-ink">{title}</p>
        <p className="text-caption text-ink-muted">{detail}</p>
        {children}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

function TeamsPanel({
  data,
  pending,
  run,
  refresh,
  blobConfigured,
}: PanelProps & { blobConfigured: boolean }) {
  const { tournament, teams } = data;
  const [newName, setNewName] = useState("");
  const draftOnly = tournament.status === "draft";
  const activeTeamCount = teams.filter((team) => team.status !== "rejected").length;
  const atCap = activeTeamCount >= tournament.max_teams;

  return (
    <div className="space-y-6">
      <div className="border border-line bg-surface p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="font-heading text-heading-md text-ink">Teams</p>
          <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
            {teams.length} / {tournament.max_teams} · min {tournament.min_teams}
          </p>
        </div>
        {!draftOnly && (
          <p className="inline-flex items-center gap-2 border border-warning/40 bg-warning/10 text-warning px-3 py-2 rounded-sm text-body-sm">
            <Lock className="h-4 w-4 shrink-0" />
            Roster is locked — teams can only be added or removed while the
            tournament is in draft. Unlock seeding from Setup to go back.
          </p>
        )}
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            run(() => addTeam(tournament.id, { name }), () => {
              setNewName("");
              refresh();
            });
          }}
        >
          <input
            className={cn(inputClass, "max-w-xs")}
            placeholder="Team name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={!draftOnly || atCap}
          />
          <Button
            type="submit"
            size="sm"
            disabled={pending || !draftOnly || atCap || !newName.trim()}
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add team
          </Button>
          {atCap && (
            <span className="self-center text-caption text-ink-muted">
              At the {tournament.max_teams}-team cap.
            </span>
          )}
        </form>
      </div>

      {teams.length === 0 ? (
        <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-sm text-ink-secondary">
          No teams yet.
        </p>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {teams.map((team) => (
            <TeamRow
              key={team.id}
              team={team}
              draftOnly={draftOnly}
              pending={pending}
              run={run}
              refresh={refresh}
              blobConfigured={blobConfigured}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamRow({
  team,
  draftOnly,
  pending,
  run,
  refresh,
  blobConfigured,
}: {
  team: SrTeam;
  draftOnly: boolean;
  pending: boolean;
  run: (fn: () => Promise<unknown>, onDone?: () => void) => void;
  refresh: () => void;
  blobConfigured: boolean;
}) {
  const [name, setName] = useState(team.name);
  const dirty = name.trim() !== team.name;

  return (
    <li className="border border-line bg-surface p-4 flex gap-4">
      <div className="shrink-0 space-y-2">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob URLs are
          // an arbitrary remote host; next/image would need a per-host
          // remotePatterns entry that doesn't exist yet.
          <img
            src={team.logo_url}
            alt=""
            width={64}
            height={64}
            className="h-16 w-16 border border-line object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center border border-dashed border-line-strong bg-elevated text-ink-muted">
            <ImageOff strokeWidth={1.5} className="h-6 w-6" />
          </span>
        )}
        <TeamLogoUpload
          teamId={team.id}
          configured={blobConfigured}
          hasLogo={Boolean(team.logo_url)}
          onUploaded={refresh}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <span className="shrink-0 border border-line bg-elevated px-2 py-1 text-caption font-mono text-ink-muted">
            {team.seed === null ? "—" : `#${team.seed}`}
          </span>
          <span className="shrink-0 border border-line px-2 py-1 text-caption font-mono uppercase text-ink-secondary">
            {team.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !dirty}
            onClick={() => run(() => updateTeam(team.id, { name: name.trim() }), refresh)}
          >
            <Save className="h-4 w-4" />
            Save
          </Button>
          {team.captain_discord_id && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending || !draftOnly || team.status === "approved"}
                onClick={() => run(() => setTeamStatus(team.id, "approved"), refresh)}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !draftOnly || team.status === "rejected"}
                onClick={() => run(() => setTeamStatus(team.id, "rejected"), refresh)}
              >
                Reject
              </Button>
            </>
          )}
          <button
            type="button"
            disabled={pending || !draftOnly}
            onClick={() => {
              if (!confirm(`Remove "${team.name}"?`)) return;
              run(() => removeTeam(team.id), refresh);
            }}
            className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-body-sm text-ink-muted rounded-sm hover:border-danger hover:text-danger disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-muted"
          >
            <Trash2 strokeWidth={1.75} className="h-4 w-4" />
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Bracket + live match reporting
// ---------------------------------------------------------------------------

function BracketPanel({
  data,
  teamById,
  pending,
  run,
  refresh,
}: PanelProps & { teamById: Map<string, SrTeam> }) {
  const { tournament, matches } = data;
  const champion = tournament.champion_team_id
    ? teamById.get(tournament.champion_team_id) ?? null
    : null;

  if (matches.length === 0) {
    return (
      <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-sm text-ink-secondary">
        No bracket yet. Roll seeds, then generate the bracket from the Setup tab.
      </p>
    );
  }

  const playable = matches.filter(
    (m) => m.status !== "completed" && m.status !== "bye" && m.team_a_id && m.team_b_id,
  );
  const completed = matches.filter((m) => m.status === "completed");
  const waiting = matches.filter(
    (m) => m.status !== "completed" && m.status !== "bye" && (!m.team_a_id || !m.team_b_id),
  );
  const byes = matches.filter((m) => m.status === "bye");

  return (
    <div className="space-y-8">
      {champion && (
        <div className="border border-warning/50 bg-warning/10 p-6 flex items-center gap-4">
          <Trophy strokeWidth={1.5} className="h-8 w-8 text-warning shrink-0" />
          <div>
            <p className="text-label uppercase text-warning">Champion</p>
            <p className="font-display text-display-sm text-ink leading-none mt-1">
              {champion.name}
            </p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="font-heading text-heading-md text-ink">
          Ready to report ({playable.length})
        </h2>
        {playable.length === 0 ? (
          <p className="text-body-sm text-ink-muted">Nothing is playable right now.</p>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {playable.map((m) => (
              <ReportCard
                key={m.id}
                match={m}
                teamById={teamById}
                pending={pending}
                run={run}
                refresh={refresh}
              />
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-heading text-heading-md text-ink">
            Reported ({completed.length})
          </h2>
          <ul className="divide-y divide-line-subtle border border-line bg-surface">
            {completed.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="text-caption font-mono uppercase text-ink-muted w-28 shrink-0">
                  {BRACKET_LABEL[m.bracket]} R{m.round_number} · M{m.match_number}
                </span>
                <span className="flex-1 min-w-0 text-body-sm text-ink truncate">
                  <strong className={m.winner_id === m.team_a_id ? "text-ink" : "text-ink-muted"}>
                    {teamById.get(m.team_a_id ?? "")?.name ?? "TBD"}
                  </strong>{" "}
                  <span className="font-mono text-ink-secondary">
                    {m.team_a_score}–{m.team_b_score}
                  </span>{" "}
                  <strong className={m.winner_id === m.team_b_id ? "text-ink" : "text-ink-muted"}>
                    {teamById.get(m.team_b_id ?? "")?.name ?? "TBD"}
                  </strong>
                </span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => undoMatchResult(m.id), refresh)}
                  className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-caption text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
                >
                  <RotateCcw strokeWidth={1.75} className="h-3.5 w-3.5" />
                  Undo
                </button>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-muted">
            Undo is refused by the server if a downstream match already has both
            teams or a result — the error appears at the top of this page.
          </p>
        </section>
      )}

      {(waiting.length > 0 || byes.length > 0) && (
        <section className="space-y-3">
          <h2 className="font-heading text-heading-md text-ink">Not yet playable</h2>
          <ul className="divide-y divide-line-subtle border border-line bg-surface text-body-sm">
            {[...waiting, ...byes].map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-caption font-mono uppercase text-ink-muted w-28 shrink-0">
                  {BRACKET_LABEL[m.bracket]} R{m.round_number} · M{m.match_number}
                </span>
                <span className="text-ink-secondary truncate">
                  {teamById.get(m.team_a_id ?? "")?.name ?? "TBD"} vs{" "}
                  {teamById.get(m.team_b_id ?? "")?.name ?? "TBD"}
                </span>
                {m.status === "bye" && (
                  <span className="ml-auto text-caption font-mono uppercase text-ink-muted">
                    bye
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ReportCard({
  match,
  teamById,
  pending,
  run,
  refresh,
}: {
  match: SrMatch;
  teamById: Map<string, SrTeam>;
  pending: boolean;
  run: (fn: () => Promise<unknown>, onDone?: () => void) => void;
  refresh: () => void;
}) {
  const [a, setA] = useState(match.team_a_score);
  const [b, setB] = useState(match.team_b_score);
  const teamA = teamById.get(match.team_a_id ?? "");
  const teamB = teamById.get(match.team_b_id ?? "");
  const wins = Math.floor(match.best_of / 2) + 1;
  const validScore =
    Number.isInteger(a) &&
    Number.isInteger(b) &&
    a >= 0 &&
    b >= 0 &&
    Math.max(a, b) === wins &&
    Math.min(a, b) < wins;

  function submit(scoreA: number, scoreB: number) {
    run(() => reportMatchResult(match.id, scoreA, scoreB), refresh);
  }

  return (
    <li className="border border-line bg-surface p-4 space-y-3">
      <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
        {BRACKET_LABEL[match.bracket]} · Round {match.round_number} · Match{" "}
        {match.match_number} · Bo{match.best_of}
      </p>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="text-body-md text-ink truncate">{teamA?.name ?? "TBD"}</span>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={wins}
            className={cn(inputClass, "w-14 text-center px-1")}
            value={a}
            onChange={(e) => setA(Number(e.target.value))}
          />
          <span className="text-ink-muted">–</span>
          <input
            type="number"
            min={0}
            max={wins}
            className={cn(inputClass, "w-14 text-center px-1")}
            value={b}
            onChange={(e) => setB(Number(e.target.value))}
          />
        </div>
        <span className="text-body-md text-ink truncate text-right">{teamB?.name ?? "TBD"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || !validScore} onClick={() => submit(a, b)}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Submit
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(wins, 0)}>
          {teamA?.name ?? "A"} {wins}–0
        </Button>
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => submit(0, wins)}>
          {teamB?.name ?? "B"} {wins}–0
        </Button>
      </div>
      {!validScore && (
        <p className="text-caption text-ink-muted">
          Enter a clinching Bo{match.best_of} score: one team must reach {wins} wins.
        </p>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

const AUDIT_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function AuditPanel({ entries }: { entries: SrAuditLogEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="border border-dashed border-line-strong bg-surface p-10 text-center text-body-sm text-ink-secondary">
        No audit entries yet.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="inline-flex items-center gap-2 font-heading text-heading-md text-ink">
        <ScrollText strokeWidth={1.5} className="h-5 w-5 text-ink-muted" />
        Audit log
      </p>
      <p className="text-caption text-ink-muted">
        Admin-only. Written in the same transaction as the mutation it records,
        newest first, times in KST.
      </p>
      <ul className="divide-y divide-line-subtle border border-line bg-surface font-mono text-caption">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5">
            <span className="text-ink-muted w-32 shrink-0">
              {AUDIT_TIME.format(new Date(e.created_at))}
            </span>
            <span className="text-brand-red-bright w-40 shrink-0">{e.action}</span>
            <span className="text-ink-secondary break-all min-w-0">
              {e.detail ? JSON.stringify(e.detail) : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
