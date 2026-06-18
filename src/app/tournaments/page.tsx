import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "Tournaments",
  description:
    "Seasonal tournaments run by LoLMK on the Korean server. Format, schedule, and bracket coming soon.",
};

export default function TournamentsPage() {
  return (
    <ComingSoon
      kicker="Tournaments"
      title="Seasonal tournaments. Coming to the site soon."
      description="LoLMK runs seasonal double-elim tournaments on KR. Signups, brackets, and standings will live here. For now everything happens in Discord."
      bullets={[
        "Spring / Summer / Fall / Winter — one major tournament per season",
        "Double elimination, 8–16 teams",
        "Finals played in-person in Seoul when possible, with live stream and English commentary",
      ]}
    />
  );
}
