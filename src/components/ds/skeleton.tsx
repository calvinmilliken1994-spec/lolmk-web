import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ds/page-header";
import { BusyMain } from "@/components/motion/busy-main";

/**
 * Loading skeletons: same size as the final layout, on surface-2 with a
 * 1.4s shimmer (.ds-skeleton, off under reduced motion). Static header copy
 * renders for real; only data regions become skeletons.
 */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("ds-skeleton", className)} />;
}

/** Busy region wrapper with a screen-reader status. */
export function LoadingRegion({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div aria-busy="true" className={className}>
      <span role="status" className="sr-only">
        Loading {label}
      </span>
      {children}
    </div>
  );
}

const COLS: Record<number, string> = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function StatStripSkeleton({ count, className }: { count: number; className?: string }) {
  return (
    <div aria-hidden className={cn("grid grid-cols-1 gap-px border border-ds-line bg-ds-line", COLS[count], className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-ds-surface px-7 pb-5 pt-[18px]">
          <Skeleton className="h-[14px] w-24" />
          <Skeleton className="mt-3 h-[44px] w-28" />
        </div>
      ))}
    </div>
  );
}

/**
 * PageHeader with its static copy and skeleton stats. Pass `title` as null
 * when the title itself is data (a tournament name, the member's name).
 */
export function PageHeaderSkeleton({
  tag,
  tagTone,
  title,
  deck,
  stats = 0,
}: {
  tag: string;
  tagTone?: "red" | "blue";
  title: string | null;
  deck?: string | null;
  stats?: number;
}) {
  return (
    <>
      <BusyMain />
      <PageHeader
      tag={tag}
      tagTone={tagTone}
      title={
        title ?? (
          <>
            <span className="sr-only">Loading</span>
            <span aria-hidden className="ds-skeleton block h-[clamp(64px,10vw,128px)] w-full max-w-[720px]" />
          </>
        )
      }
      deck={deck === null ? <span aria-hidden className="ds-skeleton block h-[56px] w-full" /> : deck}
      statsSlot={stats > 0 ? <StatStripSkeleton count={stats} /> : undefined}
      />
    </>
  );
}

/** StatusBar-sized block (tag cell plus title line, as in next and off-season modes). */
export function StatusBarSkeleton() {
  return (
    <div aria-hidden className="cut-bar flex flex-wrap border border-ds-line bg-ds-surface">
      <Skeleton className="h-[132px] w-[180px] max-sm:h-[72px] max-sm:w-full" />
      <div className="flex-1 px-8 py-[22px]">
        <Skeleton className="h-[52px] w-full max-w-[560px]" />
        <Skeleton className="mt-4 h-[20px] w-64 max-w-full" />
      </div>
    </div>
  );
}
