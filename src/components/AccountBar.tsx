import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Cloud, LogOut, Mail, Save, Trash2, FolderOpen, Film, Upload, X, ArrowLeft } from 'lucide-react';
import {
  accountsReady, enabledProviders, sendMagicLink, signInWithGoogle, sessionFromUrl, getSession, signOut,
  listPlans, savePlan, deletePlan, type Session, type SavedPlan,
} from '../lib/supabase';
import { cloudVideos, listVideos, uploadVideo, deleteVideo, fetchVideo, type StoredVideo } from '../lib/videos';

type Props = {
  /** Current editor state to save. */
  getPlan: () => Record<string, unknown>;
  /** Suggested title for a new save. */
  title: string;
  /** Put a saved plan back into the editor. */
  onLoad: (plan: Record<string, unknown>) => void;
  /** Open a stored video in the editor. */
  onOpenVideo: (file: File) => void;
};

export default function AccountBar({ getPlan, title, onLoad, onOpenVideo }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [videos, setVideos] = useState<StoredVideo[]>([]);
  const [showVideos, setShowVideos] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<'login' | 'signup' | null>(null);

  useEffect(() => {
    if (!accountsReady) return;
    const back = sessionFromUrl();
    if (back.error) setMsg(back.error);
    (back.session ? Promise.resolve(back.session) : getSession()).then(s => {
      setSession(s);
      if (back.session) setMsg('Signed in.');
    });
  }, []);

  useEffect(() => {
    if (session) listPlans().then(setPlans).catch(e => setMsg(e.message));
    if (session && cloudVideos) listVideos().then(setVideos).catch(e => setMsg(e.message));
  }, [session]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (!accountsReady) {
    return (
      <p className="mb-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#111113] px-4 py-2.5 text-xs text-[#8b8b94]">
        <Cloud size={14} /> Sign-in is coming soon. To keep your work for now, use Export.
      </p>
    );
  }

  if (!session) {
    return (
      <>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#111113] px-4 py-2.5 text-sm text-[#a1a1aa]">
          <Cloud size={15} className="shrink-0 text-[#c5f04a]" />
          <span className="min-w-0 flex-1">Save your edits and videos, free.</span>
          <button onClick={() => setAuth('login')} className="rounded-lg px-3 py-1.5 font-semibold text-white hover:bg-white/5">Log in</button>
          <button onClick={() => setAuth('signup')} className="rounded-lg bg-[#fafafa] px-3.5 py-1.5 font-semibold text-[#09090b] hover:bg-[#e4e4e7]">Sign up</button>
        </div>
        {msg && !auth && <p className="-mt-2 mb-4 text-xs text-[#c5f04a]" role="status">{msg}</p>}
        {auth && <AuthDialog mode={auth} onMode={setAuth} onClose={() => setAuth(null)} />}
      </>
    );
  }

  const save = () => run(async () => {
    const saved = await savePlan(title, getPlan(), openId ?? undefined);
    setOpenId(saved.id);
    setPlans(await listPlans());
    setMsg('Saved to your account.');
  });

  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    run(async () => {
      setProgress(0);
      try {
        await uploadVideo(f, setProgress);
      } finally {
        setProgress(null);
      }
      setVideos(await listVideos());
      setMsg(`Uploaded “${f.name}”.`);
    });
  };

  const openVideo = (v: StoredVideo) => run(async () => {
    onOpenVideo(await fetchVideo(v));
    setShowVideos(false);
    setMsg(`Opened “${v.name}”.`);
  });

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-[#111113] px-4 py-2.5 text-xs text-[#a1a1aa]">
      <div className="flex flex-wrap items-center gap-2">
        <Cloud size={14} className="text-[#c5f04a]" />
        <span className="truncate">{session.email || 'Signed in'}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button disabled={busy} onClick={save} className="flex items-center gap-1.5 rounded-lg bg-[#fafafa] px-3 py-1.5 font-semibold text-[#09090b] disabled:opacity-50">
            <Save size={13} /> {openId ? 'Save changes' : 'Save plan'}
          </button>
          {cloudVideos && (
            <button onClick={() => { setShowVideos(v => !v); setShowList(false); }} aria-expanded={showVideos} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-[#fafafa]">
              <Film size={13} /> My videos ({videos.length})
            </button>
          )}
          <button onClick={() => { setShowList(v => !v); setShowVideos(false); }} aria-expanded={showList} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-[#fafafa]">
            <FolderOpen size={13} /> My plans ({plans.length})
          </button>
          <button onClick={() => run(async () => { await signOut(); setSession(null); setPlans([]); setOpenId(null); })} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:text-white" aria-label="Sign out">
            <LogOut size={13} />
          </button>
        </span>
      </div>
      {msg && <p className="mt-2 text-[#c5f04a]" role="status">{msg}</p>}
      {showVideos && (
        <div className="mt-3 grid gap-1.5">
          <label className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-white/20 px-3 py-2.5 text-sm text-white hover:bg-white/5 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
            <Upload size={14} /> {progress === null ? 'Upload a video (under 95 MB, private to you)' : `Uploading… ${progress}%`}
            <input type="file" accept="video/*" hidden onChange={upload} disabled={busy} />
          </label>
          {videos.length === 0 && <p className="text-[#8b8b94]">No videos yet.</p>}
          {videos.map(v => (
            <div key={v.id} className="flex items-center gap-2 rounded-lg bg-[#18181b] px-3 py-2">
              <button disabled={busy} className="min-w-0 flex-1 truncate text-left text-sm text-white disabled:opacity-50" onClick={() => openVideo(v)}>
                {v.name}
              </button>
              <span className="shrink-0 text-[#71717a]">{(v.size / 1048576).toFixed(1)} MB</span>
              <button aria-label={`Delete ${v.name}`} disabled={busy} onClick={() => run(async () => { await deleteVideo(v.id); setVideos(await listVideos()); })} className="shrink-0 rounded p-1 text-[#ffb4b4] hover:bg-[#4a1f1f]">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      {showList && (
        <ul className="mt-3 grid gap-1.5">
          {plans.length === 0 && <li className="text-[#8b8b94]">No saved plans yet.</li>}
          {plans.map(p => (
            <li key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${openId === p.id ? 'bg-[#27272a]' : 'bg-[#18181b]'}`}>
              <button className="min-w-0 flex-1 truncate text-left text-sm text-white" onClick={() => { onLoad(p.plan); setOpenId(p.id); setShowList(false); setMsg(`Opened “${p.title}”.`); }}>
                {p.title}
              </button>
              <span className="shrink-0 text-[#71717a]">{new Date(p.updated_at).toLocaleDateString()}</span>
              <button aria-label={`Delete ${p.title}`} onClick={() => run(async () => { await deletePlan(p.id); if (openId === p.id) setOpenId(null); setPlans(await listPlans()); })} className="shrink-0 rounded p-1 text-[#ffb4b4] hover:bg-[#4a1f1f]">
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const GOOGLE_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>
);

/** Sign-up / log-in panel in the style of ChatCut and OpusClip: Google first, email below. */
function AuthDialog({ mode, onMode, onClose }: { mode: 'login' | 'signup'; onMode: (m: 'login' | 'signup') => void; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    enabledProviders().then(p => setGoogle(p.google));
    input.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await sendMagicLink(email.trim());
      setSent(email.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const signup = mode === 'signup';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="auth-title" onClick={e => e.stopPropagation()}
        className="relative w-full max-w-[400px] rounded-2xl border border-white/10 bg-[#111113] p-7 text-left shadow-2xl">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 rounded-lg p-1.5 text-[#71717a] hover:bg-white/5 hover:text-white"><X size={18} /></button>
        <img src="/img/logo.svg" alt="" width={40} height={40} className="h-10 w-10" />

        {sent ? (
          <>
            <h2 id="auth-title" className="mt-5 text-2xl font-semibold tracking-tight text-white">Check your inbox</h2>
            <p className="mt-2 text-sm text-[#a1a1aa]">We sent a sign-in link to <b className="text-white">{sent}</b>. Open it on this device to continue.</p>
            <button onClick={() => setSent('')} className="mt-6 flex items-center gap-1.5 text-sm font-semibold text-[#d4d4d8] hover:text-white"><ArrowLeft size={14} /> Use a different email</button>
          </>
        ) : (
          <>
            <h2 id="auth-title" className="mt-5 text-2xl font-semibold tracking-tight text-white">{signup ? 'Create your free account' : 'Welcome back'}</h2>
            <p className="mt-1.5 text-sm text-[#a1a1aa]">{signup ? 'Save your edits and videos, and pick up on any device.' : 'Log in to open your saved edits and videos.'}</p>

            <button type="button" disabled={!google} onClick={signInWithGoogle}
              className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-xl bg-[#fafafa] text-sm font-semibold text-[#09090b] hover:bg-[#e4e4e7] disabled:cursor-not-allowed disabled:opacity-40">
              {GOOGLE_ICON} Continue with Google
            </button>
            {google === false && <p className="mt-2 text-center text-xs text-[#71717a]">Google sign-in is coming soon. Use your email for now.</p>}

            <div className="my-5 flex items-center gap-3 text-xs text-[#52525b]"><span className="h-px flex-1 bg-white/10" />or<span className="h-px flex-1 bg-white/10" /></div>

            <form onSubmit={submit}>
              <label htmlFor="auth-email" className="text-xs font-semibold text-[#a1a1aa]">Email</label>
              <input id="auth-email" ref={input} type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com"
                className="mt-1.5 h-11 w-full rounded-xl border border-white/10 bg-[#09090b] px-3.5 text-sm text-white outline-none placeholder:text-[#52525b] focus:border-white/30" />
              <button disabled={busy} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 text-sm font-semibold text-white hover:bg-white/5 disabled:opacity-50">
                <Mail size={15} /> {busy ? 'Sending…' : 'Continue with email'}
              </button>
              {error && <p className="mt-2 text-xs text-[#ffb4b4]" role="alert">{error}</p>}
            </form>

            <p className="mt-6 text-center text-sm text-[#a1a1aa]">
              {signup ? 'Already have an account? ' : 'New here? '}
              <button onClick={() => onMode(signup ? 'login' : 'signup')} className="font-semibold text-white underline-offset-4 hover:underline">{signup ? 'Log in' : 'Create an account'}</button>
            </p>
            <p className="mt-3 text-center text-[11px] text-[#52525b]">No password needed. We only use your email to sign you in.</p>
          </>
        )}
      </div>
    </div>
  );
}
