export type MemberRole =
  | "Streamer"
  | "Content Creator"
  | "Community Leader"
  | "Active Member";

export interface MemberSocial {
  platform: "twitch" | "youtube" | "instagram" | "twitter" | "discord";
  href: string;
  handle: string;
}

export interface Member {
  slug: string;
  ign: string;
  displayName: string;
  role: MemberRole;
  rank?: string;
  blurb: string;
  avatar?: string;
  socials: MemberSocial[];
  featured?: boolean;
}
