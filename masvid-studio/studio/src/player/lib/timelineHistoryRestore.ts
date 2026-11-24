import { isCompositionTemplate } from "@hyperframes/parsers/hf-ids";
import type { RestoreFiles } from "../../utils/gsapUndoRestore";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { normalizeToZones } from "../components/timelineZones";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { getTimelineElementIdentity, parseTimelineFromDOM, readTimelineDurationFromDocument } from "./timelineDOM";

const IDENTITY_FIELDS = new Set(["id", "key", "hfId", "selector", "selectorIndex", "sourceFile", "track", "authoredTrack"]);

function sourceTimeline(html: string, path: string, fallbackDuration: number) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const template of Array.from(doc.querySelectorAll("template")).filter(isCompositionTemplate)) template.replaceWith(template.content);
  const root = doc.querySelector("[data-composition-id]");
  if (!root) return null;
  root.setAttribute("data-composition-file", path);
  const project = usePlayerStore.getState().timelineProjectId;
  if (project && globalThis.location?.origin) {
    const base = new URL(buildProjectApiPath(project, `/preview/${path}`), location.origin);
    for (const media of doc.querySelectorAll("audio[src],video[src],img[src],source[src]")) {
      const src = media.getAttribute("src");
      if (!src) continue;
      try { media.setAttribute("src", new URL(src, base).href); }
      catch { return null; }
    }
  }
  const duration = readTimelineDurationFromDocument(doc) || fallbackDuration;
  const elements = parseTimelineFromDOM(doc, duration);
  const byKey = new Map(elements.map(element => [getTimelineElementIdentity(element), element]));
  // A dynamic/ambiguous source is left to the real runtime; never guess which duplicate a restore owns.
  return byKey.size === elements.length ? { byKey, duration } : null;
}

function changedFields(current: TimelineElement, before: TimelineElement, after: TimelineElement): TimelineElement {
  let next = current;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]) as Set<keyof TimelineElement>) {
    if (IDENTITY_FIELDS.has(key) || JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    if (next === current) next = { ...current };
    Object.assign(next, { [key]: after[key] });
  }
  if (before.track !== after.track) next = { ...next, authoredTrack: after.track };
  return next;
}

/** Confirmed file history is the timeline's truth, even when a structural edit
 * needs a new preview. Apply only the source delta; preserve runtime metadata,
 * dynamically generated clips and clips owned by other files until rediscovery. */
export function syncHistoryTimelineFromFiles(activePath: string | null, files: RestoreFiles | undefined): boolean {
  const path = activePath ?? "index.html";
  const file = files?.[path];
  if (!file) return false;
  const state = usePlayerStore.getState();
  const before = sourceTimeline(file.previous, path, state.duration);
  const after = sourceTimeline(file.restored, path, state.duration);
  if (!before || !after) return false;
  let changed = false;
  const existing = new Set(state.elements.map(getTimelineElementIdentity));
  const elements = state.elements.flatMap(element => {
    const key = getTimelineElementIdentity(element);
    const previous = before.byKey.get(key);
    if (!previous) return [element];
    const restored = after.byKey.get(key);
    if (!restored) { changed = true; return []; }
    const next = changedFields(element, previous, restored);
    changed ||= next !== element;
    return [next];
  });
  for (const [key, element] of after.byKey) {
    if (!before.byKey.has(key) && !existing.has(key)) { elements.push(element); changed = true; }
  }
  const durationChanged = before.duration !== after.duration && after.duration !== state.duration;
  if (changed || durationChanged) usePlayerStore.setState({
    ...(changed ? { elements: normalizeToZones(elements.map(element => ({ ...element, track: element.authoredTrack ?? element.track }))) } : {}),
    ...(durationChanged ? { duration: after.duration } : {}),
  });
  return changed || durationChanged;
}
