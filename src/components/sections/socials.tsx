import { ArrowUpRight, MessageCircle, Instagram } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import { Card } from "@/components/ui/card";
import type { SocialLink, SocialPlatform } from "@/types/social";

interface SocialsProps {
  socials: SocialLink[];
}

const ICONS: Record<SocialPlatform, ComponentType<SVGProps<SVGSVGElement>>> = {
  discord: MessageCircle,
  kakao: MessageCircle,
  instagram: Instagram,
  twitch: Instagram,
  youtube: Instagram,
};

const ACCENT: Record<SocialPlatform, string> = {
  discord: "text-brand-red-bright",
  kakao: "text-warning",
  instagram: "text-brand-blue-bright",
  twitch: "text-brand-red-bright",
  youtube: "text-brand-red-bright",
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
              className="block group"
            >
              <Card interactive className="h-full p-8 flex flex-col gap-6">
                <div className="flex items-start justify-between">
                  <Icon strokeWidth={1.5} className={`h-8 w-8 ${ACCENT[social.platform]}`} />
                  <ArrowUpRight
                    strokeWidth={1.5}
                    className="h-5 w-5 text-ink-muted group-hover:text-ink transition-colors group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  />
                </div>
                <div className="space-y-2">
                  <p className="font-heading text-heading-lg text-ink">{social.label}</p>
                  {social.handle && (
                    <p className="text-caption font-mono text-ink-muted">{social.handle}</p>
                  )}
                </div>
                <p className="text-body-sm text-ink-secondary mt-auto">{social.description}</p>
              </Card>
            </a>
          );
        })}
      </div>
    </section>
  );
}
