import { afterEach, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { previewClipInsert } from "./timelineClipInsert";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
import { resolveMultiDragPreview } from "./timelineProviderStateBuilders";
import { multiDragPassengerOffsetPx } from "./timelineMultiDragPreview";
import { useTimelineMultiDragActorWindows } from "./useTimelineMultiDragActorWindows";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { computeDragPreview } from "./timelineClipDragPreview";
import { RULER_H, TRACKS_TOP_PAD, TRACK_H } from "./timelineLayout";

const clip = (id: string, track: number, start: number, duration: number): TimelineElement =>
  ({ id, domId: id, tag: "div", track, start, duration });
afterEach(() => usePlayerStore.getState().reset());

it("uses the pointer's insertion intent even when a distant edge could snap the clip past the pair", () => {
  const moving = clip("moving", 0, 20, 3);
  const y = RULER_H + TRACKS_TOP_PAD + TRACK_H / 2;
  const drag = { pointerId: 0, element: moving, originClientX: 180, originClientY: y,
    originScrollLeft: 0, originScrollTop: 0, pointerClientX: 180, pointerClientY: y,
    pointerOffsetX: 9, pointerOffsetY: 20, previewStart: 20, previewTrack: 0, insertRow: null,
    snapTime: null, snapType: null, started: true } satisfies DraggedClipState;
  const context = {
    scroll: null, pps: 9, duration: 30, trackOrder: [0, 1],
    elements: [moving, clip("a", 1, 0, 4), clip("b", 1, 4, 3), clip("c", 1, 10, 3)],
    selectedKeys: new Set<string>(), buildSnapTargets: () => [{ time: 10, type: "clip-edge" as const }],
  };
  // The pointer is more than 12px inside B, within its first half.
  const preview = computeDragPreview(drag, 40, y + TRACK_H, context);
  expect(preview.previewStart).toBe(4);
  expect(preview.previewTrack).toBe(1);
  expect(preview.insertion?.get("b")).toBe(7);
  expect(computeDragPreview(preview, 62, y + TRACK_H, context).insertion).toBeUndefined();
  const child = { ...clip("child", 2, 20, 1), expandedHostKey: moving.id };
  expect(computeDragPreview(drag, 40, y + TRACK_H, {
    ...context, elements: [...context.elements, child], selectedKeys: new Set([moving.id, child.id]),
  }).insertion).toBeUndefined();
});

it.each([20, 40, 160])("hits the cut from either side at %d pixels per second", (pps) => {
  const moving = clip("moving", 0, 20, 8.53);
  const left = clip("left", 1, 0, 10.73), right = clip("right", 1, 10.73, 4);
  const y = RULER_H + TRACKS_TOP_PAD + TRACK_H / 2;
  const pickup = 26.5 * pps;
  const drag = { pointerId: 0, element: moving, originClientX: pickup, originClientY: y,
    originScrollLeft: 0, originScrollTop: 0, pointerClientX: pickup, pointerClientY: y,
    pointerOffsetX: 6.5 * pps, pointerOffsetY: 20, previewStart: 20, previewTrack: 0, insertRow: null,
    snapTime: null, snapType: null, started: true } satisfies DraggedClipState;
  const context = {
    scroll: null, pps, duration: 30, trackOrder: [0, 1],
    elements: [moving, left, right], selectedKeys: new Set<string>(), buildSnapTargets: () => [],
  };
  const x = 10.73 * pps + drag.pointerOffsetX;
  for (const side of [-1, 1]) {
    const preview = computeDragPreview(drag, x + side * 4.9, y + TRACK_H, context);
    expect(preview).toMatchObject({ previewTrack: 1, insertRow: null, previewStart: 10.73 });
    expect(preview.insertion).toEqual(new Map([["moving", 10.73], ["right", 19.26]]));
    expect(computeDragPreview(preview, x + side * 5.1, y + TRACK_H, context).insertion).toBeUndefined();
  }

  const gapPreview = computeDragPreview(drag, x, y + TRACK_H, {
    ...context, elements: [moving, { ...left, duration: 2.73 }, right],
  });
  expect(gapPreview.insertion).toBeUndefined();
  expect(gapPreview.previewStart).toBe(10.73);
});

it.each([[7, 3], [7.005, 3.003]])("aligns to the start of a tight gap ending at %ss without pushing a fitting neighbour", (rightStart, duration) => {
  const moving = clip("moving", 0, 20, duration);
  const left = clip("left", 1, 0, 4), right = clip("right", 1, rightStart, 2);
  for (const rawStart of [3.9, 4, 4.1]) {
    const plan = previewClipInsert([moving, left, right], moving, new Set([moving.id]), 1, rawStart, rawStart + 2, true, 0.125);
    expect(plan).toEqual({ start: 4 });
  }
});

it("pushes the right neighbour only to the first saved start that fits the default project's gap", () => {
  const moving = clip("moving", 0, 19.27, 6.2666666666);
  const left = clip("left", 1, 10.7333333333, 8.5333333334);
  const right = clip("right", 1, 25.5333333333, 4.3666666667);
  const touching = clip("touching", 1, 29.9, 1);
  const afterSlack = clip("after-slack", 1, 31, 1);
  const elements = [moving, left, right, touching, afterSlack];
  const plan = previewClipInsert(elements, moving, new Set([moving.id]), 1, 19.2666666667, 22, true, 0.125);
  expect(plan).toEqual({
    start: 19.27,
    insertion: new Map([["moving", 19.27], ["right", 25.54], ["touching", 29.91]]),
  });
  right.timelineLocked = true;
  expect(previewClipInsert(elements, moving, new Set([moving.id]), 1, 19.2666666667, 22, true, 0.125)).toBeNull();
});

it.each([0, 0.18, 1])("makes just enough room in a gap of %ss and leaves later free space alone", gap => {
  const moving = clip("moving", 0, 20, 3);
  const left = clip("left", 1, 0, 4), right = clip("right", 1, 4 + gap, 3), later = clip("later", 1, 12, 2);
  const plan = previewClipInsert([moving, left, right, later], moving, new Set([moving.id]), 1, 3.5, 4)!;
  expect(plan.start).toBe(4);
  expect(plan.insertion).toEqual(new Map([["moving", 4], ["right", 7]]));
  expect(left.start).toBe(0);
  expect(right.start).toBe(4 + gap);
});

it.each([
  { name: "occupied splice", pointer: 3.05, expectedStart: 3.05, targets: [] },
  { name: "snap past the occupied interval", pointer: 3.98, expectedStart: 5, targets: [{ time: 5, type: "clip-edge" as const }] },
  { name: "free time on the aimed row", pointer: 10, expectedStart: 10, targets: [] },
])("keeps overlapping selected clips on separate tracks at $name", ({ pointer, expectedStart, targets }) => {
  const moving = clip("moving", 0, 6, 3), peer = clip("peer", 1, 6, 2);
  const elements = [moving, peer, clip("left", 1, 0, 3), clip("right", 1, 3, 2)];
  const selectedKeys = new Set([moving.id, peer.id]);
  const y = RULER_H + TRACKS_TOP_PAD + TRACK_H / 2;
  const drag = { pointerId: 0, element: moving, originClientX: 120, originClientY: y,
    originScrollLeft: 0, originScrollTop: 0, pointerClientX: 120, pointerClientY: y,
    pointerOffsetX: 0, pointerOffsetY: 20, previewStart: 6, previewTrack: 0, insertRow: null,
    snapTime: null, snapType: null, started: true } satisfies DraggedClipState;
  const preview = computeDragPreview(drag, pointer * 20, y + TRACK_H, {
    scroll: null, pps: 20, duration: 20, trackOrder: [0, 1], elements, selectedKeys,
    buildSnapTargets: () => targets,
  });
  expect(preview).toMatchObject({ previewTrack: 0, previewStart: expectedStart, insertRow: null });
  expect(preview.insertion).toBeUndefined();
  const onMoveElements = vi.fn();
  commitDraggedClipMove(preview, { elements, trackOrder: [0, 1], selectedKeys, updateElement: vi.fn(), onMoveElements });
  expect(onMoveElements).toHaveBeenCalledExactlyOnceWith([
    { element: moving, updates: { track: 0, start: expectedStart } },
    { element: peer, updates: { track: 1, start: expectedStart } },
  ], undefined, "timing");
});

it("inserts across tracks when the selected clips fit end to end on the target", () => {
  const moving = clip("moving", 0, 6, 3), peer = clip("peer", 1, 9, 2);
  const elements = [moving, peer, clip("left", 1, 0, 3), clip("right", 1, 3, 2)];
  const plan = previewClipInsert(elements, moving, new Set([moving.id, peer.id]), 1, 3.05, 3.05);
  expect(plan?.insertion).toEqual(new Map([["moving", 3], ["peer", 6], ["right", 8]]));
});

it("carries linked overlays of pushed clips and previews each clip's own delta", () => {
  usePlayerStore.setState({ timelineLinkageEnabled: true });
  const moving = clip("moving", 0, 20, 3), left = clip("left", 1, 0, 4), right = clip("right", 1, 4, 3), title = clip("title", 0, 5, 1);
  const elements = [moving, left, right, title];
  const plan = previewClipInsert(elements, moving, new Set([moving.id]), 1, 3.5, 4)!;
  expect(plan.insertion?.get("title")).toBe(8);
  const preview = resolveMultiDragPreview({ element: moving, started: true, previewStart: plan.start, insertion: plan.insertion } as DraggedClipState, new Set(), elements)!;
  expect(multiDragPassengerOffsetPx("right", 100, preview)).toBe(300);
  expect(multiDragPassengerOffsetPx("title", 100, preview)).toBe(300);
  expect(multiDragPassengerOffsetPx("left", 100, preview)).toBe(0);
  expect(useTimelineMultiDragActorWindows(preview, true, { start: 6, end: 10 }))
    .toContainEqual({ range: { start: 3, end: 7 }, identities: new Set(["right", "title"]) });
});

it("carries the pushed neighbour's linked media, and refuses a locked partner", () => {
  const moving = clip("moving", 0, 20, 3), left = clip("left", 1, 0, 4);
  const right = { ...clip("right", 1, 4, 3), link: "media" };
  const audio = { ...clip("audio", 2, 4, 3), tag: "audio", link: "media" };
  const elements = [moving, left, right, audio];
  expect(previewClipInsert(elements, moving, new Set([moving.id]), 1, 3.5, 4)?.insertion?.get("audio")).toBe(7);
  audio.timelineLocked = true;
  expect(previewClipInsert(elements, moving, new Set([moving.id]), 1, 3.5, 4)).toBeNull();
  expect(previewClipInsert(elements, moving, new Set([moving.id]), 1, 3.5, 4, false)?.insertion?.has("audio")).toBe(false);
});

it.each(["locked", "foreign", "audio", "room", "free", "overlap"])("keeps ordinary placement for %s boundaries", kind => {
  const moving = clip("moving", 0, 20, 3), left = clip("left", 1, 0, 4), right = clip("right", 1, 4, 3);
  if (kind === "locked") right.timelineLocked = true;
  if (kind === "foreign") right.sourceFile = "other.html";
  if (kind === "audio") right.tag = "audio";
  if (kind === "room") right.start = 8;
  if (kind === "overlap") right.start = 3;
  expect(previewClipInsert([moving, left, right], moving, new Set([moving.id]), 1, kind === "free" ? 30 : 3.5, 4)).toBeNull();
});

it("rounds forward in the composition's own clock so the saved insertion cannot overlap its left neighbour", () => {
  const moving = { ...clip("moving", 0, 20.123, 2), parentCompositionStart: 1.123 };
  const left = { ...clip("left", 1, 1.123, 3.333), parentCompositionStart: 1.123 };
  const right = { ...clip("right", 1, 4.456, 3), parentCompositionStart: 1.123 };
  const plan = previewClipInsert([moving, left, right], moving, new Set([moving.id]), 1, 4, 4.5)!;
  expect(plan.start).toBeCloseTo(4.463);
  expect(plan.insertion?.get("right")).toBeCloseTo(6.463);
});

it("commits a same-lane insertion and every pushed clip once, with rollback on a rejected save", async () => {
  const left = clip("left", 0, 0, 4), right = clip("right", 0, 4, 3), moving = clip("moving", 0, 20, 3);
  const elements = [left, right, moving];
  const plan = previewClipInsert(elements, moving, new Set([moving.id]), 0, 3.5, 4)!;
  const onMoveElements = vi.fn().mockRejectedValue(new Error("save rejected"));
  const onMoveElement = vi.fn(), updateElement = vi.fn();
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  commitDraggedClipMove({ element: moving, previewStart: plan.start, previewTrack: 0, desiredTrack: 0,
    insertRow: null, insertion: plan.insertion } as DraggedClipState,
  { elements, trackOrder: [0], updateElement, onMoveElements, onMoveElement });
  expect(onMoveElements).toHaveBeenCalledTimes(1);
  expect(onMoveElements.mock.calls[0][0].map((edit: {element: TimelineElement; updates: {start: number}}) => [edit.element.id, edit.updates.start]))
    .toEqual([["right", 7], ["moving", 4]]);
  expect(onMoveElement).not.toHaveBeenCalled();
  await Promise.resolve(); await Promise.resolve();
  expect(updateElement).toHaveBeenCalledWith("moving", expect.objectContaining({ start: 20 }));
  expect(updateElement).toHaveBeenCalledWith("right", expect.objectContaining({ start: 4 }));
  error.mockRestore();
});
