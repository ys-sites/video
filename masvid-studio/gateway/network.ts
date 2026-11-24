import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import type { Modality } from '../shared/gateway.ts';

export class ProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) { super(message); this.status = status; }
}
export type Fetcher = typeof fetch;
/** Repeat a read-only request (task polling or media download) after transient failures; never used for paid submissions. */
export async function retryRead<T>(read: () => Promise<T>, signal: AbortSignal, attempts = 5, reconnecting?: () => Promise<void>, recovered?: () => Promise<void>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try { const result = await read(); if (attempt > 1) await recovered?.(); return result; }
    catch (error) {
      const status = (error as { status?: number }).status;
      const code = String((error as any)?.code ?? (error as any)?.cause?.code ?? '');
      const network = /^(ECONNRESET|ECONNREFUSED|ECONNABORTED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_)/.test(code)
        || (error as Error)?.name === 'TimeoutError' || /socket hang up|timed out|fetch failed/i.test(String((error as Error)?.message));
      const transient = status === undefined ? network : status === 429 || status >= 500;
      if (signal.aborted || !transient || attempt >= attempts) throw error;
      await reconnecting?.();
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.min(2000 * attempt, 10_000));
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
}
export async function apiJson(fetcher: Fetcher, url: string, init: RequestInit = {}, limits: { timeoutMs?: number; maxBytes?: number } = {}) {
  const maxBytes = limits.maxBytes ?? MAX_JSON_BYTES;
  // The production transport buffers before resolving, so enforce the same cap there.
  const bounded: Fetcher = fetcher === publicProviderFetch
    ? (input, requestInit) => publicProviderFetch(input, requestInit ?? {}, 60_000, maxBytes)
    : fetcher;
  const response = await bounded(url, { ...init, redirect: 'error', signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(limits.timeoutMs ?? 30_000)]) : AbortSignal.timeout(limits.timeoutMs ?? 15_000) });
  // Do not forward provider response text: it may echo a key or user input.
  if (!response.ok) throw new ProviderError(`Provider HTTP ${response.status}${response.status === 401 || response.status === 403 ? ': credentials or permissions rejected' : ''}`, response.status);
  const body = await readCappedText(response, maxBytes);
  try { return JSON.parse(body); } catch { throw new Error('Provider returned invalid JSON'); }
}
// Stop reading as soon as the peer exceeds the cap instead of buffering the whole body first.
export async function readCappedText(response: Response, maximum: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maximum) throw new Error(`Provider response exceeds ${maximum / 1024 / 1024} MB`);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  // TextDecoder strips a leading BOM, which Buffer#toString kept and which made valid JSON fail.
  return new TextDecoder().decode(Buffer.concat(chunks));
}
export function isPublicAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    // Only 192.0.0.0/24 and 192.0.2.0/24 are special use; the rest of 192.0/16 is routable.
    return a > 0 && a < 224 && ![10, 127].includes(a) && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && b === 0 && (c === 0 || c === 2)) && !(a === 192 && b === 168)
      && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && [18, 19].includes(b));
  }
  return isGlobalUnicastV6(address);
}
// Numeric prefix check, because URL canonicalises compressed forms: 2001::1 is Teredo even
// though its second hextet is not spelled out.
function isGlobalUnicastV6(address: string) {
  if (isIP(address) !== 6) return false;
  const head = address.includes('::') ? address.slice(0, address.indexOf('::')) : address;
  const hextets = head.split(':');
  const first = parseInt(hextets[0] || '0', 16), second = parseInt(hextets[1] || '0', 16);
  if (!Number.isFinite(first) || !Number.isFinite(second)) return false;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (second === 0x0000 || second === 0x0db8)) return false;
  return first !== 0x2002;
}
export function providerOrigin(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('A public HTTPS API origin is required');
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)
    || url.port && url.port !== '443' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')
    || isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('Use the public HTTPS gateway origin from the API key page');
  return url.origin;
}
/** Custom Cloud origins use pinned public DNS and never forward credentials on redirects. */
export async function publicProviderFetch(raw: Parameters<Fetcher>[0], init: RequestInit = {}, idleTimeoutMs = 60_000, maxBytes = MAX_MEDIA_BYTES): Promise<Response> {
  const url = new URL(String(raw)); providerOrigin(url.origin);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Provider points to a non-public address');
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(url, { method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined,
      lookup: (_host, options, done) => {
        if ((options as { all?: boolean }).all) (done as Function)(null, addresses);
        else done(null, addresses[0].address, addresses[0].family);
      } }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) res.destroy(new Error(`Provider response exceeds ${maxBytes / 1024 / 1024} MB`)); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 502;
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status,
          headers: Object.fromEntries(Object.entries(res.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }));
      });
    });
    req.setTimeout(idleTimeoutMs, () => req.destroy(new Error('Provider request timed out'))); req.on('error', reject);
    if (init.body) req.write(init.body); req.end();
  });
}
export const MAX_MEDIA_BYTES = 256 * 1024 * 1024;
/** Streaming, credential-free transport for resumable media. Validate and pin every redirect's DNS. */
export async function streamMedia(raw: string, init: RequestInit, redirects = 0): Promise<Response> {
  const url = new URL(raw); providerOrigin(url.origin);
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Generated media points to a non-public address');
  return new Promise<Response>((resolve, reject) => {
    const req = https.get(url, { headers: Object.fromEntries(new Headers(init.headers)), signal: init.signal ?? undefined,
      lookup: (_host, options, done) => {
        if ((options as { all?: boolean }).all) (done as Function)(null, addresses);
        else done(null, addresses[0].address, addresses[0].family);
      } }, res => {
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) { reject(new Error('Too many media redirects')); return; }
        streamMedia(new URL(res.headers.location, url).href, init, redirects + 1).then(resolve, reject); return;
      }
      resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status,
        headers: Object.fromEntries(Object.entries(res.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) }));
    });
    // An idle timeout permits slow downloads that continue making progress.
    req.setTimeout(60_000, () => req.destroy(new Error('Media download timed out'))); req.on('error', reject);
  });
}
/** JSON responses are far smaller than media, and the cap has to apply before the body is buffered. */
export const MAX_JSON_BYTES = 16 * 1024 * 1024;
/** Download without credentials; pin validated DNS answers to prevent rebinding. */
export async function downloadMedia(raw: string, signal: AbortSignal, redirects = 0): Promise<Buffer> {
  if (raw.startsWith('data:')) {
    const match = /^data:(?:image|video|audio)\/[\w.+-]+;base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
    if (!match || match[1].length > MAX_MEDIA_BYTES * 1.4) throw new Error('Invalid or oversized media data URL');
    return Buffer.from(match[1], 'base64');
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Generated media must use public HTTPS');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Generated media points to a non-public address');
  return new Promise<Buffer>((resolve, reject) => {
    const req = https.get(url, { signal, lookup: (_host, options, done) => {
      if ((options as { all?: boolean }).all) (done as Function)(null, addresses);
      else done(null, addresses[0].address, addresses[0].family);
    } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= 3) { reject(new Error('Too many media redirects')); return; }
        downloadMedia(new URL(res.headers.location, url).href, signal, redirects + 1).then(resolve, reject); return;
      }
      // Status is kept for retry decisions; this is not a provider credential rejection.
      if (res.statusCode !== 200) { res.resume(); reject(Object.assign(new Error(`Media download HTTP ${res.statusCode}`), { status: res.statusCode })); return; }
      if (Number(res.headers['content-length'] || 0) > MAX_MEDIA_BYTES) { res.destroy(); reject(new Error('Generated media exceeds 256 MB')); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_MEDIA_BYTES) res.destroy(new Error('Generated media exceeds 256 MB')); else chunks.push(chunk); });
      res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(60_000, () => req.destroy(new Error('Media download timed out'))); req.on('error', reject);
  });
}
export function mediaType(bytes: Buffer, modality: Modality) {
  const head = bytes.subarray(0, 16), ascii = head.toString('ascii');
  const candidates = [
    [head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png', 'png'],
    [head[0] === 255 && head[1] === 216 && head[2] === 255, 'image/jpeg', 'jpg'],
    [ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP', 'image/webp', 'webp'],
    [/^GIF8[79]a/.test(ascii), 'image/gif', 'gif'],
    [ascii.slice(4, 8) === 'ftyp', modality === 'audio' ? 'audio/mp4' : 'video/mp4', modality === 'audio' ? 'm4a' : 'mp4'],
    [head.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')), modality === 'audio' ? 'audio/webm' : 'video/webm', 'webm'],
    [ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE', 'audio/wav', 'wav'],
    // ADTS AAC shares the MPEG audio sync bits; its layer bits are always 00, which no MP3 frame uses.
    [head[0] === 255 && (head[1] & 0xf6) === 0xf0, 'audio/aac', 'aac'],
    [ascii.startsWith('ID3') || (head[0] === 255 && (head[1] & 0xe0) === 0xe0), 'audio/mpeg', 'mp3'],
    [ascii.startsWith('OggS'), 'audio/ogg', 'ogg'], [ascii.startsWith('fLaC'), 'audio/flac', 'flac'],
  ] as const;
  const match = candidates.find(([matches, mime]) => matches && mime.startsWith(modality + '/'));
  if (!match || bytes.length < 24 || bytes.length > MAX_MEDIA_BYTES) throw new Error(`Provider did not return valid ${modality} media`);
  return { mimeType: match[1], extension: match[2] };
}
