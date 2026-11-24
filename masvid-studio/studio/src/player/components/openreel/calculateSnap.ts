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
// OpenReel 367d7e90b61b5181f9861b852bb8b9d7a7d2954a, apps/web/src/components/editor/timeline/utils.ts.
export interface SnapPoint {
  time: number;
  type: "clip-start" | "clip-end" | "playhead" | "marker" | "grid";
}

export interface SnapResult {
  time: number;
  snapped: boolean;
  snapPoint?: SnapPoint;
}

export interface SnapSettings {
  enabled: boolean;
  snapToClips: boolean;
  snapToPlayhead: boolean;
  snapToGrid: boolean;
  gridSize: number;
  snapThreshold: number;
}

type Track = { clips: { id: string; startTime: number; duration: number }[] };

export const calculateSnap = (
  rawTime: number,
  clipId: string,
  tracks: Track[],
  playheadPosition: number,
  snapSettings: SnapSettings,
  pixelsPerSecond: number,
  clipDuration?: number,
): SnapResult => {
  if (!snapSettings.enabled) {
    return { time: rawTime, snapped: false };
  }

  const thresholdSeconds = snapSettings.snapThreshold / pixelsPerSecond;
  const snapPoints: SnapPoint[] = [];

  if (snapSettings.snapToClips) {
    for (const track of tracks) {
      for (const clip of track.clips) {
        if (clip.id === clipId) continue;
        snapPoints.push({ time: clip.startTime, type: "clip-start" });
        snapPoints.push({
          time: clip.startTime + clip.duration,
          type: "clip-end",
        });
      }
    }
  }

  if (snapSettings.snapToPlayhead) {
    snapPoints.push({ time: playheadPosition, type: "playhead" });
  }

  if (snapSettings.snapToGrid) {
    const nearestGrid =
      Math.round(rawTime / snapSettings.gridSize) * snapSettings.gridSize;
    snapPoints.push({ time: nearestGrid, type: "grid" });
    if (clipDuration) {
      const endTime = rawTime + clipDuration;
      const nearestEndGrid =
        Math.round(endTime / snapSettings.gridSize) * snapSettings.gridSize;
      snapPoints.push({ time: nearestEndGrid, type: "grid" });
    }
  }

  const priorityOrder: Record<string, number> = {
    "clip-start": 0,
    "clip-end": 0,
    "playhead": 1,
    "grid": 2,
  };

  let closestPoint: SnapPoint | undefined;
  let closestDistance = Infinity;
  let closestPriority = Infinity;
  let snapFromEnd = false;

  for (const point of snapPoints) {
    const pointPriority = priorityOrder[point.type] ?? 2;

    const startDistance = Math.abs(point.time - rawTime);
    if (startDistance < thresholdSeconds) {
      const isBetter =
        pointPriority < closestPriority ||
        (pointPriority === closestPriority && startDistance < closestDistance);
      if (isBetter) {
        closestDistance = startDistance;
        closestPriority = pointPriority;
        closestPoint = point;
        snapFromEnd = false;
      }
    }

    if (clipDuration) {
      const clipEndTime = rawTime + clipDuration;
      const endDistance = Math.abs(point.time - clipEndTime);
      if (endDistance < thresholdSeconds) {
        const isBetter =
          pointPriority < closestPriority ||
          (pointPriority === closestPriority && endDistance < closestDistance);
        if (isBetter) {
          closestDistance = endDistance;
          closestPriority = pointPriority;
          closestPoint = point;
          snapFromEnd = true;
        }
      }
    }
  }

  if (closestPoint) {
    const snappedTime = snapFromEnd
      ? closestPoint.time - (clipDuration ?? 0)
      : closestPoint.time;
    return {
      time: Math.max(0, snappedTime),
      snapped: true,
      snapPoint: { ...closestPoint, time: closestPoint.time },
    };
  }

  return { time: rawTime, snapped: false };
};
