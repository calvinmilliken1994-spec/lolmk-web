import type { ComponentType, SVGProps } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  DiscordIcon,
  InstagramIcon,
  KakaoTalkIcon,
  TwitchIcon,
  YouTubeIcon,
} from "@/components/ui/brand-icons";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SocialLink, SocialPlatform } from "@/types/social";

interface SocialsProps {
  socials: SocialLink[];
}

// Real brand marks per platform. All share the same 24×24 viewBox so they
// render at identical visual weight when sized identically.
const ICONS: Record<SocialPlatform, ComponentType<SVGProps<SVGSVGElement>>> = {
  discord: DiscordIcon,
  kakao: KakaoTalkIcon,
  instagram: InstagramIcon,
  twitch: TwitchIcon,
  youtube: YouTubeIcon,
};

// Each platform's official chip: brand background + the text color the brand
// pairs it with, so a card reads as "this is Discord/Kakao/…" at a glance.
const CHIP: Record<SocialPlatform, string> = {
  discord: "bg-[#5865F2] text-white",
  kakao: "bg-[#FEE500] text-[#181600]",
  instagram: "bg-gradient-to-br from-[#F58529] via-[#DD2A7B] to-[#515BD4] text-white",
  twitch: "bg-[#9146FF] text-white",
  youtube: "bg-[#FF0000] text-white",
};

export function Socials({ socials }: SocialsProps) {
  const discord = socials.find((s) => s.platform === "discord");
  const others = socials.filter((s) => s.platform !== "discord");

  return (
    <section className="container-wide py-24">
      <div className="mb-12 max-w-2xl">
        <h2 className="font-heading text-display-md text-ink">Community links</h2>
        <p className="mt-4 text-body-md text-ink-secondary">
          Discord is the home base. Kakao is the fastest way to reach an admin.
          The rest is where the events and clips end up.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {discord && <DiscordPanel social={discord} />}
        <div className="lg:col-span-3 grid sm:grid-cols-2 gap-4 auto-rows-fr">
          {others.map((social) => (
            <SocialCard key={social.platform} social={social} />
          ))}
        </div>
      </div>
    </section>
  );
}

function DiscordPanel({ social }: { social: SocialLink }) {
  return (
    <div className="lg:col-span-2 flex flex-col gap-6 p-8 bg-brand-blue-muted border border-brand-blue">
      <div className="flex items-center gap-4">
        <span className={cn("flex h-12 w-12 items-center justify-center", CHIP.discord)}>
          <DiscordIcon className="h-6 w-6" />
        </span>
        <div>
          <p className="font-heading text-heading-lg text-ink">{social.label}</p>
          {social.handle && (
            <p className="text-caption font-mono text-ink-muted">{social.handle}</p>
          )}
        </div>
      </div>
      <p className="text-body-sm text-ink-secondary">{social.description}</p>
      <a
        href={social.href}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonVariants({ variant: "discord", size: "md" }), "mt-auto w-full")}
      >
        <DiscordIcon className="h-5 w-5" />
        Join the server
      </a>
    </div>
  );
}

function SocialCard({ social }: { social: SocialLink }) {
  const Icon = ICONS[social.platform];
  return (
    <a
      href={social.href}
      target="_blank"
      rel="noreferrer"
      className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-base"
    >
      <div className="h-full p-8 flex flex-col gap-6 bg-surface border border-line transition-all duration-300 ease-out-soft group-hover:bg-elevated group-hover:border-line-strong group-hover:-translate-y-1 group-hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]">
        <div className="flex items-start justify-between">
          <span
            className={cn(
              "flex h-11 w-11 items-center justify-center shrink-0 transition-transform duration-300 ease-out-soft group-hover:scale-105",
              CHIP[social.platform],
            )}
          >
            <Icon className="h-6 w-6" />
          </span>
          <ArrowUpRight
            strokeWidth={1.5}
            className="h-5 w-5 text-ink-muted transition-all duration-300 ease-out-soft group-hover:text-brand-red-bright group-hover:translate-x-1 group-hover:-translate-y-1"
          />
        </div>
        <div className="space-y-2">
          <p className="font-heading text-heading-lg text-ink">{social.label}</p>
          {social.handle && (
            <p className="text-caption font-mono text-ink-muted transition-colors duration-300 group-hover:text-ink-secondary">
              {social.handle}
            </p>
          )}
        </div>
        <p className="text-body-sm text-ink-secondary mt-auto">{social.description}</p>
      </div>
    </a>
  );
}
