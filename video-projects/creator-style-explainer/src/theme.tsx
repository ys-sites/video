import React from "react";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export const { fontFamily: SANS } = loadInter("normal", {
  weights: ["500", "700", "900"],
  subsets: ["latin"],
});
export const { fontFamily: SERIF } = loadPlayfair("italic", {
  weights: ["700"],
  subsets: ["latin"],
});

// White + one accent, as the study recommends.
export const C = {
  bg: "#0C0C11",
  bg2: "#1A1A24",
  white: "#FFFFFF",
  dim: "rgba(255,255,255,0.62)",
  faint: "rgba(255,255,255,0.10)",
  card: "rgba(255,255,255,0.07)",
  line: "rgba(255,255,255,0.16)",
  accent: "#FFD84D",
  red: "#FF4D5E",
};

export const ease = Easing.bezier(0.16, 1, 0.3, 1);

/** 0 → 1 over `dur` frames starting at `start`. */
export const appear = (frame: number, start: number, dur = 12) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

/** 1 → 0 over `dur` frames starting at `start`. */
export const vanish = (frame: number, start: number, dur = 10) =>
  1 - appear(frame, start, dur);

export const usePop = (start: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - start,
    fps,
    config: { damping: 13, stiffness: 190, mass: 0.7 },
  });
};

export const Bg: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        backgroundColor: C.bg,
        backgroundImage: `radial-gradient(1200px 1200px at ${50 + Math.sin(frame / 60) * 8}% ${
          30 + Math.cos(frame / 75) * 6
        }%, ${C.bg2} 0%, ${C.bg} 70%)`,
        fontFamily: SANS,
        color: C.white,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Small tracked chapter label at the top of the frame. */
export const Chapter: React.FC<{ n: string; label: string }> = ({ n, label }) => {
  const frame = useCurrentFrame();
  const o = appear(frame, 0, 10);
  return (
    <div
      style={{
        position: "absolute",
        top: 170,
        left: 90,
        right: 90,
        display: "flex",
        gap: 18,
        alignItems: "center",
        opacity: o,
        translate: `${(1 - o) * -30}px 0px`,
        fontSize: 34,
        fontWeight: 700,
        letterSpacing: 6,
        textTransform: "uppercase",
      }}
    >
      <span style={{ color: C.accent }}>{n}</span>
      <span style={{ width: 60, height: 3, background: C.line }} />
      <span style={{ color: C.dim }}>{label}</span>
    </div>
  );
};

/** Small running caption (tier one of the two-tier text system). */
export const Caption: React.FC<{
  from: number;
  to?: number;
  children: React.ReactNode;
  bottom?: number;
}> = ({ from, to, children, bottom = 230 }) => {
  const frame = useCurrentFrame();
  const o = appear(frame, from, 8) * (to === undefined ? 1 : vanish(frame, to, 8));
  if (o <= 0) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 90,
        right: 90,
        bottom,
        textAlign: "center",
        fontSize: 52,
        fontWeight: 700,
        lineHeight: 1.2,
        opacity: o,
        translate: `0px ${(1 - o) * 24}px`,
        textShadow: "0 4px 24px rgba(0,0,0,0.6)",
      }}
    >
      {children}
    </div>
  );
};

export const Accent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: C.accent }}>{children}</span>
);

export const Serif: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color,
}) => (
  <span style={{ fontFamily: SERIF, fontStyle: "italic", fontWeight: 700, color }}>
    {children}
  </span>
);
