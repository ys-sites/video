// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { holdHistoryTimelineUntilPreviewReplaced, hasPendingHistoryTimeline } from "./timelineRestorePending";
import { createPreviewMessageHandler } from "./hooks/previewMessageRouter";
import { announcePreviewDocumentLoaded } from "./sceneSwap";
import { usePlayerStore } from "./store/playerStore";

afterEach(() => { document.body.innerHTML = ""; usePlayerStore.getState().reset(); });

it.each(["document load", "scene swap", "different document"])("blocks stale clip rediscovery until %s", reason => {
  const iframe = document.createElement("iframe"); document.body.append(iframe);
  const process = vi.fn(), enrich = vi.fn();
  const handler = createPreviewMessageHandler({ iframeRef: { current: iframe }, processTimelineMessageRef: { current: process }, enrichMissingCompositionsRef: { current: enrich }, lastTimelineMessageRef: { current: 0 }, getAdapter: () => null, syncTimelineElements: vi.fn() });
  holdHistoryTimelineUntilPreviewReplaced(iframe);
  const state = () => handler(new MessageEvent("message", { data: { source: "hf-preview", type: "state", isPlaying: false } }));
  const timeline = () => handler(new MessageEvent("message", { data: { source: "hf-preview", type: "timeline", clips: [], durationInFrames: 600 } }));
  state(); timeline();
  expect(process).not.toHaveBeenCalled(); expect(enrich).not.toHaveBeenCalled();
  if (reason === "document load") announcePreviewDocumentLoaded(iframe);
  else if (reason === "scene swap") iframe.dispatchEvent(new Event("hf-scenes-swapped"));
  else Object.defineProperty(iframe, "contentDocument", { value: document.implementation.createHTMLDocument("") });
  expect(hasPendingHistoryTimeline(iframe)).toBe(false);
  timeline();
  expect(process).toHaveBeenCalledOnce();
});

it("keeps the latest confirmed restore protected and leaves another iframe independent", () => {
  const first = document.createElement("iframe"), other = document.createElement("iframe");
  document.body.append(first, other);
  holdHistoryTimelineUntilPreviewReplaced(first);
  holdHistoryTimelineUntilPreviewReplaced(first);
  expect(hasPendingHistoryTimeline(first)).toBe(true);
  expect(hasPendingHistoryTimeline(other)).toBe(false);
  announcePreviewDocumentLoaded(first);
  expect(hasPendingHistoryTimeline(first)).toBe(false);
});
