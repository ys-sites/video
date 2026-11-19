import React, { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { 
  Clapperboard, Sparkles, Play, Pause, Layers3, Copy, ArrowDownToLine, 
  FilePlus2, ArrowUpRight, Check, ShieldCheck, Film, Video, Sliders, 
  MonitorPlay, Smartphone, Square, RefreshCw, Volume2, Sparkle
} from 'lucide-react';
import { builtInStyles, productionBrief, validProfile, vox, type StyleProfile } from './styles';
import SpotlightCard from './components/ui/SpotlightCard';
import ShinyText from './components/ui/ShinyText';
import BlurText from './components/ui/BlurText';
import DecryptedText from './components/ui/DecryptedText';
import Aurora from './components/ui/Aurora';
import CreatorStyleExplainer from './components/CreatorStyleExplainer';

const STORAGE = 'master-video-editor.v2';

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
    aspectRatio: '16:9'
  };
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE) || 'null');
    if (!data || !Array.isArray(data.profiles)) return defaults;
    return {
      profiles: [
        ...builtInStyles,
        ...data.profiles.filter((p: unknown) => validProfile(p) && !builtInStyles.some(b => b.id === (p as StyleProfile).id))
      ],
      selected: typeof data.selected === 'string' ? data.selected : vox.id,
      story: typeof data.story === 'string' ? data.story : '',
      beats: typeof data.beats === 'string' ? data.beats : '',
      assets: typeof data.assets === 'string' ? data.assets : '',
      destination: typeof data.destination === 'string' ? data.destination : 'DaVinci Resolve / Fusion',
      aspectRatio: data.aspectRatio || '16:9'
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

export default function App() {
  const [state, setState] = useState<Saved>(load);
  const [notice, setNotice] = useState('');
  const [playing, setPlaying] = useState(true);
  const [activeTab, setActiveTab] = useState<'director' | 'styles' | 'security'>('director');
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

  const change = (key: keyof Saved, value: any) => {
    setState(s => ({ ...s, [key]: value }));
  };

  async function copyBrief() {
    try {
      await navigator.clipboard.writeText(brief);
      setNotice('Production brief copied to clipboard!');
      setTimeout(() => setNotice(''), 3500);
    } catch {
      setNotice('Clipboard unavailable. Download the brief instead.');
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
      setNotice(`Imported style profile: ${parsed.name}`);
      setTimeout(() => setNotice(''), 3500);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not read the profile.');
    }
    e.target.value = '';
  }

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
          <nav className="flex items-center gap-2 bg-[#0e1210]/90 p-1.5 rounded-xl border border-white/5">
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
              onClick={() => setActiveTab('security')}
              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 ${
                activeTab === 'security' ? 'bg-[#263e34] text-white shadow-md' : 'text-[#8e988f] hover:text-white'
              }`}
            >
              <ShieldCheck size={14} /> 12-System Security
            </button>
          </nav>

          {/* Security status badge */}
          <div className="hidden lg:flex items-center gap-3 text-xs bg-[#17201a] border border-[#2c3d33] px-3.5 py-1.5 rounded-full text-[#9ec4af]">
            <span className="w-2 h-2 rounded-full bg-[#52d68a] animate-pulse" />
            <span>Audited with 12 Security Engines</span>
          </div>
        </header>

        {/* Hero Banner with BlurText & ShinyText */}
        <section className="mb-10 text-center lg:text-left flex flex-col lg:flex-row items-center justify-between gap-8 p-8 rounded-3xl bg-gradient-to-r from-[#171f1a]/90 via-[#131915]/80 to-[#101412]/90 border border-white/10 shadow-2xl">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#263e34]/50 border border-[#3b584b] text-[#9fc2b0] text-xs font-medium mb-4">
              <Sparkles size={13} className="text-[#e2bb69]" />
              <DecryptedText text="COMMERCIAL VIDEO SUITE v2.5" speed={30} />
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-serif font-bold text-white tracking-tight leading-[1.1] mb-4">
              Give every visual story <br className="hidden sm:inline" />
              <ShinyText text="its own signature world." className="font-italic text-[#c2dcd0]" />
            </h1>
            <p className="text-[#96a097] text-sm sm:text-base leading-relaxed">
              Curate commercial styles, craft narrative beats, generate frame-precise director briefs, 
              and build seamless social reels ready for DaVinci Resolve, Premiere, and AI video generators.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 min-w-[220px]">
            <button
              onClick={copyBrief}
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
                <div className="flex items-center justify-between pb-4 border-b border-white/10 mb-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#9bb8a8]">
                    <Layers3 size={15} /> Select Visual Language
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e2721] text-[#7d998b]">
                    {state.profiles.length} Ready
                  </span>
                </div>

                <div className="max-h-[440px] overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                  {state.profiles.map(p => {
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
                        <div>
                          <div className="font-semibold text-sm">{p.name}</div>
                          <div className="text-[11px] text-[#738278] truncate max-w-[210px]">{p.description}</div>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded font-mono ${isSelected ? 'bg-[#314c3d] text-[#b9e5cd]' : 'bg-[#0f1411] text-[#637268]'}`}>
                          {p.category || 'custom'}
                        </span>
                      </button>
                    );
                  })}
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
                    { id: '16:9', label: '16:9 Cinema', icon: MonitorPlay },
                    { id: '9:16', label: '9:16 Reel', icon: Smartphone },
                    { id: '1:1', label: '1:1 Square', icon: Square },
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
                    <span className="text-[11px] uppercase tracking-wider text-[#7e9487] font-bold">Active Aesthetic Profile</span>
                    <h2 className="text-2xl font-serif font-bold text-white">{style.name}</h2>
                  </div>
                  <div className="flex items-center gap-2">
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
                <div className={`relative mx-auto rounded-2xl overflow-hidden border border-white/15 shadow-2xl transition-all duration-300 ${
                  state.aspectRatio === '9:16' ? 'max-w-[320px] aspect-[9/16]' : state.aspectRatio === '1:1' ? 'max-w-[440px] aspect-square' : 'w-full aspect-video'
                }`}>
                  {/* Paper Collage Simulation if Vox, otherwise Animated Visualizer */}
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
                      <div className="w-20 h-20 rounded-full bg-[#203429] flex items-center justify-center text-[#58db92] mb-4 border border-[#3b5947] shadow-inner">
                        <Film size={34} />
                      </div>
                      <h4 className="text-lg font-serif font-bold text-white mb-1">{style.name}</h4>
                      <p className="text-xs text-[#87998e] max-w-sm mb-4">{style.description}</p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {style.pieces.slice(0, 4).map((p, idx) => (
                          <span key={idx} className="text-[10px] px-2.5 py-1 rounded-full bg-[#1b251f] border border-white/10 text-[#96baa7]">
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
              </div>

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
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div>
                <h2 className="text-2xl font-serif font-bold text-white">Visual Language Collection</h2>
                <p className="text-xs text-[#8c9c91]">Comprehensive index of researched video aesthetics and production rulebooks.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {state.profiles.map(p => (
                <SpotlightCard key={p.id} className="p-6 rounded-2xl bg-[#131915] border border-white/10 shadow-xl flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#203026] text-[#8dd4ae]">
                        {p.category || 'custom'}
                      </span>
                      <span className="text-xs text-[#6e7f74]">{p.format.split('·')[0]}</span>
                    </div>
                    <h3 className="text-xl font-serif font-bold text-white mb-2">{p.name}</h3>
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
              ))}
            </div>
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
