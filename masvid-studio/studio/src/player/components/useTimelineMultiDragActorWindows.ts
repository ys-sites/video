import { isMultiDragActive, multiDragDeltaSeconds } from "./timelineMultiDragPreview";
import type { MultiDragPreviewInput } from "./timelineMultiDragPreview";
import type { TimelineTimeRange } from "../lib/timelineClipIndex";

/** The extra render window a live multi-drag needs: its passengers still draw
 *  at their ORIGIN position, offset by the drag delta, outside the normal
 *  virtualized range. Empty when nothing is dragging. */
export function useTimelineMultiDragActorWindows(
  multiDragPreview: MultiDragPreviewInput | null,
  rowsVirtualized: boolean,
  renderTimeRange: TimelineTimeRange,
) {
  if (rowsVirtualized && multiDragPreview?.offsets) {
    const byDelta = new Map<number, Set<string>>();
    for (const [key, delta] of multiDragPreview.offsets) {
      if (delta === 0 || key === multiDragPreview.draggedKey) continue;
      const keys = byDelta.get(delta) ?? new Set<string>();
      keys.add(key);
      byDelta.set(delta, keys);
    }
    return [...byDelta].map(([delta, identities]) => ({
      range: { start: renderTimeRange.start - delta, end: renderTimeRange.end - delta }, identities,
    }));
  }
  const multiDragDelta =
    multiDragPreview && isMultiDragActive(multiDragPreview)
      ? multiDragDeltaSeconds(multiDragPreview)
      : 0;
  const actorWindows =
    rowsVirtualized && multiDragPreview && multiDragDelta !== 0
      ? [
          {
            range: {
              start: renderTimeRange.start - multiDragDelta,
              end: renderTimeRange.end - multiDragDelta,
            },
            identities: multiDragPreview.selectedKeys,
          },
        ]
      : [];
  return actorWindows;
}
