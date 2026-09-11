import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { TournamentTimer } from "@/components/sections/tournament-timer";
import { getPoroCupSchedule } from "@/lib/poro-cup";

export const metadata = {
  title: "Poro Cup Timer",
  description:
    "Round timer for the LoLMK Poro Cup, the Riftbound: League of Legends TCG tournament.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TimerPage() {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/timer");

  const schedule = getPoroCupSchedule();
  return <TournamentTimer schedule={schedule} />;
}
