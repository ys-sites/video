// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTimelineTheme } from "./timelineTheme";
import { TimelineGestureOverlay } from "./TimelineGestureOverlay";
import type { DraggedClipState } from "./timelineClipDragTypes";
import { createTimelineRowGeometry } from "./timelineLayout";
import { computeDragPreview } from "./timelineClipDragPreview";
import { commitDraggedClipMove } from "./timelineClipDragCommit";
import { getTrackStyle } from "./useTimelineTrackLayout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const drag: DraggedClipState = {
  pointerId: 0,
  element: { id: "hero", tag: "div", start: 2, duration: 3, track: 1 },
  originClientX: 100,
  originClientY: 100,
  originScrollLeft: 0,
  originScrollTop: 0,
  pointerClientX: 350,
  pointerClientY: 240,
  pointerOffsetX: 20,
  pointerOffsetY: 10,
  previewStart: 4,
  previewTrack: 2,
  insertRow: null,
  snapTime: null,
  snapType: null,
  started: true,
};

afterEach(() => document.body.replaceChildren());

describe("TimelineGestureOverlay", () => {
  it("keeps the actor under the pointer when the collision landing opens another row", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const scroll = { scrollLeft: 0, scrollTop: 0, getBoundingClientRect: () => ({ left: 0, top: 0 }) } as HTMLDivElement;
    act(() => root.render(<TimelineGestureOverlay
      drag={{ ...drag, insertRow: 1 }}
      scrollRef={{ current: scroll }} pixelsPerSecond={100} contentOrigin={132}
      rowGeometry={createTimelineRowGeometry([0, 1, 2], [48, 48, 48])} rowHeight={42}
      selectedElementId="hero" currentTime={0} theme={defaultTimelineTheme} getTrackStyle={getTrackStyle}
    />));
    const actor = host.querySelector<HTMLElement>("[data-timeline-gesture-actor]");
    expect(actor?.style.left).toBe("330px");
    expect(actor?.style.top).toBe("230px");
    act(() => root.unmount());
  });

  it.each([
    { name: "main track", secondary: false },
    { name: "secondary track", secondary: true },
  ])("keeps the actor at the pointer and commits the resolved time on $name", ({ secondary }) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const geometry = createTimelineRowGeometry([0, 1, 2], [48, 48, 48]);
    const cut = { id: "title-cut", domId: "title-cut", tag: "div", start: 7.87, duration: 3.1, track: 0 };
    const neighbour = { id: "next-scene", domId: "next-scene", tag: "div", start: 10, duration: 4, track: 1 };
    const anchor = { id: "earlier-cut", domId: "earlier-cut", tag: "div", start: 0, duration: 5, track: 0 };
    const elements = [anchor, cut, neighbour, ...(secondary
      ? [{ id: "main", domId: "main", tag: "div", start: 0, duration: 20, track: 2 }] : [])];
    const scroll = {
      scrollLeft: 0, scrollTop: 0, scrollWidth: 5000,
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
    } as HTMLDivElement;
    const preview = computeDragPreview({
      ...drag, element: cut, originClientX: 800, originClientY: 56,
      originScrollLeft: 0, originScrollTop: 0, pointerOffsetX: 20, pointerOffsetY: 20,
    }, 1000, 104, {
      scroll, pps: 100, duration: 40, trackOrder: [0, 1, 2], rowGeometry: geometry,
      elements, selectedKeys: new Set(), buildSnapTargets: () => [],
    });
    expect(preview.previewStart).toBe(9.87);
    expect(preview.insertRow).toBeNull();
    expect(preview.previewTrack).toBe(0);
    act(() => root.render(<TimelineGestureOverlay
      drag={preview} scrollRef={{ current: scroll }} pixelsPerSecond={100}
      contentOrigin={132} rowGeometry={geometry} rowHeight={42}
      selectedElementId="title-cut" currentTime={7.87}
      theme={defaultTimelineTheme} getTrackStyle={getTrackStyle}
    />));
    const actor = host.querySelector<HTMLElement>("[data-timeline-gesture-actor]");
    expect(actor?.style.left).toBe("980px");
    expect(actor?.style.top).toBe("84px");
    const onMoveElements = vi.fn();
    const onMoveElement = vi.fn();
    commitDraggedClipMove(preview, {
      elements, trackOrder: [0, 1, 2], updateElement: vi.fn(), onMoveElements, onMoveElement,
    });
    expect(onMoveElement).toHaveBeenCalledWith(cut, { start: preview.previewStart, track: 0 });
    expect(onMoveElements).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("anchors a keyboard insert actor inside the opened seam", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <TimelineGestureOverlay
          drag={{ ...drag, pointerId: null, insertRow: 1 }}
          scrollRef={{
            current: {
              scrollLeft: 0,
              scrollTop: 0,
              getBoundingClientRect: () => ({ left: 0, top: 0 }),
            } as HTMLDivElement,
          }}
          pixelsPerSecond={100}
          contentOrigin={232}
          rowGeometry={createTimelineRowGeometry([0, -1, 1], [48, 48, 48], { top: 0 })}
          rowHeight={42}
          selectedElementId="hero"
          currentTime={4}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
        />,
      ),
    );
    const actor = host.querySelector<HTMLElement>("[data-timeline-gesture-actor]");
    expect(actor?.style.left).toBe("632px");
    expect(actor?.style.top).toBe("75px");
    expect(host.querySelector("[data-timeline-new-track-label]")?.textContent).toContain(
      "+ New track",
    );
    act(() => root.unmount());
  });
  it("keeps the drag actor mounted without a source-row node", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const scroll = {
      scrollLeft: 500,
      scrollTop: 300,
      getBoundingClientRect: () => ({ left: 50, top: 40 }),
    } as HTMLDivElement;
    act(() => {
      root.render(
        <TimelineGestureOverlay
          drag={drag}
          scrollRef={{ current: scroll }}
          pixelsPerSecond={100}
          contentOrigin={232}
          rowGeometry={createTimelineRowGeometry([0, 1, 2], [48, 48, 48])}
          rowHeight={42}
          selectedElementId="hero"
          currentTime={4}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
        />,
      );
    });
    const actor = host.querySelector<HTMLElement>('[data-timeline-gesture-actor="hero"]');
    expect(actor?.style.left).toBe("780px");
    expect(actor?.style.top).toBe("490px");
    expect(actor?.querySelector(".timeline-clip")).not.toBeNull();
    expect(actor?.querySelector("[data-el-id]")).toBeNull();
    expect(actor?.querySelector("[data-clip]")).toBeNull();
    expect(host.querySelector("[data-source-row]")).toBeNull();
    act(() => root.unmount());
  });

  it("asks for the same thumbnail frames as the clip at rest", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const renderClipContent = vi.fn(() => null);
    act(() => {
      root.render(
        <TimelineGestureOverlay
          drag={drag}
          scrollRef={{
            current: {
              scrollLeft: 0,
              scrollTop: 0,
              getBoundingClientRect: () => ({ left: 0, top: 0 }),
            } as HTMLDivElement,
          }}
          pixelsPerSecond={100}
          contentOrigin={232}
          rowGeometry={createTimelineRowGeometry([0, 1, 2], [48, 48, 48])}
          rowHeight={42}
          selectedElementId="hero"
          currentTime={4}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
          renderClipContent={renderClipContent}
        />,
      );
    });
    expect(renderClipContent).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ rich: false }),
    );
    act(() => root.unmount());
  });

  it("keeps the stable overlay host after terminal cleanup", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        <TimelineGestureOverlay
          drag={null}
          scrollRef={{ current: null }}
          pixelsPerSecond={100}
          contentOrigin={232}
          rowGeometry={createTimelineRowGeometry([0, 1, 2], [48, 48, 48])}
          rowHeight={42}
          selectedElementId={null}
          currentTime={0}
          theme={defaultTimelineTheme}
          getTrackStyle={getTrackStyle}
        />,
      );
    });
    expect(host.querySelector("[data-timeline-gesture-overlay]")).not.toBeNull();
    expect(host.querySelector("[data-timeline-gesture-actor]")).toBeNull();
    act(() => root.unmount());
  });
});
