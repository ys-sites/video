/*!
MIT License

Copyright (c) 2024-2026 Augustus Otu and Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// OpenReel 367d7e90b61b5181f9861b852bb8b9d7a7d2954a, packages/core/src/timeline/timeline-placement.ts.
// The placement algorithm is unchanged. Only its project input is adapted.
import { getTrackItems, isStandardTrack, type Project } from "./placementInput";

export type TimelinePlacementPolicy = "gap" | "stack-above";

export interface TimelinePlacementRequest {
  readonly targetTrackId: string;
  readonly startTime: number;
  readonly duration: number;
  readonly policy: TimelinePlacementPolicy;
  readonly excludeItemIds?: readonly string[];
  readonly newTrackId?: string;
}

export type TimelinePlacementResult =
  | {
      readonly ok: true;
      readonly trackId: string;
      readonly startTime: number;
      readonly createdTrack?: { readonly id: string; readonly position: number };
    }
  | {
      readonly ok: false;
      readonly reason: "track-not-found" | "track-locked" | "overlap";
    };

const PLACEMENT_EPSILON = 0.0001;

export function timelineIntervalsOverlap(
  leftStart: number,
  leftDuration: number,
  rightStart: number,
  rightDuration: number,
): boolean {
  const leftEnd = leftStart + leftDuration;
  const rightEnd = rightStart + rightDuration;
  return (
    leftStart < rightEnd - PLACEMENT_EPSILON &&
    rightStart < leftEnd - PLACEMENT_EPSILON
  );
}

export function isTimelineIntervalClear(
  project: Project,
  trackId: string,
  startTime: number,
  duration: number,
  excludeItemIds: readonly string[] = [],
): boolean {
  const excluded = new Set(excludeItemIds);
  return getTrackItems(project, trackId).every(
    (item) =>
      excluded.has(item.id) ||
      !timelineIntervalsOverlap(
        startTime,
        duration,
        item.startTime,
        item.duration,
      ),
  );
}

/** Resolve the destination row without mutating the project. */
export function resolveTimelinePlacement(
  project: Project,
  request: TimelinePlacementRequest,
): TimelinePlacementResult {
  const targetIndex = project.timeline.tracks.findIndex(
    (track) => track.id === request.targetTrackId,
  );
  if (targetIndex < 0) return { ok: false, reason: "track-not-found" };

  const target = project.timeline.tracks[targetIndex];
  if (target.locked && request.policy === "gap") {
    return { ok: false, reason: "track-locked" };
  }

  const startTime = Math.max(0, request.startTime);
  if (
    !target.locked &&
    isTimelineIntervalClear(
      project,
      target.id,
      startTime,
      request.duration,
      request.excludeItemIds,
    )
  ) {
    return { ok: true, trackId: target.id, startTime };
  }

  if (request.policy === "gap") return { ok: false, reason: "overlap" };

  for (let index = targetIndex - 1; index >= 0; index -= 1) {
    const candidate = project.timeline.tracks[index];
    if (
      !candidate.locked &&
      isStandardTrack(candidate) &&
      isTimelineIntervalClear(
        project,
        candidate.id,
        startTime,
        request.duration,
        request.excludeItemIds,
      )
    ) {
      return { ok: true, trackId: candidate.id, startTime };
    }
  }

  const newTrackId = request.newTrackId ?? `track-${crypto.randomUUID()}`;
  return {
    ok: true,
    trackId: newTrackId,
    startTime,
    createdTrack: { id: newTrackId, position: targetIndex },
  };
}
