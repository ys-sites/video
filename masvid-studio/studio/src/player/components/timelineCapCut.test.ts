// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resolveZoneDropPlacement } from "./timelineCollision";
import { stickyTimelineTime } from "./timelineSnapping";
import { linkedOverlayKeys, mainVisualTrack } from "./timelineLinkage";
import { compactMainTrack } from "./timelineMainMagnet";
import { appendUntimedText } from "../lib/timelineUntimedText";
import { pasteTimelineClips, pasteElementHtml } from "../../hooks/useClipboard";
import { parseSavedSource } from "../../utils/authoredSource";
import type { TimelineElement } from "../store/playerStore";

const clip = (id: string, track: number, start: number, duration: number): TimelineElement => ({ id, key: id, tag: "div", track, start, duration, sourceFile: "index.html" });
const obstacle = clip("obstacle", 1, 5, 2);
const placement = (start: number, extra = {}) => resolveZoneDropPlacement({ order: [0, 1, 2], audioTracks: new Set([2]), elements: [obstacle], desiredTrack: 1, deliberateInsertRow: null, start, duration: 1, dragKey: "moving", isAudio: false, ...extra });

describe("pointer-following collision placement", () => {
  it("is monotonic over an obstacle at every pixel, without horizontal pushback", () => {
    let last = -Infinity;
    for (let px = 400; px <= 800; px++) {
      const result = placement(px / 100);
      expect(result.start).toBeGreaterThanOrEqual(last);
      expect(result.start).toBe(px / 100);
      last = result.start;
    }
  });
  it("drops at 6s on the free upper lane or opens above an occupied upper lane", () => {
    expect(placement(6)).toEqual({ track: 0, insertRow: null, start: 6 });
    expect(placement(6, { elements: [obstacle, clip("upper", 0, 0, 10)] })).toEqual({ track: 1, insertRow: 1, start: 6 });
  });
  it("follows twenty small reversals without jumping between 4s and 7s", () => {
    for (let i = 0; i < 20; i++) expect(placement(5.5 + (i % 2 ? .03 : -.03)).start).toBeCloseTo(5.5 + (i % 2 ? .03 : -.03));
  });
  it("keeps audio inside its own zone", () => {
    expect(placement(6, { isAudio: true, desiredTrack: 2, elements: [clip("audio", 2, 5, 2)] })).toEqual({ track: 2, insertRow: 2, start: 6 });
  });
});

it("releases a held trim snap after leaving the wider radius", () => {
  const targets = [{ time: 10, type: "clip-edge" as const }];
  const first = stickyTimelineTime(9.96, targets, 100);
  expect(stickyTimelineTime(9.94, targets, 100, 0, first.target).time).toBe(10);
  expect(stickyTimelineTime(9.92, targets, 100, 0, first.target).target).toBeNull();
});

it("links overlays in the main clip span only when enabled, leaving locked layers alone", () => {
  const els = [clip("main", 2, 4, 3), clip("title", 0, 5, 1), clip("outside", 0, 8, 1), { ...clip("locked", 1, 5, 1), timelineLocked: true }];
  expect([...linkedOverlayKeys(els, "main", null, true)]).toEqual(["main", "title"]);
  expect([...linkedOverlayKeys(els, "main", null, false)]).toEqual(["main"]);
});

it("compacts the bottom visual lane after trimming and carries its overlay by the same delta", () => {
  const a=clip("a",2,0,3), b=clip("b",2,3,2), title=clip("title",0,4,1);
  expect(compactMainTrack([a,b,title], [{element:a,start:0,duration:2}], true,true)).toMatchObject([
    {element:a,start:0,duration:2}, {element:b,start:2,duration:2}, {element:title,start:3,duration:1},
  ]);
  expect(compactMainTrack([a,b,title], [{element:a,start:0,duration:2}], false,true)).toHaveLength(1);
});

const source = '<html><body><div data-composition-id="main" data-start="0" data-duration="10"><h1 id="title">Title</h1></div></body></html>';
it("shows untimed root text once and copies it into a durable editable runtime clip", () => {
  const doc=parseSavedSource(source);
  const els=appendUntimedText(doc,[],10);
  expect(els).toHaveLength(1);
  const result=pasteTimelineClips(source,[{html:doc.querySelector('h1')!.outerHTML,start:0,duration:10,track:0}],2,[],true);
  const pasted=new DOMParser().parseFromString(result.content,'text/html').querySelector('#title-2')!;
  expect(pasted.getAttribute('data-start')).toBe('2');
  expect(pasted.getAttribute('data-duration')).toBe('10');
  expect(pasted.hasAttribute('data-track-index')).toBe(true);
  expect(result.ids).toEqual(['title-2']);
});
it("materializes a canvas text paste at the playhead with a stable fresh identity", () => {
  const result=pasteElementHtml(source,{html:'<h1 id="title">Title</h1>',originSelector:'#title'},true,undefined,3);
  const pasted=new DOMParser().parseFromString(result,'text/html').querySelector('#title-2')!;
  expect(pasted.getAttribute('data-start')).toBe('3');
  expect(pasted.getAttribute('data-duration')).toBe('7');
  expect(pasted.getAttribute('data-hf-id')).toBeTruthy();
});

it("persists all three drag preferences independently for each project", async () => {
  const {usePlayerStore}=await import('../store/playerStore');
  const store=usePlayerStore.getState();
  store.beginTimelineSession('capcut-a');
  expect(usePlayerStore.getState().timelineLinkageEnabled).toBe(false);
  store.setTimelineSnapEnabled(false);store.setRippleEditEnabled(false);store.setTimelineLinkageEnabled(false);
  store.beginTimelineSession('capcut-b');
  store.setTimelineSnapEnabled(true);store.setRippleEditEnabled(true);store.setTimelineLinkageEnabled(true);
  store.beginTimelineSession('capcut-a');
  expect(usePlayerStore.getState()).toMatchObject({timelineSnapEnabled:false,rippleEditEnabled:false,timelineLinkageEnabled:false});
  store.beginTimelineSession('capcut-b');
  expect(usePlayerStore.getState()).toMatchObject({timelineSnapEnabled:true,rippleEditEnabled:true,timelineLinkageEnabled:true});
});

it("does not compact an unrelated root lane when trimming an expanded composition child", () => {
  const main=clip('root',2,3,4), child=clip('child',2,0,2);
  const changes=[{element:child,start:0,duration:1}];
  expect(compactMainTrack([main],changes,true,true)).toEqual(changes);
});

it("reuses the vacated origin lane when a downward move overlaps an occupied row", () => {
  const result = placement(6, {origin:{track:0,start:6}});
  expect(result).toEqual({track:0,insertRow:null,start:6});
});


it("never treats timed text or captions as the main video track, including legacy lower lanes", () => {
  const text = { ...clip('text', 3, 0, 3), timelineRole: 'text' };
  const caption = { ...clip('transcript-00000000-0000-0000-0000-000000000000-cue', 4, 0, 3) };
  const main = clip('video', 1, 0, 6);
  const elements = [main, text, caption];
  expect(mainVisualTrack(elements)).toBe(1);
  expect([...linkedOverlayKeys(elements, 'text', null, true)]).toEqual(['text']);
  expect([...linkedOverlayKeys(elements, caption.id, null, true)]).toEqual([caption.id]);
  expect(mainVisualTrack([text, caption])).toBeNull();
});
