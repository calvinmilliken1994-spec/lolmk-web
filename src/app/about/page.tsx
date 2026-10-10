import { ComingSoon } from "@/components/sections/coming-soon";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "About",
  description:
    "LoLMK is the largest English-speaking League of Legends community in Korea. Run by volunteers since 2014, partnered with Gen.G GGX.",
  path: "/about",
});

export default function AboutPage() {
  return (
    <ComingSoon
      kicker="About"
      title="A proper story page is on the way."
      description="LoLMK is the largest English-speaking League of Legends community in Korea. Established 2014. Official partnered community with Gen.G GGX. Full story, mission, admin team, and contact details will live here."
      bullets={[
        "Established 2014, older than most expat groups in Seoul",
        "Official partnered community with Gen.G GGX",
        "Run by volunteers, supported by streamers and content creators",
      ]}
    />
  );
}
