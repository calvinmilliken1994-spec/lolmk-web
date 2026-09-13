"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Check, Loader2, Plus, RefreshCw, Star, Trash2 } from "lucide-react";
import { ErrorBanner, Field, inputClass, useRunner } from "@/components/sr/sr-shared";
import { SR_PLAYER_ROLES } from "@/types/sr-tournament";
import { MEMBER_PLAY_MODES, RIOT_PLATFORMS, RIOT_PLATFORM_LABELS } from "@/types/member-profile";
import type { MemberProfile, MemberRiotId } from "@/types/member-profile";
import type { ChampionSummary } from "@/lib/ddragon";
import {
  addMyRiotId,
  removeMyRiotId,
  resolveMyRiotId,
  setMyPrimaryRiotId,
  updateMyProfile,
} from "@/app/members/profile/actions";

const PLAY_MODE_LABELS: Record<string, string> = {
  RANKED: "Ranked",
  CASUAL: "Casual",
  ARAM: "ARAM",
};

/**
 * Verified-member self-service profile editor. Same pattern as
 * CaptainDashboard: props come straight from the server component and are
 * NOT copied into useState for the read side — every write action calls
 * revalidatePath("/members/profile"), so the RSC payload refreshes on its
 * own. Local useState here is only for in-progress FORM INPUT, seeded from
 * props on mount.
 */
export function MemberProfileEditor({
  profile,
  riotIds,
  champions,
  riotConfigured,
}: {
  profile: MemberProfile;
  riotIds: MemberRiotId[];
  champions: ChampionSummary[];
  riotConfigured: boolean;
}) {
  const { pending, error, setError, run } = useRunner();
  const [bio, setBio] = useState(profile.bio);
  const [preferredRoles, setPreferredRoles] = useState<string[]>(profile.preferredRoles);
  const [mainChampions, setMainChampions] = useState<string[]>(profile.mainChampions);
  const [favoriteChampion, setFavoriteChampion] = useState<string>(profile.favoriteChampion ?? "");
  const [playModes, setPlayModes] = useState<string[]>(profile.playModes);
  const [directoryOptIn, setDirectoryOptIn] = useState(profile.directoryOptIn);
  const [saved, setSaved] = useState(false);

  const canBeListed = profile.directoryCategory !== null;

  function toggle(list: string[], value: string, setter: (v: string[]) => void) {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  function save() {
    setSaved(false);
    run(async () => {
      await updateMyProfile({
        bio,
        preferredRoles,
        mainChampions,
        favoriteChampion: favoriteChampion || null,
        playModes,
        directoryOptIn,
      });
      setSaved(true);
    });
  }

  return (
    <section className="container-wide py-16 md:py-20 space-y-10">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <Link
            href="/members"
            className="inline-flex items-center gap-1.5 text-body-sm text-ink-muted hover:text-ink"
          >
            <ArrowLeft strokeWidth={1.75} className="h-4 w-4" />
            Members
          </Link>
          <p className="text-label uppercase text-ink-muted">Verified member</p>
          <h1 className="font-display text-display-sm text-ink leading-none">
            {profile.displayName}
          </h1>
        </div>
        <form action="/members/logout" method="post">
          <button
            type="submit"
            className="border border-line px-4 py-2 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="border border-line bg-surface p-6 space-y-6">
        <Field label="Bio" hint={`${bio.length}/500`}>
          <textarea
            className={inputClass}
            rows={3}
            maxLength={500}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A couple sentences about how you play."
          />
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-label uppercase tracking-wider text-ink-muted">
            Preferred roles
          </legend>
          <div className="flex flex-wrap gap-2">
            {SR_PLAYER_ROLES.map((role) => (
              <button
                key={role}
                type="button"
                onClick={() => toggle(preferredRoles, role, setPreferredRoles)}
                className={`px-3 py-1.5 text-body-sm rounded-sm border ${
                  preferredRoles.includes(role)
                    ? "border-brand-red bg-brand-red-muted text-brand-red-bright"
                    : "border-line text-ink-secondary hover:border-line-strong"
                }`}
              >
                {role}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-label uppercase tracking-wider text-ink-muted">
            Play modes
          </legend>
          <div className="flex flex-wrap gap-2">
            {MEMBER_PLAY_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => toggle(playModes, mode, setPlayModes)}
                className={`px-3 py-1.5 text-body-sm rounded-sm border ${
                  playModes.includes(mode)
                    ? "border-brand-red bg-brand-red-muted text-brand-red-bright"
                    : "border-line text-ink-secondary hover:border-line-strong"
                }`}
              >
                {PLAY_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Favorite champion">
          <select
            className={inputClass}
            value={favoriteChampion}
            onChange={(e) => setFavoriteChampion(e.target.value)}
          >
            <option value="">None</option>
            {champions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-label uppercase tracking-wider text-ink-muted">
            Main champions
          </legend>
          <MultiChampionPicker
            champions={champions}
            selected={mainChampions}
            onChange={setMainChampions}
            max={5}
          />
          <span className="text-caption text-ink-muted">Up to 5.</span>
        </fieldset>

        <div className="border-t border-line-subtle pt-5 space-y-2">
          {canBeListed ? (
            <label className="inline-flex items-start gap-2.5 text-body-sm text-ink-secondary">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={directoryOptIn}
                onChange={(e) => setDirectoryOptIn(e.target.checked)}
              />
              <span>
                List me on the public <span className="text-ink">/members</span> directory. Your
                display name, avatar, bio, roles, and favorite champion would be visible to anyone
                — nothing else on your profile.
              </span>
            </label>
          ) : (
            <p className="text-caption text-ink-muted">
              The public directory currently lists Admins and Game Coordinators only. Your account
              isn&apos;t in either group, so there&apos;s no directory listing to opt into.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={pending}
            onClick={save}
            className="inline-flex items-center gap-2 bg-brand-red text-ink px-5 py-2.5 rounded-md font-semibold hover:bg-brand-red-hover disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save profile
          </button>
          {saved && !pending && (
            <span className="inline-flex items-center gap-1.5 text-body-sm text-success">
              <Check className="h-4 w-4" /> Saved
            </span>
          )}
        </div>
      </div>

      <RiotIdsPanel riotIds={riotIds} riotConfigured={riotConfigured} />
    </section>
  );
}

function MultiChampionPicker({
  champions,
  selected,
  onChange,
  max,
}: {
  champions: ChampionSummary[];
  selected: string[];
  onChange: (v: string[]) => void;
  max: number;
}) {
  const [query, setQuery] = useState("");
  const matches = query
    ? champions.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8)
    : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {selected.map((id) => {
          const champ = champions.find((c) => c.id === id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-body-sm text-ink rounded-sm"
            >
              {champ?.name ?? id}
              <button
                type="button"
                onClick={() => onChange(selected.filter((v) => v !== id))}
                className="text-ink-muted hover:text-danger"
                aria-label={`Remove ${champ?.name ?? id}`}
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      {selected.length < max && (
        <div className="relative">
          <input
            className={inputClass}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search champions to add…"
          />
          {matches.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full border border-line bg-elevated max-h-52 overflow-y-auto">
              {matches.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-body-sm text-ink hover:bg-surface"
                    onClick={() => {
                      if (!selected.includes(c.id)) onChange([...selected, c.id]);
                      setQuery("");
                    }}
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function RiotIdsPanel({
  riotIds,
  riotConfigured,
}: {
  riotIds: MemberRiotId[];
  riotConfigured: boolean;
}) {
  const { pending, error, setError, run } = useRunner();
  const [gameName, setGameName] = useState("");
  const [tagLine, setTagLine] = useState("");
  const [platform, setPlatform] = useState<string>("na1");
  const [resolveMsg, setResolveMsg] = useState<Record<string, string>>({});

  return (
    <div className="border border-line bg-surface p-6 space-y-5">
      <div>
        <p className="font-heading text-heading-md text-ink">Riot IDs</p>
        <p className="text-body-sm text-ink-secondary mt-1">
          Manually linked and self-reported — this doesn&apos;t prove you own the account.
          {!riotConfigured && " Resolving/lookup is disabled until this site has a Riot API key."}
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <ul className="divide-y divide-line-subtle">
        {riotIds.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-body-md text-ink">
                {r.gameName}#{r.tagLine}{" "}
                <span className="text-caption font-mono text-ink-muted">
                  {RIOT_PLATFORM_LABELS[r.platform]}
                </span>
                {r.isPrimary && (
                  <span className="ml-2 text-caption text-brand-red-bright inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-current" /> Primary
                  </span>
                )}
              </p>
              <p className="text-caption text-ink-muted">
                {r.puuid ? "Resolved" : "Not resolved yet"}
                {resolveMsg[r.id] && ` — ${resolveMsg[r.id]}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {riotConfigured && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(async () => {
                      const result = await resolveMyRiotId(r.id);
                      setResolveMsg((m) => ({
                        ...m,
                        [r.id]: result.ok ? "Resolved" : result.reason,
                      }));
                    })
                  }
                  className="inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
                >
                  <RefreshCw strokeWidth={1.75} className="h-3.5 w-3.5" />
                  Resolve
                </button>
              )}
              {!r.isPrimary && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => setMyPrimaryRiotId(r.id))}
                  className="border border-line px-3 py-1.5 text-body-sm text-ink-muted rounded-sm hover:border-line-strong hover:text-ink disabled:opacity-40"
                >
                  Make primary
                </button>
              )}
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => removeMyRiotId(r.id))}
                className="border border-line px-2 py-1.5 text-ink-muted rounded-sm hover:border-danger hover:text-danger disabled:opacity-40"
                aria-label={`Remove ${r.gameName}#${r.tagLine}`}
              >
                <Trash2 strokeWidth={1.75} className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {riotIds.length < 5 && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!gameName.trim() || !tagLine.trim()) return;
            run(async () => {
              await addMyRiotId({ gameName, tagLine, platform });
              setGameName("");
              setTagLine("");
            });
          }}
        >
          <Field label="Riot name">
            <input
              className={inputClass}
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="Name"
            />
          </Field>
          <Field label="Tag">
            <input
              className={inputClass}
              value={tagLine}
              onChange={(e) => setTagLine(e.target.value)}
              placeholder="1234"
            />
          </Field>
          <Field label="Region">
            <select
              className={inputClass}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {RIOT_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {RIOT_PLATFORM_LABELS[p]}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-1.5 border border-line-strong px-4 py-2 text-body-sm text-ink rounded-sm hover:border-brand-red disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </form>
      )}
    </div>
  );
}
