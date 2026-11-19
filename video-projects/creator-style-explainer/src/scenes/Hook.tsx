import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Serif, appear, usePop } from "../theme";

const COLS = 12;
const TILE_W = 72;
const TILE_H = 128;
const GAP = 10;

// 136 reels as a wall of phone-shaped tiles behind the number.
const ReelWall: React.FC = () => {
  const frame = useCurrentFrame();
  const tiles = Array.from({ length: 136 });
  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${COLS}, ${TILE_W}px)`,
          gap: GAP,
          scale: interpolate(frame, [0, 120], [1.08, 1], { extrapolateRight: "clamp" }),
        }}
      >
        {tiles.map((_, i) => {
          const o = appear(frame, i * 0.28, 8);
          const hot = i % 11 === 3 || i % 17 === 8;
          return (
            <div
              key={i}
              style={{
                width: TILE_W,
                height: TILE_H,
                borderRadius: 12,
                background: hot ? "rgba(255,216,77,0.22)" : C.faint,
                border: `1px solid ${hot ? "rgba(255,216,77,0.4)" : C.line}`,
                opacity: o * 0.9,
                scale: 0.6 + o * 0.4,
              }}
            />
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = usePop(2);
  const sub = appear(frame, 10, 12);
  return (
    <Bg>
      <ReelWall />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(closest-side, rgba(12,12,17,0.92) 0%, rgba(12,12,17,0.55) 70%, rgba(12,12,17,0) 100%)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            fontSize: 70,
            fontWeight: 700,
            color: C.dim,
            opacity: appear(frame, 0, 4),
            marginBottom: -10,
          }}
        >
          I studied
        </div>
        <div
          style={{
            fontSize: 420,
            fontWeight: 900,
            lineHeight: 1,
            letterSpacing: -16,
            color: C.accent,
            scale: 0.4 + pop * 0.6,
            opacity: Math.min(1, pop * 2),
          }}
        >
          136
        </div>
        <div
          style={{
            fontSize: 110,
            opacity: sub,
            translate: `0px ${(1 - sub) * 30}px`,
          }}
        >
          <Serif>real-estate reels</Serif>
        </div>
      </AbsoluteFill>
      <Caption from={45}>
        so every <span style={{ color: C.accent }}>creator-style</span> edit
        <br />
        starts from data, not guesses.
      </Caption>
    </Bg>
  );
};
