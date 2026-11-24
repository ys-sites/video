import { describe, expect, it } from "vitest";
import { timelinePendingRows } from "./timelinePendingRows";
import type { PendingAssetDrop } from "../store/pendingAssetDrops";
const elements = [
  { id: "visual", tag: "div", start: 0, duration: 10, track: 0 },
  { id: "music", tag: "audio", start: 0, duration: 10, track: 1, authoredTrack: 0 },
];
const drop = (id: string, assetPath: string, track: number): PendingAssetDrop => ({ id, assetPath, placement: { start: 9, track } });
describe("loading row reservations", () => {
  it("reserves an appended visual ahead of audio and an audio drop after visuals", () => {
    const result = timelinePendingRows(elements, [drop("image", "a.png", 2), drop("audio", "b.mp3", 2)]);
    expect([...result.pendingRows]).toEqual([["image", 0.5], ["audio", 2]]);
    expect([...result.addedRows]).toEqual([[0.5, false], [2, true]]);
  });
  it("keeps a batch on one newly reserved row until discovery replaces it", () => {
    const first = { ...drop("a", "a.png", 0), placement: { start: 9, track: 0, insertRow: 0, trackOrder: [0, 1] } };
    const second = { ...drop("b", "b.png", 0), rowOwnerId: "a" };
    const result = timelinePendingRows(elements, [first, second]);
    expect([...result.pendingRows.values()]).toEqual([-0.5, -0.5]);
    expect(result.addedRows.size).toBe(1);
  });
  it("does not reserve another row after the saved identity is discovered", () => {
    const saved = { id: "image", key: "index.html#image", tag: "img", start: 9, duration: 3, track: 0 };
    expect(timelinePendingRows([saved], [{ ...drop("a", "a.png", 0), element: saved }]).addedRows.size).toBe(0);
  });
  it("keeps a new visual row separate from an audio group's header", () => {
    const grouped = elements.map(element => element.tag === "audio" ? { ...element, audioGroup: "music" } : element);
    const result = timelinePendingRows(grouped, [drop("image", "a.png", 2)]);
    expect(result.pendingRows.get("image")).toBeLessThan(0.5);
    expect(result.addedRows.has(0.5)).toBe(false);
  });
});
