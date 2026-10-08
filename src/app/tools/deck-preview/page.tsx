import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isToolsSession } from "@/lib/tools-auth";
import { DeckPreviewClient } from "./deck-preview-client";

// TODO(control-deck): delete /tools/deck-preview (this folder) once the
// Riftbound desk is built on DeckShell. It only exists to compare the kit
// against docs/design/control-deck-v2/screens/desk-round-live.html at
// 1440x1000, using mock data. No real tool is wired up here.

export const metadata: Metadata = {
  title: "Control deck preview",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function DeckPreviewPage() {
  const signedIn = await isToolsSession();
  if (!signedIn) redirect("/tools/login?next=/tools/deck-preview");
  return <DeckPreviewClient />;
}
