// Masvid Studio: chat with Claude about the open project. Claude edits through the Studio's own
// tools (server: gateway/claude-chat.ts); the preview reloads when a turn finishes.
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useStudioShellContext } from "../../contexts/StudioContext";

type Skill = { id: string; title: string; description: string };
type Group = { id: string; label: string; skills: Skill[] };
type Tool = { id: string; label: string; state: "running" | "ok" | "error" };
type Msg = { role: "user" | "assistant"; text: string; tools: Tool[]; done: boolean; ok?: boolean; note?: string };
type Status = { installed: boolean; version: string; running: boolean };

const API = "/motion-api/claude";
const STARTERS = [
  "Add bold pop captions to every spoken line",
  "Make this a 9:16 vertical reel and keep faces in the upper third",
  "Tighten the pacing: cut dead air and make the first 2 seconds a hook",
  "Add a title card at the start and a call-to-action card at the end",
  "Export this video as an MP4",
];
const MODELS = [
  { id: "sonnet", label: "Sonnet (balanced)" },
  { id: "opus", label: "Opus (best)" },
  { id: "haiku", label: "Haiku (fast)" },
];

function readPref(key: string, fallback: string) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export const ClaudeChatPanel = memo(function ClaudeChatPanel({ reloadPreview }: { reloadPreview?: () => void }) {
  const { projectId, showToast } = useStudioShellContext();
  const [status, setStatus] = useState<Status | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [skill, setSkill] = useState(() => readPref("masvid-claude-skill", ""));
  const [model, setModel] = useState(() => readPref("masvid-claude-model", "sonnet"));
  const [busy, setBusy] = useState(false);
  const [newProject, setNewProject] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`${API}/status`, { cache: "no-store" }).then(r => r.json()).then(s => alive && setStatus(s)).catch(() => alive && setStatus(null));
    fetch(`${API}/skills`, { cache: "no-store" }).then(r => r.json()).then(d => alive && setGroups(d.groups || [])).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    setNewProject(null);
    fetch(`${API}/chat?projectId=${encodeURIComponent(projectId || "")}`, { cache: "no-store" })
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        setMessages((d.messages || []).map((m: { role: "user" | "assistant"; text: string; tools?: string[]; ok?: boolean }) => ({
          role: m.role, text: m.text, done: true, ok: m.ok,
          tools: (m.tools || []).map((label, i) => ({ id: String(i), label, state: "ok" as const })),
        })));
      })
      .catch(() => alive && setMessages([]));
    return () => { alive = false; };
  }, [projectId]);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  const patchLast = useCallback((fn: (m: Msg) => Msg) => {
    setMessages(prev => (prev.length ? [...prev.slice(0, -1), fn(prev[prev.length - 1])] : prev));
  }, []);

  const send = useCallback(async (text: string, opts: { newChat?: boolean } = {}) => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setDraft("");
    setMessages(prev => [...prev, { role: "user", text: message, tools: [], done: true }, { role: "assistant", text: "", tools: [], done: false }]);
    try {
      const response = await fetch(`${API}/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, message, skill: skill || undefined, model, newChat: opts.newChat }),
      });
      if (!response.ok || !response.body) {
        const err = await response.json().catch(() => ({ error: `Request failed (${response.status})` }));
        patchLast(m => ({ ...m, done: true, ok: false, text: err.error || "Request failed" }));
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamed = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const line = chunk.split("\n").find(l => l.startsWith("data: "));
          if (!line) continue;
          let e: Record<string, any>;
          try { e = JSON.parse(line.slice(6)); } catch { continue; }
          if (e.type === "status") patchLast(m => ({ ...m, note: e.ok ? undefined : e.text }));
          else if (e.type === "message_start") { if (streamed) streamed += "\n\n"; }
          else if (e.type === "delta") { streamed += e.text; const t = streamed; patchLast(m => ({ ...m, text: t })); }
          else if (e.type === "tool") patchLast(m => ({ ...m, tools: [...m.tools, { id: e.id, label: e.label, state: "running" }] }));
          else if (e.type === "tool_done") patchLast(m => ({ ...m, tools: m.tools.map(t => (t.id === e.id ? { ...t, state: e.ok ? "ok" : "error" } : t)) }));
          else if (e.type === "project" && e.id !== projectId) setNewProject(e.id);
          else if (e.type === "done") patchLast(m => ({ ...m, done: true, ok: e.ok, text: m.text || e.text || (e.ok ? "Done." : "Something went wrong.") }));
        }
      }
    } catch (error) {
      patchLast(m => ({ ...m, done: true, ok: false, text: m.text || String((error as Error).message || error) }));
    } finally {
      setBusy(false);
      patchLast(m => (m.done ? m : { ...m, done: true }));
      reloadPreview?.();
    }
  }, [busy, model, patchLast, projectId, reloadPreview, skill]);

  const stop = useCallback(() => {
    fetch(`${API}/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => undefined);
  }, []);

  const newChat = useCallback(async () => {
    if (busy) return;
    await fetch(`${API}/reset`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId }) }).catch(() => undefined);
    setMessages([]);
    showToast("Started a new conversation", "info");
  }, [busy, projectId, showToast]);

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
  };

  if (status && !status.installed) {
    return (
      <div className="flex h-full flex-col gap-2 p-4 text-sm text-neutral-300">
        <p className="font-medium text-neutral-100">Claude Code is not installed</p>
        <p>Install Claude Code and sign in once in a terminal (<code>claude</code>), then reopen this panel.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-sm text-neutral-200" data-testid="claude-chat-panel">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <span className="font-medium text-neutral-100">Claude</span>
        <span className="truncate text-xs text-neutral-500">{status ? status.version.replace(" (Claude Code)", "") : "connecting..."}</span>
        <select aria-label="Claude model" value={model} onChange={e => { setModel(e.target.value); writePref("masvid-claude-model", e.target.value); }}
          className="ml-auto rounded-md border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 text-xs text-neutral-300">
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <button type="button" onClick={newChat} disabled={busy} className="rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40">New chat</button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-neutral-400">Tell Claude what to change in this video, in your own words. It edits the project and the preview updates when it's done.</p>
            <div className="flex flex-col gap-1.5">
              {STARTERS.map(s => (
                <button key={s} type="button" onClick={() => void send(s)} disabled={busy}
                  className="rounded-lg border border-neutral-800 px-2.5 py-1.5 text-left text-xs text-neutral-300 hover:border-neutral-600 hover:bg-neutral-900 disabled:opacity-40">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => m.role === "user" ? (
          <div key={i} className="ml-6 whitespace-pre-wrap rounded-lg bg-neutral-800 px-3 py-2 text-neutral-100">{m.text}</div>
        ) : (
          <div key={i} className="space-y-1.5">
            {m.tools.length > 0 && (
              <ul className="space-y-0.5 text-xs text-neutral-500">
                {m.tools.map(t => (
                  <li key={t.id} className="flex items-center gap-1.5">
                    <span aria-hidden className={t.state === "error" ? "text-red-400" : t.state === "ok" ? "text-emerald-400" : "animate-pulse text-neutral-400"}>
                      {t.state === "error" ? "x" : t.state === "ok" ? "✓" : "•"}
                    </span>
                    <span className="truncate">{t.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {m.note && <p className="text-xs text-amber-400">{m.note}</p>}
            <div className={`whitespace-pre-wrap leading-relaxed ${m.ok === false ? "text-red-300" : "text-neutral-200"}`}>
              {m.text || (!m.done ? <span className="animate-pulse text-neutral-500">Working...</span> : null)}
            </div>
          </div>
        ))}
        {newProject && (
          <a href={`/#project/${newProject}`} className="block rounded-lg border border-neutral-700 px-3 py-2 text-xs text-neutral-200 hover:bg-neutral-900">
            Claude created a new project. Open it
          </a>
        )}
      </div>

      <div className="space-y-2 border-t border-neutral-800 p-3">
        <select aria-label="Style or skill" value={skill} onChange={e => { setSkill(e.target.value); writePref("masvid-claude-skill", e.target.value); }}
          className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-200">
          <option value="">Style: let Claude choose</option>
          {groups.map(g => (
            <optgroup key={g.id} label={g.label}>
              {g.skills.map(s => <option key={s.id} value={s.id} title={s.description}>{s.title}</option>)}
            </optgroup>
          ))}
        </select>
        <textarea value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={onKey} rows={3} disabled={busy}
          placeholder={busy ? "Claude is working..." : "Tell Claude what to change, e.g. make the captions yellow and bigger"}
          className="block min-h-[72px] w-full resize-y rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-neutral-500 focus:outline-none" />
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-neutral-500">Enter to send, Shift+Enter for a new line</span>
          {busy ? (
            <button type="button" onClick={stop} className="ml-auto rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-100 hover:bg-neutral-600">Stop</button>
          ) : (
            <button type="button" onClick={() => void send(draft)} disabled={!draft.trim()}
              className="ml-auto rounded-lg bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white disabled:opacity-40">Send</button>
          )}
        </div>
        <p className="text-[11px] text-neutral-500">Uses your own Claude login on this PC. Claude can only use the Studio's editing tools.</p>
      </div>
    </div>
  );
});
