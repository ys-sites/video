// One project model drives the preview, the transcript, the AI edits and the MP4 export.
// Times: "source" = seconds in the uploaded clip; "output" = seconds in the edited video.

export type Word = { w: string; s: number; e: number };
export type Range = { s: number; e: number };
export type Aspect = '9:16' | '1:1' | '16:9';
export type CaptionStyle = 'pop' | 'bold' | 'karaoke' | 'editorial' | 'minimal';
export type LookPreset = 'none' | 'clean' | 'warm' | 'cinematic' | 'bw' | 'vivid';
export type Overlay = { id: string; kind: 'title' | 'cta' | 'text'; text: string; start: number; dur: number };
export type Zoom = { id: string; at: number; dur: number; scale: number };

export type Project = {
  version: 1;
  title: string;
  aspect: Aspect;
  fit: 'crop' | 'blur';
  duration: number;            // source duration
  keep: Range[];               // kept source ranges, sorted, non-overlapping
  words: Word[];               // transcript (source times)
  captions: { on: boolean; style: CaptionStyle; accent: string; size: number; position: 'low' | 'mid' | 'high' };
  overlays: Overlay[];         // output times
  zooms: Zoom[];               // output times
  look: LookPreset;
  music: { name: string; volume: number; duck: boolean } | null;
  voice: number;               // 0..1.5
  styleId: string | null;
};

export const LOOKS: Record<LookPreset, { label: string; filter: string }> = {
  none: { label: 'Original', filter: 'none' },
  clean: { label: 'Clean', filter: 'brightness(1.04) contrast(1.06) saturate(1.05)' },
  warm: { label: 'Warm', filter: 'brightness(1.03) contrast(1.05) saturate(1.12) sepia(0.12)' },
  cinematic: { label: 'Cinematic', filter: 'brightness(0.96) contrast(1.14) saturate(0.88)' },
  bw: { label: 'Black & white', filter: 'grayscale(1) contrast(1.15)' },
  vivid: { label: 'Vivid', filter: 'contrast(1.08) saturate(1.35)' },
};

export const CAPTION_STYLES: Record<CaptionStyle, string> = {
  pop: 'Pop sticker',
  bold: 'Bold white',
  karaoke: 'Karaoke',
  editorial: 'Editorial',
  minimal: 'Minimal',
};

let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(++seq).toString(36)}`;

export function emptyProject(duration = 0, title = 'Untitled edit'): Project {
  return {
    version: 1, title, aspect: '9:16', fit: 'crop', duration,
    keep: duration > 0 ? [{ s: 0, e: duration }] : [], words: [],
    captions: { on: false, style: 'pop', accent: '#c5f04a', size: 1, position: 'low' },
    overlays: [], zooms: [], look: 'none', music: null, voice: 1, styleId: null,
  };
}

// ---------- time mapping ----------
export function normalize(ranges: Range[], duration: number): Range[] {
  const out: Range[] = [];
  for (const r of [...ranges].map(r => ({ s: Math.max(0, r.s), e: Math.min(duration, r.e) })).filter(r => r.e - r.s > 0.04).sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && r.s <= last.e + 0.01) last.e = Math.max(last.e, r.e);
    else out.push({ ...r });
  }
  return out;
}
export const outputDuration = (keep: Range[]) => keep.reduce((n, r) => n + (r.e - r.s), 0);

/** Output seconds -> source seconds. */
export function toSource(keep: Range[], t: number): number {
  let acc = 0;
  for (const r of keep) {
    const len = r.e - r.s;
    if (t < acc + len) return r.s + (t - acc);
    acc += len;
  }
  const last = keep[keep.length - 1];
  return last ? last.e : 0;
}
/** Source seconds -> output seconds, or null when that moment was cut. */
export function toOutput(keep: Range[], s: number): number | null {
  let acc = 0;
  for (const r of keep) {
    if (s >= r.s && s < r.e) return acc + (s - r.s);
    acc += r.e - r.s;
  }
  return null;
}
/** Remove a source range from the kept ranges. */
export function cutRange(keep: Range[], s: number, e: number): Range[] {
  return keep.flatMap(r => {
    if (e <= r.s || s >= r.e) return [r];
    const parts: Range[] = [];
    if (s > r.s) parts.push({ s: r.s, e: s });
    if (e < r.e) parts.push({ s: e, e: r.e });
    return parts;
  }).filter(r => r.e - r.s > 0.04);
}
export const wordKept = (keep: Range[], w: Word) => toOutput(keep, (w.s + w.e) / 2) !== null;

/** Words that survive the cut, with output times. */
export function outputWords(p: Project): (Word & { i: number; os: number; oe: number })[] {
  const out: (Word & { i: number; os: number; oe: number })[] = [];
  p.words.forEach((w, i) => {
    const os = toOutput(p.keep, Math.min(w.e - 0.01, w.s + 0.01));
    if (os === null) return;
    out.push({ ...w, i, os, oe: os + Math.max(0.08, w.e - w.s) });
  });
  return out;
}

/** Export size: 1080 on the short side (scale 0.5 for a fast 540p draft). */
export function aspectSize(aspect: Aspect, scale = 1): { w: number; h: number } {
  const even = (n: number) => Math.round(n * scale / 2) * 2;
  if (aspect === '9:16') return { w: even(1080), h: even(1920) };
  if (aspect === '1:1') return { w: even(1080), h: even(1080) };
  return { w: even(1920), h: even(1080) };
}

/** Defensive parse of a saved project (files and cloud saves are untrusted). */
export function parseProject(raw: unknown): Project | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, any>;
  if (d.version !== 1 || typeof d.duration !== 'number') return null;
  const base = emptyProject(Math.max(0, Math.min(36000, d.duration)), String(d.title ?? 'Untitled edit').slice(0, 120));
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
  const ranges = (Array.isArray(d.keep) ? d.keep : []).slice(0, 5000).map((r: any) => ({ s: num(r?.s, 0, base.duration, 0), e: num(r?.e, 0, base.duration, 0) }));
  base.keep = normalize(ranges, base.duration);
  base.words = (Array.isArray(d.words) ? d.words : []).slice(0, 50000)
    .map((w: any) => ({ w: String(w?.w ?? '').slice(0, 40), s: num(w?.s, 0, base.duration, 0), e: num(w?.e, 0, base.duration, 0) }))
    .filter((w: Word) => w.w && w.e >= w.s);
  if (['9:16', '1:1', '16:9'].includes(d.aspect)) base.aspect = d.aspect;
  if (d.fit === 'blur') base.fit = 'blur';
  const c = d.captions ?? {};
  base.captions = {
    on: Boolean(c.on), style: (c.style in CAPTION_STYLES ? c.style : 'pop') as CaptionStyle,
    accent: /^#[0-9a-f]{6}$/i.test(c.accent) ? c.accent : '#c5f04a', size: num(c.size, 0.6, 1.8, 1),
    position: ['low', 'mid', 'high'].includes(c.position) ? c.position : 'low',
  };
  base.overlays = (Array.isArray(d.overlays) ? d.overlays : []).slice(0, 50).map((o: any) => ({
    id: newId('o'), kind: ['title', 'cta', 'text'].includes(o?.kind) ? o.kind : 'text', text: String(o?.text ?? '').slice(0, 120),
    start: num(o?.start, 0, 36000, 0), dur: num(o?.dur, 0.3, 60, 2.5),
  })).filter((o: Overlay) => o.text);
  base.zooms = (Array.isArray(d.zooms) ? d.zooms : []).slice(0, 200).map((z: any) => ({ id: newId('z'), at: num(z?.at, 0, 36000, 0), dur: num(z?.dur, 0.3, 10, 1.2), scale: num(z?.scale, 1, 1.6, 1.15) }));
  base.look = (d.look in LOOKS ? d.look : 'none') as LookPreset;
  base.music = d.music && typeof d.music === 'object' ? { name: String(d.music.name ?? 'music').slice(0, 80), volume: num(d.music.volume, 0, 1, 0.25), duck: d.music.duck !== false } : null;
  base.voice = num(d.voice, 0, 1.5, 1);
  base.styleId = typeof d.styleId === 'string' ? d.styleId.slice(0, 80) : null;
  return base;
}
