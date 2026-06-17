import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "How-tos",
  description:
    "Guides for playing on the Korean LoL server — making an account, buying RP, finding PC bangs, and more.",
};

export default function HowTosPage() {
  return (
    <ComingSoon
      kicker="How-tos"
      title="The KR survival guide. Coming soon."
      description="Everything we've answered ten times in Discord, written down once. Practical, English-first, tested by people who've actually done it."
      bullets={[
        "Make a KR account from abroad (and from inside Korea)",
        "Switch the LoL client to English",
        "Buy RP in Korea with a foreign card",
        "PC bang guide for foreigners",
        "Get to LoL Park and grab LCK tickets",
      ]}
    />
  );
}
