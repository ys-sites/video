/** Transcript data is source-relative seconds, independent of composition edits. */
export type TranscriptWord = { text: string; start: number; end: number };
export type TranscriptSegment = { id: string; text: string; start?: number; end?: number; speaker?: string; words?: TranscriptWord[] };
export type TranscriptSource = { projectId: string; path: string; sha256: string; bytes: number; duration: number };
export type TranscriptDocument = {
  id: string; source: TranscriptSource; revision: number; createdAt: number; updatedAt: number;
  model?: string; language?: string; segments: TranscriptSegment[]; original: TranscriptSegment[];
};
export type TranscriptionJob = {
  id: string; requestId: string; requestHash: string; projectId: string; source: TranscriptSource;
  model: string; provider: string; providerRevision?: string; baseUrl: string;
  parameters: Record<string, unknown>; language?: string;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'; phase: string;
  createdAt: number; updatedAt: number; workerPid?: number; completedChunks: number; totalChunks: number;
  transcriptId?: string; error?: string;
};
export type TranscriptFormat = 'txt' | 'srt' | 'vtt' | 'json';
export type TranscriptPlacement = { timelineStart: number; sourceStart: number; sourceEnd: number; playbackRate: number };
export const transcriptFormats: TranscriptFormat[] = ['txt', 'srt', 'vtt', 'json'];
export const timedSegment = (s: TranscriptSegment): s is TranscriptSegment & { start: number; end: number } =>
  Number.isFinite(s.start) && Number.isFinite(s.end) && s.start! >= 0 && s.end! > s.start!;

export function validateSegments(input: unknown): TranscriptSegment[] {
  if (!Array.isArray(input) || input.length > 20_000) throw new Error('Transcript must contain at most 20000 segments');
  const ids = new Set<string>(); let characters = 0;
  return input.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || typeof raw.text !== 'string' || !raw.text.trim() || raw.text.length > 20_000
      || (characters += raw.text.length) > 2_000_000) throw new Error('Invalid transcript text');
    const id = raw.id ?? `segment-${index + 1}`;
    if (typeof id !== 'string' || !/^[\w-]{1,100}$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate transcript segment ID');
    ids.add(id);
    const result: TranscriptSegment = { id, text: raw.text.trim() };
    if (raw.start !== undefined || raw.end !== undefined) {
      if (!timedSegment(raw) || raw.end > 86400) throw new Error('Invalid transcript timestamps');
      result.start = raw.start; result.end = raw.end;
    }
    if (raw.speaker !== undefined) {
      if (typeof raw.speaker !== 'string' || raw.speaker.length > 100) throw new Error('Invalid speaker name');
      if (raw.speaker.trim()) result.speaker = raw.speaker.trim();
    }
    if (raw.words !== undefined) {
      if (!timedSegment(result) || !Array.isArray(raw.words) || raw.words.length > 5000) throw new Error('Invalid transcript words');
      result.words = raw.words.map((w: TranscriptWord) => {
        if (!w || typeof w.text !== 'string' || !w.text.trim() || w.text.length > 1000 || !timedSegment(w as TranscriptSegment)
          || w.start < result.start! - 0.001 || w.end > result.end! + 0.001) throw new Error('Invalid word timestamps');
        return { text: w.text, start: w.start, end: w.end };
      });
    }
    return result;
  });
}

/** Do not synthesize word timestamps when the provider only supplies text or segments. */
export function normalizeTranscript(body: any, offset = 0, duration = 86400): TranscriptSegment[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Provider returned an invalid transcript');
  const stamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= duration + 1 ? Math.min(value, duration) + offset : undefined;
  const words: TranscriptWord[] = Array.isArray(body.words) ? body.words.map((word: any) => ({ text: word.word ?? word.text, start: stamp(word.start), end: stamp(word.end) })) : [];
  const rows: TranscriptSegment[] = [];
  if (Array.isArray(body.segments) && body.segments.length) {
    for (const segment of body.segments) {
      if (typeof segment.text !== 'string' || !segment.text.trim()) continue;
      const start = stamp(segment.start), end = stamp(segment.end);
      if (start === undefined || end === undefined || end <= start) throw new Error('Provider returned invalid segment timestamps');
      rows.push({ id: `segment-${rows.length + 1}`, text: segment.text, start, end,
        ...(segment.speaker != null ? { speaker: String(segment.speaker) } : {}),
        ...(words.length ? { words: words.filter(word => word.start >= start && word.end <= end) } : {}) });
    }
  } else if (words.length) {
    let group: TranscriptWord[] = [];
    const flush = () => { if (group.length) rows.push({ id: `segment-${rows.length + 1}`, text: group.map(word => word.text).join(' ').replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1'), start: group[0].start, end: group.at(-1)!.end, words: group }); group = []; };
    for (const word of words) { if (group.length && (word.start - group.at(-1)!.end > 0.8 || group.length >= 12)) flush(); group.push(word); if (/[.!?。！？]$/.test(word.text)) flush(); }
    flush();
  } else if (typeof body.text === 'string' && body.text.trim()) rows.push({ id: 'segment-1', text: body.text });
  else if (body.text !== '' && !Array.isArray(body.segments)) throw new Error('Provider returned no transcript field');
  return validateSegments(rows);
}

export function transcriptText(segments: TranscriptSegment[]) {
  return segments.map(segment => `${segment.speaker ? segment.speaker + ': ' : ''}${segment.text}`).join('\n');
}
export function transcriptTimestamp(seconds: number, separator = ',') {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}${separator}${String(ms % 1000).padStart(3, '0')}`;
}
/** The same source-to-composition clock is used by native captions and sidecar subtitles. */
export function placeTranscriptSegments(doc: TranscriptDocument, placement: TranscriptPlacement): TranscriptSegment[] {
  const { sourceStart, sourceEnd, timelineStart, playbackRate } = placement;
  if (![sourceStart, sourceEnd, timelineStart, playbackRate].every(Number.isFinite) || sourceStart < 0 || sourceEnd > doc.source.duration + 0.1 || sourceEnd <= sourceStart || timelineStart < 0 || playbackRate < 0.1 || playbackRate > 8) throw new Error('Invalid caption placement');
  if (!doc.segments.length || doc.segments.some(s => !timedSegment(s))) throw new Error('Captions require real timestamps. Add timings or use a timestamp-capable model.');
  const map = (time: number) => timelineStart + (time - sourceStart) / playbackRate;
  const cues = doc.segments.filter(timedSegment).flatMap(segment => {
    const from = Math.max(sourceStart, segment.start), to = Math.min(sourceEnd, segment.end);
    if (to <= from) return [];
    return [{ ...segment, start: map(from), end: map(to), words: segment.words?.flatMap(word => {
      const start = Math.max(from, word.start), end = Math.min(to, word.end);
      return end > start ? [{ ...word, start: map(start), end: map(end) }] : [];
    }) }];
  });
  if (!cues.length) throw new Error('No transcript cues overlap this source range');
  return cues;
}

export function exportTranscript(document: TranscriptDocument, format: TranscriptFormat, placement?: TranscriptPlacement): { content: string; mimeType: string; extension: string } {
  if (!transcriptFormats.includes(format)) throw new Error('Unsupported transcript export format');
  if (placement && !['srt', 'vtt'].includes(format)) throw new Error('Caption placement applies to SRT or VTT exports');
  const segments = validateSegments(placement ? placeTranscriptSegments(document, placement) : document.segments);
  if (format === 'json') return { content: JSON.stringify(document, null, 2), mimeType: 'application/json', extension: 'json' };
  if (format === 'txt') return { content: transcriptText(segments) + '\n', mimeType: 'text/plain', extension: 'txt' };
  if (segments.some(segment => !timedSegment(segment))) throw new Error('This model returned text without timestamps. Use a timestamp-capable model or add timings before exporting subtitles.');
  return exportSubtitleSegments(segments, format);
}

/** Shared serializer for reviewed transcripts and saved timeline captions. */
export function exportSubtitleSegments(segments: TranscriptSegment[], format: 'srt' | 'vtt') {
  if (format !== 'srt' && format !== 'vtt') throw new Error('Choose SRT or VTT');
  const separator = format === 'vtt' ? '.' : ',';
  // WebVTT cue text is markup: a bare "<" opens a tag and "&" a character reference. SRT is plain text.
  const cueText = (text: string) => format === 'vtt' ? text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : text;
  const cues = segments.map((s, index) => `${index + 1}\n${transcriptTimestamp(s.start!, separator)} --> ${transcriptTimestamp(s.end!, separator)}\n${cueText(s.text.replace(/\r?\n\s*\r?\n/g, '\n'))}`);
  return { content: (format === 'vtt' ? 'WEBVTT\n\n' : '') + cues.join('\n\n') + '\n', mimeType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip', extension: format };
}

export function parseTranscriptSubtitles(text: string): TranscriptSegment[] {
  if (typeof text !== 'string' || text.length > 2_000_000) throw new Error('Subtitle file exceeds 2 MB');
  const time = (s: string) => { const parts = s.replace(',', '.').split(':').map(Number); const seconds = parts.pop()!, minutes = parts.pop()!, hours = parts.pop() ?? 0; if (minutes >= 60 || seconds >= 60) throw new Error('Invalid subtitle timestamp'); return hours * 3600 + minutes * 60 + seconds; };
  // Read back the references a WebVTT export writes; one pass, so "&amp;lt;" stays the text "&lt;".
  // Cue span tags (<v Name>, <i>, <c.loud>, <00:01.500>) are markup, not speech, so they go before the references are read.
  // Only the tags WebVTT defines are taken; any other "<" stays text, as in "a < b and c > d".
  // A tag's classes or annotation stop at the next "<", so an unclosed "<b " is not rescanned to the end of the cue from every later one.
  const references: Record<string, string> = { amp: '&', lt: '<', gt: '>' };
  const cueTag = /<\/?(?:c|i|b|u|ruby|rt|v|lang)(?:[.\s][^<>]*)?>|<(?:\d{2,}:)?\d{2}:\d{2}\.\d{3}>/g;
  const cueText = /^\uFEFF?WEBVTT/.test(text) ? (value: string) => value.replace(cueTag, '').replace(/&(amp|lt|gt);/g, (_, name: string) => references[name]) : (value: string) => value;
  const rows = text.replace(/^\uFEFF/, '').replace(/\r/g, '').split(/\n\s*\n/).flatMap(block => {
    const match = block.match(/(?:^|\n)((?:\d{2,}:)?\d{2}:\d{2}[,.]\d{3})\s+-->\s+((?:\d{2,}:)?\d{2}:\d{2}[,.]\d{3})[^\n]*\n([\s\S]+)/);
    if (!match && block.includes('-->')) throw new Error('Invalid subtitle cue');
    if (!match) return [];
    const raw = match[3].trim(), spoken = cueText(raw).trim();
    // A cue that held nothing but tags has no speech to caption; an empty cue is still malformed.
    return raw && !spoken ? [] : [{ start: time(match[1]), end: time(match[2]), text: spoken }];
  });
  if (!rows.length) throw new Error('No valid subtitle cues were found');
  return validateSegments(rows);
}
