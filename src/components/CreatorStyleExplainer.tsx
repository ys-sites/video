import { Film, Sparkles } from 'lucide-react';

// Numbers come from skills/creator-video/references/real-estate-creator-study.md.
const STATS = [
  { value: '136', label: 'reels studied' },
  { value: '12', label: 'reel types' },
  { value: '1.4 s', label: 'median shot' },
  { value: '0.5 s', label: 'to the first word' },
];

const STEPS = [
  { title: 'Transcribe', text: 'Every word of your clip, with timings.' },
  { title: 'Pick the type', text: 'Your footage decides it, e.g. walk-and-talk.' },
  { title: 'Storyboard', text: 'Beat by beat. You approve before anything renders.' },
  { title: 'Build', text: 'Remotion, captions and face-tracked effects.' },
  { title: 'Render', text: '1080×1920, 30 fps, −14 LUFS.' },
  { title: 'Checklist', text: 'Hook, pace, one clear ask, rights.' },
];

export default function CreatorStyleExplainer() {
  return (
    <section
      id="creator-style-explainer"
      className="mb-10 p-6 sm:p-8 rounded-3xl bg-[#121613]/90 border border-white/10 shadow-2xl"
    >
      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12 items-center lg:items-start">
        <div className="w-full max-w-[340px] shrink-0">
          <div className="rounded-[28px] overflow-hidden border border-white/15 bg-black shadow-2xl aspect-[9/16]">
            <video
              className="w-full h-full object-cover"
              src="/videos/creator-style-explainer.mp4"
              poster="/videos/creator-style-explainer-poster.jpg"
              controls
              playsInline
              preload="metadata"
            >
              Your browser can't play this video.{' '}
              <a href="/videos/creator-style-explainer.mp4">Download it instead.</a>
            </video>
          </div>
          <p className="mt-3 text-center text-[11px] text-[#7d8a81]">84 s · 9:16 · made with Remotion</p>
        </div>

        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#263e34]/50 border border-[#3b584b] text-[#9fc2b0] text-xs font-medium mb-4">
            <Film size={13} className="text-[#e2bb69]" />
            HOW THE CREATOR-STYLE SYSTEM WORKS
          </div>
          <h2 className="text-3xl sm:text-4xl font-serif font-bold text-white tracking-tight leading-tight mb-3">
            Every creator-style edit starts from 136 studied reels.
          </h2>
          <p className="text-[#96a097] text-sm sm:text-base leading-relaxed max-w-2xl">
            Each reel was measured for cuts, shot length and loudness, transcribed word by word, and
            sorted into one of 12 types. When you ask for an edit in creator style, your footage is
            matched to a type, and that type's measured rules set the length, pace, text and ending.
          </p>

          <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {STATS.map((s) => (
              <div key={s.label} className="p-4 rounded-2xl bg-[#17201a] border border-white/10">
                <div className="text-2xl sm:text-3xl font-extrabold text-[#e2bb69]">{s.value}</div>
                <div className="text-[11px] uppercase tracking-wider text-[#8e988f] mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          <ol className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-3 p-3 rounded-xl bg-[#141c17] border border-white/5">
                <span
                  className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${
                    i === 2 ? 'bg-[#e2bb69] text-[#16140a]' : 'bg-[#263e34] text-white'
                  }`}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-sm font-bold text-white">{s.title}</div>
                  <div className="text-xs text-[#8e988f] leading-relaxed">{s.text}</div>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex items-start gap-3 p-4 rounded-2xl border border-dashed border-[#3b584b] text-sm text-[#b3c7bc]">
            <Sparkles size={16} className="text-[#e2bb69] mt-0.5 shrink-0" />
            <span>
              To use it, say <strong className="text-white">"edit this in creator style"</strong> and
              share your clip. It copies the creators' techniques, never their footage, voice or
              branding.
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
