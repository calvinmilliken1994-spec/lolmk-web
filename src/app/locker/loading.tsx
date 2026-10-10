import { LoadingRegion, PageHeaderSkeleton, Skeleton } from "@/components/ds/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton
        tag="Locker"
        tagTone="blue"
        title={null}
        deck="Your tournaments, your team, and what you've signed up for. Everything here comes straight from the Discord."
        stats={4}
      />
      <LoadingRegion label="your card" className="ds-container pt-6">
        <Skeleton className="h-[60px] w-56" />
        <div aria-hidden className="mt-8 grid gap-10 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </LoadingRegion>
    </>
  );
}
