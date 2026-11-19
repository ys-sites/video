// Chat agent for the AI Editor. With the masvid-uploads Worker live and the
// user signed in, requests go to Workers AI (free daily allowance on the
// user's Cloudflare account). Otherwise the caller falls back to the local
// rule-based planner, so the editor always works.
import { getSession } from './supabase';
import { UPLOADS_URL, videosReady } from './videos';

export type AgentTrack = 'video' | 'captions' | 'motion' | 'broll' | 'music' | 'sfx';
export type AgentOp = { track: AgentTrack; start: number; end: number; label: string; why: string; tool: string };
export type AgentStep = { title: string; text: string };
export type AgentReply = { reply: string; steps: AgentStep[]; ops: AgentOp[] };

const TRACKS: AgentTrack[] = ['video', 'captions', 'motion', 'broll', 'music', 'sfx'];

export async function agentAvailable() {
  return videosReady && !!(await getSession());
}

/** Ask the cloud agent for a new plan. Throws when it is unavailable or returns nothing usable. */
export async function askAgent(message: string, context: Record<string, unknown>, duration: number): Promise<AgentReply> {
  const s = await getSession();
  if (!videosReady || !s) throw new Error('agent offline');
  const res = await fetch(`${UPLOADS_URL}/agent`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, context }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Agent error (${res.status})`);
  const raw = (await res.json()) as Partial<AgentReply>;
  // Never trust model output: clamp every value before it reaches the timeline.
  const ops = (Array.isArray(raw.ops) ? raw.ops : [])
    .filter(o => o && TRACKS.includes(o.track as AgentTrack))
    .slice(0, 80)
    .map(o => {
      const start = Math.max(0, Math.min(duration, Number(o.start) || 0));
      const end = Math.max(start + 0.1, Math.min(duration, Number(o.end) || start + 1));
      return {
        track: o.track as AgentTrack,
        start: +start.toFixed(2),
        end: +end.toFixed(2),
        label: String(o.label ?? '').slice(0, 60) || 'Edit',
        why: String(o.why ?? '').slice(0, 200),
        tool: String(o.tool ?? 'Remotion').slice(0, 80),
      };
    });
  if (!ops.length) throw new Error('empty plan');
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 8)
    .map(st => ({ title: String(st?.title ?? '').slice(0, 60), text: String(st?.text ?? '').slice(0, 300) }))
    .filter(st => st.title || st.text);
  return { reply: String(raw.reply ?? '').slice(0, 500), steps, ops };
}
