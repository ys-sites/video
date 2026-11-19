import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Bg, C, Serif, appear, usePop } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = usePop(10);
  return (
    <Bg>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 90 }}>
        <div style={{ fontSize: 110, opacity: appear(frame, 0, 10) }}>
          <Serif>Just say</Serif>
        </div>
        <div
          style={{
            fontSize: 150,
            fontWeight: 900,
            letterSpacing: -5,
            lineHeight: 1,
            textAlign: "center",
            color: C.accent,
            marginTop: 20,
            scale: 0.6 + pop * 0.4,
            opacity: Math.min(1, pop * 2),
          }}
        >
          “creator
          <br />
          style”
        </div>
        <div
          style={{
            marginTop: 90,
            fontSize: 48,
            fontWeight: 700,
            textAlign: "center",
            lineHeight: 1.3,
            opacity: appear(frame, 40, 12),
          }}
        >
          Copy the technique.
          <br />
          <span style={{ color: C.dim }}>Never the footage.</span>
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          bottom: 170,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 32,
          letterSpacing: 5,
          fontWeight: 700,
          color: C.dim,
          opacity: appear(frame, 60, 12),
        }}
      >
        136 REELS · 12 TYPES · 18 NAMED STYLES
      </div>
    </Bg>
  );
};
