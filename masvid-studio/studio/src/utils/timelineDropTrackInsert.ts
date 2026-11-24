import type { TimelineElement } from "../player";
import { layoutAfterTrackInsert } from "../player/components/timelineDragLanding";
import { canMoveTimelineElement } from "../player/components/timelineAuthoredMoveTarget";
import { resolveZoneDropPlacement } from "../player/components/timelineCollision";
import { authoredTrackForLane } from "../player/components/timelineAuthoredTrack";
import { isAudioTimelineElement } from "./timelineInspector";
import type { TimelineDropPlacement } from "../player/components/timelineCallbacks";
import { applyPatchByTarget, readAttributeByTarget, readTagSnippetByTarget, readTagAttribute } from "./sourcePatcher";
import { buildPatchTarget } from "../hooks/timelineEditingHelpers";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { planTimelineLanePersistence, withPersistedTimelineLanes } from "../player/components/timelineLanePersistence";
import { normalizeToZones } from "../player/components/timelineZones";

export interface DropTrackInsertPlan {
  /** Lane the dropped clip is written on. */
  track: number;
  /** Existing clips whose lane changes to make room. */
  renumbers: Array<{ element: TimelineElement; track: number }>;
}

/** Plan a new lane at boundary `insertRow` with the renumber a clip drag into a gutter uses.
 *  Null when a locked clip would have to move. */
export function planDropTrackInsert(input: {
  elements: TimelineElement[];
  /** The row order the timeline shows (anchor rows included), which `insertRow` indexes. */
  trackOrder: readonly number[];
  insertRow: number;
  dropped: Pick<TimelineElement, "id" | "tag" | "start" | "duration">;
}): DropTrackInsertPlan | null {
  const { elements, trackOrder, insertRow, dropped } = input;
  const newElement: TimelineElement = {
    ...dropped,
    key: dropped.id,
    // Parked on an existing lane so it adds no lane of its own to the topology.
    track: elements[0]?.track ?? 0,
    // sameSourceFile compares this raw field: borrow the peers' value, not the resolved path.
    sourceFile: elements[0]?.sourceFile,
  };
  const layout = layoutAfterTrackInsert(newElement, dropped.start, insertRow, null, {
    elements: [...elements, newElement],
    trackOrder: [...trackOrder],
  });
  if (!layout) return null;
  const byKey = new Map(elements.map((e) => [e.key ?? e.id, e]));
  const renumbers: DropTrackInsertPlan["renumbers"] = [];
  for (const norm of layout.normalized) {
    const key = norm.key ?? norm.id;
    if (key === dropped.id) continue;
    const src = byKey.get(key);
    if (!src || norm.track === (src.authoredTrack ?? src.track)) continue;
    if (!canMoveTimelineElement(src)) return null;
    renumbers.push({ element: src, track: norm.track });
  }
  const track = layout.normalized.find((n) => (n.key ?? n.id) === dropped.id)?.track;
  return track == null ? null : { track, renumbers };
}

/** Rewrite `data-track-index` on each renumbered clip's opening tag, via the shared source patcher. */
export function applyTrackRenumbers(source: string, plan: DropTrackInsertPlan): string {
  let out = source;
  for (const { element, track } of plan.renumbers) {
    const target = buildPatchTarget(element);
    if (!target || !readTagSnippetByTarget(out, target)) {
      throw new Error(`Cannot renumber the track of "${element.id}" in the source`);
    }
    if (element.implicitTextTiming) {
      out = applyPatchByTarget(out, target, { type: "attribute", property: "start", value: formatTimelineAttributeNumber(element.start) });
      out = applyPatchByTarget(out, target, { type: "attribute", property: "duration", value: formatTimelineAttributeNumber(element.duration) });
    }
    out = applyPatchByTarget(out, target, {
      type: "attribute",
      property: "track-index",
      value: formatTimelineAttributeNumber(track),
    });
  }
  return out;
}

type DroppedClip = Pick<TimelineElement, "id" | "tag" | "start" | "duration">;

function readSavedTrack(source: string, element: TimelineElement): number | undefined {
  const target = buildPatchTarget(element);
  if (!target || !readTagSnippetByTarget(source, target)) return undefined;
  const raw = readAttributeByTarget(source, target, "track-index");
  const track = raw === undefined ? 0 : Number(raw);
  if (!Number.isFinite(track)) throw new Error("Invalid authored track index");
  return track;
}

/** A preceding drop can renumber lanes before the timeline discovers the saved clips. */
export function mediaPlacementPeers(
  source: string,
  elements: TimelineElement[],
  awaitingPreview: readonly TimelineElement[],
): TimelineElement[] {
  const peers = new Map(elements.map(element => [element.key ?? element.id, element]));
  const unseen = awaitingPreview.filter(element => !peers.has(element.key ?? element.id));
  if (unseen.length === 0) return elements;
  for (const element of unseen) peers.set(element.key ?? element.id, element);
  return normalizeToZones([...peers.values()].map(element => {
    const track = readSavedTrack(source, element) ?? element.authoredTrack ?? element.track;
    return { ...element, track, authoredTrack: track };
  }));
}

/** Resolve a media drop in visible row order before translating it to authored tracks. */
export function resolveMediaDropPlacement(
  elements: TimelineElement[],
  placement: TimelineDropPlacement,
  dropped: DroppedClip,
): TimelineDropPlacement {
  if (placement.insertRow != null || placement.newTrack) return placement;
  const order = [...new Set(elements.map(el => el.track))].sort((a, b) => a - b);
  if (order.length === 0) return placement;
  const result = resolveZoneDropPlacement({
    order,
    audioTracks: new Set(elements.filter(isAudioTimelineElement).map(el => el.track)),
    elements,
    desiredTrack: placement.track,
    deliberateInsertRow: null,
    start: dropped.start,
    duration: dropped.duration,
    dragKey: dropped.id,
    isAudio: isAudioTimelineElement(dropped),
  });
  return result.insertRow == null
    ? { track: result.track, start: result.start }
    : { track: result.track, start: result.start, insertRow: result.insertRow, trackOrder: order };
}

/** Translate a resolved landing to its authored track or write the requested new lane. */
export function resolveDropTrack(input: {
  source: string;
  elements: TimelineElement[];
  /** Clips this drop gesture already wrote, which `elements` does not hold yet. */
  placed?: readonly TimelineElement[];
  placement: TimelineDropPlacement;
  dropped: DroppedClip;
}): { source: string; track: number; start: number } {
  const { source, elements, placement, dropped } = input;
  if (placement.newTrack === "top") {
    const target = elements[0];
    const realized = target ? planTimelineLanePersistence(elements, target) : [];
    const insertionSource = applyTrackRenumbers(source, { track: 0, renumbers: realized });
    // Read tracks from the serialized source, since a previous insertion may
    // already be saved while the iframe still shows the old row order.
    const peers = new Map<string, TimelineElement>();
    for (const element of [...elements, ...(input.placed ?? [])]) {
      const track = readSavedTrack(insertionSource, element);
      if (track === undefined) continue;
      peers.set(element.key ?? element.id, { ...element, track, authoredTrack: track });
    }
    const current = [...peers.values()];
    const plan = planDropTrackInsert({
      elements: current,
      trackOrder: [...new Set(current.map(e => e.track))].sort((a, b) => a - b),
      insertRow: 0,
      dropped,
    });
    if (!plan) throw new Error("Cannot open a new track here: a locked clip would have to move.");
    return { source: applyTrackRenumbers(insertionSource, plan), track: plan.track, start: dropped.start };
  }
  if (placement.insertRow == null) {
    const target = { ...dropped, track: placement.track, sourceFile: elements[0]?.sourceFile };
    const renumbers = planTimelineLanePersistence(elements, target);
    const persisted = withPersistedTimelineLanes(elements, renumbers);
    return {
      source: applyTrackRenumbers(source, { track: placement.track, renumbers }),
      track: authoredTrackForLane(placement.track, persisted, target),
      start: dropped.start,
    };
  }
  const { insertRow, trackOrder } = placement;
  const plan = planDropTrackInsert({ elements, trackOrder, insertRow, dropped });
  if (!plan) throw new Error("Cannot open a new track here: a locked clip would have to move.");
  return { source: applyTrackRenumbers(source, plan), track: plan.track, start: dropped.start };
}

/** Keep a new top visual track above both stylesheet-authored and just-saved peers. */
export function topTrackZIndex(source: string, elements: readonly TimelineElement[]): number {
  let max = 0;
  for (const element of elements) {
    if (isAudioTimelineElement(element)) continue;
    const target = buildPatchTarget(element);
    const tag = target ? readTagSnippetByTarget(source, target) : undefined;
    if (!tag) continue;
    const style = readTagAttribute(tag, "style") ?? "";
    const inline = /(?:^|;)\s*z-index\s*:\s*(-?\d+)/i.exec(style);
    max = Math.max(max, inline ? Number(inline[1]) : element.zIndex ?? 0);
  }
  return max + 1;
}
