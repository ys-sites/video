import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Upload, Wand2, Scissors, Mic, Eye, Eraser, Sparkles, ZoomIn, Undo2, Redo2, Trash2,
  Play, Pause, Download, Copy, Bot, Music, Film, Type, Check, ArrowRight, Terminal,
  Keyboard, Palette, Crop, Captions, ChevronDown, Layers3, Volume2, ImageIcon, Minus, Plus,
} from 'lucide-react';
import { builtInStyles } from '../styles';

// Layout ideas from REA captures of opus.pro/ai-video-editor, chatcut.io and
// captions.ai/features/edit-with-ai (2026-11-19, notes in docs/ai-editor-research.md).
// All copy here is our own. The page plans the edit; Claude Code renders it locally.

type Track = 'video' | 'captions' | 'motion' | 'broll' | 'music' | 'sfx';
type Op = { id: string; track: Track; start: number; end: number; label: string; why: string; tool: string };
type Aspect = '9:16' | '16:9' | '1:1';

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

const FAQ = [
  ['Does this page edit my video?', 'It plans the edit. Your clip plays in your browser and never leaves it. The plan becomes a brief that Claude Code turns into an editable Remotion project on your machine, where the real render happens.'],
  ['Which footage works best?', 'Talking-head clips, walk-and-talks, tours and screen recordings with clear speech. The planner leans on word timings, so audible speech gives the best cuts.'],
  ['Can I change what the AI decided?', 'Yes. Click any block on the timeline to rename it, move it, stretch it or delete it. Undo and redo keep every step. The brief always matches what you see.'],
  ['Where do the style rules come from?', 'From the 136-reel creator study and the style library on this site: median shot 1.4 s, first word within 0.5 s, captions in the safe zone, one clear ask.'],
  ['Does it fake people or voices?', 'No. It edits your real footage. Voice cloning and eye-contact tools stay off unless you own the voice and face and ask for them.'],
  ['Can I use it from my agent?', 'Copy the brief into Claude Code. The repo routes it through docs/MASTER-ROUTER.md to the creator-video, Remotion, captions and effects skills.'],
];

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
  const [featureTab, setFeatureTab] = useState(0);
  const [reference, setReference] = useState('');
  const [versions, setVersions] = useState(1);
  const [recipe, setRecipe] = useState<(typeof RECIPES)[number] | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

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

  const pickFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!f.type.startsWith('video/')) return flash('Pick a video file.');
    setFile({ name: f.name, url: URL.createObjectURL(f) });
    setTime(0);
  };

  const makeEdit = (text = prompt, r = recipe, d = duration) => {
    const request = text.trim() || `Edit this in ${style?.name ?? 'creator'} style`;
    const plan = buildPlan(request, fixes, style?.name ?? 'creator', d, r?.shot);
    commit(plan);
    setSelected(null);
    const byTrack = (t: Track) => plan.filter(o => o.track === t).length;
    const lines = [
      byTrack('video') > 1 ? `Cut the footage into ${byTrack('video')} tight takes and dropped the pauses.` : 'Kept your take whole.',
      ...Array.from(new Set(plan.filter(o => o.track !== 'video').map(o => `${o.label} — ${o.why}`))).slice(0, 5),
      `Styled for ${style?.name ?? 'creator'} at ${aspect}${r ? `, paced like a ${r.name} (${r.reels} studied reels)` : ''}.`,
      ...(reference.trim() ? ['Reference noted — it gets a shot-by-shot breakdown before the cut.'] : []),
    ];
    setLog({ request, lines });
    setPrompt('');
  };

  const update = (id: string, patch: Partial<Op>) => commit(ops.map(o => (o.id === id ? { ...o, ...patch } : o)));
  const nudge = (o: Op, key: 'start' | 'end', by: number) => {
    const v = Math.max(0, Math.min(duration, +(o[key] + by).toFixed(2)));
    if (key === 'start' ? v < o.end : v > o.start) update(o.id, { [key]: v });
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
  const goEditor = (m: 'producer' | 'clips') => {
    setMode(m);
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const features = [
    { tag: 'Speed', title: 'Edit the words, the video follows', items: [
      { icon: Type, name: 'Edit by transcript', text: 'Delete a sentence in the text and the cut follows. Retiming captions is a text edit, not a keyframe hunt.' },
      { icon: Layers3, name: 'Timeline when you need it', text: 'Every AI decision is a block you can move, stretch, rename or delete, with undo for each step.' },
      { icon: Keyboard, name: 'Shortcuts in the studio', text: 'Remotion Studio previews frame by frame with keyboard scrubbing before anything renders.' },
    ] },
    { tag: 'Brand', title: 'Your look on every video', items: [
      { icon: Palette, name: 'Style presets', text: `${creatorStyles.length} creator styles plus the 18-style mega prompt set the type, colour and pace.` },
      { icon: Crop, name: 'Reframe for any feed', text: 'Switch 9:16, 1:1 or 16:9 and the plan keeps captions inside the safe zone.' },
      { icon: ImageIcon, name: 'Bring your assets', text: 'Logos, product shots and your own B-roll go in their own track so they are never regenerated.' },
    ] },
    { tag: 'AI', title: 'One prompt, a full pass', items: [
      { icon: Captions, name: 'Captions that pop', text: 'Word-timed captions with keyword highlights, checked on three frames before rendering.' },
      { icon: Sparkles, name: '45 face-tracked effects', text: 'Spotlight, orbit, glass widgets and punch-ins that track the speaker and can sit behind them.' },
      { icon: Mic, name: 'Clean voice', text: 'Denoise and loudness to −14 LUFS so it sounds the same on every platform.' },
    ] },
  ];

  return (
    <div className="ai-editor space-y-16 pb-6">
      {/* Hero: one promise, two ways in */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#09090b] px-6 py-14 sm:px-12 text-center shadow-2xl">
        <div className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[720px] -translate-x-1/2 rounded-full bg-gradient-to-r from-[#7890ff]/25 via-[#c5f04a]/20 to-[#4f8a72]/25 blur-3xl" />
        <p className="relative text-[11px] font-bold tracking-[0.25em] text-[#c5f04a]">CHAT-TO-EDIT STUDIO</p>
        <h1 className="relative mt-4 text-4xl sm:text-6xl font-bold tracking-tight text-white leading-[1.05]">
          Say the edit.<br />Keep the final cut.
        </h1>
        <p className="relative mx-auto mt-5 max-w-xl text-[#a1a1aa] text-sm sm:text-base">
          Drop in your footage, describe what you want, and get a full edit plan you can change block by block — then render it on your own machine.
        </p>
        <div className="relative mx-auto mt-10 grid max-w-4xl gap-4 sm:grid-cols-2 text-left">
          {[
            { m: 'clips' as const, kicker: 'Long video → short clips', title: 'Find the moments, cut the clips, reframe for every feed', cta: 'Plan clips' },
            { m: 'producer' as const, kicker: 'Raw footage → finished video', title: 'Describe the edit in plain words and steer every change', cta: 'Start editing' },
          ].map(c => (
            <button key={c.m} onClick={() => goEditor(c.m)} className="group rounded-2xl border border-white/10 bg-[#171718] p-6 transition hover:border-[#c5f04a]/40 hover:bg-[#1f1f22]">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#a1a1aa]">{c.kicker}</p>
              <p className="mt-2 text-lg font-semibold text-white">{c.title}</p>
              <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#111] transition group-hover:gap-3">
                {c.cta} <ArrowRight size={14} />
              </span>
            </button>
          ))}
        </div>
        <p className="relative mt-8 text-xs text-[#8b8b94]">Built on 136 studied reels · {creatorStyles.length} creator styles · 45 effects · footage never leaves your browser</p>
      </section>

      {/* Editor: chat on the left, preview and timeline on the right */}
      <section ref={editorRef} className="scroll-mt-6">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">TRY IT NOW</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Tell it what to change</h2>
            <p className="mt-1 text-sm text-[#a1a1aa]">
              {mode === 'producer' ? 'Raw footage → finished edit.' : 'Long video → short clips.'} Pick a style, add quick fixes, then chat.
            </p>
          </div>
          <div className="flex rounded-xl border border-white/10 bg-[#111113] p-1 text-xs font-semibold">
            {(['producer', 'clips'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-lg px-3 py-1.5 ${mode === m ? 'bg-[#27272a] text-white' : 'text-[#a1a1aa] hover:text-white'}`}>
                {m === 'producer' ? 'Full edit' : 'Clips'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid overflow-hidden rounded-3xl border border-white/10 bg-[#171718] shadow-2xl lg:grid-cols-[380px_1fr]">
          {/* Chat panel */}
          <div className="flex flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-xs text-[#a1a1aa]">
              <Bot size={14} className="text-[#c5f04a]" /> Edit agent
              <span className="ml-auto flex gap-1">
                <button aria-label="Undo" disabled={cursor === 0} onClick={() => setCursor(c => c - 1)} className="rounded p-1 hover:bg-white/5 disabled:opacity-30"><Undo2 size={14} /></button>
                <button aria-label="Redo" disabled={cursor >= history.length - 1} onClick={() => setCursor(c => c + 1)} className="rounded p-1 hover:bg-white/5 disabled:opacity-30"><Redo2 size={14} /></button>
              </span>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-4 max-h-[520px]">
              <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl border border-dashed border-white/15 bg-[#09090b] p-3 text-left text-xs text-[#d4d4d8] hover:border-[#c5f04a]/50">
                <Upload size={16} className="shrink-0 text-[#c5f04a]" />
                <span className="truncate">{file ? `${file.name} · ${fmt(duration)}` : 'Add footage (stays on this device)'}</span>
              </button>
              <input ref={fileRef} type="file" accept="video/*" hidden onChange={pickFile} />

              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#8b8b94]">
                Style
                <select value={styleId} onChange={e => setStyleId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-sm normal-case tracking-normal text-white">
                  {creatorStyles.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>

              <div className="flex gap-2">
                <input
                  value={reference}
                  onChange={e => setReference(e.target.value)}
                  placeholder="Reference reel link (optional)"
                  aria-label="Reference reel link"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-xs text-white placeholder:text-[#52525b]"
                />
                <span className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#09090b] px-2 text-xs text-[#d4d4d8]" title="Versions to make">
                  <button aria-label="Fewer versions" onClick={() => setVersions(v => Math.max(1, v - 1))}><Minus size={12} /></button>
                  <span className="w-4 text-center tabular-nums">{versions}</span>
                  <button aria-label="More versions" onClick={() => setVersions(v => Math.min(5, v + 1))}><Plus size={12} /></button>
                </span>
              </div>
              {recipe && (
                <p className="flex items-center gap-2 rounded-lg bg-[#1a1d10] px-3 py-1.5 text-[11px] text-[#c5f04a]">
                  Format: {recipe.name} · shots ~{recipe.shot} s · {recipe.len} s
                  <button className="ml-auto text-[#a1a1aa] hover:text-white" onClick={() => setRecipe(null)}>clear</button>
                </p>
              )}

              {log ? (
                <div className="space-y-3 text-sm">
                  <div className="ml-6 rounded-xl bg-[#27272a] p-3 text-[#fafafa]">{log.request}</div>
                  <div className="rounded-xl bg-[#09090b] p-3 text-[#d4d4d8]">
                    <p className="mb-2 flex items-center gap-1.5 text-xs text-[#52d68a]"><Check size={13} /> Edit ready — here's what changed and why:</p>
                    <ul className="space-y-1.5 text-[13px]">
                      {log.lines.map((l, i) => <li key={i}>• {l}</li>)}
                    </ul>
                    <p className="mt-3 text-xs text-[#8b8b94]">Each change sits on its own track. Click a block to adjust it by hand.</p>
                  </div>
                </div>
              ) : (
                <p className="rounded-xl bg-[#09090b] p-3 text-sm text-[#a1a1aa]">
                  Describe the edit — or tap a suggestion. I'll plan cuts, captions, motion, music and sound, and explain each decision.
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                {QUICK_PROMPTS.map(q => (
                  <button key={q} onClick={() => makeEdit(q)} className="rounded-full border border-white/10 bg-[#1f1f22] px-2.5 py-1 text-[11px] text-[#d4d4d8] hover:border-[#c5f04a]/50 hover:text-white">{q}</button>
                ))}
              </div>
            </div>

            <form onSubmit={e => { e.preventDefault(); makeEdit(); }} className="flex gap-2 border-t border-white/10 p-3">
              <input
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="e.g. Make it punchy, add captions and a clear ask"
                aria-label="Tell the editor what to change"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#09090b] px-3 py-2 text-sm text-white placeholder:text-[#52525b]"
              />
              <button className="flex items-center gap-1.5 rounded-lg bg-[#c5f04a] px-3 py-2 text-xs font-bold text-[#0b0f00] hover:bg-[#d4f56f]"><Wand2 size={14} /> Edit</button>
            </form>
          </div>

          {/* Preview + timeline */}
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-[#a1a1aa]">
              <span className="truncate">{file?.name ?? 'Preview'}</span>
              <span className="ml-auto flex rounded-lg border border-white/10 p-0.5">
                {(['9:16', '1:1', '16:9'] as Aspect[]).map(a => (
                  <button key={a} onClick={() => setAspect(a)} className={`rounded px-2 py-0.5 ${aspect === a ? 'bg-[#27272a] text-white' : 'hover:text-white'}`}>{a}</button>
                ))}
              </span>
            </div>

            <div className="flex flex-1 items-center justify-center bg-[#0b0b0c] p-4">
              <div className={`relative overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#1f2230] via-[#141417] to-[#26262a] ${aspectBox}`}>
                {file ? (
                  <video
                    ref={videoRef}
                    src={file.url}
                    className="h-full w-full object-cover"
                    playsInline
                    onLoadedMetadata={e => setDuration(Math.max(1, e.currentTarget.duration || 45))}
                    onTimeUpdate={e => setTime(e.currentTarget.currentTime)}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center p-6 text-center text-xs text-[#71717a]">
                    {ops.length ? 'Plan preview — add footage to see it on your clip' : 'Add footage or tap a suggestion'}
                  </div>
                )}
                {active('broll') && <div className="absolute inset-x-3 top-3 rounded-lg bg-[#6b7fd6]/85 px-2 py-1 text-[11px] font-semibold text-white">B-roll: {active('broll')!.label}</div>}
                {active('motion') && (
                  <div className="absolute inset-x-0 top-1/3 px-4 text-center text-2xl sm:text-3xl font-black uppercase leading-none text-[#e8ff9a] drop-shadow-[0_3px_0_rgba(0,0,0,0.6)]">{active('motion')!.label}</div>
                )}
                {active('captions') && (
                  <div className="absolute inset-x-0 bottom-[18%] text-center">
                    <span className="rounded-md bg-black/70 px-2 py-1 text-sm font-extrabold text-white">your <span className="text-[#c5f04a]">words</span> here</span>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 bg-[#111113] px-3 py-3">
              <div className="mb-2 flex items-center gap-3 text-xs text-[#a1a1aa]">
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
                <span className="ml-auto hidden sm:inline">{ops.length} edits · click a block to change it</span>
              </div>

              <div
                className="relative space-y-1"
                onClick={e => {
                  const box = e.currentTarget.getBoundingClientRect();
                  const lane = box.left + 112;
                  if (e.clientX < lane) return;
                  const t = ((e.clientX - lane) / (box.right - lane)) * duration;
                  setTime(t);
                  if (videoRef.current) videoRef.current.currentTime = t;
                }}
              >
                {TRACKS.map(t => (
                  <div key={t.id} className="flex items-center gap-2">
                    <span className="flex w-[104px] shrink-0 items-center gap-1.5 truncate text-[10px] text-[#8b8b94]"><t.icon size={11} /> {t.name}</span>
                    <div className="relative h-6 flex-1 rounded bg-white/[0.03]">
                      {ops.filter(o => o.track === t.id).map(o => (
                        <button
                          key={o.id}
                          title={`${o.label} — ${o.why}`}
                          onClick={e => { e.stopPropagation(); setSelected(o.id); }}
                          className={`absolute top-0.5 bottom-0.5 min-w-[6px] truncate rounded px-1 text-left text-[10px] font-semibold ${t.color} ${selected === o.id ? 'ring-2 ring-white' : ''}`}
                          style={{ left: `${(o.start / duration) * 100}%`, width: `${((o.end - o.start) / duration) * 100}%` }}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-[#c5f04a]" style={{ left: `calc(112px + (100% - 112px) * ${Math.min(1, time / duration)})` }} />
              </div>

              {sel && (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#18181b] p-2.5 text-xs text-[#d4d4d8]">
                  <input
                    value={sel.label}
                    onChange={e => update(sel.id, { label: e.target.value })}
                    aria-label="Block label"
                    className="w-40 rounded border border-white/10 bg-[#09090b] px-2 py-1 text-white"
                  />
                  {(['start', 'end'] as const).map(k => (
                    <span key={k} className="flex items-center gap-1">
                      {k}
                      <button aria-label={`Earlier ${k}`} onClick={() => nudge(sel, k, -0.5)} className="rounded bg-white/5 p-0.5"><Minus size={11} /></button>
                      <span className="w-9 text-center tabular-nums">{sel[k].toFixed(1)}s</span>
                      <button aria-label={`Later ${k}`} onClick={() => nudge(sel, k, 0.5)} className="rounded bg-white/5 p-0.5"><Plus size={11} /></button>
                    </span>
                  ))}
                  <button onClick={() => { commit(ops.filter(o => o.id !== sel.id)); setSelected(null); }} className="ml-auto flex items-center gap-1 rounded bg-[#4a1f1f] px-2 py-1 text-[#ffb4b4] hover:bg-[#5c2626]"><Trash2 size={12} /> Remove</button>
                  <p className="basis-full text-[11px] text-[#8b8b94]">{sel.why} · <span className="text-[#c5f04a]">{sel.tool}</span></p>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={copyBrief} className="flex items-center gap-1.5 rounded-lg bg-[#27272a] px-3 py-2 text-xs font-semibold text-white hover:bg-[#3f3f46]"><Copy size={13} /> Copy brief for Claude Code</button>
                <button onClick={() => saveFile('ai-edit-plan.json', JSON.stringify({ mode, style: style?.id, recipe: recipe?.id, reference, versions, aspect, duration, request: log?.request, fixes: [...fixes], ops }, null, 2), 'application/json')} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-[#d4d4d8] hover:text-white"><Download size={13} /> Edit plan (.json)</button>
                {notice && <span className="self-center text-xs text-[#52d68a]">{notice}</span>}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recreate a proven format */}
      <section>
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">RECREATE THIS</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Start from a format that already works</h2>
        <p className="mt-1 text-sm text-[#a1a1aa]">Each one is measured from the 136-reel study: real lengths, real shot timing, real talking speed.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RECIPES.map(r => (
            <div key={r.id} className="flex flex-col rounded-2xl border border-white/10 bg-[#171718] p-5">
              <div className="flex items-baseline gap-2">
                <span className="rounded bg-[#27272a] px-1.5 py-0.5 font-mono text-[10px] text-[#d4d4d8]">{r.id}</span>
                <span className="font-semibold text-white">{r.name}</span>
                <span className="ml-auto text-[11px] text-[#8b8b94]">{r.reels} reels</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                {[[`${r.len}s`, 'length'], [`${r.shot}s`, 'per shot'], [`${r.wpm}`, 'words/min']].map(([v, l]) => (
                  <div key={l} className="rounded-lg bg-[#09090b] py-2">
                    <p className="font-bold tabular-nums text-white">{v}</p>
                    <p className="text-[10px] text-[#8b8b94]">{l}</p>
                  </div>
                ))}
              </div>
              <button
                aria-label={`Recreate ${r.name}`}
                onClick={() => { setRecipe(r); setAspect('9:16'); const d = file ? duration : r.len; setDuration(d); goEditor('producer'); makeEdit(r.prompt, r, d); }}
                className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-white/15 py-2 text-xs font-semibold text-white hover:border-[#c5f04a]/60 hover:bg-[#1a1d10]"
              >
                Recreate this <ArrowRight size={13} />
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Quick fixes */}
      <section>
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">ONE-TAP FIXES</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Fix the recording, not just the edit</h2>
        <p className="mt-1 text-sm text-[#a1a1aa]">Switch them on and they join the next edit. Each one says which tool does the work.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIXES.map(f => {
            const on = fixes.has(f.id);
            return (
              <button
                key={f.id}
                onClick={() => setFixes(s => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })}
                aria-pressed={on}
                className={`rounded-2xl border p-5 text-left transition ${on ? 'border-[#c5f04a]/60 bg-[#1a1d10]' : 'border-white/10 bg-[#171718] hover:border-white/20'}`}
              >
                <div className="flex items-center gap-2">
                  <f.icon size={18} className={on ? 'text-[#c5f04a]' : 'text-[#a1a1aa]'} />
                  <span className="font-semibold text-white">{f.name}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${on ? 'bg-[#c5f04a] text-[#0b0f00]' : 'bg-white/5 text-[#8b8b94]'}`}>{on ? 'ON' : 'OFF'}</span>
                </div>
                <p className="mt-2 text-sm text-[#a1a1aa]">{f.text}</p>
                <p className={`mt-3 text-[11px] ${f.local ? 'text-[#c5f04a]' : 'text-[#e0a37a]'}`}>{f.tool}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Workflow */}
      <section>
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">THE LOOP</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Cut, polish, check, reuse</h2>
        <div className="mt-6 grid gap-3 md:grid-cols-4">
          {[
            ['01', 'Cut it clean', 'The transcript drives the cut: fillers out, strongest line first.'],
            ['02', 'Polish in one pass', 'Captions, motion, B-roll, music and sound land on separate tracks.'],
            ['03', 'Check it by hand', 'Preview in Remotion Studio, adjust any block, approve before rendering.'],
            ['04', 'Save it as a skill', 'Keep the recipe as a style and batch the next ten videos with it.'],
          ].map(([n, t, d]) => (
            <div key={n} className="rounded-2xl border border-white/10 bg-[#171718] p-5">
              <p className="font-mono text-xs text-[#c5f04a]">{n}</p>
              <p className="mt-2 font-semibold text-white">{t}</p>
              <p className="mt-1.5 text-sm text-[#a1a1aa]">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature tabs */}
      <section>
        <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">HANDS-ON WHEN YOU WANT IT</p>
        <h2 className="mt-2 text-3xl font-bold text-white">Automatic for speed, manual for precision</h2>
        <div className="mt-6 flex gap-2">
          {features.map((f, i) => (
            <button key={f.tag} onClick={() => setFeatureTab(i)} className={`rounded-full px-4 py-1.5 text-xs font-semibold ${featureTab === i ? 'bg-white text-[#111]' : 'border border-white/10 text-[#a1a1aa] hover:text-white'}`}>{f.tag}</button>
          ))}
        </div>
        <div className="mt-4 rounded-3xl border border-white/10 bg-[#171718] p-6">
          <h3 className="text-xl font-semibold text-white">{features[featureTab].title}</h3>
          <div className="mt-5 grid gap-4 md:grid-cols-3">
            {features[featureTab].items.map(it => (
              <div key={it.name} className="rounded-2xl bg-[#09090b] p-5">
                <it.icon size={18} className="text-[#c5f04a]" />
                <p className="mt-3 font-semibold text-white">{it.name}</p>
                <p className="mt-1.5 text-sm text-[#a1a1aa]">{it.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Which mode */}
      <section>
        <h2 className="text-3xl font-bold text-white">Which way in?</h2>
        <p className="mt-1 text-sm text-[#a1a1aa]">Same studio, two starting points.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {[
            { m: 'producer' as const, kicker: 'Edit agent', title: 'Full edit', lead: 'Start with raw footage and finish with a post-ready video.', points: ['Your real footage — no avatars or synthetic speakers', 'Captions, motion, B-roll, music and sound in one pass', 'Every decision explained; you approve the changes'] },
            { m: 'clips' as const, kicker: 'Clip finder', title: 'Clips', lead: 'Start with a long talk or podcast and pull the best moments.', points: ['Moments chosen by hook, payoff and a clean ending', 'Reframed to 9:16 with captions in the safe zone', 'Each clip gets its own brief for batch rendering'] },
          ].map(c => (
            <div key={c.m} className="rounded-3xl border border-white/10 bg-[#171718] p-6">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#c5f04a]">{c.kicker}</p>
              <h3 className="mt-1 text-xl font-semibold text-white">{c.title}</h3>
              <p className="mt-1 text-sm text-[#a1a1aa]">{c.lead}</p>
              <ul className="mt-4 space-y-2 text-sm text-[#d4d4d8]">
                {c.points.map(p => <li key={p} className="flex gap-2"><Check size={15} className="mt-0.5 shrink-0 text-[#52d68a]" /> {p}</li>)}
              </ul>
              <button onClick={() => goEditor(c.m)} className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#111]">Use {c.title} <ArrowRight size={13} /></button>
            </div>
          ))}
        </div>
      </section>

      {/* Agent */}
      <section className="rounded-3xl border border-white/10 bg-gradient-to-br from-[#171718] to-[#111113] p-6 sm:p-8">
        <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-[11px] font-bold tracking-[0.2em] text-[#c5f04a]">IN YOUR AGENT</p>
            <h2 className="mt-2 text-3xl font-bold text-white">Plan here, render with Claude Code</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">The brief is written for this repo. Claude Code follows the master router to the right skills and keeps every layer editable.</p>
          </div>
          <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-black/60 p-4 text-[12px] leading-relaxed text-[#d4d4d8]"><span className="text-[#8b8b94]"><Terminal size={12} className="mr-1 inline" />claude</span>{'\n'}&gt; [paste brief]{'\n'}<span className="text-[#c5f04a]">→ docs/MASTER-ROUTER.md</span>{'\n'}<span className="text-[#c5f04a]">→ skills/creator-video  · remotion  · captions-skill  · effects</span>{'\n'}<span className="text-[#c5f04a]">✓ editable Remotion project · preview · render on approval</span></pre>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <h2 className="text-3xl font-bold text-white">Questions</h2>
        <div className="mt-6 divide-y divide-white/10 rounded-3xl border border-white/10 bg-[#171718]">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button onClick={() => setOpenFaq(openFaq === i ? null : i)} aria-expanded={openFaq === i} className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left font-semibold text-white">
                {q}
                <ChevronDown size={16} className={`shrink-0 text-[#a1a1aa] transition ${openFaq === i ? 'rotate-180' : ''}`} />
              </button>
              {openFaq === i && <p className="px-6 pb-5 text-sm text-[#a1a1aa]">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="text-center">
        <h2 className="text-3xl sm:text-4xl font-bold text-white">Start editing by describing it</h2>
        <button onClick={() => goEditor('producer')} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#c5f04a] px-6 py-3 text-sm font-bold text-[#0b0f00] hover:bg-[#d4f56f]">Open the editor <ArrowRight size={15} /></button>
        <p className="mt-3 text-xs text-[#8b8b94]">Free. No upload. No account.</p>
      </section>
    </div>
  );
}
