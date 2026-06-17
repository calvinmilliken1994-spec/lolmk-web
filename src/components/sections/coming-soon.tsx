import Link from "next/link";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ComingSoonProps {
  kicker: string;
  title: string;
  description: string;
  /** Optional: short bulleted points about what will be here. */
  bullets?: string[];
  /** Optional: override default Discord CTA. */
  discordCta?: { label: string; href: string };
}

export function ComingSoon({
  kicker,
  title,
  description,
  bullets,
  discordCta,
}: ComingSoonProps) {
  const cta = discordCta ?? {
    label: "Join the Discord",
    href: "https://discord.gg/lolmk",
  };

  return (
    <section className="relative overflow-hidden border-b border-line-subtle min-h-[calc(100vh-4rem)] flex items-center">
      <div aria-hidden className="absolute inset-0 grain pointer-events-none" />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[640px] w-[1200px] -translate-x-1/2 bg-gradient-to-br from-brand-red/15 via-transparent to-brand-blue/15 blur-3xl pointer-events-none"
      />

      <div className="container-wide relative py-24">
        <div className="max-w-3xl space-y-8">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="red" pulse>
              Coming soon
            </Badge>
            <Badge variant="outline">{kicker}</Badge>
          </div>

          <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
            {title}
          </h1>

          <p className="text-body-lg text-ink-secondary max-w-[55ch]">
            {description}
          </p>

          {bullets && bullets.length > 0 && (
            <ul className="space-y-3 max-w-[55ch]">
              {bullets.map((b) => (
                <li
                  key={b}
                  className="flex gap-3 text-body-md text-ink-secondary"
                >
                  <span aria-hidden className="text-brand-red mt-1">
                    ▸
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a
              href={cta.href}
              target={cta.href.startsWith("http") ? "_blank" : undefined}
              rel={cta.href.startsWith("http") ? "noreferrer" : undefined}
              className={cn(buttonVariants({ variant: "primary", size: "lg" }))}
            >
              <MessageCircle strokeWidth={1.5} className="h-5 w-5" />
              {cta.label}
            </a>
            <Link
              href="/"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
            >
              <ArrowLeft strokeWidth={1.5} className="h-5 w-5" />
              Back to home
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
