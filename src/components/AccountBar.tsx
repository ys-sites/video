import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Cloud, LogOut, Mail, Save, Trash2, FolderOpen, Film, Upload } from 'lucide-react';
import {
  accountsReady, googleReady, sendMagicLink, signInWithGoogle, sessionFromUrl, getSession, signOut,
  listPlans, savePlan, deletePlan, type Session, type SavedPlan,
} from '../lib/supabase';
import { videosReady, listVideos, uploadVideo, deleteVideo, fetchVideo, type StoredVideo } from '../lib/videos';

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
  const [email, setEmail] = useState('');
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const [videos, setVideos] = useState<StoredVideo[]>([]);
  const [showVideos, setShowVideos] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

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
    if (session && videosReady) listVideos().then(setVideos).catch(e => setMsg(e.message));
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
    const submit = (e: FormEvent) => {
      e.preventDefault();
      run(async () => {
        await sendMagicLink(email.trim());
        setMsg(`Check ${email.trim()} for a sign-in link.`);
      });
    };
    return (
      <form onSubmit={submit} className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#111113] px-4 py-2.5 text-xs text-[#a1a1aa]">
        <Cloud size={14} className="text-[#c5f04a]" /> Save plans to your account:
        {googleReady && (
          <>
            <button type="button" onClick={signInWithGoogle} className="flex items-center gap-2 rounded-lg bg-[#fafafa] px-3 py-1.5 font-semibold text-[#09090b]">
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7h-4a12 12 0 0 0 0 10.8z"/><path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>
              Continue with Google
            </button>
            <span className="text-[#71717a]">or</span>
          </>
        )}
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@email.com"
          aria-label="Email for sign-in link"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#09090b] px-3 py-1.5 text-sm text-white placeholder:text-[#52525b] sm:max-w-[260px]"
        />
        <button disabled={busy} className="flex items-center gap-1.5 rounded-lg bg-[#fafafa] px-3 py-1.5 font-semibold text-[#09090b] disabled:opacity-50">
          <Mail size={13} /> Email me a link
        </button>
        {msg && <span className="basis-full text-[#c5f04a]" role="status">{msg}</span>}
      </form>
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
          {videosReady && (
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
