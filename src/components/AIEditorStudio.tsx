import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Upload, Scissors, Mic, Eye, EyeOff, Eraser, ZoomIn, Undo2, Redo2, Trash2, House, ArrowUp,
  Play, Pause, Download, Copy, Music, Film, Type, Palette, Captions, ChevronDown, Volume2, VolumeX,
  ImageIcon, Minus, Plus,
} from 'lucide-react';
import { builtInStyles } from '../styles';
import AccountBar from './AccountBar';
import { askAgent, agentAvailable, type AgentStep } from '../lib/agent';

// Layout ideas from REA captures of opus.pro/ai-video-editor, chatcut.io and
// captions.ai/features/edit-with-ai (2026-11-19, notes in docs/ai-editor-research.md).
// All copy here is our own. The page plans the edit; Claude Code renders it locally.

type Track = 'video' | 'captions' | 'motion' | 'broll' | 'music' | 'sfx';
type Op = { id: string; track: Track; start: number; end: number; label: string; why: string; tool: string };
type Aspect = '9:16' | '16:9' | '1:1';
type Msg = { role: 'user'; text: string } | { role: 'agent'; steps: AgentStep[]; note?: string };
const LANE = 112;

const TRACKS: { id: Track; name: string; color: string; icon: typeof Film }[] = [
  { id: 'motion', name: 'Motion graphics', color: 'bg-[#c5f04a]/80 text-[#0b0f00]', icon: Type },
  { id: 'captions', name: 'Captions', color: 'bg-[#f2f2ea]/85 text-[#111113]', icon: Captions },
  { id: 'video', name: 'Video', color: 'bg-[#4f8a72]/90 text-white', icon: Film },
  { id: 'broll', name: 'B-roll', color: 'bg-[#6b7fd6]/85 text-white', icon: ImageIcon },
  { id: 'music', name: 'Music', color: 'bg-[#b06ad6]/80 text-white', icon: Music },
  { id: 'sfx', name: 'Sound effects', color: 'bg-[#f08a5d]/85 text-[#1d0f08]', icon: Volume2 },
];

const QUICK_PROMPTS = [
  'Add captions',
  'Make it punchy',
  'Open on the strongest moment',
  'Add zooms on key words',
  'Add music under my voice',
  'Turn this into a reel with a clear ask at the end',
  'Add B-roll where I describe something',
  'Give it a retro feel',
];

// Measured medians from skills/creator-video/references/real-estate-creator-study.md §2.
const RECIPES = [
  { id: 'WT', name: 'Walk-and-talk', reels: 25, len: 34, shot: 2.8, wpm: 209, prompt: 'Make it punchy, add captions with keyword pops, zooms and a clear ask' },
  { id: 'SI', name: 'Interior talking head', reels: 15, len: 44, shot: 2.4, wpm: 211, prompt: 'Make it punchy, open on the strongest moment, add captions and B-roll where I describe something' },
  { id: 'PC', name: 'Podcast clip', reels: 7, len: 26, shot: 2.2, wpm: 213, prompt: 'Find the strongest moment, add captions and zooms, end with a clear ask' },
  { id: 'HT', name: 'Hosted listing tour', reels: 36, len: 60, shot: 1.3, wpm: 87, prompt: 'Punchy listing tour: hook title, B-roll of each room I show, music and a clear ask' },
  { id: 'CF', name: 'Cinematic listing film', reels: 11, len: 64, shot: 1.1, wpm: 106, prompt: 'Cinematic film: fast cuts on the beat, music, transitions, title card and a clear ask' },
  { id: 'POV', name: 'POV walkthrough', reels: 11, len: 52, shot: 1.9, wpm: 219, prompt: 'Make it punchy with captions, B-roll of what I show and a clear ask' },
  { id: 'LIST', name: 'Numbered listicle', reels: 2, len: 42, shot: 2.2, wpm: 220, prompt: 'Numbered tips: hook title, captions, zooms on each number, clear ask' },
  { id: 'MONT', name: 'Lifestyle montage', reels: 12, len: 24, shot: 0.9, wpm: 98, prompt: 'Fast montage on the beat with music, transitions and one line of text' },
  { id: 'SH', name: 'Selfie talking head', reels: 7, len: 57, shot: 13.9, wpm: 198, prompt: 'Keep it simple: plain captions, light trims, end with a clear ask' },
] as const;

const FIXES = [
  { id: 'trim', name: 'Trim', icon: Scissors, text: 'Cut filler words and dead air so every line lands.', tool: 'Transcript-based cuts (Whisper word timings) in the Remotion project', local: true },
  { id: 'denoise', name: 'Clean audio', icon: Mic, text: 'Lift the voice out of room noise and hum.', tool: 'ffmpeg afftdn + loudnorm to −14 LUFS', local: true },
  { id: 'zooms', name: 'Punch-in zooms', icon: ZoomIn, text: 'Push in on the words that matter.', tool: 'effects skill (face-tracked zoom) or Remotion scale keyframes', local: true },
  { id: 'background', name: 'Background', icon: Eraser, text: 'Cut out the background or put the speaker somewhere new.', tool: 'effects skill segmentation; heavy matting needs the cloud route', local: true },
  { id: 'enhance', name: 'Look', icon: Palette, text: 'Even out exposure and give it one consistent grade.', tool: 'ffmpeg eq/curves or a reviewed LUT', local: true },
  { id: 'eyes', name: 'Eye contact', icon: Eye, text: 'Redirect the gaze to the lens when reading a script.', tool: 'No reviewed local model yet — cloud tool only, with consent', local: false },
] as const;
type FixId = (typeof FIXES)[number]['id'];

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const has = (text: string, words: string[]) => words.some(w => text.includes(w));
let uid = 0;
const op = (o: Omit<Op, 'id'>): Op => ({ ...o, id: `op${++uid}` });

function buildPlan(prompt: string, fixes: Set<FixId>, styleName: string, duration: number, shot?: number): Op[] {
  const p = prompt.toLowerCase();
  const d = duration;
  const ops: Op[] = [];
  const punchy = fixes.has('trim') || has(p, ['punchy', 'tight', 'fast', 'snappy', 'short', 'cuts']);
  const social = has(p, ['reel', 'social', 'tiktok', 'short', 'ask', 'cta', 'viral']);

  // Video track: keep-segments separated by removed fillers; a recipe sets the measured shot length.
  const segs = shot ? Math.min(60, Math.max(1, Math.round(d / shot))) : punchy ? Math.max(3, Math.round(d / 6)) : 1;
  const step = d / segs;
  for (let i = 0; i < segs; i++) {
    const s = i * step + (i ? 0.25 : 0);
    ops.push(op({
      track: 'video', start: s, end: (i + 1) * step - (punchy && i < segs - 1 ? 0.25 : 0),
      label: segs > 1 ? `Keep ${i + 1}` : 'Main take',
      why: shot ? `Shots held about ${shot} s — the measured median for this format.` : segs > 1 ? 'Fillers and pauses cut; the creator study keeps the median shot near 1.4 s.' : 'Footage kept whole — ask to "make it punchy" to tighten it.',
      tool: 'Remotion <OffthreadVideo> trims from word timings',
    }));
  }
  if (has(p, ['strongest', 'hook', 'best moment', 'opening', 'open on']) || social) {
    ops.push(op({ track: 'motion', start: 0, end: Math.min(2, d), label: 'Hook title', why: 'Strongest line moved to the top; first word inside 0.5 s.', tool: 'Remotion title card' }));
  }
  if (fixes.has('zooms') || has(p, ['zoom'])) {
    for (let t = 3; t < d - 1; t += 7) {
      ops.push(op({ track: 'motion', start: t, end: Math.min(t + 1.2, d), label: 'Punch-in 1.15×', why: 'Zoom on a key word to reset attention.', tool: 'effects skill / Remotion scale' }));
    }
  }
  if (has(p, ['caption', 'subtitle', 'text']) || social) {
    ops.push(op({ track: 'captions', start: 0, end: d, label: 'Word-by-word captions', why: 'Most viewers watch muted; keep captions in the mobile safe zone.', tool: 'captions-skill (pop-sticker) — check frames at 1.5 s, 4 s, 8 s first' }));
  }
  if (has(p, ['b-roll', 'broll', 'b roll', 'describe', 'show'])) {
    for (let t = d * 0.3; t < d - 2; t += d * 0.3) {
      ops.push(op({ track: 'broll', start: t, end: Math.min(t + 2, d), label: 'Cutaway', why: 'Show what the words describe. Use your own or licensed clips.', tool: 'Your footage folder; ComfyUI LTX for generated inserts' }));
    }
  }
  if (has(p, ['music', 'audio', 'track', 'song', 'retro']) || social) {
    ops.push(op({ track: 'music', start: 0, end: d, label: has(p, ['retro']) ? 'Retro bed, ducked' : 'Music bed, ducked', why: 'Ducked −18 dB under the voice; licensed tracks only.', tool: 'Remotion <Audio> volume curve' }));
  }
  if (has(p, ['transition', 'punchy', 'retro']) || fixes.has('zooms')) {
    for (let i = 1; i < Math.min(segs, 6); i++) {
      ops.push(op({ track: 'sfx', start: i * step - 0.2, end: i * step + 0.3, label: 'Whoosh', why: 'Sound on the cut makes the jump feel intended.', tool: 'Licensed SFX pack' }));
    }
  }
  if (has(p, ['retro', 'vintage', 'film'])) {
    ops.push(op({ track: 'motion', start: Math.min(2, d), end: Math.min(4, d), label: 'Retro title card', why: 'Grain, warm grade and a serif card set the era.', tool: 'Remotion + ffmpeg grade' }));
  }
  if (social || has(p, ['ask', 'cta', 'call to action'])) {
    ops.push(op({ track: 'motion', start: Math.max(0, d - 3), end: d, label: 'One clear ask', why: 'Close on a single action: follow, comment or book.', tool: 'Remotion end card' }));
  }
  if (fixes.has('denoise')) ops.push(op({ track: 'sfx', start: 0, end: Math.min(1, d), label: 'Voice cleanup', why: 'Denoise, then loudness to −14 LUFS for every platform.', tool: 'ffmpeg afftdn + loudnorm' }));
  if (fixes.has('background')) ops.push(op({ track: 'broll', start: 0, end: Math.min(d, 4), label: 'New background', why: 'Speaker cut out and placed on a clean plate.', tool: 'effects skill segmentation' }));
  if (fixes.has('enhance')) ops.push(op({ track: 'video', start: 0, end: 0.01, label: 'Grade', why: `One consistent look for ${styleName}.`, tool: 'ffmpeg eq/curves' }));
  return ops.filter(o => o.end > o.start);
}

function saveFile(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function AIEditorStudio() {
  const creatorStyles = useMemo(() => builtInStyles.filter(s => s.category === 'creator'), []);
  const [mode, setMode] = useState<'producer' | 'clips'>('producer');
  const [file, setFile] = useState<{ name: string; url: string } | null>(null);
  const [duration, setDuration] = useState(45);
  const [styleId, setStyleId] = useState(creatorStyles[0]?.id ?? '');
  const [prompt, setPrompt] = useState('');
  const [fixes, setFixes] = useState<Set<FixId>>(new Set(['trim']));
  const [aspect, setAspect] = useState<Aspect>('9:16');
  const [history, setHistory] = useState<Op[][]>([[]]);
  const [cursor, setCursor] = useState(0);
  const [log, setLog] = useState<{ request: string; lines: string[] } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [reference, setReference] = useState('');
  const [versions, setVersions] = useState(1);
  const [recipe, setRecipe] = useState<(typeof RECIPES)[number] | null>(null);
  const [projectTitle, setProjectTitle] = useState('Untitled edit');
  const [exportOpen, setExportOpen] = useState(false);
  const [panel, setPanel] = useState<'ai' | 'transcript'>('ai');
  const [thread, setThread] = useState<Msg[]>([]);
  const [thinking, setThinking] = useState(false);
  const [hidden, setHidden] = useState<Set<Track>>(new Set());
  const [muted, setMuted] = useState<Set<Track>>(new Set());
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ops = history[cursor];
  const style = creatorStyles.find(s => s.id === styleId) ?? creatorStyles[0];
  const sel = ops.find(o => o.id === selected) ?? null;

  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  // Without footage, the playhead runs on a timer so the plan can still be previewed.
  useEffect(() => {
    if (!playing || file) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      setTime(t => (t + (now - last) / 1000) % duration);
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, file, duration]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 2600);
  };

  const commit = (next: Op[]) => {
    const h = history.slice(0, cursor + 1);
    setHistory([...h, next]);
    setCursor(h.length);
  };

  const openFile = (f: File) => {
    if (!f.type.startsWith('video/')) return flash('Pick a video file.');
    setFile({ name: f.name, url: URL.createObjectURL(f) });
    setTime(0);
  };

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (f) openFile(f);
  };

  const stepsFor = (plan: Op[], r: typeof recipe): AgentStep[] => {
    const on = (t: Track) => plan.filter(o => o.track === t);
    const steps: AgentStep[] = [];
    const takes = on('video').filter(o => o.end - o.start > 0.05).length;
    steps.push({ title: takes > 1 ? 'Tightened the cut' : 'Kept your take', text: takes > 1 ? `Cut it into ${takes} takes${r ? ` at about ${r.shot} s each, the measured pace for a ${r.name}` : ''} and dropped the pauses.` : 'Your footage stays whole — ask to make it punchy to tighten it.' });
    if (on('motion').length) steps.push({ title: 'Added motion graphics', text: Array.from(new Set(on('motion').map(o => o.label))).join(', ') + ' on the MG track.' });
    if (on('captions').length) steps.push({ title: 'Captioned every word', text: 'Word-by-word captions in the mobile safe zone.' });
    if (on('broll').length) steps.push({ title: 'Added B-roll', text: `${on('broll').length} cutaways where you describe something — use your own or licensed clips.` });
    if (on('music').length) steps.push({ title: 'Added music', text: 'A music bed ducked under your voice.' });
    if (on('sfx').length) steps.push({ title: 'Added sound effects', text: `${on('sfx').length} sounds on the cuts so the jumps feel intended.` });
    return steps;
  };

  const makeEdit = async (text = prompt, r = recipe, d = duration) => {
    const request = text.trim() || `Edit this in ${style?.name ?? 'creator'} style`;
    setPrompt('');
    setThread(t => [...t, { role: 'user', text: request }]);
    setThinking(true);
    let plan: Op[];
    let steps: AgentStep[];
    let note: string | undefined;
    try {
      if (!(await agentAvailable())) throw new Error('offline');
      const reply = await askAgent(request, { duration: d, aspect, style: style?.name, recipe: r && { name: r.name, shot: r.shot, len: r.len }, ops: ops.map(({ track, start, end, label }) => ({ track, start, end, label })) }, d);
      plan = reply.ops.map(o => op(o));
      steps = reply.steps.length ? reply.steps : stepsFor(plan, r);
      note = reply.reply || undefined;
    } catch (e) {
      plan = buildPlan(request, fixes, style?.name ?? 'creator', d, r?.shot);
      steps = stepsFor(plan, r);
      const msg = e instanceof Error ? e.message : '';
      if (/allowance/.test(msg)) note = msg;
    }
    commit(plan);
    setSelected(null);
    setThread(t => [...t, { role: 'agent', steps, note: note ?? 'Every change is on its own track — click a block to adjust it.' }]);
    setLog({ request, lines: steps.map(st => `${st.title} — ${st.text}`) });
    setThinking(false);
    if (projectTitle === 'Untitled edit') setProjectTitle(request.slice(0, 60));
  };

  const useRecipe = (r: (typeof RECIPES)[number]) => {
    setRecipe(r);
    setAspect('9:16');
    const d = file ? duration : r.len;
    setDuration(d);
    makeEdit(r.prompt, r, d);
  };

  const update = (id: string, patch: Partial<Op>) => commit(ops.map(o => (o.id === id ? { ...o, ...patch } : o)));
  const nudge = (o: Op, key: 'start' | 'end', by: number) => {
    const v = Math.max(0, Math.min(duration, +(o[key] + by).toFixed(2)));
    if (key === 'start' ? v < o.end : v > o.start) update(o.id, { [key]: v });
  };

  const planData = () => ({ mode, style: style?.id, recipe: recipe?.id, reference, versions, aspect, duration, request: log?.request, log, fixes: [...fixes], ops });

  const loadPlan = (d: Record<string, unknown>) => {
    const list = Array.isArray(d.ops) ? (d.ops as Op[]) : [];
    if (d.mode === 'clips' || d.mode === 'producer') setMode(d.mode);
    if (typeof d.style === 'string' && creatorStyles.some(c => c.id === d.style)) setStyleId(d.style);
    setRecipe(RECIPES.find(r => r.id === d.recipe) ?? null);
    setReference(typeof d.reference === 'string' ? d.reference : '');
    setVersions(typeof d.versions === 'number' ? Math.min(5, Math.max(1, d.versions)) : 1);
    if (d.aspect === '9:16' || d.aspect === '1:1' || d.aspect === '16:9') setAspect(d.aspect);
    if (typeof d.duration === 'number' && d.duration > 0) setDuration(d.duration);
    setFixes(new Set((Array.isArray(d.fixes) ? d.fixes : []).filter((f): f is FixId => FIXES.some(x => x.id === f))));
    const l = d.log as { request?: unknown; lines?: unknown } | null;
    const restored = l && typeof l.request === 'string' && Array.isArray(l.lines) ? { request: l.request, lines: l.lines.map(String) } : null;
    setLog(restored);
    setThread(restored ? [{ role: 'user', text: restored.request }, { role: 'agent', steps: restored.lines.map(x => { const [title, ...rest] = x.split(' — '); return { title, text: rest.join(' — ') }; }) }] : []);
    setHistory([[], list]);
    setCursor(1);
    setSelected(null);
    setTime(0);
  };

  const brief = useMemo(() => {
    const fixNames = FIXES.filter(f => fixes.has(f.id)).map(f => f.name).join(', ') || 'none';
    const rows = [...ops].sort((a, b) => a.start - b.start)
      .map(o => `- ${fmt(o.start)}–${fmt(o.end)} · ${TRACKS.find(t => t.id === o.track)?.name} · ${o.label} — ${o.why} [${o.tool}]`);
    return [
      'AI EDITOR BRIEF',
      `Mode: ${mode === 'producer' ? 'Raw footage → finished edit' : 'Long video → short clips'}`,
      `Footage: ${file?.name ?? '(attach in Claude Code)'} · ${fmt(duration)}`,
      `Style: ${style?.name ?? 'creator'} · Format: ${aspect}`,
      `Format recipe: ${recipe ? `${recipe.id} ${recipe.name} — target ${recipe.len} s, shots ~${recipe.shot} s, ~${recipe.wpm} wpm` : 'none (style defaults)'}`,
      `Reference: ${reference.trim() || 'none'}`,
      `Versions: ${versions}`,
      `Request: ${log?.request ?? '(none yet)'}`,
      `Quick fixes: ${fixNames}`,
      '',
      'Edit plan:',
      ...(rows.length ? rows : ['- (make an edit first)']),
      '',
      'Instructions for Claude Code:',
      '1. Start at docs/MASTER-ROUTER.md, then skills/creator-video/SKILL.md and the 136-reel creator study.',
      '2. Transcribe with word timings and confirm the transcript against the speech.',
      '3. Build an editable Remotion project with one layer per track above; keep the source file untouched.',
      '4. Captions: follow captions-skill and show check frames at 1.5 s, 4 s and 8 s before the full render.',
      ...(reference.trim() ? ['   Reference: break it down with the rea-video skill (docs/MASTER-ROUTER.md row "Copy / analyse a reference video"); copy pace and structure only, never its footage, voice or branding.'] : []),
      ...(versions > 1 ? [`   Make ${versions} distinct versions with python tools/video_workflow.py variants.`] : []),
      '5. Use only my footage and licensed music or SFX. Render after I approve the preview.',
    ].join('\n');
  }, [ops, fixes, mode, file, duration, style, aspect, log, recipe, reference, versions]);

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      flash('Brief copied — paste it into Claude Code.');
    } catch {
      flash('Copy blocked by the browser — use Download instead.');
    }
  };

  const active = (t: Track) => ops.find(o => o.track === t && time >= o.start && time < o.end);
  const aspectBox = aspect === '9:16' ? 'aspect-[9/16] max-h-[460px]' : aspect === '1:1' ? 'aspect-square max-h-[420px]' : 'aspect-video w-full';
  const BADGE: Record<Track, string> = { motion: 'MG', captions: 'CC', video: 'V1', broll: 'B', music: 'M', sfx: 'FX' };
  const canSplit = !!sel && time > sel.start + 0.1 && time < sel.end - 0.1;
  const split = () => {
    if (!sel || !canSplit) return;
    const t = +time.toFixed(2);
    commit(ops.flatMap(o => (o.id === sel.id ? [{ ...o, end: t }, { ...o, id: `op${++uid}`, start: t }] : [o])));
  };
  const remove = () => {
    if (!sel) return;
    commit(ops.filter(o => o.id !== sel.id));
    setSelected(null);
  };
  const toggle = (set: Set<Track>, t: Track, apply: (s: Set<Track>) => void) => {
    const n = new Set(set);
    if (n.has(t)) n.delete(t); else n.add(t);
    apply(n);
  };
  const shown = (t: Track) => (hidden.has(t) ? undefined : active(t));
  const empty = thread.length === 0;

  return (
    <div className="ai-editor pb-6">
      <AccountBar getPlan={planData} title={projectTitle.slice(0, 120)} onLoad={loadPlan} onOpenVideo={openFile} />

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl">
        {/* Top bar */}
        <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2 text-[#a1a1aa]">
          <a href="/" aria-label="Back to Master Video Styles" className="rounded-lg p-1.5 hover:bg-white/5 hover:text-white"><House size={16} /></a>
          <button aria-label="Undo" disabled={cursor === 0} onClick={() => setCursor(c => c - 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Undo2 size={16} /></button>
          <button aria-label="Redo" disabled={cursor >= history.length - 1} onClick={() => setCursor(c => c + 1)} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Redo2 size={16} /></button>
          <input
            value={projectTitle}
            onChange={e => setProjectTitle(e.target.value)}
            aria-label="Project name"
            className="mx-2 min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 py-1 text-center text-sm font-semibold text-white hover:bg-white/5 focus:bg-white/5"
          />
          <span className="hidden rounded-lg border border-white/10 p-0.5 text-xs sm:flex">
            {(['9:16', '1:1', '16:9'] as Aspect[]).map(a => (
              <button key={a} onClick={() => setAspect(a)} className={`rounded px-2 py-0.5 ${aspect === a ? 'bg-[#27272a] text-white' : 'hover:text-white'}`}>{a}</button>
            ))}
          </span>
          <div className="relative">
            <button onClick={() => setExportOpen(o => !o)} aria-expanded={exportOpen} className="ml-1 flex items-center gap-1.5 rounded-lg bg-[#fafafa] px-3.5 py-1.5 text-sm font-semibold text-[#09090b] hover:bg-[#e4e4e7]">
              Export <ChevronDown size={13} />
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-white/10 bg-[#18181b] text-sm shadow-2xl">
                <button onClick={() => { copyBrief(); setExportOpen(false); }} className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"><Copy size={14} /> Copy brief for Claude Code</button>
                <button onClick={() => { saveFile('ai-edit-plan.json', JSON.stringify(planData(), null, 2), 'application/json'); setExportOpen(false); }} className="flex w-full items-center gap-2 px-4 py-3 text-left text-white hover:bg-white/5"><Download size={14} /> Download plan (.json)</button>
                <p className="border-t border-white/10 px-4 py-2.5 text-[11px] text-[#8b8b94]">The render runs on your machine with the free skills.</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-[minmax(320px,380px)_1fr]">
          {/* AI / Transcript panel */}
          <div className="flex min-h-[420px] flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="flex gap-5 px-4 pt-3 text-xs font-semibold">
              {(['ai', 'transcript'] as const).map(t => (
                <button key={t} onClick={() => setPanel(t)} className={`pb-2 ${panel === t ? 'border-b-2 border-white text-white' : 'text-[#71717a] hover:text-white'}`}>{t === 'ai' ? 'AI' : 'Transcript'}</button>
              ))}
            </div>

            {panel === 'transcript' ? (
              <div className="flex-1 p-4 text-sm text-[#a1a1aa]">
                <p className="rounded-xl bg-[#18181b] p-4">Your transcript will appear here once you sign in and add a video.</p>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="max-h-[440px] flex-1 space-y-4 overflow-y-auto p-4">
                  {empty ? (
                    <>
                      <button onClick={() => fileRef.current?.click()} className="flex w-full flex-col items-center gap-2 rounded-2xl border border-dashed border-white/15 bg-[#09090b] px-4 py-6 text-center hover:border-white/30">
                        <Upload size={20} className="text-[#a1a1aa]" />
                        <span className="text-sm font-semibold text-white">{file ? file.name : 'Add your video'}</span>
                        <span className="text-xs text-[#8b8b94]">{file ? `${fmt(duration)} · ready` : 'It stays on your device'}</span>
                      </button>
                      <div>
                        <p className="mb-2 text-xs font-medium text-[#a1a1aa]">Start from a format</p>
                        <div className="flex flex-wrap gap-1.5">
                          {RECIPES.slice(0, 6).map(r => (
                            <button key={r.id} onClick={() => useRecipe(r)} className="rounded-full border border-white/10 bg-[#18181b] px-3 py-1.5 text-xs text-[#e4e4e7] hover:border-white/25 hover:text-white">{r.name}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="mb-2 text-xs font-medium text-[#a1a1aa]">Or just ask</p>
                        <div className="flex flex-wrap gap-1.5">
                          {QUICK_PROMPTS.slice(0, 4).map(q => (
                            <button key={q} onClick={() => makeEdit(q)} className="rounded-full border border-white/10 bg-[#18181b] px-3 py-1.5 text-xs text-[#e4e4e7] hover:border-white/25 hover:text-white">{q}</button>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    thread.map((m, i) => m.role === 'user' ? (
                      <div key={i} className="ml-8 rounded-2xl bg-[#27272a] px-4 py-3 text-sm text-white">{m.text}</div>
                    ) : (
                      <div key={i} className="space-y-3 text-sm">
                        {m.steps.map((st, k) => (
                          <div key={k}>
                            <p className="flex items-center gap-2 font-semibold text-white"><span className="h-2 w-2 rounded-full bg-[#52d68a]" />{st.title}</p>
                            <p className="mt-0.5 pl-4 text-[#a1a1aa]">{st.text}</p>
                          </div>
                        ))}
                        {m.note && <p className="text-xs text-[#71717a]">{m.note}</p>}
                      </div>
                    ))
                  )}
                  {thinking && <p className="flex items-center gap-2 text-sm text-[#a1a1aa]"><span className="h-2 w-2 rounded-full bg-[#a1a1aa]" /> Planning the edit…</p>}
                </div>

                <details className="border-t border-white/10 px-4 py-2 text-xs text-[#a1a1aa]">
                  <summary className="cursor-pointer select-none py-1 font-semibold text-[#d4d4d8]">Options{recipe ? ` · ${recipe.name}` : ''}</summary>
                  <div className="space-y-3 pb-2 pt-2">
                    <label className="block">Style
                      <select value={styleId} onChange={e => setStyleId(e.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-sm text-white">
                        {creatorStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </label>
                    <div className="flex gap-2">
                      <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Reference reel link (optional)" aria-label="Reference reel link" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-white placeholder:text-[#52525b]" />
                      <span className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#09090b] px-2" title="Versions to make">
                        <button aria-label="Fewer versions" onClick={() => setVersions(v => Math.max(1, v - 1))}><Minus size={12} /></button>
                        <span className="w-4 text-center tabular-nums text-white">{versions}</span>
                        <button aria-label="More versions" onClick={() => setVersions(v => Math.min(5, v + 1))}><Plus size={12} /></button>
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {FIXES.filter(f => f.local).map(f => {
                        const on = fixes.has(f.id);
                        return (
                          <button key={f.id} aria-pressed={on} title={f.tool} onClick={() => setFixes(s => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${on ? 'border-[#c5f04a]/60 bg-[#1a1d10] text-[#c5f04a]' : 'border-white/10 text-[#a1a1aa]'}`}>
                            <f.icon size={12} /> {f.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </details>

                <form onSubmit={e => { e.preventDefault(); makeEdit(); }} className="p-3 pt-0">
                  <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#18181b] p-2 pl-3 focus-within:border-white/25">
                    <textarea
                      value={prompt}
                      onChange={e => setPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); makeEdit(); } }}
                      rows={2}
                      placeholder="Tell AI what to change…"
                      aria-label="Tell the editor what to change"
                      className="min-h-[44px] flex-1 resize-none bg-transparent py-1 text-sm text-white outline-none placeholder:text-[#52525b]"
                    />
                    <button aria-label="Send" disabled={thinking} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#fafafa] text-[#09090b] hover:bg-[#e4e4e7] disabled:opacity-50"><ArrowUp size={16} /></button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-1 items-center justify-center bg-[#09090b] p-4">
              <div className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#1f2230] via-[#141417] to-[#26262a] ${aspectBox}`}>
                {file ? (
                  <video
                    ref={videoRef}
                    src={file.url}
                    className="h-full w-full object-cover"
                    playsInline
                    muted={muted.has('video')}
                    onLoadedMetadata={e => setDuration(Math.max(1, e.currentTarget.duration || 45))}
                    onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                ) : (
                  <button onClick={() => fileRef.current?.click()} className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-[#8b8b94] hover:text-white">
                    <Upload size={18} /> {ops.length ? 'Add your video to see the plan on it' : 'Add your video to preview it here'}
                  </button>
                )}
                {shown('broll') && <div className="absolute inset-x-3 top-3 rounded-lg bg-[#6b7fd6]/85 px-2 py-1 text-[11px] font-semibold text-white">B-roll: {shown('broll')!.label}</div>}
                {shown('motion') && <div className="pointer-events-none absolute inset-x-0 top-1/3 px-4 text-center text-2xl font-bold leading-tight text-white sm:text-3xl">{shown('motion')!.label}</div>}
                {shown('captions') && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-[18%] text-center">
                    <span className="rounded-md bg-black/70 px-2 py-1 text-sm font-extrabold text-white">your <span className="text-[#c5f04a]">words</span> here</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 text-xs text-[#a1a1aa]">
              <button
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => {
                  const v = videoRef.current;
                  if (v) return v.paused ? void v.play() : v.pause();
                  setPlaying(p => !p);
                }}
                className="rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
              >
                {playing ? <Pause size={13} /> : <Play size={13} />}
              </button>
              <span className="tabular-nums">{fmt(time)} / {fmt(duration)}</span>
              <span className="ml-auto">{ops.length} edits</span>
            </div>
          </div>
        </div>
        <input ref={fileRef} type="file" accept="video/*" hidden onChange={pickFile} />

        {/* Timeline */}
        <div className="border-t border-white/10 px-3 pb-3 pt-2">
          <div className="mb-2 flex items-center gap-1 text-[#a1a1aa]">
            <button aria-label="Split at playhead" title="Split the selected block at the playhead" disabled={!canSplit} onClick={split} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Scissors size={15} /></button>
            <button aria-label="Delete selected block" disabled={!sel} onClick={remove} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30"><Trash2 size={15} /></button>
            <span className="ml-auto text-[11px] text-[#71717a]">{sel ? 'Drag the playhead, then split — or edit the block below' : 'Click a block to change it'}</span>
          </div>
          <div
            className="relative space-y-1"
            onClick={e => {
              const box = e.currentTarget.getBoundingClientRect();
              const lane = box.left + LANE;
              if (e.clientX < lane) return;
              const t = Math.max(0, Math.min(duration, ((e.clientX - lane) / (box.right - lane)) * duration));
              setTime(t);
              if (videoRef.current) videoRef.current.currentTime = t;
            }}
          >
            {TRACKS.map(t => {
              const off = hidden.has(t.id);
              const audio = t.id === 'music' || t.id === 'sfx' || t.id === 'video';
              return (
                <div key={t.id} className="flex items-center gap-2">
                  <span className="flex shrink-0 items-center gap-1" style={{ width: LANE - 8 }}>
                    <span className="w-7 rounded bg-[#27272a] py-0.5 text-center text-[10px] font-bold text-[#d4d4d8]" title={t.name}>{BADGE[t.id]}</span>
                    <button aria-label={`${off ? 'Show' : 'Hide'} ${t.name}`} onClick={e => { e.stopPropagation(); toggle(hidden, t.id, setHidden); }} className="rounded p-1 text-[#71717a] hover:text-white">{off ? <EyeOff size={12} /> : <Eye size={12} />}</button>
                    {audio && <button aria-label={`${muted.has(t.id) ? 'Unmute' : 'Mute'} ${t.name}`} onClick={e => { e.stopPropagation(); toggle(muted, t.id, setMuted); }} className="rounded p-1 text-[#71717a] hover:text-white">{muted.has(t.id) ? <VolumeX size={12} /> : <Volume2 size={12} />}</button>}
                  </span>
                  <div className={`relative h-8 flex-1 rounded-md bg-white/[0.03] ${off ? 'opacity-30' : ''}`}>
                    {ops.filter(o => o.track === t.id).map(o => (
                      <button
                        key={o.id}
                        title={`${o.label} — ${o.why}`}
                        onClick={e => { e.stopPropagation(); setSelected(o.id); }}
                        className={`absolute top-0.5 bottom-0.5 min-w-[6px] truncate rounded px-1.5 text-left text-[10px] font-semibold ${t.color} ${selected === o.id ? 'ring-2 ring-white' : ''}`}
                        style={{ left: `${(o.start / duration) * 100}%`, width: `${((o.end - o.start) / duration) * 100}%` }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-[#f97316]" style={{ left: `calc(${LANE}px + (100% - ${LANE}px) * ${Math.min(1, time / duration)})` }} />
          </div>

          {sel && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#18181b] p-2.5 text-xs text-[#d4d4d8]">
              <input value={sel.label} onChange={e => update(sel.id, { label: e.target.value })} aria-label="Block label" className="w-40 rounded border border-white/10 bg-[#09090b] px-2 py-1 text-white" />
              {(['start', 'end'] as const).map(k => (
                <span key={k} className="flex items-center gap-1">
                  {k}
                  <button aria-label={`Earlier ${k}`} onClick={() => nudge(sel, k, -0.5)} className="rounded bg-white/5 p-0.5"><Minus size={11} /></button>
                  <span className="w-9 text-center tabular-nums">{sel[k].toFixed(1)}s</span>
                  <button aria-label={`Later ${k}`} onClick={() => nudge(sel, k, 0.5)} className="rounded bg-white/5 p-0.5"><Plus size={11} /></button>
                </span>
              ))}
              <p className="basis-full text-[11px] text-[#8b8b94]">{sel.why} · <span className="text-[#c5f04a]">{sel.tool}</span></p>
            </div>
          )}
        </div>
      </div>

      {notice && <p role="status" className="fixed bottom-6 left-1/2 z-30 -translate-x-1/2 rounded-full bg-[#fafafa] px-4 py-2 text-sm font-semibold text-[#09090b] shadow-2xl">{notice}</p>}
    </div>
  );
}
