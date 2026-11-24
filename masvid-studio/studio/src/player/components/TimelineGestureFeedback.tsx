import { useI18n } from "../../i18n/I18n";
import { formatTime } from "../lib/time";
import { RULER_H } from "./timelineLayout";
import { useTimelineContext } from "./TimelineProvider";

const preciseTime = (time: number) => {
  const value = Math.round(time * 100);
  return `${formatTime(value / 100)}.${String(value % 100).padStart(2, "0")}`;
};

/** Readout belongs to the landing, not the free-moving pointer ghost. */
export function TimelineGestureFeedback() {
  const { t } = useI18n();
  const { state } = useTimelineContext();
  const { draggedClip: drag, resizingClip: resize, scrollRef, contentOrigin, pps, displayTrackOrder, rowGeometry, snapGuide } = state.canvas;
  const moving = drag?.started ? drag : null;
  const trimming = resize?.started ? resize : null;
  const viewport = scrollRef.current;
  if ((!moving && !trimming) || !viewport) return null;
  const start = moving?.previewStart ?? trimming!.previewStart;
  const duration = moving?.element.duration ?? trimming!.previewDuration;
  const row = moving?.insertRow ?? displayTrackOrder.indexOf(moving?.previewTrack ?? trimming!.element.track);
  const width = Math.min(240, Math.max(0, viewport.clientWidth - contentOrigin - 8));
  const left = Math.min(Math.max(contentOrigin + start * pps, viewport.scrollLeft + contentOrigin), viewport.scrollLeft + viewport.clientWidth - width - 4);
  const top = Math.max(viewport.scrollTop + RULER_H, Math.min(rowGeometry.getRowTop(Math.max(0, row)) - 26, viewport.scrollTop + viewport.clientHeight - 24));
  return <div data-timeline-gesture-feedback aria-hidden="true" className="motion-placement-label"
    data-snapped={Boolean(snapGuide) || undefined} style={{ left, top, maxWidth: width }}>
    <span>{`${t("Track")} ${row + 1}`}</span>
    <strong>{preciseTime(start)}{width >= 200 ? ` → ${preciseTime(start + duration)}` : ""}</strong>
  </div>;
}
