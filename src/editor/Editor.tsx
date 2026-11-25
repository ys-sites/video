import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Captions, ChevronDown, Download, FileJson, House, Music, Pause, Play, Redo2, Scissors, Sparkles, Undo2, Upload, Volume2, VolumeX, Wand2, X } from 'lucide-react';
import AccountBar from '../components/AccountBar';
import { builtInStyles } from '../styles';
import { applyOps, builtInPlan, claudePlan, studioAvailable, type Plan } from './ai';
import { captionChunks, drawFrame } from './compositor';
import { decodeAudio, exportMp4, transcribe } from './media';
import {
  CAPTION_STYLES, LOOKS, aspectSize, cutRange, emptyProject, newId, normalize, outputDuration, outputWords, parseProject, toOutput, toSource,
  type Aspect, type CaptionStyle, type LookPreset, type Project,
} from './project';

// Measured medians from skills/creator-video/references/real-estate-creator-study.md §2.
const RECIPES = [
  { name: 'Walk-and-talk', prompt: 'Make it punchy: cut pauses and filler words, pop captions, zooms on key words and a clear ask at the end' },
  { name: 'Interior talking head', prompt: 'Make it punchy, open on the strongest moment, captions and zooms on key words' },
  { name: 'Podcast clip', prompt: 'Find the strongest moment under 30 seconds, bold captions, zooms and a call to action' },
  { name: 'Hosted listing tour', prompt: 'Punchy listing tour: hook title, captions, warm look and a call to action "DM me for details"' },
  { name: 'Cinematic listing film', prompt: 'Cinematic look, minimal captions, title card and a call to action at the end' },
  { name: 'POV walkthrough', prompt: 'Make it punchy with pop captions, zooms on key words and a clear ask' },
];
const QUICK = ['Add captions', 'Make it punchy', 'Open on the strongest moment', 'Add zooms on key words', 'Yellow karaoke captions, bigger', 'Cinematic look', 'Make it 9:16 with a blurred fill', 'Add a call to action "Follow for more"'];
type Msg = { role: 'user'; text: string } | { role: 'ai'; text: string; steps: string[]; by: Plan['by'] };
type Tab = 'ai' | 'transcript' | 'style';
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const btn = 'rounded-lg border border-white/10 px-2.5 py-1 text-xs text-[#d4d4d8] hover:border-white/25 hover:text-white disabled:opacity-40';

function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export default function Editor() {
  const creatorStyles = useMemo(() => builtInStyles.filter(s => s.category === 'creator'), []);
  const [history, setHistory] = useState<Project[]>([emptyProject()]);
  const [cursor, setCursor] = useState(0);
  const p = history[cursor];
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [voice, setVoice] = useState<AudioBuffer | null>(null);
  const [music, setMusic] = useState<{ buf: AudioBuffer; url: string } | null>(null);
  const [tab, setTab] = useState<Tab>('ai');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState('');
  const [claude, setClaude] = useState(false);
  const [model, setModel] = useState('sonnet');
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<{ fraction: number; text: string } | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const [notice, setNotice] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const musicFileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(0);

  const total = outputDuration(p.keep);
  const words = useMemo(() => outputWords(p), [p]);
  const chunks = useMemo(() => captionChunks(words), [words]);
  const style = creatorStyles.find(s => s.id === p.styleId) ?? null;

  const flash = (m: string) => { setNotice(m); setTimeout(() => setNotice(''), 3000); };
  const commit = useCallback((next: Project) => {
    setHistory(h => [...h.slice(0, cursor + 1), next].slice(-80));
    setCursor(c => Math.min(c + 1, 79));
  }, [cursor]);
  const patch = (fn: (q: Project) => Project) => commit(fn(structuredClone(p)));

  useEffect(() => { studioAvailable().then(setClaude); const id = setInterval(() => studioAvailable().then(setClaude), 15000); return () => clearInterval(id); }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  // ---------- open media ----------
  const openFile = async (f: File) => {
    if (!f.type.startsWith('video/') && !/\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name)) return flash('Pick a video file.');
    setPlaying(false);
    const u = URL.createObjectURL(f);
    setFile(f); setUrl(u); setT(0); tRef.current = 0; setThread([]); setSel(null);
    const v = videoRef.current!;
    v.src = u;
    await new Promise<void>(res => { v.onloadedmetadata = () => res(); v.onerror = () => res(); });
    const d = isFinite(v.duration) ? v.duration : 0;
    const fresh = emptyProject(d, f.name.replace(/\.[^.]+$/, '').slice(0, 80));
    setHistory([fresh]); setCursor(0);
    setStatus('Reading the sound...');
    const buf = await decodeAudio(f);
    setVoice(buf);
    if (!buf) { setStatus('No sound track found, so no transcript. You can still style and export.'); return; }
    try {
      setBusy(true);
      const found = await transcribe(buf, setStatus);
      setHistory([{ ...fresh, words: found }]); setCursor(0);
      setStatus(found.length ? `Transcript ready: ${found.length} words. Ask for an edit or pick a format.` : 'No speech found. You can still style and export.');
    } catch (e) {
      setStatus(`Transcript failed (${(e as Error).message}). Edits that need words are off; styling and export still work.`);
    } finally { setBusy(false); }
  };
  const onPick = (e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void openFile(f); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void openFile(f); };
  const onMusic = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const buf = await decodeAudio(f);
    if (!buf) return flash('Could not read that audio file.');
    if (music) URL.revokeObjectURL(music.url);
    setMusic({ buf, url: URL.createObjectURL(f) });
    patch(q => ({ ...q, music: { name: f.name.slice(0, 80), volume: 0.25, duck: true } }));
  };

  // ---------- preview ----------
  const size = aspectSize(p.aspect, 0.5);
  const draw = useCallback((time: number) => {
    const c = canvasRef.current, v = videoRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const ready = v && v.readyState >= 2 && file;
    drawFrame(ctx, p, chunks, time, ready ? v : null, v?.videoWidth ?? 0, v?.videoHeight ?? 0);
  }, [p, chunks, file]);

  const seek = useCallback((time: number) => {
    const tt = Math.max(0, Math.min(total, time));
    tRef.current = tt; setT(tt);
    const v = videoRef.current;
    if (v && file) v.currentTime = toSource(p.keep, tt);
    if (musicRef.current && music) musicRef.current.currentTime = tt % Math.max(0.1, music.buf.duration);
  }, [total, p.keep, file, music]);

  useEffect(() => { draw(tRef.current); }, [draw, size.w, size.h]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onSeeked = () => draw(tRef.current);
    v.addEventListener('seeked', onSeeked);
    return () => v.removeEventListener('seeked', onSeeked);
  }, [draw]);

  useEffect(() => {
    const v = videoRef.current, m = musicRef.current;
    if (!playing || !v || !file) { v?.pause(); m?.pause(); return; }
    if (tRef.current >= total - 0.05) seek(0);
    v.currentTime = toSource(p.keep, tRef.current);
    v.muted = muted; v.volume = Math.min(1, p.voice);
    void v.play();
    if (m && music && p.music) { m.volume = muted ? 0 : Math.min(1, p.music.volume); m.currentTime = tRef.current % music.buf.duration; void m.play(); }
    let raf = 0;
    const tick = () => {
      const src = v.currentTime;
      let out = toOutput(p.keep, src);
      if (out === null) {
        const next = p.keep.find(r => r.s > src - 0.001);
        if (!next) { setPlaying(false); return; }
        v.currentTime = next.s;
        out = toOutput(p.keep, next.s) ?? tRef.current;
      }
      if (out >= total - 0.03) { setPlaying(false); return; }
      tRef.current = out; setT(out);
      draw(out);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); v.pause(); m?.pause(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, file, p, total, muted, music]);

  // ---------- AI ----------
  const styleBrief = () => (style ? `${style.name}: ${style.description} Palette: ${style.palette}. Motion: ${style.motion.slice(0, 4).join(' ')}` : null);
  const ask = async (text = prompt) => {
    const request = text.trim();
    if (!request || busy) return;
    if (!file) return flash('Add your video first.');
    setPrompt('');
    setThread(th => [...th, { role: 'user', text: request }]);
    setBusy(true);
    let plan: Plan | null = null;
    if (claude) {
      try { plan = await claudePlan(request, p, styleBrief(), model); }
      catch (e) { setStatus(`Claude unavailable (${(e as Error).message}); used the built-in editor.`); }
    }
    if (!plan) plan = builtInPlan(request, p, { accent: style?.accent });
    const { project, steps } = applyOps(p, plan.ops);
    if (plan.ops.length) commit(project);
    setThread(th => [...th, { role: 'ai', text: plan!.reply, steps, by: plan!.by }]);
    setBusy(false);
    seek(Math.min(tRef.current, outputDuration(project.keep)));
  };

  // ---------- transcript editing ----------
  const selRange = sel ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] as const : null;
  const cutSel = (restore: boolean) => {
    if (!selRange) return;
    const [a, b] = selRange;
    const s = p.words[a].s - 0.03, e = p.words[b].e + 0.03;
    patch(q => ({ ...q, keep: restore ? normalize([...q.keep, { s, e }], q.duration) : cutRange(q.keep, s, e) }));
    setSel(null);
  };

  // ---------- export ----------
  const doExport = async (draft: boolean) => {
    setExportOpen(false);
    if (!file) return flash('Add your video first.');
    if (typeof (window as any).VideoEncoder === 'undefined') return flash('This browser cannot export video. Use Chrome or Edge.');
    setPlaying(false);
    const ac = new AbortController(); abortRef.current = ac;
    setExporting({ fraction: 0, text: 'Preparing...' });
    try {
      const blob = await exportMp4(p, file, voice, music?.buf ?? null, { fps: 30, draft }, (fraction, text) => setExporting({ fraction, text }), ac.signal);
      save(`${(p.title || 'masvid-edit').replace(/[^\w\- ]+/g, '').trim() || 'masvid-edit'}${draft ? '-draft' : ''}.mp4`, blob);
      flash(`Exported ${(blob.size / 1048576).toFixed(1)} MB.`);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') flash(`Export failed: ${(e as Error).message}`);
    } finally { setExporting(null); abortRef.current = null; }
  };

  const loadSaved = (raw: Record<string, unknown>) => {
    const q = parseProject(raw);
    if (!q) return flash('That save is from the old planner and cannot be opened here.');
    setHistory([q]); setCursor(0);
    flash(file ? 'Project opened.' : 'Project opened. Add the same video to see it.');
  };

  const aspectBox = p.aspect === '9:16' ? 'h-[min(62vh,560px)] aspect-[9/16]' : p.aspect === '1:1' ? 'h-[min(56vh,480px)] aspect-square' : 'w-full max-w-[760px] aspect-video';
  const pxPerSec = 100 / Math.max(1, total);

  return (
    <div className="ai-editor pb-6">
      <AccountBar getPlan={() => p as unknown as Record<string, unknown>} title={p.title.slice(0, 120)} onLoad={loadSaved} onOpenVideo={f => void openFile(f)} />
      <video ref={videoRef} className="hidden" playsInline preload="auto" crossOrigin="anonymous" />
      {music && <audio ref={musicRef} src={music.url} loop className="hidden" />}
      <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={onPick} />
      <input ref={musicFileRef} type="file" accept="audio/*" className="hidden" onChange={onMusic} />

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl" onDragOver={e => e.preventDefault()} onDrop={onDrop}>
        {/* Top bar */}
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[#a1a1aa]">
          <a href="/" aria-label="Back to Master Video Styles" className="rounded-lg p-1.5 hover:bg-white/5 hover:text-white"><House size={16} /></a>
          <button aria-label="Undo" disabled={cursor === 0} onClick={() => setCursor(c => c - 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Undo2 size={16} /></button>
          <button aria-label="Redo" disabled={cursor >= history.length - 1} onClick={() => setCursor(c => c + 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Redo2 size={16} /></button>
          <input value={p.title} onChange={e => setHistory(h => h.map((q, i) => (i === cursor ? { ...q, title: e.target.value.slice(0, 120) } : q)))} aria-label="Project name"
            className="mx-2 min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 py-1 text-center text-sm font-semibold text-white hover:bg-white/5 focus:bg-white/5" />
          <span className="hidden rounded-lg border border-white/10 p-0.5 text-xs sm:flex">
            {(['9:16', '1:1', '16:9'] as Aspect[]).map(a => (
              <button key={a} onClick={() => patch(q => ({ ...q, aspect: a }))} className={`rounded px-2 py-0.5 ${p.aspect === a ? 'bg-[#27272a] text-white' : 'hover:text-white'}`}>{a}</button>
            ))}
          </span>
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen} disabled={!!exporting}
              className="ml-1 flex items-center gap-1.5 rounded-lg bg-[#fafafa] px-3.5 py-1.5 text-sm font-semibold text-[#09090b] hover:bg-[#e4e4e7] disabled:opacity-50">
              Export <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-white/10 bg-[#18181b] text-sm shadow-2xl">
                <button onClick={() => doExport(false)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"><Download size={14} /> MP4, full quality (1080p)</button>
                <button onClick={() => doExport(true)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"><Download size={14} /> Quick draft (540p)</button>
                <button onClick={() => { save('masvid-project.json', new Blob([JSON.stringify(p, null, 1)], { type: 'application/json' })); setExportOpen(false); }}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"><FileJson size={14} /> Project file (.json)</button>
                <p className="border-t border-white/10 px-4 py-2 text-[11px] text-[#71717a]">Rendered on your device. Your video is never uploaded.</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid min-h-[620px] grid-cols-1 lg:grid-cols-[380px_1fr]">
          {/* Left panel */}
          <div className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="flex gap-4 border-b border-white/10 px-5 pt-3 text-sm">
              {(['ai', 'transcript', 'style'] as Tab[]).map(k => (
                <button key={k} onClick={() => setTab(k)} className={`border-b-2 pb-2 ${tab === k ? 'border-white text-white' : 'border-transparent text-[#71717a] hover:text-white'}`}>
                  {k === 'ai' ? 'AI' : k === 'transcript' ? 'Transcript' : 'Style'}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm text-[#d4d4d8]" style={{ maxHeight: 640 }}>
              {status && <p className="rounded-lg bg-white/5 px-3 py-2 text-xs text-[#a1a1aa]">{status}</p>}

              {tab === 'ai' && (<>
                {!file && (
                  <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-white/15 px-4 py-8 text-center hover:border-white/30">
                    <Upload size={18} className="text-white" />
                    <span className="font-semibold text-white">Add your video</span>
                    <span className="text-xs text-[#71717a]">It stays on your device. Drop a file anywhere.</span>
                  </button>
                )}
                <div className="flex items-center gap-2 text-xs">
                  <span className={`h-2 w-2 rounded-full ${claude ? 'bg-[#c5f04a]' : 'bg-[#52525b]'}`} />
                  <span className="text-[#a1a1aa]">{claude ? 'AI: Claude on this PC (Masvid Studio)' : 'AI: built-in editor (start Masvid Studio to use Claude)'}</span>
                  {claude && (
                    <select aria-label="Claude model" value={model} onChange={e => setModel(e.target.value)} className="ml-auto rounded-md border border-white/10 bg-[#18181b] px-1.5 py-0.5 text-xs">
                      <option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option>
                    </select>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-medium text-[#a1a1aa]">Style</p>
                  <select aria-label="Creator style" value={p.styleId ?? ''} onChange={e => patch(q => ({ ...q, styleId: e.target.value || null, captions: { ...q.captions, accent: creatorStyles.find(s => s.id === e.target.value)?.accent ?? q.captions.accent } }))}
                    className="w-full rounded-lg border border-white/10 bg-[#18181b] px-2 py-1.5 text-sm">
                    <option value="">No style (just my request)</option>
                    {creatorStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                {thread.length === 0 ? (<>
                  <div>
                    <p className="mb-2 text-xs font-medium text-[#a1a1aa]">Start from a format</p>
                    <div className="flex flex-wrap gap-2">{RECIPES.map(r => <button key={r.name} className={btn} disabled={busy || !file} onClick={() => void ask(r.prompt)}>{r.name}</button>)}</div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-[#a1a1aa]">Or just ask</p>
                    <div className="flex flex-wrap gap-2">{QUICK.map(q => <button key={q} className={btn} disabled={busy || !file} onClick={() => void ask(q)}>{q}</button>)}</div>
                  </div>
                </>) : (
                  <div className="space-y-3">
                    {thread.map((m, i) => m.role === 'user'
                      ? <p key={i} className="ml-8 rounded-lg bg-[#27272a] px-3 py-2 text-white">{m.text}</p>
                      : (
                        <div key={i} className="space-y-1.5">
                          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[#71717a]"><Sparkles size={11} /> {m.by === 'claude' ? 'Claude' : 'Built-in editor'}</p>
                          <ul className="space-y-0.5 text-xs text-[#a1a1aa]">{m.steps.map((s, j) => <li key={j}>✓ {s}</li>)}</ul>
                          {m.text && <p className="text-[#e4e4e7]">{m.text}</p>}
                        </div>
                      ))}
                  </div>
                )}
                <div className="space-y-2">
                  <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} disabled={busy}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                    placeholder={busy ? 'Working...' : 'Tell the AI what to change, e.g. "cut the first sentence, yellow captions, zoom on the price"'}
                    className="w-full resize-y rounded-xl border border-white/10 bg-[#18181b] px-3 py-2 text-sm text-white placeholder:text-[#52525b] focus:border-white/30 focus:outline-none" />
                  <button onClick={() => void ask()} disabled={busy || !prompt.trim() || !file} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#fafafa] py-2 text-sm font-semibold text-[#09090b] hover:bg-[#e4e4e7] disabled:opacity-40">
                    <Wand2 size={14} /> {busy ? 'Working...' : 'Edit with AI'}
                  </button>
                </div>
              </>)}

              {tab === 'transcript' && (<>
                {!p.words.length ? <p className="text-[#71717a]">{file ? 'The transcript appears here once your video has been listened to.' : 'Add a video to get a transcript.'}</p> : (<>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} disabled={!selRange} onClick={() => cutSel(false)}><Scissors size={12} className="mr-1 inline" />Cut selection</button>
                    <button className={btn} disabled={!selRange} onClick={() => cutSel(true)}>Restore selection</button>
                    <button className={btn} onClick={() => { const r = applyOps(p, [{ op: 'remove_fillers' }]); commit(r.project); flash(r.steps[0]); }}>Remove um/uh</button>
                    <button className={btn} onClick={() => { const r = applyOps(p, [{ op: 'remove_silence', min: 0.5 }]); commit(r.project); flash(r.steps[0]); }}>Remove pauses</button>
                  </div>
                  <p className="text-xs text-[#71717a]">Click a word to jump there. Shift-click to select a range, then cut it.</p>
                  <p className="leading-7">
                    {p.words.map((w, i) => {
                      const kept = toOutput(p.keep, (w.s + w.e) / 2) !== null;
                      const inSel = selRange && i >= selRange[0] && i <= selRange[1];
                      const now = kept && words.find(x => x.i === i && t >= x.os && t < x.oe);
                      return (
                        <span key={i} onClick={e => { if (e.shiftKey && sel) setSel({ a: sel.a, b: i }); else { setSel({ a: i, b: i }); const o = toOutput(p.keep, w.s + 0.01); if (o !== null) seek(o); } }}
                          className={`cursor-pointer rounded px-0.5 ${inSel ? 'bg-[#3f3f46] text-white' : ''} ${now ? 'bg-[#c5f04a] text-black' : ''} ${kept ? 'text-[#e4e4e7] hover:bg-white/10' : 'text-[#52525b] line-through'}`}>
                          {w.w}{' '}
                        </span>
                      );
                    })}
                  </p>
                </>)}
              </>)}

              {tab === 'style' && (<>
                <section className="space-y-2">
                  <label className="flex items-center gap-2 font-medium text-white"><input type="checkbox" checked={p.captions.on} onChange={e => patch(q => ({ ...q, captions: { ...q.captions, on: e.target.checked } }))} /> <Captions size={14} /> Captions</label>
                  <div className="flex flex-wrap gap-1.5">{(Object.keys(CAPTION_STYLES) as CaptionStyle[]).map(s => (
                    <button key={s} onClick={() => patch(q => ({ ...q, captions: { ...q.captions, on: true, style: s } }))} className={`${btn} ${p.captions.style === s && p.captions.on ? 'border-white/40 text-white' : ''}`}>{CAPTION_STYLES[s]}</button>
                  ))}</div>
                  <div className="flex items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5">Colour <input type="color" value={p.captions.accent} onChange={e => patch(q => ({ ...q, captions: { ...q.captions, accent: e.target.value } }))} className="h-6 w-8 rounded border-0 bg-transparent" /></label>
                    <label className="flex flex-1 items-center gap-1.5">Size <input type="range" min={0.6} max={1.8} step={0.05} value={p.captions.size} onChange={e => patch(q => ({ ...q, captions: { ...q.captions, size: +e.target.value } }))} className="flex-1" /></label>
                    <select aria-label="Caption position" value={p.captions.position} onChange={e => patch(q => ({ ...q, captions: { ...q.captions, position: e.target.value as Project['captions']['position'] } }))} className="rounded border border-white/10 bg-[#18181b] px-1 py-0.5">
                      <option value="low">Low</option><option value="mid">Middle</option><option value="high">Top</option>
                    </select>
                  </div>
                </section>
                <section className="space-y-2">
                  <p className="font-medium text-white">Look</p>
                  <div className="flex flex-wrap gap-1.5">{(Object.keys(LOOKS) as LookPreset[]).map(l => (
                    <button key={l} onClick={() => patch(q => ({ ...q, look: l }))} className={`${btn} ${p.look === l ? 'border-white/40 text-white' : ''}`}>{LOOKS[l].label}</button>
                  ))}</div>
                  <div className="flex gap-1.5 text-xs">
                    <button onClick={() => patch(q => ({ ...q, fit: 'crop' }))} className={`${btn} ${p.fit === 'crop' ? 'border-white/40 text-white' : ''}`}>Fill frame</button>
                    <button onClick={() => patch(q => ({ ...q, fit: 'blur' }))} className={`${btn} ${p.fit === 'blur' ? 'border-white/40 text-white' : ''}`}>Fit with blurred fill</button>
                  </div>
                </section>
                <section className="space-y-2">
                  <p className="font-medium text-white">Text cards</p>
                  {(['title', 'cta'] as const).map(kind => {
                    const o = p.overlays.find(x => x.kind === kind);
                    return (
                      <div key={kind} className="flex items-center gap-2">
                        <input value={o?.text ?? ''} placeholder={kind === 'title' ? 'Title at the start (hook)' : 'Call to action at the end'}
                          onChange={e => {
                            const text = e.target.value.slice(0, 90);
                            patch(q => {
                              const rest = q.overlays.filter(x => x.kind !== kind);
                              if (!text) return { ...q, overlays: rest };
                              const dur = kind === 'title' ? 2.5 : 3;
                              return { ...q, overlays: [...rest, { id: o?.id ?? newId('o'), kind, text, start: kind === 'title' ? 0 : Math.max(0, outputDuration(q.keep) - dur), dur: o?.dur ?? dur }] };
                            });
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#18181b] px-2 py-1.5 text-sm text-white placeholder:text-[#52525b]" />
                      </div>
                    );
                  })}
                  {p.zooms.length > 0 && <button className={btn} onClick={() => patch(q => ({ ...q, zooms: [] }))}>Remove {p.zooms.length} zoom{p.zooms.length > 1 ? 's' : ''}</button>}
                </section>
                <section className="space-y-2">
                  <p className="font-medium text-white">Sound</p>
                  <label className="flex items-center gap-2 text-xs">Voice <input type="range" min={0} max={1.5} step={0.05} value={p.voice} onChange={e => patch(q => ({ ...q, voice: +e.target.value }))} className="flex-1" /></label>
                  {p.music && music ? (<>
                    <div className="flex items-center gap-2 text-xs"><Music size={13} /><span className="flex-1 truncate">{p.music.name}</span>
                      <button aria-label="Remove music" onClick={() => { patch(q => ({ ...q, music: null })); URL.revokeObjectURL(music.url); setMusic(null); }} className="rounded p-1 hover:bg-white/10"><X size={12} /></button></div>
                    <label className="flex items-center gap-2 text-xs">Music <input type="range" min={0} max={1} step={0.02} value={p.music.volume} onChange={e => patch(q => ({ ...q, music: q.music && { ...q.music, volume: +e.target.value } }))} className="flex-1" /></label>
                    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={p.music.duck} onChange={e => patch(q => ({ ...q, music: q.music && { ...q.music, duck: e.target.checked } }))} /> Lower the music while you talk</label>
                  </>) : <button className={btn} onClick={() => musicFileRef.current?.click()}><Music size={12} className="mr-1 inline" />Add music (your own or licensed file)</button>}
                </section>
              </>)}
            </div>
          </div>

          {/* Preview */}
          <div className="flex min-w-0 flex-col items-center justify-center gap-3 bg-[#0c0c0e] p-4">
            <div className={`relative overflow-hidden rounded-xl bg-black ${aspectBox}`}>
              <canvas ref={canvasRef} width={size.w} height={size.h} className="h-full w-full" onClick={() => file && setPlaying(x => !x)} />
              {!file && (
                <button onClick={() => fileRef.current?.click()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-[#a1a1aa] hover:text-white">
                  <Upload size={18} /> Add your video to preview it here
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-[#a1a1aa]">
              <button aria-label={playing ? 'Pause' : 'Play'} disabled={!file} onClick={() => setPlaying(x => !x)} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20 disabled:opacity-40">{playing ? <Pause size={14} /> : <Play size={14} />}</button>
              <span className="tabular-nums">{fmt(t)} / {fmt(total)}</span>
              <button aria-label={muted ? 'Unmute' : 'Mute'} onClick={() => setMuted(m => !m)} className="rounded p-1 hover:text-white">{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
              {file && p.duration - total > 0.05 && <span>{fmt(p.duration - total)} cut</span>}
            </div>
          </div>
        </div>

        {/* Timeline */}
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-[#a1a1aa]">
          <div className="relative cursor-pointer select-none space-y-1" onClick={e => {
            const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            seek(((e.clientX - r.left - 72) / (r.width - 72)) * total);
          }}>
            {[
              { name: 'Video', items: (() => { let acc = 0; return p.keep.map((r, i) => { const s = acc; acc += r.e - r.s; return { k: `v${i}`, s, e: acc, label: '', cls: 'bg-[#4f8a72]/90' }; }); })() },
              { name: 'Captions', items: p.captions.on ? chunks.map((c, i) => ({ k: `c${i}`, s: c.s, e: c.e, label: c.words.map(w => w.w).join(' '), cls: 'bg-[#f2f2ea]/80 text-[#111113]' })) : [] },
              { name: 'Text', items: p.overlays.map(o => ({ k: o.id, s: o.start, e: o.start + o.dur, label: o.text, cls: 'bg-[#c5f04a]/80 text-[#0b0f00]' })) },
              { name: 'Zoom', items: p.zooms.map(z => ({ k: z.id, s: z.at, e: z.at + z.dur, label: `${Math.round((z.scale - 1) * 100)}%`, cls: 'bg-[#6b7fd6]/85 text-white' })) },
              { name: 'Music', items: p.music ? [{ k: 'm', s: 0, e: total, label: p.music.name, cls: 'bg-[#b06ad6]/70 text-white' }] : [] },
            ].map(row => (
              <div key={row.name} className="flex h-6 items-center">
                <span className="w-[72px] shrink-0">{row.name}</span>
                <div className="relative h-full flex-1 rounded bg-white/[0.03]">
                  {row.items.map(it => (
                    <div key={it.k} title={it.label} className={`absolute top-0.5 bottom-0.5 overflow-hidden truncate rounded-sm px-1 leading-5 ${it.cls}`}
                      style={{ left: `${it.s * pxPerSec}%`, width: `${Math.max(0.3, (it.e - it.s) * pxPerSec)}%` }}>{it.label}</div>
                  ))}
                </div>
              </div>
            ))}
            {total > 0 && <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-white" style={{ left: `calc(72px + (100% - 72px) * ${t / total})` }} />}
          </div>
        </div>
      </div>

      {(notice || exporting) && (
        <div className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-xl border border-white/10 bg-[#18181b] px-4 py-3 text-sm text-white shadow-2xl">
          {exporting ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between"><span>{exporting.text}</span><button onClick={() => abortRef.current?.abort()} className="text-xs text-[#a1a1aa] hover:text-white">Cancel</button></div>
              <div className="h-1.5 overflow-hidden rounded bg-white/10"><div className="h-full bg-[#c5f04a]" style={{ width: `${Math.round(exporting.fraction * 100)}%` }} /></div>
            </div>
          ) : notice}
        </div>
      )}
    </div>
  );
}
