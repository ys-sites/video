// fallow-ignore-file dead-code
/**
 * Shared playhead visual used by TimelineCanvas (real playhead) and
 * TimelineEditorNotice (animated illustration).
 *
 * The vertical line spans the full track height; the grab-handle HEAD is
 * `position: sticky; top: 0` so it pins to the top of the (vertically) scrolling
 * track area — the ruler is sticky too, so the head stays visible and grabbable
 * no matter how far the tracks are scrolled. The solid head points down to the line.
 */
import { TimelinePlayheadMark } from "../../../../packages/design-system/react/TimelinePlayheadMark";
import { PLAYHEAD_HEAD_W } from "./timelineLayout";

/** Widest part of the playhead, centred on its line. */
export const PLAYHEAD_MARK_W = 13;

interface PlayheadIndicatorProps {
  /** CSS color, defaults to the HF accent variable */
  color?: string;
  /** Surface behind the pinned head; must match the timeline ruler. */
  headBackground?: string;
  /** Whether the playhead is being actively scrubbed. */
  scrubbing?: boolean;
  /**
   * When false, the head chip is absolutely positioned instead of using the
   * sticky pin — used by the static illustration where there is no scroll area.
   */
  stickyHead?: boolean;
}

export function PlayheadIndicator({
  color = "var(--color-playhead)",
  headBackground = "var(--timeline-shell-bg)",
  scrubbing = false,
  stickyHead = true,
}: PlayheadIndicatorProps) {
  // Keep the existing wrapper width and time-origin math. The wider marker is
  // centered on the same time coordinate, with its tip meeting the line.
  const HEAD_W = PLAYHEAD_HEAD_W;
  const HEAD_H = 15;
  const HEAD_INSET = 2;
  const HEAD_TOTAL_H = HEAD_INSET + HEAD_H;

  return (
    <>
      {/* Vertical line begins at the marker tip. */}
      <div
        className="absolute bottom-0"
        style={{
          left: "50%",
          top: HEAD_TOTAL_H,
          width: 2,
          marginLeft: -1,
          background: color,
        }}
      />
      {/* Head chip — sticky so it pins to the ruler while tracks scroll.
          Centering logic: wrapper width = HEAD_W (chip forces it). The line sits
          at wrapper.left + HEAD_W/2 (left:"50%" of wrapper). The sticky element's
          natural flow position is wrapper.left; so placing it there with no
          horizontal translate puts its LEFT edge at wrapper.left and its CENTER
          at wrapper.left + HEAD_W/2 — exactly on the line. */}
      <div
        data-timeline-playhead-head=""
        className={stickyHead ? "sticky" : "absolute"}
        style={{
          left: 0,
          top: 0,
          width: HEAD_W,
          height: HEAD_TOTAL_H,
          // The line scrolls behind the pinned head. Mask it above the lower
          // tip so scrolling never paints the line above the marker. Match the
          // ruler surface so the mask does not leave a contrasting rectangle.
          background: stickyHead ? headBackground : undefined,
        }}
      >
        <TimelinePlayheadMark
          data-scrubbing={scrubbing || undefined}
          width={PLAYHEAD_MARK_W}
          height={HEAD_H}
          style={{ position: "absolute", top: HEAD_INSET, left: (HEAD_W - PLAYHEAD_MARK_W) / 2, color }}
        />
      </div>
    </>
  );
}
