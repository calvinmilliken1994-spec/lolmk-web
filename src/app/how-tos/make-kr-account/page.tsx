import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CircleX, IdCard, Smartphone } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";
import { GuideLayout, GuideFigure } from "@/components/ds/guide-layout";

export const metadata: Metadata = pageMetadata({
  title: "Make a KR League of Legends Account",
  description:
    "How to make a real, verified Korean server League of Legends account: what a Residence Card (ARC) does, why short-term visitors get stuck, and why buying an account isn't the answer.",
  path: "/how-tos/make-kr-account",
});

export default function MakeKrAccountPage() {
  return (
    <GuideLayout slug="make-kr-account">
      <section id="dont-buy" className="py-16 border-b border-line-subtle">
        <div className="border border-danger/40 bg-danger/10 p-6 md:p-8 flex flex-col sm:flex-row gap-5">
          <CircleX strokeWidth={1.5} className="h-8 w-8 shrink-0 text-danger" />
          <div className="space-y-2">
            <p className="font-heading text-heading-md text-ink">
              We follow the Riot Games Terms of Service.
            </p>
            <p className="text-body-md text-ink-secondary max-w-[65ch]">
              LoLMK does not condone buying, selling, or renting Korean LoL accounts. It
              violates Riot&apos;s Terms of Service, and Riot&apos;s own support documentation
              is blunt about the outcome: the buyer almost always loses the money, the account,
              or both, once the original owner or the seller files a recovery request. There is
              no version of this that ends well for the buyer. Don&apos;t do it, and if you see
  someone selling accounts in a Discord or Facebook group, report it instead of
              buying it.
            </p>
          </div>
        </div>
        <GuideFigure caption={<>Riot&apos;s own support article on why buying accounts is a bad idea.</>}>
          <Image
            src="/images/how-tos/riot-dont-buy-accounts-support-page.png"
            alt="Riot Games support article titled 'Don't Buy Accounts!' warning that account trading violates the Terms of Use and puts buyers at risk of losing money or the account."
            width={1088}
            height={601}
            className="w-full h-auto"
          />
        </GuideFigure>
      </section>

      <section id="identity-verification" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">The real obstacle</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          It comes down to one thing: Korean identity verification.
        </h2>
        <div className="max-w-[70ch] space-y-4 text-body-md text-ink-secondary">
          <p>
            Korean law requires real-name verification for online games. Riot Korea enforces
            this by requiring a Korean mobile phone number registered under your real name at
            signup. For a Korean citizen, that phone number is tied to their national ID. For a
            foreigner, it&apos;s tied to what is now officially called the{" "}
            <strong className="text-ink">Residence Card (RC)</strong>, still called the{" "}
            <strong className="text-ink">Alien Registration Card (ARC)</strong> by almost
            everyone in daily conversation, including phone carriers, immigration staff, and
            Riot&apos;s own signup form. The government has been shifting to the newer name; on
            the ground, ARC and RC refer to the same card.
          </p>
          <p>
            No ARC/RC number tied to a Korean phone plan means no way to pass Riot Korea&apos;s
            identity check. That requirement is the core obstacle for tourists and new arrivals
            alike; visa type and individual carrier policy can still change the details.
          </p>
          <p>
            A note on what not to do: some sites suggest generating a fake resident
            registration number, or using someone else&apos;s ARC/ID details, to get past this
            check. That&apos;s not a gray area. It&apos;s identity fraud under Korean law, on
            top of violating Riot&apos;s Terms of Service, and it puts the account (and you) at
            real legal risk, not just a ban risk.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="border border-line bg-surface p-6 space-y-3">
            <IdCard strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">What the ARC/RC actually is</p>
            <p className="text-body-sm text-ink-secondary">
              Issued by Korea Immigration to any foreigner staying more than 90 days. It
              functions as a Korean foreigner ID: required to get a phone plan in your own name,
              open a bank account, or sign up for most Korean online services, League included.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <Smartphone strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Why a tourist SIM doesn&apos;t work</p>
            <p className="text-body-sm text-ink-secondary">
              A tourist prepaid SIM or eSIM is not the same registration as a phone line tied to
              your own ARC/RC. Riot&apos;s check looks for a real-name Korean line under your
              identity, so a tourist SIM commonly fails it even though it makes calls and gets
              data fine, confirm with your specific carrier before assuming either way.
            </p>
          </div>
        </div>
      </section>

      <section id="the-sequence" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">If you have an ARC / RC</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          You can make an account. Here&apos;s the sequence.
        </h2>
        <ol className="max-w-[70ch] space-y-6 text-body-md text-ink-secondary">
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">01</span>
            <span>
              Get your ARC/RC first. Apply within 90 days of arrival at your local immigration
              office (book a slot at{" "}
              <a
                href="https://www.hikorea.go.kr"
                target="_blank"
                rel="noreferrer"
                className="text-ink underline underline-offset-2 hover:text-brand-red-bright"
              >
                hikorea.go.kr
              </a>
              , walk-ins are usually turned away). Processing takes up to six weeks and the card
              is what everything else, phone plan, bank account, League account, is built on
              top of.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">02</span>
            <span>
              Get a Korean phone plan registered in your name using your ARC/RC. Any carrier
              (SKT, KT, LG U+, or an MVNO) will register the line to your ARC number once you
              have the card.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">03</span>
            <span>
              Go to Riot&apos;s Korean signup flow and choose the foreigner
              (외국인) option where the form asks for a resident registration number. Enter
              your ARC/RC number instead of a Korean citizen&apos;s number, then verify with the
              SMS code sent to your Korean line.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">04</span>
            <span>
              Finish email verification and set your Riot ID. From here it&apos;s the same
              client and launcher as any other region, just pointed at the KR server list.
            </span>
          </li>
        </ol>
        <p className="mt-6 max-w-[70ch] text-body-sm text-ink-muted">
          We haven&apos;t been able to screenshot this identity-verification screen directly: it
          sits behind a CAPTCHA and only proceeds with a real ARC number and a live Korean
          phone, so there is no way to walk through it without real credentials. The steps above
          reflect Riot&apos;s and Korea Immigration&apos;s published process as of this
          guide&apos;s last check; treat them as a starting point, not a guarantee, since Riot
          Korea does adjust its signup flow.
        </p>
      </section>

      <section id="no-shortcut" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">If you&apos;re a short-term visitor</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          There is no general shortcut. Here&apos;s the honest answer.
        </h2>
        <div className="border border-warning/40 bg-warning/10 p-6 md:p-8 flex gap-5 max-w-[70ch]">
          <AlertTriangle strokeWidth={1.5} className="h-7 w-7 shrink-0 text-warning" />
          <div className="space-y-3 text-body-md text-ink-secondary">
            <p>
              If you&apos;re on a 90-day visa-waiver visit and won&apos;t be applying for an
              ARC/RC, we found no officially documented, ToS-compliant path to a personal KR
              account. The identity check is the wall, and there&apos;s no visitor-tier
              exception published by Riot Korea.
            </p>
            <p>
              You&apos;ll sometimes hear that a PC bang (Korean internet café) lets you play
              LoL without your own account. Treat that as unreliable, not a plan: policy and
              enforcement vary by shop, some require the same real-name registration Riot does,
              and it doesn&apos;t give you your own persistent, rank-tracked account either way.
              See our{" "}
              <Link href="/how-tos/pc-bang" className="text-ink underline underline-offset-2 hover:text-warning">
                PC bang guide
              </Link>{" "}
              for what that actually looks like on the ground.
            </p>
            <p>
              The realistic options for a visitor: play on your home region&apos;s server while
              in Korea (works fine over local internet, just higher ping to your home
              region&apos;s data center), or come back and go through the ARC/RC route once
              you&apos;re actually living here long-term.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16">
        <div className="border border-line-subtle bg-surface p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <p className="font-heading text-heading-lg text-ink">
              Questions about your specific situation?
            </p>
            <p className="mt-2 text-body-sm text-ink-secondary max-w-[50ch]">
              Visa types and edge cases vary. Ask in Discord, someone has probably already gone
              through it.
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
          </a>
        </div>
      </section>
    </GuideLayout>
  );
}
