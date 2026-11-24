// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { DomEditSelection } from "./domEditing";
import { useDomEditOverlayRects } from "./useDomEditOverlayRects";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const frames = vi.hoisted(() => ({ update: undefined as (() => void) | undefined }));
vi.mock("./overlayFrameLoop", () => ({
  subscribeOverlayFrame: (update: () => void) => {
    frames.update = update;
    return () => { frames.update = undefined; };
  },
}));

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function harness() {
  const host = document.createElement("div");
  const iframe = document.createElement("iframe");
  document.body.append(host, iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<main data-composition-id="root" data-width="800" data-height="450"><span id="first">m</span><span id="second">o</span></main>';
  iframe.getBoundingClientRect = () => new DOMRect(0, 0, 800, 450);
  const first = doc.getElementById("first") as HTMLElement;
  const second = doc.getElementById("second") as HTMLElement;
  const firstBounds = { left: 100, width: 40 };
  const secondBounds = { left: 160, width: 25 };
  first.getBoundingClientRect = () => new DOMRect(firstBounds.left, 80, firstBounds.width, 50);
  second.getBoundingClientRect = () => new DOMRect(secondBounds.left, 80, secondBounds.width, 50);
  const selection = (element: HTMLElement) => ({ element, id: element.id }) as DomEditSelection;
  const a = selection(first), b = selection(second);
  const options = {
    iframeRef: { current: iframe },
    overlayRef: { current: host },
    selectionRef: { current: null as DomEditSelection | null },
    activeCompositionPathRef: { current: null as string | null },
    groupSelectionsRef: { current: [] as DomEditSelection[] },
    hoverSelectionRef: { current: null as DomEditSelection | null },
    rafPausedRef: { current: false },
  };
  let latest: ReturnType<typeof useDomEditOverlayRects>;
  function Overlay() {
    latest = useDomEditOverlayRects(options);
    return <output>{JSON.stringify({ selected: latest.overlayRect, hover: latest.hoverRect })}</output>;
  }
  const root = createRoot(host);
  const render = () => act(() => root.render(<Overlay />));
  render();
  const frame = () => act(() => frames.update?.());
  cleanups.push(() => { act(() => root.unmount()); host.remove(); iframe.remove(); });
  return { options, a, b, render, frame, first, firstBounds, secondBounds, read: () => latest! };
}

it("hands hover to selection and switches selected elements without waiting for an overlay frame", () => {
  const h = harness();
  h.options.hoverSelectionRef.current = h.a;
  h.render();
  h.frame();
  expect(h.read().hoverRect?.left).toBe(100);

  h.options.selectionRef.current = h.a;
  h.render();
  expect(h.read().overlayRect).toMatchObject({ left: 100, width: 40 });
  expect(h.read().hoverRect).toBeNull();

  h.options.hoverSelectionRef.current = h.b;
  h.render();
  expect(h.read().hoverRect).toMatchObject({ left: 160, width: 25 });
  h.options.selectionRef.current = h.b;
  h.render();
  expect(h.read().overlayRect).toMatchObject({ left: 160, width: 25 });
  expect(h.read().hoverRect).toBeNull();
});

it("updates group membership and clears deselected outlines before the next frame", () => {
  const h = harness();
  h.options.groupSelectionsRef.current = [h.a, h.b];
  h.render();
  expect(h.read().groupOverlayItems.map((item) => item.rect.left)).toEqual([100, 160]);
  h.options.groupSelectionsRef.current = [];
  h.options.selectionRef.current = h.a;
  h.render();
  expect(h.read().groupOverlayItems).toEqual([]);
  expect(h.read().overlayRect?.left).toBe(100);
  h.options.selectionRef.current = null;
  h.render();
  expect(h.read().overlayRect).toBeNull();
});

it("keeps frame-driven geometry tracking without remeasuring unchanged render targets", () => {
  const h = harness();
  h.options.selectionRef.current = h.a;
  h.render();
  h.frame();
  const readBounds = vi.spyOn(h.first, "getBoundingClientRect");
  h.render();
  expect(readBounds).not.toHaveBeenCalled();
  h.firstBounds.left = 120;
  h.frame();
  expect(h.read().overlayRect?.left).toBe(120);
});

it("leaves gesture-owned geometry alone while measurement is paused", () => {
  const h = harness();
  h.options.selectionRef.current = h.a;
  h.render();
  h.frame();
  h.options.rafPausedRef.current = true;
  h.options.hoverSelectionRef.current = h.b;
  h.firstBounds.left = 150;
  h.render();
  h.frame();
  expect(h.read().overlayRect?.left).toBe(100);
  h.options.rafPausedRef.current = false;
  h.frame();
  expect(h.read().overlayRect?.left).toBe(150);
});
