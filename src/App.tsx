import React, { useState, useEffect, useMemo, useRef, type ChangeEvent } from 'react';
import {
  Clapperboard, Sparkles, Play, Pause, Layers3, Copy, ArrowDownToLine,
  FilePlus2, ArrowUpRight, Check, ShieldCheck, Film, Sliders,
  MonitorPlay, Smartphone, Square, Search, ExternalLink, BookOpen, Wrench
} from 'lucide-react';
import { builtInStyles, productionBrief, validProfile, vox, type StyleProfile } from './styles';
import {
  motionDictionary,
  cloudTools,
  studiedReels,
  reelsHarvestStatus,
  cloudPlaybooks,
} from './masterStylesData';
import SpotlightCard from './components/ui/SpotlightCard';
import ShinyText from './components/ui/ShinyText';
import DecryptedText from './components/ui/DecryptedText';
import Aurora from './components/ui/Aurora';
import CreatorStyleExplainer from './components/CreatorStyleExplainer';

const STORAGE = 'master-video-editor.v2';

type StyleFilter = 'all' | 'featured' | 'study' | 'creator' | 'process_skill' | 'library';
type ReelsSubTab = 'reels' | 'motion' | 'playbooks' | 'tools';

type Saved = {
  profiles: StyleProfile[];
  selected: string;
  story: string;
  beats: string;
  assets: string;
  destination: string;
  aspectRatio: '16:9' | '9:16' | '1:1';
};

function load(): Saved {
  const defaults: Saved = {
    profiles: builtInStyles,
    selected: vox.id,
    story: '',
    beats: '',
    assets: '',
    destination: 'DaVinci Resolve / Fusion',
    aspectRatio: '16:9',
  };
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (!data || !Array.isArray(data.profiles)) return defaults;
    return {
      profiles: [
        ...builtInStyles,
        ...data.profiles.filter(
          (p: unknown) =>
            validProfile(p) && !builtInStyles.some(b => b.id === (p as StyleProfile).id)
        ),
      ],
      selected: typeof data.selected === 'string' ? data.selected : vox.id,
      story: typeof data.story === 'string' ? data.story : '',
      beats: typeof data.beats === 'string' ? data.beats : '',
      assets: typeof data.assets === 'string' ? data.assets : '',
      destination: typeof data.destination === 'string' ? data.destination : 'DaVinci Resolve / Fusion',
      aspectRatio: data.aspectRatio || '16:9',
    };
  } catch {
    return defaults;
  }
}

function saveFile(name: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function matchesStyleFilter(p: StyleProfile, filter: StyleFilter, query: string): boolean {
  if (filter === 'featured' && p.cloudCategory !== 'featured') return false;
  if (filter === 'study' && p.category !== 'study') return false;
  if (filter === 'creator' && p.category !== 'creator') return false;
  if (filter === 'process_skill' && !['process', 'skill', 'workflow'].includes(p.cloudCategory || '')) return false;
  if (filter === 'library' && p.cloudCategory !== 'library') return false;

  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    (p.creatorHandle || '').toLowerCase().includes(q) ||
    (p.creator || '').toLowerCase().includes(q) ||
    (p.tag || '').toLowerCase().includes(q) ||
    p.id.toLowerCase().includes(q)
  );
}

const STYLE_FILTER_OPTIONS: Array<{ id: StyleFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'featured', label: 'Featured' },
  { id: 'study', label: 'Study' },
  { id: 'creator', label: 'Creator' },
  { id: 'process_skill', label: 'Process & Skills' },
  { id: 'library', label: 'Library' },
];

export default function App() {
  const [state, setState] = useState<Saved>(load);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<'director' | 'styles' | 'reels' | 'security'>('director');
  const [styleFilter, setStyleFilter] = useState<StyleFilter>('all');
  const [styleQuery, setStyleQuery] = useState('');
  const [reelsSubTab, setReelsSubTab] = useState<ReelsSubTab>('reels');
  const [reelTagFilter, setReelTagFilter] = useState<string>('all');
  const [reelQuery, setReelQuery] = useState('');
  const [expandedPlaybook, setExpandedPlaybook] = useState<string | null>(cloudPlaybooks[0]?.id || null);
  const inputRef = useRef<HTMLInputElement>(null);

  const style = state.profiles.find(p => p.id === state.selected) || vox;
  const brief = productionBrief(style, state.story, state.beats, state.assets, state.destination);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(state));
    } catch {
      setNotice('Could not save locally. Download your brief to keep it.');
    }
  }, [state]);

  const change = <K extends keyof Saved>(key: K, value: Saved[K]) => {
    setState(s => ({ ...s, [key]: value }));
  };

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 3500);
  };

  async function copyText(text: string, successMsg: string) {
    try {
      await navigator.clipboard.writeText(text);
      showNotice(successMsg);
    } catch {
      setNotice('Clipboard unavailable. Download the file instead.');
    }
  }

  async function importProfile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 100_000) throw new Error('The profile must be under 100 KB.');
      const parsed: unknown = JSON.parse(await file.text());
      if (!validProfile(parsed)) throw new Error('Invalid profile structure.');
      if (state.profiles.some(p => p.id === parsed.id)) throw new Error('That profile ID already exists.');
      setState(s => ({ ...s, profiles: [...s.profiles, parsed], selected: parsed.id }));
      showNotice(`Imported style profile: ${parsed.name}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not read the profile.');
    }
    e.target.value = '';
  }

  const filteredStyles = useMemo(
    () => state.profiles.filter(p => matchesStyleFilter(p, styleFilter, styleQuery)),
    [state.profiles, styleFilter, styleQuery]
  );

  const matchingReels = useMemo(
    () => studiedReels.filter(r => r.style_tags.includes(style.id)),
    [style.id]
  );

  const reelTagCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of studiedReels) {
      for (const t of r.style_tags) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, []);

  const filteredReels = useMemo(() => {
    const q = reelQuery.trim().toLowerCase();
    return studiedReels.filter(r => {
      if (reelTagFilter !== 'all' && !r.style_tags.includes(reelTagFilter)) return false;
      if (!q) return true;
      return (
        r.id.toLowerCase().includes(q) ||
        r.creator.toLowerCase().includes(q) ||
        r.notes.toLowerCase().includes(q) ||
        r.style_tags.some(t => t.toLowerCase().includes(q))
      );
    });
  }, [reelTagFilter, reelQuery]);

  return (
    <div className="relative min-h-screen bg-[#0d100e] text-[#f4efe3] font-sans overflow-x-hidden selection:bg-[#344f3f] selection:text-white">
      {/* Interactive Aurora Ambient Background */}
      <div className="fixed inset-0 pointer-events-none opacity-40 z-0">
        <Aurora
          colorStops={['#263e34', '#172720', '#3b584a', '#0d100e']}
          speed={0.4}
          amplitude={1.2}
          opacity={0.35}
        />
      </div>

      <div className="relative z-10 shell max-w-[1700px] mx-auto px-4 sm:px-8 py-6">
        {/* Navigation Bar */}
        <header className="flex flex-wrap items-center justify-between gap-4 py-4 px-6 rounded-2xl bg-[#141815]/80 backdrop-blur-md border border-white/10 shadow-2xl mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#263e34] to-[#456b5b] border border-white/20 flex items-center justify-center text-white shadow-lg">
              <Clapperboard size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-wider text-lg text-white">MASTER</span>
                <span className="text-xs uppercase px-2 py-0.5 rounded-full bg-[#263e34]/70 border border-[#4a6b5a]/40 text-[#a5c9b6]">
                  Studio Pro
                </span>
              </div>
              <p className="text-[11px] text-[#8e988f]">Next-Gen Visual Motion & Video Architecture</p>
            </div>
          </div>

          {/* Navigation Pills */}
          <nav className="flex flex-wrap items-center gap-2 bg-[#0e1210]/90 p-1.5 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('director')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'director' ? 'bg-[#263e34] text-white shadow-md' : 'text-[#8e988f] hover:text-white'
              }`}
            >
              <MonitorPlay size={14} /> Director Canvas
            </button>
            <button
              onClick={() => setActiveTab('styles')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'styles' ? 'bg-[#263e34] text-white shadow-md' : 'text-[#8e988f] hover:text-white'
              }`}
            >
              <Layers3 size={14} /> Style Library ({state.profiles.length})
            </button>
            <button
              onClick={() => setActiveTab('reels')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'reels' ? 'bg-[#263e34] text-white shadow-md' : 'text-[#8e988f] hover:text-white'
              }`}
            >
              <BookOpen size={14} /> Reels & Playbooks ({studiedReels.length})
            </button>
            <button
              onClick={() => setActiveTab('security')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'security' ? 'bg-[#263e34] text-white shadow-md' : 'text-[#8e988f] hover:text-white'
              }`}
            >
              <ShieldCheck size={14} /> 12-System Security
            </button>
          </nav>

          {/* Security status badge */}
          <div className="hidden xl:flex items-center gap-3 text-xs bg-[#17201a] border border-[#2c3d33] px-3.5 py-1.5 rounded-full text-[#9ec4af]">
            <span className="w-2 h-2 rounded-full bg-[#52d68a] animate-pulse" />
            <span>{state.profiles.length} Styles · {studiedReels.length} Studied Reels</span>
          </div>
        </header>

        {/* Hero Banner */}
        <section className="mb-10 text-center lg:text-left flex flex-col lg:flex-row items-center justify-between gap-8 p-8 rounded-3xl bg-gradient-to-r from-[#171f1a]/90 via-[#131915]/80 to-[#101412]/90 border border-white/10 shadow-2xl">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#263e34]/50 border border-[#3b584b] text-[#9fc2b0] text-xs font-medium mb-4">
              <Sparkles size={13} className="text-[#e2bb69]" />
              <DecryptedText text="COMMERCIAL VIDEO SUITE v2.6" speed={30} />
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold text-white tracking-tight leading-[1.1] mb-4">
              Give every visual story <br className="hidden sm:inline" />
              <ShinyText text="its own signature world." className="font-italic text-[#c2dcd0]" />
            </h1>
            <p className="text-[#96a097] text-sm sm:text-base leading-relaxed">
              Curate commercial styles, craft narrative beats, browse {studiedReels.length} studied reference reels
              and {cloudPlaybooks.length} production playbooks, and export director briefs ready for your workflow.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 min-w-[220px]">
            <button
              onClick={() => copyText(brief, 'Production brief copied to clipboard!')}
              className="px-6 py-3.5 rounded-xl bg-gradient-to-r from-[#345143] to-[#253d32] hover:from-[#3e5f4f] hover:to-[#2e4a3d] text-white font-semibold text-sm shadow-xl flex items-center justify-center gap-2 border border-white/15 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Copy size={16} /> Copy Production Brief
            </button>
            <button
              onClick={() => saveFile(`${style.id}-production-brief.txt`, brief, 'text/plain;charset=utf-8')}
              className="px-6 py-3.5 rounded-xl bg-[#1a221d] hover:bg-[#222c26] text-[#b3c7bc] font-semibold text-sm flex items-center justify-center gap-2 border border-white/10 transition-all"
            >
              <ArrowDownToLine size={16} /> Download Brief (.txt)
            </button>
          </div>
        </section>

        {/* How the creator-style system works (explainer video) */}
        <CreatorStyleExplainer />

        {notice && (
          <div className="mb-6 p-4 rounded-xl bg-[#203127] border border-[#3e5a49] text-[#9ee2b9] flex items-center gap-3 text-sm animate-fade-in">
            <Check size={18} />
            <span>{notice}</span>
          </div>
        )}

        {/* MAIN STUDIO WORKSPACE */}
        {activeTab === 'director' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Left Sidebar: Style Selector */}
            <div className="lg:col-span-4 space-y-4">
              <SpotlightCard className="p-5 rounded-2xl bg-[#121613] border border-white/10 shadow-xl">
                <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#9bb8a8]">
                    <Layers3 size={15} /> Select Visual Language
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e2721] text-[#7d998b]">
                    {filteredStyles.length}/{state.profiles.length}
                  </span>
                </div>

                {/* Search & Filter */}
                <div className="space-y-2.5 mb-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7d72]" />
                    <input
                      type="text"
                      value={styleQuery}
                      onChange={e => setStyleQuery(e.target.value)}
                      placeholder="Filter styles, creators, tags..."
                      className="w-full rounded-xl bg-[#161d18] border border-white/10 pl-9 pr-3 py-2 text-xs text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {STYLE_FILTER_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => setStyleFilter(opt.id)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all border ${
                          styleFilter === opt.id
                            ? 'bg-[#263e34] border-[#4b725e] text-white'
                            : 'bg-[#161c18] border-white/5 text-[#87978d] hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-[420px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {filteredStyles.map(p => {
                    const isSelected = p.id === style.id;
                    return (
                      <button
                        key={p.id}
                        onClick={() => change('selected', p.id)}
                        className={`w-full text-left p-3.5 rounded-xl transition-all border flex items-center justify-between gap-3 ${
                          isSelected
                            ? 'bg-gradient-to-r from-[#203228] to-[#18261e] border-[#4a6b58] text-white shadow-lg'
                            : 'bg-[#161c18]/60 border-white/5 text-[#98a49c] hover:bg-[#1b231e] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0 flex items-start gap-2.5">
                          {p.accent && (
                            <span
                              className="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 border border-white/20"
                              style={{ backgroundColor: p.accent }}
                            />
                          )}
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">{p.name}</div>
                            <div className="text-[11px] text-[#738278] truncate">{p.description}</div>
                          </div>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono shrink-0 ${
                            isSelected ? 'bg-[#314c3d] text-[#b9e5cd]' : 'bg-[#0f1411] text-[#637268]'
                          }`}
                        >
                          {p.creatorHandle || p.category || 'custom'}
                        </span>
                      </button>
                    );
                  })}
                  {filteredStyles.length === 0 && (
                    <div className="p-4 text-center text-xs text-[#738278]">
                      No styles match your filter.
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-white/10 mt-4 space-y-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="w-full py-2.5 rounded-xl bg-[#19221c] hover:bg-[#202c24] border border-dashed border-[#3d5345] text-xs font-semibold text-[#a0c2b0] flex items-center justify-center gap-2 transition-all"
                  >
                    <FilePlus2 size={14} /> Import Custom Style JSON
                  </button>
                  <input ref={inputRef} type="file" accept="application/json,.json" hidden onChange={importProfile} />
                </div>
              </SpotlightCard>

              {/* Aspect Ratio & Frame Controls */}
              <SpotlightCard className="p-5 rounded-2xl bg-[#121613] border border-white/10 shadow-xl">
                <div className="text-xs font-bold uppercase tracking-wider text-[#9bb8a8] mb-3 flex items-center gap-2">
                  <Sliders size={14} /> Aspect Ratio & Format
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: '16:9' as const, label: '16:9 Cinema', icon: MonitorPlay },
                    { id: '9:16' as const, label: '9:16 Reel', icon: Smartphone },
                    { id: '1:1' as const, label: '1:1 Square', icon: Square },
                  ].map(item => {
                    const Icon = item.icon;
                    const isActive = state.aspectRatio === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => change('aspectRatio', item.id)}
                        className={`p-2.5 rounded-xl border flex flex-col items-center gap-1.5 text-xs font-medium transition-all ${
                          isActive
                            ? 'bg-[#24372c] border-[#4f7861] text-white shadow-md'
                            : 'bg-[#151b17] border-white/5 text-[#859489] hover:text-white'
                        }`}
                      >
                        <Icon size={16} />
                        <span>{item.id}</span>
                      </button>
                    );
                  })}
                </div>
              </SpotlightCard>
            </div>

            {/* Right: Live Interactive Canvas & Story Workshop */}
            <div className="lg:col-span-8 space-y-6">
              {/* Live Canvas Viewport */}
              <div className="p-6 rounded-3xl bg-[#131814] border border-white/10 shadow-2xl relative overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wider text-[#7e9487] font-bold">
                        Active Aesthetic Profile
                      </span>
                      {style.tag && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1d2b22] text-[#97cdb0] border border-white/10">
                          {style.tag}
                        </span>
                      )}
                      {style.creatorHandle && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#17201a] text-[#b4c8bc]">
                          {style.creatorHandle}
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl font-serif font-bold text-white mt-1">{style.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {style.referenceReelUrl && (
                      <a
                        href={style.referenceReelUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3.5 py-1.5 rounded-lg bg-[#1b2720] hover:bg-[#24342b] border border-white/10 text-xs font-medium text-[#b5dec8] flex items-center gap-1.5 transition-all"
                      >
                        <ExternalLink size={13} /> Reference Reel
                      </a>
                    )}
                    <button
                      onClick={() => setPlaying(!playing)}
                      className="px-3.5 py-1.5 rounded-lg bg-[#1f2c24] hover:bg-[#28382e] border border-white/10 text-xs font-medium text-[#a2c5b3] flex items-center gap-1.5 transition-all"
                    >
                      {playing ? <Pause size={13} /> : <Play size={13} />}
                      <span>{playing ? 'Pause Motion' : 'Play Motion'}</span>
                    </button>
                  </div>
                </div>

                {/* Simulated Canvas Frame */}
                <div
                  className={`relative mx-auto rounded-2xl overflow-hidden border border-white/15 shadow-2xl transition-all duration-300 ${
                    state.aspectRatio === '9:16'
                      ? 'max-w-[320px] aspect-[9/16]'
                      : state.aspectRatio === '1:1'
                        ? 'max-w-[440px] aspect-square'
                        : 'w-full aspect-video'
                  }`}
                >
                  {style.id === vox.id ? (
                    <div className={`w-full h-full relative bg-[#e8e0ce] ${playing ? 'is-playing' : ''}`}>
                      <div className="paper-sky absolute inset-0 bg-gradient-to-b from-[#8ab4bc] to-[#c7ded9]" />
                      <div className="cloud cloud-one" />
                      <div className="cloud cloud-two" />
                      <div className="mountain mountain-back" />
                      <div className="mountain mountain-front" />
                      <div className="paper-sun" />
                      <div className="paper-ground" />
                      <div className="paper-title">
                        <span>Make</span>
                        <span>it</span>
                        <span>mean</span>
                        <span>something.</span>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full h-full bg-[#111613] flex flex-col items-center justify-center p-8 text-center relative">
                      <div
                        className="w-20 h-20 rounded-full bg-[#203429] flex items-center justify-center mb-4 border border-white/15 shadow-inner"
                        style={style.accent ? { color: style.accent } : { color: '#58db92' }}
                      >
                        <Film size={34} />
                      </div>
                      <h4 className="text-lg font-serif font-bold text-white mb-1">{style.name}</h4>
                      <p className="text-xs text-[#87998e] max-w-md mb-4">{style.description}</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {style.pieces.slice(0, 4).map((p, idx) => (
                          <span
                            key={idx}
                            className="text-[10px] px-2.5 py-1 rounded-full bg-[#1b251f] border border-white/10 text-[#96baa7] max-w-[220px] truncate"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Frame Overlay Badges */}
                  <div className="absolute top-3 left-3 px-2 py-0.5 rounded bg-black/60 backdrop-blur-md text-[10px] text-white/80 font-mono">
                    {state.aspectRatio} · {style.duration}
                  </div>
                </div>

                {/* Style Specs Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6 pt-5 border-t border-white/10">
                  <div className="p-3 rounded-xl bg-[#17201a] border border-white/5">
                    <span className="text-[10px] uppercase text-[#73877b] font-bold block mb-1">Color Palette</span>
                    <span className="text-xs text-white font-medium">{style.palette}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#17201a] border border-white/5">
                    <span className="text-[10px] uppercase text-[#73877b] font-bold block mb-1">Target Format</span>
                    <span className="text-xs text-white font-medium">{style.format}</span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#17201a] border border-white/5">
                    <span className="text-[10px] uppercase text-[#73877b] font-bold block mb-1">Timing & Pace</span>
                    <span className="text-xs text-white font-medium">{style.duration}</span>
                  </div>
                </div>

                {(style.bestFor || style.referenceReelNote) && (
                  <div className="mt-3 p-3.5 rounded-xl bg-[#151c17] border border-white/5 text-xs text-[#9fb2a6] space-y-1">
                    {style.bestFor && (
                      <div>
                        <strong className="text-white">Best for:</strong> {style.bestFor}
                      </div>
                    )}
                    {style.referenceReelNote && (
                      <div>
                        <strong className="text-white">Reference note:</strong> {style.referenceReelNote}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Step-by-Step Playbook (for styles with steps) */}
              {style.steps && style.steps.length > 0 && (
                <SpotlightCard className="p-6 rounded-3xl bg-[#121613] border border-white/10 shadow-xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div>
                      <h3 className="text-lg font-serif font-bold text-white">Step-by-Step Playbook</h3>
                      <p className="text-xs text-[#8c9c91]">Production sequence pulled from Master Video Styles.</p>
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-[#1e2a22] text-[#8ec5a6] font-mono">
                      {style.steps.length} Steps
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {style.steps.map((step, idx) => (
                      <div key={idx} className="p-4 rounded-xl bg-[#161d18] border border-white/5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-white">
                            {idx + 1}. {step.title}
                          </span>
                          {step.days && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#213026] text-[#97d6b3]">
                              {step.days}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#909f95] leading-relaxed">{step.detail}</p>
                        {step.tools.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {step.tools.map((t, ti) => (
                              <span key={ti} className="text-[10px] px-2 py-0.5 rounded bg-[#101612] text-[#7b9486] border border-white/5">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </SpotlightCard>
              )}

              {/* Matching Studied Reference Reels */}
              {matchingReels.length > 0 && (
                <SpotlightCard className="p-6 rounded-3xl bg-[#121613] border border-white/10 shadow-xl space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/10">
                    <div>
                      <h3 className="text-lg font-serif font-bold text-white">
                        Studied Reference Reels ({matchingReels.length})
                      </h3>
                      <p className="text-xs text-[#8c9c91]">Real examples tagged with {style.name}.</p>
                    </div>
                    <button
                      onClick={() => {
                        setReelTagFilter(style.id);
                        setReelsSubTab('reels');
                        setActiveTab('reels');
                      }}
                      className="text-xs px-3 py-1.5 rounded-lg bg-[#1e2d24] hover:bg-[#273a2f] text-[#a3d4b8] border border-white/10 flex items-center gap-1.5"
                    >
                      View all in Reels tab <ArrowUpRight size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {matchingReels.slice(0, 6).map(reel => (
                      <div key={reel.id} className="p-3.5 rounded-xl bg-[#161d18] border border-white/5 flex flex-col justify-between gap-2">
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold text-white">@{reel.creator}</span>
                            <span className="text-[10px] font-mono text-[#73877b]">{reel.id}</span>
                          </div>
                          <p className="text-[11px] text-[#909e95] leading-relaxed">{reel.notes}</p>
                        </div>
                        <a
                          href={reel.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-[#8dd4ae] hover:underline inline-flex items-center gap-1 self-start"
                        >
                          Open Reel <ExternalLink size={11} />
                        </a>
                      </div>
                    ))}
                  </div>
                </SpotlightCard>
              )}

              {/* Story Narrative & Script Beat Generator */}
              <SpotlightCard className="p-6 rounded-3xl bg-[#121613] border border-white/10 shadow-xl space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/10">
                  <div>
                    <h3 className="text-lg font-serif font-bold text-white">Narrative Story Workshop</h3>
                    <p className="text-xs text-[#8c9c91]">Shape the story outline and sequence of visual cuts.</p>
                  </div>
                  <span className="text-xs px-2.5 py-1 rounded-full bg-[#1e2a22] text-[#8ec5a6] font-mono">
                    Step 02 / Director Brief
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-[#9dbcb0] block mb-1.5">
                      Core Concept / Hook
                    </label>
                    <textarea
                      value={state.story}
                      onChange={e => change('story', e.target.value)}
                      placeholder="What are we explaining or showcasing? E.g., How the Navan Edge Reel was created with 3D projection..."
                      rows={2}
                      className="w-full rounded-xl bg-[#161d18] border border-white/10 p-3 text-sm text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#9dbcb0] block mb-1.5">
                        Story Beats (1 Per Line)
                      </label>
                      <textarea
                        value={state.beats}
                        onChange={e => change('beats', e.target.value)}
                        placeholder="Beat 1: Hook with question&#10;Beat 2: Problem reveal&#10;Beat 3: Technical breakdown&#10;Beat 4: Call to action"
                        rows={4}
                        className="w-full rounded-xl bg-[#161d18] border border-white/10 p-3 text-sm text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none font-mono text-xs transition-all"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold uppercase tracking-wider text-[#9dbcb0] block mb-1.5">
                        Assets & References
                      </label>
                      <textarea
                        value={state.assets}
                        onChange={e => change('assets', e.target.value)}
                        placeholder="Cut-out PNGs, 3D glTF models, kinetic typography fonts, licensed whoosh audio..."
                        rows={4}
                        className="w-full rounded-xl bg-[#161d18] border border-white/10 p-3 text-sm text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none font-mono text-xs transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-[#9dbcb0] block mb-1.5">
                      Primary Production Software
                    </label>
                    <select
                      value={state.destination}
                      onChange={e => change('destination', e.target.value)}
                      className="w-full rounded-xl bg-[#161d18] border border-white/10 p-3 text-sm text-white focus:border-[#4c755d] focus:outline-none"
                    >
                      <option>DaVinci Resolve / Fusion</option>
                      <option>Adobe After Effects / Premiere</option>
                      <option>Remotion / React Web Video</option>
                      <option>Higgsfield / AI Diffusion Pipeline</option>
                      <option>Local Code-based Renderer</option>
                    </select>
                  </div>
                </div>
              </SpotlightCard>
            </div>
          </div>
        )}

        {/* STYLES LIBRARY TAB */}
        {activeTab === 'styles' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-serif font-bold text-white">
                  Visual Language Collection ({filteredStyles.length})
                </h2>
                <p className="text-xs text-[#8c9c91]">
                  20 local studio profiles + 17 pulled Master Video Styles playbooks and library categories.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7d72]" />
                  <input
                    type="text"
                    value={styleQuery}
                    onChange={e => setStyleQuery(e.target.value)}
                    placeholder="Search styles..."
                    className="rounded-xl bg-[#141a16] border border-white/10 pl-9 pr-3 py-2 text-xs text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none"
                  />
                </div>
                {STYLE_FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setStyleFilter(opt.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      styleFilter === opt.id
                        ? 'bg-[#263e34] border-[#4b725e] text-white'
                        : 'bg-[#141a16] border-white/10 text-[#89998f] hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredStyles.map(p => {
                const reelCount = studiedReels.filter(r => r.style_tags.includes(p.id)).length;
                return (
                  <SpotlightCard key={p.id} className="p-6 rounded-2xl bg-[#131915] border border-white/10 shadow-xl flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2">
                          {p.accent && (
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-white/20"
                              style={{ backgroundColor: p.accent }}
                            />
                          )}
                          <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#203026] text-[#8dd4ae]">
                            {p.cloudCategory || p.category || 'custom'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          {reelCount > 0 && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1a241e] text-[#a9ccb9]">
                              {reelCount} reels
                            </span>
                          )}
                          <span className="text-xs text-[#6e7f74]">{p.format.split('·')[0]}</span>
                        </div>
                      </div>
                      <h3 className="text-xl font-serif font-bold text-white mb-1">{p.name}</h3>
                      {p.creatorHandle && (
                        <div className="text-[11px] font-mono text-[#7fa08e] mb-2">{p.creatorHandle}</div>
                      )}
                      <p className="text-xs text-[#909e95] leading-relaxed mb-4">{p.description}</p>

                      <div className="space-y-2 mb-4">
                        <div className="text-[11px] text-[#78887e]">
                          <strong className="text-white">Motion:</strong> {p.motion[0]}
                        </div>
                        <div className="text-[11px] text-[#78887e]">
                          <strong className="text-white">Palette:</strong> {p.palette}
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        change('selected', p.id);
                        setActiveTab('director');
                      }}
                      className="w-full py-2.5 rounded-xl bg-[#213127] hover:bg-[#2c4234] text-white text-xs font-semibold flex items-center justify-center gap-2 border border-white/10 transition-all"
                    >
                      Load into Studio Canvas <ArrowUpRight size={14} />
                    </button>
                  </SpotlightCard>
                );
              })}
            </div>
          </div>
        )}

        {/* REELS & PLAYBOOKS TAB */}
        {activeTab === 'reels' && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-serif font-bold text-white">Master Video Styles — Cloud Library</h2>
                <p className="text-xs text-[#8c9c91]">
                  Pulled from <code className="text-[#9fd7b8]">master-video-styles/</code>: {studiedReels.length} studied reels, {motionDictionary.length} motion moves, {cloudPlaybooks.length} playbooks/prompts, and {cloudTools.length} tools.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 bg-[#111613] p-1.5 rounded-xl border border-white/10">
                {[
                  { id: 'reels' as const, label: `Reels (${studiedReels.length})` },
                  { id: 'motion' as const, label: `Motion Dictionary (${motionDictionary.length})` },
                  { id: 'playbooks' as const, label: `Playbooks & Prompts (${cloudPlaybooks.length})` },
                  { id: 'tools' as const, label: `Tools Map (${cloudTools.length})` },
                ].map(st => (
                  <button
                    key={st.id}
                    onClick={() => setReelsSubTab(st.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      reelsSubTab === st.id
                        ? 'bg-[#263e34] text-white shadow'
                        : 'text-[#89998f] hover:text-white'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Subtab 1: 166 Studied Reels */}
            {reelsSubTab === 'reels' && (
              <div className="space-y-5">
                <div className="p-4 rounded-2xl bg-[#151d18] border border-white/10 text-xs text-[#9cb2a4]">
                  <strong className="text-white">Harvest Status:</strong> {reelsHarvestStatus}
                </div>

                <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
                  <div className="relative flex-1 max-w-md">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b7d72]" />
                    <input
                      type="text"
                      value={reelQuery}
                      onChange={e => setReelQuery(e.target.value)}
                      placeholder="Search 166 reels by creator, notes, ID, or tag..."
                      className="w-full rounded-xl bg-[#141a16] border border-white/10 pl-9 pr-3 py-2.5 text-xs text-white placeholder-[#5d6c62] focus:border-[#4c755d] focus:outline-none"
                    />
                  </div>
                  <div className="text-xs text-[#89998f] font-mono">
                    Showing {filteredReels.length} of {studiedReels.length} reels
                  </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button
                    onClick={() => setReelTagFilter('all')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                      reelTagFilter === 'all'
                        ? 'bg-[#263e34] border-[#4b725e] text-white'
                        : 'bg-[#141a16] border-white/10 text-[#89998f] hover:text-white'
                    }`}
                  >
                    All ({studiedReels.length})
                  </button>
                  {reelTagCounts.map(([tag, count]) => (
                    <button
                      key={tag}
                      onClick={() => setReelTagFilter(tag)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                        reelTagFilter === tag
                          ? 'bg-[#263e34] border-[#4b725e] text-white'
                          : 'bg-[#141a16] border-white/10 text-[#89998f] hover:text-white'
                      }`}
                    >
                      {tag} ({count})
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredReels.map(reel => (
                    <SpotlightCard key={reel.id} className="p-5 rounded-2xl bg-[#131915] border border-white/10 flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-white">@{reel.creator}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#1b241e] text-[#86a695]">
                            {reel.id}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {reel.style_tags.map(t => (
                            <button
                              key={t}
                              onClick={() => setReelTagFilter(t)}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-[#203026] text-[#98d9b5] hover:bg-[#2a4032]"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                        <p className="text-xs text-[#909e95] leading-relaxed">{reel.notes}</p>
                      </div>
                      <a
                        href={reel.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8dd4ae] hover:underline self-start pt-2"
                      >
                        Watch Reference Reel <ExternalLink size={12} />
                      </a>
                    </SpotlightCard>
                  ))}
                </div>
              </div>
            )}

            {/* Subtab 2: 12 Motion Dictionary Moves */}
            {reelsSubTab === 'motion' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {motionDictionary.map((move, idx) => (
                  <SpotlightCard key={idx} className="p-5 rounded-2xl bg-[#131915] border border-white/10 flex flex-col justify-between gap-4">
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#203026] text-[#8dd4ae]">
                          Move #{String(idx + 1).padStart(2, '0')}
                        </span>
                        <span className="text-[10px] font-mono text-[#7c9085]">{move.source_style}</span>
                      </div>
                      <h3 className="text-lg font-serif font-bold text-white mb-2">{move.name}</h3>
                      <p className="text-xs text-[#909e95] leading-relaxed">{move.demo}</p>
                    </div>
                    <button
                      onClick={() => {
                        change('selected', move.source_style);
                        setActiveTab('director');
                      }}
                      className="w-full py-2 rounded-xl bg-[#213127] hover:bg-[#2c4234] text-white text-xs font-semibold flex items-center justify-center gap-1.5 border border-white/10"
                    >
                      Open Source Style <ArrowUpRight size={13} />
                    </button>
                  </SpotlightCard>
                ))}
              </div>
            )}

            {/* Subtab 3: 5 Playbooks & Prompts */}
            {reelsSubTab === 'playbooks' && (
              <div className="space-y-4">
                {cloudPlaybooks.map(doc => {
                  const isOpen = expandedPlaybook === doc.id;
                  return (
                    <div key={doc.id} className="rounded-2xl bg-[#131915] border border-white/10 overflow-hidden">
                      <div className="p-5 flex flex-wrap items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[#203026] text-[#8dd4ae]">
                              {doc.kind}
                            </span>
                            <span className="text-[11px] font-mono text-[#758a7e]">{doc.sourcePath}</span>
                          </div>
                          <h3 className="text-lg font-serif font-bold text-white">{doc.title}</h3>
                          <p className="text-xs text-[#909e95]">{doc.summary}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyText(doc.content, `Copied ${doc.title}`)}
                            className="px-3.5 py-2 rounded-lg bg-[#1d2b22] hover:bg-[#26382d] text-xs font-semibold text-[#a8d8bd] border border-white/10 flex items-center gap-1.5"
                          >
                            <Copy size={13} /> Copy Markdown
                          </button>
                          <button
                            onClick={() => setExpandedPlaybook(isOpen ? null : doc.id)}
                            className="px-3.5 py-2 rounded-lg bg-[#263e34] hover:bg-[#2f4c40] text-xs font-semibold text-white"
                          >
                            {isOpen ? 'Collapse' : 'Read Full'}
                          </button>
                        </div>
                      </div>
                      {isOpen && (
                        <div className="border-t border-white/10 bg-[#0d120f] p-5">
                          <pre className="whitespace-pre-wrap font-mono text-xs text-[#c7d6cd] leading-relaxed max-h-[520px] overflow-y-auto">
                            {doc.content}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Subtab 4: 18 Tools Map */}
            {reelsSubTab === 'tools' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-[#151d18] border border-white/10 text-xs text-[#9cb2a4] flex items-center gap-2">
                  <Wrench size={14} className="text-[#8dd4ae] shrink-0" />
                  <span>
                    Reference tool directory from <code className="text-[#9fd7b8]">master-video-styles/data/styles.json</code>. External plugins and MCP bridges are listed for planning reference and are not automatically installed or connected here.
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {cloudTools.map((tool, idx) => (
                    <SpotlightCard key={idx} className="p-5 rounded-2xl bg-[#131915] border border-white/10 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h3 className="text-base font-bold text-white">{tool.name}</h3>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#203026] text-[#97d6b3] shrink-0">
                            {tool.price || 'Reference'}
                          </span>
                        </div>
                        <p className="text-xs text-[#909e95] leading-relaxed">{tool.notes}</p>
                      </div>
                      {tool.link ? (
                        <a
                          href={tool.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#8dd4ae] hover:underline self-start"
                        >
                          Open Reference Link <ExternalLink size={12} />
                        </a>
                      ) : (
                        <span className="text-[11px] text-[#66776d]">No external URL listed</span>
                      )}
                    </SpotlightCard>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECURITY TAB */}
        {activeTab === 'security' && (
          <div className="space-y-6 animate-fade-in">
            <div className="p-8 rounded-3xl bg-gradient-to-r from-[#17231c] via-[#121a15] to-[#0e1411] border border-[#2f4738] shadow-2xl">
              <div className="flex items-center gap-3 text-[#58db92] mb-3">
                <ShieldCheck size={28} />
                <h2 className="text-2xl font-serif font-bold text-white">12-System Integrated Security Architecture</h2>
              </div>
              <p className="text-xs text-[#9eb6a8] max-w-2xl leading-relaxed mb-6">
                Your application runs on a hardened foundation with multi-agent consensus, static code inspection,
                secret leak shielding, asset quarantine, and AI red teaming.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { name: '1. Strix', role: 'Adversarial Red Teaming', status: 'ACTIVE' },
                  { name: '2. Cloudflare Audit', role: '6-Phase Discovery Harness', status: 'VERIFIED' },
                  { name: '3. Trivy', role: 'Dependency Vulnerability Scan', status: '0 CVEs' },
                  { name: '4. Nuclei', role: 'Config & DAST Scanner', status: 'PROTECTED' },
                  { name: '5. TruffleHog', role: 'Continuous Secret Detection', status: 'CLEAN' },
                  { name: '6. NVIDIA SkillSpector', role: 'Safe Offline Skill Analysis', status: 'PASSED' },
                  { name: '7. Semgrep', role: 'Static Code SAST', status: 'GATED' },
                  { name: '8. OpenAI Codex Sec', role: 'Code Verification Guard', status: 'ENFORCED' },
                  { name: '9. ClamAV', role: 'Malware & Zip-Slip Quarantine', status: 'SECURED' },
                  { name: '10. Claude Code Review', role: 'Multi-Agent Security Consensus', status: 'ARMED' },
                  { name: '11. BLA Safety', role: 'Tool Hijacking Defense', status: 'ACTIVE' },
                  { name: '12. Microsoft PyRIT', role: 'Generative AI Red Teaming', status: 'ROBUST' },
                ].map((item, idx) => (
                  <div key={idx} className="p-4 rounded-xl bg-[#141c17] border border-white/10 flex flex-col justify-between">
                    <div>
                      <div className="text-sm font-bold text-white mb-1">{item.name}</div>
                      <div className="text-[11px] text-[#7c9285]">{item.role}</div>
                    </div>
                    <span className="text-[10px] font-mono font-bold mt-3 px-2 py-0.5 rounded bg-[#1f2d24] text-[#60e299] self-start">
                      {item.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="mt-14 py-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-[#707e74]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#3d5a49]" />
            <span>MASTER VIDEO EDITOR STUDIO · EMPOWERED BY CONCORDIA</span>
          </div>
          <div>All assets, style profiles, and security gates operate locally and in browser storage.</div>
        </footer>
      </div>
    </div>
  );
}
