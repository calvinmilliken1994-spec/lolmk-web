import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Languages, MonitorCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Switch the League Client to English",
  description:
    "Set your Riot Client and League of Legends to English while playing on the KR server, without changing your account region.",
};

export default function ClientEnglishPage() {
  return (
    <>
      <section className="container-wide pt-16 pb-16 md:pt-20 border-b border-line-subtle">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link href="/how-tos" className="text-body-sm text-ink-muted hover:text-ink">
            How-tos
          </Link>
          <span className="text-ink-muted">/</span>
          <Badge variant="outline">Client to English</Badge>
        </div>
        <h1 className="font-heading text-display-md text-ink leading-tight max-w-3xl">
          Switching the client to English.
        </h1>
        <p className="mt-6 text-body-lg text-ink-secondary max-w-[60ch]">
          A KR account defaults to Korean. Language is a client setting, separate from your
          account region, so switching it doesn&apos;t move your server or reset your rank.
        </p>
      </section>

      <section className="container-wide py-16 border-b border-line-subtle">
        <p className="text-label uppercase text-ink-muted mb-4">Method 1: recommended</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          Change it from inside the Riot Client.
        </h2>
        <ol className="max-w-[70ch] space-y-6 text-body-md text-ink-secondary">
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">01</span>
            <span>
              Open the Riot Client (the launcher that opens before League itself) and sign in.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">02</span>
            <span>
              Click your profile icon in the top-right corner, then open <strong className="text-ink">설정</strong> (Settings).
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">03</span>
            <span>
              Find the Riot Client language dropdown and select <strong className="text-ink">English</strong>. This
              changes the launcher immediately.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">04</span>
            <span>
              In the same settings panel, select the <strong className="text-ink">League of Legends</strong> tab
              and set its language to English separately. The launcher and the game each carry
              their own language setting.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">05</span>
            <span>Launch the game. It downloads English text and voice assets on first switch, so the first load takes longer.</span>
          </li>
        </ol>
      </section>

      <section className="container-wide py-16 border-b border-line-subtle">
        <p className="text-label uppercase text-ink-muted mb-4">Method 2: launch shortcut flag</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          If the settings menu won&apos;t stick.
        </h2>
        <div className="max-w-[70ch] space-y-4 text-body-md text-ink-secondary">
          <p>
            Occasionally a client update resets the language back to Korean. A launch flag
            forces it every time you open the game:
          </p>
          <ol className="space-y-4">
            <li className="flex gap-4">
              <span className="shrink-0 font-mono text-brand-red-bright">01</span>
              <span>Right-click your League of Legends desktop shortcut and open <strong className="text-ink">Properties</strong>.</span>
            </li>
            <li className="flex gap-4">
              <span className="shrink-0 font-mono text-brand-red-bright">02</span>
              <span>
                In the <strong className="text-ink">Target</strong> field, add a space at the end
                then paste: <code className="bg-elevated px-1.5 py-0.5 rounded-sm font-mono text-ink">--locale=en_US</code>
              </span>
            </li>
            <li className="flex gap-4">
              <span className="shrink-0 font-mono text-brand-red-bright">03</span>
              <span>Click Apply, then launch from that shortcut going forward.</span>
            </li>
          </ol>
          <p className="text-body-sm text-ink-muted">
            This overrides the client language on every launch from that shortcut specifically.
            Launching from the Start menu or a different shortcut still uses whatever the
            settings menu has saved.
          </p>
        </div>
      </section>

      <section className="container-wide py-16">
        <div className="grid gap-6 md:grid-cols-2 max-w-[70ch]">
          <div className="border border-line bg-surface p-6 space-y-3">
            <Languages strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">In-game chat and champion voice lines</p>
            <p className="text-body-sm text-ink-secondary">
              Switching the client language changes UI text and menus. Voice lines follow the
              same setting once the English audio pack finishes downloading. Enemy and ally
              players on KR will still type in Korean; that part doesn&apos;t change with your
              own settings.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <MonitorCog strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">This doesn&apos;t change your server</p>
            <p className="text-body-sm text-ink-secondary">
              Language and server region are independent settings. Switching to English keeps
              you on the KR server, your rank, and your friends list exactly as they are.
            </p>
          </div>
        </div>

        <div className="mt-12 border border-line-subtle bg-surface p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <p className="font-heading text-heading-lg text-ink">Stuck on a menu you can&apos;t read?</p>
            <p className="mt-2 text-body-sm text-ink-secondary max-w-[50ch]">
              Drop a screenshot in Discord, someone will translate it in minutes.
            </p>
          </div>
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "lg" }), "shrink-0")}
          >
            <DiscordIcon className="h-6 w-6" />
            Ask in Discord
            <ArrowRight strokeWidth={2} className="h-5 w-5" />
          </a>
        </div>
      </section>
    </>
  );
}
