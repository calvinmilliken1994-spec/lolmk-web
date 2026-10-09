"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import type { MayhemVenueState } from "@/lib/mayhem-db";
import type { MayhemMatch, MayhemScene } from "@/types/mayhem";
import { cn } from "@/lib/utils";

/**
 * Public, presentation-only venue screen. No admin controls — reads and
 * polls /api/mayhem/state and renders whatever `scene` the admin has set.
 * Built on the same fixed full-bleed dark-stage foundation as the
 * tournament timer (src/components/sections/tournament-timer.tsx).
 *
 * `initial`/polled state is the venue-safe DTO (MayhemVenueState), never
 * the admin's full MayhemFull — see getMayhemVenueState()'s doc comment in
 * mayhem-db.ts for why member_discord_id/captain_discord_id must never
 * reach this page or its poll payload.
 */
export function MayhemLiveScreen({
  initial,
  sceneOverride = null,
}: {
  initial: MayhemVenueState;
  /** Preview mode (`?scene=<id>&preview=1`): show this scene instead of the one on air. */
  sceneOverride?: MayhemScene | null;
}) {
  const [data, setData] = useState(initial);
  const scene = sceneOverride ?? data.event.scene;

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/mayhem/state", { cache: "no-store" });
        if (res.ok) setData(await res.json());
      } catch {
        /* transient network hiccup — keep showing the last good state */
      }
    }, 1500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden bg-base text-ink flex items-center justify-center">
      <div aria-hidden className="grain pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[22%] h-[55vh] w-[80vw] max-w-[1200px] -translate-x-1/2 rounded-full bg-brand-red/10 blur-[130px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-0 h-[55vh] w-[45vw] rounded-full bg-brand-blue/12 blur-[130px]"
      />

      <div className="relative z-10 w-full h-full flex items-center justify-center p-10">
        {scene === "idle" && <IdleScene />}
        {scene === "starting_soon" && <CountdownScene endsAt={data.event.countdown_ends_at} />}
        {scene === "reveal" && <RevealScene data={data} />}
        {scene === "teams" && <TeamListScene teams={data.teams} />}
        {scene === "groups" && <GroupsScene data={data} />}
        {scene === "bracket" && <BracketScene data={data} />}
        {scene === "match" && <MatchScene data={data} />}
        {scene === "champion" && <ChampionScene data={data} />}
      </div>
    </div>
  );
}

function IdleScene() {
  return (
    <div className="flex flex-col items-center gap-6 opacity-90">
      <Image src="/logo.svg" alt="LoLMK" width={180} height={200} className="h-40 w-auto animate-pulse-dot" />
      <p className="font-display text-display-md tracking-[0.04em] text-ink">ARAM MAYHEM</p>
    </div>
  );
}

function CountdownScene({ endsAt }: { endsAt: string | null }) {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!endsAt) return;
    const target = new Date(endsAt).getTime();
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    }, 200);
    return () => clearInterval(id);
  }, [endsAt]);

  const m = Math.floor(remaining / 60);
  const s = remaining % 60;

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-label uppercase tracking-[0.3em] text-ink-muted">Starting soon</p>
      <p className="font-display text-[clamp(4rem,16vw,14rem)] leading-none tabular text-brand-red-bright">
        {String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
      </p>
      <Image src="/logo.svg" alt="" width={64} height={72} className="h-14 w-auto opacity-60" />
    </div>
  );
}

function tileSizeForCount(count: number): string {
  if (count <= 6) return "w-[13rem] xl:w-[15rem]";
  if (count <= 12) return "w-[10.5rem] xl:w-[12rem]";
  if (count <= 20) return "w-[8.5rem] xl:w-[9.5rem]";
  return "w-[7rem] xl:w-[7.75rem]";
}

function iconSizeForCount(count: number): string {
  if (count <= 6) return "h-16 w-16 xl:h-20 xl:w-20";
  if (count <= 12) return "h-12 w-12 xl:h-14 xl:w-14";
  return "h-9 w-9 xl:h-10 xl:w-10";
}

/**
 * Fits wide content (the bracket's horizontal round columns) to the
 * available width by measuring natural content width against the
 * container and applying a uniform scale — appropriate for an unattended
 * venue display where nobody is present to operate a scrollbar. Falls back
 * to horizontal scroll only if content still overflows at the scale floor
 * (an extremely large bracket), so it's never truly unreachable.
 */
function FitToWidth({ children }: { children: ReactNode }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const SCALE_FLOOR = 0.55;
    const measure = () => {
      const available = outer.clientWidth;
      const natural = inner.scrollWidth;
      const next = natural > available ? Math.max(SCALE_FLOOR, available / natural) : 1;
      setScale(next);
      setHeight(inner.scrollHeight * next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={outerRef} className="w-full overflow-x-auto" style={{ height }}>
      <div
        ref={innerRef}
        className="inline-flex"
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
      >
        {children}
      </div>
    </div>
  );
}

function RevealScene({ data }: { data: MayhemVenueState }) {
  const revealed = data.teams.slice(0, data.event.reveal_index);
  const upNext = data.teams[data.event.reveal_index] ?? null;
  const latestTeam = revealed[revealed.length - 1] ?? null;
  const tileClass = tileSizeForCount(data.teams.length);
  const iconClass = iconSizeForCount(data.teams.length);

  return (
    <div className="w-full max-w-[110rem] flex flex-col items-center">
      <p className="text-center text-label uppercase tracking-[0.3em] text-ink-muted mb-8">
        Team reveal · {revealed.length} / {data.teams.length}
      </p>
      {/* flex-wrap + justify-center (not a grid) so an incomplete last row
          centers instead of hugging the left edge under the full columns
          above it. Tile size scales down with team count so 40+ teams
          don't blow out the viewport height the way a single fixed size
          would. */}
      <div className="flex flex-wrap justify-center gap-4 xl:gap-6 mb-10">
        {data.teams.map((t, i) => {
          const isRevealed = i < revealed.length;
          const isLatest = i === revealed.length - 1;
          return (
            <div
              key={t.id}
              className={cn(
                "aspect-square flex flex-col items-center justify-center gap-2 border transition-all duration-500",
                tileClass,
                isRevealed
                  ? "border-brand-red bg-brand-red/10 opacity-100 scale-100"
                  : "border-line-subtle bg-elevated/20 opacity-30 scale-95",
                isLatest && "motion-safe:animate-[pulse-dot_1s_ease-in-out_1]",
              )}
            >
              {isRevealed ? (
                <>
                  {t.icon_url && (
                    <Image src={t.icon_url} alt="" width={96} height={96} className={cn(iconClass, "object-contain")} />
                  )}
                  <p className="font-heading text-body-sm font-semibold text-center px-2 line-clamp-2 break-words">{t.name}</p>
                </>
              ) : (
                <span className="text-display-sm text-ink-disabled">?</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Staggered roster reveal for the most recently revealed team. Keyed
          on team.id so React remounts (and therefore re-triggers the CSS
          animation) every time a new team is revealed, rather than only on
          first mount. */}
      {latestTeam && (
        <div key={latestTeam.id} className="flex flex-col items-center gap-5">
          <div className="flex items-center gap-3 motion-safe:animate-[fade-slide-up_0.5s_ease-out_both]">
            {latestTeam.icon_url && (
              <Image src={latestTeam.icon_url} alt="" width={40} height={40} className="h-10 w-10 object-contain" />
            )}
            <p className="font-display text-display-sm text-brand-red-bright">{latestTeam.name}</p>
          </div>
          <ul className="flex flex-wrap justify-center gap-x-8 gap-y-2">
            {latestTeam.players.map((p, i) => (
              <li
                key={p.id}
                className="text-body-lg text-ink-secondary motion-safe:animate-[fade-slide-up_0.4s_ease-out_both]"
                style={{ animationDelay: `${0.35 + i * 0.18}s` }}
              >
                {p.display_name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {upNext && !latestTeam && (
        <p className="text-center text-body-lg text-ink-secondary animate-pulse">Revealing next…</p>
      )}
      {upNext && latestTeam && (
        <p className="text-center mt-8 text-body-lg text-ink-secondary animate-pulse">
          Revealing next…
        </p>
      )}
    </div>
  );
}

function TeamListScene({ teams }: { teams: MayhemVenueState["teams"] }) {
  const tileClass = tileSizeForCount(teams.length);
  const iconClass = iconSizeForCount(teams.length);
  return (
    <div className="w-full max-w-[110rem] flex flex-col items-center">
      <p className="text-center font-display text-display-lg mb-10">The Teams</p>
      {/* flex-wrap, not grid: keeps an incomplete last row centered rather
          than left-aligned under a full grid above it. Tile size scales
          down with team count. */}
      <div className="flex flex-wrap justify-center gap-4 xl:gap-5">
        {teams.map((t, teamIndex) => (
          <div
            key={t.id}
            className={cn(
              tileClass,
              "border border-line bg-surface p-4 flex flex-col items-center gap-2.5 motion-safe:animate-[fade-slide-up_0.5s_ease-out_both]",
            )}
            style={{ animationDelay: `${teamIndex * 0.08}s` }}
          >
            {t.icon_url && (
              <Image src={t.icon_url} alt="" width={80} height={80} className={cn(iconClass, "object-contain")} />
            )}
            <p className="font-heading font-semibold text-body-md text-center line-clamp-2 break-words">{t.name}</p>
            <ul className="text-body-sm text-ink-secondary text-center space-y-0.5">
              {t.players.map((p, i) => (
                <li
                  key={p.id}
                  className="truncate max-w-full motion-safe:animate-[fade-slide-up_0.35s_ease-out_both]"
                  title={p.display_name}
                  style={{ animationDelay: `${teamIndex * 0.08 + 0.2 + i * 0.08}s` }}
                >
                  {p.display_name}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupsScene({ data }: { data: MayhemVenueState }) {
  return (
    <div className="w-full max-w-[110rem] flex flex-col items-center">
      <p className="text-center font-display text-display-lg mb-10">Groups</p>
      {/* flex-wrap, not grid: keeps an incomplete last row of groups
          centered rather than left-aligned. This lists group membership,
          not calculated standings — the group match results feed the
          knockout seed, but no win/loss table is computed here. */}
      <div className="flex flex-wrap justify-center gap-5">
        {data.groups.map((g) => {
          const teams = data.teams.filter((t) => t.group_id === g.id);
          return (
            <div key={g.id} className="w-[16rem] xl:w-[18rem] border border-line bg-surface p-5">
              <p className="font-heading text-heading-md mb-3 text-brand-red-bright">{g.label}</p>
              <ul className="space-y-2">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-body-md min-w-0">
                    {t.icon_url && <Image src={t.icon_url} alt="" width={28} height={28} className="h-7 w-7 shrink-0" />}
                    <span className="truncate" title={t.name}>{t.name}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BracketScene({ data }: { data: MayhemVenueState }) {
  const rounds = Array.from(new Set(data.matches.filter((m) => m.bracket !== "group").map((m) => `${m.bracket}-${m.round_number}`)));
  return (
    <div className="w-full max-w-[110rem] flex flex-col items-center">
      <p className="text-center font-display text-display-lg mb-10">Bracket</p>
      {/* Scaled to fit rather than left to a scrollbar — nobody's at the
          venue screen to operate one. FitToWidth shrinks the whole row
          uniformly if it doesn't fit; only an extremely wide bracket past
          its scale floor falls back to (rare) horizontal scroll. */}
      <FitToWidth>
        <div className="flex gap-8 px-4">
          {rounds.map((key) => {
            const matches = data.matches.filter((m) => `${m.bracket}-${m.round_number}` === key);
            return (
              <div key={key} className="flex flex-col gap-4 min-w-[260px]">
                <p className="text-label uppercase text-ink-muted text-center">
                  {matches[0].bracket.replace("_", " ")} R{matches[0].round_number}
                </p>
                {matches.map((m) => (
                  <LiveMatchCard key={m.id} match={m} teams={data.teams} />
                ))}
              </div>
            );
          })}
        </div>
      </FitToWidth>
    </div>
  );
}

function LiveMatchCard({ match, teams }: { match: MayhemMatch; teams: MayhemVenueState["teams"] }) {
  const teamA = teams.find((t) => t.id === match.team_a_id);
  const teamB = teams.find((t) => t.id === match.team_b_id);
  const done = match.status === "completed";
  return (
    <div className="border border-line bg-surface p-4 text-body-md space-y-1.5">
      <div className={cn("flex justify-between gap-2 min-w-0", done && match.winner_id === match.team_a_id && "text-brand-red-bright font-semibold")}>
        <span className="truncate" title={teamA?.name ?? "TBD"}>{teamA?.name ?? "TBD"}</span>
        {done && <span className="shrink-0">{match.team_a_score}</span>}
      </div>
      <div className={cn("flex justify-between gap-2 min-w-0", done && match.winner_id === match.team_b_id && "text-brand-red-bright font-semibold")}>
        <span className="truncate" title={teamB?.name ?? "TBD"}>{teamB?.name ?? "TBD"}</span>
        {done && <span className="shrink-0">{match.team_b_score}</span>}
      </div>
    </div>
  );
}

function MatchScene({ data }: { data: MayhemVenueState }) {
  const match = data.matches.find((m) => m.id === data.event.active_match_id);
  if (!match) return <BracketScene data={data} />;
  const teamA = data.teams.find((t) => t.id === match.team_a_id);
  const teamB = data.teams.find((t) => t.id === match.team_b_id);

  return (
    <div className="flex flex-col items-center gap-10 w-full">
      <p className="text-label uppercase tracking-[0.3em] text-ink-muted">Now Playing · Bo{match.best_of}</p>
      <div className="flex items-center gap-16">
        <TeamBlock team={teamA} />
        <p className="font-display text-display-lg text-ink-muted">VS</p>
        <TeamBlock team={teamB} />
      </div>
    </div>
  );
}

function TeamBlock({ team }: { team: MayhemVenueState["teams"][number] | undefined }) {
  if (!team) return <div className="w-64 text-center text-ink-disabled">TBD</div>;
  return (
    <div className="flex flex-col items-center gap-4 w-64">
      {team.icon_url && <Image src={team.icon_url} alt="" width={120} height={120} className="h-28 w-28 object-contain" />}
      <p className="font-display text-display-sm text-center">{team.name}</p>
      <ul className="text-body-md text-ink-secondary text-center space-y-1">
        {team.players.map((p) => (
          <li key={p.id}>{p.display_name}</li>
        ))}
      </ul>
    </div>
  );
}

function ChampionScene({ data }: { data: MayhemVenueState }) {
  const champ = data.teams.find((t) => t.id === data.event.champion_team_id);
  if (!champ) return <IdleScene />;
  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-label uppercase tracking-[0.3em] text-warning">Champion</p>
      {champ.icon_url && (
        <Image
          src={champ.icon_url}
          alt=""
          width={220}
          height={220}
          className="h-52 w-52 object-contain drop-shadow-[0_0_60px_rgba(233,69,96,0.5)]"
        />
      )}
      <p className="font-display text-display-xl text-center text-brand-red-bright">{champ.name}</p>
      <ul className="flex flex-wrap justify-center gap-4 text-body-lg text-ink-secondary">
        {champ.players.map((p) => (
          <li key={p.id}>{p.display_name}</li>
        ))}
      </ul>
    </div>
  );
}
