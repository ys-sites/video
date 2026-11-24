// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AssetPreviewDialog } from "./AssetPreviewDialog";
import { acquireAudioPreviewAnalyser } from "./audioPreviewAnalyser";
import { usePlayerStore } from "../../player/store/playerStore";

vi.mock("./audioPreviewAnalyser", () => ({ acquireAudioPreviewAnalyser: vi.fn(), AUDIO_PREVIEW_BARS: 81 }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const read = vi.fn();
const release = vi.fn();
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;

beforeEach(() => {
  vi.resetAllMocks();
  frames.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { frames.delete(id); });
  read.mockReturnValue(new Float32Array(81).fill(0.25));
  vi.mocked(acquireAudioPreviewAnalyser).mockReturnValue({ read, release, resume: vi.fn(async () => {}) });
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  usePlayerStore.setState({ currentTime: 4, isPlaying: false });
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  usePlayerStore.getState().reset();
});
async function render(url: string, kind: "audio" | "video" | "image") {
  await act(async () => root.render(<AssetPreviewDialog url={url} kind={kind} name={url} onClose={() => {}} />));
}

it.each(["mp3", "wav", "m4a", "aac", "ogg", "flac"])("uses a compact live visualizer for %s audio and leaves the composition playhead alone", async extension => {
  await render(`/voice.${extension}`, "audio");
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("data-preview-kind")).toBe("audio");
  expect(dialog.className).toContain("280px");
  expect(dialog.querySelectorAll("svg[role=img] rect")).toHaveLength(81);
  expect(dialog.querySelector(".motion-player-control-row")!.className).toContain("motion-player-control-row-lg");
  const audio = dialog.querySelector("audio")!;
  Object.defineProperty(audio, "duration", { value: 10 });
  act(() => audio.dispatchEvent(new Event("loadedmetadata")));
  act(() => { audio.currentTime = 5; audio.dispatchEvent(new Event("timeupdate")); });
  expect(dialog.querySelector<HTMLInputElement>('input[type="range"][data-studio-control="seek-preview"]')!.value).toBe("5");
  expect(usePlayerStore.getState().currentTime).toBe(4);
});

it("preserves video and image layouts", async () => {
  await render("/movie.mp4", "video");
  expect(document.querySelector('[role="dialog"]')!.className).toContain("600px");
  expect(document.querySelector("video")!.className).toContain("object-contain");
  expect(document.querySelector(".motion-player-control-row")!.className).not.toContain("motion-player-control-row-lg");
  expect(acquireAudioPreviewAnalyser).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')!.getAttribute("data-preview-kind")).toBe("video");
  await render("/photo.png", "image");
  expect(document.querySelector('[role="dialog"]')!.className).toContain("600px");
  expect(document.querySelector('img[alt="/photo.png"]')).not.toBeNull();
  expect(acquireAudioPreviewAnalyser).not.toHaveBeenCalled();
});

it("keeps playback available when analysis is unavailable", async () => {
  vi.mocked(acquireAudioPreviewAnalyser).mockImplementation(() => { throw new Error("Unavailable"); });
  await render("/voice.mp3", "audio");
  expect(document.querySelector('[role="status"]')!.textContent).toContain("waveform unavailable");
  expect(document.querySelector('button[aria-label="Play"]')!.hasAttribute("disabled")).toBe(false);
  expect(document.querySelector("audio")).not.toBeNull();
});

it("updates bars from live measurements, freezes on pause and releases on replacement", async () => {
  await render("/voice.mp3", "audio");
  const audio = document.querySelector("audio")!;
  const bar = document.querySelector('svg[role="img"] rect')!;
  act(() => audio.dispatchEvent(new Event("play")));
  const advance = (now: number) => act(() => {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(now));
  });
  for (let tick = 0; tick < 30; tick++) advance(tick * 16);
  expect(Number(bar.getAttribute("height"))).toBeCloseTo(26, 1);
  read.mockReturnValue(new Float32Array(81).fill(0.75));
  advance(480);
  const raised = Number(bar.getAttribute("height"));
  expect(raised).toBeGreaterThan(26);
  expect(raised).toBeLessThan(78);
  read.mockReturnValue(new Float32Array(81));
  advance(496);
  const settled = Number(bar.getAttribute("height"));
  expect(settled).toBeLessThan(raised);
  expect(settled).toBeGreaterThan(raised * 0.8);
  act(() => audio.dispatchEvent(new Event("pause")));
  expect(frames.size).toBe(0);
  expect(Number(bar.getAttribute("height"))).toBe(settled);
  expect(usePlayerStore.getState().currentTime).toBe(4);
  await render("/photo.png", "image");
  expect(release).toHaveBeenCalledOnce();
});
