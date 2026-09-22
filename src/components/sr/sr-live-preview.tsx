"use client";

import { useEffect, useRef, useState } from "react";

const LIVE_WIDTH = 1920;
const LIVE_HEIGHT = 1080;

export function SrLivePreview({ slug }: { slug: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / LIVE_WIDTH);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={wrapperRef} className="relative aspect-video w-full overflow-hidden border border-line bg-base">
      {scale > 0 && (
        <iframe
          // `muted=1` tells the embedded page to skip the "Enable sound"
          // gesture button and never fire the reveal cue — the admin's own
          // desk audio, not the venue speakers, would otherwise double up
          // every lock-in chime the operator triggers.
          src={`/srlive/${encodeURIComponent(slug)}?muted=1`}
          title="Summoner's Rift live presentation preview"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{ width: LIVE_WIDTH, height: LIVE_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      )}
    </div>
  );
}
