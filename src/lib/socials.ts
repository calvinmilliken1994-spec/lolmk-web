import socialsData from "@/data/socials.json";
import type { SocialLink, SocialPlatform } from "@/types/social";

const socials = socialsData as SocialLink[];

export async function getSocials(): Promise<SocialLink[]> {
  return socials;
}

export async function getSocialByPlatform(platform: SocialPlatform): Promise<SocialLink | null> {
  return socials.find((s) => s.platform === platform) ?? null;
}
