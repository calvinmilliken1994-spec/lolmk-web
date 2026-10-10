import { LoadingRegion, PageHeaderSkeleton, StatusBarSkeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="ARAM Mayhem"
        title={null}
        deck="The meetup tournament, usually run over a day. Bring a full premade team, or sign up solo and get placed into one. Solo signups are genuinely encouraged, especially if you haven't put a friend group together in Korea yet."
        stats={4}
      />
      <LoadingRegion label="tournament status" className="ds-container">
        <StatusBarSkeleton />
      </LoadingRegion>
    </>
  );
}
