/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      { protocol: "https", hostname: "feeds.behold.so" },
      { protocol: "https", hostname: "**.behold.so" },
      { protocol: "https", hostname: "behold.pictures" },
      { protocol: "https", hostname: "**.behold.pictures" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
    ],
  },
};

export default nextConfig;
