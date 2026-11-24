// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openPastedTextTrack, timedTextPaste } from "./timelineTextPaste";
import type { TimelineElement } from "../player/store/playerStore";

const source = '<div data-composition-id="main" data-duration="10"><video id="locked" data-track-index="0" data-start="0" data-duration="10" data-timeline-locked style="z-index: 9"></video></div>';
const locked: TimelineElement = { id: "locked", domId: "locked", tag: "video", track: 0, authoredTrack: 0, start: 0, duration: 10, timelineLocked: true };
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

describe("text paste top-track allocation", () => {
  it("opens above a locked visual clip without rewriting the source or rejecting the paste", () => {
    const result = openPastedTextTrack(source, '<h1 id="copy" data-start="2" data-duration="3">Copy</h1>', [locked]);
    const copy = parse(result.html).querySelector("h1")!;
    expect(result.source).toBe(source);
    expect(Number(copy.getAttribute("data-track-index"))).toBeLessThan(0);
    expect(copy.getAttribute("data-start")).toBe("2");
    expect(copy.textContent).toBe("Copy");
    expect(Number(copy.style.zIndex)).toBeGreaterThan(9);
  });

  it("uses the same top allocation for untimed paste and timed duplicate, even without live elements", () => {
    const timed = timedTextPaste('<h1 id="copy">Copy</h1>', source, 2);
    const duplicate = openPastedTextTrack(source, '<h1 id="copy" data-start="2" data-duration="8">Copy</h1>', []);
    const pastedNode = parse(timed).querySelector("h1")!;
    const copiedNode = parse(duplicate.html).querySelector("h1")!;
    expect(pastedNode.getAttribute("data-track-index")).toBe(copiedNode.getAttribute("data-track-index"));
    expect(Number(pastedNode.getAttribute("data-track-index"))).toBeLessThan(0);
    expect(pastedNode.style.zIndex).toBe(copiedNode.style.zIndex);
  });

  it("keeps consecutive pasted tracks above saved negative tracks, including template content", () => {
    const saved = '<template><div data-composition-id="main" data-duration="10"><h1 data-track-index="-4">Title</h1></div></template>';
    const first = openPastedTextTrack(saved, '<h2 data-start="0">First</h2>', []);
    const second = openPastedTextTrack(first.source + first.html, '<h2 data-start="0">Second</h2>', []);
    const track = (html: string) => Number(parse(html).querySelector("h2")!.getAttribute("data-track-index"));
    expect(track(first.html)).toBeLessThan(-4);
    expect(track(second.html)).toBeLessThan(track(first.html));
  });

  it("allocates above implicit live text lanes without changing their authored tracks", () => {
    const elements = [{ ...locked, track: -6, authoredTrack: 0, implicitTextTiming: true }];
    const result = openPastedTextTrack(source, '<h1>Copy</h1>', elements);
    expect(Number(parse(result.html).querySelector("h1")!.getAttribute("data-track-index"))).toBeLessThan(-6);
    expect(elements[0]?.authoredTrack).toBe(0);
    expect(result.source).toBe(source);
  });
});
