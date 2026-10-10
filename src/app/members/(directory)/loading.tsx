import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="Members"
        title="Meet the regulars."
        deck="Admins, game coordinators, and members who've opted in to be shown. Sign in with Discord to add your own card."
        stats={4}
      />
      <LoadingRegion label="members" className="ds-container">
        <Skeleton className="h-[60px] w-48" />
        <div aria-hidden className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cut-plate border border-ds-line bg-ds-surface">
              <Skeleton className="h-[150px]" />
              <div className="space-y-3 px-6 pb-6 pt-14">
                <Skeleton className="h-[34px] w-2/3" />
                <Skeleton className="h-[14px] w-1/2" />
                <Skeleton className="h-[48px] w-full" />
              </div>
            </div>
          ))}
        </div>
      </LoadingRegion>
    </>
  );
}
