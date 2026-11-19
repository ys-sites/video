// Video uploads and the chat agent (Workers AI) for the AI Editor: signed-in users store clips in a private
// R2 bucket under their own prefix. Sign-in is a Supabase access token,
// verified here against the project's public ES256 keys (no secret needed).

interface Env {
  VIDEOS: R2Bucket;
  AI: { run(model: string, input: unknown): Promise<{ response?: unknown }> };
  SUPABASE_URL: string;
  ALLOWED_ORIGINS: string;
  /** "true" accepts new uploads; anything else keeps storage free. */
  UPLOADS_OPEN?: string;
}

const MAX_BYTES = 95 * 1024 * 1024; // Workers Free accepts request bodies up to 100 MB.
const QUOTA_BYTES = 2 * 1024 * 1024 * 1024; // Per user, to keep the bucket inside R2's free 10 GB.
const ID = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;

type Jwk = JsonWebKey & { kid: string };
let jwks: { keys: Jwk[]; at: number } | null = null;

function b64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

async function keys(env: Env): Promise<Jwk[]> {
  if (jwks && Date.now() - jwks.at < 600_000) return jwks.keys;
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!r.ok) throw new Error('jwks');
  jwks = { keys: ((await r.json()) as { keys: Jwk[] }).keys, at: Date.now() };
  return jwks.keys;
}

/** Returns the Supabase user id for a valid access token, or null. */
async function userId(req: Request, env: Env): Promise<string | null> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const [h, p, sig] = token.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    if (header.alg !== 'ES256') return null;
    const jwk = (await keys(env)).find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
    const now = Date.now() / 1000;
    if (claims.exp < now || claims.iss !== `${env.SUPABASE_URL}/auth/v1` || claims.role !== 'authenticated') return null;
    return /^[0-9a-f-]{36}$/.test(claims.sub) ? claims.sub : null;
  } catch {
    return null;
  }
}

function cors(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = env.ALLOWED_ORIGINS.split(',').map(s => s.trim());
  return allowed.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range',
        'Access-Control-Expose-Headers': 'Content-Length, Content-Range',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      }
    : { Vary: 'Origin' };
}

function json(body: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function listAll(env: Env, prefix: string) {
  const out: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.VIDEOS.list({ prefix, cursor, include: ['customMetadata', 'httpMetadata'] });
    out.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return out;
}

const AGENT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const AGENT_PROMPT = `You are the edit agent of a creator-video editor. You plan edits on six tracks:
video (keep-segments of the speaker's footage; gaps between them are cuts),
captions, motion (titles, zooms, cards), broll (cutaways), music, sfx.
House rules from a study of 136 creator reels: first word within 0.5 s, a hook title in the first 2 s,
median shot about 1.4 s for punchy edits (2-3 s for talking heads), word-by-word captions in the safe zone,
music ducked under the voice, one clear ask at the end. Only use the user's footage and licensed audio.
Return JSON only: {"reply": one friendly sentence, "steps": [{"title": short past-tense action like "Tightened the cut",
"text": one sentence on what changed and why}], "ops": [{"track","start","end","label","why","tool"}]}.
Times are seconds within the clip duration. Return the complete new plan in ops (not a diff), 1-60 ops.
Tools to name: "Remotion", "captions-skill", "effects skill", "ffmpeg", "your footage", "licensed music".`;

const AGENT_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, text: { type: 'string' } }, required: ['title', 'text'] } },
    ops: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          track: { type: 'string', enum: ['video', 'captions', 'motion', 'broll', 'music', 'sfx'] },
          start: { type: 'number' }, end: { type: 'number' },
          label: { type: 'string' }, why: { type: 'string' }, tool: { type: 'string' },
        },
        required: ['track', 'start', 'end', 'label', 'why', 'tool'],
      },
    },
  },
  required: ['reply', 'steps', 'ops'],
};

async function agent(req: Request, env: Env, h: Record<string, string>) {
  const body = (await req.json().catch(() => ({}))) as { message?: unknown; context?: unknown };
  const message = String(body.message ?? '').slice(0, 1000);
  const context = JSON.stringify(body.context ?? {}).slice(0, 12000);
  if (!message.trim()) return json({ error: 'Say what to change.' }, 400, h);
  try {
    const out = await env.AI.run(AGENT_MODEL, {
      messages: [
        { role: 'system', content: AGENT_PROMPT },
        { role: 'user', content: `Current project (JSON): ${context}\n\nRequest: ${message}` },
      ],
      response_format: { type: 'json_schema', json_schema: AGENT_SCHEMA },
      max_tokens: 2500,
      temperature: 0.3,
    });
    const r = out.response;
    const parsed = typeof r === 'string' ? JSON.parse(r) : r;
    return json(parsed, 200, h);
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    const quota = /limit|quota|neuron|429/i.test(msg);
    return json({ error: quota ? 'The free AI allowance for today is used up — the built-in planner is handling this.' : 'The agent could not plan that.' }, quota ? 429 : 502, h);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });

    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const isAgent = parts.length === 1 && parts[0] === 'agent';
    if (!isAgent && (parts[0] !== 'videos' || parts.length > 2)) return json({ error: 'Not found' }, 404, h);

    const uid = await userId(req, env);
    if (!uid) return json({ error: 'Sign in first.' }, 401, h);
    if (isAgent) return req.method === 'POST' ? agent(req, env, h) : json({ error: 'Method not allowed' }, 405, h);
    const prefix = `u/${uid}/`;

    if (parts.length === 1 && req.method === 'GET') {
      const items = await listAll(env, prefix);
      return json(items.map(o => ({
        id: o.key.slice(prefix.length),
        name: o.customMetadata?.name ?? 'video',
        size: o.size,
        type: o.httpMetadata?.contentType ?? 'video/mp4',
        uploaded: o.uploaded,
      })), 200, h);
    }

    if (parts.length === 1 && req.method === 'PUT') {
      if (env.UPLOADS_OPEN !== 'true') return json({ error: 'Uploads are off. Videos stay on your device.' }, 403, h);
      const type = req.headers.get('Content-Type') ?? '';
      const size = Number(req.headers.get('Content-Length') ?? 0);
      if (!type.startsWith('video/')) return json({ error: 'Only video files can be uploaded.' }, 415, h);
      if (!size || size > MAX_BYTES) return json({ error: 'Videos must be under 95 MB.' }, 413, h);
      const used = (await listAll(env, prefix)).reduce((n, o) => n + o.size, 0);
      if (used + size > QUOTA_BYTES) return json({ error: 'Your 2 GB of storage is full. Delete a video first.' }, 507, h);
      const name = (url.searchParams.get('name') ?? 'video').replace(/[^\w .()-]/g, '_').slice(0, 120);
      const ext = (name.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp4';
      const id = `${crypto.randomUUID()}.${ext}`;
      await env.VIDEOS.put(prefix + id, req.body, { httpMetadata: { contentType: type }, customMetadata: { name } });
      return json({ id, name, size, type }, 201, h);
    }

    const id = parts[1];
    if (!id || !ID.test(id)) return json({ error: 'Not found' }, 404, h);

    if (req.method === 'GET') {
      const obj = await env.VIDEOS.get(prefix + id, { range: req.headers });
      if (!obj) return json({ error: 'Not found' }, 404, h);
      const headers = new Headers(h);
      obj.writeHttpMetadata(headers);
      headers.set('Accept-Ranges', 'bytes');
      headers.set('Cache-Control', 'private, no-store');
      const r = obj.range as { offset: number; length?: number } | undefined;
      if (r && req.headers.has('Range')) {
        const end = r.offset + (r.length ?? obj.size - r.offset) - 1;
        headers.set('Content-Range', `bytes ${r.offset}-${end}/${obj.size}`);
        return new Response(obj.body, { status: 206, headers });
      }
      return new Response(obj.body, { headers });
    }

    if (req.method === 'DELETE') {
      await env.VIDEOS.delete(prefix + id);
      return new Response(null, { status: 204, headers: h });
    }

    return json({ error: 'Method not allowed' }, 405, h);
  },
};
