import React from "react";
import { Composition, Folder } from "remotion";
import { Explainer, SCENES, TOTAL } from "./Explainer";

const W = 1080;
const H = 1920;
const FPS = 30;

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CreatorStyleExplainer"
        component={Explainer}
        durationInFrames={TOTAL}
        fps={FPS}
        width={W}
        height={H}
      />
      <Folder name="Scenes">
        {SCENES.map((s) => (
          <Composition
            key={s.id}
            id={s.id}
            component={s.component}
            durationInFrames={s.duration}
            fps={FPS}
            width={W}
            height={H}
          />
        ))}
      </Folder>
    </>
  );
};
