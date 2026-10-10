import Image from "next/image";
import { redirect } from "next/navigation";
import { MemberCard } from "@/components/ds/member-card";
import { PageHeader } from "@/components/ds/page-header";
import { Suspense } from "react";
import { AsyncStatStrip } from "@/components/ds/async-stat-strip";
import { StatStripSkeleton } from "@/components/ds/skeleton";
import { ResultsTable } from "@/components/ds/results-table";
import { statCells } from "@/components/ds/stat-strip";
import { MemberProfileEditor } from "@/components/members/member-profile-editor";
import { getMemberRsvps } from "@/lib/discord-events";
import type { CommunityEvent } from "@/types/event";
import { getChampionById, listChampions } from "@/lib/ddragon";
import { getMemberCurrentTeam, getMemberHistory, type LockerHistoryRow } from "@/lib/locker-db";
import { getProfile, listRiotIds } from "@/lib/member-db";
import { discordAvatarUrl, splitDisplayName } from "@/lib/member-display";
import { isRiotConfigured } from "@/lib/riot";
import { FORMAT_NAMES, formatKstWhen, formatMonthShortYear } from "@/lib/tournament-status";

export const LOCKER_LOGIN = `/api/auth/member/login?next=${encodeURIComponent("/locker")}`;

const H2 = "m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text";

/**
 * /locker: the signed-in member hub. Everything is read for the signed-in
 * member only, from the tournament tables and Discord. Stats the data can't
 * supply are omitted.
 */
export async function LockerContent({ discordUserId }: { discordUserId: string }) {
  // RSVPs come from Discord, the slow call; they stream in behind Suspense.
  const rsvpsPromise = getMemberRsvps(discordUserId);
  const [profile, riotIds, champions, history, team] = await Promise.all([
    getProfile(discordUserId),
    listRiotIds(discordUserId),
    listChampions(),
    getMemberHistory(discordUserId),
    getMemberCurrentTeam(discordUserId).catch(() => null),
  ]);
  // The OAuth callback enrols a profile row on every sign-in; a session that
  // outlived its row signs in again.
  if (!profile) redirect(LOCKER_LOGIN);

  const name = splitDisplayName(profile.displayName);
  const primaryRiot = riotIds.find((r) => r.isPrimary);
  const champ = profile.favoriteChampion ? await getChampionById(profile.favoriteChampion) : null;
  const avatar = profile.avatarUrl ? discordAvatarUrl(profile.avatarUrl, 256) ?? profile.avatarUrl : null;

  const played = history.length;
  const best = history
    .filter((h) => h.finished && h.rank !== null)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];

  return (
    <>
      <PageHeader
        tag="Locker"
        tagTone="blue"
        title={`Welcome back, ${name.name}.`}
        deck="Your tournaments, your team, and what you've signed up for. Everything here comes straight from the Discord."
        media={
          avatar ? (
            <Image
              src={avatar}
              alt=""
              width={120}
              height={120}
              priority
              className="cut-avatar h-[96px] w-[96px] object-cover sm:h-[120px] sm:w-[120px]"
            />
          ) : undefined
        }
        statsSlot={
          <Suspense fallback={<StatStripSkeleton count={4} />}>
            <AsyncStatStrip
              cells={rsvpsPromise.then((rsvps) => {
                const nextRsvp = rsvps?.[0] ?? null;
                return statCells([
          { k: "Tournaments played", v: played > 0 ? String(played) : null },
          best
            ? {
                k: "Best finish",
                v: best.placement,
                hint: best.tournament,
                tone: best.rank === 1 ? ("gold" as const) : undefined,
              }
            : { k: "Best finish", v: null },
          { k: "Current team", v: team?.name ?? null, hint: team?.tournament },
          {
            k: "Next RSVP",
            v: nextRsvp ? formatKstWhen({ startsAt: nextRsvp.startsAt }) : null,
            hint: nextRsvp?.title,
          },
                ]);
              })}
            />
          </Suspense>
        }
        actions={
          <form action="/members/logout" method="post">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center border border-ds-line-strong px-5 font-heading text-ds-ui font-semibold text-ds-text transition-colors duration-150 hover:border-ds-text"
            >
              Sign out
            </button>
          </form>
        }
      />

      <section aria-labelledby="profile-title" className="ds-container pt-6">
        <h2 id="profile-title" className={H2}>
          Your card.
        </h2>
        <p className="mb-0 mt-3 max-w-deck text-ds-body text-ds-text-muted">
          {profile.directoryOptIn
            ? "This is how you appear on the Members page."
            : "This is how you'd appear on the Members page. Turn on \u201cShow me on Members\u201d below to be listed."}
        </p>
        <div className="mt-8 grid gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
          <div>
            <MemberCard
              member={{
                displayName: name.name,
                riotId: primaryRiot ? `${primaryRiot.gameName}#${primaryRiot.tagLine}` : name.riotId,
                avatarUrl: profile.avatarUrl,
                bio: profile.bio,
                preferredRoles: profile.preferredRoles,
                championId: profile.favoriteChampion,
                championName: champ?.name ?? null,
              }}
            />
          </div>
          <MemberProfileEditor
            profile={profile}
            riotIds={riotIds}
            champions={champions}
            riotConfigured={isRiotConfigured()}
          />
        </div>
      </section>

      <section aria-labelledby="history-title" className="ds-container pt-[clamp(64px,8vw,104px)]">
        <h2 id="history-title" className={H2}>
          Tournament history.
        </h2>
        {history.length > 0 ? (
          <ResultsTable
            className="mt-8"
            caption="Tournaments you've played, newest first"
            columns={[
              { key: "when", label: "When", tone: "muted" },
              { key: "tournament", label: "Tournament" },
              { key: "team", label: "Team" },
              { key: "placement", label: "Placement" },
              { key: "link", label: "Link", srOnlyLabel: true, align: "right" },
            ]}
            rows={history.map((h) => historyRow(h))}
          />
        ) : (
          <p className="mb-0 mt-6 max-w-deck text-ds-deck text-ds-text-muted">
            Nothing yet. Your results land here after your first tournament.
          </p>
        )}
      </section>

      <Suspense fallback={null}>
        <ComingUp rsvps={rsvpsPromise} />
      </Suspense>

      {team && (
        <section aria-labelledby="team-title" className="ds-container pt-[clamp(64px,8vw,104px)]">
          <h2 id="team-title" className={H2}>
            {team.name}
          </h2>
          <p className="mb-0 mt-3 font-heading text-ds-ui text-ds-text-muted">
            Your team in{" "}
            <a href={team.tournamentHref} className="ds-link font-semibold text-ds-text">
              {team.tournament}
            </a>
          </p>
          <ul className="m-0 mt-8 grid list-none gap-px border border-ds-line bg-ds-line p-0 sm:grid-cols-2 lg:grid-cols-3">
            {team.players.map((p) => (
              <li key={`${p.name}-${p.role ?? ""}`} className="bg-ds-surface px-6 py-5">
                <p className="m-0 truncate font-heading text-[17px] font-semibold text-ds-text">
                  {p.name}
                  {p.isYou && <span className="ml-2 font-normal text-ds-text-dim">(you)</span>}
                </p>
                <p className="m-0 mt-0.5 font-heading text-ds-label text-ds-text-dim">
                  {[p.role ? roleLabel(p.role) : null, p.isCaptain ? "Captain" : null, p.isSub ? "Substitute" : null]
                    .filter(Boolean)
                    .join(", ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** Upcoming Discord events the member marked Interested. */
async function ComingUp({ rsvps }: { rsvps: Promise<CommunityEvent[] | null> }) {
  const list = await rsvps;
  if (!list || list.length === 0) return null;
  return (
    <section aria-labelledby="upcoming-title" className="ds-container pt-[clamp(64px,8vw,104px)]">
      <h2 id="upcoming-title" className={H2}>
        Coming up.
      </h2>
      <ul className="m-0 mt-8 list-none border-t border-ds-line p-0">
        {list.map((e) => (
          <li key={e.id} className="flex flex-wrap items-center justify-between gap-4 border-b border-ds-line py-5">
            <span>
              <span className="block font-heading text-[20px] font-semibold text-white">{e.title}</span>
              <span className="mt-1 block font-heading text-ds-ui text-ds-text-muted">
                {[formatKstWhen({ startsAt: e.startsAt }), e.location]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </span>
            {e.cta && (
              <a
                href={e.cta.href}
                target="_blank"
                rel="noreferrer"
                className="ds-link inline-flex min-h-11 items-center font-heading text-ds-ui font-semibold text-ds-text"
              >
                Open in Discord
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function historyRow(h: LockerHistoryRow) {
  return {
    id: h.id,
    when: formatMonthShortYear(h.date),
    tournament: (
      <span>
        {h.tournament}
        <span className="block text-ds-label text-ds-text-dim">{FORMAT_NAMES[h.formatKey]}</span>
      </span>
    ),
    team: h.team,
    placement:
      h.rank === 1 ? <span className="font-bold text-ds-gold">{h.placement}</span> : h.placement,
    link: h.href ? { label: "Bracket", href: h.href } : null,
  };
}

const ROLES: Record<string, string> = {
  TOP: "Top",
  JUNGLE: "Jungle",
  MID: "Mid",
  ADC: "ADC",
  SUPPORT: "Support",
  FILL: "Fill",
};
function roleLabel(r: string): string {
  return ROLES[r] ?? r;
}
