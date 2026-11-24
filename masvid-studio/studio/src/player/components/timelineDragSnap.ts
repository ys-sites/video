import { TIMELINE_SNAP_PX, type TimelineSnapTarget } from "./timelineSnapping";
import { calculateSnap } from "./openreel/calculateSnap";

const OPENREEL_DRAG_SNAP_PX = 40;
type SnapClips = Parameters<typeof calculateSnap>[2][number]["clips"];
const candidates = new WeakMap<readonly TimelineSnapTarget[], { edges: SnapClips; beats: SnapClips }>();

function firstAtOrAfter(clips: SnapClips, time: number): number {
  let low = 0;
  let high = clips.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (clips[mid].startTime < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The native solver only considers candidates within its radius of either moving edge. */
function nearbyClips(clips: SnapClips, start: number, duration: number, radius: number): SnapClips {
  const first = firstAtOrAfter(clips, start - radius);
  const last = firstAtOrAfter(clips, start + radius + 1e-9);
  const endFrom = firstAtOrAfter(clips, start + duration - radius);
  const endTo = firstAtOrAfter(clips, start + duration + radius + 1e-9);
  return endFrom <= last
    ? clips.slice(first, endTo)
    : [...clips.slice(first, last), ...clips.slice(endFrom, endTo)];
}

export function snapOpenReelMove(
  rawTime: number,
  duration: number,
  targets: readonly TimelineSnapTarget[],
  pixelsPerSecond: number,
  gridStep = 0,
): { start: number; snapTime: number | null; snapType: TimelineSnapTarget["type"] | null; snapEdge?: "start" | "end" } {
  let projected = candidates.get(targets);
  if (!projected) {
    // The gesture already excluded moving clips. A zero-length proxy supplies each edge once by time.
    const edges: SnapClips = [];
    const beats: SnapClips = [];
    targets.forEach(({ time, type }, index) => {
      const item = { id: String(index), startTime: time, duration: 0 };
      if (type === "clip-edge") edges.push(item);
      if (type === "beat") beats.push(item);
    });
    edges.sort((a, b) => a.startTime - b.startTime);
    beats.sort((a, b) => a.startTime - b.startTime);
    projected = { edges, beats };
    candidates.set(targets, projected);
  }
  const pps = Math.max(pixelsPerSecond, 1);
  const edges = nearbyClips(projected.edges, rawTime, duration, OPENREEL_DRAG_SNAP_PX / pps);
  const primary = calculateSnap(rawTime, "", [{ clips: edges }], 0, {
    enabled: true, snapToClips: true, snapToPlayhead: false, snapToGrid: gridStep > 0,
    gridSize: gridStep, snapThreshold: OPENREEL_DRAG_SNAP_PX,
  }, pps, duration);
  const clipEdge = primary.snapPoint && primary.snapPoint.type !== "grid";
  const beats = clipEdge ? [] : nearbyClips(projected.beats, rawTime, duration, TIMELINE_SNAP_PX / pps);
  const beat = beats.length > 0
    ? calculateSnap(rawTime, "", [{ clips: beats }], 0, {
        enabled: true, snapToClips: true, snapToPlayhead: false, snapToGrid: false,
        gridSize: 0, snapThreshold: TIMELINE_SNAP_PX,
      }, pps, duration)
    : null;
  const chosen = beat?.snapped ? beat : primary;
  const snapTime = chosen.snapPoint?.time ?? null;
  if (snapTime === null) return { start: chosen.time, snapTime, snapType: null };
  return {
    start: chosen.time,
    snapTime,
    snapType: beat?.snapped ? "beat" : clipEdge ? "clip-edge" : "grid",
    snapEdge: chosen.time === snapTime ? "start" : "end",
  };
}
