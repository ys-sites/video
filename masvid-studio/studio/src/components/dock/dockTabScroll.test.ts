// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installTabScroll } from "./dockTabScroll";

let root: HTMLElement;
let strip: HTMLElement;
let label: HTMLElement;
let dispose: () => void;

beforeEach(() => {
  root = document.createElement("div");
  root.innerHTML = '<div class="dv-scrollable"><div class="dv-tabs-container"><span>My media</span></div></div><div class="panel-content"></div>';
  document.body.append(root);
  strip = root.querySelector<HTMLElement>(".dv-tabs-container")!;
  label = strip.firstElementChild as HTMLElement;
  Object.defineProperties(strip, {
    clientWidth: { value: 168 },
    scrollWidth: { value: 174, configurable: true },
  });
  dispose = installTabScroll(root);
});

afterEach(() => {
  dispose();
  root.remove();
});

function wheel(deltaX: number, deltaY: number, options: WheelEventInit = {}, target = label) {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX, deltaY, ...options });
  // happy-dom's WheelEvent omits the MouseEvent modifier properties.
  Object.defineProperty(event, "ctrlKey", { value: options.ctrlKey ?? false });
  target.dispatchEvent(event);
  return event;
}

describe("dock tab scrolling", () => {
  it("never reverses at either edge when a trackpad has opposite-axis noise", () => {
    const legacyStrip = vi.fn();
    const legacyScrollbar = vi.fn();
    strip.addEventListener("wheel", legacyStrip);
    strip.parentElement!.addEventListener("wheel", legacyScrollbar);
    for (let index = 0; index < 5; index++) {
      expect(wheel(-12, 2).defaultPrevented).toBe(true);
      expect(strip.scrollLeft).toBe(0);
    }
    wheel(12, -2);
    expect(strip.scrollLeft).toBe(6);
    for (let index = 0; index < 5; index++) {
      expect(wheel(12, -2).defaultPrevented).toBe(true);
      expect(strip.scrollLeft).toBe(6);
    }
    expect(legacyStrip).not.toHaveBeenCalled();
    expect(legacyScrollbar).not.toHaveBeenCalled();
  });

  it("uses the dominant axis for vertical wheels and diagonal trackpad gestures", () => {
    wheel(-0.5, 3);
    expect(strip.scrollLeft).toBe(3);
    wheel(0.5, -2);
    expect(strip.scrollLeft).toBe(1);
    wheel(0, 2);
    expect(strip.scrollLeft).toBe(3);
    wheel(-1.5, 0);
    expect(strip.scrollLeft).toBe(1.5);
  });

  it("normalizes line and page wheel units", () => {
    Object.defineProperty(strip, "scrollWidth", { value: 1000 });
    strip.style.lineHeight = "20px";
    wheel(0, 2, { deltaMode: WheelEvent.DOM_DELTA_LINE });
    expect(strip.scrollLeft).toBe(40);
    wheel(1, 0, { deltaMode: WheelEvent.DOM_DELTA_PAGE });
    expect(strip.scrollLeft).toBe(208);
  });

  it("preserves browser zoom, non-overflowing strips and content scrolling", () => {
    expect(wheel(0, 10, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(strip.scrollLeft).toBe(0);
    Object.defineProperty(strip, "scrollWidth", { value: 168 });
    expect(wheel(0, 10).defaultPrevented).toBe(false);
    const bubbled = vi.fn();
    root.addEventListener("wheel", bubbled);
    const content = root.querySelector<HTMLElement>(".panel-content")!;
    expect(wheel(0, 10, {}, content).defaultPrevented).toBe(false);
    expect(bubbled).toHaveBeenCalledOnce();
  });

  it("removes its wheel listener on disposal", () => {
    dispose();
    const bubbled = vi.fn();
    root.addEventListener("wheel", bubbled);
    expect(wheel(0, 10).defaultPrevented).toBe(false);
    expect(bubbled).toHaveBeenCalledOnce();
    expect(strip.scrollLeft).toBe(0);
  });
});
