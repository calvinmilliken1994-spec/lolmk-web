import { ComingSoon } from "@/components/sections/coming-soon";

export const metadata = {
  title: "Shop",
  description:
    "LoLMK merch. Coming soon.",
};

export default function ShopPage() {
  return (
    <ComingSoon
      kicker="Shop"
      title="Merch drops? :eyes:"
      description="Store soon?"
      bullets={[
        "Stickers, badges, keyrings, and apparel with LoLMK branding",
      ]}
    />
  );
}
