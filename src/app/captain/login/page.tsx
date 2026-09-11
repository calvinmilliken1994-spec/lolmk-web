import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isCaptainAuthConfigured } from "@/lib/discord-auth";
import { DiscordIcon } from "@/components/ui/brand-icons";

export const metadata: Metadata = {
  title: "Captain sign in",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  config: "Captain sign-in isn't switched on yet. Check back once the next tournament opens.",
  state: "That sign-in link expired or was already used. Try again.",
  denied: "Sign-in was cancelled.",
  not_member: "That Discord account isn't a member of the LoLMK server.",
  no_role:
    "That Discord account doesn't have the Team Captain role. Ask in the Discord to get it before registering a team.",
  discord_error: "Couldn't reach Discord to verify your account. Try again in a moment.",
};

export default async function CaptainLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const configured = isCaptainAuthConfigured();
  const next = params.next && params.next.startsWith("/captain") ? params.next : "/captain";
  const loginHref = `/api/auth/captain/login?next=${encodeURIComponent(next)}`;
  const errorMessage = params.error
    ? ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.discord_error
    : null;

  return (
    <section className="container-wide py-24 md:py-32">
      <div className="mx-auto max-w-md">
        <div className="border border-line bg-surface p-8 md:p-10">
          <div className="mb-8 space-y-2">
            <p className="text-label uppercase text-ink-muted">Team captains</p>
            <h1 className="font-display text-display-sm text-ink leading-none">Captain sign in</h1>
            <p className="text-body-sm text-ink-secondary">
              Sign in with the Discord account that holds the Team Captain role
              in the LoLMK server to register a team and manage your roster.
            </p>
          </div>

          {errorMessage && (
            <p
              role="alert"
              className="mb-6 flex items-start gap-2.5 text-body-sm text-danger border border-danger/40 bg-danger/10 px-4 py-3 rounded-sm"
            >
              <AlertTriangle strokeWidth={1.5} className="h-5 w-5 shrink-0 mt-0.5" />
              {errorMessage}
            </p>
          )}

          {configured ? (
            <Link
              href={loginHref}
              className={cn(buttonVariants({ variant: "discord", size: "lg" }), "w-full")}
            >
              <DiscordIcon className="h-5 w-5" />
              Sign in with Discord
              <ArrowRight strokeWidth={2} className="h-5 w-5" />
            </Link>
          ) : (
            /*
              Fails closed and says so plainly. This is what a visitor sees
              until CAPTAIN_ROLE_ID is set — there is no "configuration
              missing, let everyone in" branch anywhere in this flow.
            */
            <p className="text-body-sm text-warning border border-warning/50 bg-warning/10 px-4 py-2.5 rounded-sm">
              Captain sign-in isn't live yet. Team registration opens through
              Discord when the next tournament is announced.
            </p>
          )}

          <p className="mt-6 text-body-sm text-ink-muted">
            <Link
              href="/tournaments/summoners-rift"
              className="text-brand-blue-bright hover:text-ink underline underline-offset-4"
            >
              Back to tournaments
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
