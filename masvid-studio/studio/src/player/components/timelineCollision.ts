import type { TimelineElement } from "../store/playerStore";
import { timelineSpansOverlap } from "./timelineTimeBounds";
import { resolveTimelinePlacement } from "./openreel/timelinePlacement";
import { openReelPlacementInput } from "./openreel/placementInput";

/** Audio member tracks mark the audio zone, including members hidden by a group header. */
export function timelineAudioRow(
  order: number[],
  audioTracks: ReadonlySet<number>,
  groupTracks?: ReadonlyMap<number, readonly number[]>,
): number {
  return order.findIndex(
    (track) =>
      audioTracks.has(track) || groupTracks?.get(track)?.some((member) => audioTracks.has(member)),
  );
}

/**
 * Keep a landing track inside the dragged clip's kind-zone: visual clips stay in
 * the rows ABOVE the first audio lane; audio clips stay AT/BELOW it. Prevents a
 * clip from appearing to land in the wrong zone mid-drag (which normalizeToZones
 * would then snap back). `audioRow` = index in `trackOrder` of the first audio
 * lane, or -1 when there is no audio zone yet (then it's a no-op).
 */
export function clampTrackToZone(
  targetTrack: number,
  trackOrder: number[],
  audioRow: number,
  isAudio: boolean,
): number {
  if (audioRow < 0) return targetTrack;
  const row = trackOrder.indexOf(targetTrack);
  if (row < 0) return targetTrack;
  if (isAudio) return row >= audioRow ? targetTrack : (trackOrder[audioRow] ?? targetTrack);
  return row < audioRow ? targetTrack : (trackOrder[audioRow - 1] ?? targetTrack);
}

/**
 * Whether a new-track insert at boundary `insertRow` is allowed for a clip of the
 * given kind. Visual clips may only insert visual lanes (boundary at/above the top
 * of the audio zone); audio clips may only insert audio lanes (boundary at/below
 * it) — so audio clips CAN create a new audio track, and neither kind inserts into
 * the other's zone. `audioRow` = first audio lane row, or -1 (no audio zone) → any.
 */
export function isInsertAllowedForZone(
  insertRow: number,
  audioRow: number,
  isAudio: boolean,
  allowedRows?: ReadonlySet<number>,
): boolean {
  if (allowedRows && !allowedRows.has(insertRow)) return false;
  while (audioRow > 0 && allowedRows && !allowedRows.has(audioRow)) audioRow--;
  if (audioRow < 0) return true;
  return isAudio ? insertRow >= audioRow : insertRow <= audioRow;
}

/**
 * Insert-row boundary for an out-of-range aim — a `desired` track that isn't a
 * real lane: the sentinel minTrack-1 an upward create-drag emits (#2214-adjacent
 * repro) or a beyond-the-bottom index a downward one does. Anchors the new track
 * to a boundary of the clip's OWN kind-zone so a visual insert can never land
 * past the audio zone (the old below = order.length fallback dropped it BELOW the
 * audio lanes). Above the zone (`desired` < the zone's min lane) → the zone's TOP
 * boundary; otherwise → its BOTTOM boundary (for a visual clip, the top of the
 * audio zone). `zoneTracks` = this kind's lanes, in `order` sequence.
 */
function outOfRangeZoneInsertRow(
  order: number[],
  zoneTracks: number[],
  audioRow: number,
  desired: number,
): number {
  // An empty audio zone opens below visual rows; an empty visual zone opens above audio.
  if (zoneTracks.length === 0) return audioRow < 0 ? order.length : audioRow;
  // zoneTracks preserves `order` sequence, so its ends map to the zone boundary
  // rows: above the zone's min lane → its top boundary, else its bottom.
  const zoneTop = order.indexOf(zoneTracks[0]);
  const zoneBottom = order.indexOf(zoneTracks[zoneTracks.length - 1]) + 1;
  return desired < Math.min(...zoneTracks) ? zoneTop : zoneBottom;
}

export interface TimelineDropPlacement {
  track: number;
  insertRow: number | null;
  start: number;
  invalidDrop?: boolean;
}

function groupHeaderAim(
  input: Parameters<typeof resolveZoneDropPlacement>[0],
):
  | { kind: "ordinary" | "member"; track: number }
  | { kind: "origin"; track: number; start: number } {
  const members = input.groupTracks?.get(input.desiredTrack);
  if (!members) return { kind: "ordinary", track: input.desiredTrack };
  const memberTracks = new Set(members);
  const member = input.order.find(
    (track) => memberTracks.has(track) && input.audioTracks.has(track) === input.isAudio,
  );
  if (member !== undefined) return { kind: "member", track: member };
  if (!input.origin) throw new Error("Group-header drop requires the clip origin");
  return { kind: "origin", ...input.origin };
}

// OpenReel placement: keep pointer time and use a free upper lane on collision.
export function resolveZoneDropPlacement(input: {
  order: number[];
  audioTracks: ReadonlySet<number>;
  elements: TimelineElement[];
  desiredTrack: number;
  deliberateInsertRow: number | null;
  allowedInsertRows?: ReadonlySet<number>;
  groupTracks?: ReadonlyMap<number, readonly number[]>;
  start: number;
  blockedTracks?: ReadonlySet<number>;
  duration: number;
  dragKey: string;
  isAudio: boolean;
  /** Lowest start the clip may take (every moving clip stays at or after its host's start). */
  minStart?: number;
  /** Where the dragged clip sits now. */
  origin?: { track: number; start: number };
}): TimelineDropPlacement {
  const { order, audioTracks, elements, desiredTrack, deliberateInsertRow } = input;
  const { start, duration, dragKey, isAudio, minStart } = input;
  const audioRow = timelineAudioRow(order, audioTracks, input.groupTracks);

  if (
    deliberateInsertRow !== null &&
    isInsertAllowedForZone(deliberateInsertRow, audioRow, isAudio, input.allowedInsertRows)
  ) {
    return { track: desiredTrack, insertRow: deliberateInsertRow, start };
  }

  if (!isAudio && audioTracks.has(desiredTrack) && input.origin) {
    return { ...input.origin, insertRow: null, invalidDrop: true };
  }

  const aim = groupHeaderAim(input);
  if (aim.kind === "origin") return { track: aim.track, start: aim.start, insertRow: null };
  const firstVisibleAudioRow = order.findIndex((track) => audioTracks.has(track));
  const zoneBoundary = isAudio ? firstVisibleAudioRow : audioRow;
  const desired =
    aim.kind === "member" ? aim.track : clampTrackToZone(aim.track, order, zoneBoundary, isAudio);
  const zoneTracks = order.filter(
    (t) => !input.groupTracks?.has(t) && audioTracks.has(t) === isAudio,
  );
  // Only when the aim is outside the rows, or the clip's zone has no row yet.
  if (!zoneTracks.includes(desired)) {
    const desiredRow = order.indexOf(desired);
    let insertRow =
      desiredRow < 0 || zoneTracks.length === 0
        ? outOfRangeZoneInsertRow(order, zoneTracks, audioRow, desired)
        : desiredRow + 1;
    while (insertRow > 0 && input.allowedInsertRows && !input.allowedInsertRows.has(insertRow))
      insertRow--;
    return { track: desired, insertRow, start };
  }
  // Collision changes the lane, never the pointer's horizontal time. Search
  // upward inside the same kind zone, then open a lane above the aimed row.
  const safeStart = Math.max(minStart ?? 0, start);
  if (input.origin?.track === desired && Math.abs(safeStart - input.origin.start) < 0.005)
    return { track: desired, insertRow: null, start: input.origin.start };
  const placement = resolveTimelinePlacement(openReelPlacementInput(elements, zoneTracks, input.blockedTracks), {
    targetTrackId: String(desired),
    startTime: safeStart,
    duration,
    policy: "stack-above",
    excludeItemIds: [dragKey],
    newTrackId: "new-track",
  });
  if (placement.ok) {
    if (!placement.createdTrack)
      return { track: Number(placement.trackId), insertRow: null, start: placement.startTime };
    const insertRow = order.indexOf(zoneTracks[placement.createdTrack.position]);
    if (isInsertAllowedForZone(insertRow, audioRow, isAudio, input.allowedInsertRows))
      return { track: desired, insertRow, start: placement.startTime };
  }
  // A protected group boundary cannot be split. Keep the origin lane and time
  // rather than silently moving the clip to a different time.
  return { track: input.origin?.track ?? desired, insertRow: null, start: input.origin?.start ?? safeStart };
}

/**
 * The row boundary a pointer opens a new track at, or null over a row. `rowFloat` is the pointer's
 * position in row units from the top of the first row. Only the empty space above the first row
 * (0) or below the last (`trackCount`) opens one: a drop anywhere on a row stays on that row.
 */
export function resolveInsertRow(rowFloat: number, trackCount: number): number | null {
  if (trackCount === 0 || rowFloat < 0) return 0;
  if (rowFloat >= trackCount) return trackCount;
  return null;
}

/** Half-open overlap test: [aStart, aEnd) intersects [bStart, bEnd). */
export function timeRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return timelineSpansOverlap(aStart, aEnd, bStart, bEnd);
}

/**
 * True when no clip on `track` overlaps [start, end) — excluding the clip
 * identified by `excludeKey` (the one being dragged).
 */
export function isLaneFree(
  elements: TimelineElement[],
  track: number,
  start: number,
  end: number,
  excludeKey: string | null,
): boolean {
  return !elements.some(
    (el) =>
      (el.key ?? el.id) !== excludeKey &&
      el.track === track &&
      timeRangesOverlap(start, end, el.start, el.start + el.duration),
  );
}
