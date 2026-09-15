"use client";

import { usePathname } from "next/navigation";
import { Footer } from "@/components/layout/footer";

// Admin-facing /tools routes don't need the public site footer
// (community links, how-tos, socials) — it's internal tooling, not a page
// a visitor lands on.
export function ConditionalFooter() {
  const pathname = usePathname();
  const isToolsRoute = pathname === "/tools" || pathname.startsWith("/tools/");

  if (isToolsRoute) return null;

  return <Footer />;
}
