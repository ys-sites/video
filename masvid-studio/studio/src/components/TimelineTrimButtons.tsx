import { IconButton } from "open-design-ui/icon-button";
import { useI18n } from "../i18n/I18n";
import { MotionIcon } from "../motion/icons";
import { usePlayerStore } from "../player";
import type { TimelineEditCallbacks } from "../player/components/timelineCallbacks";
import { applyClipStartTrimDelta, clipStartTrimDeltaBounds, resolveTimelineMinDuration } from "../player/components/timelineGroupEditing";
import { clampToHostStart } from "../player/store/timelineElement";
import { flatIdle, flatDisabled } from "./timelineToolbarStyles";
import { Tooltip } from "./ui";

export function TimelineTrimButtons({ onResize }: { onResize?: TimelineEditCallbacks["onResizeElement"] }) {
  const { t } = useI18n();
  const elements = usePlayerStore(s => s.elements);
  const selected = usePlayerStore(s => s.selectedElementId);
  const time = usePlayerStore(s => s.currentTime);
  const element = elements.find(el => (el.key ?? el.id) === selected);
  const minimum = resolveTimelineMinDuration();
  const enabled = !!onResize && element && !element.timelineLocked && time > element.start && time < element.start + element.duration;
  return <>{(["start", "end"] as const).map(edge => {
    const label = t(edge === "start" ? "Trim left to playhead" : "Trim right to playhead");
    const valid = enabled && (edge === "start" ? element.start + element.duration - time : time - element.start) >= minimum;
    return <Tooltip key={edge} label={label}><IconButton variant="plain" type="button" aria-label={label} disabled={!valid}
      className={valid ? flatIdle : flatDisabled} onClick={() => {
        if (!valid || !element) return;
        if (edge === "end") void onResize?.(element, { start: element.start, duration: time - element.start });
        else {
          const bounds = clipStartTrimDeltaBounds(element, clampToHostStart(element, 0), minimum);
          const delta = Math.min(bounds.maxDelta, Math.max(bounds.minDelta, time - element.start));
          void onResize?.(element, applyClipStartTrimDelta(element, delta));
        }
      }} icon={<MotionIcon name={edge === "start" ? "timeline-trim-left" : "timeline-trim-right"} size={16} />} /></Tooltip>;
  })}</>;
}
