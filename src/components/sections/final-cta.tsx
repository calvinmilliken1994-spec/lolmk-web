import { buttonVariants } from "@/components/ui/button";
import { DiscordIcon, KakaoTalkIcon } from "@/components/ui/brand-icons";
import { cn } from "@/lib/utils";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden border-y border-line-subtle">
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-br from-brand-red/15 via-base to-brand-blue/15 pointer-events-none"
      />
      <div className="container-wide relative py-32 text-center flex flex-col items-center gap-8">
        <p className="text-label uppercase text-ink-muted">Ready when you are</p>
        <h2 className="font-display text-display-lg md:text-display-xl text-ink max-w-[14ch]">
          Built for the <span className="text-brand-red">KR grind.</span>
        </h2>
        <p className="text-body-lg text-ink-secondary max-w-[55ch]">
          Skip the search for English-speaking lobbies. Hop in, find duos, run scrims,
          watch LCK with people who actually care.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <a
            href="https://discord.gg/lolmk"
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants({ variant: "discord", size: "lg" }))}
          >
            <DiscordIcon className="h-10 w-10" />
            Join the Discord
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
    </section>
  );
}
