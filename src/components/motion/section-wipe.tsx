"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isAppSurface } from "@/lib/app-surfaces";

/**
 * The signature transition: an angled red clip-path sweep of about 350ms,
 * only when moving between top-level nav sections (Home, Tournaments,
 * Members, How-tos, Locker, About). Moves within a section get the default
 * fade-and-rise from app/template.tsx instead.
 *
 * It covers the content area only, so the nav stays put. Decorative, so
 * hidden from assistive tech; switched off under reduced motion.
 */
function sectionOf(pathname: string): string {
  return pathname.split("/")[1] ?? "";
}

export function SectionWipe() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  const prevPath_ = useRef<string | null>(null);
  const [run, setRun] = useState(0);

  useEffect(() => {
    const section = sectionOf(pathname);
    const prevPath = prevPath_.current;
    prevPath_.current = pathname;
    if (prev.current !== null && prev.current !== section && !isAppSurface(pathname) && !isAppSurface(prevPath)) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduce) setRun((n) => n + 1);
    }
    prev.current = section;
  }, [pathname]);

  if (run === 0) return null;
  return (
    <div
      key={run}
      aria-hidden
      onAnimationEnd={() => setRun(0)}
      className="pointer-events-none fixed inset-x-0 bottom-0 top-16 z-30 animate-ds-wipe bg-ds-red motion-reduce:hidden"
    />
  );
}
