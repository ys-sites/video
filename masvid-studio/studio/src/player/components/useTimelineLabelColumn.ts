import { useMemo, useState } from "react";
import { usePlayerStore } from "../store/playerStore";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { useMvpEditor } from "../../motion/StudioHost";
import type { GsapAnimation } from "@hyperframes/core/gsap-parser";
import type { TimelineElement } from "../store/playerStore";
import { GUTTER, LABEL_COL_W, MVP_LABEL_COL_W, TRACKS_LEFT_PAD } from "./timelineLayout";
import { timelineNeedsLabelColumn } from "./timelineViewModel";

export function useTimelineLabelColumn(
  animationsByElement: ReadonlyMap<string, readonly GsapAnimation[]>,
  elements: readonly TimelineElement[],
  viewportWidth: number,
) {
  const mvp = useMvpEditor();
  const projectId = usePlayerStore(state => state.timelineProjectId);
  const saved = useMemo(() => readStudioUiPreferences(undefined, projectId).timelineLabelWidth ?? MVP_LABEL_COL_W, [projectId]);
  const [draft, setDraft] = useState({ projectId, width: saved });
  const preferred = draft.projectId === projectId ? draft.width : saved;
  const labelMode = useMemo(
    () => mvp || timelineNeedsLabelColumn(animationsByElement, elements),
    [mvp, animationsByElement, elements],
  );
  // The label column provides pre-t=0 space; otherwise keep TRACKS_LEFT_PAD after the gutter.
  // Keep room for icon controls without consuming most of a phone's timeline.
  // All time/pixel mapping consumes this same origin, including scrubbing and asset drops.
  const max = viewportWidth > 0 ? Math.min(320, Math.max(104, Math.floor(viewportWidth / 3))) : 320;
  const mvpLabelWidth = Math.min(preferred, max);
  const contentOrigin = labelMode ? (mvp ? mvpLabelWidth : LABEL_COL_W + GUTTER) : GUTTER + TRACKS_LEFT_PAD;
  const labelColumn = mvp ? { width: mvpLabelWidth, min: 104, max,
    resize: (width: number, commit = false) => {
      const next = Math.max(104, Math.min(max, width));
      setDraft({ projectId, width: next });
      if (commit) writeStudioUiPreferences({ timelineLabelWidth: next }, undefined, projectId);
    },
  } : undefined;
  return { labelMode, contentOrigin, contentGutter: labelMode && !mvp ? GUTTER : 0, labelColumn };
}
