/**
 * timelineStackingSync — lane ↔ stacking unification (pure).
 *
 * A row move restacks the moved clip: moved up, it rises above every clip
 * it overlaps in time on the rows now below it; moved down, it sinks below every
 * such clip on the rows now above it. At the zero floor a bottom move rebases
 * the other scope members uniformly, preserving their order. Conflicting legacy CSS ranks are repaired among the edited clip and its
 * overlapping neighbours, retaining authored ranks when there is room.
 *
 * Lane → screen mapping (see Timeline.tsx trackOrder / TimelineCanvas rows):
 * tracks are sorted ASCENDING and rendered top → bottom, so a LOWER `track`
 * value renders HIGHER on screen. Standard NLE convention = the top row wins,
 * therefore **lower track ⇒ higher z-index**. We express this with a single
 * comparator so callers never have to remember the polarity.
 *
 * This module is DOM-free and store-free. Callers project their world onto
 * `StackingElement` (supplying the live z-index they read from the DOM/inline
 * style) and apply the returned `StackingPatch[]` however they persist styles.
 */

import { spansOverlap } from "@hyperframes/core/clip-facts";

/** Minimal element view this module reasons over. */
export interface StackingElement {
  /** Stable identity (TimelineElement.key ?? id). */
  key: string;
  /** Absolute start time (seconds). */
  start: number;
  /** Duration (seconds). */
  duration: number;
  /**
   * Display lane (the normalized timeline `track`). Lower = higher on screen =
   * should stack on top. This is the post-edit lane for edited clips.
   */
  track: number;
  /**
   * Current z-index (parsed from inline style / computed; "auto" ⇒ 0), or a
   * NON-FINITE value (NaN) when the caller could NOT resolve the clip's live node
   * (e.g. an unmounted / nested sub-comp element, or one outside the active file).
   * A non-finite-z clip is EXCLUDED from the computation — it is neither a stacking
   * neighbour nor resolvable as an edit — so an unresolved node never fabricates a
   * z=0 neighbour. The reader signals a
   * miss with NaN rather than null so the value stays assignable to the existing
   * `(el) => number` reader contract the drag hook / commit deps declare.
   */
  zIndex: number;
  /** Audio clips have no visual stacking and are excluded from the computation. */
  isAudio: boolean;
  /** Source document. Leaf z-indexes are comparable only inside this file. */
  sourceFile?: string;
  /**
   * CSS stacking context the clip's node lives in (TimelineElement.stackingContextId).
   * Leaf z-indexes are only comparable WITHIN one context — across contexts the
   * ancestors' z decides paint order — so the sync partitions by this key and
   * never patches across contexts. Null/undefined ⇒ the root context.
   */
  stackingContextId?: string | null;
  /**
   * Discovery / DOM document position (optional). Two clips with EQUAL z paint by
   * DOM order — the one LATER in the DOM paints ON TOP. When supplied, "is A above
   * B" uses (zIndex, domIndex); without it equal z counts as "not above", so the
   * move writes a z. Callers pass the index of the element in the discovery order
   * array.
   */
  domIndex?: number;
}

/** A minimal z-index change for one clip. */
export interface StackingPatch {
  key: string;
  zIndex: number;
}

/**
 * Canonical paint-scope key: leaf z-indexes are comparable only within the same
 * source document and CSS stacking context. The ONLY place this normalization
 * lives; samePaintScope compares with it.
 */
const paintScopeKey = (el: { sourceFile?: string; stackingContextId?: string | null }): string =>
  JSON.stringify([el.sourceFile ?? null, el.stackingContextId ?? null]);

/** Canonical paint-scope equality for stacking sync and its inverse mirror. */
export function samePaintScope(
  a: { sourceFile?: string; stackingContextId?: string | null },
  b: { sourceFile?: string; stackingContextId?: string | null },
): boolean {
  return paintScopeKey(a) === paintScopeKey(b);
}

/**
 * Two clips overlap in time when their half-open [start, end) intervals intersect.
 *
 * Keep the native floating-point tolerance for paint-stack changes. Editor lane
 * comparisons additionally tolerate millisecond serialization drift, but that
 * tolerance must not suppress z-index updates for clips that actually co-paint.
 */
function overlapsInTime(
  a: Pick<StackingElement, "start" | "duration">,
  b: Pick<StackingElement, "start" | "duration">,
): boolean {
  return spansOverlap(a.start, a.start + a.duration, b.start, b.start + b.duration);
}

/**
 * Is `a` visually ABOVE `b` (should stack on top)? Lower track renders higher on
 * screen, so a lower track number means "above". Exposed for tests / callers.
 */
export function laneIsAbove(
  a: Pick<StackingElement, "track">,
  b: Pick<StackingElement, "track">,
): boolean {
  return a.track < b.track;
}

/** Which way the edited clips moved between rows. */
export type StackingDirection = "up" | "down";

/**
 * Does `a` currently paint ON TOP of `b`? Higher z wins; equal z breaks by DOM
 * order (later in DOM paints on top). Without both domIndex values equal z is
 * ambiguous and counts as "not above", so the move still writes a z.
 */
function paintsAbove(
  a: Pick<StackingElement, "zIndex" | "domIndex">,
  b: Pick<StackingElement, "zIndex" | "domIndex">,
): boolean {
  if (a.zIndex !== b.zIndex) return a.zIndex > b.zIndex;
  if (a.domIndex != null && b.domIndex != null) return a.domIndex > b.domIndex;
  return false;
}

/** Moved up: one above the highest clip it now sits above, or null when it already paints above them all. */
function raisedZ(clip: StackingElement, overlapping: StackingElement[]): number | null {
  const below = overlapping.filter((o) => laneIsAbove(clip, o));
  if (below.every((o) => paintsAbove(clip, o))) return null;
  return Math.max(...below.map((o) => o.zIndex)) + 1;
}

/** Moved down: one below the lowest clip it now sits under, but never under z 0 (a negative z can paint behind the
 * composition's own background) and never under a clip on a lower row it paints over now, so the move cannot hide it.
 * Null when it already paints under them all or cannot go lower. */
function loweredZ(clip: StackingElement, overlapping: StackingElement[]): number | null {
  const above = overlapping.filter((o) => laneIsAbove(o, clip));
  if (above.every((o) => paintsAbove(o, clip))) return null;
  const keepOver = overlapping.filter((o) => laneIsAbove(clip, o) && paintsAbove(clip, o));
  const floor = Math.max(
    0,
    ...keepOver.map((o) =>
      paintsAbove({ ...clip, zIndex: o.zIndex }, o) ? o.zIndex : o.zIndex + 1,
    ),
  );
  const z = Math.max(floor, Math.min(...above.map((o) => o.zIndex)) - 1);
  return z < clip.zIndex ? z : null;
}

/**
 * The z-index patches for a row move: each edited clip is raised (`up`) or lowered (`down`) against the
 * clips it overlaps in time in its own paint scope. A bottom move may uniformly
 * raise the other scope members to make room at z=0. Clips whose live z is unresolved (non-finite) and audio clips take
 * no part. Several edited clips resolve against each other's new z: the bottom one first when moving up, the top one
 * first when moving down.
 */
export function computeStackingPatches(
  elements: StackingElement[],
  editedKeys: Iterable<string>,
  direction: StackingDirection,
): StackingPatch[] {
  const editedSet = new Set(editedKeys);
  const live = elements
    .filter((e) => Number.isFinite(e.zIndex) && !e.isAudio)
    .map((e) => ({ ...e }));
  const edited = live
    .filter((e) => editedSet.has(e.key))
    .sort((a, b) => (direction === "up" ? b.track - a.track : a.track - b.track));

  const originalZ = new Map(live.map((element) => [element.key, element.zIndex]));
  for (const clip of edited) {
    const overlapping = live.filter(
      (o) => o.key !== clip.key && overlapsInTime(clip, o) && samePaintScope(clip, o),
    );
    const zIndex = direction === "up" ? raisedZ(clip, overlapping) : loweredZ(clip, overlapping);
    if (zIndex !== null) clip.zIndex = zIndex;
    // At the bottom, z=0 may still paint above an earlier z=0 sibling.
    // Rebase every other node in the paint scope equally: their relative
    // order stays intact and the moved clip never goes behind the background.
    const above = overlapping.filter((other) => laneIsAbove(other, clip));
    if (direction === "down" && above.length > 0 &&
        overlapping.every((other) => laneIsAbove(other, clip)) &&
        !above.every((other) => paintsAbove(other, clip))) {
      const shift = Math.max(0, 1 - Math.min(...above.map((other) => other.zIndex)));
      for (const other of live) {
        if (other.key !== clip.key && samePaintScope(clip, other)) other.zIndex += shift;
      }
      clip.zIndex = 0;
    }

  }
  for (const clip of edited) {
    const overlapping = live.filter(other => other.key !== clip.key && overlapsInTime(clip, other) && samePaintScope(clip, other));
    const matchesLaneOrder = overlapping.every(other =>
      other.track === clip.track || (laneIsAbove(clip, other)
        ? paintsAbove(clip, other) : paintsAbove(other, clip)));
    if (!matchesLaneOrder) {
      // No rank can put the moved clip between an upper z=1 and lower z=10.
      // Make room upward only among this clip's overlapping neighbours. Keep
      // authored baselines and each lane's internal z order; a later scene or
      // an untracked decorative layer must not be affected by rank compression.
      const affected = [clip, ...overlapping];
      const scope = [...affected];
      const included = new Set(scope.map(other => other.key));
      // A neighbour may meet a same-lane sibling after the edited text ends.
      // Shift that overlap chain together so their authored order stays intact.
      for (let index = 0; index < scope.length; index++) {
        const member = scope[index];
        for (const other of live) {
          if (!included.has(other.key) && other.track === member.track &&
              samePaintScope(member, other) && overlapsInTime(member, other)) {
            scope.push(other);
            included.add(other.key);
          }
        }
      }
      const lanes = [...new Set(scope.map(other => other.track))].sort((a, b) => b - a);
      const raised = new Set<string>();
      for (const lane of lanes) {
        const members = scope.filter(other => other.track === lane);
        const below = affected.filter(other => other.track > lane);
        const shift = Math.max(0, ...affected.filter(member => member.track === lane).flatMap(member => below
          .filter(other => overlapsInTime(member, other))
          .map(other => other.zIndex + 1 - member.zIndex)));
        for (const member of members) {
          member.zIndex += shift;
          if (shift > 0) raised.add(member.key);
        }
      }
      // A shifted sibling can overlap upper clips outside the edited window.
      // Propagate only actual raises, bottom-to-top, so those clips keep their
      // lane order without letting unrelated lower siblings drive the repair.
      for (const member of [...live].sort((a, b) => b.track - a.track)) {
        if (!raised.has(member.key)) continue;
        for (const other of live) {
          if (laneIsAbove(other, member) && samePaintScope(member, other) &&
              overlapsInTime(member, other) && other.zIndex < member.zIndex + 1) {
            other.zIndex = member.zIndex + 1;
            raised.add(other.key);
          }
        }
      }
    }
  }
  return live.filter((element) => element.zIndex !== originalZ.get(element.key))
    .map(({ key, zIndex }) => ({ key, zIndex }));
}
