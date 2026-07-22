import { TournamentTimer } from "@/components/sections/tournament-timer";
import { getPoroCupSchedule } from "@/lib/poro-cup";

export const metadata = {
  title: "Poro Cup Timer",
  description:
    "Round timer for the LoLMK Poro Cup — the Riftbound: League of Legends TCG tournament.",
  robots: { index: false, follow: false },
};

export default function TimerPage() {
  const schedule = getPoroCupSchedule();
  return <TournamentTimer schedule={schedule} />;
}
