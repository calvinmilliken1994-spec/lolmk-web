import type { CommunityEvent, EventKind } from "@/types/event";
import { DISCORD_API_BASE, DISCORD_USER_AGENT, getDiscordGuildId } from "@/lib/discord";

const STATUS_SCHEDULED = 1;
const STATUS_ACTIVE = 2;
const ENTITY_STAGE = 1;
const ENTITY_VOICE = 2;
const ENTITY_EXTERNAL = 3;

interface DiscordScheduledEvent {
  id: string;
  guild_id: string;
  name: string;
  description: string | null;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  status: number;
  entity_type: number;
  entity_metadata: { location?: string } | null;
}

// Keyword defaults for inferring event kind from a Discord event's title +
// description. Order matters — first match wins, so list more specific kinds
// before more generic ones. Add to these lists as new event vocabularies show
// up; admins shouldn't have to learn a tagging convention.
const KIND_KEYWORDS: ReadonlyArray<readonly [EventKind, readonly string[]]> = [
  ["tournament", ["tournament", "cup", "championship", "showdown", "finals", "playoff", "bracket"]],
  ["watch-party", ["watch party", "watch night", "watch-along", "watchalong", "viewing party", "screening", "broadcast"]],
  ["in-house", ["in-house", "inhouse", "in house", "captains draft"]],
  ["scrim", ["scrim", "scrimmage", "5v5 practice"]],
  ["meetup", ["meetup", "meet up", "meet-up", "hangout", "gathering", "social night"]],
];

function detectKind(name: string, description: string | null): EventKind {
  const text = `${name} ${description ?? ""}`.toLowerCase();
  for (const [kind, words] of KIND_KEYWORDS) {
    if (words.some((w) => text.includes(w))) return kind;
  }
  return "meetup";
}

function detectLocation(event: DiscordScheduledEvent): string {
  if (event.entity_type === ENTITY_EXTERNAL && event.entity_metadata?.location) {
    return event.entity_metadata.location;
  }
  if (event.entity_type === ENTITY_VOICE) return "Discord voice";
  if (event.entity_type === ENTITY_STAGE) return "Discord stage";
  return "Discord";
}

export async function getDiscordEvents(): Promise<CommunityEvent[] | null> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const guildId = await getDiscordGuildId();
  if (!guildId) return null;

  try {
    const res = await fetch(
      `${DISCORD_API_BASE}/guilds/${guildId}/scheduled-events?with_user_count=true`,
      {
        headers: {
          Authorization: `Bot ${token}`,
          "User-Agent": DISCORD_USER_AGENT,
        },
        next: { revalidate: 600, tags: ["discord-events"] },
      },
    );
    if (!res.ok) return null;
    const events = (await res.json()) as DiscordScheduledEvent[];
    if (!Array.isArray(events)) return null;

    return events
      .filter((e) => e.status === STATUS_SCHEDULED || e.status === STATUS_ACTIVE)
      .sort(
        (a, b) =>
          new Date(a.scheduled_start_time).getTime() -
          new Date(b.scheduled_start_time).getTime(),
      )
      .map<CommunityEvent>((e) => ({
        id: e.id,
        title: e.name,
        kind: detectKind(e.name, e.description),
        startsAt: e.scheduled_start_time,
        endsAt: e.scheduled_end_time ?? undefined,
        location: detectLocation(e),
        description: e.description ?? "",
        cta: {
          label: "RSVP on Discord",
          href: `https://discord.com/events/${guildId}/${e.id}`,
        },
        isLive: e.status === STATUS_ACTIVE,
      }));
  } catch {
    return null;
  }
}
