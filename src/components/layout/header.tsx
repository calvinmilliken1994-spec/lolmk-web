"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, X, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { href: "/tournaments", label: "Tournaments" },
  { href: "/members", label: "Members" },
  { href: "/how-tos", label: "How-tos" },
  { href: "/about", label: "About" },
];

/** Active for the section root and everything under it. */
function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Where the signed-in avatar goes. */
const MEMBER_HOME = "/members/profile";

interface HeaderMemberState {
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export function Header({ member }: { member?: HeaderMemberState | null }) {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  // One sign-in route everywhere, returning to the exact page (path, query
  // and hash) the visitor started from. usePathname() drops the query, so the
  // full location is read on the client after navigation.
  const [returnTo, setReturnTo] = useState(pathname || "/");
  useEffect(() => {
    setReturnTo(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  }, [pathname]);
  const loginHref = `/api/auth/member/login?next=${encodeURIComponent(returnTo)}`;

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
          "fixed inset-x-0 top-0 z-40 h-16 border-b transition-colors duration-150",
          // Transparent over the homepage hero until scrolled; solid ground
          // with a line-soft border everywhere else. No blur (no glassmorphism).
          scrolled || pathname !== "/"
            ? "border-ds-line-soft bg-ds-ground"
            : "border-transparent bg-transparent",
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

          <nav aria-label="Main" className="hidden lg:flex items-center gap-7 self-stretch">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full items-center font-heading text-ds-ui transition-colors duration-150",
                    active
                      ? "text-white shadow-[inset_0_-2px_0_#BA263C]"
                      : "text-ds-text-muted hover:text-white",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
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
                  href={MEMBER_HOME}
                  aria-label={`Your profile (${member.displayName})`}
                  className="flex h-11 w-11 items-center justify-center"
                >
                  {member.avatarUrl ? (
                    <Image
                      src={member.avatarUrl}
                      alt=""
                      width={44}
                      height={44}
                      className="cut-avatar h-11 w-11 object-cover"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="cut-avatar flex h-11 w-11 items-center justify-center bg-ds-line-soft font-display text-ds-tag text-ds-text"
                    >
                      {member.displayName.slice(0, 1)}
                    </span>
                  )}
                </Link>
              </>
            ) : (
              <a
                href={loginHref}
                className={cn(buttonVariants({ variant: "discord", size: "sm" }), "px-5")}
              >
                <DiscordIcon className="h-5 w-5" />
                Sign in with Discord
              </a>
            )}
          </div>

          <button
            type="button"
            className="lg:hidden flex h-11 w-11 items-center justify-center text-ds-text"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
          >
            <Menu strokeWidth={1.5} className="h-6 w-6" />
          </button>
        </div>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 bg-ds-ground lg:hidden flex flex-col">
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
              className="flex h-11 w-11 items-center justify-center text-ds-text"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X strokeWidth={1.5} className="h-6 w-6" />
            </button>
          </div>
          <nav aria-label="Main" className="flex-1 container-wide flex flex-col justify-start gap-2 pt-12">
            {NAV_LINKS.map((link) => {
              const active = isActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "font-display text-[44px] leading-none py-3 border-b border-ds-line-soft transition-colors",
                    active ? "text-white" : "text-ds-text-muted hover:text-white",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            {member ? (
              <>
                {member.isAdmin && (
                  <Link
                    href="/tools"
                    onClick={() => setMobileOpen(false)}
                    className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "mt-8 w-full")}
                  >
                    <ShieldCheck strokeWidth={1.5} className="h-5 w-5" />
                    Admin Tools
                  </Link>
                )}
                <Link
                  href={MEMBER_HOME}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    buttonVariants({ variant: "secondary", size: "lg" }),
                    "w-full",
                    member.isAdmin ? "mt-3" : "mt-8",
                  )}
                >
                  Profile
                </Link>
              </>
            ) : (
              <a
                href={loginHref}
                className={cn(buttonVariants({ variant: "discord", size: "lg" }), "mt-8 w-full")}
              >
                <DiscordIcon className="h-6 w-6" />
                Sign in with Discord
              </a>
            )}
          </nav>
        </div>
      )}
    </>
  );
}
