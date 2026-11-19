import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Caption, Chapter, Serif, appear, ease, usePop, vanish } from "../theme";

export const BEAT = 120;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Hero: React.FC<{
  value: (t: number) => string;
  label: string;
  caption: React.ReactNode;
  visual: React.ReactNode;
}> = ({ value, label, caption, visual }) => {
  const frame = useCurrentFrame();
  const pop = usePop(0);
  const count = interpolate(frame, [0, 26], [0, 1], { ...clamp, easing: ease });
  const out = vanish(frame, BEAT - 8, 8);
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <AbsoluteFill
        style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 420 }}
      >
        <div
          style={{
            fontSize: 300,
            fontWeight: 900,
            letterSpacing: -10,
            lineHeight: 1,
            color: C.accent,
            scale: 0.6 + pop * 0.4,
            opacity: Math.min(1, pop * 2),
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value(count)}
        </div>
        <div style={{ fontSize: 96, marginTop: 10, opacity: appear(frame, 6, 10) }}>
          <Serif>{label}</Serif>
        </div>
        <div style={{ marginTop: 110, width: 900 }}>{visual}</div>
      </AbsoluteFill>
      <Caption from={14} bottom={260}>
        {caption}
      </Caption>
    </AbsoluteFill>
  );
};

// 0–90 s axis with the 30–65 s band and the median marker.
const LengthBar: React.FC = () => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [10, 40], [0, 1], { ...clamp, easing: ease });
  const x = (s: number) => (s / 90) * 100;
  return (
    <div style={{ position: "relative", height: 150 }}>
      <div
        style={{ position: "absolute", top: 50, left: 0, right: 0, height: 24, borderRadius: 12, background: C.faint }}
      />
      <div
        style={{
          position: "absolute",
          top: 50,
          left: `${x(30)}%`,
          width: `${(x(65) - x(30)) * p}%`,
          height: 24,
          borderRadius: 12,
          background: "rgba(255,216,77,0.45)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 30,
          left: `${x(44.6)}%`,
          width: 8,
          height: 64,
          marginLeft: -4,
          borderRadius: 4,
          background: C.accent,
          opacity: p,
        }}
      />
      {[0, 30, 65, 90].map((s) => (
        <div
          key={s}
          style={{
            position: "absolute",
            top: 100,
            left: `${x(s)}%`,
            translate: "-50% 0px",
            fontSize: 34,
            color: C.dim,
            fontWeight: 700,
          }}
        >
          {s}s
        </div>
      ))}
    </div>
  );
};

// A strip of shots scrolling past, roughly 1.4 s each.
const ShotStrip: React.FC = () => {
  const frame = useCurrentFrame();
  const widths = [64, 90, 52, 140, 70, 46, 110, 58, 84, 62, 120, 48, 76, 96, 54, 88];
  return (
    <div style={{ position: "relative", height: 140, overflow: "hidden", borderRadius: 18 }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          display: "flex",
          gap: 6,
          translate: `${-frame * 4}px 0px`,
        }}
      >
        {[...widths, ...widths].map((w, i) => (
          <div
            key={i}
            style={{
              width: w * 1.4,
              height: 140,
              borderRadius: 12,
              background: i % 2 ? "rgba(255,255,255,0.18)" : "rgba(255,216,77,0.35)",
            }}
          />
        ))}
      </div>
    </div>
  );
};

// Waveform that starts at the very left edge: talking from frame one.
const Wave: React.FC = () => {
  const frame = useCurrentFrame();
  const bars = 46;
  const head = interpolate(frame, [6, 100], [0, 1], clamp);
  return (
    <div style={{ position: "relative", height: 160, display: "flex", alignItems: "center", gap: 8 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 30 + Math.abs(Math.sin(i * 1.7) * 90 + Math.cos(i * 0.6) * 30);
        const on = i / bars < head;
        return (
          <div
            key={i}
            style={{
              width: 12,
              height: h,
              borderRadius: 6,
              background: on ? C.accent : "rgba(255,255,255,0.22)",
            }}
          />
        );
      })}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: -30,
          bottom: -30,
          width: 4,
          background: C.white,
          translate: `${head * 900}px 0px`,
        }}
      />
    </div>
  );
};

// Loudness meter filling to the −14 LUFS mark.
const Meter: React.FC = () => {
  const frame = useCurrentFrame();
  const fill = interpolate(frame, [8, 50], [0, 0.72], { ...clamp, easing: ease });
  return (
    <div style={{ position: "relative", height: 150 }}>
      <div
        style={{ position: "absolute", top: 40, left: 0, right: 0, height: 56, borderRadius: 16, background: C.faint, overflow: "hidden" }}
      >
        <div
          style={{
            width: `${fill * 100}%`,
            height: "100%",
            background: `linear-gradient(90deg, rgba(255,216,77,0.3), ${C.accent})`,
          }}
        />
      </div>
      <div
        style={{ position: "absolute", top: 20, left: "72%", width: 6, height: 96, marginLeft: -3, background: C.white }}
      />
      <div
        style={{ position: "absolute", top: 112, left: "72%", translate: "-50% 0px", fontSize: 34, fontWeight: 700 }}
      >
        −14
      </div>
    </div>
  );
};

export const Numbers: React.FC = () => {
  return (
    <Bg>
      <Chapter n="03" label="What the numbers say" />
      <Sequence durationInFrames={BEAT} layout="absolute-fill" name="Length">
        <Hero
          value={(t) => `${(44.6 * t).toFixed(1)}s`}
          label="median length"
          caption={
            <>
              Most reels run <span style={{ color: C.accent }}>30–65 seconds</span>.
            </>
          }
          visual={<LengthBar />}
        />
      </Sequence>
      <Sequence from={BEAT} durationInFrames={BEAT} layout="absolute-fill" name="Shot">
        <Hero
          value={(t) => `${(1.4 * t).toFixed(1)}s`}
          label="per shot"
          caption={
            <>
              2,539 shots measured.
              <br />
              Tours cut every <span style={{ color: C.accent }}>1.1–1.3 s</span>.
            </>
          }
          visual={<ShotStrip />}
        />
      </Sequence>
      <Sequence from={BEAT * 2} durationInFrames={BEAT} layout="absolute-fill" name="FirstWord">
        <Hero
          value={(t) => `${(0.5 * t).toFixed(1)}s`}
          label="to the first word"
          caption={
            <>
              <span style={{ color: C.accent }}>95 of 109</span> talking reels
              <br />
              open with no intro.
            </>
          }
          visual={<Wave />}
        />
      </Sequence>
      <Sequence from={BEAT * 3} durationInFrames={BEAT} layout="absolute-fill" name="Loudness">
        <Hero
          value={(t) => `−${Math.round(14 * t)}`}
          label="LUFS loudness"
          caption={
            <>
              Instagram&apos;s own level,
              <br />
              so every export <span style={{ color: C.accent }}>matches it</span>.
            </>
          }
          visual={<Meter />}
        />
      </Sequence>
    </Bg>
  );
};
