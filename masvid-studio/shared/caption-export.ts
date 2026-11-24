import type { parseHTML } from 'linkedom';
import { exportSubtitleSegments, type TranscriptSegment } from './transcript.ts';

/** Read saved native cues, including edits and splits; never use cached ASR text. */
export function exportCaptionSource(html: string, format: 'srt' | 'vtt', parse: typeof parseHTML, trackId?: string) {
  if (format !== 'srt' && format !== 'vtt') throw new Error('Choose SRT or VTT');
  const { document } = parse(html);
  const root = document.querySelector('[data-composition-id]');
  if (!root) throw new Error('Choose a native composition');
  const duration = Number(root.getAttribute('data-duration'));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Composition requires an explicit duration');
  const identity = (node: Element) => node.getAttribute('data-caption-track') || node.id.match(/^(?:transcript|text)-([a-f0-9-]{36})-/)?.[1];
  const selected = [...root.querySelectorAll('[data-caption-track], [id^=transcript-], [id^=text-]')].filter(node => identity(node) && (trackId
    ? identity(node) === trackId
    : node.getAttribute('data-timeline-role') !== 'text' && !node.id.startsWith('text-')));
  if (trackId && !selected.length) throw new Error('Caption track no longer exists');
  const cues: Array<TranscriptSegment & { start: number; end: number; track: string }> = [];
  for (const node of selected) {
    if (node.closest('[data-hidden]')) continue;
    // Managed cues are authored on the composition timeline. Nested independent
    // scenes are exported through their own composition, not guessed offsets.
    if (node.parentElement !== root && node.parentElement?.closest('[data-duration], [data-composition-src]') !== root) throw new Error('Export nested captions from their own composition');
    const startValue = node.getAttribute('data-start'), lengthValue = node.getAttribute('data-duration');
    const start = Number(startValue), length = Number(lengthValue), end = Math.min(duration, start + length);
    if (startValue === null || lengthValue === null || !Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0) throw new Error('Caption timing is invalid; check the timeline');
    if (end <= start) continue;
    const content = node.cloneNode(true) as Element;
    for (const child of content.querySelectorAll('script, style, [data-hidden]')) child.remove();
    for (const br of content.querySelectorAll('br')) br.replaceWith(document.createTextNode('\n'));
    const text = (content.textContent || '').trim();
    if (text) cues.push({ id: `cue-${cues.length + 1}`, text, start, end, track: identity(node)! });
  }
  cues.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: typeof cues = [];
  const lastByTrack = new Map<string, (typeof cues)[number]>();
  for (const cue of cues) {
    const previous = lastByTrack.get(cue.track);
    // Word-highlight fragments repeat a sentence. Coalesce only adjacent cues
    // on the same track; pauses, different text and overlapping tracks survive independently.
    if (previous && previous.track === cue.track && previous.text === cue.text && Math.abs(previous.end - cue.start) < 0.001) previous.end = cue.end;
    else { const next = { ...cue }; merged.push(next); lastByTrack.set(cue.track, next); }
  }
  if (!merged.length) throw new Error('No visible captions to export');
  return { ...exportSubtitleSegments(merged, format), cueCount: merged.length };
}
