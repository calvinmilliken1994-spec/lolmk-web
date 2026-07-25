import type { CommunityStat } from "@/types/stat";

interface StatsStripProps {
  stats: CommunityStat[];
}

export function StatsStrip({ stats }: StatsStripProps) {
  return (
    <section className="border-y border-line-subtle bg-surface">
      <div className="container-wide grid grid-cols-2 lg:grid-cols-4 divide-x divide-line-subtle">
        {stats.map((stat) => (
          <div key={stat.id} className="py-8 px-6 first:pl-0 last:pr-0 min-w-0">
            <p className="text-label uppercase text-ink-muted mb-2">{stat.label}</p>
            <p className="font-display text-score text-ink tabular leading-none">
              {stat.value}
            </p>
            {stat.hint && (
              <p className="mt-2 text-caption text-ink-muted font-mono line-clamp-1">
                {stat.hint}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
