export type SocialPlatform = "discord" | "kakao" | "instagram" | "twitch" | "youtube";

export interface SocialLink {
  platform: SocialPlatform;
  label: string;
  href: string;
  handle?: string;
  description: string;
}
