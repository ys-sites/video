// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../store/playerStore";
import { isTimelineMoving, subscribeTimelineMotion } from "./timelineMotion";
import {
  cancelTimelineZoom,
  isTimelineZoomPreviewing,
  subscribeTimelineZoomPreview,
  redrawTimelineZoomPreview,
  currentTimelineRange,
  currentTimelineZoomPercent,
  settleTimelineZoom,
  timelineTimeAtX,
  requestTimelineZoom,
  registerTimelineZoomViewport,
  takeTimelineZoomAnchor,
  timelineZoomMapping,
  zoomTimelineStep,
  zoomTimelineToRange,
} from "./timelineZoomInput";

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "setTimeout",
      "clearTimeout",
      "performance",
    ],
  });
  usePlayerStore.setState({
    zoomMode: "fit",
    manualZoomPercent: 100,
    timelineFitPps: 10,
    timelinePps: 10,
    userZoomCount: 0,
    currentTime: 0,
    duration: 0,
  });
});
afterEach(() => {
  // Run out any ease, preview and rest, so the next test starts with nothing scheduled.
  for (let i = 0; i < 40; i++) vi.advanceTimersToNextFrame();
  unregisterViewport();
  takeTimelineZoomAnchor();
  vi.useRealTimers();
});

let unregisterViewport = () => {};
const publishScroll = vi.fn();

/** A 1080px timeline viewport with 32px of track headers and one clip row. */
function viewport(scrollLeft = 0, scrollWidth = 20_000) {
  const scroll = document.createElement("div");
  Object.defineProperties(scroll, {
    clientWidth: { value: 1080 },
    scrollWidth: { value: scrollWidth },
    scrollLeft: { value: scrollLeft, writable: true },
  });
  const row = scroll.appendChild(document.createElement("div"));
  row.setAttribute("data-timeline-zoom-scale", "");
  const ruler = scroll.appendChild(document.createElement("div"));
  ruler.setAttribute("data-timeline-ruler", "");
  const tick = ruler.appendChild(document.createElement("div"));
  tick.dataset.timelineRulerTime = "20";
  tick.appendChild(document.createElement("span")).textContent = "00:20";
  unregisterViewport = registerTimelineZoomViewport({ scroll, contentOrigin: 32, publishScroll });
  return { scroll, row, ruler, tick };
}

/** Where `time` lands on screen once the committed zoom is laid out. */
const laidOutX = (time: number) => {
  const anchor = takeTimelineZoomAnchor();
  return anchor && anchor.x + (time - anchor.time) * usePlayerStore.getState().timelinePps;
};

describe("requestTimelineZoom", () => {
  it("coalesces a burst into one real layout per frame without stretching rows or text", () => {
    const { row, ruler, tick } = viewport();
    const writes = vi.fn();
    const unsubscribe = usePlayerStore.subscribe(writes);
    requestTimelineZoom(120, { time: 4, x: 100 });
    requestTimelineZoom(150, { time: 4, x: 100 });
    expect(writes).not.toHaveBeenCalled();
    expect(currentTimelineZoomPercent()).toBe(150);
    vi.advanceTimersToNextFrame();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState()).toMatchObject({
      zoomMode: "manual", manualZoomPercent: 150, timelinePps: 15, userZoomCount: 1,
    });
    expect(isTimelineZoomPreviewing()).toBe(false);
    for (const percent of [180, 250, 170, 100]) {
      requestTimelineZoom(percent);
      vi.advanceTimersToNextFrame();
      expect(usePlayerStore.getState().timelinePps).toBe(percent / 10);
      for (const el of [row, ruler, tick, tick.querySelector("span")!]) {
        expect(el.style.transform).toBe("");
      }
    }
    expect(writes).toHaveBeenCalledTimes(5);
    vi.advanceTimersByTime(200);
    expect(writes).toHaveBeenCalledTimes(5);
    unsubscribe();
  });

  it.each([200, 600, 2000])("keeps the pointer's time anchored on every layout at %s%%", (percent) => {
    usePlayerStore.setState({ zoomMode: "manual", manualZoomPercent: 400, timelinePps: 40 });
    const { scroll, row } = viewport(400);
    requestTimelineZoom(percent, { time: 20, x: 432 });
    const mapping = timelineZoomMapping(40, 32);
    expect(mapping.contentOrigin + 20 * mapping.pps - scroll.scrollLeft).toBeCloseTo(432);
    vi.advanceTimersToNextFrame();
    expect(laidOutX(20)).toBeCloseTo(432);
    expect(timelineTimeAtX(432)).toBeCloseTo(20);
    expect(row.style.transform).toBe("");
  });

  it("clamps the target scroll when zooming in from below Fit", () => {
    usePlayerStore.setState({ zoomMode: "manual", manualZoomPercent: 50, timelinePps: 5 });
    const { scroll } = viewport();
    requestTimelineZoom(110, { time: 90, x: 482 });
    vi.advanceTimersToNextFrame();
    expect(scroll.scrollLeft).toBeCloseTo(102.6);
  });

  it.each([
    { percent: 50, base: 100, left: 0, width: 1080 },
    { percent: 60, base: 100, left: 0, width: 20000 },
    { percent: 700, base: 1000, left: 5000, width: 20000 },
    { percent: 300, base: 330, left: 2403, width: 3483 },
  ])("lays out zoom-outs without waiting for rest: $base -> $percent", ({ percent, base, left, width }) => {
    usePlayerStore.setState({ zoomMode: "manual", manualZoomPercent: base, timelinePps: base / 10 });
    const { row } = viewport(left, width);
    requestTimelineZoom(percent);
    vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBe(percent / 10);
    expect(row.style.transform).toBe("");
  });

  it("keeps newly mounted rows unscaled during a scroll and pending zoom", async () => {
    const { scroll } = viewport();
    requestTimelineZoom(150);
    redrawTimelineZoomPreview();
    const mountedRow = document.createElement("div");
    mountedRow.setAttribute("data-timeline-zoom-scale", "");
    scroll.appendChild(mountedRow);
    await Promise.resolve();
    vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBe(15);
    expect(mountedRow.style.transform).toBe("");
  });

  it("settles pending geometry immediately before hit testing", () => {
    viewport();
    requestTimelineZoom(150);
    settleTimelineZoom();
    expect(usePlayerStore.getState().timelinePps).toBe(15);
    expect(isTimelineZoomPreviewing()).toBe(false);
  });

  it("tells listeners when a pending zoom is dropped", () => {
    viewport();
    requestTimelineZoom(150);
    let pendingAfterDrop: boolean | null = null;
    const unsubscribe = subscribeTimelineZoomPreview(() => {
      pendingAfterDrop = isTimelineZoomPreviewing();
    });
    cancelTimelineZoom();
    unsubscribe();
    expect(pendingAfterDrop).toBe(false);
  });

  it("cancels an unpainted request, as Fit does", () => {
    const { row } = viewport();
    requestTimelineZoom(150);
    cancelTimelineZoom();
    vi.advanceTimersByTime(300);
    expect(usePlayerStore.getState().timelinePps).toBe(10);
    expect(row.style.transform).toBe("");
  });

  it("lays the zoom out before the timeline counts as at rest", () => {
    viewport();
    let ppsAtRest = 0;
    const unsubscribe = subscribeTimelineMotion(() => {
      if (!isTimelineMoving()) ppsAtRest = usePlayerStore.getState().timelinePps;
    });
    requestTimelineZoom(150);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersByTime(200);
    unsubscribe();
    expect(ppsAtRest).toBe(15);
  });

  it("keeps a pending zoom when the timeline registers again", async () => {
    const { scroll } = viewport();
    requestTimelineZoom(150);
    unregisterViewport();
    unregisterViewport = registerTimelineZoomViewport({ scroll, contentOrigin: 32, publishScroll });
    await Promise.resolve();
    vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().timelinePps).toBe(15);
  });

  it("keeps a newer timeline's registration when an older one unmounts", () => {
    const unregisterOlder = registerTimelineZoomViewport({
      scroll: document.createElement("div"), contentOrigin: 32, publishScroll,
    });
    viewport();
    unregisterOlder();
    expect(currentTimelineRange()).not.toBeNull();
  });
});

describe("zoomTimelineToRange", () => {
  it("tells the timeline where a pan at the laid-out scale scrolled to", () => {
    usePlayerStore.setState({
      duration: 1000,
      zoomMode: "manual",
      manualZoomPercent: 1000,
      timelineFitPps: 10,
      timelinePps: 100,
    });
    const { scroll } = viewport(0);
    const published: number[] = [];
    publishScroll.mockImplementation((el: HTMLDivElement) => published.push(el.scrollLeft));
    void zoomTimelineToRange(60, 70);
    for (let i = 0; i < 40; i++) vi.advanceTimersToNextFrame();
    publishScroll.mockReset();
    expect(usePlayerStore.getState().timelinePps).toBe(100);
    expect(scroll.scrollLeft).toBeGreaterThan(5000);
    expect(published.at(-1)).toBe(scroll.scrollLeft);
  });

  it("fills the width with the range and puts its start at the left margin", () => {
    viewport();
    void zoomTimelineToRange(40, 90, { smooth: false });
    // Laid out on the next frame, never inside the caller's own render or effect.
    expect(usePlayerStore.getState().timelinePps).toBe(10);
    vi.advanceTimersToNextFrame();
    // 1080 - (32 + 24) - 24 = 1000px for 50s is 20 pps.
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(laidOutX(40)).toBeCloseTo(56);
  });

  it("eases there over several frames and ends exactly on the range", () => {
    const { row, tick } = viewport();
    void zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    expect(currentTimelineZoomPercent()).toBeGreaterThan(100);
    expect(currentTimelineZoomPercent()).toBeLessThan(1000);
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersToNextFrame();
      expect(row.style.transform).toBe("");
      expect(tick.style.transform).toBe("");
      expect(usePlayerStore.getState().manualZoomPercent).toBe(currentTimelineZoomPercent());
    }
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(100);
    expect(laidOutX(10)).toBeCloseTo(56);
  });

  it("stops easing when a person zooms during it, and says it was cancelled", async () => {
    viewport();
    const result = zoomTimelineToRange(10, 20);
    vi.advanceTimersToNextFrame();
    vi.advanceTimersToNextFrame();
    requestTimelineZoom(150);
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    expect(usePlayerStore.getState().manualZoomPercent).toBe(150);
    await expect(result).resolves.toBe("cancelled");
  });

  it("resolves done once the range is laid out, without counting as a person's zoom", async () => {
    const { row } = viewport();
    let settled: string | null = null;
    void zoomTimelineToRange(10, 20).then((r) => (settled = r));
    for (let i = 0; i < 30 && settled === null; i++) {
      vi.advanceTimersToNextFrame();
      await Promise.resolve();
    }
    expect(settled).toBe("done");
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(100);
    expect(usePlayerStore.getState().userZoomCount).toBe(0);
    expect(row.style.transform).toBe("");
  });

  it("leaves a newer zoom alone when an older one's signal aborts", async () => {
    viewport();
    const abort = new AbortController();
    const older = zoomTimelineToRange(10, 20, { signal: abort.signal });
    const newer = zoomTimelineToRange(30, 40);
    abort.abort();
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
    await expect(older).resolves.toBe("cancelled");
    await expect(newer).resolves.toBe("done");
  });

  it("cancels when the caller aborts", async () => {
    viewport();
    const abort = new AbortController();
    const result = zoomTimelineToRange(10, 20, { signal: abort.signal });
    vi.advanceTimersToNextFrame();
    abort.abort();
    await expect(result).resolves.toBe("cancelled");
  });

  it("resolves cancelled when the timeline is no wider than its headers", async () => {
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: 32 },
      scrollWidth: { value: 32 },
      scrollLeft: { value: 0, writable: true },
    });
    unregisterViewport = registerTimelineZoomViewport({ scroll, contentOrigin: 32, publishScroll });
    const result = zoomTimelineToRange(10, 20, { smooth: false });
    await expect(result).resolves.toBe("cancelled");
    expect(usePlayerStore.getState().zoomMode).toBe("fit");
    expect(usePlayerStore.getState().timelinePps).toBe(10);
  });
});

describe("currentTimelineRange", () => {
  it("reads back the range zoomTimelineToRange filled", () => {
    viewport();
    void zoomTimelineToRange(40, 90, { smooth: false });
    vi.advanceTimersToNextFrame();
    const range = currentTimelineRange()!;
    expect(range.start).toBeCloseTo(40);
    expect(range.end).toBeCloseTo(90);
  });

  it("reads the range a gesture shows before it is laid out", () => {
    viewport();
    requestTimelineZoom(150, { time: 0, x: 32 });
    const range = currentTimelineRange()!;
    // 1000px between the margins at 15 px/s, from 24px in.
    expect(range.start).toBeCloseTo(24 / 15);
    expect(range.end - range.start).toBeCloseTo(1000 / 15);
  });

  it("is null with no timeline mounted", () => {
    expect(currentTimelineRange()).toBeNull();
  });
});

describe("zoomTimelineStep", () => {
  const run = () => {
    for (let i = 0; i < 30; i++) vi.advanceTimersToNextFrame();
  };

  it.each(["in", "out"] as const)("lays out a zoom-%s without stretching rows or ruler text", (direction) => {
    usePlayerStore.setState({ currentTime: 110, duration: 1000, zoomMode: "manual", manualZoomPercent: 400, timelinePps: 40 });
    const { row, ruler, tick } = viewport(4000);
    zoomTimelineStep(direction);
    expect(usePlayerStore.getState().timelinePps).toBe(direction === "in" ? 80 : 20);
    expect(laidOutX(110)).toBeCloseTo(432);
    for (let i = 0; i < 30; i++) {
      vi.advanceTimersToNextFrame();
      expect(row.style.transform).toBe("");
      expect(ruler.style.transform).toBe("");
      expect(tick.style.transform).toBe("");
      expect(tick.querySelector("span")!.style.transform).toBe("");
    }
  });

  it("counts as a person's zoom", () => {
    viewport();
    zoomTimelineStep("in");
    run();
    expect(usePlayerStore.getState().userZoomCount).toBeGreaterThan(0);
  });

  it("doubles the scale and keeps an on-screen playhead where it is", () => {
    usePlayerStore.setState({ currentTime: 40 });
    viewport();
    // At 10 pps the playhead sits at 32 + 400 = 432px.
    zoomTimelineStep("in");
    run();
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
    expect(laidOutX(40)).toBeCloseTo(432);
  });

  it("counts consecutive clicks from the last committed scale", () => {
    viewport();
    zoomTimelineStep("in");
    zoomTimelineStep("in");
    expect(usePlayerStore.getState().timelinePps).toBe(40);
    expect(usePlayerStore.getState().userZoomCount).toBe(2);
  });

  it("centres an off-screen playhead", () => {
    usePlayerStore.setState({
      currentTime: 60,
      zoomMode: "manual",
      manualZoomPercent: 400,
      timelinePps: 40,
    });
    // 0..26.2 s on screen at 40 px/s.
    viewport();
    zoomTimelineStep("in");
    run();
    // The range's middle, 56 + 1000 / 2, is the playhead.
    expect(laidOutX(60)).toBeCloseTo(556);
  });

  it("still doubles the scale when the timeline is no wider than its headers", () => {
    const scroll = document.createElement("div");
    Object.defineProperties(scroll, {
      clientWidth: { value: 32 },
      scrollWidth: { value: 32 },
      scrollLeft: { value: 0, writable: true },
    });
    unregisterViewport = registerTimelineZoomViewport({ scroll, contentOrigin: 32, publishScroll });
    zoomTimelineStep("in");
    vi.advanceTimersByTime(150);
    expect(usePlayerStore.getState().timelinePps).toBeCloseTo(20);
  });
});
