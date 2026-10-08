"use client";

import { useEffect, useState } from "react";

/**
 * Wall-clock time, ticking every `intervalMs`. `null` until the component has
 * mounted, so server and client render the same first frame; anything that
 * shows a time derived from it appears after hydration. Used only to
 * display values computed from server timestamps, never as a countdown of
 * its own.
 */
export function useNow(intervalMs = 1000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
