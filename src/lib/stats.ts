import statsData from "@/data/stats.json";
import type { CommunityStat } from "@/types/stat";
import { getDiscordStats } from "@/lib/discord";
import { getNextEvent } from "@/lib/events";
import { formatKstDate } from "@/lib/format";

const staticStats = statsData as CommunityStat[];
const numberFmt = new Intl.NumberFormat("en-US");

export async function getCommunityStats(): Promise<CommunityStat[]> {
  const [discord, nextEvent] = await Promise.all([getDiscordStats(), getNextEvent()]);

  return staticStats.map((stat) => {
    if (stat.id === "discord-online" && discord) {
      return { ...stat, value: numberFmt.format(discord.online) };
    }
    if (stat.id === "members" && discord) {
      return { ...stat, value: numberFmt.format(discord.members) };
    }
    if (stat.id === "next-event" && nextEvent) {
      return {
        ...stat,
        value: formatKstDate(nextEvent.startsAt),
        hint: nextEvent.title,
      };
    }
    return stat;
  });
}
