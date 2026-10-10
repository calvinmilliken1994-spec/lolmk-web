"use client";

import { usePathname } from "next/navigation";
import { isAppSurface } from "@/lib/app-surfaces";

/**
 * Route transition (handover Phase 6). A template remounts on every
 * navigation, so page content gets the default 200ms fade with an 8px rise
 * while the header and footer (in the root layout) stay put. CSS only, and
 * off under reduced motion.
 *
 * The admin desks and venue screens are `position: fixed` full-screen
 * overlays. A transform animation on an ancestor makes that ancestor their
 * containing block (and traps their z-index), so those routes render bare.
 *
 * Next 15.5's `experimental.viewTransition` flag was checked and left off:
 * see OPEN_QUESTIONS.md.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (isAppSurface(pathname)) return <>{children}</>;
  return <div className="animate-ds-rise motion-reduce:animate-none">{children}</div>;
}
