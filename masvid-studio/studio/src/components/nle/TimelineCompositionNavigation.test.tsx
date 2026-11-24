// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TimelineCompositionNavigation } from "./TimelineCompositionNavigation";

vi.mock("../../i18n/I18n", () => ({ useI18n: () => ({ t: (text: string) => text }) }));
vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

it("returns one level at a time, blocks loading clicks and contains double-clicks", () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const onNavigate = vi.fn();
  const onDoubleClick = vi.fn();
  const levels = ["master", "intro", "logo"].map((id) => ({ id, label: id, previewUrl: `/${id}` }));
  const render = (depth: number, disabled = false) => act(() => root.render(
    <div onDoubleClick={onDoubleClick}>
      <TimelineCompositionNavigation stack={levels.slice(0, depth)} onNavigate={onNavigate} disabled={disabled} />
    </div>,
  ));

  render(1);
  expect(host.querySelector("nav")).toBeNull();
  render(3);
  expect(host.querySelector('[aria-current="location"]')?.textContent).toBe("logo");
  expect(host.querySelector("button")?.getAttribute("aria-label")).toBe("Back to parent composition");
  act(() => host.querySelector("button")!.click());
  expect(onNavigate).toHaveBeenLastCalledWith(1);
  act(() => host.querySelector("button")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  expect(onDoubleClick).not.toHaveBeenCalled();
  render(2);
  act(() => host.querySelector("button")!.click());
  expect(onNavigate).toHaveBeenLastCalledWith(0);
  onNavigate.mockClear();
  render(2, true);
  act(() => host.querySelector("button")!.click());
  expect(onNavigate).not.toHaveBeenCalled();
  act(() => root.unmount());
});
