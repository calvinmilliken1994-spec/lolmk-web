const DISCORD_INVITE_CODE = process.env.DISCORD_INVITE_CODE ?? "lolmk";
const INVITE_ENDPOINT = `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true&with_expiration=false`;

export const DISCORD_USER_AGENT = "LoLMK-Web (+https://lolmk.gg)";
export const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordStats {
  online: number;
  members: number;
}

interface DiscordInviteResponse {
  guild?: { id: string; name?: string };
  approximate_presence_count?: number;
  approximate_member_count?: number;
}

async function fetchInvite(): Promise<DiscordInviteResponse | null> {
  try {
    const res = await fetch(INVITE_ENDPOINT, {
      headers: { "User-Agent": DISCORD_USER_AGENT },
      // Online count: about a minute (handover Phase 6).
      next: { revalidate: 60, tags: ["discord"] },
    });
    if (!res.ok) return null;
    return (await res.json()) as DiscordInviteResponse;
  } catch {
    return null;
  }
}

export async function getDiscordStats(): Promise<DiscordStats | null> {
  const data = await fetchInvite();
  if (
    !data ||
    typeof data.approximate_member_count !== "number" ||
    typeof data.approximate_presence_count !== "number"
  ) {
    return null;
  }
  return {
    online: data.approximate_presence_count,
    members: data.approximate_member_count,
  };
}

export async function getDiscordGuildId(): Promise<string | null> {
  const data = await fetchInvite();
  return data?.guild?.id ?? null;
}
