import Link from "next/link";
import { ArrowRight, Twitch, Youtube, Instagram, Twitter } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Member, MemberSocial } from "@/types/member";

interface FeaturedMembersProps {
  members: Member[];
}

function SocialIcon({ platform }: { platform: MemberSocial["platform"] }) {
  const icons = {
    twitch: Twitch,
    youtube: Youtube,
    instagram: Instagram,
    twitter: Twitter,
    discord: Twitch,
  } as const;
  const Icon = icons[platform];
  return <Icon strokeWidth={1.5} className="h-4 w-4" />;
}

export function FeaturedMembers({ members }: FeaturedMembersProps) {
  return (
    <section className="container-wide py-24">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
        <div className="max-w-2xl">
          <p className="text-label uppercase text-ink-muted mb-4">Who&apos;s around</p>
          <h2 className="font-heading text-display-md text-ink">Featured members</h2>
          <p className="mt-4 text-body-md text-ink-secondary">
            Streamers, content creators, and community leaders you&apos;ll see in
            voice chat and at meetups. The full directory has everyone.
          </p>
        </div>
        <Link
          href="/members"
          className="text-body-sm text-ink-secondary hover:text-ink inline-flex items-center gap-2"
        >
          Browse all members
          <ArrowRight strokeWidth={1.5} className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {members.map((member) => (
          <Card key={member.slug} interactive className="p-5 flex flex-col gap-4 group">
            <div className="aspect-square bg-elevated border border-line-subtle flex items-center justify-center">
              <span className="font-display text-display-sm text-ink-muted leading-none">
                {member.ign.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="space-y-2">
              <Badge
                variant={member.role === "Streamer" ? "red" : member.role === "Community Leader" ? "blue" : "default"}
              >
                {member.role}
              </Badge>
              <p className="font-heading text-heading-md text-ink leading-tight">
                {member.ign}
              </p>
              {member.rank && (
                <p className="text-caption font-mono text-ink-muted">{member.rank}</p>
              )}
            </div>
            <p className="text-body-sm text-ink-secondary line-clamp-2">{member.blurb}</p>
            <div className="mt-auto flex items-center gap-2">
              {member.socials.map((social) => (
                <a
                  key={social.platform + social.handle}
                  href={social.href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${member.ign} on ${social.platform}`}
                  className="text-ink-muted hover:text-brand-red-bright transition-colors"
                >
                  <SocialIcon platform={social.platform} />
                </a>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}
