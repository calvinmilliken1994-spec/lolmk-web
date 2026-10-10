"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Live screens are authored at a fixed 1920x1080 and size their type off the
// viewport, so a small iframe would render different proportions from the
// venue display. The iframe stays at the real size and is scaled down with a
// CSS transform: the preview is the actual live scene, just shrunk.
const LIVE_WIDTH = 1920;
const LIVE_HEIGHT = 1080;

export type LiveFrameTone = "plain" | "preview" | "program";

const TONE: Record<LiveFrameTone, string> = {
  plain: "border border-line",
  preview: "border-2 border-brand-blue-bright",
  program: "border-2 border-brand-red",
};

/**
 * Read-only, to-scale embed of a live venue screen. Generalises
 * SrLivePreview and MayhemLivePreview: the caller builds `src` (e.g.
 * `/srlive/<slug>?muted=1`, `/mayhemlive`, or a scene override with
 * `?scene=<id>&preview=1`). `pointer-events-none` keeps it from duplicating
 * the live screen's own keyboard/fullscreen bindings.
 *
 * With `src={null}` it renders `children` in the frame instead, for screens
 * that don't exist yet and for mock data.
 */
export function LiveFrame({
  src,
  title,
  tone = "plain",
  className,
  children,
}: {
  src: string | null;
  title: string;
  tone?: LiveFrameTone;
  className?: string;
  children?: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || !src) return;
    const update = () => setScale(el.clientWidth / LIVE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [src]);

  return (
    <div ref={wrapperRef} className={cn("relative aspect-video w-full overflow-hidden bg-base", TONE[tone], className)}>
      {src ? (
        scale > 0 && (
          <iframe
            src={src}
            title={title}
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 border-0"
            style={{ width: LIVE_WIDTH, height: LIVE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
          />
        )
      ) : (
        <div className="absolute inset-0" aria-label={title}>
          {children}
        </div>
      )}
    </div>
  );
}
