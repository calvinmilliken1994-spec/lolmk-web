import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { PageHeader } from "@/components/ds/page-header";
import { Suspense } from "react";
import { AsyncStatStrip } from "@/components/ds/async-stat-strip";
import { StatStripSkeleton } from "@/components/ds/skeleton";
import { statCells } from "@/components/ds/stat-strip";
import { cn } from "@/lib/utils";
import { pageMetadata } from "@/lib/metadata";
import { getDiscordStats } from "@/lib/discord";
import { getRecurringSchedule } from "@/lib/events";
import { getSocials } from "@/lib/socials";
import { FORMAT_HREFS, FORMAT_NAMES } from "@/lib/tournament-status";

export const metadata = pageMetadata({
  title: "About",
  description:
    "LoLMK is the largest English-speaking League of Legends community in Korea. Run by volunteers since 2014, partnered with Gen.G GGX.",
  path: "/about",
});

export const revalidate = 300;

const numberFmt = new Intl.NumberFormat("en-US");

const FORMATS = [
  {
    key: "sr" as const,
    line: "Full-draft 5v5 tournaments on the KR server, run over a week or a month.",
  },
  {
    key: "aram" as const,
    line: "The meetup tournament at Gen.G GGX. Turn up solo or with a team and play the bracket in one evening.",
  },
  {
    key: "rb" as const,
    line: "Riftbound cups at GGX and a weekly online night on tcg-arena.fr.",
  },
];

const H2 = "m-0 font-display text-[clamp(40px,5vw,60px)] font-normal leading-[0.92] text-ds-text";

export default async function AboutPage() {
  // Discord streams into the stat strip behind Suspense.
  const discordPromise = getDiscordStats();
  const [recurring, socials] = await Promise.all([getRecurringSchedule(), getSocials()]);

  return (
    <>
      <PageHeader
        tag="About"
        title="Since 2014."
        deck="The largest English-speaking League of Legends community in Korea. Run by volunteers, partnered with Gen.G GGX."
        statsSlot={
          <Suspense fallback={<StatStripSkeleton count={4} />}>
            <AsyncStatStrip
              cells={discordPromise.then((discord) =>
                statCells([
                  { k: "Established", v: "2014" },
                  { k: "Members", v: discord ? numberFmt.format(discord.members) : null },
                  { k: "Partner venue", v: "Gen.G GGX" },
                  { k: "Based in", v: "Seoul" },
                ]),
              )}
            />
          </Suspense>
        }
      />

      <section aria-labelledby="what-we-run" className="ds-container pt-[clamp(40px,6vw,72px)]">
        <h2 id="what-we-run" className={H2}>
          What we run.
        </h2>
        <div className="mt-8 grid gap-px border border-ds-line bg-ds-line lg:grid-cols-2">
          <div className="bg-ds-surface px-7 py-7">
            <p className="m-0 font-heading text-ds-label text-ds-text-dim">Tournaments</p>
            <ul className="m-0 mt-4 list-none space-y-5 p-0">
              {FORMATS.map((f) => (
                <li key={f.key}>
                  <Link href={FORMAT_HREFS[f.key]} className="ds-link font-heading text-[20px] font-semibold text-white">
                    {FORMAT_NAMES[f.key]}
                  </Link>
                  <p className="m-0 mt-1 text-ds-body text-ds-text-muted">{f.line}</p>
                </li>
              ))}
            </ul>
          </div>
          {recurring.length > 0 && (
            <div className="bg-ds-surface px-7 py-7">
              <p className="m-0 font-heading text-ds-label text-ds-text-dim">Every week</p>
              <dl className="m-0 mt-4 space-y-5">
                {recurring.map((r) => (
                  <div key={r.id}>
                    <dt className="font-heading text-[20px] font-semibold text-white">{r.title}</dt>
                    <dd className="m-0 mt-1 font-heading text-ds-ui text-ds-text">
                      {[r.cadence, r.time].filter(Boolean).join(", ")}
                    </dd>
                    {r.description && <dd className="m-0 mt-1 text-ds-body text-ds-text-muted">{r.description}</dd>}
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="partners" className="ds-container pt-[clamp(64px,8vw,104px)]">
        <h2 id="partners" className={H2}>
          Partners.
        </h2>
        <dl className="m-0 mt-8 grid gap-px border border-ds-line bg-ds-line sm:grid-cols-2">
          <div className="bg-ds-surface px-7 py-7">
            <dt className="font-heading text-[20px] font-semibold text-white">
              {/* The venue site only serves plain http (https doesn't answer). */}
              <a href="http://gengxperience.gg/" target="_blank" rel="noreferrer" className="ds-link">
                Gen.G GGX
              </a>
            </dt>
            <dd className="m-0 mt-1 text-ds-body text-ds-text-muted">
              Partner venue in Seoul, where the in-person tournaments are played.
            </dd>
          </div>
          <div className="bg-ds-surface px-7 py-7">
            <dt className="font-heading text-[20px] font-semibold text-white">Naver Riftbound TCG cafe</dt>
            <dd className="m-0 mt-1 text-ds-body text-ds-text-muted">
              Partner community for Riftbound in Korea.
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="the-team" className="ds-container pt-[clamp(64px,8vw,104px)]">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <h2 id="the-team" className={H2}>
              The team.
            </h2>
            <p className="mb-0 mt-4 max-w-deck text-ds-deck text-ds-text-muted">
              LoLMK is run by volunteer admins and game coordinators. Meet them on the Members page.
            </p>
          </div>
          <Link href="/members" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
            Meet the team
          </Link>
        </div>
      </section>

      <section aria-labelledby="contact" className="ds-container pt-[clamp(64px,8vw,104px)]">
        <h2 id="contact" className={H2}>
          Get in touch.
        </h2>
        <ul className="m-0 mt-8 grid list-none gap-px border border-ds-line bg-ds-line p-0 md:grid-cols-3">
          {socials.map((s) => (
            <li key={s.platform} className="bg-ds-surface">
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="flex h-full flex-col gap-2 px-7 py-7 transition-colors duration-150 hover:bg-ds-surface-2"
              >
                <span className="flex items-center gap-2.5 font-heading text-[20px] font-semibold text-white">
                  {s.platform === "discord" && <DiscordIcon className="h-5 w-5" />}
                  {s.label}
                </span>
                <span className="font-heading text-ds-label text-ds-text-dim">{s.handle}</span>
                <span className="text-ds-body text-ds-text-muted">{s.description}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
