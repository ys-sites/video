import { instantTolerance } from "@hyperframes/core/clip-facts";

// Native timing mutations round start and duration independently to milliseconds.
// Their summed end can drift by up to 1 ms from an adjacent authored frame boundary.
// This is an editor comparison tolerance, not a change to source or playback time.
export const TIMELINE_TIME_EPSILON_S = 1e-3;

export function timelineTimesTouch(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const slack = TIMELINE_TIME_EPSILON_S + instantTolerance(Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= slack;
}

export function timelineSpansOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return (
    aStart < bEnd && !timelineTimesTouch(aStart, bEnd) &&
    bStart < aEnd && !timelineTimesTouch(bStart, aEnd)
  );
}
