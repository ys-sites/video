import { createTimelineRowGeometry, type TimelineRowGeometry } from "./timelineLayout";

/** Center spare vertical space in the same geometry used by drawing and hit tests.
 * The natural geometry supplies minimum padding, so short viewports can scroll
 * without reserving a full empty track above the content. Bottom padding retains
 * the drop target; tracks center exactly whenever both minimum pads fit.
 */
export function centerTimelineTracks(geometry: TimelineRowGeometry, viewportHeight: number): TimelineRowGeometry {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= geometry.canvasHeight || !geometry.rowKeys.length) return geometry;
  const spare = viewportHeight - geometry.canvasHeight + geometry.padding.top + geometry.padding.bottom;
  const top = Math.max(geometry.padding.top, Math.min(spare / 2, spare - geometry.padding.bottom));
  return createTimelineRowGeometry(geometry.rowKeys, geometry.rowHeights, {
    top,
    bottom: spare - top,
  });
}
