import Link from "next/link";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ds/page-header";
import { statCells } from "@/components/ds/stat-strip";
import { cn } from "@/lib/utils";
import { formatLastChecked, getGuide, getGuides, guideNumber } from "@/lib/how-tos";

/**
 * Article shell for a how-to: PageHeader, then the article beside a sticky
 * table of contents (desktop only), then a link to the next guide in the
 * sequence. The article body keeps each guide's own structure.
 */
export function GuideLayout({ slug, children }: { slug: string; children: ReactNode }) {
  const guide = getGuide(slug);
  if (!guide) throw new Error(`Unknown guide: ${slug}`);
  const guides = getGuides();
  const n = guideNumber(slug);
  const next = guides[n] ?? null;

  return (
    <>
      <PageHeader
        tag="How-tos"
        title={guide.headline}
        deck={guide.deck}
        stats={statCells([
          { k: "Guide", v: `${n} of ${guides.length}` },
          { k: "Read time", v: `${guide.readTimeMinutes} min` },
          { k: "Last checked", v: formatLastChecked(guide.lastChecked) },
        ])}
        actions={
          <Link href="/how-tos" className={cn(buttonVariants({ variant: "outline", size: "md" }))}>
            All guides
          </Link>
        }
      />
      <div className="ds-container lg:grid lg:grid-cols-[minmax(0,1fr)_240px] lg:gap-12">
        <article className="min-w-0 [&>section]:scroll-mt-24 [&>section]:px-0">{children}</article>
        {guide.toc.length > 1 && (
          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24 border-l border-ds-line pl-5 pt-16">
              <p className="m-0 font-heading text-ds-label text-ds-text-dim">On this page</p>
              <ol className="m-0 mt-3 list-none space-y-1 p-0">
                {guide.toc.map((t) => (
                  <li key={t.id}>
                    <a
                      href={`#${t.id}`}
                      className="ds-link flex min-h-11 items-center font-heading text-ds-ui text-ds-text-muted hover:text-white"
                    >
                      {t.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        )}
      </div>
      {next && (
        <section aria-label="Next guide" className="ds-container pt-6">
          <Link
            href={`/how-tos/${next.slug}`}
            className="cut-plate group flex flex-wrap items-center justify-between gap-4 border border-ds-line bg-ds-surface px-8 py-7 transition-colors duration-150 hover:border-ds-line-strong"
          >
            <span>
              <span className="block font-heading text-ds-label text-ds-text-dim">Next guide</span>
              <span className="mt-1 block font-heading text-[24px] font-semibold text-white">{next.title}</span>
            </span>
            <span className="font-display text-[56px] leading-none text-ds-text-dim group-hover:text-ds-text">
              {String(n + 1).padStart(2, "0")}
            </span>
          </Link>
        </section>
      )}
    </>
  );
}

/** Framed screenshot: 1px line border, surface padding, caption. */
export function GuideFigure({ children, caption }: { children: ReactNode; caption: ReactNode }) {
  return (
    <figure className="m-0 mt-6 max-w-[600px] border border-ds-line bg-ds-surface p-3">
      {children}
      <figcaption className="mt-3 px-1 text-[13px] text-ds-text-muted">{caption}</figcaption>
    </figure>
  );
}
