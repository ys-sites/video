// @vitest-environment happy-dom

import type { SetStateAction } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { mountTimelineClipDragGestureLifecycle } from "./timelineClipDragGestureLifecycle";
import { computeDragPreview } from "./timelineClipDragPreview";
import { RULER_H, TRACKS_TOP_PAD, TRACK_H } from "./timelineLayout";
import type { TimelineEditCallbacks } from "./timelineCallbacks";
import type { DraggedClipState, ResizingClipState } from "./timelineClipDragTypes";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  usePlayerStore.getState().reset();
});

it("coalesces high-rate input and flushes the last sample exactly once on release", () => {
  vi.useFakeTimers();
  const gesture = mountGesture("drag");
  for (let clientX = 10; clientX <= 250; clientX++) window.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY: 10 }));
  expect(gesture.updateDraggedClipPreview).not.toHaveBeenCalled();
  vi.advanceTimersByTime(16);
  expect(gesture.updateDraggedClipPreview).toHaveBeenCalledTimes(1);
  expect(gesture.updateDraggedClipPreview.mock.calls[0]).toEqual([expect.anything(), 250, 10]);
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 275, clientY: 10 }));
  release(275, 10);
  expect(gesture.updateDraggedClipPreview).toHaveBeenCalledTimes(2);
  expect(gesture.onMoveElement).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(100);
  expect(gesture.updateDraggedClipPreview).toHaveBeenCalledTimes(2);
  gesture.dispose();
});

it.each(["pointercancel", "keydown", "unmount"])("discards a queued pointer sample on %s", kind => {
  vi.useFakeTimers();
  const gesture = mountGesture("drag");
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 80, clientY: 10 }));
  if (kind === "unmount") gesture.dispose();
  else window.dispatchEvent(kind === "keydown" ? new KeyboardEvent("keydown", { key: "Escape" }) : new MouseEvent("pointercancel"));
  vi.advanceTimersByTime(100);
  expect(gesture.updateDraggedClipPreview).not.toHaveBeenCalled();
  expect(gesture.onMoveElement).not.toHaveBeenCalled();
  gesture.dispose();
});

const element: TimelineElement = {
  id: "clip-1",
  tag: "div",
  start: 0,
  duration: 2,
  track: 0,
};

function mountGesture(kind: "drag" | "resize", pointerId: number | null = null) {
  const drag: DraggedClipState = {
    pointerId: 0,
    element,
    originClientX: 0,
    originClientY: 0,
    originScrollLeft: 0,
    originScrollTop: 0,
    pointerClientX: 0,
    pointerClientY: 0,
    pointerOffsetX: 0,
    pointerOffsetY: 0,
    previewStart: 1,
    previewTrack: 0,
    desiredTrack: 0,
    insertRow: null,
    snapTime: null,
    snapType: null,
    started: true,
  };
  const resize: ResizingClipState = {
    pointerId: 0,
    element,
    edge: "end",
    originClientX: 0,
    previewStart: 0,
    previewDuration: 3,
    started: true,
  };
  const draggedClipRef = { current: kind === "drag" ? drag : null };
  const resizingClipRef = { current: kind === "resize" ? resize : null };
  const setDraggedClip = (next: SetStateAction<DraggedClipState | null>) => {
    draggedClipRef.current = typeof next === "function" ? next(draggedClipRef.current) : next;
  };
  const updateDraggedClipPreview = vi.fn((previous: DraggedClipState, _x: number, _y: number) => ({
    ...previous,
    previewStart: 3,
  }));
  const onMoveElement = vi.fn();
  const onLinkEdit = vi.fn();
  const onResizeElement = vi.fn();
  const updateElement = vi.fn();
  const stopAutoScroll = vi.fn();
  const cancelGestureRef = { current: () => false };
  const applyResizePointer = vi.fn();
  const elementsRef = { current: [element] };
  const onMoveElementsRef: { current: TimelineEditCallbacks["onMoveElements"] } = { current: undefined };
  const dispose = mountTimelineClipDragGestureLifecycle({
    lifecycleRef: { current: { kind, phase: "active", pointerId, sessionEpoch: 0 } },
    sessionEpochRef: { current: 0 },
    cancelGestureRef,
    scrollRef: { current: null },
    draggedClipRef,
    resizingClipRef,
    blockedClipRef: { current: null },
    groupResizeRef: { current: null },
    suppressClickRef: { current: false },
    gestureSelectedKeysRef: { current: new Set() },
    elementsRef,
    trackOrderRef: { current: [0] },
    setDraggedClipState: setDraggedClip,
    setResizingClipState: () => {},
    setShowPopover: () => {},
    setRangeSelectionRef: { current: null },
    applyResizePointerRef: { current: applyResizePointer },
    syncClipDragAutoScrollRef: { current: () => {} },
    stopClipDragAutoScrollRef: { current: stopAutoScroll },
    updateDraggedClipPreviewRef: { current: updateDraggedClipPreview },
    publishDraggedClip: setDraggedClip,
    updateElement,
    onMoveElementRef: { current: onMoveElement },
    onMoveElementsRef,
    onResizeElementRef: { current: onResizeElement },
    onResizeElementsRef: { current: undefined },
    onBlockedEditAttemptRef: { current: undefined },
    onLinkEditRef: { current: onLinkEdit },
    readZIndexRef: { current: undefined },
    onStackingPatchesRef: { current: undefined },
    refreshAfterLaneMoveRef: { current: undefined },
  });
  return {
    draggedClipRef,
    resizingClipRef,
    elementsRef,
    onMoveElementsRef,
    applyResizePointer,
    updateDraggedClipPreview,
    onMoveElement,
    onLinkEdit,
    onResizeElement,
    updateElement,
    stopAutoScroll,
    cancelGestureRef,
    dispose,
  };
}

const release = (clientX: number, clientY: number) =>
  window.dispatchEvent(new MouseEvent("pointerup", { clientX, clientY }));

it("cancels an incompatible release without saving a move or unlinking", () => {
  const g = mountGesture("drag");
  g.draggedClipRef.current = {
    ...g.draggedClipRef.current!,
    element: { ...element, link: "linked" },
    altKey: true,
  };
  g.updateDraggedClipPreview.mockImplementation((previous) => ({ ...previous, invalidDrop: true }));
  const saveBatch = vi.fn();
  g.onMoveElementsRef.current = saveBatch;

  release(70, 10);

  expect(g.draggedClipRef.current).toBeNull();
  expect(g.updateElement).not.toHaveBeenCalled();
  expect(g.onMoveElement).not.toHaveBeenCalled();
  expect(saveBatch).not.toHaveBeenCalled();
  expect(g.onLinkEdit).not.toHaveBeenCalled();
  g.dispose();
});

it.each(["drag", "resize"] as const)("uses the %s release coordinate when its last move was never delivered", kind => {
  vi.useFakeTimers();
  const g = mountGesture(kind);
  g.updateDraggedClipPreview.mockImplementation((previous, x: number) => ({ ...previous, previewStart: x / 100 }));
  g.applyResizePointer.mockImplementation((previous: ResizingClipState, x: number) => {
    g.resizingClipRef.current = { ...previous, previewDuration: 2 + x / 100 };
  });
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40, clientY: 10 }));
  release(70, 10);
  if (kind === "drag") expect(g.onMoveElement).toHaveBeenCalledWith(element, { start: 0.7, track: 0 });
  else expect(g.onResizeElement).toHaveBeenCalledWith(element, expect.objectContaining({ duration: 2.7 }));
  release(80, 10);
  vi.advanceTimersByTime(100);
  expect(kind === "drag" ? g.onMoveElement : g.onResizeElement).toHaveBeenCalledTimes(1);
  g.dispose();
});

it.each([
  { painted: 550, released: 800, mode: "row" },
  { painted: 800, released: 450, mode: "insert" },
  { painted: 550, released: 950, mode: "free" },
  { painted: 550, released: 950, mode: "next-insert", extra: true },
])("commits the final $mode landing once, without saving painted frames", ({ painted, released, mode, extra }) => {
  vi.useFakeTimers();
  const g = mountGesture("drag");
  const clips = [
    { ...element, domId: "clip-1" },
    { ...element, id: "b", domId: "b", start: 2, duration: 3 },
    { ...element, id: "c", domId: "c", start: 5, duration: 4 },
  ];
  if (extra) clips.push({ ...element, id: "d", domId: "d", start: 9, duration: 4 });
  const y = RULER_H + TRACKS_TOP_PAD + TRACK_H / 2;
  g.elementsRef.current = clips;
  g.draggedClipRef.current = { ...g.draggedClipRef.current!, element: clips[0], originClientY: y,
    pointerClientY: y, previewStart: 0 };
  const save = vi.fn();
  g.onMoveElementsRef.current = save;
  g.updateDraggedClipPreview.mockImplementation((previous, x, clientY) => computeDragPreview(previous, x, clientY, {
    elements: clips, pps: 100, duration: 20, trackOrder: [0], scroll: null,
    selectedKeys: new Set(), buildSnapTargets: () => [],
  }));
  window.dispatchEvent(new MouseEvent("pointermove", { clientX: painted, clientY: y }));
  vi.advanceTimersByTime(16);
  expect(g.updateElement).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  expect(g.onMoveElement).not.toHaveBeenCalled();
  release(released, y);
  release(released, y);
  vi.advanceTimersByTime(100);
  if (mode !== "free") {
    expect(save).toHaveBeenCalledTimes(1);
    const edits = Object.fromEntries(save.mock.calls[0][0].map(edit => [edit.element.id, edit.updates]));
    if (mode === "row") {
      expect(edits).toEqual({ "clip-1": { start: 8, track: 0 }, b: { start: 2, track: 1 }, c: { start: 5, track: 1 } });
    } else if (mode === "insert") {
      expect(edits).toEqual({ "clip-1": { start: 5, track: 0 }, c: { start: 7, track: 0 } });
    } else {
      expect(edits).toEqual({ "clip-1": { start: 9, track: 0 }, d: { start: 11, track: 0 } });
    }
    expect(g.onMoveElement).not.toHaveBeenCalled();
  } else {
    expect(save).not.toHaveBeenCalled();
    expect(g.onMoveElement).toHaveBeenCalledExactlyOnceWith(clips[0], { start: released / 100, track: 0 });
  }
  g.dispose();
});

it("commits a released lost capture once, even if pointerup arrives afterwards", () => {
  const g = mountGesture("drag");
  window.dispatchEvent(new MouseEvent("lostpointercapture", { clientX: 70, clientY: 10, buttons: 0 }));
  release(70, 10);
  expect(g.updateDraggedClipPreview).toHaveBeenCalledWith(expect.anything(), 70, 10);
  expect(g.onMoveElement).toHaveBeenCalledTimes(1);
  g.dispose();
});

it.each(["held capture", "cancelled capture", "foreign pointer"])("does not turn a %s into a release", kind => {
  const g = mountGesture("drag", kind === "foreign pointer" ? 1 : null);
  if (kind === "cancelled capture") window.dispatchEvent(new MouseEvent("pointercancel"));
  const event = new MouseEvent("lostpointercapture", { clientX: 70, clientY: 10, buttons: kind === "held capture" ? 1 : 0 });
  if (kind === "foreign pointer") Object.defineProperty(event, "pointerId", { value: 99 });
  window.dispatchEvent(event);
  expect(g.onMoveElement).not.toHaveBeenCalled();
  if (kind !== "foreign pointer") release(70, 10);
  expect(g.onMoveElement).not.toHaveBeenCalled();
  g.dispose();
});

describe("timeline clip drag gesture lifecycle", () => {
  it("finishes a drag after virtualization unmounts its source row", () => {
    vi.useFakeTimers();
    const g = mountGesture("drag");
    const sourceRow = document.createElement("div");
    sourceRow.dataset.timelineRow = "";
    sourceRow.append(document.createElement("div"));
    document.body.append(sourceRow);
    sourceRow.remove();

    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 10 }));
    vi.advanceTimersByTime(16);
    expect(g.updateDraggedClipPreview).toHaveBeenCalledTimes(1);
    expect(g.draggedClipRef.current?.previewStart).toBe(3);

    window.dispatchEvent(new MouseEvent("pointerup"));
    expect(g.onMoveElement).toHaveBeenCalledWith(element, { start: 3, track: 0 });
    expect(g.draggedClipRef.current).toBeNull();
    expect(g.stopAutoScroll).toHaveBeenCalledTimes(1);

    g.dispose();
    expect(g.cancelGestureRef.current()).toBe(false);
  });

  it.each([
    ["above the window", 20, -40],
    ["past the window's right edge", window.innerWidth + 40, 10],
    ["on the window's right edge", window.innerWidth, 10],
    ["on the window's bottom edge", 20, window.innerHeight],
  ])("cancels a drag released %s and leaves the clip where it was", (_, clientX, clientY) => {
    const g = mountGesture("drag");
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 10 }));
    release(clientX, clientY);
    expect(g.onMoveElement).not.toHaveBeenCalled();
    expect(g.updateElement).not.toHaveBeenCalled();
    expect(g.draggedClipRef.current).toBeNull();
    // The cancel ended the gesture, so a later release has nothing to commit.
    release(20, 10);
    expect(g.onMoveElement).not.toHaveBeenCalled();
    g.dispose();
  });

  it("cancels a trim released outside the window", () => {
    const g = mountGesture("resize");
    release(20, -40);
    expect(g.onResizeElement).not.toHaveBeenCalled();
    expect(g.updateElement).not.toHaveBeenCalled();
    expect(g.resizingClipRef.current).toBeNull();
    g.dispose();
  });

  it("still commits a drag released on the window's last pixel", () => {
    const g = mountGesture("drag");
    release(window.innerWidth - 1, window.innerHeight - 1);
    expect(g.onMoveElement).toHaveBeenCalledWith(element, { start: 3, track: 0 });
    g.dispose();
  });
});
