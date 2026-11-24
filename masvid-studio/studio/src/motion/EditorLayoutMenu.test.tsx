// @vitest-environment happy-dom
import React, { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n/I18n";
import { EditorLayoutMenu } from "./EditorLayoutMenu";
import { cleanupMounted, mountHost } from "../components/ui/mountHost.testHelpers";

const dock = vi.hoisted(() => ({
  controller: { fitTimeline: vi.fn(), applyWorkspacePreset: vi.fn() },
}));

vi.mock("../components/dock/dockLayoutStore", () => ({
  useDockLayoutStore: (selector: (state: typeof dock) => unknown) => selector(dock),
}));

afterEach(() => {
  cleanupMounted();
  vi.clearAllMocks();
});

async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

it("keeps only the single-choice layout presets and checks the selected preset", async () => {
  mountHost(<I18nProvider initialLocale="zh-CN"><EditorLayoutMenu /></I18nProvider>);
  act(() => document.querySelector<HTMLButtonElement>("[aria-label=\"面板与布局\"]")!.click());
  await settle();

  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("布局预设");
  expect(menu.textContent).not.toContain("显示面板");
  const radios = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  expect(radios.map(item => item.textContent)).toEqual(["时间轴适应内容", "专注预览", "恢复默认布局"]);
  expect(radios.filter(item => item.getAttribute("aria-checked") === "true").map(item => item.textContent)).toEqual(["恢复默认布局"]);

  act(() => radios[1].click());
  await settle();
  expect(dock.controller.applyWorkspacePreset).toHaveBeenCalledWith("preview");
  expect(radios[1].getAttribute("aria-checked")).toBe("true");
});
