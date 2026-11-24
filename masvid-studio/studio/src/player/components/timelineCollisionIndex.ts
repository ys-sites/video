import type { TimelineElement } from "../store/playerStore";

const cache = new WeakMap<readonly TimelineElement[], ReadonlyMap<number, readonly TimelineElement[]>>();
const EMPTY: readonly TimelineElement[] = [];

/** Immutable element snapshots share one sorted lane index across pointer frames. */
export function collisionLane(elements: readonly TimelineElement[], track: number): readonly TimelineElement[] {
  let index = cache.get(elements);
  if (!index) {
    const lanes = new Map<number, TimelineElement[]>();
    for (const element of elements) {
      const lane = lanes.get(element.track);
      if (lane) lane.push(element);
      else lanes.set(element.track, [element]);
    }
    for (const lane of lanes.values()) lane.sort((a, b) => a.start - b.start);
    index = lanes;
    cache.set(elements, index);
  }
  return index.get(track) ?? EMPTY;
}
