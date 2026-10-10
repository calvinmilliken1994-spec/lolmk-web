import Link from "next/link";
import Image from "next/image";
import { CursorToggle } from "@/components/layout/cursor-toggle";

const COLUMNS: { title: string; links: { label: string; href: string; external?: boolean }[] }[] = [
  {
    title: "Community",
    links: [
      { label: "Discord", href: "https://discord.gg/lolmk", external: true },
      { label: "KakaoTalk", href: "https://open.kakao.com/o/gIPbdi3e", external: true },
      { label: "Instagram", href: "https://instagram.com/lolmeetupkorea", external: true },
    ],
  },
  {
    title: "Site",
    links: [
      { label: "Tournaments", href: "/tournaments" },
      { label: "Members", href: "/members" },
      { label: "How-tos", href: "/how-tos" },
      { label: "About", href: "/about" },
    ],
  },
  {
    title: "On KR",
    links: [
      { label: "Make a KR account", href: "/how-tos/make-kr-account" },
      { label: "Switch client to English", href: "/how-tos/client-english" },
      { label: "Buy RP in Korea", href: "/how-tos/buy-rp" },
      { label: "PC bang guide", href: "/how-tos/pc-bang" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line-subtle bg-base mt-24">
      <div className="container-wide py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="LoLMK" width={40} height={40} className="h-10 w-10" />
              <span className="font-display text-heading-lg text-ink">LoLMK</span>
            </div>
            <p className="text-body-sm text-ink-muted max-w-[28ch]">
              English-speaking League of Legends community in Korea. Tournaments, in-houses,
              meetups in Seoul.
            </p>
          </div>

          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-label text-ink-muted uppercase mb-4">{col.title}</p>
              <ul className="space-y-3">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.external ? (
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-body-sm text-ink-secondary hover:text-ink transition-colors"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-body-sm text-ink-secondary hover:text-ink transition-colors"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-8 border-t border-line-subtle flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <p className="text-caption text-ink-muted">
              © {new Date().getFullYear()} LoLMK. Not affiliated with Riot Games or LCK.
            </p>
            {/* Notice required by Riot's Legal Jibber Jabber policy (champion art on /members). */}
            <p className="max-w-[72ch] text-caption text-ink-muted">
              LoLMK was created under Riot Games&apos; &ldquo;Legal Jibber Jabber&rdquo; policy using
              assets owned by Riot Games. Riot Games does not endorse or sponsor this project.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <CursorToggle />
            <p className="text-caption text-ink-muted font-mono">
              Seoul, KR
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
