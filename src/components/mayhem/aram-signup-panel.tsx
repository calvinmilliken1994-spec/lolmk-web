"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Crown, Loader2, Mail, Search, Shield, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MayhemTeamFormat } from "@/types/mayhem";
import {
  joinMayhemAsMember,
  leaveMayhemAsMember,
  createPremadeApplication,
  addDraftMember,
  sendApplicationInvites,
  retryInviteDelivery,
  withdrawApplicationSlot,
  withdrawApplication,
  getMyPremadeApplication,
  getMySoloSignupStatus,
} from "@/app/tools/mayhem/actions";

const PREMADE_ROSTER_SIZE = 5;

interface MemberIdentity {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
}

type ApplicationData = Awaited<ReturnType<typeof getMyPremadeApplication>>;
type ActionResult = { ok: true } | { ok: false; reason: string } | { ok: true; applicationId: string };

/**
 * Public signup UI for /tournaments/aram. Shown only while stage ===
 * "collecting" (parent page's canSignUp gate). Supports both paths at once
 * for "mixed" events — the two panels render side by side, independent of
 * each other, matching acceptsSolo()/acceptsPremade() in actions.ts.
 *
 * Deliberately fetches its own live status from a dedicated endpoint on
 * mount instead of trusting server-rendered props verbatim — every
 * mutation below re-validates server-side anyway, so this is a UX
 * nicety, not a security boundary.
 */
export function AramSignupPanel({
  teamFormat,
  registrationOpen,
  member,
}: {
  teamFormat: MayhemTeamFormat;
  registrationOpen: boolean;
  member: MemberIdentity | null;
}) {
  const [generation, setGeneration] = useState<number | null>(null);
  const [soloStatus, setSoloStatus] = useState<"loading" | "none" | "joined">("loading");
  const [application, setApplication] = useState<ApplicationData>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const acceptsSolo = teamFormat === "randomized" || teamFormat === "mixed";
  const acceptsPremade = teamFormat === "premade" || teamFormat === "mixed";

  useEffect(() => {
    let cancelled = false;
    if (!member) {
      setSoloStatus("none");
      setApplication(null);
      return;
    }
    (async () => {
      const [solo, app] = await Promise.all([
        getMySoloSignupStatus().catch(() => null),
        getMyPremadeApplication().catch(() => null),
      ]);
      if (cancelled) return;
      setGeneration(solo?.registrationGeneration ?? app?.registrationGeneration ?? null);
      setSoloStatus(solo?.joined ? "joined" : "none");
      setApplication(app);
    })();
    return () => {
      cancelled = true;
    };
  }, [member, refreshTick]);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      setRefreshTick((t) => t + 1);
    });
  }

  if (!registrationOpen) {
    return (
      <div className="border border-dashed border-line-strong bg-surface p-8 text-center">
        <p className="font-heading text-heading-md text-ink mb-1">Signups aren&apos;t open yet.</p>
        <p className="text-body-sm text-ink-secondary">
          Check Discord for when the next Mayhem opens for entries.
        </p>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="border border-line bg-surface p-8 text-center space-y-4">
        <Shield strokeWidth={1.25} className="h-10 w-10 mx-auto text-ink-muted" />
        <div>
          <p className="font-heading text-heading-md text-ink mb-1">Sign in to register.</p>
          <p className="text-body-sm text-ink-secondary max-w-md mx-auto">
            Registration is verified through Discord so rosters only ever contain real server members.
          </p>
        </div>
        <a
          href={`/api/auth/member/login?next=${encodeURIComponent("/tournaments/aram")}`}
          className="inline-flex items-center gap-2 border border-line-strong px-5 py-2.5 text-body-sm font-semibold text-ink hover:border-brand-red"
        >
          Sign in with Discord
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <p className="text-label uppercase text-ink-muted">Signed in as</p>
        <Badge variant="default">{member.displayName}</Badge>
      </div>

      {error && (
        <div className="border border-danger/50 bg-danger/10 px-4 py-2.5 text-body-sm text-danger">{error}</div>
      )}

      <div className={cn("grid gap-4", acceptsSolo && acceptsPremade ? "md:grid-cols-2" : "md:grid-cols-1 max-w-xl")}>
        {acceptsSolo && (
          <div className="border border-line bg-surface p-5 space-y-3">
            <p className="font-heading text-heading-sm text-ink inline-flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Solo signup
            </p>
            <p className="text-body-sm text-ink-secondary">
              Put your name in and get placed into a team with other solo players when signups close.
            </p>
            {soloStatus === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin text-ink-muted" />
            ) : soloStatus === "joined" ? (
              <div className="flex items-center justify-between gap-3 border border-success/40 bg-success/10 px-3 py-2">
                <span className="inline-flex items-center gap-1.5 text-body-sm text-success">
                  <Check className="h-4 w-4" /> You&apos;re signed up
                </span>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => leaveMayhemAsMember())}>
                  Leave
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                disabled={pending || generation === null || Boolean(application)}
                onClick={() => generation !== null && run(() => joinMayhemAsMember(generation))}
              >
                Sign up solo
              </Button>
            )}
          </div>
        )}

        {acceptsPremade && (
          <PremadeSignup
            application={application}
            generation={generation}
            pending={pending}
            run={run}
            hasSoloSignup={soloStatus === "joined"}
          />
        )}
      </div>
    </div>
  );
}

function PremadeSignup({
  application,
  generation,
  pending,
  run,
  hasSoloSignup,
}: {
  application: ApplicationData;
  generation: number | null;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
  hasSoloSignup: boolean;
}) {
  const [teamName, setTeamName] = useState("");

  return (
    <div className="border border-line bg-surface p-5 space-y-3">
      <p className="font-heading text-heading-sm text-ink inline-flex items-center gap-2">
        <Users className="h-4 w-4" /> Premade team
      </p>
      <p className="text-body-sm text-ink-secondary">
        Bring a full {PREMADE_ROSTER_SIZE}-player roster. Build your list, then send invites — every
        teammate has to confirm their own spot before the team is registered.
      </p>

      {!application ? (
        <div className="flex gap-2">
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team name"
            maxLength={40}
            disabled={hasSoloSignup}
            className="flex-1 bg-elevated border border-line rounded-sm px-3 py-2 text-body-sm disabled:opacity-50"
          />
          <Button
            size="sm"
            disabled={pending || generation === null || !teamName.trim() || hasSoloSignup}
            onClick={() => generation !== null && run(() => createPremadeApplication(teamName.trim(), generation))}
          >
            Create team
          </Button>
        </div>
      ) : (
        <ApplicationCard application={application} pending={pending} run={run} />
      )}
      {hasSoloSignup && !application && (
        <p className="text-caption text-ink-muted">Leave your solo signup first to start a premade team.</p>
      )}
    </div>
  );
}

function ApplicationCard({
  application,
  pending,
  run,
}: {
  application: NonNullable<ApplicationData>;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const confirmedCount = application.slots.filter((s) => s.status === "confirmed").length;
  const filledCount = application.slots.length;
  // Captain's own slot is permanently 'confirmed' from creation — it must
  // never count toward "an invite is already out", or the batch-send
  // button could never appear (a 5-slot roster with only the captain
  // confirmed and 4 drafts is exactly the state that SHOULD be sendable).
  const nonCaptainSlots = application.slots.filter((s) => !s.isCaptain);
  const anyInviteOut = nonCaptainSlots.some((s) => s.status === "pending" || s.status === "confirmed");
  const hasSendableDrafts = nonCaptainSlots.some((s) => s.status === "draft");
  const readyToSend = filledCount === PREMADE_ROSTER_SIZE && hasSendableDrafts && !anyInviteOut;
  const complete = confirmedCount === PREMADE_ROSTER_SIZE;
  const [manualLinks, setManualLinks] = useState<Record<string, { displayName: string; url: string }>>({});

  function handleSend() {
    run(async () => {
      const result = await sendApplicationInvites(application.id);
      if (!result.ok) return result;
      const links: Record<string, { displayName: string; url: string }> = {};
      for (const r of result.results) {
        if (r.manualLink) links[r.slotId] = { displayName: r.displayName, url: r.manualLink };
      }
      setManualLinks(links);
      return { ok: true };
    });
  }

  function handleRetry(slotId: string) {
    run(async () => {
      const result = await retryInviteDelivery(application.id, slotId);
      if (!result.ok) return result;
      if (result.manualLink) {
        setManualLinks((prev) => ({
          ...prev,
          [slotId]: { displayName: application.slots.find((s) => s.id === slotId)?.displayName ?? "them", url: result.manualLink! },
        }));
      } else {
        setManualLinks((prev) => {
          const next = { ...prev };
          delete next[slotId];
          return next;
        });
      }
      return { ok: true };
    });
  }

  function handleAdd(discordUserId: string) {
    run(() => addDraftMember(application.id, discordUserId));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-body-sm text-ink truncate">{application.teamName}</p>
        <Badge variant={complete ? "success" : "warning"}>
          {complete
            ? "Ready"
            : anyInviteOut
              ? `${confirmedCount}/${PREMADE_ROSTER_SIZE} confirmed`
              : `${filledCount}/${PREMADE_ROSTER_SIZE} added`}
        </Badge>
      </div>

      <ul className="space-y-1.5">
        {application.slots.map((slot) => (
          <li key={slot.id} className="border border-line-subtle bg-elevated px-2.5 py-1.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-2 min-w-0 text-body-sm text-ink-secondary">
                {slot.isCaptain && <Crown className="h-3.5 w-3.5 text-warning shrink-0" />}
                <span className="truncate">{slot.displayName ?? "Empty slot"}</span>
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <SlotStatusBadge slot={slot} />
                {!slot.isCaptain && slot.status === "draft" && (
                  <button
                    aria-label="Remove from roster"
                    disabled={pending}
                    onClick={() => run(() => withdrawApplicationSlot(application.id, slot.id))}
                    className="text-ink-muted hover:text-danger"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                {!slot.isCaptain && slot.status === "pending" && slot.deliveryStatus === "failed" && (
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
            {slot.deliveryStatus === "failed" && slot.deliveryError && (
              <p className="text-caption text-danger">{slot.deliveryError}</p>
            )}
            {manualLinks[slot.id] && (
              <div className="flex gap-1.5">
                <input
                  readOnly
                  value={manualLinks[slot.id].url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 bg-base border border-line rounded-sm px-2 py-1 text-caption font-mono text-ink-secondary"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigator.clipboard?.writeText(manualLinks[slot.id].url)}
                >
                  Copy
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {filledCount < PREMADE_ROSTER_SIZE && (
        <MemberSearchAdd pending={pending} onAdd={handleAdd} />
      )}

      {readyToSend && (
        <Button size="sm" onClick={handleSend} disabled={pending} className="w-full">
          <Mail className="h-3.5 w-3.5" /> Send invites to {PREMADE_ROSTER_SIZE - 1} teammates
        </Button>
      )}

      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawApplication(application.id))}>
        Withdraw team
      </Button>
    </div>
  );
}

function SlotStatusBadge({
  slot,
}: {
  slot: NonNullable<ApplicationData>["slots"][number];
}) {
  if (slot.status === "confirmed") {
    return (
      <span className="inline-flex items-center gap-1 text-caption text-success">
        <Check className="h-3.5 w-3.5" /> Confirmed
      </span>
    );
  }
  if (slot.status === "declined") {
    return <span className="text-caption text-ink-muted">Declined</span>;
  }
  if (slot.status === "pending") {
    if (slot.deliveryStatus === "sent") return <span className="text-caption text-warning">Invited — waiting</span>;
    if (slot.deliveryStatus === "sending") return <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-muted" />;
    if (slot.deliveryStatus === "failed") return <span className="text-caption text-danger">Not delivered</span>;
    return <span className="text-caption text-ink-muted">Pending</span>;
  }
  return <span className="text-caption text-ink-muted">Draft</span>;
}

interface SearchResult {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
}

/**
 * Discord-name search box for building a premade roster — queries
 * /api/mayhem/member-search (bot-token guild search), debounced, only
 * shows results once at least 2 characters are typed. Selecting a result
 * only ADDS them to the roster as a draft — no message is sent to them
 * until the captain explicitly clicks "Send invites" once all 5 slots
 * are filled. The searched name itself is never trusted by the server;
 * only the resolved discordUserId is, and addDraftMember() re-resolves
 * identity from that id again server-side.
 */
function MemberSearchAdd({
  pending,
  onAdd,
}: {
  pending: boolean;
  onAdd: (discordUserId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
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
        const res = await fetch(`/api/mayhem/member-search?q=${encodeURIComponent(q)}`);
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
          placeholder="Search server members to add"
          className="w-full bg-elevated border border-line rounded-sm pl-8 pr-3 py-2 text-body-sm"
        />
        {searching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-ink-muted" />}
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
