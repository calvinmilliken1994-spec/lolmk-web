import type { MetadataRoute } from "next";

const BASE_URL = "https://lolmk.gg";

// Static, substantive, publicly indexable routes only. Excluded on purpose:
// auth/session pages (/tools, /captain, /locker, /members/profile, /api/*), the
// dev-only bracket previews (/tournaments/preview*), and /design-preview/*
// (throwaway reskin mockups, never meant to be crawled).
const STATIC_ROUTES: { path: string; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: "/tournaments", changeFrequency: "daily", priority: 0.9 },
  { path: "/tournaments/summoners-rift", changeFrequency: "daily", priority: 0.8 },
  { path: "/tournaments/aram", changeFrequency: "weekly", priority: 0.7 },
  { path: "/tournaments/riftbound", changeFrequency: "monthly", priority: 0.3 },
  { path: "/how-tos", changeFrequency: "monthly", priority: 0.8 },
  { path: "/how-tos/make-kr-account", changeFrequency: "monthly", priority: 0.7 },
  { path: "/how-tos/client-english", changeFrequency: "monthly", priority: 0.7 },
  { path: "/how-tos/buy-rp", changeFrequency: "monthly", priority: 0.7 },
  { path: "/how-tos/pc-bang", changeFrequency: "monthly", priority: 0.7 },
  { path: "/members", changeFrequency: "weekly", priority: 0.5 },
  { path: "/about", changeFrequency: "monthly", priority: 0.5 },
];

/**
 * No lastModified is set for these — we don't have real per-page edit
 * timestamps (no CMS/git-derived dates wired up), and stamping "now" on
 * every build would be a lie search engines increasingly discount anyway.
 * Omitting the field is honest; add real dates once a source of truth
 * exists (e.g. a content "last checked" field already shown on the how-to
 * pages could feed this later).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return STATIC_ROUTES.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
