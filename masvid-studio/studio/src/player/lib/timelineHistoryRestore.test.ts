// @vitest-environment happy-dom
import { beforeEach, expect, it } from "vitest";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { syncHistoryTimelineFromFiles } from "./timelineHistoryRestore";

const page = (body: string, duration = 20) => `<div id="root" data-composition-id="root" data-duration="${duration}">${body}</div>`;
const clip = (id: string, start: number, duration: number, attrs = "") => `<audio id="${id}" data-hf-id="hf-${id}" src="${id}.mp3" data-start="${start}" data-duration="${duration}" data-track-index="0" ${attrs}></audio>`;
const row = (id: string, start: number, duration: number): TimelineElement => ({ id, domId: id, key: `index.html#${id}`, sourceFile: "index.html", tag: "audio", start, duration, track: 0, sourceDuration: 100, src: `http://localhost/api/projects/p1/preview/${id}.mp3` });
beforeEach(() => usePlayerStore.getState().reset());

it.each([
  { label: "undo split", before: clip("a", 0, 4) + clip("b", 4, 4), after: clip("a", 0, 8), initial: [row("a", 0, 4), row("b", 4, 4)], expected: [["a", 0, 8]] },
  { label: "redo split", before: clip("a", 0, 8), after: clip("a", 0, 4) + clip("b", 4, 4), initial: [row("a", 0, 8)], expected: [["a", 0, 4], ["b", 4, 4]] },
  { label: "undo delete", before: "", after: clip("a", 0, 8), initial: [], expected: [["a", 0, 8]] },
  { label: "redo delete", before: clip("a", 0, 8), after: "", initial: [row("a", 0, 8)], expected: [] },
])("updates $label from confirmed source without loading a preview", ({ before, after, initial, expected }) => {
  usePlayerStore.setState({ elements: initial, duration: 20, currentTime: 6, timelineReady: true });
  expect(syncHistoryTimelineFromFiles(null, { "index.html": { previous: page(before), restored: page(after) } })).toBe(true);
  expect(usePlayerStore.getState().elements.map(e => [e.id, e.start, e.duration])).toEqual(expected);
  expect(usePlayerStore.getState()).toMatchObject({ currentTime: 6, timelineReady: true });
  const retained = usePlayerStore.getState().elements.find(e => e.id === "a");
  if (initial.some(e => e.id === "a") && retained) expect(retained.sourceDuration).toBe(100);
});

it("applies batch moves and authored track changes while retaining unrelated dynamic metadata", () => {
  const before = page(clip("a", 0, 3) + clip("b", 4, 3));
  const after = page(clip("a", 2, 3, 'data-volume="0.5"').replace('data-track-index="0"', 'data-track-index="10"') + clip("b", 6, 3));
  const dynamic = { ...row("dynamic", 0, 20), sourceFile: "another.html", key: "another.html#dynamic" };
  usePlayerStore.setState({ elements: [row("a", 0, 3), row("b", 4, 3), dynamic], duration: 20, selectedElementId: "a" });
  syncHistoryTimelineFromFiles(null, { "index.html": { previous: before, restored: after } });
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ start: 2, authoredTrack: 10, volume: 0.5, sourceDuration: 100 });
  expect(usePlayerStore.getState().elements[1].start).toBe(6);
  expect(usePlayerStore.getState().elements[2].key).toBe(dynamic.key);
  expect(usePlayerStore.getState().selectedElementId).toBe("a");
});

it("handles a standalone nested template in that source file's local coordinates", () => {
  usePlayerStore.setState({ elements: [{ ...row("a", 2, 3), sourceFile: "scenes/one.html", key: "scenes/one.html#a" }], duration: 10 });
  const template = (body: string) => `<template id="scene">${page(body, 10)}</template>`;
  syncHistoryTimelineFromFiles("scenes/one.html", { "scenes/one.html": { previous: template(clip("a", 2, 3)), restored: template(clip("a", 1, 5)) } });
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ key: "scenes/one.html#a", start: 1, duration: 5, sourceDuration: 100 });
});

it("restores removed audio flags, automation and fades through the shared source parser", () => {
  const attrs = 'muted data-volume="0.4" data-fade-in="1" data-automation=\'{"version":1,"lanes":[]}\'';
  usePlayerStore.setState({ elements: [{ ...row("a", 0, 8), muted: true, volume: 0.4, fadeIn: 1, automation: '{"version":1,"lanes":[]}' }], duration: 20 });
  syncHistoryTimelineFromFiles(null, { "index.html": { previous: page(clip("a", 0, 8, attrs)), restored: page(clip("a", 0, 8)) } });
  expect(usePlayerStore.getState().elements[0]).toMatchObject({ volume: undefined, muted: undefined, fadeIn: undefined, automation: undefined, sourceDuration: 100 });
});

it("resolves added media URLs against the correct project and source directory", () => {
  usePlayerStore.setState({ timelineProjectId: "p1", elements: [], duration: 20 });
  syncHistoryTimelineFromFiles("scenes/a.html", { "scenes/a.html": { previous: page(""), restored: page(clip("a", 0, 8)) } });
  expect(usePlayerStore.getState().elements[0].src).toBe(new URL("/api/projects/p1/preview/scenes/a.mp3", location.origin).href);
});

it("does not replace the model for unrelated files, invalid source or unchanged source fields", () => {
  const elements = [row("a", 0, 8)];
  usePlayerStore.setState({ elements, duration: 20 });
  for (const files of [undefined, { "scene.html": { previous: page(""), restored: page(clip("a", 0, 8)) } }, { "index.html": { previous: "", restored: "" } }, { "index.html": { previous: page(clip("a", 0, 8)), restored: page(clip("a", 0, 8)) } }]) {
    expect(syncHistoryTimelineFromFiles(null, files)).toBe(false);
    expect(usePlayerStore.getState().elements).toBe(elements);
  }
});
