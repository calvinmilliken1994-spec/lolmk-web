"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { MayhemFull, MayhemMatch, MayhemTeam } from "@/types/mayhem";
import { cn } from "@/lib/utils";

/**
 * Public, presentation-only venue screen. No admin controls — reads and
 * polls /api/mayhem/state and renders whatever `scene` the admin has set.
 * Built on the same fixed full-bleed dark-stage foundation as the
 * tournament timer (src/components/sections/tournament-timer.tsx).
 */
export function MayhemLiveScreen({ initial }: { initial: MayhemFull }) {
  const [data, setData] = useState(initial);

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
        {data.event.scene === "idle" && <IdleScene />}
        {data.event.scene === "starting_soon" && <CountdownScene endsAt={data.event.countdown_ends_at} />}
        {data.event.scene === "reveal" && <RevealScene data={data} />}
        {data.event.scene === "teams" && <TeamListScene teams={data.teams} />}
        {data.event.scene === "groups" && <GroupsScene data={data} />}
        {data.event.scene === "bracket" && <BracketScene data={data} />}
        {data.event.scene === "match" && <MatchScene data={data} />}
        {data.event.scene === "champion" && <ChampionScene data={data} />}
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

function RevealScene({ data }: { data: MayhemFull }) {
  const revealed = data.teams.slice(0, data.event.reveal_index);
  const upNext = data.teams[data.event.reveal_index] ?? null;

  return (
    <div className="w-full max-w-6xl">
      <p className="text-center text-label uppercase tracking-[0.3em] text-ink-muted mb-8">
        Team reveal · {revealed.length} / {data.teams.length}
      </p>
      <div className="grid grid-cols-3 md:grid-cols-5 gap-6">
        {data.teams.map((t, i) => {
          const isRevealed = i < revealed.length;
          const isLatest = i === revealed.length - 1;
          return (
            <div
              key={t.id}
              className={cn(
                "aspect-square flex flex-col items-center justify-center gap-2 border transition-all duration-500",
                isRevealed
                  ? "border-brand-red bg-brand-red/10 opacity-100 scale-100"
                  : "border-line-subtle bg-elevated/20 opacity-30 scale-95",
                isLatest && "motion-safe:animate-[pulse-dot_1s_ease-in-out_1]",
              )}
            >
              {isRevealed ? (
                <>
                  {t.icon_url && (
                    <Image src={t.icon_url} alt="" width={64} height={64} className="h-16 w-16 object-contain" />
                  )}
                  <p className="font-heading text-body-sm font-semibold text-center px-2">{t.name}</p>
                </>
              ) : (
                <span className="text-display-sm text-ink-disabled">?</span>
              )}
            </div>
          );
        })}
      </div>
      {upNext && (
        <p className="text-center mt-8 text-body-lg text-ink-secondary animate-pulse">
          Revealing next…
        </p>
      )}
    </div>
  );
}

function TeamListScene({ teams }: { teams: MayhemTeam[] }) {
  return (
    <div className="w-full max-w-6xl">
      <p className="text-center font-display text-display-md mb-10">The Teams</p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
        {teams.map((t) => (
          <div key={t.id} className="border border-line bg-surface p-4 flex flex-col items-center gap-3">
            {t.icon_url && (
              <Image src={t.icon_url} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
            )}
            <p className="font-heading font-semibold text-body-md text-center">{t.name}</p>
            <ul className="text-body-sm text-ink-secondary text-center space-y-0.5">
              {t.players.map((p) => (
                <li key={p.id}>{p.display_name}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupsScene({ data }: { data: MayhemFull }) {
  return (
    <div className="w-full max-w-6xl">
      <p className="text-center font-display text-display-md mb-10">Groups</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {data.groups.map((g) => {
          const teams = data.teams.filter((t) => t.group_id === g.id);
          return (
            <div key={g.id} className="border border-line bg-surface p-5">
              <p className="font-heading text-heading-md mb-3 text-brand-red-bright">{g.label}</p>
              <ul className="space-y-2">
                {teams.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-body-md">
                    {t.icon_url && <Image src={t.icon_url} alt="" width={28} height={28} className="h-7 w-7" />}
                    {t.name}
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

function BracketScene({ data }: { data: MayhemFull }) {
  const rounds = Array.from(new Set(data.matches.filter((m) => m.bracket !== "group").map((m) => `${m.bracket}-${m.round_number}`)));
  return (
    <div className="w-full max-w-6xl overflow-x-auto">
      <p className="text-center font-display text-display-md mb-10">Bracket</p>
      <div className="flex gap-6 justify-center min-w-max px-4">
        {rounds.map((key) => {
          const matches = data.matches.filter((m) => `${m.bracket}-${m.round_number}` === key);
          return (
            <div key={key} className="flex flex-col gap-3 min-w-[220px]">
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
    </div>
  );
}

function LiveMatchCard({ match, teams }: { match: MayhemMatch; teams: MayhemTeam[] }) {
  const teamA = teams.find((t) => t.id === match.team_a_id);
  const teamB = teams.find((t) => t.id === match.team_b_id);
  const done = match.status === "completed";
  return (
    <div className="border border-line bg-surface p-3 text-body-sm space-y-1">
      <div className={cn("flex justify-between", done && match.winner_id === match.team_a_id && "text-brand-red-bright font-semibold")}>
        <span>{teamA?.name ?? "TBD"}</span>
        {done && <span>{match.team_a_score}</span>}
      </div>
      <div className={cn("flex justify-between", done && match.winner_id === match.team_b_id && "text-brand-red-bright font-semibold")}>
        <span>{teamB?.name ?? "TBD"}</span>
        {done && <span>{match.team_b_score}</span>}
      </div>
    </div>
  );
}

function MatchScene({ data }: { data: MayhemFull }) {
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

function TeamBlock({ team }: { team: MayhemTeam | undefined }) {
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

function ChampionScene({ data }: { data: MayhemFull }) {
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
