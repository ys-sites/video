import React from "react";
import { Audio } from "@remotion/media";
import { ding, mouseClick, whoosh } from "@remotion/sfx";
import { TransitionSeries, linearTiming, type TransitionPresentation } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { wipe } from "@remotion/transitions/wipe";
import { Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { C } from "./theme";
import { Hook } from "./scenes/Hook";
import { Measured } from "./scenes/Measured";
import { Types } from "./scenes/Types";
import { Numbers } from "./scenes/Numbers";
import { Look } from "./scenes/Look";
import { Endings } from "./scenes/Endings";
import { Workflow } from "./scenes/Workflow";
import { Example } from "./scenes/Example";
import { Outro } from "./scenes/Outro";

export const SCENES = [
  { id: "Hook", component: Hook, duration: 120 },
  { id: "Measured", component: Measured, duration: 300 },
  { id: "Types", component: Types, duration: 270 },
  { id: "Numbers", component: Numbers, duration: 480 },
  { id: "Look", component: Look, duration: 300 },
  { id: "Endings", component: Endings, duration: 240 },
  { id: "Workflow", component: Workflow, duration: 420 },
  { id: "Example", component: Example, duration: 300 },
  { id: "Outro", component: Outro, duration: 180 },
] as const;

const T = 10; // transition length in frames

export const TOTAL =
  SCENES.reduce((sum, s) => sum + s.duration, 0) - T * (SCENES.length - 1);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const presentations: TransitionPresentation<any>[] = [
  slide({ direction: "from-bottom" }),
  wipe({ direction: "from-left" }),
  slide({ direction: "from-right" }),
  fade(),
  slide({ direction: "from-bottom" }),
  wipe({ direction: "from-right" }),
  slide({ direction: "from-right" }),
  fade(),
];

// Where each transition starts on the main timeline.
const cutStarts = SCENES.slice(1).map((_, i) =>
  SCENES.slice(0, i + 1).reduce((sum, s) => sum + s.duration, 0) - T * (i + 1),
);

const sceneStart = (id: string) => {
  const i = SCENES.findIndex((s) => s.id === id);
  return i === 0 ? 0 : cutStarts[i - 1];
};

// Click on each hero number as it pops in.
const POPS = [
  2,
  sceneStart("Numbers"),
  sceneStart("Numbers") + 120,
  sceneStart("Numbers") + 240,
  sceneStart("Numbers") + 360,
  sceneStart("Endings") + 4,
];

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: "absolute",
        top: 96,
        left: 90,
        right: 90,
        height: 6,
        borderRadius: 3,
        background: "rgba(255,255,255,0.12)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${interpolate(frame, [0, durationInFrames - 1], [0, 100])}%`,
          background: C.accent,
        }}
      />
    </div>
  );
};

export const Explainer: React.FC = () => {
  return (
    <>
      <TransitionSeries>
        {SCENES.flatMap((s, i) => {
          const Scene = s.component;
          const seq = (
            <TransitionSeries.Sequence key={s.id} name={s.id} durationInFrames={s.duration}>
              <Scene />
            </TransitionSeries.Sequence>
          );
          if (i === SCENES.length - 1) return [seq];
          return [
            seq,
            <TransitionSeries.Transition
              key={`${s.id}-t`}
              presentation={presentations[i]}
              timing={linearTiming({ durationInFrames: T })}
            />,
          ];
        })}
      </TransitionSeries>
      <Progress />
      {/* Original music bed, synthesised by scripts/make_music.py */}
      <Audio src={staticFile("music-bed.wav")} volume={0.55} name="Music bed" />
      {cutStarts.map((f) => (
        <Sequence key={f} from={Math.max(0, f - 4)} durationInFrames={30} name="whoosh">
          <Audio src={whoosh} volume={0.8} />
        </Sequence>
      ))}
      {POPS.map((f) => (
        <Sequence key={`pop-${f}`} from={f} durationInFrames={20} name="pop">
          <Audio src={mouseClick} volume={0.7} />
        </Sequence>
      ))}
      <Sequence from={cutStarts[cutStarts.length - 1] + 18} durationInFrames={60} name="ding">
        <Audio src={ding} volume={0.6} />
      </Sequence>
    </>
  );
};
