import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "Shop",
  description:
    "LoLMK merch and Gen.G GGX partner drops. Coming soon.",
};

export default function ShopPage() {
  return (
    <ComingSoon
      kicker="Shop"
      title="Merch drops. Quarterly."
      description="Tournament tees, hoodies, and Gen.G GGX collab pieces. Limited runs, shipped from Korea. Setting up the store now — drops happen each quarter."
      bullets={[
        "Tournament tees + hoodies, designed each season",
        "Gen.G GGX partnership pieces",
        "Sticker packs and accessories",
      ]}
    />
  );
}
