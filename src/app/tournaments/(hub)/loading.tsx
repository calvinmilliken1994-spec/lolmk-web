import { LoadingRegion, PageHeaderSkeleton, Skeleton, StatusBarSkeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="Tournaments"
        title="Pick your format."
        deck="Three ways to play, one community. Each format has its own page with the live bracket, the field, and how to get in."
      />
      <LoadingRegion label="tournament status" className="ds-container">
        <StatusBarSkeleton />
      </LoadingRegion>
      <LoadingRegion label="formats" className="ds-container pt-14">
        <div aria-hidden className="flex flex-wrap gap-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="cut-plate flex-[1_1_340px] border border-ds-line bg-ds-surface">
              <Skeleton className="h-[210px]" />
              <div className="space-y-3 px-7 pb-7 pt-[26px]">
                <Skeleton className="h-[48px] w-2/3" />
                <Skeleton className="h-[52px] w-full" />
                <Skeleton className="h-[132px] w-full" />
              </div>
            </div>
          ))}
        </div>
      </LoadingRegion>
    </>
  );
}
