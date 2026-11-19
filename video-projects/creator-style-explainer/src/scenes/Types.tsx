import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Chapter, Serif, appear, ease } from "../theme";

// Counts from the study's archetype table (136 reels).
const TYPES = [
  { code: "HT", name: "Hosted listing tour", n: 36 },
  { code: "WT", name: "Walk-and-talk", n: 25 },
  { code: "SI", name: "Interior talking head", n: 15 },
  { code: "MONT", name: "Lifestyle montage", n: 12 },
  { code: "CF", name: "Cinematic listing film", n: 11 },
  { code: "POV", name: "Phone walkthrough", n: 11 },
  { code: "PC", name: "Podcast clip", n: 7 },
  { code: "SH", name: "Selfie talking head", n: 7 },
  { code: "BTS", name: "Behind the scenes", n: 5 },
  { code: "DEMO", name: "App / product demo", n: 3 },
  { code: "VP", name: "Vision pitch", n: 2 },
  { code: "LIST", name: "Numbered listicle", n: 2 },
];

const MAX = 36;
const BAR_MAX = 520;

export const Types: React.FC = () => {
  const frame = useCurrentFrame();
  const h = appear(frame, 4, 12);
  return (
    <Bg>
      <Chapter n="02" label="12 types of reel" />
      <div
        style={{
          position: "absolute",
          top: 270,
          left: 90,
          right: 90,
          fontSize: 92,
          fontWeight: 900,
          lineHeight: 1.05,
          opacity: h,
          translate: `0px ${(1 - h) * 30}px`,
        }}
      >
        Every reel fits
        <br />
        <Serif color={C.accent}>one of 12 types</Serif>
      </div>
      <div
        style={{
          position: "absolute",
          top: 540,
          left: 90,
          right: 90,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {TYPES.map((t, i) => {
          const start = 20 + i * 6;
          const grow = interpolate(frame, [start, start + 24], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          });
          const hot = i < 2;
          return (
            <div
              key={t.code}
              style={{
                display: "flex",
                alignItems: "center",
                height: 72,
                opacity: appear(frame, start, 8),
              }}
            >
              <div style={{ width: 340 }}>
                <div style={{ fontSize: 40, fontWeight: 900, lineHeight: 1 }}>{t.code}</div>
                <div style={{ fontSize: 26, color: C.dim, fontWeight: 500, marginTop: 4 }}>
                  {t.name}
                </div>
              </div>
              <div
                style={{
                  height: 46,
                  width: Math.max(8, (t.n / MAX) * BAR_MAX * grow),
                  borderRadius: 10,
                  background: hot ? C.accent : "rgba(255,255,255,0.32)",
                }}
              />
              <div
                style={{
                  marginLeft: 18,
                  fontSize: 38,
                  fontWeight: 900,
                  color: hot ? C.accent : C.white,
                  opacity: grow,
                }}
              >
                {Math.round(t.n * grow)}
              </div>
            </div>
          );
        })}
      </div>
      <Caption from={130} bottom={150}>
        Your footage <span style={{ color: C.accent }}>picks the type</span>.
        <br />
        The type sets the rules.
      </Caption>
    </Bg>
  );
};
