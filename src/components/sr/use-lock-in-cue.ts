"use client";

import { useEffect, useRef } from "react";

/**
 * Synthesized "lock-in" style impact cue via Web Audio — no bundled audio
 * file, no Riot assets. A short sub-bass thump (rapid pitch-drop sine) layered
 * with a bright metallic ring (a few detuned short tones) approximates the
 * weight of a champion-select lock-in without reproducing it.
 *
 * Exposes a ref-callable `play()` via the `trigger` prop pattern: bump
 * `triggerKey` to fire once. Autoplay policies require a prior user gesture
 * on the page (the "Enable sound" button in SrLiveScreen) before any audio
 * context can produce sound — this component silently no-ops until then.
 */
export function useLockInCue() {
  const ctxRef = useRef<AudioContext | null>(null);

  function ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    return ctxRef.current;
  }

  function unlock() {
    const ctx = ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  function play() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;

    // Sub-bass thump: pitch drop from 180Hz to 40Hz over 220ms, punchy attack.
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = "sine";
    bass.frequency.setValueAtTime(180, now);
    bass.frequency.exponentialRampToValueAtTime(40, now + 0.22);
    bassGain.gain.setValueAtTime(0.0001, now);
    bassGain.gain.exponentialRampToValueAtTime(0.9, now + 0.012);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    bass.connect(bassGain).connect(ctx.destination);
    bass.start(now);
    bass.stop(now + 0.45);

    // Metallic ring: three short, slightly detuned tones for a "lock" chime.
    [1046.5, 1318.5, 1568].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(freq, now);
      const start = now + 0.02 + i * 0.006;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });

    // Noise transient: a brief filtered click for percussive "impact" edge.
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.value = 800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
    noise.start(now);
  }

  useEffect(() => {
    return () => {
      ctxRef.current?.close().catch(() => {});
    };
  }, []);

  return { play, unlock };
}
