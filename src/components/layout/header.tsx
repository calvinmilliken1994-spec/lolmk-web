"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, BadgeCheck, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/tournaments", label: "Tournaments" },
  { href: "/members", label: "Members" },
  { href: "/how-tos", label: "How-tos" },
  { href: "/shop", label: "Shop" },
  { href: "/about", label: "About" },
];

interface HeaderMemberState {
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export function Header({ member }: { member?: HeaderMemberState | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const loginHref = `/api/auth/member/login?next=${encodeURIComponent(pathname || "/members")}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-40 h-16 transition-colors duration-150",
          scrolled
            ? "bg-base/85 backdrop-blur-md border-b border-line-subtle"
            : "bg-transparent",
        )}
      >
        <div className="container-wide flex h-full items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-3 group"
            aria-label="LoLMK home"
          >
            <Image
              src="/logo.svg"
              alt=""
              width={36}
              height={36}
              priority
              className="h-9 w-9"
            />
            <span className="font-display text-heading-lg tracking-wide text-ink group-hover:text-brand-red-bright transition-colors">
              LoLMK
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 text-body-md font-medium text-ink-secondary hover:text-ink transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="hidden lg:flex items-center gap-3">
            {member ? (
              <>
                {member.isAdmin && (
                  <Link
                    href="/tools"
                    className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                  >
                    <ShieldCheck strokeWidth={1.5} className="h-4 w-4" />
                    Admin Tools
                  </Link>
                )}
                <Link
                  href="/members/profile"
                  className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "pl-2")}
                >
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt=""
                      width={24}
                      height={24}
                      className="h-6 w-6 rounded-full"
                    />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-elevated" aria-hidden />
                  )}
                  Profile
                </Link>
              </>
            ) : (
              <a
                href={loginHref}
                className={cn(buttonVariants({ variant: "discord", size: "sm" }))}
              >
                <DiscordIcon className="h-5 w-5" />
                Verified members login
                <BadgeCheck strokeWidth={2} className="h-4 w-4 text-success" />
              </a>
            )}
          </div>

          <button
            type="button"
            className="lg:hidden p-2 text-ink"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu strokeWidth={1.5} className="h-6 w-6" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-base lg:hidden flex flex-col">
          <div className="container-wide h-16 flex items-center justify-between">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3"
            >
              <Image src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
              <span className="font-display text-heading-lg text-ink">LoLMK</span>
            </Link>
            <button
              type="button"
              className="p-2 text-ink"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X strokeWidth={1.5} className="h-6 w-6" />
            </button>
          </div>
          <nav className="flex-1 container-wide flex flex-col justify-start gap-2 pt-12">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="font-heading text-display-sm text-ink py-3 border-b border-line-subtle hover:text-brand-red-bright transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://discord.gg/lolmk"
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: "discord", size: "lg" }), "mt-8 w-full")}
            >
              <DiscordIcon className="h-6 w-6" />
              Log in with Discord
              <BadgeCheck strokeWidth={2} className="h-5 w-5 text-success" />
            </a>
          </nav>
        </div>
      )}
    </>
  );
}
