import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

export const mediaOrigin = 'https://releases.open-design.ai';
export const skillPreviewMedia = /^studio\/src\/motion\/skill-covers\/[a-z0-9-]+\.(?:mp4|webm|gif|webp)$/;
export const mediaPrefix = 'open-motion/media/sha256/';
export const maxMediaBytes = 50 * 1024 * 1024;
export type MediaLock = { path: string; url: string; bytes: number; sha256: string };
export type MediaManifest = { schemaVersion: 1; files: MediaLock[] };
export const mediaDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export function mediaPath(name: string): string {
  assert(typeof name === 'string' && name.length < 500 && /^[\w/.@+ -]+$/.test(name) &&
    !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..' && part !== '.git'), 'Unsafe media path');
  return name;
}

export function mediaKey(sha256: string, name: string): string {
  assert(/^[a-f0-9]{64}$/.test(sha256), 'Invalid media SHA-256');
  const extension = /\.(mp4|mov|webm|m4v|avi|mp3|wav|ogg|m4a|aac|flac|png|jpe?g|webp|avif|gif|woff2?|ttf|otf|motion)$/i.exec(name)?.[1].toLowerCase();
  assert(extension, 'Unsupported transfer media type');
  return mediaPrefix + sha256 + '.' + extension;
}

export function validateMediaLock(file: MediaLock): void {
  mediaPath(file.path);
  assert(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= maxMediaBytes, 'Media exceeds 50 MiB or has invalid size');
  assert.equal(file.url, mediaOrigin + '/' + mediaKey(file.sha256, file.path), 'Require an immutable public media URL matching its SHA-256');
}

export function validateMediaManifest(value: MediaManifest): MediaManifest {
  assert(value.schemaVersion === 1 && Array.isArray(value.files), 'Invalid repository media manifest');
  const paths = new Set<string>();
  for (const file of value.files) {
    validateMediaLock(file);
    assert(skillPreviewMedia.test(file.path) ||
      (/^(?:docs\/readme|library|examples)\//.test(file.path) && !file.path.startsWith('library/templates/catalog/')),
    'Repository media must be in a supported media directory. Catalog media belongs in template.json.remoteAssets');
    assert(!paths.has(file.path), 'Duplicate repository media path');
    paths.add(file.path);
  }
  return value;
}

/** Read a bounded stream; never follow redirects or accept partial/corrupt media. */
export async function boundedMediaBody(response: Response, limit: number): Promise<Buffer> {
  assert.equal(response.status, 200, `Media download returned HTTP ${response.status}`);
  assert(response.body, 'Missing media body');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) {
      throw new Error('Media response exceeds its declared size');
    }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  return bytes;
}

export async function downloadMedia(file: MediaLock, fetcher: typeof fetch = fetch): Promise<Buffer> {
  validateMediaLock(file);
  const transientCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_RES_CONTENT_LENGTH_MISMATCH']);
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetcher(file.url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
      const bytes = await boundedMediaBody(response, file.bytes);
      assert.equal(bytes.length, file.bytes, 'Media size mismatch');
      assert.equal(mediaDigest(bytes), file.sha256, 'Media SHA-256 mismatch');
      return bytes;
    } catch (error) {
      const interrupted = error instanceof Error && (error.name === 'TimeoutError' || transientCodes.has((error.cause as { code?: string })?.code ?? ''));
      if (attempt === 2 || !interrupted)
        throw new Error(`Media download failed for ${file.path}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      await setTimeout(250 * (attempt + 1));
    }
  }
}
