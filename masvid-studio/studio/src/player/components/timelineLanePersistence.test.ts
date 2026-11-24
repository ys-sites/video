import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import { planTimelineLanePersistence, withPersistedTimelineLanes } from "./timelineLanePersistence";
import { normalizeToZones } from "./timelineZones";
import { resolveDropTrack } from "../../utils/timelineDropTrackInsert";

const peers: TimelineElement[] = [
  { id: "main", domId: "main", tag: "div", start: 0, duration: 37.3, track: 0, authoredTrack: 0 },
  { id: "spill", domId: "spill", tag: "div", start: 7.2, duration: 0.6, track: 1, authoredTrack: 0 },
  { id: "other", domId: "other", tag: "div", start: 0, duration: 3, track: 2, authoredTrack: 1 },
  { id: "music", domId: "music", tag: "audio", start: 0, duration: 37.3, track: 3, authoredTrack: 0 },
];
const source = peers.map(e => `<${e.tag} id="${e.id}" data-track-index="${e.authoredTrack}"></${e.tag}>`).join("");

describe("durable displayed lanes", () => {
  it("keeps a drop at 9s on the spill row through source rediscovery", () => {
    const result = resolveDropTrack({ source, elements: peers, placement: { start: 9, track: 1 }, dropped: { id: "image", tag: "img", start: 9, duration: 3 } });
    expect(result).toMatchObject({ start: 9, track: 1 });
    const reloaded = peers.map(e => ({ ...e, track: Number(new RegExp(`id="${e.id}" data-track-index="([^"]+)"`).exec(result.source)![1]) }));
    const discovered = normalizeToZones([...reloaded, { id: "image", tag: "img", start: result.start, duration: 3, track: result.track }]);
    expect(discovered.map(e => [e.id, e.track])).toEqual([["main", 0], ["spill", 1], ["other", 2], ["music", 3], ["image", 1]]);
    expect(result.source).toContain('id="music" data-track-index="0"');
  });

  it("does not rewrite sparse authored tracks without spill rows", () => {
    expect(planTimelineLanePersistence(peers.filter(e => e.id !== "spill"), peers[0])).toEqual([]);
  });

  it("materializes an implicit default track without treating its missing attribute as a missing element", () => {
    const result = resolveDropTrack({
      source: '<div id="main"></div><div id="spill"></div>',
      elements: peers.slice(0, 2),
      placement: { start: 9, track: 1 },
      dropped: { id: "image", tag: "img", start: 9, duration: 3 },
    });
    expect(result).toMatchObject({ start: 9, track: 1 });
    expect(result.source).toContain('<div id="spill" data-track-index="1">');
    expect(result.source).toContain('<div id="main">');
  });

  it("opens a new top lane above clips with implicit track indices", () => {
    const result = resolveDropTrack({
      source: '<div id="main"></div><div id="spill"></div>',
      elements: peers.slice(0, 2),
      placement: { start: 9, track: 0, newTrack: "top" },
      dropped: { id: "image", tag: "img", start: 9, duration: 3 },
    });
    expect(result).toMatchObject({ start: 9, track: 0 });
    expect(result.source).toContain('<div id="main" data-track-index="1">');
    expect(result.source).toContain('<div id="spill" data-track-index="2">');
  });

  it("keeps foreign sources and the opposite media zone unchanged", () => {
    const foreign = { ...peers[1], id: "foreign", sourceFile: "child.html" };
    const plan = planTimelineLanePersistence([...peers, foreign], peers[0]);
    expect(plan.map(e => [e.element.id, e.track])).toEqual([["spill", 1], ["other", 2]]);
    expect(withPersistedTimelineLanes([...peers, foreign], plan).at(-1)).toBe(foreign);
  });

  it("refuses a partial renumber when an affected peer is locked", () => {
    expect(() => planTimelineLanePersistence(peers.map(e => e.id === "spill" ? { ...e, timelineLocked: true } : e), peers[0])).toThrow(/locked/);
  });
});
