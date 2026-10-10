/** @type {import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
  // Crawlers matched here get metadata in <head> instead of streamed into
  // <body>. Next's default list already covers Discordbot, Slackbot,
  // Twitterbot and facebookexternalhit; KakaoTalk's scraper
  // (kakaotalk-scrap) isn't on it, so Kakao link previews missed og tags on
  // every dynamic route. Keep the default list and add Kakao.
  htmlLimitedBots:
    /[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight|kakaotalk-scrap|Kakaotalk/i,
  // Separate output dirs for dev vs build: a build run while dev is live
  // (or vice versa) can no longer corrupt the other's webpack cache/manifest
  // by writing into the same .next directory.
  distDir: phase === "phase-development-server" ? ".next-dev" : ".next",
  redirects: async () => [
    // The tournament timer moved behind the admin tools wall.
    { source: "/timer", destination: "/tools/timer", permanent: false },
  ],
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "feeds.behold.so" },
      { protocol: "https", hostname: "**.behold.so" },
      { protocol: "https", hostname: "behold.pictures" },
      { protocol: "https", hostname: "**.behold.pictures" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
    ],
  },
});

export default nextConfig;
