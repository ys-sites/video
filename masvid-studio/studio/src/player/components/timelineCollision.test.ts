import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../store/playerStore";
import {
  clampTrackToZone,
  isInsertAllowedForZone,
  isLaneFree,
  resolveInsertRow,
  resolveZoneDropPlacement,
  timeRangesOverlap,
} from "./timelineCollision";

function el(id: string, track: number, start: number, duration: number): TimelineElement {
  return { id, tag: "video", start, duration, track };
}

describe("timeRangesOverlap", () => {
  it("detects overlap and treats touching edges as free (half-open)", () => {
    expect(timeRangesOverlap(0, 2, 1, 3)).toBe(true);
    expect(timeRangesOverlap(0, 2, 2, 4)).toBe(false); // touching at 2
    expect(timeRangesOverlap(2, 4, 0, 2)).toBe(false);
  });
});

describe("isLaneFree", () => {
  const els = [el("a", 0, 0, 5), el("b", 1, 2, 3)];

  it("is free when nothing overlaps on the track", () => {
    expect(isLaneFree(els, 2, 0, 5, null)).toBe(true);
    expect(isLaneFree(els, 0, 6, 8, null)).toBe(true); // same track, no time overlap
  });

  it("is occupied when a clip overlaps on the same track", () => {
    expect(isLaneFree(els, 0, 1, 3, null)).toBe(false);
  });

  it("ignores the excluded (dragged) clip", () => {
    expect(isLaneFree(els, 0, 1, 3, "a")).toBe(true);
  });
});

describe("resolveInsertRow (only empty space outside the rows opens a track)", () => {
  const n = 3; // three rows: 0, 1, 2

  it("stays on the row everywhere over it, edges included", () => {
    for (let rowFloat = 0; rowFloat < n; rowFloat += 0.01) {
      expect(resolveInsertRow(rowFloat, n)).toBeNull();
    }
  });

  it("opens a track above the first row and below the last", () => {
    expect(resolveInsertRow(-0.4, n)).toBe(0);
    expect(resolveInsertRow(n, n)).toBe(n);
    expect(resolveInsertRow(n + 0.4, n)).toBe(n);
  });

  it("opens the first track on an empty timeline", () => {
    expect(resolveInsertRow(0.5, 0)).toBe(0);
  });
});

describe("clampTrackToZone", () => {
  // trackOrder [0,1,2,3]: rows 0,1 = visual; rows 2,3 = audio (audioRow = 2).
  const order = [0, 1, 2, 3];

  it("is a no-op when there is no audio zone", () => {
    expect(clampTrackToZone(3, order, -1, false)).toBe(3);
  });

  it("keeps a visual clip in the visual zone", () => {
    expect(clampTrackToZone(1, order, 2, false)).toBe(1); // already visual
    expect(clampTrackToZone(3, order, 2, false)).toBe(1); // in audio → last visual lane
  });

  it("keeps an audio clip in the audio zone", () => {
    expect(clampTrackToZone(2, order, 2, true)).toBe(2); // already audio
    expect(clampTrackToZone(0, order, 2, true)).toBe(2); // in visual → first audio lane
  });
});

describe("isInsertAllowedForZone", () => {
  // audioRow = 2
  it("allows any insert when there is no audio zone", () => {
    expect(isInsertAllowedForZone(0, -1, false)).toBe(true);
    expect(isInsertAllowedForZone(3, -1, true)).toBe(true);
  });

  it("allows a visual insert only at/above the audio zone top", () => {
    expect(isInsertAllowedForZone(0, 2, false)).toBe(true);
    expect(isInsertAllowedForZone(2, 2, false)).toBe(true); // bottom of the visual zone
    expect(isInsertAllowedForZone(3, 2, false)).toBe(false); // inside the audio zone
  });

  it("allows an audio insert only at/below the audio zone top (audio clips make audio tracks)", () => {
    expect(isInsertAllowedForZone(2, 2, true)).toBe(true);
    expect(isInsertAllowedForZone(4, 2, true)).toBe(true); // below the bottom
    expect(isInsertAllowedForZone(1, 2, true)).toBe(false); // inside the visual zone
  });
});

describe("resolveZoneDropPlacement (overlap changes lanes while preserving time)", () => {
  // order [0,1,2] visual + [3] audio. audioRow = 3.
  const order = [0, 1, 2, 3];
  const audioTracks = new Set([3]);
  const base = {
    order,
    audioTracks,
    deliberateInsertRow: null as number | null,
    start: 2,
    duration: 2,
    dragKey: "x",
    isAudio: false,
  };
  const allVisualOccupied = () => [el("a", 0, 0, 10), el("b", 1, 0, 10), el("c", 2, 0, 10)];

  it("preserves time for upper-row placement and deliberate insertion", () => {
    const drop = { ...base, elements: [el("block", 1, 10, 10)], desiredTrack: 1,
      start: 13.01, duration: 4 };
    expect(resolveZoneDropPlacement(drop)).toEqual({ track: 0, insertRow: null, start: 13.01 });
    expect(resolveZoneDropPlacement({ ...drop,
      deliberateInsertRow: 1 })).toEqual({ track: 1, insertRow: 1, start: 13.01 });
  });

  it("lands on the aimed track when it is free at that time", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [el("a", 1, 10, 3)], desiredTrack: 1 }),
    ).toEqual({ track: 1, insertRow: null, start: 2 });
  });

  it("uses the nearest free upper lane at the pointer time", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [el("a", 1, 0, 5)], desiredTrack: 1 }),
    ).toEqual({ track: 0, insertRow: null, start: 2 });
  });

  it.each([1, 2])("skips a locked target or upper lane at row %s", lockedTrack => {
    const elements = [
      { ...el("locked", lockedTrack, 10, 2), timelineLocked: true },
      ...(lockedTrack === 1 ? [el("occupied", 2, 0, 5)] : []),
    ];
    expect(resolveZoneDropPlacement({ ...base, elements, desiredTrack: 2 }))
      .toEqual({ track: lockedTrack === 1 ? 0 : 1, insertRow: null, start: 2 });
  });

  it("opens a lane above the aim when every row is occupied", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: allVisualOccupied(), desiredTrack: 1 }),
    ).toEqual({ track: 1, insertRow: 1, start: 2 });
  });

  it("opens above the aim when upper lanes are occupied", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 0, 0, 5), el("b", 1, 0, 5), el("x", 2, 0, 5)],
        desiredTrack: 1,
      }),
    ).toEqual({ track: 1, insertRow: 1, start: 2 });
  });

  it("Tag keeps 2s and opens above the occupied Subtitle row", () => {
    const elements = [el("title", 0, 0, 10), el("subtitle", 1, 0, 6), el("tag", 2, 2, 5)];
    const drop = { ...base, elements, start: 2, duration: 5, dragKey: "tag" };
    expect(resolveZoneDropPlacement({ ...drop, desiredTrack: 1 })).toEqual({
      track: 1,
      insertRow: 1,
      start: 2,
    });
    expect(resolveZoneDropPlacement({ ...drop, desiredTrack: 0 })).toEqual({
      track: 0,
      insertRow: 0,
      start: 2,
    });
  });

  it("shares a track for sequential (non-overlapping) clips", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 1, 0, 2)],
        desiredTrack: 1,
        start: 2,
      }),
    ).toEqual({ track: 1, insertRow: null, start: 2 });
  });

  it("clamps a visual clip OUT of the audio zone before placing", () => {
    expect(resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 3 })).toEqual({
      track: 2,
      insertRow: null,
      start: 2,
    });
  });

  it("clamps an audio clip INTO the audio zone before placing", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 0, isAudio: true }),
    ).toEqual({ track: 3, insertRow: null, start: 2 });
  });

  it("upward create-drag off the top lane inserts at the TOP of the visual zone, never below audio (reviewer repro)", () => {
    // The sentinel desiredTrack = minTrack-1 = -1 must anchor to the visual zone's top boundary.
    expect(
      resolveZoneDropPlacement({ ...base, elements: allVisualOccupied(), desiredTrack: -1 }),
    ).toEqual({ track: -1, insertRow: 0, start: 2 });
  });

  it("downward create-drag off the bottom visual lane inserts at the audio boundary, never below it", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: allVisualOccupied(), desiredTrack: 4 }),
    ).toEqual({ track: 4, insertRow: 3, start: 2 });
  });

  it("audio create-drag with an out-of-range aim inserts inside the audio zone", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [el("a", 3, 0, 10)],
        desiredTrack: -1,
        isAudio: true,
      }),
    ).toEqual({ track: -1, insertRow: 3, start: 2 });
  });

  it("honors an insert aimed at the space outside the rows in the clip's own zone", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 0, deliberateInsertRow: 0 }),
    ).toEqual({ track: 0, insertRow: 0, start: 2 });
  });

  it("ignores an insert that lands in the WRONG zone (visual into audio)", () => {
    expect(
      resolveZoneDropPlacement({ ...base, elements: [], desiredTrack: 1, deliberateInsertRow: 4 }),
    ).toEqual({ track: 1, insertRow: null, start: 2 });
  });

  it("lets an AUDIO clip open a new audio track below the last row", () => {
    expect(
      resolveZoneDropPlacement({
        ...base,
        elements: [],
        desiredTrack: 3,
        isAudio: true,
        deliberateInsertRow: 4,
      }),
    ).toEqual({ track: 3, insertRow: 4, start: 2 });
  });

  it("audio dropped on a visual-only timeline opens its zone's first row, no overlap (#2195)", () => {
    const drop = {
      order: [0],
      audioTracks: new Set<number>(),
      elements: [el("v", 0, 0, 5)],
      desiredTrack: 0,
      deliberateInsertRow: null,
      duration: 2,
      dragKey: "audio",
      isAudio: true,
    };
    // Occupied and free spans alike: the visual row is not a row an audio clip may land on.
    expect(resolveZoneDropPlacement({ ...drop, start: 1 })).toEqual({
      track: 0,
      insertRow: 1,
      start: 1,
    });
    expect(resolveZoneDropPlacement({ ...drop, start: 10 })).toEqual({
      track: 0,
      insertRow: 1,
      start: 10,
    });
  });
});


describe("vertical visual drops preserve scene timing", () => {
  const base = {
    order: [0, 1, 2, 3], audioTracks: new Set([3]),
    elements: [el("a", 0, 0, 10), el("b", 1, 0, 10), el("c", 2, 0, 10)],
    desiredTrack: 1, deliberateInsertRow: null, start: 2, duration: 5,
    dragKey: "moving", isAudio: false,
  };
  it("opens above an occupied lane when moving upward", () => {
    expect(resolveZoneDropPlacement({ ...base, origin: { track: 2, start: 2 } }))
      .toEqual({ track: 1, insertRow: 1, start: 2 });
  });
  it("opens above an occupied lane when moving downward", () => {
    expect(resolveZoneDropPlacement({ ...base, origin: { track: 0, start: 2 } }))
      .toEqual({ track: 1, insertRow: 1, start: 2 });
  });
  it("uses the vacated origin when it is a free upper lane", () => {
    const moving = el("moving", 0, 2, 5);
    expect(resolveZoneDropPlacement({
      ...base,
      elements: [moving, el("b", 1, 0, 10)],
      origin: { track: 0, start: 2 },
    })).toEqual({ track: 0, insertRow: null, start: 2 });
  });
  it("keeps snapped pointer time when reusing the vacated origin", () => {
    expect(resolveZoneDropPlacement({
      ...base,
      elements: [el("moving", 0, 2, 5), el("b", 1, 0, 10)],
      origin: { track: 0, start: 2 },
      start: 2.15,
    })).toEqual({ track: 0, insertRow: null, start: 2.15 });
  });
  it("preserves pointer time for both horizontal visual and audio moves", () => {
    expect(resolveZoneDropPlacement({ ...base, origin: { track: 2, start: 1 } }).start).toBe(2);
    expect(resolveZoneDropPlacement({ ...base, isAudio: true, desiredTrack: 3,
      elements: [el("audio", 3, 0, 10)], origin: { track: 4, start: 2 } }))
      .toEqual({ track: 3, insertRow: 3, start: 2 });
  });
  it("does not insert into a protected group boundary", () => {
    expect(resolveZoneDropPlacement({ ...base, origin: { track: 2, start: 2 },
      allowedInsertRows: new Set([0, 3, 4]) })).toEqual({ track: 2, insertRow: null, start: 2 });
  });
});


describe("OpenReel placement on main and secondary tracks", () => {
  const base = {
    order: [0, 1], audioTracks: new Set<number>(), deliberateInsertRow: null,
    start: 6, duration: 5, dragKey: "moving", isAudio: false,
    origin: { track: 0, start: 12 }, desiredTrack: 0,
  };

  it("opens above a secondary track occupied at 5–10s, retaining the aimed 6s", () => {
    expect(resolveZoneDropPlacement({ ...base,
      elements: [el("busy", 0, 5, 5), el("moving", 0, 12, 5), el("main", 1, 0, 20)],
    })).toEqual({ track: 0, insertRow: 0, start: 6 });
  });

  it("preserves pointer time when an occupied main track has no nearby landing", () => {
    expect(resolveZoneDropPlacement({ ...base, desiredTrack: 1,
      start: 2, origin: { track: 1, start: 5 },
      elements: [el("busy", 1, 0, 5), el("moving", 1, 5, 5)],
    })).toEqual({ track: 0, insertRow: null, start: 2 });
  });

  it("never corrects collision time even near the original main-track start", () => {
    const drop = { ...base, desiredTrack: 1,
      origin: { track: 1, start: 5 },
      elements: [el("busy", 1, 0, 5), el("moving", 1, 5, 5)] };
    expect(resolveZoneDropPlacement({ ...drop, start: 4.92 })).toEqual({ track: 0, insertRow: null, start: 4.92 });
    expect(resolveZoneDropPlacement({ ...drop, start: 4.91 })).toEqual({ track: 0, insertRow: null, start: 4.91 });
  });

  it("uses a free upper lane at 6s when the main track is occupied", () => {
    expect(resolveZoneDropPlacement({ ...base, desiredTrack: 1,
      origin: { track: 1, start: 12 },
      elements: [el("busy", 1, 5, 5), el("moving", 1, 12, 5)],
    })).toEqual({ track: 0, insertRow: null, start: 6 });
  });

  it("opens above the main track when all upper lanes are occupied", () => {
    expect(resolveZoneDropPlacement({ ...base, desiredTrack: 1,
      origin: { track: 1, start: 12 },
      elements: [el("upper", 0, 0, 20), el("busy", 1, 5, 5), el("moving", 1, 12, 5)],
    })).toEqual({ track: 1, insertRow: 1, start: 6 });
  });

  it("restores both origin lane and time when a protected boundary refuses insertion", () => {
    expect(resolveZoneDropPlacement({ ...base, origin: { track: 1, start: 12 },
      allowedInsertRows: new Set([2]), elements: [el("busy", 0, 5, 5)],
    })).toEqual({ track: 1, insertRow: null, start: 12 });
  });
});
