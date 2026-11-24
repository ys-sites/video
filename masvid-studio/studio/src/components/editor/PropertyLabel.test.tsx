// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanupMounted, mountHost, trackedRoot } from "../ui/mountHost.testHelpers";
import { PropertyLabel } from "./PropertyLabel";

let width = 80, contentWidth = 80, height = 28, contentHeight = 28;
const observers = new Set<() => void>();
beforeEach(() => {
  width = contentWidth = 80;
  height = contentHeight = 28;
  for (const [key, read] of Object.entries({ clientWidth: () => width, scrollWidth: () => contentWidth, clientHeight: () => height, scrollHeight: () => contentHeight })) {
    vi.spyOn(HTMLElement.prototype, key as "clientWidth", "get").mockImplementation(read);
  }
  vi.stubGlobal("ResizeObserver", class {
    constructor(private notify: () => void) {}
    observe(element: Element) { if (element.classList.contains("truncate")) observers.add(this.notify); }
    unobserve() {}
    disconnect() { observers.delete(this.notify); }
  });
});
afterEach(() => { cleanupMounted(); observers.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };

it("uses an arrow cursor and does not show a tooltip for a complete name", async () => {
  const host = mountHost(<PropertyLabel label="Font size" />);
  const label = host.querySelector('.cursor-default') as HTMLElement;
  expect(label.getAttribute('tabindex')).toBeNull();
  act(() => {
    label.parentElement!.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    label.parentElement!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
  });
  await settle();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});

it.each(["horizontal", "vertical"])("shows the full %s overflow and closes the tooltip when widening removes it", async (kind) => {
  if (kind === "horizontal") contentWidth = 120;
  else contentHeight = 42;
  const host = mountHost(<PropertyLabel label="Full translated property name" />);
  const label = host.querySelector('[tabindex="0"]') as HTMLElement;
  expect(label).not.toBeNull();
  act(() => label.focus());
  await settle();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Full translated property name");
  act(() => { width = contentWidth; height = contentHeight; [...observers].forEach(notify => notify()); });
  await settle();
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  expect(label.getAttribute('tabindex')).toBeNull();
});

it("rechecks overflow when the translated name changes without a box resize", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = trackedRoot(host);
  act(() => root.render(<PropertyLabel label="Font" />));
  expect(host.querySelector('[tabindex="0"]')).toBeNull();
  contentWidth = 140;
  act(() => root.render(<PropertyLabel label="A much longer translated name" />));
  expect(host.querySelector('[tabindex="0"]')).not.toBeNull();
});
