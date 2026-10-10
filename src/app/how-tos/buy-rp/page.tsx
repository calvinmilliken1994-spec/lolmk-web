import type { Metadata } from "next";
import { AlertTriangle, CreditCard, Smartphone, Wallet } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";
import { GuideLayout } from "@/components/ds/guide-layout";

export const metadata: Metadata = pageMetadata({
  title: "Buy RP in Korea",
  description:
    "Payment methods for topping up RP on the KR League of Legends server as a foreigner, and why most foreign cards fail at checkout.",
  path: "/how-tos/buy-rp",
});

export default function BuyRpPage() {
  return (
    <GuideLayout slug="buy-rp">
      <section className="py-16 border-b border-line-subtle">
        <div className="border border-warning/40 bg-warning/10 p-6 md:p-8 flex gap-5">
          <AlertTriangle strokeWidth={1.5} className="h-7 w-7 shrink-0 text-warning" />
          <p className="text-body-md text-ink-secondary max-w-[65ch]">
            Most non-Korean-issued credit and debit cards get declined on the KR store, even
            major international ones. Riot Korea&apos;s store routes payment through local
            processors that expect a Korean-issued card or a Korean payment method. Budget for
            one of the options below rather than assuming your home card will work.
          </p>
        </div>
      </section>

      <section id="payment-methods" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">What actually works</p>
        <h2 className="font-heading text-display-sm text-ink mb-8">Payment methods, ranked by how easy they are to get.</h2>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="border border-line bg-surface p-6 space-y-3">
            <CreditCard strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Korean bank debit card</p>
            <p className="text-body-sm text-ink-secondary">
              Once you have an ARC/RC and a Korean bank account, your Korean debit card works
              directly in the client&apos;s RP charge menu. This is the most reliable method for
              residents.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <Wallet strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Culture Land or similar gift vouchers</p>
            <p className="text-body-sm text-ink-secondary">
              Convenience-store RP top-up cards and the dedicated LoL prepaid card were
              discontinued by Riot Korea on January 31, 2023, they no longer work at all.
              General-purpose vouchers like Culture Land (문화상품권) are a different product and
              are still listed as an accepted RP payment method, sold at convenience stores and
              redeemed by PIN in the client&apos;s charge screen. Confirm current acceptance in the
              client before relying on this, payment options do change.
            </p>
          </div>
          <div className="border border-line bg-surface p-6 space-y-3">
            <Smartphone strokeWidth={1.5} className="h-7 w-7 text-brand-red" />
            <p className="font-heading text-heading-sm text-ink">Korean phone billing</p>
            <p className="text-body-sm text-ink-secondary">
              RP charged to your Korean mobile carrier bill. Requires a Korean phone plan
              registered in your name, so it&apos;s tied to the same ARC/RC path as account creation.
            </p>
          </div>
        </div>
      </section>

      <section id="no-korean-banking" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">Steps for the gift card route</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">
          The easiest path if you don&apos;t have Korean banking yet.
        </h2>
        <ol className="max-w-[70ch] space-y-6 text-body-md text-ink-secondary">
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">01</span>
            <span>
              Go to any convenience store and ask for a{" "}
              <strong className="text-ink">문화상품권</strong> (Culture Land voucher) in the
              denomination you want. Cash or a Korean card works at the register.
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">02</span>
            <span>
              In the League client, open the shop and select <strong className="text-ink">RP충전</strong> (RP Charge).
            </span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">03</span>
            <span>Select the 문화상품권 payment option and enter the PIN printed on the back of your card.</span>
          </li>
          <li className="flex gap-4">
            <span className="shrink-0 font-mono text-brand-red-bright">04</span>
            <span>Confirm the amount. RP lands in your account within a minute or two.</span>
          </li>
        </ol>
        <p className="mt-6 max-w-[70ch] text-body-sm text-ink-muted">
          If the in-client charge screen errors out, Riot&apos;s own support documentation points to
          the mobile store at lolshop.co.kr as a fallback using the same payment methods.
        </p>
      </section>

      <section id="monthly-cap" className="py-16 border-b border-line-subtle">
        <p className="font-heading text-ds-label text-ds-text-dim mb-4">Spending limits</p>
        <h2 className="font-heading text-display-sm text-ink mb-6">Korea caps how much RP you can buy per month.</h2>
        <div className="max-w-[70ch] space-y-4 text-body-md text-ink-secondary">
          <p>
            Korean law sets a monthly RP purchase limit tied to your registered identity, not
            per account. Under-19 accounts are capped at ₩70,000/month. Adults get a
            self-managed limit they can raise or lower twice a month from the account
            management page, resetting on the 1st.
          </p>
          <p>
            If you hold multiple KR accounts under the same name, the limit is shared across all
            of them, spending on one reduces what&apos;s left for the others in the same month.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="border border-line-subtle bg-surface p-8 md:p-10 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <p className="font-heading text-heading-lg text-ink">Payment declined and not sure why?</p>
            <p className="mt-2 text-body-sm text-ink-secondary max-w-[50ch]">
              Screenshot the error in Discord, it&apos;s usually a quick fix.
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
