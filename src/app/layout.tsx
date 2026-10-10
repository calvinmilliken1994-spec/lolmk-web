import { Suspense } from "react";
import type { Metadata } from "next";
import { Inter, Space_Grotesk, Bebas_Neue, Chakra_Petch } from "next/font/google";
import { Header } from "@/components/layout/header";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { CountUp } from "@/components/motion/count-up";
import { NavProgress } from "@/components/motion/nav-progress";
import { SectionWipe } from "@/components/motion/section-wipe";
import { getMemberSession } from "@/lib/discord-auth";
import { rootMetadata } from "@/lib/metadata";
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

export const metadata: Metadata = rootMetadata;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const member = await getMemberSession();
  return (
    <html
      lang="en"
      // The inline script below adds .lolmk-cursor before hydration (no cursor
      // flash), so the server and client class lists differ on purpose. Only
      // this element's own attributes are exempt; children still warn.
      suppressHydrationWarning
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
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        <main className="pt-16">{children}</main>
        <SectionWipe />
        <CountUp />
        <ConditionalFooter />
      </body>
    </html>
  );
}
