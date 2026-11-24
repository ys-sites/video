// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../store/timelineElement";
import { normalizeClipsLoudness, writeClipGains } from "./audioGainApply";

const clip = (id: string, extra: Partial<TimelineElement> = {}): TimelineElement => ({
  id,
  domId: id,
  tag: "audio",
  src: `${id}.mp3`,
  start: 0,
  duration: 4,
  track: 0,
  ...extra,
});

const volumeLane = JSON.stringify({
  version: 1,
  lanes: [{ target: "volume", points: [{ t: 0, v: 0.25 }] }],
});
const plan = { targetLufs: -16, projectedLufs: -16, volume: 2, changeDb: 6, limitedBy: null };

afterEach(() => vi.unstubAllGlobals());

describe("normalizeClipsLoudness", () => {
  it.each([
    [null, -16, 2, 0],
    ["gain-ceiling", -24, 1, 1],
    ["true-peak", -18.4, 1, 1],
  ] as const)("reports actual projected results for a batch limited by %s", async (limitedBy, projectedLufs, matched, unmatched) => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ plan }))
      .mockResolvedValueOnce(Response.json({ plan: { ...plan, projectedLufs, limitedBy } })));
    const save = vi.fn(async () => ({ status: "saved" as const }));
    expect(await normalizeClipsLoudness("p1", [clip("a"), clip("b")], { onSetElementsAttributeQuiet: save }))
      .toBe(`Adjusted 2 clips: ${matched} expected to reach target; ${unmatched} unable to reach target.`);
    expect(save).toHaveBeenCalledOnce();
  });

  it("does not claim any clip reached target when every clip is limited", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ plan: { ...plan, projectedLufs: -24, limitedBy: "gain-ceiling" } })));
    expect(await normalizeClipsLoudness("p1", [clip("a"), clip("b")], { onSetElementsAttributeQuiet: async () => ({ status: "saved" }) }))
      .toBe("Adjusted 2 clips: 0 expected to reach target; 2 unable to reach target.");
  });

  it("does not measure or save an empty selection", async () => {
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    expect(await normalizeClipsLoudness("p1", [], {})).toBe("No audio clips selected.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("refuses a clip whose volume lane owns its gain, before measuring or writing", async () => {
    const fetchSpy = vi.fn(async () => Response.json({ plan }));
    vi.stubGlobal("fetch", fetchSpy);
    const onSetElementAttributeQuiet = vi.fn(async () => ({ status: "saved" as const }));
    await expect(
      normalizeClipsLoudness("p1", [clip("vo", { automation: volumeLane })], {
        onSetElementAttributeQuiet,
      }),
    ).rejects.toThrow(/volume is automated/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSetElementAttributeQuiet).not.toHaveBeenCalled();
  });

  it("rejects instead of claiming success when the save fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ plan })),
    );
    const onSetElementAttributeQuiet = vi.fn(async () => ({
      status: "failed" as const,
      reason: "disk full",
    }));
    await expect(
      normalizeClipsLoudness("p1", [clip("vo")], { onSetElementAttributeQuiet }),
    ).rejects.toThrow("disk full");
  });
});

describe("writeClipGains", () => {
  it("stops at the first refused single save", async () => {
    const onSetElementAttributeQuiet = vi.fn(async () => ({
      status: "refused" as const,
      reason: "Cannot edit timeline while recording",
    }));
    await expect(
      writeClipGains(
        [
          { element: clip("a"), gain: 2 },
          { element: clip("b"), gain: 2 },
        ],
        { onSetElementAttributeQuiet },
      ),
    ).rejects.toThrow("Cannot edit timeline while recording");
    expect(onSetElementAttributeQuiet).toHaveBeenCalledTimes(1);
  });

  it("surfaces a failed multi-clip save", async () => {
    const onSetElementsAttributeQuiet = vi.fn(async () => ({
      status: "failed" as const,
      reason: "disk full",
    }));
    await expect(
      writeClipGains(
        [
          { element: clip("a"), gain: 2 },
          { element: clip("b"), gain: 2 },
        ],
        { onSetElementsAttributeQuiet },
      ),
    ).rejects.toThrow("disk full");
  });
});
