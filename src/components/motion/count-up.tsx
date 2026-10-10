"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Stat values count up once, on first view: 600ms, ease-out, tabular-nums.
 *
 * Works on any element with `data-count-up` (StatStrip sets it). The final
 * value is server-rendered, so without JS, or under reduced motion, the
 * number is simply there. Only plain counts animate ("895", "1,204"); years,
 * dates and text are left alone.
 */
const DURATION_MS = 600;
const COUNT = /^\d{1,3}(,\d{3})+$|^\d+$/;

function isYear(text: string): boolean {
  return /^(19|20)\d{2}$/.test(text);
}

function animate(el: HTMLElement) {
  const target = el.textContent?.trim() ?? "";
  if (!COUNT.test(target) || isYear(target)) return;
  const value = Number(target.replace(/,/g, ""));
  if (!Number.isFinite(value) || value === 0) return;
  const commas = target.includes(",");
  const fmt = (n: number) => (commas ? n.toLocaleString("en-US") : String(n));
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(Math.round(value * eased));
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = target;
  };
  el.textContent = fmt(0);
  requestAnimationFrame(step);
}

export function CountUp() {
  const pathname = usePathname();

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.setAttribute("data-counted", "");
          io.unobserve(el);
          // Links inside a cell keep their element; count the text node's parent.
          const target = (el.querySelector("a") as HTMLElement | null) ?? el;
          animate(target);
        }
      },
      { threshold: 0.4 },
    );
    const seen = new WeakSet<Element>();
    const scan = () => {
      document.querySelectorAll<HTMLElement>("[data-count-up]:not([data-counted])").forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        io.observe(el);
      });
    };
    scan();
    // Stat strips behind <Suspense> stream in after the first paint.
    const mo = new MutationObserver(scan);
    const main = document.querySelector("main");
    if (main) mo.observe(main, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [pathname]);

  return null;
}
