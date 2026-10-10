"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Navigation feedback for client-side route changes:
 *
 * - a 2px red progress bar fixed to the top, shown only once a navigation
 *   has taken longer than 120ms, so fast navigations don't flash;
 * - aria-busy on <main> for as long as the navigation is pending.
 *
 * A navigation starts on a same-origin link click (or back/forward) and ends
 * when the pathname or search params change.
 */
const SHOW_AFTER_MS = 120;

function isPlainLeftClick(e: MouseEvent): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented;
}

export function NavProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    const main = () => document.querySelector("main");
    const start = () => {
      if (pending.current) return;
      pending.current = true;
      main()?.setAttribute("aria-busy", "true");
      timer.current = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    };
    const onClick = (e: MouseEvent) => {
      if (!isPlainLeftClick(e)) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname.startsWith("/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      start();
    };
    const onPop = () => start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    pending.current = false;
    document.querySelector("main")?.removeAttribute("aria-busy");
    setVisible(false);
  }, [pathname, searchParams]);

  if (!visible) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px]">
      <div className="h-full origin-left animate-ds-progress bg-ds-red motion-reduce:scale-x-50 motion-reduce:animate-none" />
    </div>
  );
}
