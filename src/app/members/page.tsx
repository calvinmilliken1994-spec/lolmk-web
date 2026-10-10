import type { Metadata } from "next";
import { AlertTriangle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { MemberCard, type MemberCardData } from "@/components/ds/member-card";
import { PageHeader } from "@/components/ds/page-header";
import { statCells } from "@/components/ds/stat-strip";
import { cn } from "@/lib/utils";
import { getDirectoryEntries } from "@/lib/member-db";
import { getDiscordStats } from "@/lib/discord";
import { getChampionById } from "@/lib/ddragon";
import type { MemberDirectoryEntry } from "@/types/member-profile";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "Members",
  description:
    "Admins, game coordinators, and members of the LoLMK Discord who've opted in to be shown.",
  path: "/members",
});

export const dynamic = "force-dynamic";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  config: "Verified member login isn't configured yet.",
  state: "That sign-in link expired or was already used. Try again.",
  denied: "Sign-in was cancelled.",
  not_member: "That Discord account isn't a member of the LoLMK server.",
  no_role: "That Discord account doesn't have access yet. Ask an admin.",
  discord_error: "Couldn't reach Discord to verify your account. Try again in a moment.",
};

const numberFmt = new Intl.NumberFormat("en-US");

/**
 * /members: the public directory. Not gated behind login; only profiles
 * that opted in (directory_opt_in) ever render here.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const params = await searchParams;
  const [{ admins, coordinators, members }, discord] = await Promise.all([
    getDirectoryEntries(),
    getDiscordStats(),
  ]);
  const authErrorMessage = params.authError
    ? AUTH_ERROR_MESSAGES[params.authError] ?? AUTH_ERROR_MESSAGES.discord_error
    : null;

  const toCard = async (m: MemberDirectoryEntry): Promise<MemberCardData> => {
    const champ = m.favoriteChampion ? await getChampionById(m.favoriteChampion) : null;
    return {
      displayName: m.displayName,
      riotId: m.riotId,
      avatarUrl: m.avatarUrl,
      bio: m.bio,
      preferredRoles: m.preferredRoles,
      championId: m.favoriteChampion,
      championName: champ?.name ?? null,
    };
  };
  const [adminCards, coordinatorCards, memberCards] = await Promise.all([
    Promise.all(admins.map(toCard)),
    Promise.all(coordinators.map(toCard)),
    Promise.all(members.map(toCard)),
  ]);

  const loginHref = `/api/auth/member/login?next=${encodeURIComponent("/members")}`;
  const isEmpty = admins.length + coordinators.length + members.length === 0;

  return (
    <>
      <PageHeader
        tag="Members"
        title="Meet the regulars."
        deck="Admins, game coordinators, and members who've opted in to be shown. Sign in with Discord to add your own card."
        stats={statCells([
          { k: "In the Discord", v: discord ? numberFmt.format(discord.members) : null },
          { k: "Online now", v: discord ? numberFmt.format(discord.online) : null, dot: "online" },
          // Counts of the people listed below. The Discord role totals would
          // need the guild member list (a privileged intent); see
          // OPEN_QUESTIONS.md. Zero is omitted rather than shown, since it
          // would read as "LoLMK has no coordinators".
          { k: "Admins", v: admins.length > 0 ? String(admins.length) : null },
          { k: "Game coordinators", v: coordinators.length > 0 ? String(coordinators.length) : null },
        ])}
        actions={
          <a href={loginHref} className={cn(buttonVariants({ variant: "discord", size: "md" }))}>
            <DiscordIcon className="h-5 w-5" />
            Add your card
          </a>
        }
      />

      {authErrorMessage && (
        <div className="ds-container">
          <p
            role="alert"
            className="flex max-w-deck items-start gap-2.5 border border-danger/40 bg-danger/10 px-4 py-3 text-ds-body text-ds-text"
          >
            <AlertTriangle strokeWidth={1.5} className="mt-0.5 h-5 w-5 shrink-0 text-danger" />
            {authErrorMessage}
          </p>
        </div>
      )}

      {isEmpty ? (
        <section className="ds-container">
          <div className="cut-plate flex flex-wrap items-center justify-between gap-6 border border-ds-line bg-ds-surface px-8 py-8">
            <p className="m-0 max-w-deck text-ds-deck text-ds-text-muted">
              Nobody has added their card yet. Be the first.
            </p>
            <a href={loginHref} className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
              Sign in with Discord
            </a>
          </div>
        </section>
      ) : (
        <div className="space-y-[clamp(56px,7vw,88px)]">
          <DirectorySection id="admins" title="Admins" cards={adminCards} />
          <DirectorySection id="coordinators" title="Game coordinators" cards={coordinatorCards} />
          <DirectorySection id="members" title="Members" cards={memberCards} />
        </div>
      )}
    </>
  );
}

function DirectorySection({ id, title, cards }: { id: string; title: string; cards: MemberCardData[] }) {
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby={`${id}-title`} className="ds-container">
      <h2
        id={`${id}-title`}
        className="m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text"
      >
        {title}
      </h2>
      <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <MemberCard key={`${c.displayName}-${c.riotId ?? ""}`} member={c} />
        ))}
      </div>
    </section>
  );
}
