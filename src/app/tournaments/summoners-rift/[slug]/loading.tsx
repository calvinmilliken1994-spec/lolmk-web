import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton tag="Summoner's Rift" title={null} deck={null} stats={4} />
      <LoadingRegion label="bracket" className="ds-container pt-6">
        <Skeleton className="h-[60px] w-[420px] max-w-full" />
        <Skeleton className="mt-6 h-[520px] w-full" />
      </LoadingRegion>
    </>
  );
}
