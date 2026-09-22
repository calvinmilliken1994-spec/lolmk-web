"use client";

import { useEffect, useRef } from "react";

/**
 * Plays public/audio/boom-drop.mp3 for the Round 1 reveal sequence — one
 * template HTMLAudioElement per hook instance, cloned on each play() so
 * back-to-back triggers (rows a few seconds apart) never cut each other
 * off mid-clip.
 *
 * No separate unlock() like useLockInCue's AudioContext needs: the caller
 * (Ubr1RevealScene) only ever invokes play() once `soundEnabled` is true,
 * which itself only becomes true after the page's "Enable sound" button
 * click — the same user gesture that satisfies autoplay policy for a
 * plain HTMLAudioElement too.
 */
export function useBoomDropCue() {
  const templateRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    templateRef.current = new Audio("/audio/boom-drop.mp3");
    templateRef.current.preload = "auto";
    return () => {
      templateRef.current = null;
    };
  }, []);

  return () => {
    const template = templateRef.current;
    if (!template) return;
    const instance = template.cloneNode(true) as HTMLAudioElement;
    void instance.play().catch(() => {
      // Autoplay can still be refused in rare edge cases (a very stale or
      // backgrounded tab) even after a prior gesture — fail silently
      // rather than throwing out of the reveal effect.
    });
  };
}
