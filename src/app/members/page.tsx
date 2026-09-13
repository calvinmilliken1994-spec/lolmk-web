import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getDirectoryEntries } from "@/lib/member-db";
import type { MemberDirectoryEntry } from "@/types/member-profile";

export const metadata: Metadata = {
  title: "Members",
  description: "Admins and Game Coordinators in the LoLMK Discord.",
};

export const dynamic = "force-dynamic";

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  config: "Verified member login isn't configured yet.",
  state: "That sign-in link expired or was already used. Try again.",
  denied: "Sign-in was cancelled.",
  not_member: "That Discord account isn't a member of the LoLMK server.",
  no_role: "That Discord account doesn't have access yet. Ask an admin.",
  discord_error: "Couldn't reach Discord to verify your account. Try again in a moment.",
};

/**
 * /members — the public-facing directory. Deliberately not gated behind
 * login: enrollment (having a profile row) is separate from viewer access,
 * and this page has always been a public route. Only entries that opted in
 * (getDirectoryEntries()'s directory_opt_in check) ever render here.
 */
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ authError?: string }>;
}) {
  const params = await searchParams;
  const { admins, coordinators } = await getDirectoryEntries();
  const authErrorMessage = params.authError
    ? AUTH_ERROR_MESSAGES[params.authError] ?? AUTH_ERROR_MESSAGES.discord_error
    : null;

  const isEmpty = admins.length === 0 && coordinators.length === 0;

  return (
    <section className="container-wide py-20 md:py-28 space-y-16">
      <div className="max-w-2xl space-y-4">
        <p className="text-label uppercase text-ink-muted">Members</p>
        <h1 className="font-display text-display-lg text-ink leading-[0.95]">
          Who runs LoLMK.
        </h1>
        <p className="text-body-lg text-ink-secondary">
          The admins and game coordinators behind the tournaments, events, and the Discord itself.
          Listed here once they sign in and choose to be shown.
        </p>
      </div>

      {authErrorMessage && (
        <p
          role="alert"
          className="flex items-start gap-2.5 text-body-sm text-danger border border-danger/40 bg-danger/10 px-4 py-3 rounded-sm max-w-2xl"
        >
          <AlertTriangle strokeWidth={1.5} className="h-5 w-5 shrink-0 mt-0.5" />
          {authErrorMessage}
        </p>
      )}

      {isEmpty ? (
        <p className="text-body-md text-ink-secondary border border-dashed border-line-strong bg-surface p-10 text-center max-w-2xl">
          No one has opted into the directory yet.
        </p>
      ) : (
        <>
          {admins.length > 0 && (
            <DirectorySection title="Admins" icon={ShieldCheck} entries={admins} />
          )}
          {coordinators.length > 0 && (
            <DirectorySection title="Game Coordinators" icon={Sparkles} entries={coordinators} />
          )}
        </>
      )}

      <div className="border-t border-line-subtle pt-8">
        <p className="text-body-sm text-ink-muted">
          Verified member?{" "}
          <Link
            href="/members/profile"
            className="text-brand-blue-bright hover:text-ink underline underline-offset-4"
          >
            Sign in with Discord
          </Link>{" "}
          to set up your profile.
        </p>
      </div>
    </section>
  );
}

function DirectorySection({
  title,
  icon: Icon,
  entries,
}: {
  title: string;
  icon: typeof ShieldCheck;
  entries: MemberDirectoryEntry[];
}) {
  return (
    <div>
      <h2 className="font-heading text-display-sm text-ink mb-6 flex items-center gap-2.5">
        <Icon strokeWidth={1.5} className="h-6 w-6 text-brand-red-bright" />
        {title}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
        {entries.map((m) => (
          <div key={m.displayName} className="bg-surface border border-line p-5 flex flex-col gap-3">
            <div className="aspect-square bg-elevated border border-line-subtle overflow-hidden flex items-center justify-center">
              {m.avatarUrl ? (
                <Image
                  src={m.avatarUrl}
                  alt=""
                  width={200}
                  height={200}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-display text-display-sm text-ink-muted leading-none">
                  {m.displayName.slice(0, 2).toUpperCase()}
                </span>
              )}
            </div>
            <div>
              <p className="font-heading text-heading-md text-ink leading-tight">{m.displayName}</p>
              {m.preferredRoles.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {m.preferredRoles.map((r) => (
                    <Badge key={r} variant="outline">
                      {r}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {m.bio && <p className="text-body-sm text-ink-secondary line-clamp-3">{m.bio}</p>}
            {m.favoriteChampion && (
              <p className="mt-auto text-caption font-mono text-ink-muted uppercase tracking-wide">
                Mains {m.favoriteChampion}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
