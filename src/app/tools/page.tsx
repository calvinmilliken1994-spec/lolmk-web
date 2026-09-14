import type { Metadata } from "next";
import Link from "next/link";
import { Swords, Timer, Trophy } from "lucide-react";
import { isToolsSession } from "@/lib/tools-auth";

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
  {
    name: "Summoner's Rift",
    slug: "summoners-rift",
    description:
      "Persistent 5v5 tournaments: teams and logos, random seeding, single/double-elim brackets, live result reporting and a full audit log.",
    icon: Trophy,
  },
];

export default async function ToolsPage() {
  const signedIn = await isToolsSession();

  if (!signedIn) {
    return (
      <section className="container-wide pt-16 pb-24 md:pt-20">
        <div className="max-w-3xl space-y-5">
          <h1 className="font-heading text-display-md text-ink leading-tight">Tools</h1>
          <p className="text-body-lg text-ink-secondary max-w-[55ch]">
            Admin access only. Regular members do not have access to these tools.
          </p>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="container-wide pt-16 pb-24 md:pt-20">
        <div className="max-w-3xl space-y-5 mb-10">
          <h1 className="font-heading text-display-md text-ink leading-tight">Tools</h1>
          <p className="text-body-lg text-ink-secondary max-w-[55ch]">
            Tournament timers and event utilities used by LoLMK admins.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <Link
                key={tool.slug}
                href={`/tools/${tool.slug}`}
                className="group bg-surface border border-line p-6 flex flex-col gap-4 hover:border-line-strong hover:-translate-y-0.5 hover:bg-elevated/40 transition-all duration-200 ease-out-soft"
              >
                <span className="flex h-12 w-12 items-center justify-center border border-line bg-elevated text-brand-red-bright">
                  <Icon strokeWidth={1.5} className="h-6 w-6" />
                </span>
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
