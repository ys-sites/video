// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineRazorGuideOverlay, useTimelineRazorInteraction } from "./TimelineRazorInteraction";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
});

function mountGuide() {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let renders = 0;
  const split = vi.fn();
  function Probe({ active, sessionEpoch }: { active: boolean; sessionEpoch: number }) {
    renders++;
    const scrollRef = useRef<HTMLDivElement>(null);
    const razor = useTimelineRazorInteraction({ active, sessionEpoch, scrollRef, contentOrigin: 20, pixelsPerSecond: 100, onSplitAll: split });
    return <div ref={scrollRef} onMouseMove={razor.updateRazorGuide} onMouseLeave={razor.clearRazorGuide} onScroll={razor.clearRazorGuide} onPointerDown={razor.splitAllAtPointer}>
      <button data-clip="true">Clip</button>
      <TimelineRazorGuideOverlay guideRef={razor.razorGuideRef} />
    </div>;
  }
  const render = (active = true, sessionEpoch = 0) => act(() => root.render(<Probe active={active} sessionEpoch={sessionEpoch} />));
  render();
  const scroll = host.firstElementChild as HTMLDivElement;
  scroll.scrollLeft = 30;
  const measure = vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ left: 10 } as DOMRect);
  const guide = host.querySelector("[data-timeline-razor-guide]") as HTMLDivElement;
  const clip = host.querySelector("button")!;
  const move = (x: number, target: Element = clip) => act(() => {
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: x }));
  });
  const flush = () => act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  });
  const unmount = () => act(() => root.unmount());
  cleanup.push(unmount, () => host.remove());
  return { frames, scroll, guide, clip, measure, move, flush, render, split, unmount, renders: () => renders };
}

describe("razor pointer feedback", () => {
  it("coalesces a pointer burst into one layout read without rerendering the timeline", () => {
    const h = mountGuide();
    const renders = h.renders();
    for (let x = 20; x <= 200; x++) h.move(x);
    expect(h.frames.size).toBe(1);
    expect(h.measure).not.toHaveBeenCalled();
    h.flush();
    expect(h.measure).toHaveBeenCalledTimes(1);
    expect(h.guide.style.transform).toBe("translateX(220px)");
    expect(h.guide.style.visibility).toBe("visible");
    expect(h.renders()).toBe(renders);
    h.move(300, h.scroll);
    h.flush();
    expect(h.guide.style.visibility).toBe("hidden");
  });

  it.each(["scroll", "leave", "tool", "session", "unmount"])("discards pending work on %s", (reason) => {
    const h = mountGuide();
    h.move(60);
    h.flush();
    h.move(100);
    if (reason === "scroll") act(() => { h.scroll.dispatchEvent(new Event("scroll")); });
    if (reason === "leave") act(() => { h.scroll.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
    if (reason === "tool") h.render(false);
    if (reason === "session") h.render(true, 1);
    if (reason === "unmount") h.unmount();
    expect(h.frames.size).toBe(0);
    h.flush();
    expect(h.guide.style.visibility).toBe("hidden");
  });

  it("cuts at the click coordinate even before a pending guide sample paints", () => {
    const h = mountGuide();
    h.move(40);
    act(() => {
      h.clip.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 140, shiftKey: true, button: 0 }));
    });
    expect(h.split).toHaveBeenCalledExactlyOnceWith(1.4);
  });
});
