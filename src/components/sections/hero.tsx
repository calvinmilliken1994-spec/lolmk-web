import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon, KakaoTalkIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

interface HeroProps {
  nextEventLabel: string;
  nextEventIsLive: boolean;
  /** Live Discord presence count ("186"), or null / "—" when unknown. */
  discordOnline: string | null;
}

export function Hero({ nextEventLabel, nextEventIsLive, discordOnline }: HeroProps) {
  const hasPresence = Boolean(discordOnline && discordOnline !== "—");
  return (
    <section className="relative overflow-hidden border-b border-line-subtle">
      <div
        aria-hidden
        className="absolute inset-0 grain pointer-events-none"
      />
      <div
        aria-hidden
        className="absolute -top-40 left-1/2 h-[640px] w-[1200px] -translate-x-1/2 bg-gradient-to-br from-brand-red/15 via-transparent to-brand-blue/15 blur-3xl pointer-events-none"
      />
      <div className="container-wide relative pt-24 pb-32 md:pt-32 md:pb-40">
        <div className="grid lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-8">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="red" pulse={nextEventIsLive}>
                {nextEventIsLive ? "Live" : "Next event"} · {nextEventLabel}
              </Badge>
            </div>

            <h1 className="font-display text-display-lg md:text-display-xl text-ink leading-[0.95]">
              Global League
              <br />
              of Legends
              <br />
              community in
              <br />
              <span className="text-brand-red">Korea.</span>
            </h1>

            <p className="text-body-lg text-ink-secondary max-w-[52ch]">
              League of Legends | Valorant | 2XKO | TFT
              Inhouses | Tournaments | Watch Parties | Meetups
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="https://discord.gg/lolmk"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "discord", size: "lg" }))}
              >
                <DiscordIcon className="h-10 w-10" />
                <span className="flex flex-col items-start leading-tight">
                  <span>Join the Discord</span>
                  {hasPresence && (
                    <span className="flex items-center gap-1.5 text-caption font-mono normal-case opacity-90">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-success" />
                      {discordOnline} online now
                    </span>
                  )}
                </span>
              </a>
              <a
                href="https://open.kakao.com/o/gIPbdi3e"
                target="_blank"
                rel="noreferrer"
                className={cn(buttonVariants({ variant: "kakao", size: "lg" }))}
              >
                <KakaoTalkIcon className="h-10 w-10" />
                Message us on Kakao
              </a>
            </div>

          </div>

          <div className="lg:col-span-5">
            <div className="relative aspect-square max-w-[420px] mx-auto">
              <div className="absolute inset-0 bg-gradient-to-br from-brand-red/30 via-transparent to-brand-blue/30 blur-2xl" />
              <Image
                src="/logo.svg"
                alt="LoLMK shield logo with the Taegeuk hairband mascot"
                fill
                priority
                sizes="(max-width: 1024px) 80vw, 420px"
                className="relative drop-shadow-[0_8px_30px_rgba(186,38,60,0.35)]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
