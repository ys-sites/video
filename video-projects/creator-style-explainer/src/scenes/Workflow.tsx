import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Chapter, appear, ease, usePop } from "../theme";

const STEPS = [
  { t: "Transcribe", s: "every word, with timings" },
  { t: "Pick the type", s: "from your footage, e.g. walk-and-talk" },
  { t: "Storyboard", s: "beat by beat, shown to you", you: true },
  { t: "Build", s: "Remotion + captions + effects" },
  { t: "Render", s: "1080×1920 · 30 fps · −14 LUFS" },
  { t: "Checklist", s: "hook, pace, one ask, rights" },
];

const PROMPT = "Edit this in creator style";
const STEP0 = 70;
const GAP = 46;
const ROW = 165;

export const Workflow: React.FC = () => {
  const frame = useCurrentFrame();
  const bubble = usePop(4);
  const typed = Math.floor(
    interpolate(frame, [12, 48], [0, PROMPT.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const line = interpolate(frame, [STEP0, STEP0 + GAP * 5 + 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  return (
    <Bg>
      <Chapter n="06" label="How you use it" />
      {/* The request */}
      <div
        style={{
          position: "absolute",
          top: 280,
          right: 90,
          maxWidth: 820,
          padding: "30px 40px",
          borderRadius: "44px 44px 10px 44px",
          background: C.accent,
          color: "#16140A",
          fontSize: 54,
          fontWeight: 900,
          opacity: Math.min(1, bubble * 1.5),
          scale: 0.8 + bubble * 0.2,
          transformOrigin: "right bottom",
        }}
      >
        <div style={{ fontSize: 28, letterSpacing: 4, fontWeight: 700, opacity: 0.7 }}>YOU</div>
        {PROMPT.slice(0, typed)}
        <span style={{ opacity: frame % 20 < 10 && typed < PROMPT.length ? 1 : 0 }}>|</span>
      </div>
      {/* The steps */}
      <div style={{ position: "absolute", top: 560, left: 90, right: 90 }}>
        <div
          style={{
            position: "absolute",
            left: 41,
            top: 40,
            width: 6,
            height: ROW * 5 * line,
            borderRadius: 3,
            background: C.line,
          }}
        />
        {STEPS.map((st, i) => {
          const start = STEP0 + i * GAP;
          const p = appear(frame, start, 14);
          return (
            <div
              key={st.t}
              style={{
                position: "absolute",
                top: i * ROW,
                left: 0,
                right: 0,
                display: "flex",
                alignItems: "center",
                gap: 36,
                opacity: p,
                translate: `${(1 - p) * 60}px 0px`,
              }}
            >
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: 44,
                  background: st.you ? C.accent : C.bg2,
                  border: `3px solid ${st.you ? C.accent : C.line}`,
                  color: st.you ? "#16140A" : C.white,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 44,
                  fontWeight: 900,
                  flexShrink: 0,
                }}
              >
                {i + 1}
              </div>
              <div>
                <div style={{ fontSize: 58, fontWeight: 900, display: "flex", alignItems: "center", gap: 20 }}>
                  {st.t}
                  {st.you ? (
                    <span
                      style={{
                        fontSize: 26,
                        letterSpacing: 3,
                        padding: "8px 16px",
                        borderRadius: 999,
                        background: C.accent,
                        color: "#16140A",
                      }}
                    >
                      YOU APPROVE
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 36, color: C.dim, fontWeight: 500, marginTop: 4 }}>{st.s}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div
        style={{
          position: "absolute",
          left: 90,
          right: 90,
          bottom: 190,
          padding: "26px 34px",
          borderRadius: 28,
          border: `1px dashed ${C.line}`,
          fontSize: 32,
          lineHeight: 1.45,
          color: C.dim,
          opacity: appear(frame, STEP0 + GAP * 6, 14),
        }}
      >
        <span style={{ color: C.white, fontWeight: 700 }}>Reads first:</span> the 136-reel study →
        the 18 named styles → that style&apos;s playbook
      </div>
    </Bg>
  );
};
