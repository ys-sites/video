import { describe, expect, it } from "vitest";
import {
  TIMELINE_SNAP_PX,
  collectTimelineSnapTargets,
  snapTimelineTime,
  resolveSnapGuide,
} from "./timelineSnapping";

describe("collectTimelineSnapTargets", () => {
  const elements = [
    { start: 2, duration: 3, key: "a", id: "a" },
    { start: 10, duration: 1.5, key: "b", id: "b" },
  ];

  it("collects clip starts and ends, playhead, and beats with types", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: 7.25,
      beatTimes: [0.5, 1.0],
    });
    expect(targets).toContainEqual({ time: 2, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 11.5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 7.25, type: "playhead" });
    expect(targets).toContainEqual({ time: 0.5, type: "beat" });
  });

  it("excludes the dragged element's own edges", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: null,
      beatTimes: [],
      excludeElementKey: "a",
    });
    expect(targets.some((t) => t.time === 2)).toBe(false);
    expect(targets.some((t) => t.time === 5)).toBe(false);
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
  });

  it("omits playhead when null and dedupes identical times preferring playhead > clip-edge > beat", () => {
    const targets = collectTimelineSnapTargets({
      elements: [{ start: 1, duration: 1, key: "x", id: "x" }],
      playheadTime: 2,
      beatTimes: [2],
    });
    const atTwo = targets.filter((t) => t.time === 2);
    expect(atTwo).toEqual([{ time: 2, type: "playhead" }]);
  });

  it("dedupes a coincident clip-edge and beat preferring clip-edge (no playhead)", () => {
    // A beat and a clip edge land on the same time (2). clip-edge has higher
    // priority than beat, so the deduped target is clip-edge — not beat.
    const targets = collectTimelineSnapTargets({
      elements: [{ start: 2, duration: 3, key: "x", id: "x" }],
      playheadTime: null,
      beatTimes: [2],
    });
    const atTwo = targets.filter((t) => t.time === 2);
    expect(atTwo).toEqual([{ time: 2, type: "clip-edge" }]);
  });
});

describe("snapTimelineTime", () => {
  const targets = [
    { time: 5, type: "clip-edge" as const },
    { time: 5.3, type: "playhead" as const },
  ];

  it("snaps to the nearest target within threshold", () => {
    expect(snapTimelineTime(5.05, targets, 0.1)).toEqual({
      time: 5,
      target: { time: 5, type: "clip-edge" },
    });
  });

  it("returns input unchanged when nothing is within threshold", () => {
    expect(snapTimelineTime(6, targets, 0.1)).toEqual({ time: 6, target: null });
  });

  it("snaps to the nearest ruler line when no target is in range", () => {
    expect(snapTimelineTime(6.27, targets, 0.08, 0.25)).toEqual({
      time: 6.25,
      target: { time: 6.25, type: "grid" },
    });
    expect(snapTimelineTime(6.37, targets, 0.08, 0.25)).toEqual({ time: 6.37, target: null });
  });

  it("prefers a target in range over a nearer ruler line", () => {
    expect(snapTimelineTime(5.24, targets, 0.08, 0.25).target).toEqual({
      time: 5.3,
      type: "playhead",
    });
  });

  it("snaps a line at its saved centisecond, and not at all when that is a pixel or more off", () => {
    // 187.5 px/s: 4.625s saves as 4.63s, under a pixel away, so the guide sits where the clip lands.
    expect(snapTimelineTime(4.627, [], 8 / 187.5, 0.125).target).toEqual({
      time: 4.63,
      type: "grid",
    });
    // 1440 px/s: 1.025s would save 7px off its line, so the line does not snap.
    expect(snapTimelineTime(1.026, [], 8 / 1440, 0.025)).toEqual({ time: 1.026, target: null });
  });

  it("lands on whole frames for a frame-spaced grid", () => {
    expect(snapTimelineTime(1.01, [], 0.08, 1 / 30).time).toBe(1);
  });
});

describe("resolveSnapGuide", () => {
  it("prefers a started move, falls back to a trim, and is null when neither snapped", () => {
    const move = { started: true, snapTime: 2, snapType: "playhead" as const };
    const trim = { snapTime: 5, snapType: "clip-edge" as const };
    expect(resolveSnapGuide(move, trim)).toEqual({ time: 2, type: "playhead" });
    expect(resolveSnapGuide({ ...move, started: false }, trim)).toEqual({
      time: 5,
      type: "clip-edge",
    });
    expect(resolveSnapGuide(null, { snapTime: null, snapType: null })).toBeNull();
    expect(resolveSnapGuide(null, null)).toBeNull();
  });
});
