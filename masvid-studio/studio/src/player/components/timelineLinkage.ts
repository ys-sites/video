import type { TimelineElement } from "../store/playerStore";
import { classifyZone } from "./timelineZones";

export function mainVisualTrack(elements: readonly TimelineElement[]): number | null {
  const visual = elements.filter(el => classifyZone(el) === "visual" &&
    el.timelineRole !== 'caption' && el.timelineRole !== 'text' &&
    !/^(?:transcript|text)-[a-f0-9-]{36}-/.test(el.domId || el.id));
  return visual.length ? Math.max(...visual.map(el => el.track)) : null;
}

/** The overlay belongs to the main clip containing its start; the half-open
 * interval avoids moving a title twice at an adjacent scene boundary. */
export function linkedOverlayKeys(
  elements: readonly TimelineElement[],
  draggedKey: string,
  selectedKeys: ReadonlySet<string> | null | undefined,
  enabled: boolean,
): ReadonlySet<string> {
  const keys = new Set(selectedKeys?.has(draggedKey) ? selectedKeys : [draggedKey]);
  if (!enabled) return keys;
  const main = mainVisualTrack(elements);
  const hosts = elements.filter(el => keys.has(el.key ?? el.id) && el.track === main);
  for (const el of elements) {
    if (el.timelineLocked || classifyZone(el) !== "visual" || el.track === main) continue;
    if (hosts.some(host => host.sourceFile === el.sourceFile && el.start >= host.start && el.start < host.start + host.duration))
      keys.add(el.key ?? el.id);
  }
  return keys;
}
