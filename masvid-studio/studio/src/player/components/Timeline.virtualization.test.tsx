// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TIMELINE_SCROLL_SETTLE_MS } from "./useTimelineScrollViewport";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resizeObservers = new Set<MockResizeObserver>();
class MockResizeObserver {
  private target?: Element;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    this.target = target;
    resizeObservers.add(this);
    this.resize();
  }
  resize() {
    const target = this.target!;
    this.callback(
      [
        {
          target,
          borderBoxSize: [{ inlineSize: target.clientWidth, blockSize: target.clientHeight }],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() { resizeObservers.delete(this); }
}

const originalResizeObserver = globalThis.ResizeObserver;
const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
let clientWidth = 900;
let clientHeight = 240;

beforeAll(() => {
  vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1");
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
});

beforeEach(() => {
  clientWidth = 900;
  clientHeight = 240;
});

afterAll(() => {
  vi.unstubAllEnvs();
  globalThis.ResizeObserver = originalResizeObserver;
  if (originalClientWidth)
    Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
  if (originalClientHeight)
    Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
  document.body.innerHTML = "";
});

/**
 * The virtualized list only mounts rows/clips after its ResizeObserver and the
 * follow-up layout effect have both flushed, which is more than one React tick.
 * A fixed number of flushes is a coin flip once the rest of the suite is
 * competing for workers, so wait for the DOM the assertions actually need.
 */
async function settleUntil(predicate: () => boolean, tries = 60): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (predicate()) return;
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
  }
}

async function advanceFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function mountTimeline(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  await act(async () => {});
  return { host, root };
}

async function dispatchScroll(scroller: HTMLElement): Promise<void> {
  await act(async () => {
    scroller.dispatchEvent(new Event("scroll"));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

function clipsByTrack(count: number, duration = 1, includeLabels = false) {
  return Array.from({ length: count }, (_, track) => ({
    id: `clip-${track}`,
    ...(includeLabels ? { label: `Clip ${track}` } : {}),
    tag: "div",
    start: 0,
    duration,
    track,
  }));
}

async function scrollTimelineHorizontally(
  scroller: HTMLElement,
  scrollLeft: number,
): Promise<void> {
  scroller.scrollLeft = scrollLeft;
  await dispatchScroll(scroller);
}

// These tests mount 500-10,000 timeline elements and settle the virtualizer,
// which lands right on the 5s default once the rest of the suite is competing
// for workers. The generous ceiling is a flake guard, not an expected runtime.
describe("Timeline row virtualization", { timeout: 30_000 }, () => {
  it("keeps a zero-size first render bounded while the feature flag is enabled", async () => {
    clientWidth = 0;
    clientHeight = 0;
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      elements: clipsByTrack(10_000),
    });

    const { host, root } = await mountTimeline(React.createElement(Timeline, { sessionEpoch: 2 }));

    const rows = host.querySelectorAll("[data-timeline-row]");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });

  it("keeps a clip's picture on screen while the timeline scrolls", async () => {
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      selectedElementId: "clip-0",
      elements: [{ id: "clip-0", label: "Clip 0", tag: "div", start: 0, duration: 10, track: 0 }],
    });

    const { host, root } = await mountTimeline(
      React.createElement(Timeline, {
        renderClipContent: () => React.createElement("span", { "data-rich-content": true }),
      }),
    );
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });

      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      const clip = host.querySelector<HTMLElement>('[data-el-id="clip-0"]');
      expect(scroller).not.toBeNull();
      expect(clip).not.toBeNull();
      expect(clip?.hasAttribute("title")).toBe(false);
      await act(async () => {
        clip?.focus();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Clip 0 • 0.0s to 10.0s");
      const picture = host.querySelector("[data-rich-content]");
      expect(picture).not.toBeNull();

      if (scroller) await dispatchScroll(scroller);
      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelector("[data-rich-content]")).toBe(picture);

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });
      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelector("[data-rich-content]")).toBe(picture);
    } finally {
      act(() => root.unmount());
      usePlayerStore.getState().reset();
    }
  });

  it("gives a clip that appears mid-scroll its picture once the scroll settles", async () => {
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    const clip = (id: string, start: number) => ({
      id,
      label: id,
      tag: "div",
      start,
      duration: 5,
      track: 0,
    });
    usePlayerStore.setState({ duration: 60, timelineReady: true, elements: [clip("clip-0", 0)] });

    const { host, root } = await mountTimeline(
      React.createElement(Timeline, {
        renderClipContent: (element: { id: string }) =>
          React.createElement("span", { "data-rich-content": element.id }),
      }),
    );
    try {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      if (scroller) await dispatchScroll(scroller);
      act(() => {
        usePlayerStore.setState({ elements: [clip("clip-0", 0), clip("clip-1", 5)] });
      });
      expect(host.querySelector('[data-el-id="clip-1"]')).not.toBeNull();
      expect(host.querySelector('[data-rich-content="clip-1"]')).toBeNull();
      expect(host.querySelector('[data-rich-content="clip-0"]')).not.toBeNull();

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 110));
      });
      expect(host.querySelector('[data-rich-content="clip-1"]')).not.toBeNull();
    } finally {
      act(() => root.unmount());
      usePlayerStore.getState().reset();
    }
  });

  it("mounts a bounded list range over the full geometry height", async () => {
    const [{ Timeline }, { usePlayerStore }, { getTimelineCanvasHeight, TRACK_H }] =
      await Promise.all([
        import("./Timeline"),
        import("../store/playerStore"),
        import("./timelineLayout"),
      ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      elements: clipsByTrack(1_000),
    });

    const { host, root } = await mountTimeline(React.createElement(Timeline, { sessionEpoch: 3 }));

    await settleUntil(
      () =>
        (host.querySelector('[role="treegrid"]')?.querySelectorAll('[role="row"]').length ?? 0) > 0,
    );
    const treegrid = host.querySelector<HTMLElement>('[role="treegrid"]');
    const rows = treegrid?.querySelectorAll('[role="row"]') ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(16);
    expect(rows[0]?.getAttribute("aria-rowindex")).toBe("1");
    expect(treegrid?.getAttribute("aria-rowcount")).toBe("1000");
    expect(treegrid?.hasAttribute("aria-multiselectable")).toBe(false);
    expect(treegrid?.querySelectorAll('[data-timeline-focus-id][tabindex="0"]')).toHaveLength(1);
    expect(treegrid?.parentElement?.style.height).toBe(
      `${getTimelineCanvasHeight(Array.from({ length: 1_000 }, () => TRACK_H))}px`,
    );

    const firstRow = rows[0] as HTMLElement;
    const focusedControl = firstRow.querySelector<HTMLButtonElement>("button");
    expect(focusedControl).not.toBeNull();
    act(() => focusedControl?.focus());
    const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
    expect(scroller).not.toBeNull();
    if (scroller) {
      scroller.scrollTop = 500 * 48;
      await act(async () => {
        scroller.dispatchEvent(new Event("scroll"));
      });
    }
    expect(treegrid?.querySelector('[data-timeline-row-key="0"]')).not.toBeNull();
    expect(document.activeElement).toBe(focusedControl);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });

  it("keeps focus pinning active after the scroll viewport remounts", async () => {
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      elements: clipsByTrack(1_000),
    });

    const { host, root } = await mountTimeline(React.createElement(Timeline, { sessionEpoch: 9 }));
    await settleUntil(() => host.querySelectorAll("[data-timeline-row]").length > 0);
    const firstScroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");

    await act(async () => usePlayerStore.setState({ timelineReady: false }));
    expect(host.querySelector("[data-timeline-scroll-viewport]")).toBeNull();
    await act(async () => usePlayerStore.setState({ timelineReady: true }));
    await settleUntil(() => host.querySelectorAll("[data-timeline-row]").length > 0);

    const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
    const firstRow = host.querySelector<HTMLElement>('[data-timeline-row-key="0"]');
    const focusedControl = firstRow?.querySelector<HTMLButtonElement>("button");
    expect(scroller).not.toBe(firstScroller);
    expect(focusedControl).not.toBeNull();
    act(() => focusedControl?.focus());
    if (scroller) {
      scroller.scrollTop = 500 * 48;
      await dispatchScroll(scroller);
    }
    expect(host.querySelector('[data-timeline-row-key="0"]')).not.toBeNull();
    expect(document.activeElement).toBe(focusedControl);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });

  it("windows clips and ruler cells while retaining an off-window selected clip", async () => {
    const [{ Timeline }, { usePlayerStore }, { TIMELINE_VIEWPORT_BUDGETS }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
      import("../lib/timelineViewportBudgets"),
    ]);
    usePlayerStore.setState({
      duration: 1_000,
      timelineReady: true,
      timelineProjectId: "project-a",
      timelineSessionEpoch: 4,
      zoomMode: "manual",
      manualZoomPercent: 2_000,
      selectedElementId: "clip-490",
      selectedElementIds: new Set(["clip-490"]),
      // Repeated fixture shape intentionally contrasts row and clip windowing scales.
      // fallow-ignore-next-line code-duplication
      elements: Array.from({ length: 500 }, (_, index) => ({
        id: `clip-${index}`,
        tag: "div",
        start: index * 2,
        duration: 1,
        track: 0,
      })),
    });

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(Timeline, { sessionEpoch: 4 })));
    await act(async () => {});

    await settleUntil(() => host.querySelectorAll("[data-clip]").length > 1);
    const initialClips = [...host.querySelectorAll<HTMLElement>("[data-clip]")];
    const initialGridCells = host.querySelectorAll("[data-timeline-grid-cell]");
    expect(initialClips.length).toBeGreaterThan(1);
    expect(initialClips.length).toBeLessThanOrEqual(
      TIMELINE_VIEWPORT_BUDGETS.maxMountedClipRootsPerRow + 1,
    );
    expect(initialGridCells.length).toBeLessThan(100);
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();
    const initialWindowIds = initialClips.map((clip) => clip.dataset.elId);

    const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
    expect(scroller).not.toBeNull();
    if (scroller) await scrollTimelineHorizontally(scroller, 8_000);

    const scrolledClips = [...host.querySelectorAll<HTMLElement>("[data-clip]")];
    expect(scrolledClips.map((clip) => clip.dataset.elId)).not.toEqual(initialWindowIds);
    expect(scrolledClips.length).toBeLessThanOrEqual(
      TIMELINE_VIEWPORT_BUDGETS.maxMountedClipRootsPerRow + 1,
    );
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-timeline-grid-cell]").length).toBeLessThan(100);

    const { timelineClipFocusId } = await import("./timelineNavigationIdentity");
    await act(async () =>
      usePlayerStore.getState().requestTimelineFocus(timelineClipFocusId("clip-300")),
    );
    await advanceFrame();
    await act(async () => {});
    expect(usePlayerStore.getState().timelineFocus?.id).toBe(timelineClipFocusId("clip-300"));
    const focusedClip = host.querySelector('[data-el-id="clip-300"]');
    expect(document.activeElement).toBe(focusedClip);
    await advanceFrame();
    expect(host.querySelector('[data-el-id="clip-300"]')).toBe(focusedClip);
    expect(document.activeElement).toBe(focusedClip);
    expect(host.querySelector('[data-el-id="clip-490"]')).not.toBeNull();

    if (scroller) await scrollTimelineHorizontally(scroller, 0);
    expect(host.querySelector('[data-el-id="clip-300"]')).toBe(focusedClip);
    expect(document.activeElement).toBe(focusedClip);

    act(() => root.unmount());
    usePlayerStore.getState().reset();
  });
});

describe("MVP centered track geometry", () => {
  it.each(["0", "1"])("centers tracks, retains intrinsic sizing and aligns drops with virtualization=%s", async flag => {
    vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", flag);
    vi.resetModules();
    const [{ Timeline }, { usePlayerStore }, { StudioHostContext }, { dragTimelineFixtureAsset }] = await Promise.all([
      import("./Timeline"), import("../store/playerStore"), import("../../motion/StudioHost"), import("./timelineMountFixtures"),
    ]);
    clientHeight = 400;
    usePlayerStore.setState({ duration: 10, currentTime: 0, timelineReady: true, elements: clipsByTrack(3, 2, true) });
    const onAssetDrop = vi.fn();
    const onContentHeightChange = vi.fn();
    const { host, root } = await mountTimeline(<StudioHostContext.Provider value={{ mvpEditor: true }}>
      <Timeline onAssetDrop={onAssetDrop} onContentHeightChange={onContentHeightChange} />
    </StudioHostContext.Provider>);
    try {
      const viewport = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]")!;
      // The bottom visual track is the main track; its collapsed row is taller.
      const rowHeights = [48, 48, 64];
      const tracksHeight = 160;
      for (const height of [400, 560, 200]) {
        await act(async () => { clientHeight = height; for (const observer of resizeObservers) observer.resize(); });
        const spare = height - 24 - tracksHeight;
        const pad = Math.max(8, Math.min(spare / 2, spare - 48));
        const lane = host.querySelector<HTMLElement>('[data-testid="timeline-ghost-lane"]')!;
        expect(parseFloat(lane.style.top)).toBe(24 + pad + tracksHeight + 3);
        expect(onContentHeightChange.mock.calls.at(-1)?.[0]).toBe(24 + 8 + tracksHeight + 48);
        for (const [track, rowHeight] of rowHeights.entries()) {
          const rowTop = 24 + pad + track * 48;
          act(() => usePlayerStore.getState().setSelectedElementId(`clip-${track}`));
          const strip = host.querySelector<HTMLElement>('[style*="--timeline-accent-faint"]');
          expect(strip?.style.top).toBe(`${rowTop + 3}px`);
          expect(strip?.style.height).toBe(`${rowHeight - 6}px`);
          dragTimelineFixtureAsset(viewport, "dragover", rowTop + rowHeight / 2);
          const preview = host.querySelector<HTMLElement>('[data-testid="timeline-drop-preview"]');
          expect(preview?.style.top).toBe(`${rowTop + 3}px`);
          expect(preview?.style.height).toBe(`${rowHeight - 6}px`);
          dragTimelineFixtureAsset(viewport, "drop", rowTop + rowHeight / 2);
          expect(onAssetDrop).toHaveBeenLastCalledWith("a.png", expect.objectContaining({ track }));
        }
      }
      act(() => usePlayerStore.setState({ expandedClipIds: new Set(["clip-2"]) }));
      expect(host.querySelector<HTMLElement>('[style*="--timeline-accent-faint"]')?.style.height).toBe("42px");
    } finally {
      act(() => root.unmount()); usePlayerStore.getState().reset();
      vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1"); vi.resetModules();
    }
  });
});

/**
 * The rollback build mounts every clip, so the scroll-time concessions
 * windowing makes are pure cost there. This block pins that explicit fallback
 * to doing no per-frame work while a gesture runs.
 */
describe("Timeline without row virtualization", { timeout: 30_000 }, () => {
  async function renderUnvirtualizedTimeline(mvpEditor = false) {
    vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "0");
    vi.resetModules();
    const [{ Timeline }, { usePlayerStore }] = await Promise.all([
      import("./Timeline"),
      import("../store/playerStore"),
    ]);
    usePlayerStore.setState({
      duration: 60,
      timelineReady: true,
      selectedElementId: "clip-0",
      elements: clipsByTrack(40, 10, true),
    });

    const { StudioHostContext } = await import("../../motion/StudioHost");
    const onSeek = vi.fn();
    const { host, root } = await mountTimeline(
      <StudioHostContext.Provider value={{ mvpEditor }}><Timeline
        onSeek={onSeek}
        renderClipContent={() => <span data-rich-content />}
      /></StudioHostContext.Provider>,
    );
    return {
      host,
      onSeek,
      dispose: () => {
        act(() => root.unmount());
        usePlayerStore.getState().reset();
        vi.stubEnv("VITE_STUDIO_TIMELINE_ROW_VIRTUALIZATION_ENABLED", "1");
        vi.resetModules();
      },
    };
  }

  it("resizes the control column with the final pointer sample and keeps the saved width across narrow hosts", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline(true);
    try {
      const handle = host.querySelector<HTMLElement>('[aria-label="Resize track controls"]')!;
      handle.setPointerCapture = vi.fn(); handle.releasePointerCapture = vi.fn();
      const pointer = (type: string, x: number) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: x }));
      await act(async () => pointer("pointerdown", 132));
      await act(async () => pointer("pointermove", 180));
      await act(async () => pointer("pointerup", 220));
      const origin = () => Number(host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]")!.dataset.timelineContentOrigin);
      expect(origin()).toBe(220);
      expect(host.querySelector<HTMLElement>('[role="rowheader"]')!.style.width).toBe("220px");
      clientWidth = 320;
      await act(async () => resizeObservers.forEach(observer => observer.resize()));
      expect(origin()).toBe(106);
      clientWidth = 900;
      await act(async () => resizeObservers.forEach(observer => observer.resize()));
      expect(origin()).toBe(220);
      await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));
      expect(origin()).toBe(210);
      await act(async () => pointer("pointerdown", 210));
      await act(async () => pointer("pointermove", 180));
      await act(async () => pointer("pointercancel", 180));
      expect(origin()).toBe(210);
    } finally { dispose(); localStorage.clear(); }
  });

  it("keeps narrow MVP headers, ruler seeking and drag bounds aligned through resizing", async () => {
    const { host, onSeek, dispose } = await renderUnvirtualizedTimeline(true);
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]")!;
      scroller.setPointerCapture = vi.fn();
      scroller.releasePointerCapture = vi.fn();
      for (const width of [320, 480, 900]) {
        await act(async () => {
          clientWidth = width;
          for (const observer of resizeObservers) observer.resize();
        });
        const origin = Number(scroller.dataset.timelineContentOrigin);
        const labelWidth = parseFloat(host.querySelector<HTMLElement>('[role="rowheader"]')!.style.width);
        expect(origin - labelWidth).toBe(0);
        expect(Number(scroller.dataset.timelineAutoScrollLeftInset)).toBe(labelWidth);
        expect(host.querySelector<HTMLElement>(".sticky.left-0")!.style.width).toBe(`${origin}px`);
        expect(width - origin).toBeGreaterThan(width / 2);
        if (width === 900) expect(labelWidth).toBe(132);
        const tick = host.querySelectorAll<HTMLElement>('[data-timeline-grid-cell="major"]')[1]!;
        const [, minutes, seconds] = /(\d+):(\d+)/.exec(tick.textContent ?? "")!;
        const at = { bubbles: true, clientX: origin + parseFloat(tick.style.left) + 0.5, clientY: 4, button: 0, pointerId: 1 };
        await act(async () => tick.dispatchEvent(new PointerEvent("pointerdown", at)));
        await act(async () => tick.dispatchEvent(new PointerEvent("pointerup", at)));
        expect(onSeek.mock.calls.at(-1)?.[0]).toBeCloseTo(Number(minutes) * 60 + Number(seconds), 1);
      }
    } finally { dispose(); }
  });

  it.each([false, true])("keeps a scrolled-off playhead clipped with aligned headers throughout scrolling (MVP: %s)", async mvp => {
    const { host, dispose } = await renderUnvirtualizedTimeline(mvp);
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]")!;
      const layer = () => host.querySelector<HTMLElement>("[data-timeline-playhead-layer]");
      if (mvp) {
        expect(host.querySelector<HTMLElement>('[role="rowheader"]')?.style.width).toBe("132px");
        expect(scroller.dataset.timelineAutoScrollLeftInset).toBe("132");
        expect(host.querySelector<HTMLElement>(".sticky.left-0")?.style.width).toBe("132px");
        expect(host.querySelector<HTMLElement>('[role="rowheader"]')?.textContent).not.toContain("Clip 0");
      }
      await scrollTimelineHorizontally(scroller, 166);
      // The ruler's corner is as wide as the track headers; the glow may overhang by 6.5px.
      const headerWidth = parseFloat(
        host.querySelector<HTMLElement>(".sticky.left-0")!.style.width,
      );
      expect(layer()?.style.clipPath).toContain(`${166 + headerWidth - 6.5}px)`);
      await scrollTimelineHorizontally(scroller, 320);
      expect(layer()?.style.clipPath).toContain(`${320 + headerWidth - 6.5}px)`);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, TIMELINE_SCROLL_SETTLE_MS + 20));
      });
      expect(layer()?.style.clipPath).toContain(`${320 + headerWidth - 6.5}px)`);
      await scrollTimelineHorizontally(scroller, 0);
      expect(layer()?.style.clipPath).toContain(`${headerWidth - 6.5}px)`);
    } finally {
      dispose();
    }
  });

  it("mounts every clip rather than a window", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      expect(host.querySelectorAll("[data-clip]").length).toBe(40);
    } finally {
      dispose();
    }
  });

  it("keeps clip content mounted across a scroll gesture", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      expect(scroller).not.toBeNull();
      const richBefore = host.querySelectorAll("[data-rich-content]").length;
      expect(richBefore).toBe(40);

      if (scroller) await dispatchScroll(scroller);

      expect(host.querySelectorAll("[data-rich-content]").length).toBe(richBefore);
    } finally {
      dispose();
    }
  });

  it("does not swap clip content back in after the gesture settles", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      const clip = host.querySelector<HTMLElement>('[data-el-id="clip-0"]');
      if (scroller) await dispatchScroll(scroller);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 150));
      });

      expect(host.querySelector('[data-el-id="clip-0"]')).toBe(clip);
      expect(host.querySelectorAll("[data-rich-content]").length).toBe(40);
    } finally {
      dispose();
    }
  });

  it("leaves the scroll position alone, so no snapshot round trip happens", async () => {
    const { host, dispose } = await renderUnvirtualizedTimeline();
    try {
      const scroller = host.querySelector<HTMLElement>("[data-timeline-scroll-viewport]");
      if (!scroller) throw new Error("Expected a timeline scroll viewport");
      scroller.scrollTop = 400;
      await dispatchScroll(scroller);

      expect(scroller.scrollTop).toBe(400);
    } finally {
      dispose();
    }
  });
});
