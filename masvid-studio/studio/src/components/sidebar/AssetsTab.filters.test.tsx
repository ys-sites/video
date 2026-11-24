// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { AssetsTab } from "./AssetsTab";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("../../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn(async () => ({ ok: false })) }));
vi.mock("./AudioRow", () => ({ AudioRow: ({ asset }: { asset: string }) => <div data-asset>{asset}</div> }));
vi.mock("./AssetCard", () => ({
  AssetCard: ({ asset }: { asset: string }) => <div data-asset>{asset}</div>,
  FontRow: ({ asset }: { asset: string }) => <div data-asset>{asset}</div>,
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot>;
afterEach(() => { act(() => root?.unmount()); usePlayerStore.getState().reset(); document.body.innerHTML = ""; });

it("keeps type filters and search without usage filters", async () => {
  usePlayerStore.setState({ elements: [{ id: "image", tag: "img", src: "assets/logo.png", start: 0, duration: 3, track: 0 }] });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AssetsTab projectId="test" assets={["assets/logo.png", "assets/audit-tone.wav", "assets/unused.png"]} />));
  const chip = (label: string) => Array.from(host.querySelectorAll("button")).find(b => b.textContent?.trim() === label)!;
  const search = (value: string) => act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(chip("All 3")).toBeTruthy();
  expect(chip("In use 1")).toBeUndefined();
  expect(chip("Unused 2")).toBeUndefined();
  act(() => chip("Images 2").click());
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(2);
  expect(host.querySelector("[data-asset]")?.textContent).toBe("assets/logo.png");
  search("audit-tone");
  expect(chip("All 1")).toBeTruthy();
  expect(chip("Images 0").getAttribute("aria-pressed")).toBe("true");
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(0);
  act(() => chip("Audio 1").click());
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(1);
  search("");
  act(() => chip("All 3").click());
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(3);
});

it("collapses media groups independently and reveals results after filtering or searching", async () => {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const assets = ["assets/tone-1.wav", "assets/tone-2.wav", "assets/tone-3.wav", "assets/logo.png", "assets/other.png", "assets/clip.mp4"];
  const onDelete = vi.fn(), onRename = vi.fn();
  await act(async () => root.render(<AssetsTab projectId="test" assets={assets} onDelete={onDelete} onRename={onRename} />));
  const group = (category: string) => host.querySelector(`[data-assets-category="${category}"]`)!;
  const toggle = (category: string) => group(category).querySelector<HTMLButtonElement>("h3 button")!;
  const chip = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(node => node.textContent?.trim() === label)!;
  expect(toggle("audio").getAttribute("aria-expanded")).toBe("true");
  expect(group("audio").querySelectorAll("[data-asset]")).toHaveLength(3);
  act(() => toggle("audio").click());
  expect(toggle("audio").getAttribute("aria-expanded")).toBe("false");
  expect(group("audio").querySelectorAll("[data-asset]")).toHaveLength(0);
  expect(toggle("audio").textContent).toContain("3");
  expect(group("images").querySelectorAll("[data-asset]")).toHaveLength(2);
  act(() => toggle("images").click());
  act(() => toggle("audio").click());
  expect(group("audio").querySelectorAll("[data-asset]")).toHaveLength(3);
  expect(group("images").querySelectorAll("[data-asset]")).toHaveLength(0);
  expect(group("video").querySelectorAll("[data-asset]")).toHaveLength(1);
  act(() => toggle("audio").click());
  act(() => chip("Audio 3").click());
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(3);
  act(() => chip("All 6").click());
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(6);
  act(() => toggle("audio").click());
  act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "tone");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(3);
  expect(toggle("audio").getAttribute("aria-expanded")).toBe("true");
  expect(onDelete).not.toHaveBeenCalled(); expect(onRename).not.toHaveBeenCalled();
});

it("finds a renamed image by its full filename, including extension and case-insensitively", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AssetsTab projectId="test" assets={["assets/original.png", "assets/other.png"]} />));
  await act(async () => root.render(<AssetsTab projectId="test" assets={["assets/QA.png", "assets/other.png"]} />));

  const search = (value: string) => act(() => {
    const input = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  search("QA.png");
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(1);
  expect(host.querySelector("[data-asset]")?.textContent).toBe("assets/QA.png");

  search("qa.PNG");
  expect(host.querySelectorAll("[data-asset]")).toHaveLength(1);
  expect(host.querySelector("[data-asset]")?.textContent).toBe("assets/QA.png");
});
