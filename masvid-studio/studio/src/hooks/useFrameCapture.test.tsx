// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { liveTime, usePlayerStore } from "../player";
import { useFrameCapture } from "./useFrameCapture";
import { studioApiFetch } from "../utils/studioApiFetch";

vi.mock("../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn() }));
const showToast = vi.fn();
const waitForPendingDomEditSaves = vi.fn(async () => {});
const clickEvent = { preventDefault: vi.fn() } as unknown as React.MouseEvent<HTMLAnchorElement>;

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let renders = 0;
let capture: ReturnType<typeof useFrameCapture>;

function Harness() {
  renders += 1;
  capture = useFrameCapture({
    projectId: "p",
    activeCompPath: null,
    showToast,
    waitForPendingDomEditSaves,
  });
  return null;
}

const shownTime = () => new URL(capture.captureFrameHref).searchParams.get("t");

let host: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  vi.clearAllMocks();
  waitForPendingDomEditSaves.mockResolvedValue(undefined);
  usePlayerStore.setState({ isPlaying: false, currentTime: 2 });
  renders = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(React.createElement(Harness)));
});

afterEach(async () => {
  vi.useRealTimers();
  await act(async () => root.unmount());
  host.remove();
});

describe("useFrameCapture", () => {
  it("offers recapture only when the frame request times out", async () => {
    vi.useFakeTimers();
    vi.mocked(studioApiFetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    await act(async () => {
      const pending = capture.handleCaptureFrameClick(clickEvent);
      await vi.advanceTimersByTimeAsync(30000);
      await pending;
    });
    expect(showToast).toHaveBeenCalledWith("Frame capture timed out. Please capture again.", "error");
    expect(capture.capturing).toBe(false);
  });

  it("does not report a capture timeout when saving fails first", async () => {
    vi.useFakeTimers();
    waitForPendingDomEditSaves.mockRejectedValueOnce(new Error("Changes could not be saved."));
    await act(() => capture.handleCaptureFrameClick(clickEvent));
    expect(studioApiFetch).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Changes could not be saved.", "error");
  });

  it("does not treat an unrelated request error as a timeout", async () => {
    vi.useFakeTimers();
    vi.mocked(studioApiFetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await act(() => capture.handleCaptureFrameClick(clickEvent));
    expect(showToast).toHaveBeenCalledWith("Failed to fetch", "error");
  });
  it("does not re-render on playback frames", () => {
    usePlayerStore.setState({ isPlaying: true });
    const before = renders;
    act(() => {
      for (let i = 1; i <= 30; i++) liveTime.notify(2 + i / 60);
    });
    expect(renders).toBe(before);
  });

  it("points the capture at the live playhead while playing", () => {
    usePlayerStore.setState({ isPlaying: true });
    act(() => liveTime.notify(7.5));
    act(() => capture.refreshCaptureFrameTime());
    expect(shownTime()).toBe("7.500");
  });

  it("points the capture at the store time while paused", () => {
    act(() => liveTime.notify(7.5));
    usePlayerStore.setState({ isPlaying: false, currentTime: 3 });
    act(() => capture.refreshCaptureFrameTime());
    expect(shownTime()).toBe("3.000");
  });
});
