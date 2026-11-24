import type { TimelineElement } from '../../player/store/playerStore';
import { sameCompositionScope } from '../../player/store/timelineElement';
import { mainVisualTrack } from '../../player/components/timelineLinkage';
import { buildPatchTarget } from '../../hooks/timelineEditingHelpers';
import { applyPatchByTarget, readAttributeByTarget, findTagByTarget, type PatchTarget } from '../../utils/sourcePatcher';
import { scanHtmlOpeningTags } from '@hyperframes/parsers';
import { isCompositionTemplate } from '@hyperframes/parsers/hf-ids';
import { parseSavedSource } from '../../utils/authoredSource';
import { rootCompositionDurationOf } from '../../utils/rootDuration';
import { setCompositionDurationToContent } from '../../utils/timelineAssetDrop';
import { furthestClipEndFromDocument } from '../../player/lib/timelineElementHelpers';

type Row = { element: TimelineElement; target: PatchTarget; start: number; duration: number; rate: number; locked: boolean };
type Change = { row: Row; start: number; duration: number; rate?: number };
export interface SpeedTimingPlan { apply: (html: string) => string; limited: boolean }
const key = (el: TimelineElement) => el.key ?? el.id;

/** Inspect composition templates as mounted markup without reserializing the authored source. */
export function parseClipSpeedSource(html: string): Document {
  const doc = parseSavedSource(html);
  const unwrap = (root: ParentNode) => {
    for (const template of Array.from(root.querySelectorAll('template')).filter(isCompositionTemplate)) {
      unwrap(template.content);
      template.replaceWith(template.content);
    }
  };
  unwrap(doc);
  return doc;
}

/** Preserve the selected source range, and plan every timing write before any mutation. */
export function planClipSpeedTiming(
  html: string,
  self: TimelineElement,
  elements: readonly TimelineElement[],
  memberKeys: ReadonlySet<string>,
  rate: number,
  ripple: boolean,
  linkage: boolean,
): SpeedTimingPlan {
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Speed must be greater than zero');
  const scoped = elements.filter(el => sameCompositionScope(el, self));
  const selected = scoped.filter(el => memberKeys.has(key(el)));
  const main = mainVisualTrack(scoped);
  const ripplesMain = ripple && selected.some(el => el.tag !== 'audio' && el.track === main);
  const rows: Row[] = scoped.flatMap(element => {
    // Untimed root text spans the composition implicitly and never moves with media edits.
    if (element.implicitTextTiming) return [];
    const target = buildPatchTarget(element);
    if (!target) return [];
    const attr = (name: string) => readAttributeByTarget(html, target, `data-${name}`);
    const rawStart = attr('start'), rawDuration = attr('duration');
    // Unrelated runtime-derived rows need no authored window. Members and any
    // lane that can collide or move must still be resolved before saving.
    if (rawStart === undefined || rawDuration === undefined) {
      const needed = memberKeys.has(key(element)) || selected.some(el =>
        el.track === element.track && (el.tag === 'audio') === (element.tag === 'audio')) ||
        (ripplesMain && element.tag !== 'audio' && (element.track === main || linkage));
      if (!needed) return [];
      throw new Error('Clip timing changed or is unavailable. Reload the composition and try again');
    }
    const start = Number(rawStart), duration = Number(rawDuration), oldRate = Number(attr('playback-rate') ?? 1);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || !Number.isFinite(oldRate) || oldRate <= 0)
      throw new Error('Clip timing is invalid');
    return [{ element, target, start, duration, rate: oldRate,
      locked: element.timelineLocked === true || scanHtmlOpeningTags(findTagByTarget(html, target)?.tag ?? '')[0]
        ?.attributes.some(attribute => attribute.name === 'data-timeline-locked') === true }];
  });
  const members = rows.filter(row => memberKeys.has(key(row.element)));
  if (!members.length || members.some(row => row.element.tag !== 'video' && row.element.tag !== 'audio'))
    throw new Error('Select a video or audio clip with editable timing');
  const changes = new Map<string, Change>();
  let limited = false;
  let rangeScale = 1;
  for (const row of members) {
    if (row.locked) throw new Error('Unlock linked clips before changing speed');
    const requestedDuration = row.duration * row.rate / rate;
    let duration = requestedDuration;
    if (!(ripple && row.element.tag !== 'audio' && row.element.track === main)) {
      const next = rows.filter(other => !memberKeys.has(key(other.element)) &&
        other.element.track === row.element.track && (other.element.tag === 'audio') === (row.element.tag === 'audio') &&
        other.start >= row.start + row.duration - 1e-6);
      const boundary = Math.min(Infinity, ...next.map(other => other.start));
      if (row.start + duration > boundary + 1e-6) {
        if (next.some(other => other.locked && other.start < row.start + duration))
          throw new Error('Speed change would overlap a locked clip');
        duration = boundary - row.start;
        rangeScale = Math.min(rangeScale, duration / requestedDuration);
        limited = true;
      }
    }
    changes.set(key(row.element), { row, start: row.start, duration, rate });
  }
  // A gap restriction must not trim only one half of an aligned audio/video pair.
  if (limited) for (const change of changes.values())
    change.duration = change.row.duration * change.row.rate / rate * rangeScale;
  const mainEdits = [...changes.values()].filter(change => ripple &&
    change.row.element.tag !== 'audio' && change.row.element.track === main);
  for (const row of rows) {
    if (changes.has(key(row.element)) || row.element.tag === 'audio' || row.element.track !== main) continue;
    const delta = mainEdits.filter(change => change.row.start + change.row.duration <= row.start + 1e-6)
      .reduce((sum, change) => sum + change.duration - change.row.duration, 0);
    if (Math.abs(delta) < 1e-6) continue;
    if (row.locked) throw new Error('Speed change would move a locked clip');
    changes.set(key(row.element), { row, start: row.start + delta, duration: row.duration });
    if (!linkage) continue;
    for (const overlay of rows) {
      if (overlay.element.track === main || overlay.element.tag === 'audio' ||
        overlay.locked || changes.has(key(overlay.element))) continue;
      if (overlay.start >= row.start && overlay.start < row.start + row.duration)
        changes.set(key(overlay.element), { row: overlay, start: overlay.start + delta, duration: overlay.duration });
    }
  }
  return { limited, apply: source => {
    for (const change of changes.values()) {
      for (const [property, value] of Object.entries({ start: change.start, duration: change.duration, 'playback-rate': change.rate })) {
        if (value === undefined) continue;
        source = applyPatchByTarget(source, change.row.target, {
          type: 'attribute', property, value: String(Math.round(value * 1e6) / 1e6),
        });
      }
    }
    // Other composition scopes and authored clips outside the visible lane list still count.
    const doc = parseClipSpeedSource(source);
    const end = furthestClipEndFromDocument(doc);
    return setCompositionDurationToContent(source, end, rootCompositionDurationOf(doc));
  } };
}
