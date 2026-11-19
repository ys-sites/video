// Private video storage: the masvid-uploads Worker (workers/masvid-uploads) in
// front of the R2 bucket masvid-videos. Every call carries the Supabase access
// token; the Worker only touches the caller's own folder.
import { getSession } from './supabase';

export const UPLOADS_URL = 'https://masvid-uploads.restoredinmtl.workers.dev';
export const videosReady = UPLOADS_URL.startsWith('https://');
/** Cloud copies of videos (My videos). Off: videos stay on the visitor's device, so storage costs nothing. */
export const cloudVideos = false;
export const MAX_UPLOAD = 95 * 1024 * 1024;

export type StoredVideo = { id: string; name: string; size: number; type: string; uploaded: string };

async function token() {
  const s = await getSession();
  if (!s) throw new Error('Signed out — sign in again to use your videos.');
  return s.access_token;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(UPLOADS_URL + path, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...init.headers } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
  return (res.status === 204 ? null : await res.json()) as T;
}

export const listVideos = () => call<StoredVideo[]>('/videos');
export const deleteVideo = (id: string) => call<null>(`/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Upload with progress (fetch cannot report upload progress, XHR can). */
export async function uploadVideo(file: File, onProgress: (pct: number) => void): Promise<StoredVideo> {
  if (!file.type.startsWith('video/')) throw new Error('Pick a video file.');
  if (file.size > MAX_UPLOAD) throw new Error('Videos must be under 95 MB.');
  const t = await token();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${UPLOADS_URL}/videos?name=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader('Authorization', `Bearer ${t}`);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = e => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      let body: { error?: string } & Partial<StoredVideo> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* empty body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as StoredVideo);
      else reject(new Error(body.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(file);
  });
}

/** Download a stored video into the browser so the editor can play it. */
export async function fetchVideo(v: StoredVideo): Promise<File> {
  const res = await fetch(`${UPLOADS_URL}/videos/${encodeURIComponent(v.id)}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`Could not open ${v.name}`);
  return new File([await res.blob()], v.name, { type: v.type });
}
