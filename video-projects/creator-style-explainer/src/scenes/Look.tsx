import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Bg, C, Chapter, SANS, Serif, appear, ease, usePop, vanish } from "../theme";

const PHONE_W = 600;
const PHONE_H = 1066;

// A stand-in presenter: no real person or footage is used.
const Presenter: React.FC = () => (
  <div
    style={{
      position: "absolute",
      left: "50%",
      bottom: 0,
      translate: "-50% 0px",
      width: 380,
      height: 640,
    }}
  >
    <div
      style={{
        position: "absolute",
        left: 105,
        top: 40,
        width: 170,
        height: 210,
        borderRadius: "50%",
        background: "linear-gradient(160deg, #f1c9a5, #b98763)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 270,
        width: 380,
        height: 420,
        borderRadius: "190px 190px 0 0",
        background: "linear-gradient(180deg, #2E3A59, #1B2238)",
      }}
    />
  </div>
);

const Pill: React.FC<{ start: number; children: React.ReactNode }> = ({ start, children }) => {
  const pop = usePop(start);
  return (
    <div
      style={{
        padding: "16px 28px",
        borderRadius: 999,
        background: C.card,
        border: `1px solid ${C.line}`,
        fontSize: 34,
        fontWeight: 700,
        opacity: Math.min(1, pop * 1.5),
        scale: 0.8 + pop * 0.2,
      }}
    >
      {children}
    </div>
  );
};

export const Look: React.FC = () => {
  const frame = useCurrentFrame();
  const phone = usePop(0);
  const word1 = appear(frame, 30, 14) * vanish(frame, 150, 8);
  const word2 = appear(frame, 160, 12);
  const strike = interpolate(frame, [185, 205], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const cap1 = appear(frame, 14, 8) * vanish(frame, 150, 8);
  const cap2 = appear(frame, 160, 8);
  return (
    <Bg>
      <Chapter n="04" label="The look" />
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 270 }}>
        <div
          style={{
            position: "relative",
            width: PHONE_W,
            height: PHONE_H,
            borderRadius: 64,
            overflow: "hidden",
            border: "10px solid #2A2A35",
            background: "linear-gradient(180deg, #8EC5FF 0%, #E9D7B8 62%, #7F9C6B 100%)",
            scale: 0.85 + phone * 0.15,
            opacity: Math.min(1, phone * 1.5),
            fontFamily: SANS,
          }}
        >
          {/* Big word sits BEHIND the presenter */}
          <div
            style={{
              position: "absolute",
              top: 330,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 168,
              fontWeight: 900,
              letterSpacing: -6,
              color: C.white,
              textShadow: "0 8px 30px rgba(0,0,0,0.25)",
              opacity: word1,
              translate: `0px ${(1 - word1) * 60}px`,
            }}
          >
            VISUAL
          </div>
          <div
            style={{
              position: "absolute",
              top: 330,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 168,
              fontWeight: 900,
              letterSpacing: -6,
              color: C.accent,
              textShadow: "0 8px 30px rgba(0,0,0,0.3)",
              opacity: word2,
              scale: 0.9 + word2 * 0.1,
            }}
          >
            <span style={{ position: "relative" }}>
              STILL
              <span
                style={{
                  position: "absolute",
                  left: -10,
                  top: "52%",
                  height: 18,
                  width: `${strike * 108}%`,
                  borderRadius: 9,
                  background: C.red,
                  rotate: "-4deg",
                }}
              />
            </span>
          </div>
          <Presenter />
          {/* Small running caption */}
          <div
            style={{
              position: "absolute",
              bottom: 120,
              left: 30,
              right: 30,
              textAlign: "center",
              fontSize: 44,
              fontWeight: 700,
              color: C.white,
              textShadow: "0 3px 14px rgba(0,0,0,0.7)",
            }}
          >
            <div style={{ opacity: cap1, position: "absolute", left: 0, right: 0 }}>
              every idea gets a
            </div>
            <div style={{ opacity: cap2, position: "absolute", left: 0, right: 0 }}>
              the screen is never
            </div>
          </div>
        </div>
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: 1400,
          left: 70,
          right: 70,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 18,
        }}
      >
        <Pill start={20}>small running caption</Pill>
        <Pill start={40}>
          one <Serif color={C.accent}>huge</Serif> word
        </Pill>
        <Pill start={70}>word behind the person</Pill>
        <Pill start={100}>white + one accent</Pill>
        <Pill start={195}>
          <span style={{ color: C.red }}>strike-through</span> to correct
        </Pill>
      </div>
    </Bg>
  );
};
