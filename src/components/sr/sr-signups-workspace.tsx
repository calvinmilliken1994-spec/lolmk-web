"use client";

import { useState } from "react";
import { DeckKicker } from "@/components/control-deck";
import { RbLockLine } from "@/components/riftbound/rb-ui";
import { TeamLogoUpload } from "@/components/sr/team-logo-upload";
import { cn } from "@/lib/utils";
import type { SrAdminState, SrTeam } from "@/types/sr-tournament";
import { srRosterLock, srSignupQueue, type SrApplicationRow } from "./sr-deck-model";
import { SrActivity, SrHeader, srButton, srInput, srQuietButton, srSubmit, type SrWorkspaceProps } from "./sr-setup-workspace";

/**
 * Signups: one review queue, pending first.
 *
 * 1. Pending teams: rosters whose five players all confirmed. Approve or reject.
 * 2. Applications in progress: still collecting confirmations. Invites are
 *    sent and re-sent by the captain; the desk can only withdraw a stalled one.
 * 3. Approved teams: rename, logo, reject, remove.
 * 4. Rejected teams: approve, remove.
 *
 * Every change is refused by the server once seeds are rolled (srRosterLock).
 */
export function SrSignupsWorkspace(props: SrWorkspaceProps) {
  const { state, run, pending, actions } = props;
  const t = state.tournament;
  const q = srSignupQueue(state);
  const lock = srRosterLock(state);
  const active = state.teams.filter((x) => x.status !== "rejected").length;
  const atCap = active >= t.max_teams;

  return (
    <>
      <SrHeader
        kicker={`SIGNUPS · ${q.approved.length} APPROVED · ${q.pending.length + q.inProgress.length} PENDING`}
        title="Review queue"
        aside={
          <div className="flex items-center gap-3">
            <span className="font-mono text-[12px] text-ink-muted">
              {t.signups_open ? "SIGNUPS OPEN" : "SIGNUPS CLOSED"}
            </span>
            <button
              type="button"
              disabled={pending || (!t.signups_open && t.status !== "draft")}
              onClick={() => void run(() => actions.setSignupsOpen(t.id, !t.signups_open))}
              className={t.signups_open ? srQuietButton : srButton}
            >
              {t.signups_open ? "Close signups" : "Open signups"}
            </button>
          </div>
        }
      />
      {lock && <RbLockLine reason={lock} />}
      {atCap && !lock && (
        <p className="text-[12px] text-ink-muted">
          At the team cap ({t.max_teams}). Confirmed applications wait here until a slot opens.
        </p>
      )}

      <Section label={`PENDING REVIEW · ${q.pending.length}`}>
        {q.pending.length === 0 ? (
          <Empty>No rosters waiting for review.</Empty>
        ) : (
          q.pending.map((team) => <TeamCard key={team.id} team={team} {...props} locked={!!lock} />)
        )}
      </Section>

      <Section label={`APPLICATIONS IN PROGRESS · ${q.inProgress.length}`}>
        {q.inProgress.length === 0 ? (
          <Empty>No applications collecting confirmations.</Empty>
        ) : (
          q.inProgress.map((row) => <ApplicationCard key={row.view.application.id} row={row} {...props} />)
        )}
      </Section>

      <Section label={`APPROVED · ${q.approved.length} OF ${t.max_teams} · MIN ${t.min_teams}`}>
        {q.approved.length === 0 ? (
          <Empty>No approved teams yet.</Empty>
        ) : (
          <div className="grid gap-2 xl:grid-cols-2">
            {q.approved.map((team) => (
              <TeamCard key={team.id} team={team} {...props} locked={!!lock} />
            ))}
          </div>
        )}
      </Section>

      {q.rejected.length > 0 && (
        <Section label={`REJECTED · ${q.rejected.length}`}>
          {q.rejected.map((team) => (
            <TeamCard key={team.id} team={team} {...props} locked={!!lock} />
          ))}
        </Section>
      )}

      <SrActivity state={state} />
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={label}>
      <DeckKicker>{label}</DeckKicker>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border border-dashed border-line-strong p-3 text-[13px] text-ink-muted">{children}</p>;
}

function roster(state: SrAdminState, teamId: string): string {
  return state.players
    .filter((p) => p.team_id === teamId)
    .map((p) => p.ign)
    .join(" · ");
}

function TeamCard({
  team,
  state,
  run,
  pending,
  actions,
  refresh,
  blobConfigured,
  locked,
}: SrWorkspaceProps & { team: SrTeam; locked: boolean }) {
  const [name, setName] = useState(team.name);
  const dirty = name.trim() !== "" && name.trim() !== team.name;
  const isPending = team.status === "pending";
  const players = roster(state, team.id);
  // Captain-created teams carry a captain; only those go through review.
  const reviewable = Boolean(team.captain_discord_id);

  return (
    <article
      data-team={team.id}
      className={cn(
        "flex gap-3 border bg-surface p-3",
        isPending ? "border-brand-blue-bright" : team.status === "rejected" ? "border-dashed border-line-strong" : "border-line-strong",
      )}
    >
      <div className="flex shrink-0 flex-col items-start gap-1.5">
        {team.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Blob URLs are an arbitrary remote host (no remotePatterns entry).
          <img src={team.logo_url} alt="" width={48} height={48} className="h-12 w-12 border border-line object-cover" />
        ) : (
          <span className="flex h-12 w-12 items-center justify-center border border-dashed border-line-strong bg-elevated font-mono text-[11px] text-ink-muted">
            LOGO
          </span>
        )}
        {team.status !== "rejected" && (
          <TeamLogoUpload teamId={team.id} configured={blobConfigured} hasLogo={Boolean(team.logo_url)} onUploaded={refresh} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center gap-2">
          {isPending || team.status === "rejected" ? (
            <p className="min-w-0 flex-1 truncate font-heading text-[17px] font-semibold">{team.name}</p>
          ) : (
            <input
              className={cn(srInput, "flex-1")}
              value={name}
              aria-label={`Name of ${team.name}`}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          {team.seed !== null && <span className="font-mono text-[12px] text-ink-muted">#{team.seed}</span>}
          <span className="shrink-0 rounded-sm border border-line-strong px-2 py-0.5 font-mono text-[11px] uppercase text-ink-secondary">
            {team.status}
          </span>
        </div>
        {players && <p className="text-[12px] text-ink-secondary">{players}</p>}
        <div className="flex flex-wrap gap-1.5">
          {team.status === "approved" && (
            <button type="button" disabled={pending || !dirty} onClick={() => void run(() => actions.updateTeam(team.id, { name: name.trim() }))} className={srButton}>
              Save name
            </button>
          )}
          {reviewable && team.status !== "approved" && (
            <button type="button" disabled={pending || locked} onClick={() => void run(() => actions.setTeamStatus(team.id, "approved"))} className={srSubmit}>
              Approve
            </button>
          )}
          {reviewable && team.status !== "rejected" && (
            <button type="button" disabled={pending || locked} onClick={() => void run(() => actions.setTeamStatus(team.id, "rejected"))} className={srQuietButton}>
              Reject
            </button>
          )}
          <button
            type="button"
            disabled={pending || locked}
            onClick={() => {
              if (window.confirm(`Remove "${team.name}"? The team and its roster are deleted.`)) void run(() => actions.removeTeam(team.id));
            }}
            className={cn(srQuietButton, "hover:border-danger hover:text-danger")}
          >
            Remove
          </button>
        </div>
      </div>
    </article>
  );
}

function ApplicationCard({ row, run, pending, actions }: SrWorkspaceProps & { row: SrApplicationRow }) {
  const { application, slots } = row.view;
  return (
    <article data-application={application.id} className="flex flex-col gap-2 border border-dashed border-line-strong bg-surface p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-heading text-[16px] font-semibold">{application.team_name}</p>
        <span className="font-mono text-[12px] text-ink-muted">
          {row.confirmed}/5 CONFIRMED · {row.selected}/5 PICKED
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Withdraw the "${application.team_name}" application? Every reserved player is released.`)) {
              void run(() => actions.withdrawTeamApplication(application.id));
            }
          }}
          className={cn(srQuietButton, "h-8 hover:border-danger hover:text-danger")}
        >
          Withdraw
        </button>
      </div>
      <ol className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {slots.map((slot, i) => (
          <li key={slot.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-4 font-mono text-ink-muted">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-ink-secondary">
              {slot.display_name ?? "Empty slot"}
              {slot.is_captain ? " (captain)" : ""}
            </span>
            <span
              className={cn(
                "font-mono uppercase",
                slot.status === "confirmed" ? "text-success-ink" : slot.delivery_status === "failed" ? "text-danger" : "text-warning-ink",
              )}
            >
              {slot.status === "draft" ? slot.delivery_status.replace("_", " ") : slot.status}
            </span>
          </li>
        ))}
      </ol>
    </article>
  );
}
