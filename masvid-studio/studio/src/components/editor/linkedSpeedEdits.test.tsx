// @vitest-environment happy-dom
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHappyDomRootHarness } from "../../player/components/testRootHarness";
import { usePlayerStore, type TimelineElement } from "../../player/store/playerStore";
import type { CommitDomAttributeBatch } from "../../hooks/domEditCommitTypes";
import type { DomEditSelection } from "./domEditingTypes";
import {
  fanOutAttributeInSource,
  linkedPartnerTargets,
  useLinkedSpeedCommit,
  withLinkedPlaybackRate,
  type LinkedSpeedCommit,
} from "./linkedSpeedEdits";
import { useVolumeAutomation } from "./useVolumeAutomation";
import { useLinkedClipPreferences } from "../../utils/linkedClipPreferences";
import { parseClipSpeedSource } from "./clipSpeedTiming";
import { parseTimelineFromDOM } from "../../player/lib/timelineDOM";

const clip = (id: string, tag: string, link?: string): TimelineElement => ({
  id,
  domId: id,
  tag,
  start: 0,
  duration: 4,
  track: 0,
  ...(link ? { link } : {}),
});

const elements = [
  clip("talk", "video", "lk-1"),
  clip("talk-audio", "audio", "lk-1"),
  clip("music", "audio"),
];

const source = `<div data-composition-id="main">
<video id="talk" data-start="0" data-duration="4" data-link="lk-1" muted></video>
<audio id="talk-audio" data-start="0" data-duration="4" data-link="lk-1" data-automation="{&quot;version&quot;:1,&quot;lanes&quot;:[]}"></audio>
<audio id="music" data-start="0" data-duration="4"></audio>
</div>`;

function selection(id: string, dataAttributes: Record<string, string> = {}): DomEditSelection {
  const element = document.createElement("video");
  element.id = id;
  return {
    id,
    element,
    label: id,
    tagName: "video",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    textContent: null,
    dataAttributes: { start: "0", duration: "4", ...dataAttributes },
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
  };
}

describe("linkedPartnerTargets", () => {
  it("returns the other data-link members and nothing for an unlinked clip", () => {
    expect(linkedPartnerTargets({ id: "talk" }, elements)).toEqual([{ id: "talk-audio" }]);
    expect(linkedPartnerTargets({ id: "music" }, elements)).toEqual([]);
  });

  it("reaches no partner with Linked Selection off", () => {
    useLinkedClipPreferences.getState().setLinkedSelection(false);
    try {
      expect(linkedPartnerTargets({ id: "talk" }, elements)).toEqual([]);
    } finally {
      useLinkedClipPreferences.getState().setLinkedSelection(true);
    }
  });
});

describe("fanOutAttributeInSource", () => {
  it("writes each partner from its own current value", () => {
    const seen: Array<string | undefined> = [];
    const next = fanOutAttributeInSource(
      source,
      [{ id: "talk-audio" }],
      "data-automation",
      (raw) => {
        seen.push(raw);
        return "rate-lane";
      },
    );
    expect(seen).toEqual(['{"version":1,"lanes":[]}']);
    expect(next).toContain(
      'id="talk-audio" data-start="0" data-duration="4" data-link="lk-1" data-automation="rate-lane"',
    );
    expect(next).not.toContain('id="music" data-start="0" data-duration="4" data-automation');
  });
});

const harness = createHappyDomRootHarness();

function renderLinked(sel: DomEditSelection, commit: CommitDomAttributeBatch) {
  let linked: LinkedSpeedCommit | null = null;
  let rate: ReturnType<typeof useVolumeAutomation>["rate"] | null = null;
  function Probe() {
    linked = useLinkedSpeedCommit(sel, commit);
    rate = useVolumeAutomation(sel, 0, vi.fn(), linked).rate;
    return null;
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  act(() => harness.mount(host).render(<Probe />));
  return { linked: () => linked, rate: () => rate };
}

describe("linked speed edits", () => {
  beforeEach(() => usePlayerStore.setState({ rippleEditEnabled: false, timelineLinkageEnabled: false }));
  it.each([
    { rootSource: undefined, rootHasPeers: false },
    { rootSource: 'index.html', rootHasPeers: false },
    { rootSource: undefined, rootHasPeers: true },
    { rootSource: 'index.html', rootHasPeers: true },
  ])('uses nested peers despite repeated root identities ($rootSource, rootHasPeers=$rootHasPeers)', async ({ rootSource, rootHasPeers }) => {
    const media = '<video id="v" data-start="0" data-duration="4" data-track-index="0" data-link="pair"></video>';
    const html = `<section data-composition-id="scene" data-duration="8">${media}<audio id="partner" data-start="0" data-duration="4" data-track-index="-1" data-link="pair"></audio><video id="nested-next" data-start="4" data-duration="4" data-track-index="0"></video></section>`;
    const rootHtml = rootHasPeers ? html.replace('nested-next', 'root-next')
      : `<section data-composition-id="scene" data-duration="8">${media}</section>`;
    const rootElements = parseTimelineFromDOM(parseClipSpeedSource(rootHtml), Infinity)
      .map(el => ({ ...el, sourceFile: rootSource }));
    const nestedVideo = parseTimelineFromDOM(parseClipSpeedSource(html), Infinity).find(el => el.domId === 'v')!;
    expect(nestedVideo.hfId).toBeTruthy();
    expect(rootElements.find(el => el.domId === 'v')?.hfId).toBe(nestedVideo.hfId);
    usePlayerStore.setState({ elements: rootElements, rippleEditEnabled: true });
    useLinkedClipPreferences.setState({ linkedSelection: true });
    const sel = { ...selection('v'), hfId: nestedVideo.hfId, sourceFile: 'compositions/scene.html', compositionPath: 'compositions/scene.html' };
    let saved = '';
    const commit = vi.fn<CommitDomAttributeBatch>(async (target, _ops, options) => {
      expect(target.sourceFile).toBe('compositions/scene.html');
      options.validateContent?.(html);
      saved = options.prepareContent?.(html) ?? '';
      return true;
    });
    const probe = renderLinked(sel, commit);
    expect(await probe.linked()?.commitRate?.('2')).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(saved).toMatch(/id="v"[^>]*data-duration="2"/);
    expect(saved).toMatch(/id="partner"[^>]*data-duration="2"/);
    expect(saved).toMatch(/id="nested-next"[^>]*data-start="2"/);
    expect(usePlayerStore.getState().elements).toEqual(rootElements);
  });

  it.each(['video', 'audio'])('retimes a nested %s absent from the flat store with its source peers', async tag => {
    const html = `<template><section data-composition-id="scene" data-duration="8"><${tag} id="nested" data-start="0" data-duration="4" data-track-index="0" data-link="pair"></${tag}><audio id="partner" data-start="0" data-duration="4" data-track-index="-1" data-link="pair"></audio><${tag} id="next" data-start="4" data-duration="4" data-track-index="0"></${tag}></section></template>`;
    usePlayerStore.setState({ elements: [{ ...clip('host', 'div'), compositionSrc: 'compositions/scene.html' }], rippleEditEnabled: true });
    useLinkedClipPreferences.setState({ linkedSelection: true });
    const sel = { ...selection('nested'), tagName: tag, sourceFile: 'compositions/scene.html', compositionPath: 'compositions/scene.html' };
    let saved = '';
    const commit = vi.fn<CommitDomAttributeBatch>(async (_selection, _ops, options) => {
      options.validateContent?.(html);
      saved = options.prepareContent?.(html) ?? '';
      return true;
    });
    const probe = renderLinked(sel, commit);
    expect(await probe.linked()?.commitRate?.('2')).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(saved).toMatch(/id="nested"[^>]*data-duration="2"/);
    expect(saved).toMatch(/id="partner"[^>]*data-duration="2"/);
    expect(saved).toMatch(new RegExp(`id="next"[^>]*data-start="${tag === 'video' ? 2 : 4}"`));
  });

  it("fans a playback-rate edit out to the partner in one batch commit", async () => {
    usePlayerStore.getState().setElements(elements);
    const commit = vi.fn<CommitDomAttributeBatch>(async () => true);
    const onSetAttribute = vi.fn();
    const probe = renderLinked(selection("talk"), commit);
    await withLinkedPlaybackRate(onSetAttribute, probe.linked())("playback-rate", "2");
    expect(onSetAttribute).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    const [, ops, options] = commit.mock.calls[0] ?? [];
    expect(ops).toEqual([{ type: "attribute", property: "playback-rate", value: "2" }]);
    options?.validateContent?.(source);
    const next = options?.prepareContent?.(source) ?? '';
    expect(next).toMatch(/id="talk"[^>]*data-duration="2"/);
    expect(next).toMatch(/id="talk-audio"[^>]*data-duration="2"/);
  });

  it("pins fit zoom before a speed edit and preserves an existing manual scale", async () => {
    usePlayerStore.setState({ elements, zoomMode: "fit", timelinePps: 80, timelineFitPps: 80 });
    const commit = vi.fn<CommitDomAttributeBatch>(async () => {
      expect(usePlayerStore.getState().zoomMode).toBe("manual");
      return true;
    });
    const probe = renderLinked(selection("talk"), commit);
    await probe.linked()?.commitRate?.("2");
    expect(commit.mock.calls[0]?.[2].syncTimingInPlace).toBe(true);
    const scale = usePlayerStore.getState().manualZoomPercent;
    usePlayerStore.setState({ timelineFitPps: 120 });
    await probe.linked()?.commitRate?.("3");
    expect(usePlayerStore.getState().manualZoomPercent).toBe(scale);
  });

  it("drops obsolete queued slider values while retaining the final requested speed", async () => {
    usePlayerStore.getState().setElements(elements);
    const releases: Array<(ok: boolean) => void> = [];
    const commit = vi.fn<CommitDomAttributeBatch>(() => new Promise(resolve => releases.push(resolve)));
    const probe = renderLinked(selection("talk"), commit);
    const first = probe.linked()!.commitRate!("2");
    const last = probe.linked()!.commitRate!("4");
    expect(commit.mock.calls[0]?.[2].shouldSave?.()).toBe(false);
    expect(commit.mock.calls[1]?.[2].shouldSave?.()).toBe(true);
    releases[0]!(true);
    await first;
    expect(commit.mock.calls[1]?.[2].shouldSave?.()).toBe(true);
    releases[1]!(true);
    await last;
  });

  it("fans a ramp preset out as one commit carrying each member's rate lane", () => {
    usePlayerStore.getState().setElements(elements);
    const commit = vi.fn<CommitDomAttributeBatch>(async () => true);
    const probe = renderLinked(selection("talk"), commit);
    act(() => probe.rate()?.onApplyPreset("ramp-in"));
    expect(commit).toHaveBeenCalledTimes(1);
    const [, ops, options] = commit.mock.calls[0] ?? [];
    expect(ops?.[0]?.property).toBe("automation");
    expect(String(ops?.[0]?.value)).toContain('"target":"rate"');
    const partner = /id="talk-audio"[^>]*data-automation="([^"]*)"/.exec(
      options?.prepareContent?.(source) ?? "",
    )?.[1];
    expect(partner).toContain("rate");
  });

  it("also commits an unlinked clip's speed and duration atomically", async () => {
    usePlayerStore.getState().setElements(elements);
    const commit = vi.fn<CommitDomAttributeBatch>(async () => true);
    const onSetAttribute = vi.fn();
    const probe = renderLinked(selection("music"), commit);
    await withLinkedPlaybackRate(onSetAttribute, probe.linked())("playback-rate", "2");
    expect(onSetAttribute).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledTimes(1);
    const options = commit.mock.calls[0]?.[2];
    options?.validateContent?.(source);
    expect(options?.prepareContent?.(source)).toMatch(/id="music"[^>]*data-duration="2"/);
  });
});
