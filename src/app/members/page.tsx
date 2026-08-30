import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "Members",
  description:
    "Streamers, content creators, and community leaders in LoLMK. Directory coming soon.",
};

export default function MembersPage() {
  return (
    <ComingSoon
      kicker="Members"
      title="The directory's on the way."
      description="Streamers, content creators, captains, regulars. A grid of who's who in LoLMK, searchable and filterable by role, is in the works. For now, hop in Discord and meet people directly."
      bullets={[
        "Streamers and content creators with links to their channels",
        "Community leaders who run in-houses and tournaments",
       ]}
    />
  );
}
