import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseSourceDocument, splitElementInHtml } from "@hyperframes/studio-server/source-mutation";
import type { TimelineElement } from "../store/playerStore";
import { normalizeToZones } from "./timelineZones";
import { isLaneFree } from "./timelineCollision";
import { timelineElementsOverlap } from "./timelineTrackOrder";
import { timelineSpansOverlap } from "./timelineTimeBounds";

const welcome = readFileSync(new URL("../../../../template-library/openmotion-welcome/index.html", import.meta.url), "utf8");
function clipsIn(source: string): TimelineElement[] {
  const { document } = parseSourceDocument(source);
  return [...document.querySelectorAll(".clip")].map((clip) => ({
    id: clip.id,
    tag: clip.tagName.toLowerCase(),
    start: Number(clip.getAttribute("data-start")),
    duration: Number(clip.getAttribute("data-duration")),
    track: Number(clip.getAttribute("data-track-index")),
  }));
}

describe("native cuts keep their authored lanes after rediscovery", () => {
  it.each([10.6666666667, 10.667, 8.4])("keeps the welcome gallery and following reel on one track at %s", (time) => {
    const cut = splitElementInHtml(welcome, { id: "welcome-gallery" }, time, "gallery-right", { start: 7.7666666667, duration: 2.9666666666, track: 0 });
    expect(cut.matched).toBe(true);
    const clips = clipsIn(cut.html);
    const normalized = normalizeToZones(clips);
    expect(normalized.filter((clip) => clip.tag !== "audio").every((clip) => clip.track === 0)).toBe(true);
    expect(normalized.find((clip) => clip.tag === "audio")?.track).toBe(1);
    const right = clips.find((clip) => clip.id === cut.newId)!;
    const reel = clips.find((clip) => clip.id === "welcome-reel")!;
    expect(isLaneFree(clips, 0, right.start, right.start + right.duration, right.id)).toBe(true);
    expect(timelineElementsOverlap(right, reel)).toBe(false);
    expect(normalizeToZones(clipsIn(cut.html))).toEqual(normalized);
  });

  it("retains two lanes through repeated visual and audio cuts", () => {
    let source = welcome;
    for (const [id, time] of [["welcome-gallery", 10.6666666667], ["welcome-gallery", 8.4], ["welcome-reel", 15.1], ["welcome-soundtrack", 10.6666666667]] as const) {
      const clip = clipsIn(source).find((item) => item.id === id)!;
      const cut = splitElementInHtml(source, { id }, time, `${id}-right`, clip);
      expect(cut.matched).toBe(true);
      source = cut.html;
      for (const item of normalizeToZones(clipsIn(source))) expect(item.track).toBe(item.tag === "audio" ? 1 : 0);
    }
    expect(normalizeToZones(clipsIn(welcome))).toEqual(clipsIn(welcome));
  });

  it("ignores millisecond serialization drift, but retains real overlaps", () => {
    expect(timelineSpansOverlap(0, 10.734, 10.733, 19)).toBe(false);
    expect(timelineSpansOverlap(0, 10.734, 10.7329, 19)).toBe(true);
    for (const fps of [24, 30, 60, 120]) {
      expect(timelineSpansOverlap(0, 10 + 1 / fps, 10, 19)).toBe(true);
    }
    expect(timelineSpansOverlap(0, 10, 2, 3)).toBe(true);
    expect(timelineSpansOverlap(0, 10, 2, 2.0001)).toBe(true);
  });

  it("bounds interval work on a long sequential track", () => {
    let durationReads = 0;
    const clips: TimelineElement[] = Array.from({ length: 4000 }, (_, index) => ({
      id: `clip-${index}`, tag: "video", track: 0, start: index / 30,
      get duration() { durationReads++; return 1 / 30; },
    })).reverse();
    expect(normalizeToZones(clips)).toBe(clips);
    expect(durationReads).toBeLessThan(clips.length * 10);
  });
});
