import type { TimelineElement } from "../store/playerStore";
import { sameSourceFile } from "./timelineAuthoredTrack";
import { canMoveTimelineElement } from "./timelineAuthoredMoveTarget";
import { classifyZone } from "./timelineZones";

/** Make spill rows durable when a user edits them. Discovery remains read-only.
 * Only the edited source/zone participates; canvas stacking is left untouched. */
export function planTimelineLanePersistence(
  elements: readonly TimelineElement[],
  target: TimelineElement,
): Array<{ element: TimelineElement; track: number }> {
  const peers = elements.filter(e => sameSourceFile(e, target) && classifyZone(e) === classifyZone(target));
  const authoredRows = new Map<number, number>();
  let hasSpill = false;
  for (const e of peers) {
    const authored = e.authoredTrack ?? e.track;
    const row = authoredRows.get(authored);
    if (row != null && row !== e.track) hasSpill = true;
    authoredRows.set(authored, e.track);
  }
  if (!hasSpill) return [];
  const rows = [...new Set(peers.map(e => e.track))].sort((a, b) => a - b);
  const ranks = new Map(rows.map((row, index) => [row, index]));
  const edits = peers.flatMap(element => {
    const track = ranks.get(element.track)!;
    return track === (element.authoredTrack ?? element.track) ? [] : [{ element, track }];
  });
  if (edits.some(({ element }) => !canMoveTimelineElement(element))) {
    throw new Error("Cannot preserve these timeline lanes: a locked clip would have to move.");
  }
  return edits;
}

export function withPersistedTimelineLanes(
  elements: readonly TimelineElement[],
  renumbers: ReturnType<typeof planTimelineLanePersistence>,
): TimelineElement[] {
  const tracks = new Map(renumbers.map(({ element, track }) => [element.key ?? element.id, track]));
  return elements.map(element => {
    const track = tracks.get(element.key ?? element.id);
    return track == null ? element : { ...element, authoredTrack: track };
  });
}
