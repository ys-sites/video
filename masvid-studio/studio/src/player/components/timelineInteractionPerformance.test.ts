import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { collectTimelineSnapTargets, snapTimelineTime } from "./timelineSnapping";
import { collisionLane } from "./timelineCollisionIndex";

const clips: TimelineElement[] = Array.from({ length: 20_000 }, (_, index) => ({
  id: `clip-${index}`, tag: "video", track: index % 100, start: Math.floor(index / 100) * 3 + (index % 100) * 0.001, duration: 2,
}));

describe("large timeline interaction budgets", () => {
  it("matches the linear snap oracle while reading logarithmically many targets", () => {
    const targets = collectTimelineSnapTargets({ elements: clips, playheadTime: 25, beatTimes: [] });
    const queries = Array.from({ length: 240 }, (_, index) => index * 2.371 + 0.04);
    const priority = { playhead: 0, "clip-edge": 1, beat: 2, grid: 3 };
    const before = performance.now();
    const reference = queries.map(time => {
      let best: typeof targets[number] | null = null;
      let distance = 0.08;
      for (const target of targets) {
        const delta = Math.abs(target.time - time);
        if (delta < distance || (delta === distance && best && priority[target.type] < priority[best.type])) {
          best = target; distance = delta;
        }
      }
      return best;
    });
    const linearMs = performance.now() - before;
    const started = performance.now();
    const actual = queries.map(time => snapTimelineTime(time, targets, 0.08).target);
    const indexedMs = performance.now() - started;
    expect(actual).toEqual(reference);
    let reads = 0;
    for (const target of targets) {
      const time = target.time;
      Object.defineProperty(target, "time", { get: () => { reads++; return time; } });
    }
    for (const query of queries) snapTimelineTime(query, targets, 0.08);
    expect(reads).toBeLessThan(queries.length * (Math.ceil(Math.log2(targets.length)) + 5));
    process.stdout.write(JSON.stringify({ clips: clips.length, snapTargets: targets.length, queries: queries.length, linearMs, indexedMs, targetReads: reads }) + "\n");
  });

  it("indexes each source snapshot once with a sorted list per collision lane", () => {
    const first = collisionLane(clips, 42);
    expect(first).toHaveLength(200);
    expect(collisionLane(clips, 42)).toBe(first);
    expect(first.every(clip => clip.track === 42)).toBe(true);
    expect(first.map(clip => clip.start)).toEqual(Array.from({ length: 200 }, (_, index) => index * 3 + 0.042));
    const moved = clips.map(clip => clip.id === "clip-42" ? { ...clip, start: 900 } : clip);
    expect(collisionLane(moved, 42)).not.toBe(first);
    expect(collisionLane(moved, 42).at(-1)?.id).toBe("clip-42");
  });

  it("never snaps a selected group to its own passengers", () => {
    const targets = collectTimelineSnapTargets({ elements: clips.slice(0, 3), playheadTime: null, beatTimes: [], excludeElementKeys: new Set(["clip-0", "clip-1"]) });
    expect(targets).toEqual([{ time: 0.002, type: "clip-edge" }, { time: 2.002, type: "clip-edge" }]);
  });
});
