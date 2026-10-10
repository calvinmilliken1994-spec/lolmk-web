import Link from "next/link";
import { PageHeader } from "@/components/ds/page-header";
import { statCells } from "@/components/ds/stat-strip";
import { pageMetadata } from "@/lib/metadata";
import { formatLastChecked, getGuides, latestLastChecked } from "@/lib/how-tos";

export const metadata = pageMetadata({
  title: "How-tos",
  description:
    "Guides for playing on the Korean LoL server: making an account, switching the client to English, buying RP, and PC bangs.",
  path: "/how-tos",
});

export default function HowTosPage() {
  const guides = getGuides();
  const first = guides[0];
  return (
    <>
      <PageHeader
        tag="How-tos"
        title="The KR survival guide."
        deck="Everything we've answered ten times in Discord, written down once. Practical, English-first, written by people who've done it."
        stats={statCells([
          { k: "Guides", v: String(guides.length) },
          { k: "Last checked", v: latestLastChecked() },
          { k: "New to KR? Start with", v: first?.title ?? null, href: first ? `/how-tos/${first.slug}` : undefined },
          { k: "Missing a guide?", v: "Suggest one in Discord", href: "https://discord.gg/lolmk" },
        ]).map((c) => (c.href ? { ...c, v: <span className="font-heading text-ds-ui-lg font-semibold normal-case">{c.v}</span> } : c))}
      />

      <section aria-label="Guides" className="ds-container">
        <ol className="m-0 list-none border-t border-ds-line p-0">
          {guides.map((g, i) => {
            const checked = formatLastChecked(g.lastChecked);
            return (
              <li key={g.slug} className="border-b border-ds-line">
                <Link
                  href={`/how-tos/${g.slug}`}
                  className="group grid grid-cols-[56px_minmax(0,1fr)] gap-x-5 gap-y-2 py-7 transition-colors duration-150 hover:bg-ds-surface sm:grid-cols-[88px_minmax(0,1fr)_auto] sm:items-center sm:px-4"
                >
                  <span className="row-span-2 font-display text-[56px] leading-none text-ds-text-dim transition-colors group-hover:text-ds-red sm:row-span-1 sm:text-[72px]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-heading text-[24px] font-semibold leading-tight text-white">
                      {g.title}
                    </span>
                    <span className="mt-1.5 block text-ds-body text-ds-text-muted">{g.summary}</span>
                  </span>
                  <span className="col-start-2 flex flex-wrap gap-x-5 font-heading text-ds-label text-ds-text-dim sm:col-start-3 sm:flex-col sm:items-end sm:gap-1">
                    <span>{g.readTimeMinutes} min read</span>
                    {checked && <span>Checked {checked}</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
        <p className="mb-0 mt-10 max-w-[60ch] text-ds-body text-ds-text-muted">
          Something here wrong or out of date? Say so in the LoLMK Discord. That&apos;s where these
          guides come from.
        </p>
      </section>
    </>
  );
}
