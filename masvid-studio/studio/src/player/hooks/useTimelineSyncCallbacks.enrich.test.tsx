// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { normalizeToZones } from "../components/timelineZones";
import { mergeTimelineElementsPreservingDowngrades } from "../lib/timelineDOM";
import { useTimelineSyncCallbacks } from "./useTimelineSyncCallbacks";
import type { ClipManifestClip } from "../lib/playbackTypes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function clip(overrides: Partial<ClipManifestClip> & { id: string }): ClipManifestClip {
  return {
    label: overrides.id,
    kind: "composition",
    tagName: "div",
    start: 0,
    duration: 5,
    track: 1,
    compositionId: overrides.id,
    parentCompositionId: null,
    compositionSrc: null,
    assetUrl: null,
    ...overrides,
  };
}

function mountSyncHarness(iframe: HTMLIFrameElement) {
  let callbacks!: ReturnType<typeof useTimelineSyncCallbacks>;
  const syncTimelineElements = (elements: TimelineElement[], nextDuration?: number) => {
    const state = usePlayerStore.getState();
    const merged = normalizeToZones(
      mergeTimelineElementsPreservingDowngrades(
        state.elements,
        elements,
        state.duration,
        nextDuration ?? state.duration,
      ),
    );
    state.setElements(merged);
    if (nextDuration && nextDuration > 0) state.setDuration(nextDuration);
  };
  function Harness() {
    callbacks = useTimelineSyncCallbacks({
      iframeRef: { current: iframe },
      probeIntervalRef: { current: undefined },
      pendingSeekRef: { current: null },
      isRefreshingRef: { current: false },
      getAdapter: () => null,
      syncTimelineElements,
      setDuration: (d) => usePlayerStore.getState().setDuration(d),
      setCurrentTime: () => {},
      requestTimelineReady: () => {},
      setIsPlaying: () => {},
      attachIframeShortcutListeners: () => {},
      applyPreviewAudioState: () => {},
    });
    return null;
  }
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<Harness />));
  return {
    callbacks,
    unmount: () => act(() => root.unmount()),
  };
}

afterEach(() => {
  usePlayerStore.getState().reset();
  document.body.innerHTML = "";
});

describe("useTimelineSyncCallbacks — nested compositions and track stability", () => {
  it("keeps root tracks stable when a scene with a nested sub-composition parks and unparks", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    const mountedScene1 = `
      <div id="scene-1" data-hf-id="hf-s1" data-composition-id="scene1-logo-intro"
        data-composition-file="compositions/scene1-logo-intro.html" data-start="0" data-duration="1.5" data-track-index="1">
        <div data-hf-inner-root="true">
          <div id="scene2-4-canvas" data-composition-id="scene2-4-canvas"
            data-composition-src="scene2-4-canvas.html" data-start="0" data-duration="12.5" data-track-index="1"></div>
        </div>
      </div>`;
    const parkedScene1 = `
      <div id="scene-1" data-hf-id="hf-s1" data-composition-id="scene1-logo-intro" data-hf-parked-scene=""
        data-composition-file="compositions/scene1-logo-intro.html" data-start="0" data-duration="1.5" data-track-index="1"></div>`;
    const renderDom = (scene1Html: string) => {
      doc.body.innerHTML = `
        <div id="root" data-composition-id="main" data-start="0" data-duration="20">
          ${scene1Html}
          <div id="scene-2-4" data-hf-id="hf-s2" data-composition-id="scene2-4-canvas"
            data-composition-file="compositions/scene2-4-canvas.html" data-start="1.5" data-duration="12.5" data-track-index="1"></div>
          <div id="scene-5" data-hf-id="hf-s5" data-composition-id="scene5-logo-outro"
            data-composition-file="compositions/scene5-logo-outro.html" data-start="14" data-duration="6" data-track-index="1"></div>
          <div id="captions-comp" data-hf-id="hf-cap" data-composition-id="captions"
            data-start="1.5" data-duration="12.5" data-track-index="2"></div>
        </div>`;
    };
    const manifest = {
      durationInFrames: 600,
      fps: 30,
      clips: [
        clip({ id: "scene-1", compositionId: "scene1-logo-intro", start: 0, duration: 1.5, track: 1 }),
        clip({
          id: "scene2-4-canvas",
          compositionId: "scene2-4-canvas",
          parentCompositionId: "scene1-logo-intro",
          start: 0,
          duration: 1.5,
          track: 1,
        }),
        clip({ id: "scene-2-4", compositionId: "scene2-4-canvas", start: 1.5, duration: 12.5, track: 1 }),
        clip({ id: "scene-5", compositionId: "scene5-logo-outro", start: 14, duration: 6, track: 1 }),
        clip({ id: "captions-comp", compositionId: "captions", start: 1.5, duration: 12.5, track: 2 }),
      ],
    };

    const h = mountSyncHarness(iframe);
    const snapshot = () =>
      usePlayerStore.getState().elements.map((e) => [e.id, e.track, e.start, e.duration]);

    renderDom(mountedScene1);
    h.callbacks.processTimelineMessage(manifest);
    h.callbacks.enrichMissingCompositions();
    const whileMounted = snapshot();

    // Scrub past 1.5s -> scene-1 parks
    renderDom(parkedScene1);
    h.callbacks.processTimelineMessage(manifest);
    h.callbacks.enrichMissingCompositions();
    const whileParked = snapshot();

    // Scrub back <= 1.5s -> scene-1 unparks + repeated heartbeats
    renderDom(mountedScene1);
    for (let i = 0; i < 3; i++) {
      h.callbacks.processTimelineMessage(manifest);
      h.callbacks.enrichMissingCompositions();
    }
    const afterUnpark = snapshot();

    const expected = [
      ["scene-1", 0, 0, 1.5],
      ["scene-2-4", 0, 1.5, 12.5],
      ["scene-5", 0, 14, 6],
      ["captions-comp", 1, 1.5, 12.5],
    ];
    expect(whileMounted).toEqual(expected);
    expect(whileParked).toEqual(expected);
    expect(afterUnpark).toEqual(expected);
    h.unmount();
  });

  it("keeps a recovered top-level composition on its authored track across manifest heartbeats", () => {
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const doc = iframe.contentDocument!;
    doc.body.innerHTML = `
      <div id="root" data-composition-id="main" data-start="0" data-duration="20">
        <div id="scene-1" data-composition-id="scene-1" data-composition-file="compositions/s1.html"
          data-start="0" data-duration="3" data-track-index="1"></div>
        <div id="scene-2" data-composition-id="scene-2" data-composition-src="compositions/s2.html"
          data-start="scene-1" data-duration="5" data-track-index="1"></div>
        <div id="captions" data-composition-id="captions"
          data-start="0" data-duration="8" data-track-index="2"></div>
      </div>`;
    const manifestWithoutScene2 = {
      durationInFrames: 600,
      fps: 30,
      clips: [
        clip({ id: "scene-1", compositionId: "scene-1", start: 0, duration: 3, track: 1 }),
        clip({ id: "captions", compositionId: "captions", start: 0, duration: 8, track: 2 }),
      ],
    };

    const h = mountSyncHarness(iframe);
    for (let i = 0; i < 3; i++) {
      h.callbacks.processTimelineMessage(manifestWithoutScene2);
      h.callbacks.enrichMissingCompositions();
    }

    const byId = new Map(usePlayerStore.getState().elements.map((e) => [e.id, e.track]));
    expect(byId.get("scene-1")).toBe(0);
    expect(byId.get("scene-2")).toBe(0);
    expect(byId.get("captions")).toBe(1);
    h.unmount();
  });
});
