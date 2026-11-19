import React from "react";
import { useCurrentFrame } from "remotion";
import { Bg, C, Caption, Chapter, Serif, appear, usePop } from "../theme";

const Ask: React.FC<{ start: number; tag: string; children: React.ReactNode; n: string }> = ({
  start,
  tag,
  children,
  n,
}) => {
  const pop = usePop(start);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "34px 44px",
        borderRadius: 40,
        background: C.card,
        border: `1px solid ${C.line}`,
        opacity: Math.min(1, pop * 1.5),
        scale: 0.8 + pop * 0.2,
        translate: `0px ${(1 - pop) * 40}px`,
      }}
    >
      <div>
        <div style={{ fontSize: 30, letterSpacing: 4, color: C.dim, fontWeight: 700 }}>{tag}</div>
        <div style={{ fontSize: 64, fontWeight: 900, marginTop: 6 }}>{children}</div>
      </div>
      <div style={{ fontSize: 40, fontWeight: 900, color: C.accent }}>{n}</div>
    </div>
  );
};

export const Endings: React.FC = () => {
  const frame = useCurrentFrame();
  const pop = usePop(4);
  return (
    <Bg>
      <Chapter n="05" label="The ending" />
      <div style={{ position: "absolute", top: 290, left: 90, right: 90 }}>
        <div
          style={{
            fontSize: 220,
            fontWeight: 900,
            letterSpacing: -8,
            lineHeight: 1,
            color: C.accent,
            scale: 0.7 + pop * 0.3,
            transformOrigin: "left center",
            opacity: Math.min(1, pop * 2),
          }}
        >
          55<span style={{ color: C.dim, fontSize: 110 }}> / 109</span>
        </div>
        <div style={{ fontSize: 76, marginTop: 10, opacity: appear(frame, 10, 10), lineHeight: 1.15 }}>
          spoken reels end on
          <br />
          <Serif color={C.accent}>one clear ask</Serif>
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
          gap: 26,
        }}
      >
        <Ask start={40} tag="CALL + CONTACT CARD" n="~23">
          “Give me a call”
        </Ask>
        <Ask start={62} tag="COMMENT A WORD" n="12+">
          Comment <span style={{ color: C.accent }}>SWING</span>
        </Ask>
        <Ask start={84} tag="DM A WORD" n="11+">
          DM me <span style={{ color: C.accent }}>PLAN</span>
        </Ask>
      </div>
      <Caption from={130} bottom={200}>
        Never a vague
        <br />
        <span style={{ textDecoration: "line-through", textDecorationColor: C.red, textDecorationThickness: 8 }}>
          “follow for more”
        </span>
      </Caption>
    </Bg>
  );
};
