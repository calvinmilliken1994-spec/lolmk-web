import type { ComponentType, SVGProps } from "react";
import { ArrowUpRight } from "lucide-react";
import {
  DiscordIcon,
  InstagramIcon,
  KakaoTalkIcon,
} from "@/components/ui/brand-icons";
import type { SocialLink, SocialPlatform } from "@/types/social";

interface SocialsProps {
  socials: SocialLink[];
}

// Real brand SVGs per platform. All three share the same 24×24 viewBox so
// they render at identical visual weight when sized identically.
const ICONS: Record<SocialPlatform, ComponentType<SVGProps<SVGSVGElement>>> = {
  discord: DiscordIcon,
  kakao: KakaoTalkIcon,
  instagram: InstagramIcon,
  twitch: InstagramIcon,
  youtube: InstagramIcon,
};

// Each platform's official brand color. Used to tint the icon so the card
// reads as "this is Discord" at a glance.
const ACCENT: Record<SocialPlatform, string> = {
  discord: "text-[#5865F2]",
  kakao: "text-[#FEE500]",
  instagram: "text-[#E1306C]",
  twitch: "text-[#9146FF]",
  youtube: "text-[#FF0000]",
};

export function Socials({ socials }: SocialsProps) {
  return (
    <section className="container-wide py-24">
      <div className="mb-12 max-w-2xl">
        <p className="text-label uppercase text-ink-muted mb-4">Where we are</p>
        <h2 className="font-heading text-display-md text-ink">Find us elsewhere</h2>
        <p className="mt-4 text-body-md text-ink-secondary">
          Discord is the home base. Kakao is the fastest way to reach an admin.
          Instagram is where event photos go.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {socials.map((social) => {
          const Icon = ICONS[social.platform];
          return (
            <a
              key={social.platform}
              href={social.href}
              target="_blank"
              rel="noreferrer"
              className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red focus-visible:ring-offset-2 focus-visible:ring-offset-base"
            >
              {/* Card — manually styled (rather than using <Card interactive />)
                  so all hover transitions trigger off the parent link's group
                  state and stay perfectly in sync. */}
              <div
                className="h-full p-8 flex flex-col gap-6 bg-surface border border-line transition-all duration-300 ease-out-soft will-change-transform group-hover:bg-elevated group-hover:border-line-strong group-hover:-translate-y-1 group-hover:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.5)]"
              >
                <div className="flex items-start justify-between">
                  <Icon
                    className={`h-8 w-8 shrink-0 transition-transform duration-300 ease-out-soft group-hover:scale-110 ${ACCENT[social.platform]}`}
                  />
                  <ArrowUpRight
                    strokeWidth={1.5}
                    className="h-5 w-5 text-ink-muted transition-all duration-300 ease-out-soft group-hover:text-brand-red-bright group-hover:translate-x-1 group-hover:-translate-y-1"
                  />
                </div>
                <div className="space-y-2">
                  <p className="font-heading text-heading-lg text-ink">
                    {social.label}
                  </p>
                  {social.handle && (
                    <p className="text-caption font-mono text-ink-muted transition-colors duration-300 group-hover:text-ink-secondary">
                      {social.handle}
                    </p>
                  )}
                </div>
                <p className="text-body-sm text-ink-secondary mt-auto">
                  {social.description}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
