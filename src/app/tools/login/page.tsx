import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isDiscordAuthConfigured } from "@/lib/tools-auth";

export const metadata: Metadata = {
  title: "Admin sign in",
  robots: { index: false, follow: false },
};

const ERROR_MESSAGES: Record<string, string> = {
  config: "Admin login isn't configured yet. Set the Discord OAuth env vars and restart the server.",
  state: "That sign-in link expired or was already used. Try signing in again.",
  denied: "Sign-in was cancelled.",
  not_member: "That Discord account isn't a member of the LoLMK server.",
  no_role: "That Discord account doesn't have the Tournament Admin role. Ask an admin for access.",
  discord_error: "Couldn't reach Discord to verify your account. Try again in a moment.",
};

export default async function ToolsLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const configured = isDiscordAuthConfigured();
  const next = params.next && params.next.startsWith("/tools") ? params.next : "/tools";
  const loginHref = `/api/auth/discord/login?next=${encodeURIComponent(next)}`;
  const errorMessage = params.error ? ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.discord_error : null;

  return (
    <section className="container-wide py-24 md:py-32">
      <div className="mx-auto max-w-md">
        <div className="border border-line bg-surface p-8 md:p-10">
          <div className="mb-8 space-y-2">
            <p className="text-label uppercase text-ink-muted">Admin tools</p>
            <h1 className="font-display text-display-sm text-ink leading-none">
              Admin sign in
            </h1>
            <p className="text-body-sm text-ink-secondary">
              Sign in with the Discord account that holds the Tournament Admin
              role in the LoLMK server. Ask an admin if you need access.
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
              className={cn(buttonVariants({ variant: "primary", size: "lg" }), "w-full")}
            >
              {/* Discord glyph — kept inline to avoid a new icon-set dependency for one mark. */}
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.099.246.197.373.291a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.055c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.955 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z" />
              </svg>
              Sign in with Discord
              <ArrowRight strokeWidth={2} className="h-5 w-5" />
            </Link>
          ) : (
            <p className="text-body-sm text-warning border border-warning/50 bg-warning/10 px-4 py-2.5 rounded-sm">
              Admin login isn&apos;t configured. Set DISCORD_CLIENT_ID,
              DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, and
              DISCORD_ADMIN_ROLE_ID, then restart the server.
            </p>
          )}

          <p className="mt-6 text-body-sm text-ink-muted">
            <Link href="/tools" className="text-brand-blue-bright hover:text-ink underline underline-offset-4">
              Back to /tools
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
