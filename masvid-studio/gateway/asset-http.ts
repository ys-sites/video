import { randomUUID } from 'node:crypto';
import { attachmentDisposition } from '../shared/http-header.ts';
import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkspaceStore } from '../workspace.ts';
import { MAX_ASSET_BYTES } from '../shared/asset-limits.ts';
import { mediaFilename } from '../shared/render-name.ts';
import { AssetLibrary, libraryId } from './asset-library.ts';
import { requireNativeRuntime } from '../scripts/npm-runtime.mjs';
import { pluginRoot } from '../hyperframes.ts';

/** Called behind the existing loopback host and same-origin mutation checks. */
export async function assetHttp(req: IncomingMessage, res: ServerResponse, url: URL, store: WorkspaceStore) {
  const library = new AssetLibrary(store);
  if (url.pathname === '/api/assets/upload' && req.method === 'POST') {
    const name = decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
    const requestId = url.searchParams.get('requestId') ?? '';
    const expectedModality = url.searchParams.get('modality') === 'video' ? 'video' : undefined;
    if (!/^[\w-]{1,100}$/.test(requestId) || !name || name.length > 200) throw new Error('A filename and stable requestId are required');
    if (Number(req.headers['content-length']) > MAX_ASSET_BYTES) { res.writeHead(413); res.end(); return true; }
    await requireNativeRuntime(pluginRoot, 'media');
    const staging = await store.safePath('uploads', library.root);
    await mkdir(staging, { recursive: true, mode: 0o700 });
    const filename = path.join(staging, randomUUID()); let size = 0;
    try {
      const file = await open(filename, 'wx', 0o600);
      await pipeline(req, new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length; callback(size > MAX_ASSET_BYTES ? new Error('Asset exceeds 500 MB') : null, chunk);
      } }), file.createWriteStream());
      const asset = await library.importFile(filename, { requestId, name, expectedModality,
        assetId: url.searchParams.get('assetId') ?? undefined, parentVersionId: url.searchParams.get('parentVersionId') ?? undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ asset }));
    } finally { await rm(filename, { force: true }); }
    return true;
  }
  const media = url.pathname.match(/^\/api\/assets\/([^/]+)\/versions\/([^/]+)\/file$/);
  if (!media || !['GET', 'HEAD'].includes(req.method ?? '')) return false;
  if (!libraryId(media[1]) || !libraryId(media[2])) throw new Error('ASSET_VERSION_UNAVAILABLE');
  const { filename, version } = await library.resolve({ assetId: media[1], versionId: media[2] }, true);
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size !== version.bytes) throw new Error('Asset file is missing or changed');
    let start = 0, end = info.size - 1, status = 200;
    if (req.headers.range) {
      const match = req.headers.range.match(/^bytes=(\d*)-(\d*)$/);
      if (!match || !match[1] && !match[2]) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
      start = match[1] ? Number(match[1]) : Math.max(0, info.size - Number(match[2]));
      end = match[1] && match[2] ? Math.min(Number(match[2]), info.size - 1) : info.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= info.size) { res.writeHead(416, { 'Content-Range': `bytes */${info.size}` }); res.end(); return true; }
      status = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`);
    }
    const title = url.searchParams.get('title');
    const downloadName = title?.trim() ? mediaFilename(title, path.extname(version.filename)) : version.filename;
    const plainDownloadName = /^[\x20-\x7e]+$/.test(downloadName) ? downloadName : version.filename;
    res.writeHead(status, { 'Content-Type': version.mimeType, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff',
      ...(url.searchParams.has('download') ? { 'Content-Disposition': attachmentDisposition(downloadName, plainDownloadName) } : {}) });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream({ start, end, autoClose: false }), res);
  } finally { await file.close(); }
  return true;
}
