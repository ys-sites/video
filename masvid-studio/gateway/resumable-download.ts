import { constants } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MAX_MEDIA_BYTES, streamMedia } from './network.ts';

export type DownloadProgress = { assetId: string; receivedBytes: number; totalBytes: number };
export type DownloadAsset = { assetId: string; size: number; mime: string; url: string };
type Checkpoint = { assetId: string; size: number; mime: string; bytes: number; sha256: string; etag?: string };
export const downloadInterrupted = 'The original image could not be downloaded. Continue downloading this task without generating again.';

/** URLs stay in memory. A strong ETag and a hashed checkpoint are required before appending bytes. */
export async function resumableDownload(directory: string, resolve: () => Promise<DownloadAsset>, signal: AbortSignal,
  progress: (value: DownloadProgress) => Promise<void>, transport: typeof streamMedia = streamMedia, attempts = 3) {
  const partial = path.join(directory, 'image.partial'), metadata = path.join(directory, 'image-download.json');
  const file = await open(partial, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  let checkpoint: Checkpoint | undefined;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > MAX_MEDIA_BYTES) throw new Error(downloadInterrupted);
    const record = await open(metadata, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => undefined);
    if (record) {
      try { const info = await record.stat(); if (info.isFile() && info.size < 8192) checkpoint = JSON.parse(await record.readFile('utf8')); }
      catch { /* Invalid checkpoint is discarded below. */ } finally { await record.close(); }
    }
    for (let attempt = 0; attempt < attempts; attempt++) {
      signal.throwIfAborted();
      // Also refresh expired signed URLs and recheck account/task identity on every attempt.
      const asset = await resolve();
      if (!asset.assetId || !Number.isSafeInteger(asset.size) || asset.size < 24 || asset.size > MAX_MEDIA_BYTES || !asset.mime.startsWith('image/')) throw new Error(downloadInterrupted);
      let bytes = 0, hash = createHash('sha256');
      if (checkpoint?.assetId === asset.assetId && checkpoint.size === asset.size && checkpoint.mime === asset.mime
        && Number.isSafeInteger(checkpoint.bytes) && checkpoint.bytes > 0 && checkpoint.bytes <= asset.size && (await file.stat()).size >= checkpoint.bytes) {
        const prefix = Buffer.alloc(checkpoint.bytes);
        const read = await file.read(prefix, 0, prefix.length, 0);
        if (read.bytesRead === prefix.length && createHash('sha256').update(prefix).digest('hex') === checkpoint.sha256) {
          bytes = prefix.length; hash.update(prefix);
        }
      }
      await file.truncate(bytes);
      const report = () => progress({ assetId: asset.assetId, receivedBytes: bytes, totalBytes: asset.size });
      if (bytes === asset.size) { await report(); return await file.readFile(); }
      // Without a strong validator a partial body cannot safely be combined with a new response.
      if (bytes && (!checkpoint?.etag || !/^"[^"\r\n]+"$/.test(checkpoint.etag))) { bytes = 0; hash = createHash('sha256'); await file.truncate(0); }
      let etag = checkpoint?.etag, response: Response | undefined;
      const save = async () => {
        await file.sync();
        checkpoint = { assetId: asset.assetId, size: asset.size, mime: asset.mime, bytes, sha256: hash.copy().digest('hex'), etag };
        const temporary = metadata + '.tmp';
        await rm(temporary, { force: true });
        const out = await open(temporary, 'wx', 0o600);
        try { await out.writeFile(JSON.stringify(checkpoint)); await out.sync(); } finally { await out.close(); }
        await rename(temporary, metadata); await report();
      };
      try {
        await report();
        response = await transport(asset.url, { signal, headers: { 'Accept-Encoding': 'identity', ...(bytes ? { Range: `bytes=${bytes}-`, 'If-Range': etag! } : {}) } });
        if (response.status === 416 && bytes) {
          bytes = 0; hash = createHash('sha256'); etag = undefined; await file.truncate(0);
          throw new Error(downloadInterrupted);
        }
        if (response.status !== 200 && response.status !== 206) throw new Error(downloadInterrupted);
        const nextEtag = response.headers.get('etag') ?? undefined;
        let expected = asset.size;
        if (response.status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') ?? '');
          if (!range || Number(range[1]) !== bytes || Number(range[3]) !== asset.size || Number(range[2]) !== asset.size - 1
            || bytes > 0 && nextEtag !== etag) {
            // Do not append even a single byte from an unverified range.
            bytes = 0; hash = createHash('sha256'); etag = undefined; await file.truncate(0);
            throw new Error(downloadInterrupted);
          }
          expected -= bytes;
        } else { bytes = 0; hash = createHash('sha256'); await file.truncate(0); }
        etag = nextEtag;
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity'
          || response.headers.has('content-length') && Number(response.headers.get('content-length')) !== expected || !response.body) throw new Error(downloadInterrupted);
        const reader = response.body.getReader();
        let savedAt = bytes;
        try {
          for (;;) {
            signal.throwIfAborted();
            const { value, done } = await reader.read(); if (done) break;
            if (bytes + value.length > asset.size) { bytes = 0; hash = createHash('sha256'); etag = undefined; await file.truncate(0); throw new Error(downloadInterrupted); }
            let offset = 0;
            while (offset < value.length) { const written = await file.write(value, offset, value.length - offset, bytes + offset); if (!written.bytesWritten) throw new Error(downloadInterrupted); offset += written.bytesWritten; }
            hash.update(value); bytes += value.length;
            if (bytes - savedAt >= 1024 * 1024) { await save(); savedAt = bytes; }
          }
        } finally { await reader.cancel().catch(() => {}); }
        await save();
        if (bytes !== asset.size) throw new Error(downloadInterrupted);
        return await file.readFile();
      } catch {
        await response?.body?.cancel().catch(() => {});
        await save(); signal.throwIfAborted();
        if (attempt + 1 === attempts) throw new Error(downloadInterrupted);
        await delay(500 * (attempt + 1), undefined, { signal });
      }
    }
    throw new Error(downloadInterrupted);
  } finally { await file.close(); }
}
