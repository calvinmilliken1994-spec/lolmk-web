import Image from "next/image";
import { TIMER_BACKGROUNDS, type TimerBackgroundId } from "@/lib/timer-schedule";

/**
 * Renders the timer's ambient background art. Shared by the live timer and
 * the setup preview so both stay visually identical — same opacity, same
 * relative sizing, same tiling behavior — without duplicating the markup.
 *
 * Artwork sits in a container-relative box (percentages, not viewport units)
 * so the exact same composition scales correctly whether it's mounted in
 * the full-screen live timer or the small setup preview card.
 *
 * The card-back option repeats a single pre-composited tile image (built
 * offline from the source card into `riftboundcardback-tile.png`) rather
 * than trying to fake the stagger with two overlapping CSS
 * `background-repeat` layers — two full-repeat layers both tile every row,
 * so they overlap instead of alternating. The tile itself already encodes
 * one row of cards plus a second row offset by half a pitch (running-bond /
 * half-offset brick coursing), with a wrapped copy so the offset row tiles
 * seamlessly at the tile's horizontal edge. The whole tiled layer then
 * rotates as one unit so rows climb at an angle — never rotating individual
 * cards. The layer stays oversized (200% each axis) so rotation never
 * exposes an uncovered corner.
 */
export function TimerBackground({ backgroundId }: { backgroundId: TimerBackgroundId }) {
  const bg = TIMER_BACKGROUNDS.find((b) => b.id === backgroundId) ?? TIMER_BACKGROUNDS[0];

  if (bg.tiled) {
    // Matches the tile geometry baked into riftboundcardback-tile.png:
    // 96x134 cards (267:373 ratio preserved), 16px gap, so pitch
    // P = 112 horizontal, Q = 150 vertical; the tile image is P x 2Q.
    const tileW = 224;
    const tileH = 600;
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -inset-1/2 opacity-[0.02]"
          style={{
            backgroundImage: `url(${bg.tileSrc ?? bg.src})`,
            backgroundRepeat: "repeat",
            backgroundSize: `${tileW}px ${tileH}px`,
            transform: "rotate(-20deg)",
            transformOrigin: "center",
          }}
        />
      </div>
    );
  }

  if (bg.pair) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-[8%] top-[18%] h-[64%] opacity-[0.02]"
      >
        <div className="flex h-full w-full items-center justify-center gap-[6%]">
          {bg.pair.map((src) => (
            <div key={src} className="relative h-full flex-1">
              <Image src={src} alt="" fill className="object-contain" sizes="50vw" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-[10%] top-[18%] h-[64%] opacity-[0.02]"
    >
      <Image src={bg.src} alt="" fill className="object-contain" sizes="80vw" />
    </div>
  );
}
