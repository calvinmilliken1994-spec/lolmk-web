import type { Metadata } from "next";
import { Inter, Space_Grotesk, Bebas_Neue, Chakra_Petch } from "next/font/google";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { getMemberSession } from "@/lib/discord-auth";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const bebasNeue = Bebas_Neue({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-bebas-neue",
  display: "swap",
});

// Squared, technical, esports-native face for event-type pills, section
// kickers, and tabular labels. Replaces JetBrains Mono, whose uppercase
// tracked labels read as generic "AI-mono" scaffolding.
const chakraPetch = Chakra_Petch({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-chakra",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LoLMK — Home",
    template: "%s — LoLMK",
  },
  description:
    "The largest English-speaking League of Legends community in Korea. Tournaments, in-houses, meetups, and how-tos for playing on KR.",
  metadataBase: new URL("https://lolmk.gg"),
  openGraph: {
    title: "LoLMK — Home",
    description:
      "The largest English-speaking League of Legends community in Korea.",
    type: "website",
    locale: "en_US",
  },
  icons: {
    icon: "/logo.svg",
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const member = await getMemberSession();
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${bebasNeue.variable} ${chakraPetch.variable}`}
    >
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable.css"
        />
        <script
          // Applied before hydration so the custom cursor never flashes on/off.
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('lolmk-cursor')!=='off'){document.documentElement.classList.add('lolmk-cursor')}}catch(e){}",
          }}
        />
      </head>
      <body className="bg-base text-ink min-h-screen">
        <Header
          member={
            member
              ? { displayName: member.displayName, avatarUrl: member.avatarUrl, isAdmin: member.isAdmin }
              : null
          }
        />
        <main className="pt-16">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
