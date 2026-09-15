import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { TimerPageClient } from "@/components/sections/timer-page-client";

export const metadata = {
  title: "Tournament Timer",
  description: "Round timer for LoLMK tournaments and events.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function TimerPage() {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/timer");

  return <TimerPageClient />;
}
