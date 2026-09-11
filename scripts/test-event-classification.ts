import assert from "node:assert/strict";

import { getDiscordEvents } from "../src/lib/discord-events";
import { classifyEvent } from "../src/lib/event-format";

process.env.DISCORD_BOT_TOKEN = "test-token";

const scheduledEvents = [
  {
    id: "watch-party",
    guild_id: "guild-1",
    name: "Gen.G GGX Hosted LCK Finals Watch Party",
    description: "Join us to watch the LCK Finals Watch Party!",
    scheduled_start_time: "2026-09-13T11:30:00+09:00",
    scheduled_end_time: null,
    status: 1,
    entity_type: 3,
    entity_metadata: { location: "Gen.G GGX" },
  },
  {
    id: "pre-tournament-meetup",
    guild_id: "guild-1",
    name: "Last GGX cup grind",
    description: "In preparation for the big tournament on the 20th we plan to have a meetup.",
    scheduled_start_time: "2026-09-19T16:00:00+09:00",
    scheduled_end_time: null,
    status: 1,
    entity_type: 3,
    entity_metadata: { location: "Hobby Game mall Jongro" },
  },
  {
    id: "tournament",
    guild_id: "guild-1",
    name: "GGX Riftbound Tournament",
    description: "RSVP and info",
    scheduled_start_time: "2026-09-20T12:00:00+09:00",
    scheduled_end_time: null,
    status: 1,
    entity_type: 3,
    entity_metadata: { location: "GGX Riftbound Tournament (Official Partner Tournament)" },
  },
];

globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  if (url.includes("/invites/")) {
    return new Response(JSON.stringify({ guild: { id: "guild-1" } }), { status: 200 });
  }
  if (url.includes("/scheduled-events")) {
    return new Response(JSON.stringify(scheduledEvents), { status: 200 });
  }
  throw new Error(`Unexpected URL: ${url}`);
}) as typeof fetch;

async function main() {
  const events = await getDiscordEvents();
  assert.ok(events);

  const watchParty = events.find((event) => event.id === "watch-party");
  assert.ok(watchParty);
  assert.equal(watchParty.kind, "watch-party");
  assert.equal(classifyEvent(watchParty).label, "Meetup");

  assert.equal(events.find((event) => event.id === "pre-tournament-meetup")?.kind, "meetup");
  const tournament = events.find((event) => event.id === "tournament");
  assert.ok(tournament);
  assert.equal(tournament.kind, "tournament");
  assert.equal(classifyEvent(tournament).label, "Tournament");

  console.log("Event classification checks passed.");
}

void main();
