"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  Crown,
  Loader2,
  Mail,
  Plus,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ErrorBanner, Field, inputClass, useRunner } from "@/components/sr/sr-shared";
import { TeamLogoUpload } from "@/components/sr/team-logo-upload";
import {
  addDraftMember,
  addRosterPlayer,
  clearMyTeamLogo,
  createPremadeApplication,
  disbandMyTeam,
  lookupRosterRank,
  removeDraftSlot,
  removeRosterPlayer,
  retryInviteDelivery,
  sendApplicationInvites,
  updateMyTeam,
  updateRosterPlayer,
  uploadMyTeamLogo,
  withdrawApplication,
} from "@/app/captain/actions";
import { SR_PLAYER_ROLES, SR_PREMADE_ROSTER_SIZE, SR_RANKS } from "@/types/sr-tournament";
import type { SrCaptainTeamView } from "@/lib/sr-db";
import type {
  SrTeamApplicationSlot,
  SrTeamApplicationView,
  SrTournament,
} from "@/types/sr-tournament";

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
  applications,
  openTournaments,
  blobConfigured,
  riotConfigured,
}: {
  username: string;
  teams: SrCaptainTeamView[];
  applications: SrTeamApplicationView[];
  openTournaments: SrTournament[];
  blobConfigured: boolean;
  riotConfigured: boolean;
}) {
  const router = useRouter();
  // Tournaments the captain hasn't already entered — either as a registered
  // team, or as an application that hasn't finished collecting confirmations.
  const entered = new Set([
    ...teams.map((t) => t.team.tournament_id),
    ...applications.map((a) => a.application.tournament_id),
  ]);
  const available = openTournaments.filter((t) => !entered.has(t.id));
  const tournamentsById = new Map(openTournaments.map((t) => [t.id, t]));

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

      {teams.length === 0 && applications.length === 0 && available.length === 0 && (
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

      {applications.map((view) => (
        <ApplicationPanel
          key={view.application.id}
          view={view}
          tournamentName={tournamentsById.get(view.application.tournament_id)?.name ?? "Tournament"}
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

/**
 * Start an application for a tournament the captain hasn't entered yet.
 *
 * Deliberately asks for one thing: a team name. There is no roster form here
 * any more — the old version took the captain's IGN/role/rank and created a
 * real team on the spot, which meant a team could exist without a single
 * player having agreed to be on it. Now creating the application only claims
 * the name and fills the captain's own slot; the other four are picked from
 * guild search in ApplicationPanel and each confirms for themselves.
 */
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
          className="space-y-4 max-w-lg"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              async () => {
                const result = await createPremadeApplication(tournament.id, name);
                if (!result.ok) throw new Error(result.reason);
              },
              () => {
                setOpen(false);
                setName("");
                onDone();
              },
            );
          }}
        >
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          <Field label="Team name">
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
            />
          </Field>
          <p className="text-caption text-ink-muted">
            You&apos;ll take the first roster slot. Next you&apos;ll pick your other{" "}
            {SR_PREMADE_ROSTER_SIZE - 1} players from the Discord server and send them each an
            invite — the team isn&apos;t registered until all {SR_PREMADE_ROSTER_SIZE} confirm.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="inline-flex items-center gap-2 border border-brand-red bg-brand-red/10 px-4 py-2 text-body-sm text-ink rounded-sm hover:bg-brand-red/20 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              Start roster
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-body-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * An application in progress: the five slots, their individual confirmation
 * state, and the actions that move it forward. Nothing here exists in
 * sr_teams yet — the panel disappears and a TeamPanel replaces it the moment
 * the fifth player confirms.
 */
function ApplicationPanel({
  view,
  tournamentName,
  onDone,
}: {
  view: SrTeamApplicationView;
  tournamentName: string;
  onDone: () => void;
}) {
  const { application, slots } = view;
  const { pending, error, setError, run } = useRunner();
  const [manualLinks, setManualLinks] = useState<Record<string, string>>({});

  const confirmedCount = slots.filter((s) => s.status === "confirmed").length;
  // The captain's own slot is 'confirmed' from creation and has no invite, so
  // it must never count toward "an invite is already out" — otherwise a
  // perfectly sendable roster (captain + four drafts) would never show the
  // send button.
  const others = slots.filter((s) => !s.is_captain);
  const anyInviteOut = others.some((s) => s.status === "pending" || s.status === "confirmed");
  const hasDrafts = others.some((s) => s.status === "draft");
  const draftCount = others.filter((s) => s.status === "draft").length;
  const readyToSend = slots.length === SR_PREMADE_ROSTER_SIZE && hasDrafts;

  function handleSend() {
    run(async () => {
      const result = await sendApplicationInvites(application.id);
      if (!result.ok) throw new Error(result.reason);
      const links: Record<string, string> = {};
      for (const r of result.results) if (r.manualLink) links[r.slotId] = r.manualLink;
      setManualLinks(links);
    }, onDone);
  }

  function handleRetry(slotId: string) {
    run(async () => {
      const result = await retryInviteDelivery(application.id, slotId);
      if (!result.ok) throw new Error(result.reason);
      setManualLinks((prev) => {
        const next = { ...prev };
        if (result.manualLink) next[slotId] = result.manualLink;
        else delete next[slotId];
        return next;
      });
    }, onDone);
  }

  return (
    <div className="border border-line bg-surface">
      <div className="border-b border-line p-6 flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-caption font-mono uppercase tracking-wider text-ink-muted">
            {tournamentName} — not registered yet
          </p>
          <p className="font-heading text-heading-lg text-ink">{application.team_name}</p>
        </div>
        <Badge variant={anyInviteOut ? "warning" : "outline"}>
          {anyInviteOut
            ? `${confirmedCount}/${SR_PREMADE_ROSTER_SIZE} confirmed`
            : `${slots.length}/${SR_PREMADE_ROSTER_SIZE} added`}
        </Badge>
      </div>

      <div className="p-6 space-y-4 max-w-2xl">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <p className="text-body-sm text-ink-secondary">
          Every player confirms their own spot from a Discord DM. Your team only enters the field
          once all {SR_PREMADE_ROSTER_SIZE} have confirmed — until then it isn&apos;t seeded, counted,
          or visible publicly.
        </p>

        <ul className="space-y-1.5">
          {slots.map((slot) => (
            <li key={slot.id} className="border border-line-subtle bg-elevated px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 min-w-0 text-body-sm text-ink-secondary">
                  {slot.is_captain && <Crown className="h-3.5 w-3.5 text-warning shrink-0" />}
                  <span className="truncate">{slot.display_name ?? "Empty slot"}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <SlotStatusBadge slot={slot} />
                  {!slot.is_captain && slot.status !== "confirmed" && (
                    <button
                      aria-label={`Remove ${slot.display_name ?? "player"} from roster`}
                      disabled={pending}
                      onClick={() =>
                        run(async () => {
                          const result = await removeDraftSlot(application.id, slot.id);
                          if (!result.ok) throw new Error(result.reason);
                        }, onDone)
                      }
                      className="text-ink-muted hover:text-danger disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {!slot.is_captain &&
                    slot.status === "pending" &&
                    slot.delivery_status === "failed" && (
                      <button
                        disabled={pending}
                        onClick={() => handleRetry(slot.id)}
                        className="text-caption font-semibold text-brand-blue-bright hover:text-ink disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                </span>
              </div>
              {slot.delivery_status === "failed" && slot.delivery_error && (
                <p className="text-caption text-danger">{slot.delivery_error}</p>
              )}
              {manualLinks[slot.id] && (
                <div className="flex gap-1.5">
                  <input
                    readOnly
                    value={manualLinks[slot.id]}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 bg-base border border-line rounded-sm px-2 py-1 text-caption font-mono text-ink-secondary"
                    aria-label={`Confirmation link for ${slot.display_name ?? "player"}`}
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(manualLinks[slot.id])}
                    className="border border-line px-2.5 py-1 text-caption text-ink-secondary rounded-sm hover:border-line-strong hover:text-ink"
                  >
                    Copy
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {slots.length < SR_PREMADE_ROSTER_SIZE && (
          <MemberSearchAdd
            pending={pending}
            onAdd={(discordUserId) =>
              run(async () => {
                const result = await addDraftMember(application.id, discordUserId);
                if (!result.ok) throw new Error(result.reason);
              }, onDone)
            }
          />
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {readyToSend && (
            <button
              onClick={handleSend}
              disabled={pending}
              className="inline-flex items-center gap-2 border border-brand-red bg-brand-red/10 px-4 py-2 text-body-sm text-ink rounded-sm hover:bg-brand-red/20 disabled:opacity-50"
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send {draftCount === 1 ? "invite" : "invites"} to {draftCount} {draftCount === 1 ? "player" : "players"}
            </button>
          )}
          <button
            disabled={pending}
            onClick={() =>
              run(async () => {
                const result = await withdrawApplication(application.id);
                if (!result.ok) throw new Error(result.reason);
              }, onDone)
            }
            className="text-body-sm text-ink-muted hover:text-danger disabled:opacity-50"
          >
            Withdraw application
          </button>
        </div>
      </div>
    </div>
  );
}

function SlotStatusBadge({ slot }: { slot: SrTeamApplicationSlot }) {
  if (slot.status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success">
        <Check className="h-3.5 w-3.5" /> Confirmed
      </span>
    );
  }
  if (slot.status === "declined") return <span className="text-caption text-ink-muted">Declined</span>;
  if (slot.status === "pending") {
    if (slot.delivery_status === "sent")
      return <span className="text-caption text-warning">Invited — waiting</span>;
    if (slot.delivery_status === "sending")
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />;
    if (slot.delivery_status === "failed")
      return <span className="text-caption text-danger">Not delivered</span>;
    return <span className="text-caption text-ink-muted">Pending</span>;
  }
  return <span className="text-caption text-ink-muted">Draft</span>;
}

interface MemberSearchResult {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Discord guild search — the only way to put someone on an initial roster.
 * Queries /api/sr/member-search (captain-gated bot-token guild search),
 * debounced, from two characters up.
 *
 * Picking a result only adds a draft slot; nothing is sent until the captain
 * explicitly sends invites. The typed name is never trusted by the server —
 * only the resolved discordUserId is submitted, and addDraftMember re-resolves
 * identity from that id against the live guild anyway.
 */
function MemberSearchAdd({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (discordUserId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/sr/member-search?q=${encodeURIComponent(q)}`);
        const json = await res.json();
        if (!res.ok) {
          setSearchError(json.error ?? "Search unavailable right now.");
          setResults([]);
        } else {
          setResults(json.results ?? []);
        }
      } catch {
        setSearchError("Search unavailable right now.");
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Discord members to add"
          aria-label="Search Discord members to add"
          className="w-full bg-elevated border border-line rounded-sm pl-8 pr-3 py-2 text-body-sm"
        />
        {searching && (
          <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-ink-muted" />
        )}
      </div>
      {searchError && <p className="text-caption text-danger">{searchError}</p>}
      {results.length > 0 && (
        <ul className="border border-line-subtle divide-y divide-line-subtle max-h-48 overflow-y-auto">
          {results.map((r) => (
            <li key={r.discordUserId}>
              <button
                disabled={pending}
                onClick={() => {
                  onAdd(r.discordUserId);
                  setQuery("");
                  setResults([]);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-body-sm text-ink-secondary hover:bg-elevated text-left disabled:opacity-50"
              >
                {r.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Discord CDN avatar, no remotePatterns entry.
                  <img src={r.avatarUrl} alt="" className="h-5 w-5 rounded-full shrink-0" />
                ) : (
                  <span className="h-5 w-5 rounded-full bg-elevated shrink-0" />
                )}
                <span className="truncate">{r.displayName}</span>
              </button>
            </li>
          ))}
        </ul>
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
