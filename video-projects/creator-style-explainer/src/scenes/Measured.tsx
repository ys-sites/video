import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Chapter, Serif, appear, usePop } from "../theme";

const ITEMS = [
  { title: "Cuts & shot length", sub: "ffmpeg scene detection · 2,539 shots" },
  { title: "Every spoken word", sub: "Whisper transcript with word timings" },
  { title: "Loudness", sub: "LUFS of the finished mix" },
  { title: "10-frame contact sheet", sub: "watched for type, text and camera" },
];

const Card: React.FC<{ i: number; start: number }> = ({ i, start }) => {
  const pop = usePop(start);
  const item = ITEMS[i];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 36,
        padding: "36px 44px",
        borderRadius: 36,
        background: C.card,
        border: `1px solid ${C.line}`,
        opacity: Math.min(1, pop * 1.5),
        scale: 0.85 + pop * 0.15,
        translate: `${(1 - pop) * 80}px 0px`,
      }}
    >
      <div style={{ fontSize: 88, fontWeight: 900, color: C.accent, width: 120 }}>
        0{i + 1}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 56, fontWeight: 900, lineHeight: 1.1 }}>{item.title}</div>
        <div style={{ fontSize: 38, color: C.dim, marginTop: 10, fontWeight: 500 }}>
          {item.sub}
        </div>
        {i === 0 ? <CutStrip start={start} /> : null}
      </div>
    </div>
  );
};

// Tiny strip with cut ticks sweeping in, to show what "cuts" means.
const CutStrip: React.FC<{ start: number }> = ({ start }) => {
  const frame = useCurrentFrame();
  const cuts = [0.06, 0.13, 0.22, 0.27, 0.38, 0.45, 0.51, 0.63, 0.7, 0.79, 0.86, 0.94];
  const sweep = interpolate(frame, [start + 8, start + 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "relative",
        height: 24,
        marginTop: 20,
        borderRadius: 8,
        background: C.faint,
        overflow: "hidden",
      }}
    >
      {cuts.map((c) => (
        <div
          key={c}
          style={{
            position: "absolute",
            left: `${c * 100}%`,
            top: 0,
            bottom: 0,
            width: 5,
            background: C.accent,
            opacity: sweep > c ? 1 : 0,
          }}
        />
      ))}
    </div>
  );
};

export const Measured: React.FC = () => {
  const frame = useCurrentFrame();
  const h = appear(frame, 4, 12);
  return (
    <Bg>
      <Chapter n="01" label="What I measured" />
      <div
        style={{
          position: "absolute",
          top: 270,
          left: 90,
          right: 90,
          fontSize: 96,
          fontWeight: 900,
          lineHeight: 1.05,
          opacity: h,
          translate: `0px ${(1 - h) * 30}px`,
        }}
      >
        Every reel,
        <br />
        <Serif color={C.accent}>four ways</Serif>
      </div>
      <div
        style={{
          position: "absolute",
          top: 560,
          left: 70,
          right: 70,
          display: "flex",
          flexDirection: "column",
          gap: 30,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} i={i} start={24 + i * 40} />
        ))}
      </div>
      <Caption from={200} bottom={200}>
        Then each reel got <span style={{ color: C.accent }}>a type</span>.
      </Caption>
    </Bg>
  );
};
