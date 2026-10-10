import { ComingSoon } from "@/components/sections/coming-soon";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Shop",
  description: "LoLMK merch.",
  path: "/shop",
  noindex: true,
});

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
