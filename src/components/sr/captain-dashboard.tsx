"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Loader2,
  Plus,
  Search,
  Trash2,
  UserPlus,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, Field, inputClass, useRunner } from "@/components/sr/sr-shared";
import { TeamLogoUpload } from "@/components/sr/team-logo-upload";
import {
  addRosterPlayer,
  clearMyTeamLogo,
  createTeam,
  disbandMyTeam,
  lookupRosterRank,
  removeRosterPlayer,
  updateMyTeam,
  updateRosterPlayer,
  uploadMyTeamLogo,
} from "@/app/captain/actions";
import { SR_PLAYER_ROLES, SR_RANKS } from "@/types/sr-tournament";
import type { SrCaptainTeamView } from "@/lib/sr-db";
import type { SrTournament } from "@/types/sr-tournament";

/**
 * Captain-facing "My team" screen.
 *
 * Like the admin dashboard, props come straight from the server component on
 * every render and are deliberately NOT copied into useState: every action in
 * @/app/captain/actions.ts calls revalidatePath("/captain") after COMMIT, so
 * the RSC payload for this route is refetched and these props update on their
 * own. Copying them would freeze the first render's snapshot.
 *
 * Every action here is ownership-scoped server-side. Nothing on this screen
 * is trusted to enforce access — the buttons are just the ergonomic front of
 * a `WHERE captain_discord_id = <session>` predicate.
 */
export function CaptainDashboard({
  username,
  teams,
  openTournaments,
  blobConfigured,
  riotConfigured,
}: {
  username: string;
  teams: SrCaptainTeamView[];
  openTournaments: SrTournament[];
  blobConfigured: boolean;
  riotConfigured: boolean;
}) {
  const router = useRouter();
  // Tournaments the captain hasn't already entered.
  const entered = new Set(teams.map((t) => t.team.tournament_id));
  const available = openTournaments.filter((t) => !entered.has(t.id));

  return (
    <section className="container-wide py-16 md:py-20 space-y-12">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <p className="text-label uppercase text-ink-muted">Team captain</p>
          <h1 className="font-display text-display-sm text-ink leading-none">My team</h1>
          <p className="text-body-sm text-ink-secondary">
            Signed in as <span className="text-ink">{username}</span>.
          </p>
        </div>
        <form action="/captain/logout" method="post">
          <button
            type="submit"
            className="border border-line px-4 py-2 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </header>

      {teams.length === 0 && available.length === 0 && (
        <div className="border border-dashed border-line-strong bg-surface p-10 text-center space-y-3">
          <p className="font-heading text-heading-lg text-ink">No signups open right now.</p>
          <p className="text-body-sm text-ink-secondary max-w-md mx-auto">
            When the next Summoner&apos;s Rift tournament opens registration
            you&apos;ll be able to enter a team from this page. Announcements go
            out in the Discord first.
          </p>
          <Link
            href="/tournaments/summoners-rift"
            className="inline-block text-body-sm text-brand-blue-bright underline underline-offset-4 hover:text-ink"
          >
            See tournaments
          </Link>
        </div>
      )}

      {teams.map((view) => (
        <TeamPanel
          key={view.team.id}
          view={view}
          blobConfigured={blobConfigured}
          riotConfigured={riotConfigured}
          onDone={() => router.refresh()}
        />
      ))}

      {available.map((tournament) => (
        <SignupPanel
          key={tournament.id}
          tournament={tournament}
          onDone={() => router.refresh()}
        />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------------------

function SignupPanel({
  tournament,
  onDone,
}: {
  tournament: SrTournament;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ign, setIgn] = useState("");
  const [role, setRole] = useState("FILL");
  const [currentRank, setCurrentRank] = useState("");
  const [peakRank, setPeakRank] = useState("");

  return (
    <div className="border border-line bg-surface p-6 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">
            Signups open
          </p>
          <p className="font-heading text-heading-lg text-ink">{tournament.name}</p>
        </div>
        {!open && (
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 border border-brand-red bg-brand-red/10 px-4 py-2 text-body-sm text-ink rounded-sm hover:bg-brand-red/20"
          >
            <Plus strokeWidth={2} className="h-4 w-4" />
            Register a team
          </button>
        )}
      </div>

      {open && (
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createTeam({
                  tournamentId: tournament.id,
                  name,
                  ign,
                  role,
                  currentRank: currentRank || null,
                  peakRank: peakRank || null,
                }),
              () => {
                setOpen(false);
                setName("");
                setIgn("");
                onDone();
              },
            );
          }}
        >
          <div className="sm:col-span-2">
            <ErrorBanner error={error} onDismiss={() => setError(null)} />
          </div>
          <Field label="Team name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </Field>
          <Field label="Your IGN" hint="Riot ID, e.g. Name#KR1.">
            <input
              className={inputClass}
              value={ign}
              onChange={(e) => setIgn(e.target.value)}
              maxLength={60}
              required
            />
          </Field>
          <Field label="Your role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {SR_PLAYER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Current rank" hint="Self-reported.">
            <RankSelect value={currentRank} onChange={setCurrentRank} />
          </Field>
          <div className="sm:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 border border-brand-red bg-brand-red/10 px-4 py-2 text-body-sm text-ink rounded-sm hover:bg-brand-red/20 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit team
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-body-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <span className="text-caption text-ink-muted">
              Peak rank and the rest of your roster can be added after you
              submit.
            </span>
          </div>
          <input type="hidden" value={peakRank} readOnly />
          <button type="button" hidden onClick={() => setPeakRank("")} />
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATUS_COPY: Record<string, { label: string; variant: "warning" | "success" | "outline"; note: string }> = {
  pending: {
    label: "Awaiting review",
    variant: "warning",
    note: "An admin still has to approve this team before it appears in the public field.",
  },
  approved: {
    label: "Approved",
    variant: "success",
    note: "You're in the field. Keep the roster accurate until seeding.",
  },
  rejected: {
    label: "Not accepted",
    variant: "outline",
    note: "This entry wasn't accepted. Ask in the Discord if you think that's a mistake.",
  },
};

function TeamPanel({
  view,
  blobConfigured,
  riotConfigured,
  onDone,
}: {
  view: SrCaptainTeamView;
  blobConfigured: boolean;
  riotConfigured: boolean;
  onDone: () => void;
}) {
  const { team, players, tournament } = view;
  const { pending, error, setError, run } = useRunner();
  const [name, setName] = useState(team.name);
  const [confirmDisband, setConfirmDisband] = useState(false);
  const status = STATUS_COPY[team.status] ?? STATUS_COPY.pending;

  // Once seeded — or once the tournament leaves draft — the roster is locked
  // and the server rejects edits. Reflect that in the UI instead of letting
  // people fill in a form that will only throw.
  const locked = team.seed !== null || tournament.status !== "draft";

  return (
    <div className="border border-line bg-surface">
      <div className="border-b border-line p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">
              {tournament.name}
            </p>
            <p className="font-heading text-heading-lg text-ink">{team.name}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant={status.variant}>{status.label}</Badge>
            <TeamLogoUpload
              teamId={team.id}
              configured={blobConfigured}
              hasLogo={Boolean(team.logo_url)}
              onUploaded={onDone}
              uploadAction={uploadMyTeamLogo}
              clearAction={clearMyTeamLogo}
            />
          </div>
        </div>
        <p className="text-body-sm text-ink-secondary">{status.note}</p>
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        {locked ? (
          <p className="flex items-start gap-2 text-body-sm text-ink-muted border border-line-subtle bg-elevated px-4 py-3 rounded-sm">
            <AlertTriangle strokeWidth={1.5} className="h-4 w-4 shrink-0 mt-0.5" />
            The field is locked in. Message an admin in Discord for any roster
            change from here on.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Team name">
              <input
                className={`${inputClass} sm:w-72`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
              />
            </Field>
            <button
              disabled={pending || name.trim() === team.name}
              onClick={() => run(() => updateMyTeam(team.id, { name }), onDone)}
              className="border border-line px-4 py-2 text-body-sm text-ink rounded-sm hover:border-line-strong disabled:opacity-40"
            >
              Save
            </button>
            {confirmDisband ? (
              <div className="flex items-center gap-2">
                <button
                  disabled={pending}
                  onClick={() => run(() => disbandMyTeam(team.id), onDone)}
                  className="border border-danger px-4 py-2 text-body-sm text-danger rounded-sm hover:bg-danger/10 disabled:opacity-40"
                >
                  Confirm disband
                </button>
                <button
                  onClick={() => setConfirmDisband(false)}
                  className="text-body-sm text-ink-muted hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDisband(true)}
                className="ml-auto text-body-sm text-ink-muted hover:text-danger"
              >
                Disband team
              </button>
            )}
          </div>
        )}
      </div>

      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-label uppercase text-ink-muted">
            Roster · {players.length} player{players.length === 1 ? "" : "s"}
          </p>
          <p className="text-caption text-ink-muted">Ranks are self-reported.</p>
        </div>

        <ul className="divide-y divide-line-subtle border-y border-line-subtle">
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              player={p}
              locked={locked}
              riotConfigured={riotConfigured}
              onDone={onDone}
            />
          ))}
          {players.length === 0 && (
            <li className="py-6 text-body-sm text-ink-muted">No players yet.</li>
          )}
        </ul>

        {!locked && <AddPlayerForm teamId={team.id} onDone={onDone} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RankSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      className={className ?? inputClass}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {SR_RANKS.map((r) => (
        <option key={r} value={r}>
          {r.charAt(0) + r.slice(1).toLowerCase()}
        </option>
      ))}
    </select>
  );
}

function PlayerRow({
  player,
  locked,
  riotConfigured,
  onDone,
}: {
  player: SrCaptainTeamView["players"][number];
  locked: boolean;
  riotConfigured: boolean;
  onDone: () => void;
}) {
  const { pending, error, setError, run } = useRunner();
  const [editing, setEditing] = useState(false);
  const [ign, setIgn] = useState(player.ign);
  const [role, setRole] = useState<string>(player.role);
  const [currentRank, setCurrentRank] = useState<string>(player.current_rank ?? "");
  const [peakRank, setPeakRank] = useState<string>(player.peak_rank ?? "");
  const [lookup, setLookup] = useState<string | null>(null);

  return (
    <li className="py-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-20 shrink-0 text-caption font-mono uppercase tracking-wider text-ink-muted">
          {player.role}
        </span>
        <span className="font-heading text-heading-sm text-ink">{player.ign}</span>
        {player.is_captain && <Badge variant="red">Captain</Badge>}
        {player.is_substitute && <Badge variant="outline">Sub</Badge>}
        <span className="text-body-sm text-ink-secondary">
          {player.current_rank ? rankLabel(player.current_rank) : "Rank not given"}
          {player.peak_rank ? ` · peak ${rankLabel(player.peak_rank)}` : ""}
        </span>
        {player.rank_verified_at && (
          <span
            className="inline-flex items-center gap-1 text-caption text-ink-muted"
            title="A Riot API lookup matched this summoner's current tier. It does not verify that this Discord account owns the summoner."
          >
            <BadgeCheck strokeWidth={1.5} className="h-3.5 w-3.5" />
            Rank checked
          </span>
        )}
        {!locked && (
          <span className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-body-sm text-ink-muted hover:text-ink"
            >
              {editing ? "Close" : "Edit"}
            </button>
            {!player.is_captain && (
              <button
                disabled={pending}
                onClick={() => run(() => removeRosterPlayer(player.id), onDone)}
                className="text-ink-muted hover:text-danger disabled:opacity-40"
                aria-label={`Remove ${player.ign}`}
              >
                <Trash2 strokeWidth={1.75} className="h-4 w-4" />
              </button>
            )}
          </span>
        )}
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {lookup && <p className="text-caption text-ink-secondary">{lookup}</p>}

      {editing && !locked && (
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="IGN">
            <input className={inputClass} value={ign} onChange={(e) => setIgn(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
              {SR_PLAYER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Current rank">
            <RankSelect value={currentRank} onChange={setCurrentRank} />
          </Field>
          <Field label="Peak rank">
            <RankSelect value={peakRank} onChange={setPeakRank} />
          </Field>
          <div className="sm:col-span-4 flex flex-wrap items-center gap-3">
            <button
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    updateRosterPlayer(player.id, {
                      ign,
                      role,
                      currentRank: currentRank || null,
                      peakRank: peakRank || null,
                    }),
                  () => {
                    setEditing(false);
                    onDone();
                  },
                )
              }
              className="inline-flex items-center gap-2 border border-line px-4 py-2 text-body-sm text-ink rounded-sm hover:border-line-strong disabled:opacity-40"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Save
            </button>
            <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={player.is_substitute}
                disabled={pending}
                onChange={(e) =>
                  run(
                    () => updateRosterPlayer(player.id, { isSubstitute: e.target.checked }),
                    onDone,
                  )
                }
              />
              Substitute
            </label>
            {/*
              Optional convenience. Disabled with an explanation rather than
              hidden when RIOT_API_KEY is unset, so it's obvious the feature
              exists but isn't switched on — and it is never presented as
              account verification.
            */}
            <button
              type="button"
              disabled={pending || !riotConfigured}
              title={
                riotConfigured
                  ? "Checks this Riot ID's current KR solo-queue tier. Does not verify Discord account ownership."
                  : "Rank lookup isn't configured on this deployment (no RIOT_API_KEY)."
              }
              onClick={() => {
                setLookup(null);
                run(async () => {
                  const res = await lookupRosterRank(player.id);
                  setLookup(
                    res.ok
                      ? `Riot reports ${rankLabel(res.tier)}${res.division ? ` ${res.division}` : ""} on KR. Saved as the current rank — still not proof of account ownership.`
                      : res.reason,
                  );
                  onDone();
                });
              }}
              className="inline-flex items-center gap-2 border border-line px-4 py-2 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
            >
              <Search strokeWidth={1.75} className="h-4 w-4" />
              {riotConfigured ? "Check rank on KR" : "Rank lookup off"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function rankLabel(rank: string): string {
  return rank.charAt(0) + rank.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------

function AddPlayerForm({ teamId, onDone }: { teamId: string; onDone: () => void }) {
  const { pending, error, setError, run } = useRunner();
  const [discordId, setDiscordId] = useState("");
  const [ign, setIgn] = useState("");
  const [role, setRole] = useState("FILL");
  const [currentRank, setCurrentRank] = useState("");
  const [peakRank, setPeakRank] = useState("");
  const [isSubstitute, setIsSubstitute] = useState(false);

  return (
    <form
      className="border border-line-subtle bg-elevated/40 p-4 grid gap-3 sm:grid-cols-5"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            addRosterPlayer(teamId, {
              discordId,
              ign,
              role,
              currentRank: currentRank || null,
              peakRank: peakRank || null,
              isSubstitute,
            }),
          () => {
            setDiscordId("");
            setIgn("");
            setCurrentRank("");
            setPeakRank("");
            setIsSubstitute(false);
            onDone();
          },
        );
      }}
    >
      <div className="sm:col-span-5">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />
      </div>
      {/*
        Manual entry, deliberately: a member picker would mean the site
        reading the guild's full member list, which is far more access than
        adding a teammate needs. The captain types the ID they were given.
      */}
      <Field label="Discord ID" hint="Numeric user ID, not the @username.">
        <input
          className={inputClass}
          value={discordId}
          onChange={(e) => setDiscordId(e.target.value)}
          inputMode="numeric"
          required
        />
      </Field>
      <Field label="IGN" hint="Riot ID, e.g. Name#KR1.">
        <input className={inputClass} value={ign} onChange={(e) => setIgn(e.target.value)} required />
      </Field>
      <Field label="Role">
        <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
          {SR_PLAYER_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Current rank">
        <RankSelect value={currentRank} onChange={setCurrentRank} />
      </Field>
      <Field label="Peak rank">
        <RankSelect value={peakRank} onChange={setPeakRank} />
      </Field>
      <div className="sm:col-span-5 flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 border border-line px-4 py-2 text-body-sm text-ink rounded-sm hover:border-line-strong disabled:opacity-40"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus strokeWidth={1.75} className="h-4 w-4" />}
          Add player
        </button>
        <label className="inline-flex items-center gap-2 text-body-sm text-ink-secondary">
          <input
            type="checkbox"
            checked={isSubstitute}
            onChange={(e) => setIsSubstitute(e.target.checked)}
          />
          Substitute
        </label>
      </div>
    </form>
  );
}
