import type { InstagramPost } from "@/types/instagram";

const BEHOLD_BASE = "https://feeds.behold.so";

interface BeholdFeedResponse {
  feed?: {
    owner?: { username?: string };
    posts?: InstagramPost[];
  };
  posts?: InstagramPost[];
}

function resolveFeedUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `${BEHOLD_BASE}/${trimmed}`;
}

export async function getInstagramPosts(limit = 6): Promise<InstagramPost[]> {
  const raw = process.env.BEHOLD_FEED_ID;
  if (!raw) return [];

  try {
    const res = await fetch(resolveFeedUrl(raw), {
      next: { revalidate: 3600, tags: ["instagram"] },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as BeholdFeedResponse;
    const posts = data.feed?.posts ?? data.posts ?? [];
    return posts
      .slice()
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function pickPostImage(post: InstagramPost): string {
  return (
    post.sizes?.medium?.mediaUrl ??
    post.sizes?.large?.mediaUrl ??
    post.sizes?.small?.mediaUrl ??
    post.thumbnailUrl ??
    post.mediaUrl
  );
}
