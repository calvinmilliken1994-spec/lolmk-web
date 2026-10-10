import { LoadingRegion, PageHeaderSkeleton, StatusBarSkeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="Summoner's Rift"
        title="5v5 on the KR server."
        deck="Full-draft 5v5s, run over a week or a month. Captains register a team, every player confirms their own slot, rosters lock before kickoff, and the bracket updates as results come in."
      />
      <LoadingRegion label="tournament status" className="ds-container">
        <StatusBarSkeleton />
      </LoadingRegion>
    </>
  );
}
