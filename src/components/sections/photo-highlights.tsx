import Image from "next/image";
import { ArrowUpRight, Camera, Instagram } from "lucide-react";
import type { InstagramPost } from "@/types/instagram";
import { pickPostImage } from "@/lib/instagram";

interface PhotoHighlightsProps {
  posts: InstagramPost[];
}

const KST_DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  month: "short",
  year: "numeric",
});

const PLACEHOLDER_TINTS = [
  "from-brand-red/40 to-brand-blue/30",
  "from-brand-blue/40 to-brand-red/20",
  "from-brand-red-muted to-brand-blue-muted",
  "from-brand-blue-muted to-brand-red-muted",
  "from-brand-red/30 to-brand-blue/40",
  "from-brand-blue/40 to-brand-red-muted",
];

export function PhotoHighlights({ posts }: PhotoHighlightsProps) {
  return (
    <section className="py-24 border-y border-line-subtle bg-surface">
      <div className="container-wide mb-10 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="font-heading text-display-md text-ink">Photo highlights</h2>
          <p className="mt-4 text-body-md text-ink-secondary">
            Latest from{" "}
            <a
              href="https://instagram.com/lolmeetupkorea"
              target="_blank"
              rel="noreferrer"
              className="text-ds-text underline decoration-ds-line-strong underline-offset-4 hover:decoration-ds-text"
            >
              @lolmeetupkorea
            </a>
            . Real meetups, real people. Tournaments at Gen.G GGX and watch parties in Hongdae.
          </p>
        </div>
        <a
          href="https://instagram.com/lolmeetupkorea"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-body-sm text-ink-secondary hover:text-ink"
        >
          <Instagram strokeWidth={1.5} className="h-4 w-4" />
          Follow on Instagram
          <ArrowUpRight strokeWidth={1.5} className="h-4 w-4" />
        </a>
      </div>

      <div className="container-wide">
        {/* Square 1:1 tiles — mirrors the native Instagram profile grid so the
            section reads unmistakably as the feed. */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {posts.length > 0
            ? posts.map((post) => <PhotoCard key={post.id} post={post} />)
            : PLACEHOLDER_TINTS.map((tint, i) => <PlaceholderCard key={i} tint={tint} />)}
        </div>
      </div>
    </section>
  );
}

function PhotoCard({ post }: { post: InstagramPost }) {
  const src = pickPostImage(post);
  const date = KST_DATE.format(new Date(post.timestamp));
  const caption = post.prunedCaption ?? post.caption ?? "";

  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noreferrer"
      className="group relative aspect-square border border-line bg-base overflow-hidden block"
    >
      <Image
        src={src}
        alt={caption || "Instagram post from @lolmeetupkorea"}
        fill
        sizes="(max-width: 768px) 50vw, 33vw"
        className="object-cover transition-transform duration-500 ease-out-soft group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-base via-base/30 to-transparent opacity-90 group-hover:opacity-70 transition-opacity" />
      <div className="absolute top-4 right-4 bg-base/80 border border-line-subtle p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <Instagram strokeWidth={1.5} className="h-4 w-4 text-ink" />
      </div>
      <figcaption className="absolute bottom-0 left-0 right-0 p-5">
        <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">{date}</p>
        {caption && (
          <p className="font-heading text-heading-md text-ink mt-1 line-clamp-2">
            {caption}
          </p>
        )}
      </figcaption>
    </a>
  );
}

function PlaceholderCard({ tint }: { tint: string }) {
  return (
    <figure className="group relative aspect-square border border-line bg-base overflow-hidden">
      <div className={`absolute inset-0 bg-gradient-to-br ${tint}`} />
      <div className="absolute inset-0 bg-base/40" />
      <div className="absolute inset-0 flex items-center justify-center text-ink-muted">
        <Camera strokeWidth={1} className="h-16 w-16 opacity-30" />
      </div>
      <figcaption className="absolute bottom-0 left-0 right-0 p-5">
        <p className="text-caption font-mono uppercase tracking-wide text-ink-muted">
          Instagram feed not configured
        </p>
        <p className="font-heading text-heading-md text-ink mt-1">
          Set BEHOLD_FEED_ID
        </p>
      </figcaption>
    </figure>
  );
}
