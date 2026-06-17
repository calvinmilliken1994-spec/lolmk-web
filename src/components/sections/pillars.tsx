import Link from "next/link";
import { ArrowRight, Trophy, Users, BookOpen } from "lucide-react";
import { Card, CardKicker, CardTitle, CardBody } from "@/components/ui/card";

const PILLARS = [
  {
    href: "/tournaments",
    kicker: "Compete",
    title: "Tournaments",
    body: "Quarterly tournaments, weekly in-houses, and ranked flex nights. Find a team that talks back.",
    icon: Trophy,
  },
  {
    href: "/members",
    kicker: "Connect",
    title: "Members",
    body: "Streamers, content creators, captains, and the regulars you'll see at every meetup.",
    icon: Users,
  },
  {
    href: "/how-tos",
    kicker: "Get on KR",
    title: "How-tos",
    body: "Make a KR account from abroad. Switch to English. Buy RP. Find a PC bang. We've done it; here's how.",
    icon: BookOpen,
  },
];

export function Pillars() {
  return (
    <section className="container-wide py-24">
      <div className="mb-12 max-w-3xl">
        <p className="text-label uppercase text-ink-muted mb-4">Three pillars</p>
        <h2 className="font-heading text-display-md text-ink">
          What you actually do here
        </h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PILLARS.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <Link href={pillar.href} key={pillar.href} className="group">
              <Card interactive className="h-full flex flex-col gap-6 p-8">
                <Icon strokeWidth={1.5} className="h-8 w-8 text-brand-red" />
                <div className="space-y-3">
                  <CardKicker>{pillar.kicker}</CardKicker>
                  <CardTitle>{pillar.title}</CardTitle>
                  <CardBody>{pillar.body}</CardBody>
                </div>
                <div className="mt-auto flex items-center gap-2 text-body-sm text-ink-secondary group-hover:text-brand-red-bright transition-colors">
                  <span>Open</span>
                  <ArrowRight strokeWidth={1.5} className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
