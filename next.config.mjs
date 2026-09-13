/** @type {import('next').NextConfig} */
const nextConfig = (phase) => ({
  reactStrictMode: true,
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
