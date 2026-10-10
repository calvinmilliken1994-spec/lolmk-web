import type { Metadata } from "next";

/**
 * Per-route metadata. Next merges `openGraph` shallowly: a page that sets
 * `title` but no `openGraph` inherits the root's og:title, which is how every
 * subpage used to unfurl as the homepage in Discord and Kakao. Every public
 * route builds its metadata through this helper so title, description,
 * og:title, og:description and the share image always travel together.
 */

export const SITE_NAME = "LoLMK";
export const SITE_URL = "https://lolmk.gg";
export const SITE_DESCRIPTION =
  "The largest English-speaking League of Legends community in Korea. Tournaments, in-houses, meetups, and how-tos for playing on KR.";

const DEFAULT_IMAGE = { url: "/logo.png", width: 1044, height: 1044, alt: "LoLMK logo" };

export interface PageMetadataInput {
  /** Page title without the site suffix; the root template appends it. */
  title: string;
  description: string;
  /** Canonical path, e.g. "/tournaments". */
  path?: string;
  /** Keep operator, auth and preview surfaces out of search results. */
  noindex?: boolean;
  /**
   * Set when the route ships its own `opengraph-image`. Next only fills in a
   * file-based image when `openGraph.images` is left undefined.
   */
  hasOwnImage?: boolean;
}

export function pageMetadata({
  title,
  description,
  path,
  noindex,
  hasOwnImage,
}: PageMetadataInput): Metadata {
  const ogTitle = `${title} | ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: path ? { canonical: path } : undefined,
    openGraph: {
      title: ogTitle,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      ...(hasOwnImage ? {} : { images: [DEFAULT_IMAGE] }),
    },
    twitter: {
      card: hasOwnImage ? "summary_large_image" : "summary",
      title: ogTitle,
      description,
      ...(hasOwnImage ? {} : { images: [DEFAULT_IMAGE.url] }),
    },
    robots: noindex ? { index: false, follow: false } : undefined,
  };
}

/** Root defaults; the homepage uses these as-is. */
export const rootMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: "/",
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    images: [DEFAULT_IMAGE],
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [DEFAULT_IMAGE.url],
  },
  icons: {
    icon: "/logo.svg",
  },
};
