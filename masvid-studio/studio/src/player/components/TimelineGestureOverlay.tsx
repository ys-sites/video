import { useI18n } from "../../i18n/I18n";
import { memo } from "react";
import type { TimelineTheme } from "./timelineTheme";
import { getRenderedTimelineElement } from "./timelineTheme";
import { CLIP_Y, type TimelineRowGeometry } from "./timelineLayout";
import { TimelineClip } from "./TimelineClip";
import { getTimelineEditCapabilities } from "./timelineEditing";
import { renderClipChildren } from "./timelineClipChildren";
import type { DraggedClipState } from "./timelineClipDragTypes";
import type { TrackVisualStyle } from "./timelineIcons";
import { isTimelineClipActive } from "./useTimelineActiveClips";
import type { TimelineProps } from "./TimelineTypes";
import { getTimelineDragOverlayPosition } from "./timelineClipDragPreview";
import { TimelineTimeLayer } from "./TimelineTimeLayer";

interface TimelineGestureOverlayProps {
  drag: DraggedClipState | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  rowHeight: number;
  contentOrigin: number;
  rowGeometry: TimelineRowGeometry;
  selectedElementId: string | null;
  currentTime: number;
  theme: TimelineTheme;
  getTrackStyle: (tag: string) => TrackVisualStyle;
  renderClipContent?: TimelineProps["renderClipContent"];
  renderClipOverlay?: TimelineProps["renderClipOverlay"];
}

/** Stable canvas child that owns the live drag actor independently of source rows. */
export const TimelineGestureOverlay = memo(function TimelineGestureOverlay({
  drag,
  scrollRef,
  pixelsPerSecond,
  rowHeight,
  contentOrigin,
  rowGeometry,
  selectedElementId,
  currentTime,
  theme,
  getTrackStyle,
  renderClipContent,
  renderClipOverlay,
}: TimelineGestureOverlayProps) {
  const { t } = useI18n();
  if (!drag?.started)
    return <div data-timeline-gesture-overlay className="absolute inset-0 pointer-events-none" />;
  const element = getRenderedTimelineElement({
    element: drag.element,
    draggedElementId: drag.element.key ?? drag.element.id,
    previewStart: drag.previewStart,
    previewTrack: drag.previewTrack,
  });
  const insertRow = drag.insertRow;
  // Keep the actor under the pointer; the landing outline owns collision-resolved lane feedback.
  const landingRow = insertRow ?? rowGeometry.getRowIndex(drag.previewTrack);
  const pointerPosition = drag.pointerId === null ? null : getTimelineDragOverlayPosition(drag, scrollRef.current);
  const position = landingRow < 0 ? null : {
    left: pointerPosition?.left ?? contentOrigin + drag.previewStart * pixelsPerSecond,
    top: pointerPosition?.top ?? rowGeometry.getRowTop(landingRow) + CLIP_Y,
  };
  const clipWidth = Math.max(element.duration * pixelsPerSecond, 4);
  return (
    <div data-timeline-gesture-overlay className="absolute inset-0 pointer-events-none">
      {position && (
        <div
          data-timeline-gesture-actor={element.key ?? element.id}
          className="absolute"
          style={{
            top: position.top,
            left: position.left,
            width: clipWidth,
            height: rowHeight,
            zIndex: 40,
          }}
        >
          {insertRow !== null && (
            <span
              data-timeline-new-track-label
              role="status"
              className="sr-only"
            >
              {t("+ New track")}<span className="sr-only">{t(", before track")}{" "}{insertRow + 1}</span>
            </span>
          )}
          {drag.invalidDrop && (
            <span role="status" className="om-badge absolute bottom-full left-0 z-10">
              {t("Cannot drop here")}
            </span>
          )}
          <TimelineTimeLayer pixelsPerSecond={pixelsPerSecond}>
            <TimelineClip
              el={{ ...element, start: 0 }}
              pps={pixelsPerSecond}
              clipY={0}
              isSelected={selectedElementId === (element.key ?? element.id)}
              isHovered={false}
              isDragging
              isGestureActor
              isActive={isTimelineClipActive(element, currentTime)}
              hasCustomContent={!!renderClipContent}
              capabilities={getTimelineEditCapabilities(element)}
              theme={theme}
              isComposition={!!element.compositionSrc}
              onHoverStart={() => {}}
              onHoverEnd={() => {}}
              onResizeStart={() => {}}
              onClick={() => {}}
              onDoubleClick={() => {}}
            >
              {renderClipChildren(
                element,
                getTrackStyle(element.tag),
                renderClipContent,
                renderClipOverlay,
                { priority: "interaction", rich: false },
              )}
            </TimelineClip>
          </TimelineTimeLayer>
        </div>
      )}
    </div>
  );
});
