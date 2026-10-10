"use client";

// The top-cut bracket as absolutely positioned cards and connector lines, in
// the pixels of docs/design/control-deck-v2/screens/venue-top8.html. Used full
// size by the venue screen and scaled down on the desk. Layout comes from
// rbCutView (src/lib/rb-cut.ts).

import { CUT_CANVAS_H, CUT_CARD_W, CUT_ROW_H, type CutCardView, type CutSlotView, type CutView } from "../../lib/rb-cut";

const LINE = "#2D3A52";

function Row({ slot }: { slot: CutSlotView }) {
  const dim = slot.state === "loser" || slot.state === "bye";
  return (
    <div
      className="flex items-center"
      style={{ height: CUT_ROW_H, background: dim ? "#0E1428" : "#151C36", color: dim ? "#8B8D98" : "#F5F5F7" }}
    >
      <span
        className="font-display flex items-center justify-center"
        style={{ width: 56, height: "100%", background: "#1A2240", fontSize: 34, color: "#B8BCC8" }}
      >
        {slot.seed ?? "–"}
      </span>
      <span className="flex min-w-0 flex-1 flex-col" style={{ paddingLeft: 16 }}>
        <span className="truncate font-semibold" style={{ fontSize: 26, lineHeight: 1.1 }}>
          {slot.name}
        </span>
        {slot.sub && (
          <span className="truncate" style={{ fontSize: 15, color: "#B8BCC8" }}>
            {slot.sub}
          </span>
        )}
      </span>
      <span className="font-display text-center" style={{ width: 64, fontSize: 52 }}>
        {slot.score ?? ""}
      </span>
    </div>
  );
}

function Card({ card }: { card: CutCardView }) {
  return (
    <div
      data-cut-card={card.short}
      data-live={card.live ? "1" : undefined}
      className="absolute flex flex-col"
      style={{ left: card.left, top: card.top, width: CUT_CARD_W, gap: 2, border: `2px solid ${card.live ? "#E94560" : LINE}`, boxSizing: "content-box" }}
    >
      {card.live && (
        <span
          className="absolute"
          style={{ right: -2, top: -30, padding: "2px 12px", background: "#BA263C", fontFamily: '"Chakra Petch", monospace', fontSize: 16, fontWeight: 600, letterSpacing: "0.08em" }}
        >
          LIVE
        </span>
      )}
      <Row slot={card.slots[0]} />
      <Row slot={card.slots[1]} />
    </div>
  );
}

export function RbBracket({ view, scale = 1 }: { view: CutView; scale?: number }) {
  return (
    <div style={{ width: view.width * scale, height: CUT_CANVAS_H * scale }}>
      <div
        className="relative"
        style={{ width: view.width, height: CUT_CANVAS_H, transform: scale === 1 ? undefined : `scale(${scale})`, transformOrigin: "top left" }}
      >
        {view.connectors.map((c, i) =>
          c.kind === "bracket" ? (
            <div
              key={i}
              className="absolute"
              style={{
                left: c.left,
                top: c.top,
                width: c.width,
                height: c.height,
                borderTop: `3px solid ${LINE}`,
                borderRight: `3px solid ${LINE}`,
                borderBottom: `3px solid ${LINE}`,
                boxSizing: "border-box",
              }}
            />
          ) : (
            <div key={i} className="absolute" style={{ left: c.left, top: c.top, width: c.width, height: c.height, background: LINE }} />
          ),
        )}
        {view.cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>
    </div>
  );
}
