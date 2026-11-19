import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Chapter, Serif, appear, ease, usePop } from "../theme";

// Walk-and-talk (WT) defaults from the study: 25 reels, median 33.7 s,
// median shot 2.8 s, 209 words per minute.
const RULES = [
  { k: "Length", v: "30–45 s" },
  { k: "New shot", v: "every ~2.8 s + jump cuts" },
  { k: "Pace", v: "pauses cut · ~210 words/min" },
  { k: "Visuals", v: "one keyword per spoken idea" },
  { k: "Style", v: "Sumit · kinetic keywords" },
  { k: "Ending", v: "one ask: comment or DM a word" },
];

export const Example: React.FC = () => {
  const frame = useCurrentFrame();
  const inCard = usePop(6);
  const arrow = interpolate(frame, [34, 50], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const outCard = usePop(48);
  return (
    <Bg>
      <Chapter n="07" label="Example" />
      <div style={{ position: "absolute", top: 280, left: 80, right: 80 }}>
        <div
          style={{
            padding: "30px 40px",
            borderRadius: 36,
            background: C.card,
            border: `1px solid ${C.line}`,
            opacity: Math.min(1, inCard * 1.5),
            scale: 0.85 + inCard * 0.15,
          }}
        >
          <div style={{ fontSize: 30, letterSpacing: 4, color: C.dim, fontWeight: 700 }}>YOU BRING</div>
          <div style={{ fontSize: 56, fontWeight: 900, marginTop: 8, lineHeight: 1.15 }}>
            A clip of you walking and talking outside
          </div>
        </div>
        <div
          style={{
            height: 110,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            fontSize: 80,
            color: C.accent,
            opacity: arrow,
            translate: `0px ${(arrow - 1) * 30}px`,
          }}
        >
          ↓
        </div>
        <div
          style={{
            padding: "30px 40px",
            borderRadius: 36,
            background: C.accent,
            color: "#16140A",
            opacity: Math.min(1, outCard * 1.5),
            scale: 0.85 + outCard * 0.15,
          }}
        >
          <div style={{ fontSize: 30, letterSpacing: 4, fontWeight: 700, opacity: 0.7 }}>IT BECOMES</div>
          <div style={{ fontSize: 76, fontWeight: 900, marginTop: 4 }}>
            WT · <Serif>walk-and-talk</Serif>
          </div>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 860,
          left: 80,
          right: 80,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {RULES.map((r, i) => {
          const p = appear(frame, 80 + i * 22, 12);
          return (
            <div
              key={r.k}
              style={{
                display: "flex",
                alignItems: "baseline",
                padding: "26px 8px",
                borderBottom: `1px solid ${C.line}`,
                opacity: p,
                translate: `${(1 - p) * 50}px 0px`,
              }}
            >
              <div style={{ width: 250, fontSize: 36, color: C.dim, fontWeight: 700 }}>{r.k}</div>
              <div style={{ flex: 1, fontSize: 46, fontWeight: 900 }}>{r.v}</div>
            </div>
          );
        })}
      </div>
    </Bg>
  );
};
