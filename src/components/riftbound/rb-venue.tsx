"use client";

import { useEffect, useRef, useState } from "react";
import {
  VenueAnnouncement,
  VenueChampion,
  VenueClock,
  VenueIdle,
  VenuePairings,
  VenueStandings,
  VenueStartingSoon,
  VenueTimeCalled,
  VenueTopCut,
} from "./rb-venue-scenes";
import { rbRenderScene, rbVenueOffset, type RbVenueData, type RbVenueScene } from "./rb-venue-model";

const STAGE_W = 1920;
const STAGE_H = 1080;
const POLL_MS = 2000;

/**
 * Fixed 1920x1080 stage, scaled to fit the window (letterboxed). Inside an
 * iframe of exactly 1920x1080 (the desk's Preview and Program) the scale is 1.
 */
function VenueFrame({ children }: { children: React.ReactNode }) {
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  return (
    <main className="fixed inset-0 z-[60] overflow-hidden bg-black text-[#F5F5F7]" data-venue-frame>
      {scale > 0 && (
        <div
          className="absolute left-1/2 top-1/2 overflow-hidden font-sans leading-[normal]"
          style={{
            width: STAGE_W,
            height: STAGE_H,
            transform: `translate(-50%, -50%) scale(${scale})`,
            transformOrigin: "center",
          }}
        >
          {children}
        </div>
      )}
    </main>
  );
}

export interface RbVenueOptions {
  /** ?scene= override. Client only; never written anywhere. */
  scene: RbVenueScene | null;
  /** ?text= for the announcement scene. */
  text: string;
  /** ?at= (ISO) for the starting-soon countdown. */
  at: number | null;
}

export function RbVenueScreen({ slug, options }: { slug: string; options: RbVenueOptions }) {
  // undefined: first poll pending; null: not live (404).
  const [data, setData] = useState<RbVenueData | null | undefined>(undefined);
  const [local, setLocal] = useState(() => Date.now());
  const offset = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number;
    async function poll() {
      try {
        const res = await fetch(`/api/rb/state?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        if (res.ok) {
          const json = (await res.json()) as RbVenueData;
          if (cancelled) return;
          offset.current = rbVenueOffset(json.serverNow, Date.now());
          setData(json);
        } else if (res.status === 404) {
          if (cancelled) return;
          // Authoritative "not live": a draft tournament or a bad slug.
          setData(null);
        }
        // Any other status is transient: keep the last good scene.
      } catch {
        // Network hiccup: keep the last good scene.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
      }
    }
    poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [slug]);

  useEffect(() => {
    const id = window.setInterval(() => setLocal(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const now = local + offset.current;

  if (data === undefined) return <VenueFrame>{null}</VenueFrame>;
  if (data === null) {
    return (
      <VenueFrame>
        <div className="flex h-full w-full flex-col items-center justify-center gap-8 bg-[#0A0E1A] opacity-80">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="LoLMK" style={{ width: 220, height: 220 }} className="object-contain" />
          <p className="font-display uppercase" style={{ fontSize: 120, letterSpacing: "0.04em" }}>
            Not live yet
          </p>
        </div>
      </VenueFrame>
    );
  }
  return (
    <VenueFrame>
      <Scene data={data} now={now} options={options} />
    </VenueFrame>
  );
}

function Scene({ data, now, options }: { data: RbVenueData; now: number; options: RbVenueOptions }) {
  const scene = rbRenderScene(data, now, options.scene);
  const [shown, setShown] = useState(scene);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    if (scene === shown) {
      setVisible(true);
      return;
    }
    if (reduced) {
      setShown(scene);
      setVisible(true);
      return;
    }
    // Fade out, swap, fade in. The latest requested scene always wins.
    setVisible(false);
    const id = window.setTimeout(() => {
      setShown(scene);
      setVisible(true);
    }, 200);
    return () => window.clearTimeout(id);
  }, [scene, shown, reduced]);

  return (
    <div
      data-scene={shown}
      className="h-full w-full"
      style={{ opacity: reduced ? 1 : visible ? 1 : 0, transition: reduced ? undefined : "opacity 200ms ease-out" }}
    >
      {shown === "pairings" && <VenuePairings data={data} now={now} withClock={false} />}
      {shown === "pairings_clock" && <VenuePairings data={data} now={now} withClock />}
      {shown === "clock" && <VenueClock data={data} now={now} />}
      {shown === "time-called" && <VenueTimeCalled data={data} now={now} />}
      {shown === "standings" && <VenueStandings data={data} />}
      {shown === "top_cut" && <VenueTopCut data={data} />}
      {shown === "champion" && <VenueChampion data={data} />}
      {shown === "idle" && <VenueIdle data={data} />}
      {shown === "starting_soon" && <VenueStartingSoon data={data} at={options.at} now={now} />}
      {shown === "announcement" && <VenueAnnouncement data={data} text={options.text} />}
    </div>
  );
}
