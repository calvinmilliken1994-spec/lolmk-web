import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  const hero = await readFile("src/components/sections/hero.tsx", "utf8");
  const globalStyles = await readFile("src/app/globals.css", "utf8");

  assert.match(hero, /<video/);
  assert.match(hero, /autoPlay/);
  assert.match(hero, /muted/);
  assert.match(hero, /loop/);
  assert.match(hero, /playsInline/);
  assert.match(hero, /preload="metadata"/);
  assert.match(hero, /poster="\/images\/hero\/hero-league-poster\.webp"/);
  assert.match(hero, /src="\/videos\/hero-league-loop\.mp4"/);
  assert.match(hero, /className="hero-video-poster/);
  assert.match(hero, /className="hero-video/);
  assert.match(globalStyles, /\.hero-video\s*\{[\s\S]*?display:\s*none/);
  assert.match(globalStyles, /@media \(min-width: 768px\) and \(prefers-reduced-motion: no-preference\)/);
  assert.match(globalStyles, /\.hero-video-poster\s*\{[\s\S]*?display:\s*none/);
  assert.match(globalStyles, /\.hero-video\s*\{[\s\S]*?display:\s*block/);

  console.log("Hero video checks passed.");
}

void main();
