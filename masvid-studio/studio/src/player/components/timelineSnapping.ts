import type { TimelineElement } from "../store/playerStore";
import { roundToCenti } from "../../utils/rounding";

export type TimelineSnapType = "beat" | "playhead" | "clip-edge" | "grid";

export interface TimelineSnapTarget {
  time: number;
  type: TimelineSnapType;
}

/** The guide the canvas draws: the live move's snap target, else the live trim's. */
export function resolveSnapGuide(
  moving: { started: boolean; snapTime: number | null; snapType: TimelineSnapType | null } | null,
  trimming: { snapTime?: number | null; snapType?: TimelineSnapType | null } | null,
): TimelineSnapTarget | null {
  const source = moving?.started ? moving : trimming;
  if (source?.snapTime == null || source.snapType == null) return null;
  return { time: source.snapTime, type: source.snapType };
}

/** Pixel radius within which a time snaps to a target (matches historical beat snap). */
export const TIMELINE_SNAP_PX = 5;
export const TIMELINE_SNAP_RELEASE_PX = 7;

/** A gesture owns its target until the pointer leaves the wider release radius. */
export function stickyTimelineTime(
  time: number,
  targets: readonly TimelineSnapTarget[],
  pixelsPerSecond: number,
  gridStep = 0,
  previous?: TimelineSnapTarget | null,
): { time: number; target: TimelineSnapTarget | null } {
  const pps = Math.max(pixelsPerSecond, 1);
  const available = previous && (previous.type === "grid" ? gridStep > 0 :
    targets.some(target => target.time === previous.time && target.type === previous.type));
  if (available && Math.abs(time - previous.time) * pps < TIMELINE_SNAP_RELEASE_PX - 1e-6)
    return { time: previous.time, target: previous };
  return snapTimelineTime(time, targets, TIMELINE_SNAP_PX / pps, gridStep);
}

const TYPE_PRIORITY: Record<TimelineSnapType, number> = {
  playhead: 0,
  "clip-edge": 1,
  beat: 2,
  grid: 3,
};
// Only arrays built here have the sorted, unique-time contract. External arrays
// keep the original order-sensitive behavior (including equal-distance ties).
const indexedTargets = new WeakSet<readonly TimelineSnapTarget[]>();

export function collectTimelineSnapTargets(input: {
  elements: ReadonlyArray<Pick<TimelineElement, "start" | "duration" | "key" | "id">>;
  playheadTime: number | null;
  beatTimes: readonly number[];
  excludeElementKey?: string | null;
  excludeElementKeys?: ReadonlySet<string>;
}): TimelineSnapTarget[] {
  const byTime = new Map<number, TimelineSnapTarget>();
  const add = (time: number, type: TimelineSnapType) => {
    if (!Number.isFinite(time) || time < 0) return;
    const rounded = Math.round(time * 1000) / 1000;
    const existing = byTime.get(rounded);
    if (!existing || TYPE_PRIORITY[type] < TYPE_PRIORITY[existing.type]) {
      byTime.set(rounded, { time: rounded, type });
    }
  };

  for (const beat of input.beatTimes) add(beat, "beat");
  for (const el of input.elements) {
    if (input.excludeElementKeys?.has(el.key ?? el.id)) continue;
    if (input.excludeElementKey != null && (el.key ?? el.id) === input.excludeElementKey) continue;
    add(el.start, "clip-edge");
    add(el.start + el.duration, "clip-edge");
  }
  if (input.playheadTime != null) add(input.playheadTime, "playhead");

  const targets = Array.from(byTime.values()).sort((a, b) => a.time - b.time);
  indexedTargets.add(targets);
  return targets;
}

/** Nearest ruler line in range, at its saved centisecond, and only within a pixel of it. */
function nearestGridLine(
  time: number,
  gridStep: number,
  thresholdSecs: number,
): TimelineSnapTarget | null {
  if (!(gridStep > 0)) return null;
  const line = Math.round(time / gridStep) * gridStep;
  const saved = roundToCenti(line);
  const pixelsPerSecond = TIMELINE_SNAP_PX / thresholdSecs;
  if (Math.abs(saved - line) * pixelsPerSecond >= 1) return null;
  return Math.abs(saved - time) < thresholdSecs ? { time: saved, type: "grid" } : null;
}

export function snapTimelineTime(
  time: number,
  targets: readonly TimelineSnapTarget[],
  thresholdSecs: number,
  gridStep = 0,
): { time: number; target: TimelineSnapTarget | null } {
  let best: TimelineSnapTarget | null = null;
  let bestDist = thresholdSecs + 1e-9;
  let from = 0;
  let to = targets.length;
  if (indexedTargets.has(targets)) {
    while (from < to) {
      const middle = (from + to) >>> 1;
      if (targets[middle]!.time < time) from = middle + 1;
      else to = middle;
    }
    to = Math.min(targets.length, from + 1);
    from = Math.max(0, from - 1);
  }
  for (let index = from; index < to; index++) {
    const target = targets[index]!;
    const d = Math.abs(target.time - time);
    if (
      d < bestDist ||
      (d === bestDist && best && TYPE_PRIORITY[target.type] < TYPE_PRIORITY[best.type])
    ) {
      bestDist = d;
      best = target;
    }
  }
  best ??= nearestGridLine(time, gridStep, thresholdSecs);
  return best ? { time: best.time, target: best } : { time, target: null };
}
