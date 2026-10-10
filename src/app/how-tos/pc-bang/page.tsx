import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Gamepad2, Landmark, MapPin } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = pageMetadata({
  title: "PC Bang Guide for Foreigners",
  description:
    "What to expect walking into a Korean PC bang as a foreigner: sign-in, payment, seat setup, and its limits as a workaround for account creation.",
  path: "/how-tos/pc-bang",
});

export default function PcBangPage() {
  return (
    <>
      <section className="container-wide pt-16 pb-16 md:pt-20 border-b border-line-subtle">
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Link href="/how-tos" className="text-body-sm text-ink-muted hover:text-ink">
            How-tos
          </Link>
          <span className="text-ink-muted">/</span>
          <Badge variant="outline">PC bang guide</Badge>
        </div>
        <h1 className="font-heading text-display-md text-ink leading-tight max-w-3xl">
          PC bangs, for foreigners.
        </h1>
        <p className="mt-6 text-body-lg text-ink-secondary max-w-[60ch]">
          PC bangs (PC방, internet cafes built around gaming) are everywhere in Korea and
          genuinely worth trying. Here&apos;s how sign-in actually works and where it does and
          doesn&apos;t help you.
        </p>
      </section>

      <section className="container-wide py-16 border-b border-line-subtle">
        <div className="border border-warning/40 bg-warning/10 p-6 md:p-8 flex gap-5">
          <AlertTriangle strokeWidth={1.5} className="h-7 w-7 shrink-0 text-warning" />
          <p className="text-body-md text-ink-secondary max-w-[65ch]">
            A PC bang seat is not a way around Riot&apos;s account verification. It lets you use
            a rented Windows machine with League already installed; you still need your own
            login to play on it. Sign-in policy for foreigners without a Korean ID also varies
            shop to shop, some accept a passport, some don&apos;t take foreign customers at all.
            Treat this as a maybe, not a guaranteed workaround, and confirm with staff before you
            sit down.
          </p>
        </div>
      </section>

      <section className="container-wide py-16 border-b border-line-subtle">
        <p className="text-label uppercase text-ink-muted mb-4">Walking in</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">What sign-in actually looks like.</h2>
        <ol className="max-w-[70ch] space-y-6 text-body-md text-ink-secondary">
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">01</span>
            <span>
              At the counter (or a self-service kiosk in newer shops), tell staff you want a
              seat: <strong className="text-ink">한 자리 주세요</strong> works, or just point.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">02</span>
            <span>
              You&apos;ll be asked for ID to register the session. A passport is the standard
              foreigner substitute for the Korean ID a citizen would show. Some shops (and most
              unmanned kiosks) require real-name registration through a Korean phone or ARC/RC
              and will turn away a foreigner with only a passport; this is the same identity
              requirement that blocks League account creation, and it isn&apos;t consistent
              between shops.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">03</span>
            <span>
              Pay up front, cash or card, for a block of time (usually sold in 1 to 5 hour
              blocks). You get a seat number and a login PIN for that shop&apos;s system.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">04</span>
            <span>
              At your seat, log into the shop&apos;s kiosk software with the PIN, then open the Riot
              Client from the desktop and sign into your own Riot account like on any PC. If you
              don&apos;t have a KR account yet, see our{" "}
              <Link href="/how-tos/make-kr-account" className="text-ink underline underline-offset-2 hover:text-brand-red-bright">
                account creation guide
              </Link>{" "}
              first.
            </span>
          </li>
        </ol>
      </section>

      <section className="container-wide py-16 border-b border-line-subtle">
        <p className="text-label uppercase text-ink-muted mb-4">What to actually expect</p>
        <div className="grid gap-6 md:grid-cols-3">
          <div className="border border-line bg-surface p-6 space-y-3">
            <Gamepad2 strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Hardware is genuinely great</p>
            <p className="text-body-sm text-ink-secondary">
              High refresh monitors, mechanical keyboards, and fast machines are the norm, not
              the exception. Most shops also sell snacks and instant noodles at the counter.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <Landmark strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Riot&apos;s own PC bang program</p>
            <p className="text-body-sm text-ink-secondary">
              Riot Korea runs a separate premium PC bang program for shop owners (billing,
              perks, in-game bonuses for players on partnered machines). It governs how shops pay
              Riot, not how individual foreign customers sign in; it doesn&apos;t create a
              visitor account path.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <MapPin strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Pick shops near universities</p>
            <p className="text-body-sm text-ink-secondary">
              Areas like Hongdae, Sinchon, and Konkuk have PC bangs used to foreign customers and
              are more likely to accept a passport at sign-in than a shop in a residential
              neighborhood.
            </p>
          </div>
        </div>
      </section>

      <section className="container-wide py-16">
        <div className="border border-line-subtle bg-surface p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <p className="font-heading text-heading-lg text-ink">Know a PC bang that&apos;s good with foreigners?</p>
            <p className="mt-2 text-body-sm text-ink-secondary max-w-[50ch]">
              Drop the name in Discord so we can add it here for the next person.
            </p>
          </div>
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "lg" }), "shrink-0")}
          >
            <DiscordIcon className="h-6 w-6" />
            Tell us in Discord
            <ArrowRight strokeWidth={2} className="h-5 w-5" />
          </a>
        </div>
      </section>
    </>
  );
}
