import { PageHeaderSkeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <PageHeaderSkeleton
      tag="About"
      title="Since 2014."
      deck="The largest English-speaking League of Legends community in Korea. Run by volunteers, partnered with Gen.G GGX."
      stats={4}
    />
  );
}
