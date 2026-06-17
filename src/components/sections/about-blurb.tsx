import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function AboutBlurb() {
  return (
    <section className="border-y border-line-subtle bg-surface">
      <div className="container-wide py-24">
        <div className="grid lg:grid-cols-12 gap-12">
          <div className="lg:col-span-4">
            <p className="text-label uppercase text-ink-muted mb-4">About</p>
            <h2 className="font-heading text-display-md text-ink">
              We've been on KR a while.
            </h2>
          </div>
          <div className="lg:col-span-8 space-y-6">
            <p className="text-body-lg text-ink-secondary max-w-[65ch]">
              LoLMK started as a Discord for English-speakers playing on the
              Korean server. Today it's the largest community of its kind: new
              expats finding 5-stacks, tourists getting their KR account
              working, and long-timers running tournaments out of Gen.G GGX.
            </p>
            <p className="text-body-md text-ink-secondary max-w-[65ch]">
              No tryouts, no gatekeeping. Iron through Challenger — if you want
              English voice on KR, you're welcome.
            </p>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 text-body-md font-medium text-brand-red-bright hover:text-brand-red-hover"
            >
              Read the full story
              <ArrowRight strokeWidth={1.5} className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
