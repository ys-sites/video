// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "../player/store/playerStore";
import type { TimelineElement } from "../player/store/timelineElement";
import { markStudioWriteToken } from "../utils/studioFileVersion";
import {
  beginStudioManualEditGesture,
  endStudioManualEditGesture,
} from "../components/editor/manualEdits";
import { mountReactHarness } from "./domSelectionTestHarness";
import { usePreviewPersistence } from "./usePreviewPersistence";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
});

describe("undo that reloads the preview", () => {
  it("keeps the timeline's clips and selection until the reloaded preview reports its own", async () => {
    const clips = [{ id: "a" }, { id: "b" }] as unknown as TimelineElement[];
    usePlayerStore.getState().setElements(clips);
    usePlayerStore.getState().setTimelineReady(true);
    usePlayerStore.getState().setSelectedElementId("a");
    const reloadPreview = vi.fn();
    let sync: ReturnType<typeof usePreviewPersistence>["syncHistoryPreviewAfterApply"] | null =
      null;
    function Harness() {
      sync = usePreviewPersistence({
        showToast: () => {},
        readOptionalProjectFile: async () => "",
        writeProjectFile: async () => {},
        recordEdit: async () => {},
        previewIframeRef: { current: null },
        activeCompPathRef: { current: "index.html" },
        reloadPreview,
      }).syncHistoryPreviewAfterApply;
      return null;
    }
    mountReactHarness(<Harness />);

    // A nested composition's undo is not the active file's, so it reloads the preview.
    const files = { "compositions/sub.html": { previous: "<p>1</p>", restored: "<p>2</p>" } };
    await act(async () => sync!({ paths: Object.keys(files), files }));

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    const player = usePlayerStore.getState();
    expect([player.elements, player.timelineReady, player.selectedElementId]).toEqual([
      clips,
      true,
      "a",
    ]);
  });
});

describe("undo that re-runs the top-level script over an element of a nested composition", () => {
  const script = (width: number) =>
    `var tl = gsap.timeline({ paused: true }); tl.to("#nwid", { width: ${width} }); window.__timelines["root"] = tl;`;
  const page = (width: number) =>
    `<html><body><div id="root" data-composition-id="root"></div><script>${script(width)}</script></body></html>`;
  const SUB = `<template><div data-composition-id="sub"><div id="nwid" data-hf-id="hf-n" style="left: 40px"></div></div></template>`;

  // The live preview: the top-level timeline tweened the nested element's width inline.
  function nestedPreview() {
    const doc = document.implementation.createHTMLDocument("");
    doc.body.innerHTML =
      `<div id="root" data-composition-id="root"><div data-composition-file="compositions/sub.html">` +
      `<div id="nwid" data-hf-id="hf-n" style="left: 40px; width: 337px"></div></div></div>` +
      `<script>${script(400)}</script>`;
    const nwid = doc.getElementById("nwid")!;
    const contentWindow = {
      gsap: { timeline: vi.fn(), set: vi.fn() },
      __hfForceTimelineRebind: vi.fn(),
      __timelines: {
        root: {
          kill: vi.fn(),
          getChildren: () => [{ targets: () => [nwid], vars: { width: 400 } }],
        },
      } as Record<string, unknown>,
      __player: { getTime: () => 1, seek: vi.fn() },
      __hfStudioManualEditsApply: vi.fn(),
    };
    return {
      iframe: { contentWindow, contentDocument: doc } as unknown as HTMLIFrameElement,
      nwid,
    };
  }

  async function undo(fileOk: boolean, projectId: string | null = "p1", duringRead?: (target: Element) => void) {
    const { iframe, nwid } = nestedPreview();
    const reloadPreview = vi.fn();
    const fetch = vi.fn(async () => {
      duringRead?.(nwid);
      return { ok: fileOk, json: async () => ({ content: SUB }) };
    });
    vi.stubGlobal("fetch", fetch);
    if (projectId) usePlayerStore.getState().beginTimelineSession(projectId);
    else usePlayerStore.setState({ timelineProjectId: null });
    let sync: ReturnType<typeof usePreviewPersistence>["syncHistoryPreviewAfterApply"] | null =
      null;
    function Harness() {
      sync = usePreviewPersistence({
        showToast: () => {},
        readOptionalProjectFile: async () => "",
        writeProjectFile: async () => {},
        recordEdit: async () => {},
        previewIframeRef: { current: iframe },
        activeCompPathRef: { current: "index.html" },
        reloadPreview,
      }).syncHistoryPreviewAfterApply;
      return null;
    }
    mountReactHarness(<Harness />);
    const files = { "index.html": { previous: page(400), restored: page(450) } };
    await act(async () => sync!({ paths: Object.keys(files), files }));
    vi.unstubAllGlobals();
    return { nwid, reloadPreview, fetch };
  }

  it("restores the element from its own composition file", async () => {
    const { nwid, reloadPreview, fetch } = await undo(true);

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/files/compositions%2Fsub.html"), {
      credentials: "omit",
    });
    expect(reloadPreview).not.toHaveBeenCalled();
    expect(nwid.getAttribute("style")).toBe("left: 40px;");
  });

  it("does not apply an old restore after a project switch during a nested read", async () => {
    const { nwid, reloadPreview } = await undo(true, "p1", () => usePlayerStore.setState({ timelineProjectId: "another-project" }));
    expect(nwid.getAttribute("style")).toBe("left: 40px; width: 337px");
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves a newer edit during a nested read (file readable: %s)", async (fileOk) => {
    const clips = [{ id: "newer-edit" }] as unknown as TimelineElement[];
    const { nwid, reloadPreview } = await undo(fileOk, "p1", target => {
      markStudioWriteToken("newer-edit-during-history-read");
      target.setAttribute("style", "left: 40px; width: 512px");
      usePlayerStore.getState().setElements(clips);
    });

    expect(nwid.getAttribute("style")).toBe("left: 40px; width: 512px");
    expect(usePlayerStore.getState().elements).toBe(clips);
    expect(reloadPreview).not.toHaveBeenCalled();
  });

  it("defers a restore if a new gesture starts while nested dependencies are being read", async () => {
    const { nwid, reloadPreview } = await undo(true, "p1", target => beginStudioManualEditGesture(target, "move"));
    expect(nwid.getAttribute("style")).toBe("left: 40px; width: 337px");
    expect(reloadPreview).not.toHaveBeenCalled();
    endStudioManualEditGesture(nwid);
    expect(reloadPreview).toHaveBeenCalledOnce();
  });

  it("reloads the preview in full when that file cannot be read", async () => {
    const { nwid, reloadPreview } = await undo(false);

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(nwid.getAttribute("style")).toBe("left: 40px; width: 337px");
  });

  it("reloads the preview in full when no project is open to read that file from", async () => {
    const { nwid, reloadPreview, fetch } = await undo(true, null);

    expect(fetch).not.toHaveBeenCalled();
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(nwid.getAttribute("style")).toBe("left: 40px; width: 337px");
  });
});

describe("undo that lands while a newer gesture holds an element", () => {
  const page = (left: number) =>
    `<html><body><div id="root" data-composition-id="root"><div id="box" data-hf-id="hf-b" style="left: ${left}px"></div></div></body></html>`;
  const files = { "index.html": { previous: page(0), restored: page(200) } };

  function heldPreview(held = true) {
    const doc = document.implementation.createHTMLDocument("");
    doc.head.innerHTML = `<meta name="hf-scene-parts" content='{"shared":"s1","scenes":{}}'>`;
    doc.body.innerHTML = `<div id="root" data-composition-id="root"><div id="box" data-hf-id="hf-b" style="left: 90px"></div></div>`;
    const box = doc.getElementById("box")!;
    if (held) beginStudioManualEditGesture(box, "move");
    const contentWindow = {
      __hfForceTimelineRebind: vi.fn(),
      __timelines: {},
      __player: { getTime: () => 1, seek: vi.fn() },
      __hfStudioManualEditsApply: vi.fn(),
    };
    const iframe = { contentWindow, contentDocument: doc } as unknown as HTMLIFrameElement;
    const reloadPreview = vi.fn();
    let hook: ReturnType<typeof usePreviewPersistence> | null = null;
    function Harness() {
      hook = usePreviewPersistence({
        showToast: () => {},
        readOptionalProjectFile: async () => "",
        writeProjectFile: async () => {},
        recordEdit: async () => {},
        previewIframeRef: { current: iframe },
        activeCompPathRef: { current: "index.html" },
        reloadPreview,
      });
      return null;
    }
    mountReactHarness(<Harness />);
    usePlayerStore.getState().setSelectedElementId("box");
    const sharedPart = () =>
      JSON.parse(doc.querySelector<HTMLMetaElement>('meta[name="hf-scene-parts"]')!.content).shared;
    return { box, win: contentWindow, reloadPreview, sharedPart, hook: () => hook! };
  }

  it("leaves the held element where the gesture drew it and reloads the preview once it ends", async () => {
    const { box, win, reloadPreview, sharedPart, hook } = heldPreview();

    await act(async () => hook().syncHistoryPreviewAfterApply({ paths: ["index.html"], files }));

    expect(box.style.left).toBe("90px");
    expect(win.__player.seek).not.toHaveBeenCalled();
    expect(win.__hfStudioManualEditsApply).not.toHaveBeenCalled();
    expect(reloadPreview).not.toHaveBeenCalled();
    endStudioManualEditGesture(box);
    expect(reloadPreview).toHaveBeenCalledTimes(1);
    // The scene swap must load the restored file again, not keep the part it showed before the undo.
    expect(sharedPart()).toBe("");
    expect(usePlayerStore.getState().selectedElementId).toBe("box");
  });

  it("does not paint a predicted undo under the gesture", () => {
    const { box, win, hook } = heldPreview();

    expect(hook().showHistoryRestoreNow(files)).toBeNull();
    expect(box.style.left).toBe("90px");
    expect(win.__player.seek).not.toHaveBeenCalled();
  });

  it("puts a refused predicted undo back through the preview reload once a gesture took the element", async () => {
    const { box, win, reloadPreview, hook } = heldPreview(false);
    const putBack = hook().showHistoryRestoreNow(files)!;
    beginStudioManualEditGesture(box, "move");
    win.__player.seek.mockClear();

    putBack();
    await act(async () => {});
    expect(reloadPreview).not.toHaveBeenCalled();
    endStudioManualEditGesture(box);

    expect(reloadPreview).toHaveBeenCalledTimes(1);
    expect(win.__player.seek).not.toHaveBeenCalled();
  });
});

it("paints soft-restored timing immediately and puts a refused prediction back without a runtime message", async () => {
  const page = (start: number) => `<html><body><div data-composition-id="root" data-duration="20"><div id="clip" data-hf-id="hf-clip" data-start="${start}" data-duration="4"></div></div></body></html>`;
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = new DOMParser().parseFromString(page(5), "text/html").body.innerHTML;
  const iframe = {
    contentDocument: doc,
    contentWindow: { __hfForceTimelineRebind: vi.fn(), __timelines: {}, __player: { seek: vi.fn() } },
  } as unknown as HTMLIFrameElement;
  usePlayerStore.setState({ elements: [{ id: "clip", key: "index.html#clip", domId: "clip", hfId: "hf-clip", sourceFile: "index.html", tag: "div", start: 5, duration: 4, track: 0 }], duration: 20 });
  const reload = vi.fn();
  let hook!: ReturnType<typeof usePreviewPersistence>;
  function Harness() {
    hook = usePreviewPersistence({ showToast: () => {}, readOptionalProjectFile: async () => "", writeProjectFile: async () => {}, recordEdit: async () => {}, previewIframeRef: { current: iframe }, activeCompPathRef: { current: null }, reloadPreview: reload });
    return null;
  }
  mountReactHarness(<Harness />);
  const files = { "index.html": { previous: page(5), restored: page(2) } };
  const putBack = hook.showHistoryRestoreNow(files)!;
  expect(putBack).not.toBeNull();
  expect(usePlayerStore.getState().elements[0].start).toBe(2);
  putBack();
  expect(usePlayerStore.getState().elements[0].start).toBe(5);
  await act(() => hook.syncHistoryPreviewAfterApply({ paths: ["index.html"], files }));
  expect(usePlayerStore.getState().elements[0].start).toBe(2);
  expect(reload).not.toHaveBeenCalled();
});

it("restores split/delete clip structure before the replacement preview has loaded", async () => {
  const page = (clips: string) => `<main data-composition-id="root" data-duration="10">${clips}</main>`;
  const a = '<audio id="a" data-start="0" data-duration="4"></audio>';
  const b = '<audio id="b" data-start="4" data-duration="4"></audio>';
  const iframe = document.createElement("iframe"); document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = page(a + b);
  const row = (id: string, start: number): TimelineElement => ({ id, key: `index.html#${id}`, sourceFile: "index.html", domId: id, tag: "audio", start, duration: 4, track: 0 });
  usePlayerStore.setState({ elements: [row("a", 0), row("b", 4)], duration: 10, timelineReady: true, currentTime: 2 });
  const reload = vi.fn();
  let hook!: ReturnType<typeof usePreviewPersistence>;
  function Harness() {
    hook = usePreviewPersistence({ showToast: () => {}, readOptionalProjectFile: async () => "", writeProjectFile: async () => {}, recordEdit: async () => {}, previewIframeRef: { current: iframe }, activeCompPathRef: { current: null }, reloadPreview: reload });
    return null;
  }
  mountReactHarness(<Harness />);
  await act(() => hook.syncHistoryPreviewAfterApply({ files: { "index.html": { previous: page(a + b), restored: page(a.replace('data-duration="4"', 'data-duration="8"')) } } }));
  expect(reload).toHaveBeenCalledOnce();
  expect(usePlayerStore.getState().elements.map(e => [e.id, e.duration])).toEqual([["a", 8]]);
  expect(usePlayerStore.getState()).toMatchObject({ timelineReady: true, currentTime: 2 });
  // The old preview is deliberately still split, awaiting its asynchronous replacement.
  expect(iframe.contentDocument!.querySelectorAll("audio")).toHaveLength(2);
});
