import { useI18n } from "../../i18n/I18n";
import { memo, useEffect } from "react";
import { useMvpEditor } from "../../motion/StudioHost";
import { TimelineMediaBar } from '../../motion/TimelineMediaBar';
import { usePlayerStore } from "../store/playerStore";
import { TimelineColumnResize } from './TimelineColumnResize';
import type { TimelineProps } from "./TimelineTypes";
import { TimelineProvider, useTimelineContext } from "./TimelineProvider";
import {
  TimelineEmptyStatePart,
  TimelineEditPopover,
  TimelineClipMenu,
  TimelineFrame,
  TimelineGapMenu,
  TimelineKeyframeMenu,
  TimelineLanes,
  TimelineOverlays,
  TimelinePlayhead,
  TimelineRazorGuide,
  TimelineRuler,
  TimelineShortcutHint,
} from "./TimelineParts";

export * from "./TimelineProvider";
export {
  shouldAutoScrollTimeline,
  getTimelineScrollLeftForZoomTransition,
  getTimelineScrollLeftForZoomAnchor,
  getTimelinePlaybackFollowScrollLeft,
  getTimelinePlayheadLeft,
  getTimelineCanvasHeight,
  shouldShowTimelineShortcutHint,
  resolveTimelineAssetDrop,
  getDefaultDroppedTrack,
} from "./timelineLayout";
export { formatTimelineTickLabel, generateTicks } from "./timelineRulerGeometry";
export {
  getTimelineScrollTopForGeometryChange,
  getTimelineVisibleTimeRange,
} from "./timelineViewportGeometry";

function TimelineView({ onContentHeightChange }: Pick<TimelineProps, "onContentHeightChange">) {
  const { t } = useI18n();
  const { state, meta } = useTimelineContext();
  const { timelineReady, elements, canvas } = state;
  const hasPending = usePlayerStore(s => s.pendingAssetDrops.length > 0);
  const changing = Boolean(canvas.draggedElement || canvas.resizingClip);
  useEffect(() => {
    if (timelineReady && !changing) onContentHeightChange?.(elements.length || hasPending ? canvas.intrinsicHeight : 128);
  }, [timelineReady, changing, elements.length, hasPending, canvas.intrinsicHeight, onContentHeightChange]);
  if (!timelineReady || (elements.length === 0 && !hasPending)) {
    return <TimelineEmptyStatePart />;
  }
  return (
    <div {...meta.containerProps} aria-label={t(meta.containerProps["aria-label"])}>
      <div {...meta.viewportProps}>
        <TimelineFrame />
        <TimelineRazorGuide />
      </div>
      <TimelineOverlays />
      <TimelineColumnResize />
    </div>
  );
}

const TimelineComposed = memo(function TimelineComposed(props: TimelineProps = {}) {
  const mvp = useMvpEditor();
  return (
    <TimelineProvider {...props} showAudioEffects={mvp ? false : props.showAudioEffects} showKeyframes={mvp ? false : props.showKeyframes}>
      <TimelineView onContentHeightChange={props.onContentHeightChange} />
      <TimelineMediaBar />
    </TimelineProvider>
  );
});

export const Timeline = Object.assign(TimelineComposed, {
  Provider: TimelineProvider,
  Frame: TimelineFrame,
  Ruler: TimelineRuler,
  Lanes: TimelineLanes,
  Playhead: TimelinePlayhead,
  RazorGuide: TimelineRazorGuide,
  ShortcutHint: TimelineShortcutHint,
  EditPopover: TimelineEditPopover,
  ClipMenu: TimelineClipMenu,
  KeyframeMenu: TimelineKeyframeMenu,
  GapMenu: TimelineGapMenu,
  EmptyState: TimelineEmptyStatePart,
  Overlays: TimelineOverlays,
});
