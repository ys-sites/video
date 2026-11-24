// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { syncRestoredTimelineFromPreview } from "./timelineRestoreSync";

const clip = (id: string, start: number, duration: number, track = 0): TimelineElement => ({ id, key: `index.html#${id}`, domId: id, sourceFile: "index.html", tag: "div", start, duration, track });
const preview = (html: string) => {
  const doc = document.implementation.createHTMLDocument("");
  doc.body.innerHTML = `<div data-composition-id="root" data-duration="20">${html}</div>`;
  return doc;
};
beforeEach(() => usePlayerStore.getState().reset());

it("updates restored timing immediately without a runtime message and retains selection and metadata", () => {
  const original = { ...clip("scene", 5, 7), label: "My scene", compositionSrc: "scene.html", sourceDuration: 10 };
  usePlayerStore.setState({ elements: [original], selectedElementId: original.id, currentTime: 6, duration: 20 });
  const doc = preview('<div id="scene" data-start="2" data-hf-authored-duration="4" data-composition-file="scene.html" data-hf-scene="scene"></div>');
  syncRestoredTimelineFromPreview(doc);
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ ...original, start: 2, duration: 4 });
  expect(usePlayerStore.getState()).toMatchObject({ selectedElementId: "scene", currentTime: 6 });
  doc.getElementById("scene")!.setAttribute("data-start", "5");
  doc.getElementById("scene")!.setAttribute("data-hf-authored-duration", "7");
  syncRestoredTimelineFromPreview(doc);
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ start: 5, duration: 7 });
});

it("reuses the parser's master-time and media-offset rules for nested clips", () => {
  usePlayerStore.setState({ elements: [{ ...clip("voice", 9, 2), key: "scene.html#voice", sourceFile: "scene.html", tag: "audio" }], duration: 20 });
  const doc = preview('<div data-composition-id="scene" data-composition-file="scene.html" data-start="5"><audio id="voice" data-start="2" data-duration="3" data-playback-start="1"></audio></div>');
  syncRestoredTimelineFromPreview(doc);
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ start: 7, duration: 3, playbackStart: 1, parentCompositionStart: 5 });
});

it("restores authored track ordering without confusing display lanes with sparse source tracks", () => {
  usePlayerStore.setState({ elements: [{ ...clip("a", 0, 3), authoredTrack: 10 }, { ...clip("b", 4, 3, 1), authoredTrack: 30 }], duration: 20 });
  syncRestoredTimelineFromPreview(preview('<div id="a" data-start="0" data-duration="3" data-track-index="40"></div><div id="b" data-start="4" data-duration="3" data-track-index="30"></div>'));
  expect(usePlayerStore.getState().elements.map(e => [e.id, e.track, e.authoredTrack])).toEqual([["a", 1, 40], ["b", 0, 30]]);
});

it("does not discover extra nodes, clear clips or replace unchanged arrays", () => {
  const doc = preview('<div id="a" data-start="0" data-duration="3"></div><div id="unrelated" data-start="5" data-duration="3"></div>');
  usePlayerStore.setState({ elements: [clip("a", 0, 3)], duration: 20 });
  syncRestoredTimelineFromPreview(doc);
  const elements = usePlayerStore.getState().elements;
  syncRestoredTimelineFromPreview(doc);
  expect(usePlayerStore.getState().elements).toBe(elements);
  expect(elements).toHaveLength(1);
  syncRestoredTimelineFromPreview(null);
  expect(usePlayerStore.getState().elements).toBe(elements);
});

it("restores audio-group controls and expanded child state without waiting for a manifest", () => {
  const doc = preview('<div id="scene" data-composition-id="scene" data-composition-file="scene.html" data-start="0" data-duration="20"><div data-hf-inner-root><hf-audio-group id="voice" data-label="Restored voice" data-volume="0.4" data-hidden></hf-audio-group><audio id="a" data-audio-group="voice" data-volume="0.7" data-fade-in="1" data-fx-chain=\'{"version":1,"nodes":[]}\'></audio></div></div>');
  usePlayerStore.setState({
    elements: [{ ...clip("a", 0, 20), tag: "audio", sourceFile: "scene.html", audioGroup: "voice", audioGroupVolume: 1, audioGroupHidden: false }],
    clipManifest: [{ id: "scene", kind: "composition", tagName: "div", start: 0, duration: 20, track: 0, compositionId: "scene" }],
    duration: 20,
  });
  syncRestoredTimelineFromPreview(doc);
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ audioGroupVolume: 0.4, audioGroupHidden: true, audioGroupLabel: "Restored voice", volume: 0.7, fadeIn: 1 });
  expect(usePlayerStore.getState().subCompositionHostState.get("a")?.fxChain).toBe('{"version":1,"nodes":[]}');
  expect(usePlayerStore.getState().domClipChildren.some(child => child.id === "a")).toBe(true);
});
