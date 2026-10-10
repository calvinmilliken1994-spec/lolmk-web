import { LoadingRegion, PageHeaderSkeleton, StatusBarSkeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="Riftbound"
        title="Riftbound."
        deck="The card game. In-person cups at Gen.G GGX, plus a weekly online night anyone can join for free on tcg-arena.fr."
        stats={2}
      />
      <LoadingRegion label="tournament status" className="ds-container">
        <StatusBarSkeleton />
      </LoadingRegion>
    </>
  );
}
