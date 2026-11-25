// AI edits as a small, safe list of operations applied to the project.
// Backends, in order: Claude via Masvid Studio on this PC (if running), then the built-in planner.
import { CAPTION_STYLES, LOOKS, cutRange, newId, normalize, outputDuration, outputWords, toOutput, type Aspect, type CaptionStyle, type LookPreset, type Project } from './project';

export type Op =
  | { op: 'remove_fillers' }
  | { op: 'remove_silence'; min?: number }
  | { op: 'cut'; from: number; to: number }
  | { op: 'keep_only'; from: number; to: number }
  | { op: 'restore_all' }
  | { op: 'captions'; on?: boolean; style?: CaptionStyle; accent?: string; size?: number; position?: 'low' | 'mid' | 'high' }
  | { op: 'zoom'; word: number; scale?: number; dur?: number }
  | { op: 'zoom_keywords'; count?: number }
  | { op: 'title'; text: string; dur?: number }
  | { op: 'cta'; text: string; dur?: number }
  | { op: 'text'; text: string; word: number; dur?: number }
  | { op: 'aspect'; value: Aspect; fit?: 'crop' | 'blur' }
  | { op: 'look'; preset: LookPreset }
  | { op: 'music'; volume?: number; duck?: boolean }
  | { op: 'clear'; what: 'zooms' | 'overlays' | 'captions' };

export type Plan = { reply: string; ops: Op[]; by: 'claude' | 'built-in' };

const FILLERS = /^(um+|uh+|erm+|er|ah+|hmm+|mm+|uhm+)[.,!?]*$/i;
const clampI = (n: unknown, max: number) => Math.max(0, Math.min(max, Math.round(Number(n) || 0)));
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** Validate untrusted ops (from any model) before they touch the project. */
export function sanitizeOps(raw: unknown, wordCount: number): Op[] {
  const out: Op[] = [];
  const max = Math.max(0, wordCount - 1);
  for (const o of (Array.isArray(raw) ? raw : []).slice(0, 60)) {
    if (!o || typeof o !== 'object') continue;
    const d = o as Record<string, any>;
    const text = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 90);
    switch (d.op) {
      case 'remove_fillers': case 'restore_all': out.push({ op: d.op }); break;
      case 'remove_silence': out.push({ op: 'remove_silence', min: num(d.min, 0.25, 3, 0.6) }); break;
      case 'cut': case 'keep_only': if (wordCount) out.push({ op: d.op, from: clampI(d.from, max), to: clampI(d.to, max) }); break;
      case 'captions': out.push({ op: 'captions', on: d.on !== false, style: d.style in CAPTION_STYLES ? d.style : undefined,
        accent: /^#[0-9a-f]{6}$/i.test(d.accent) ? d.accent : undefined, size: d.size === undefined ? undefined : num(d.size, 0.6, 1.8, 1),
        position: ['low', 'mid', 'high'].includes(d.position) ? d.position : undefined }); break;
      case 'zoom': if (wordCount) out.push({ op: 'zoom', word: clampI(d.word, max), scale: num(d.scale, 1.03, 1.5, 1.15), dur: num(d.dur, 0.4, 6, 1.2) }); break;
      case 'zoom_keywords': out.push({ op: 'zoom_keywords', count: clampI(d.count ?? 4, 20) || 4 }); break;
      case 'title': case 'cta': if (text(d.text)) out.push({ op: d.op, text: text(d.text), dur: num(d.dur, 0.8, 10, d.op === 'title' ? 2.5 : 3) }); break;
      case 'text': if (text(d.text) && wordCount) out.push({ op: 'text', text: text(d.text), word: clampI(d.word, max), dur: num(d.dur, 0.6, 8, 2) }); break;
      case 'aspect': if (['9:16', '1:1', '16:9'].includes(d.value)) out.push({ op: 'aspect', value: d.value, fit: d.fit === 'blur' ? 'blur' : d.fit === 'crop' ? 'crop' : undefined }); break;
      case 'look': if (d.preset in LOOKS) out.push({ op: 'look', preset: d.preset }); break;
      case 'music': out.push({ op: 'music', volume: d.volume === undefined ? undefined : num(d.volume, 0, 1, 0.25), duck: d.duck === undefined ? undefined : Boolean(d.duck) }); break;
      case 'clear': if (['zooms', 'overlays', 'captions'].includes(d.what)) out.push({ op: 'clear', what: d.what }); break;
    }
  }
  return out;
}

/** Apply ops in order. Returns the new project and one plain-language line per change. */
export function applyOps(p0: Project, ops: Op[]): { project: Project; steps: string[] } {
  let p: Project = structuredClone(p0);
  const steps: string[] = [];
  const W = p.words;
  for (const o of ops) {
    switch (o.op) {
      case 'restore_all': p.keep = [{ s: 0, e: p.duration }]; steps.push('Restored every cut.'); break;
      case 'remove_fillers': {
        const hits = W.filter(w => FILLERS.test(w.w));
        for (const w of hits) p.keep = cutRange(p.keep, w.s - 0.02, w.e + 0.02);
        steps.push(hits.length ? `Removed ${hits.length} filler word${hits.length > 1 ? 's' : ''} (um, uh).` : 'No filler words found.');
        break;
      }
      case 'remove_silence': {
        const min = o.min ?? 0.6;
        let cut = 0, removed = 0;
        const kept = W.filter(w => toOutput(p.keep, (w.s + w.e) / 2) !== null);
        const pad = 0.12;
        if (kept.length) {
          if (kept[0].s - pad > 0.05) { p.keep = cutRange(p.keep, 0, kept[0].s - pad); removed += kept[0].s - pad; cut++; }
          for (let i = 1; i < kept.length; i++) {
            const gap = kept[i].s - kept[i - 1].e;
            if (gap > min) { p.keep = cutRange(p.keep, kept[i - 1].e + pad, kept[i].s - pad); removed += gap - 2 * pad; cut++; }
          }
          const end = kept[kept.length - 1].e + pad;
          if (p.duration - end > 0.05) { p.keep = cutRange(p.keep, end, p.duration); removed += p.duration - end; cut++; }
        }
        steps.push(cut ? `Cut ${cut} pause${cut > 1 ? 's' : ''} (${removed.toFixed(1)} s of dead air).` : 'No long pauses found.');
        break;
      }
      case 'cut': {
        const [a, b] = [Math.min(o.from, o.to), Math.max(o.from, o.to)];
        if (!W[a] || !W[b]) break;
        p.keep = cutRange(p.keep, W[a].s - 0.03, W[b].e + 0.03);
        steps.push(`Cut "${W.slice(a, b + 1).map(w => w.w).join(' ').slice(0, 60)}".`);
        break;
      }
      case 'keep_only': {
        const [a, b] = [Math.min(o.from, o.to), Math.max(o.from, o.to)];
        if (!W[a] || !W[b]) break;
        p.keep = normalize(p.keep.map(r => ({ s: Math.max(r.s, W[a].s - 0.1), e: Math.min(r.e, W[b].e + 0.25) })), p.duration);
        steps.push(`Kept only the part from "${W[a].w}" to "${W[b].w}" (${outputDuration(p.keep).toFixed(1)} s).`);
        break;
      }
      case 'captions': {
        p.captions = { ...p.captions, on: o.on ?? true, ...(o.style ? { style: o.style } : {}), ...(o.accent ? { accent: o.accent } : {}),
          ...(o.size ? { size: o.size } : {}), ...(o.position ? { position: o.position } : {}) };
        steps.push(p.captions.on ? `Captions on: ${CAPTION_STYLES[p.captions.style]}${o.accent ? `, accent ${o.accent}` : ''}.` : 'Captions off.');
        break;
      }
      case 'zoom': {
        const w = W[o.word];
        const at = w ? toOutput(p.keep, w.s + 0.01) : null;
        if (at === null) break;
        p.zooms.push({ id: newId('z'), at: Math.max(0, at - 0.1), dur: o.dur ?? 1.2, scale: o.scale ?? 1.15 });
        steps.push(`Zoom in on "${w.w}".`);
        break;
      }
      case 'zoom_keywords': {
        const ow = outputWords(p);
        const score = (w: string) => (/\d/.test(w) ? 10 : 0) + (/[!?]$/.test(w) ? 3 : 0) + Math.min(8, w.replace(/\W/g, '').length);
        const picks = [...ow].sort((a, b) => score(b.w) - score(a.w));
        const chosen: typeof ow = [];
        for (const w of picks) {
          if (chosen.length >= (o.count ?? 4)) break;
          if (chosen.every(c => Math.abs(c.os - w.os) > 3)) chosen.push(w);
        }
        for (const w of chosen) p.zooms.push({ id: newId('z'), at: Math.max(0, w.os - 0.1), dur: 1.2, scale: 1.14 });
        steps.push(chosen.length ? `Punch-in zooms on ${chosen.map(w => `"${w.w.replace(/[.,!?]/g, '')}"`).join(', ')}.` : 'Need a transcript to place zooms.');
        break;
      }
      case 'title':
        p.overlays = p.overlays.filter(x => x.kind !== 'title');
        p.overlays.push({ id: newId('o'), kind: 'title', text: o.text, start: 0, dur: o.dur ?? 2.5 });
        steps.push(`Title card: "${o.text}".`);
        break;
      case 'cta': {
        const total = outputDuration(p.keep);
        const dur = o.dur ?? 3;
        p.overlays = p.overlays.filter(x => x.kind !== 'cta');
        p.overlays.push({ id: newId('o'), kind: 'cta', text: o.text, start: Math.max(0, total - dur), dur });
        steps.push(`Call to action at the end: "${o.text}".`);
        break;
      }
      case 'text': {
        const w = W[o.word];
        const at = w ? toOutput(p.keep, w.s + 0.01) : null;
        if (at === null) break;
        p.overlays.push({ id: newId('o'), kind: 'text', text: o.text, start: at, dur: o.dur ?? 2 });
        steps.push(`On-screen text "${o.text}" at "${w.w}".`);
        break;
      }
      case 'aspect': p.aspect = o.value; if (o.fit) p.fit = o.fit; steps.push(`Format ${o.value}${o.fit === 'blur' ? ' with a blurred fill' : ''}.`); break;
      case 'look': p.look = o.preset; steps.push(`Look: ${LOOKS[o.preset].label}.`); break;
      case 'music':
        if (!p.music) { steps.push('Add a music file in Style first, then ask again.'); break; }
        p.music = { ...p.music, ...(o.volume !== undefined ? { volume: o.volume } : {}), ...(o.duck !== undefined ? { duck: o.duck } : {}) };
        steps.push(`Music at ${Math.round(p.music.volume * 100)}%${p.music.duck ? ', lowered under your voice' : ''}.`);
        break;
      case 'clear':
        if (o.what === 'zooms') p.zooms = [];
        if (o.what === 'overlays') p.overlays = [];
        if (o.what === 'captions') p.captions = { ...p.captions, on: false };
        steps.push(`Removed all ${o.what}.`);
        break;
    }
  }
  p.keep = normalize(p.keep, p.duration);
  // Keep the call to action pinned to the (possibly new) end.
  const total = outputDuration(p.keep);
  p.overlays = p.overlays.map(x => (x.kind === 'cta' ? { ...x, start: Math.max(0, total - x.dur) } : x)).filter(x => x.start < total);
  p.zooms = p.zooms.filter(z => z.at < total);
  return { project: p, steps };
}

const has = (t: string, words: string[]) => words.some(w => t.includes(w));

/** Offline planner for common requests; used when Claude is not available. */
export function builtInPlan(prompt: string, p: Project, hints: { accent?: string; shot?: number } = {}): Plan {
  const t = prompt.toLowerCase();
  const ops: Op[] = [];
  const quoted = /["“](.+?)["”]/.exec(prompt)?.[1];
  if (has(t, ['undo all', 'restore', 'uncut', 'original'])) ops.push({ op: 'restore_all' });
  if (has(t, ['punchy', 'tight', 'filler', 'um', 'dead air', 'pause', 'silence', 'faster', 'snappy'])) ops.push({ op: 'remove_fillers' }, { op: 'remove_silence', min: has(t, ['punchy', 'snappy', 'faster']) ? 0.4 : 0.6 });
  if (has(t, ['caption', 'subtitle', 'text on screen', 'words on screen', 'punchy'])) {
    const style: CaptionStyle = has(t, ['karaoke']) ? 'karaoke' : has(t, ['editorial', 'serif', 'elegant']) ? 'editorial' : has(t, ['minimal', 'subtle', 'clean']) ? 'minimal' : has(t, ['bold', 'white']) ? 'bold' : 'pop';
    const colours: Record<string, string> = { yellow: '#ffd400', green: '#c5f04a', red: '#ff4d4d', blue: '#4da3ff', pink: '#ff5fb7', orange: '#ff9a3c', white: '#ffffff' };
    const c = Object.keys(colours).find(k => t.includes(k));
    ops.push({ op: 'captions', on: !has(t, ['no caption', 'remove caption', 'captions off']), style, accent: c ? colours[c] : hints.accent,
      size: has(t, ['bigger', 'larger', 'huge']) ? 1.3 : has(t, ['smaller']) ? 0.8 : undefined, position: has(t, ['top']) ? 'high' : has(t, ['middle', 'center']) ? 'mid' : undefined });
  }
  if (has(t, ['zoom', 'punch in', 'punch-in', 'key word', 'keyword', 'punchy'])) ops.push({ op: 'zoom_keywords', count: Math.max(3, Math.round(outputDuration(p.keep) / 8)) });
  if (has(t, ['strongest moment', 'best part', 'highlight', 'shorter', 'under 30', '30 sec', 'clip'])) {
    const ow = outputWords(p);
    if (ow.length > 20) {
      // Densest ~25 s window of speech.
      let best = 0, bestI = 0;
      for (let i = 0; i < ow.length; i++) {
        let j = i; while (j + 1 < ow.length && ow[j + 1].oe - ow[i].os < 25) j++;
        if (j - i > best) { best = j - i; bestI = i; }
      }
      let j = bestI; while (j + 1 < ow.length && ow[j + 1].oe - ow[bestI].os < 25) j++;
      ops.push({ op: 'keep_only', from: ow[bestI].i, to: ow[j].i });
    }
  }
  if (has(t, ['9:16', 'vertical', 'reel', 'tiktok', 'short'])) ops.push({ op: 'aspect', value: '9:16', fit: has(t, ['blur']) ? 'blur' : 'crop' });
  else if (has(t, ['16:9', 'horizontal', 'youtube', 'landscape'])) ops.push({ op: 'aspect', value: '16:9', fit: has(t, ['blur']) ? 'blur' : 'crop' });
  else if (has(t, ['1:1', 'square'])) ops.push({ op: 'aspect', value: '1:1', fit: 'crop' });
  const look = (['cinematic', 'warm', 'vivid', 'clean'] as LookPreset[]).find(l => t.includes(l)) ?? (has(t, ['black and white', 'b&w', 'mono']) ? 'bw' : has(t, ['retro', 'vintage']) ? 'warm' : undefined);
  if (look) ops.push({ op: 'look', preset: look });
  if (has(t, ['title', 'hook', 'headline'])) ops.push({ op: 'title', text: quoted ?? (p.words.slice(0, 6).map(w => w.w).join(' ') || p.title) });
  if (has(t, ['ask', 'cta', 'call to action', 'follow', 'end card', 'subscribe', 'dm me', 'contact'])) ops.push({ op: 'cta', text: quoted && !has(t, ['title']) ? quoted : has(t, ['dm']) ? 'DM me for details' : 'Follow for more' });
  if (has(t, ['music', 'song'])) ops.push({ op: 'music', volume: has(t, ['louder']) ? 0.45 : has(t, ['quieter', 'lower']) ? 0.12 : 0.25, duck: true });
  if (has(t, ['remove zoom', 'no zoom'])) ops.push({ op: 'clear', what: 'zooms' });
  const reply = ops.length ? "Here's the edit. Everything is on the timeline, so you can undo any step." : 'I can cut pauses and filler words, add captions, zooms, a title or a call to action, change the format or the look. Try "make it punchy with yellow captions".';
  return { reply, ops: sanitizeOps(ops, p.words.length), by: 'built-in' };
}

// ---------- Claude through Masvid Studio (local) ----------
const STUDIO = 'http://127.0.0.1:4180';

export async function studioAvailable(): Promise<boolean> {
  try {
    const r = await fetch(`${STUDIO}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const d = await r.json();
    return Boolean(d?.ok && d?.editPlan);
  } catch { return false; }
}

export function planContext(p: Project) {
  const ow = outputWords(p);
  return {
    duration: +outputDuration(p.keep).toFixed(2),
    sourceDuration: +p.duration.toFixed(2),
    aspect: p.aspect, look: p.look, captions: p.captions,
    overlays: p.overlays.map(o => ({ kind: o.kind, text: o.text, start: +o.start.toFixed(2), dur: o.dur })),
    zooms: p.zooms.length, music: Boolean(p.music),
    // Word index, word, start second in the edited video ("cut" when currently removed).
    transcript: p.words.slice(0, 2500).map((w, i) => {
      const o = ow.find(x => x.i === i);
      return `${i}:${w.w}@${o ? o.os.toFixed(1) : 'cut'}`;
    }).join(' '),
  };
}

export async function claudePlan(prompt: string, p: Project, style: string | null, model: string, signal?: AbortSignal): Promise<Plan> {
  const r = await fetch(`${STUDIO}/api/edit-plan`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ prompt: prompt.slice(0, 4000), style, model, context: planContext(p) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.error || `Masvid Studio error ${r.status}`);
  return { reply: String(d.reply ?? '').slice(0, 800), ops: sanitizeOps(d.ops, p.words.length), by: 'claude' };
}
