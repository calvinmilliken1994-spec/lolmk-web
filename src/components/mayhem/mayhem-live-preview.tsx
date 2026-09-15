"use client";

import { useEffect, useRef, useState } from "react";

// /mayhemlive's scene typography uses viewport-relative clamp() sizing, so
// a small iframe (e.g. 480x270) would render completely different
// proportions than the real venue display. Instead the iframe is fixed at
// its real 1920x1080 authoring viewport and the whole thing is scaled down
// uniformly with a CSS transform — the DOM inside renders exactly as it
// does on the real screen, just shrunk, so this preview is the actual
// live scene, not an approximation of it.
const LIVE_WIDTH = 1920;
const LIVE_HEIGHT = 1080;

/**
 * Live, to-scale preview of /mayhemlive embedded in the admin dashboard.
 * `pointer-events-none` makes this read-only — it doesn't duplicate any
 * admin controls, state writes, or global keyboard/fullscreen bindings;
 * /mayhemlive's own polling loop (src/components/mayhem/mayhem-live-screen.tsx)
 * is what keeps it in sync with the admin's scene changes.
 */
export function MayhemLivePreview() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / LIVE_WIDTH);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={wrapperRef}
      className="relative w-full overflow-hidden rounded-md border border-line bg-base aspect-video"
    >
      {scale > 0 && (
        <iframe
          src="/mayhemlive"
          title="Live venue screen preview"
          tabIndex={-1}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 border-0"
          style={{
            width: LIVE_WIDTH,
            height: LIVE_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        />
      )}
    </div>
  );
}
