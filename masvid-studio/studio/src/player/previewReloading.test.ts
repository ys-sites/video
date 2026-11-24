// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { thumbnailScheduler, type ThumbnailRequest } from "./lib/thumbnailScheduler";
import { swapFreshly } from "./sceneSwap";
import {
  giveUpOnPreviewChange,
  isPreviewChanging,
  previewReloadBegun,
  requestPreviewReload,
  setPreviewReloading,
  whileScriptWrites,
} from "./previewReloading";

afterEach(() => {
  previewReloadBegun();
  setPreviewReloading(false);
});

describe("the preview is changing", () => {
  function queueComposition() {
    const load = vi.fn<ThumbnailRequest["load"]>(async () => ({
      value: { kind: "image", url: "poster", aspect: 1 }, weight: 1,
    }));
    const lease = thumbnailScheduler.acquire({
      key: crypto.randomUUID(), projectId: "preview-priority", kind: "composition",
      priority: "visible", load,
    }, () => {});
    return { load, release: lease.release };
  }

  it("reserves rendering for overlapping saves and the preview until all have finished", async () => {
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    const first = whileScriptWrites(() => new Promise<void>(resolve => { finishFirst = resolve; }));
    const second = whileScriptWrites(() => new Promise<void>(resolve => { finishSecond = resolve; }));
    const thumbnail = queueComposition();
    expect(thumbnail.load).not.toHaveBeenCalled();
    finishFirst();
    await first;
    requestPreviewReload();
    finishSecond();
    await second;
    expect(thumbnail.load).not.toHaveBeenCalled();
    setPreviewReloading(true);
    previewReloadBegun();
    expect(thumbnail.load).not.toHaveBeenCalled();
    // Giving up on a waiting canvas gesture must not start competing renders.
    giveUpOnPreviewChange();
    expect(thumbnail.load).not.toHaveBeenCalled();
    setPreviewReloading(false);
    expect(thumbnail.load).toHaveBeenCalledOnce();
    thumbnail.release();
  });

  it("keeps thumbnails paused when a scene swap falls back to a full preview reload", async () => {
    let refuse!: (reason: Error) => void;
    const reload = vi.fn(() => setPreviewReloading(true));
    swapFreshly(() => new Promise<void>((_, reject) => { refuse = reject; }),
      new URL("https://studio.test/preview"), () => true, new AbortController().signal, reload);
    const thumbnail = queueComposition();
    refuse(new Error("shared composition changed"));
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(thumbnail.load).not.toHaveBeenCalled();
    setPreviewReloading(false);
    expect(thumbnail.load).toHaveBeenCalledOnce();
    thumbnail.release();
  });

  it("releases queued thumbnails after a failed save", async () => {
    let refuse!: (reason: Error) => void;
    const save = whileScriptWrites(() => new Promise<void>((_, reject) => { refuse = reject; }));
    const thumbnail = queueComposition();
    refuse(new Error("save failed"));
    await expect(save).rejects.toThrow("save failed");
    expect(thumbnail.load).toHaveBeenCalledOnce();
    thumbnail.release();
  });
  it("from a script write's send until it lands", async () => {
    let land: () => void = () => {};
    const write = whileScriptWrites(() => new Promise<void>((resolve) => (land = resolve)));
    expect(isPreviewChanging()).toBe(true);
    land();
    await write;
    expect(isPreviewChanging()).toBe(false);
  });

  it("until a write that fails gives up, so a press never hangs on it", async () => {
    await expect(whileScriptWrites(() => Promise.reject(new Error("rejected")))).rejects.toThrow();
    expect(isPreviewChanging()).toBe(false);
  });

  it("from a reload's request until it has begun", () => {
    requestPreviewReload();
    expect(isPreviewChanging()).toBe(true);
    previewReloadBegun();
    expect(isPreviewChanging()).toBe(false);
  });

  it("stops counting a change a press gave up on, until the preview goes idle", async () => {
    let land: () => void = () => {};
    const stuck = whileScriptWrites(() => new Promise<void>((resolve) => (land = resolve)));
    giveUpOnPreviewChange();
    expect(isPreviewChanging()).toBe(false);
    land();
    await stuck;
    requestPreviewReload();
    expect(isPreviewChanging(), "the next change counts again").toBe(true);
  });

  it("is mirrored on the page for a tool that watches the preview from outside", async () => {
    const shown = () => document.documentElement.hasAttribute("data-preview-changing");
    expect(shown()).toBe(false);
    requestPreviewReload();
    expect(shown()).toBe(true);
    previewReloadBegun();
    expect(shown()).toBe(false);
    let land: () => void = () => {};
    const write = whileScriptWrites(() => new Promise<void>((resolve) => (land = resolve)));
    expect(shown()).toBe(true);
    land();
    await write;
    expect(shown()).toBe(false);
  });
});
