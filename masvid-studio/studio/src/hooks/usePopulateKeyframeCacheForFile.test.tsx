// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePopulateKeyframeCacheForFile } from "./useGsapTweenCache";
import { usePlayerStore } from "../player/store/playerStore";
import { parseTimelineFromDOM } from "../player/lib/timelineDOM";
import {
  clearKeyframeCacheForElement,
  pruneKeyframeCacheToFiles,
  replaceKeyframeCacheForFile,
  updateKeyframeCacheFromParsed,
} from "./gsapKeyframeCacheHelpers";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

function HookHost({ sourceFile = "index.html", version = 1 }) {
  usePopulateKeyframeCacheForFile("demo", sourceFile, version);
  return null;
}

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  usePlayerStore.setState({
    timelineProjectId: "demo",
    previewBooted: true,
    elements: [
      {
        id: "lab",
        tag: "div",
        start: 0,
        duration: 12,
        track: 1,
        compositionSrc: "compositions/keyframe-lab.html",
      },
    ] as never,
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  vi.unstubAllGlobals();
});

describe("usePopulateKeyframeCacheForFile", () => {
  it.each([
    ["data-composition-file", "./compositions/keyframe-lab.html"],
    ["data-composition-src", "./compositions/keyframe-lab.html"],
    ["data-composition-file", "http://localhost:4173/api/projects/demo/preview/compositions/keyframe-lab.html"],
    ["data-composition-src", "/api/projects/demo/preview/comp/compositions/keyframe-lab.html"],
  ])("reads prefetched keyframes with the DOM row key for %s=%s", async (attribute, source) => {
    vi.stubGlobal("location", { origin: "http://localhost:4173", hash: "#project/demo" });
    const doc = new DOMParser().parseFromString(`
      <div data-composition-id="main" data-duration="12">
        <div id="lab" data-composition-id="lab" data-composition-src="${source}" data-start="2" data-duration="8">
          <div data-composition-id="lab" ${attribute}="${source}">
            <div id="label" data-start="1" data-duration="4">Label</div>
          </div>
        </div>
      </div>`, "text/html");
    const elements = parseTimelineFromDOM(doc, 12);
    const row = elements.find(element => element.domId === "label")!;
    usePlayerStore.setState({ elements, keyframeCache: new Map(), gsapAnimations: new Map() });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => Response.json({
      animations: String(input).includes("keyframe-lab") ? [{
        id: "label-to-0", method: "to", targetSelector: "#label", position: 1,
        properties: { x: 80, duration: 2 },
      }] : [],
    })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<HookHost />); });

    const { keyframeCache, gsapAnimations } = usePlayerStore.getState();
    expect(row.key).toBe("compositions/keyframe-lab.html#label");
    expect(keyframeCache.get(row.key!)?.keyframes).toHaveLength(2);
    expect(gsapAnimations.get(row.key!)?.[0]?.targetSelector).toBe("#label");
    // An edit still receives the authored source attribute. It must replace and
    // clear the same entry the prefetch populated and the row reads.
    act(() => {
      updateKeyframeCacheFromParsed([{
        id: "label-to-0", method: "to", targetSelector: "#label", position: 1,
        properties: { x: 160, duration: 2 },
      }], source, "label", {}, doc);
    });
    expect(usePlayerStore.getState().keyframeCache.get(row.key!)?.keyframes.at(-1)?.properties.x).toBe(160);
    act(() => { pruneKeyframeCacheToFiles([source]); });
    expect(usePlayerStore.getState().keyframeCache.has(row.key!)).toBe(true);
    act(() => { clearKeyframeCacheForElement(source, "label"); });
    expect(usePlayerStore.getState().keyframeCache.has(row.key!)).toBe(false);
    expect(usePlayerStore.getState().gsapAnimations.has(row.key!)).toBe(false);
    act(() => {
      replaceKeyframeCacheForFile(source, new Map([["label", keyframeCache.get(row.key!)!]]), new Map());
      replaceKeyframeCacheForFile(source, new Map(), new Map());
    });
    expect(usePlayerStore.getState().keyframeCache.has(row.key!)).toBe(false);
  });
  it("stores runtime absolute sources under the authored file key and keeps them on selection changes", async () => {
    vi.stubGlobal("location", { origin: "http://localhost:4173" });
    usePlayerStore.setState({
      elements: [{ id: "lab", tag: "div", start: 0, duration: 12, track: 1,
        compositionSrc: "http://localhost:4173/api/projects/demo/preview/compositions/keyframe-lab.html" }],
      keyframeCache: new Map(), gsapAnimations: new Map(),
    });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return Response.json({ animations: String(input).includes("keyframe-lab") ? [{
        id: "label-to-0", method: "to", targetSelector: "#label", position: 0,
        properties: { x: 80, duration: 2 },
      }] : [] });
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root!.render(<HookHost />); });
    const key = "compositions/keyframe-lab.html#label";
    expect(usePlayerStore.getState().keyframeCache.has(key)).toBe(true);
    await act(async () => { root!.render(<HookHost sourceFile="compositions/keyframe-lab.html" />); });
    expect(usePlayerStore.getState().keyframeCache.has(key)).toBe(true);
    expect(urls.filter(url => url.includes("keyframe-lab"))).toHaveLength(1);
    expect(urls.some(url => url.includes("http%3A"))).toBe(false);
  });

  it("loads every sub-composition file the timeline shows, not just the active one", async () => {
    // Keyframe lanes must be populated when the project opens. Fetching only the
    // active file left them empty until a clip from the sub-composition was
    // selected (which is the only thing that switched `sourceFile`).
    const urls: string[] = [];
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      urls.push(String(input));
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ animations: [] }) });
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      root.render(<HookHost />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(urls.some((u) => u.endsWith("/index.html"))).toBe(true);
    expect(urls.some((u) => u.includes("keyframe-lab.html"))).toBe(true);
  });

  it("keeps every covered file when the selection switches between them, and refetches all on new data", async () => {
    // Every click on a clip from another file flips `sourceFile`; a flip must not
    // re-read every composition file, or a multi-select pays files x clicks fetches.
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        urls.push(String(input));
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ animations: [] }) });
      }),
    );
    const render = async (props: { sourceFile: string; version: number }) => {
      await act(async () => {
        if (!root) {
          container = document.createElement("div");
          document.body.appendChild(container);
          root = createRoot(container);
        }
        root.render(<HookHost {...props} />);
      });
      await act(async () => {
        await Promise.resolve();
      });
    };

    await render({ sourceFile: "index.html", version: 1 });
    const loaded = urls.length;
    await render({ sourceFile: "compositions/keyframe-lab.html", version: 1 });
    expect(urls.length).toBe(loaded);
    await render({ sourceFile: "index.html", version: 1 });
    expect(urls.length).toBe(loaded);

    await render({ sourceFile: "index.html", version: 2 });
    expect(urls.length).toBe(loaded * 2);
  });

  it("asks again for a covered file whose first read failed", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const failed =
          url.includes("keyframe-lab.html") && urls.filter((u) => u === url).length === 1;
        return Promise.resolve({
          ok: !failed,
          json: () => Promise.resolve({ animations: [] }),
        });
      }),
    );
    const render = async (sourceFile: string) => {
      await act(async () => {
        if (!root) {
          container = document.createElement("div");
          document.body.appendChild(container);
          root = createRoot(container);
        }
        root.render(<HookHost sourceFile={sourceFile} />);
      });
      await act(async () => {
        await Promise.resolve();
      });
    };

    await render("index.html");
    const labReads = () => urls.filter((u) => u.includes("keyframe-lab.html")).length;
    expect(labReads()).toBe(1);
    await render("compositions/keyframe-lab.html");
    expect(labReads()).toBe(2);
    await render("index.html");
    expect(labReads()).toBe(2);
  });
});
