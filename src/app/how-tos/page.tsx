import Link from "next/link";
import { ArrowRight, BookOpen, IdCard, Languages, PcCase, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "How-tos",
  description:
    "Guides for playing on the Korean LoL server: making an account, buying RP, finding PC bangs, and more.",
};

const GUIDES = [
  {
    href: "/how-tos/make-kr-account",
    icon: IdCard,
    title: "Make a KR account",
    body: "What a Residence Card (ARC) does, why short-term visitors get stuck, and why buying an account isn't the answer.",
  },
  {
    href: "/how-tos/client-english",
    icon: Languages,
    title: "Switch the client to English",
    body: "Set the Riot Client and League to English while staying on the KR server, without touching your rank or region.",
  },
  {
    href: "/how-tos/buy-rp",
    icon: Wallet,
    title: "Buy RP in Korea",
    body: "Payment methods that actually clear on the KR store, and why most foreign cards get declined.",
  },
  {
    href: "/how-tos/pc-bang",
    icon: PcCase,
    title: "PC bang guide",
    body: "What sign-in looks like as a foreigner, and where a PC bang seat does and doesn't help you.",
  },
];

export default function HowTosPage() {
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
            <p className="text-label uppercase text-ink-muted inline-flex items-center gap-2">
              <BookOpen strokeWidth={1.5} className="h-4 w-4" />
              How-tos
            </p>
            <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
              The KR survival guide.
            </h1>
            <p className="text-body-lg text-ink-secondary max-w-[55ch]">
              Everything we&apos;ve answered ten times in Discord, written down once. Practical,
              English-first, written by people who&apos;ve actually done it.
            </p>
          </div>
        </div>
      </section>

      <section className="container-wide py-20">
        <div className="grid gap-6 sm:grid-cols-2">
          {GUIDES.map((guide) => {
            const Icon = guide.icon;
            return (
              <Link
                key={guide.href}
                href={guide.href}
                className="group bg-surface border border-line p-6 flex flex-col gap-4 hover:border-line-strong hover:-translate-y-0.5 hover:bg-elevated/40 transition-all duration-200 ease-out-soft"
              >
                <span className="flex h-12 w-12 items-center justify-center border border-line bg-elevated text-brand-red-bright">
                  <Icon strokeWidth={1.5} className="h-6 w-6" />
                </span>
                <div>
                  <p className="font-heading text-heading-md text-ink group-hover:text-brand-red-bright transition-colors">
                    {guide.title}
                  </p>
                  <p className="mt-2 text-body-sm text-ink-secondary">{guide.body}</p>
                </div>
                <div className="mt-auto flex items-center gap-2 text-body-sm text-ink-secondary group-hover:text-brand-red-bright transition-colors">
                  <span>Read guide</span>
                  <ArrowRight strokeWidth={1.5} className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            );
          })}
        </div>
        <p className="mt-12 max-w-[60ch] text-body-sm text-ink-muted">
          Don&apos;t see what you need, or think something here is wrong or out of date? Ask in
          the LoLMK Discord, that&apos;s where these guides come from.
        </p>
      </section>
    </>
  );
}
