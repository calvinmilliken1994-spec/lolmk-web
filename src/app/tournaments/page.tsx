import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "Tournaments",
  description:
    "Quarterly tournaments run by LoLMK on the Korean server. Format, schedule, and bracket coming soon.",
};

export default function TournamentsPage() {
  return (
    <ComingSoon
      kicker="Tournaments"
      title="Quarterly tournaments. Coming to the site soon."
      description="LoLMK runs quarterly double-elim tournaments on KR. Signups, brackets, and standings will live here. For now everything happens in Discord."
      bullets={[
        "Q1 / Q2 / Q3 / Q4 — one major tournament per season",
        "Double elimination, 8–16 teams, English voice required",
        "Finals played at Gen.G GGX in Seoul",
      ]}
    />
  );
}
