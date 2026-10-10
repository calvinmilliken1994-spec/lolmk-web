import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { getPublicTournamentBySlug } from "@/lib/sr-db";

/**
 * Share card for a tournament, so links pasted in Discord and Kakao unfurl as
 * a graphic: the tournament name in Bebas on the red side, the champion (or
 * the bracket state) on the blue side. Test and draft tournaments 404 like
 * the page itself.
 */

export const alt = "LoLMK Summoner's Rift tournament";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const revalidate = 300;

const STATE: Record<string, string> = {
  seeding: "Seeds drawn",
  bracket_published: "Bracket live",
  in_progress: "Bracket live",
  completed: "Final result",
  archived: "Final result",
};

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [data, bebas] = await Promise.all([
    getPublicTournamentBySlug(slug).catch(() => null),
    readFile(path.join(process.cwd(), "src/assets/fonts/BebasNeue-Regular.ttf")),
  ]);

  const name = data?.tournament.name ?? "LoLMK tournaments";
  const champion = data?.tournament.champion_team_id
    ? data.teams.find((t) => t.id === data.tournament.champion_team_id)?.name ?? null
    : null;
  const state = data ? STATE[data.tournament.status] ?? null : null;
  const nameSize = name.length > 28 ? 92 : name.length > 18 ? 116 : 140;

  return new ImageResponse(
    (
      <div style={{ display: "flex", position: "relative", width: "100%", height: "100%", background: "#283D74" }}>
        {/* Diagonal right edge of the red panel: a skewed red block behind it. */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 600,
            width: 160,
            height: "100%",
            background: "#BA263C",
            transform: "skewX(-8.5deg)",
            transformOrigin: "bottom left",
          }}
        />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 700,
            height: "100%",
            padding: "56px 40px 56px 64px",
            background: "#BA263C",
          }}
        >
          <div style={{ display: "flex", fontFamily: "Bebas", fontSize: 40, color: "#FFFFFF", letterSpacing: 2 }}>
            LoLMK · Summoner&apos;s Rift
          </div>
          <div
            style={{
              display: "flex",
              fontFamily: "Bebas",
              fontSize: nameSize,
              lineHeight: 0.88,
              color: "#FFFFFF",
              textTransform: "uppercase",
            }}
          >
            {name}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-end",
            flex: 1,
            padding: "56px 64px 56px 110px",
          }}
        >
          {champion ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 30, color: "#D9B25F", fontFamily: "Bebas", letterSpacing: 2 }}>
                Champion
              </div>
              <div
                style={{
                  display: "flex",
                  fontFamily: "Bebas",
                  fontSize: champion.length > 14 ? 64 : 84,
                  lineHeight: 0.9,
                  color: "#FFFFFF",
                  textTransform: "uppercase",
                }}
              >
                {champion}
              </div>
            </div>
          ) : state ? (
            <div style={{ display: "flex", fontFamily: "Bebas", fontSize: 84, lineHeight: 0.9, color: "#FFFFFF" }}>
              {state}
            </div>
          ) : null}
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Bebas", data: bebas, style: "normal", weight: 400 }] },
  );
}
