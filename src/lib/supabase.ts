// Accounts and saved edit plans on Supabase, called over its REST API (no SDK).
// The publishable key is meant to be public: row level security in
// supabase/edit_plans.sql is what keeps each person's plans private.
// Never put the secret (service_role / sb_secret_) key in this file.

export const SUPABASE_URL = 'https://jyogdywflsjilqcghqvf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_LTjxZUQizJHlsbIKkL7HaQ_FJv_wM0R';
export const accountsReady = SUPABASE_KEY.startsWith('sb_publishable_');
/** Turn on once the Google provider is enabled in Supabase → Authentication → Providers. */
export const googleReady = false;

export type Session = { access_token: string; refresh_token: string; expires_at: number; email: string };
export type SavedPlan = { id: string; title: string; plan: Record<string, unknown>; updated_at: string };

const STORE = 'mvs.session.v1';

function readSession(): Session | null {
  try {
    return JSON.parse(localStorage.getItem(STORE) || 'null');
  } catch {
    return null;
  }
}

function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(STORE, JSON.stringify(s));
    else localStorage.removeItem(STORE);
  } catch {
    // Private mode: the session lasts until the tab closes.
  }
}

function emailFromToken(token: string): string {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64)).email ?? '';
  } catch {
    return '';
  }
}

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.msg || body.message || body.error_description || `Request failed (${res.status})`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Email a sign-in link that returns to this page. */
export async function sendMagicLink(email: string) {
  const back = location.origin + location.pathname;
  await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(back)}`, {
    method: 'POST',
    body: JSON.stringify({ email, create_user: true }),
  });
}

/** Which sign-in methods are switched on in the Supabase dashboard. */
export async function enabledProviders(): Promise<{ google: boolean; email: boolean }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
    const d = await r.json();
    return { google: !!d.external?.google, email: d.external?.email !== false };
  } catch {
    return { google: false, email: true };
  }
}

/** Send the browser to Google; Supabase returns here with the session in the URL hash. */
export function signInWithGoogle() {
  const back = location.origin + location.pathname;
  location.assign(`${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(back)}`);
}

/** Pick up the session the magic link or Google puts in the URL hash, then clean the URL. */
export function sessionFromUrl(): { session: Session | null; error: string } {
  const hash = new URLSearchParams(location.hash.slice(1));
  const error = hash.get('error_description') || '';
  const access = hash.get('access_token');
  const refresh = hash.get('refresh_token');
  if (!access && !error) return { session: null, error: '' };
  history.replaceState(null, '', location.pathname + location.search);
  if (!access || !refresh) return { session: null, error: error.replace(/\+/g, ' ') };
  const session = {
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + Number(hash.get('expires_in') || 3600),
    email: emailFromToken(access),
  };
  writeSession(session);
  return { session, error: '' };
}

/** The stored session, refreshed when it is about to expire; null when signed out. */
export async function getSession(): Promise<Session | null> {
  const s = readSession();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s;
  try {
    const r = await call<{ access_token: string; refresh_token: string; expires_in: number }>(
      '/auth/v1/token?grant_type=refresh_token',
      { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) },
    );
    const next = {
      access_token: r.access_token,
      refresh_token: r.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + r.expires_in,
      email: emailFromToken(r.access_token) || s.email,
    };
    writeSession(next);
    return next;
  } catch {
    writeSession(null);
    return null;
  }
}

export async function signOut() {
  const s = readSession();
  writeSession(null);
  if (s) await call('/auth/v1/logout', { method: 'POST' }, s.access_token).catch(() => undefined);
}

async function authed() {
  const s = await getSession();
  if (!s) throw new Error('Signed out — sign in again to use saved plans.');
  return s.access_token;
}

export async function listPlans(): Promise<SavedPlan[]> {
  return call('/rest/v1/edit_plans?select=id,title,plan,updated_at&order=updated_at.desc&limit=50', {}, await authed());
}

export async function savePlan(title: string, plan: Record<string, unknown>, id?: string): Promise<SavedPlan> {
  const token = await authed();
  const rows = await call<SavedPlan[]>(
    id ? `/rest/v1/edit_plans?id=eq.${encodeURIComponent(id)}` : '/rest/v1/edit_plans',
    { method: id ? 'PATCH' : 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ title, plan }) },
    token,
  );
  return rows[0];
}

export async function deletePlan(id: string) {
  await call(`/rest/v1/edit_plans?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' }, await authed());
}
