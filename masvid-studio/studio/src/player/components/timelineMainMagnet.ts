import type { TimelineElement } from "../store/playerStore";
import { mainVisualTrack, linkedOverlayKeys } from "./timelineLinkage";

export interface MainMagnetChange {
  element: TimelineElement;
  start: number;
  duration: number;
  playbackStart?: number;
}

/** Reflow the bottom visual lane after an edit. A locked member refuses the
 * reflow as a whole. Callers persist the returned batch in their existing undo
 * transaction; this function owns no save or history state. */
export function compactMainTrack(
  elements: readonly TimelineElement[],
  changes: readonly MainMagnetChange[],
  enabled: boolean,
  linkage: boolean,
): MainMagnetChange[] {
  const main = mainVisualTrack(elements);
  const rootKeys = new Set(elements.map(element => element.key ?? element.id));
  if (!enabled || !changes.some(change => change.element.track === main && rootKeys.has(change.element.key ?? change.element.id))) return [...changes];
  const byKey = new Map(changes.map(change => [change.element.key ?? change.element.id, change]));
  const lane = elements.filter(el => el.track === main);
  const proposed = (el: TimelineElement) => byKey.get(el.key ?? el.id) ?? { element: el, start: el.start, duration: el.duration };
  lane.sort((a, b) => proposed(a).start - proposed(b).start || a.start - b.start);
  let cursor = Math.max(0, ...lane.map(el => el.parentCompositionStart ?? 0));
  for (const el of lane) {
    const edit = proposed(el);
    const start = Math.round(cursor * 1000) / 1000;
    if (el.timelineLocked && Math.abs(start - el.start) > 1e-6) return [...changes];
    if (start !== el.start || byKey.has(el.key ?? el.id)) byKey.set(el.key ?? el.id, { ...edit, start });
    cursor = start + edit.duration;
  }
  if (linkage) {
    for (const host of lane) {
      const edit = byKey.get(host.key ?? host.id);
      if (!edit || edit.start === host.start) continue;
      const overlayKeys = linkedOverlayKeys(elements, host.key ?? host.id, null, true);
      for (const el of elements) {
        const key = el.key ?? el.id;
        if (el.track === main || byKey.has(key) || !overlayKeys.has(key)) continue;
        byKey.set(key, { element: el, start: el.start + edit.start - host.start, duration: el.duration });
      }
    }
  }
  return [...byKey.values()];
}
