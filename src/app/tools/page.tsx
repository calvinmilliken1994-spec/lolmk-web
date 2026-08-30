import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Lock, Swords, Timer } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getToolsCredentials, isToolsSession } from "@/lib/tools-auth";

export const metadata: Metadata = {
  title: "Tools",
  description:
    "LoLMK admin tools. Tournament timers and event utilities. Past the door: admins only.",
  robots: { index: false, follow: false },
};

interface ToolEntry {
  name: string;
  slug: string;
  description: string;
  icon: typeof Timer;
}

const TOOLS: ToolEntry[] = [
  {
    name: "Tournament Timer",
    slug: "timer",
    description:
      "Round timer for tournaments and events. Pause, adjust, fullscreen on the house screen.",
    icon: Timer,
  },
  {
    name: "ARAM Mayhem",
    slug: "mayhem",
    description:
      "Run fun ARAM tournaments: entrants, team randomizer, configurable brackets, live match control. Pairs with the /mayhemlive venue screen.",
    icon: Swords,
  },
];

export default async function ToolsPage() {
  const credentialsConfigured = getToolsCredentials() !== null;
  const signedIn = credentialsConfigured && (await isToolsSession());

  return (
    <>
      <section className="relative overflow-hidden border-b border-line-subtle">
        <div aria-hidden className="absolute inset-0 grain pointer-events-none" />
        <div
          aria-hidden
          className="absolute -top-40 left-1/2 h-[560px] w-[1100px] -translate-x-1/2 bg-gradient-to-br from-brand-red/15 via-transparent to-brand-blue/15 blur-3xl pointer-events-none"
        />
        <div className="container-wide relative py-20 md:py-28">
          <div className="max-w-3xl space-y-6">
            <p className="text-label uppercase text-ink-muted">Admin tools</p>
            <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
              The tool chest.
            </h1>
            <p className="text-body-lg text-ink-secondary max-w-[55ch]">
              Tournament timers and event utilities used by LoLMK admins. The
              door is open for everyone to look; everything past it needs a
              key.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {credentialsConfigured ? (
                signedIn ? (
                  <Link
                    href="/tools/logout"
                    className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
                  >
                    <Lock strokeWidth={1.5} className="h-5 w-5" />
                    Sign out
                  </Link>
                ) : (
                  <Link
                    href="/tools/login"
                    className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
                  >
                    <Lock strokeWidth={1.5} className="h-5 w-5" />
                    Admin sign in
                    <ArrowRight strokeWidth={2} className="h-5 w-5" />
                  </Link>
                )
              ) : (
                <p className="text-body-sm text-warning border border-warning/50 bg-warning/10 px-4 py-2.5 rounded-sm">
                  Login is not configured yet. Set TOOLS_ADMIN_USERNAME and
                  TOOLS_ADMIN_PASSWORD.
                </p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="container-wide py-24">
        <div className="max-w-2xl mb-12">
          <p className="text-label uppercase text-ink-muted mb-4">Available</p>
          <h2 className="font-heading text-display-sm text-ink">Tools</h2>
          <p className="mt-4 text-body-md text-ink-secondary">
            Each tool lives at <span className="font-mono">/tools/[name]</span>
            . Anything past this page is behind the admin login wall.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            const locked = !signedIn;
            return (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="group bg-surface border border-line p-6 flex flex-col gap-4 hover:border-line-strong hover:-translate-y-0.5 hover:bg-elevated/40 transition-all duration-200 ease-out-soft"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-12 w-12 items-center justify-center border border-line bg-elevated text-brand-red-bright">
                    <Icon strokeWidth={1.5} className="h-6 w-6" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-caption font-mono uppercase tracking-wider text-ink-muted">
                    {locked ? (
                      <>
                        <Lock strokeWidth={1.5} className="h-3.5 w-3.5" />
                        Locked
                      </>
                    ) : (
                      <>
                        <ArrowRight strokeWidth={1.5} className="h-3.5 w-3.5" />
                        Open
                      </>
                    )}
                  </span>
                </div>
                <div>
                  <p className="font-heading text-heading-md text-ink group-hover:text-brand-red-bright transition-colors">
                    {tool.name}
                  </p>
                  <p className="mt-1 text-caption font-mono text-ink-muted">
                    /tools/{tool.slug}
                  </p>
                  <p className="mt-3 text-body-sm text-ink-secondary">
                    {tool.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </>
  );
}
