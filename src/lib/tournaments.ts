import preview12 from "@/data/tournament-preview.json";
import preview8 from "@/data/tournament-preview-8.json";
import preview16 from "@/data/tournament-preview-16.json";
import type { TournamentFull } from "@/types/tournament";

// PLACEHOLDER PHASE: data comes from static JSON files in the repo.
// When the bot's HTTP API ships, this helper swaps to:
//   fetch(`${process.env.BOT_API_URL}/api/tournaments/${slug}`, { ... })
// with the same return shape. Pages calling getTournamentBySlug stay
// identical.

const previews: Record<string, TournamentFull> = {
  preview: preview12 as TournamentFull,
  "preview-8": preview8 as TournamentFull,
  "preview-16": preview16 as TournamentFull,
};

export async function getTournamentBySlug(
  slug: string,
): Promise<TournamentFull | null> {
  return previews[slug] ?? null;
}

export async function listTournaments(): Promise<TournamentFull["tournament"][]> {
  return Object.values(previews).map((p) => p.tournament);
}
