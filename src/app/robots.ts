import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/tools",
          "/tools/",
          "/captain",
          "/captain/",
          "/members/profile",
          "/mayhemlive",
        ],
      },
    ],
    sitemap: "https://lolmk.gg/sitemap.xml",
  };
}
