import { useEffect, useState, type FormEvent } from 'react';
import { Cloud, LogOut, Mail, Save, Trash2, FolderOpen } from 'lucide-react';
import {
  accountsReady, sendMagicLink, sessionFromUrl, getSession, signOut,
  listPlans, savePlan, deletePlan, type Session, type SavedPlan,
} from '../lib/supabase';

type Props = {
  /** Current editor state to save. */
  getPlan: () => Record<string, unknown>;
  /** Suggested title for a new save. */
  title: string;
  /** Put a saved plan back into the editor. */
  onLoad: (plan: Record<string, unknown>) => void;
};

export default function AccountBar({ getPlan, title, onLoad }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
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
        <Cloud size={14} /> Accounts and cloud-saved plans are coming soon. Plans download as .json for now.
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

  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-[#111113] px-4 py-2.5 text-xs text-[#a1a1aa]">
      <div className="flex flex-wrap items-center gap-2">
        <Cloud size={14} className="text-[#c5f04a]" />
        <span className="truncate">{session.email || 'Signed in'}</span>
        <span className="ml-auto flex flex-wrap gap-2">
          <button disabled={busy} onClick={save} className="flex items-center gap-1.5 rounded-lg bg-[#fafafa] px-3 py-1.5 font-semibold text-[#09090b] disabled:opacity-50">
            <Save size={13} /> {openId ? 'Save changes' : 'Save plan'}
          </button>
          <button onClick={() => setShowList(v => !v)} aria-expanded={showList} className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 font-semibold text-[#fafafa]">
            <FolderOpen size={13} /> My plans ({plans.length})
          </button>
          <button onClick={() => run(async () => { await signOut(); setSession(null); setPlans([]); setOpenId(null); })} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 hover:text-white" aria-label="Sign out">
            <LogOut size={13} />
          </button>
        </span>
      </div>
      {msg && <p className="mt-2 text-[#c5f04a]" role="status">{msg}</p>}
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
