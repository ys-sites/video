import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import type { WorkspaceStore } from '../workspace.ts';
import { projectArchive } from '../project-archive.ts';
import { attachmentDisposition } from '../shared/http-header.ts';
import { jsonFile } from '../phase1-versions.ts';
import { PROJECT_ARCHIVE_LIMITS } from '../shared/project-archive.ts';

/** Browser transport only. Validation and registration are shared with public MCP. */
export async function projectArchiveHttp(req: IncomingMessage, res: ServerResponse, url: URL, store: WorkspaceStore, runtimeRoot?: string) {
  const root = path.join(store.directory, 'project-archives');
  if (url.pathname === '/api/project-archives/import' && req.method === 'POST') {
    const requestId = url.searchParams.get('requestId') ?? '';
    if (!/^[\w-]{1,100}$/.test(requestId)) throw new Error('INVALID_ARGUMENT: Stable requestId required');
    const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    if (!['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(contentType ?? '')) throw new Error('INVALID_PROJECT_ARCHIVE: Expected a ZIP upload');
    const rejectSize = () => { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'PROJECT_ARCHIVE_TOO_LARGE: Maximum 500 MB' })); req.resume(); };
    if (Number(req.headers['content-length']) > PROJECT_ARCHIVE_LIMITS.bytes) { rejectSize(); return true; }
    await mkdir(path.join(root, 'uploads'), { recursive: true, mode: 0o700 });
    const filename = path.join(root, 'uploads', randomUUID());
    const file = await open(filename, 'wx', 0o600);
    try {
      let bytes = 0;
      // destroyOnReturn=false lets an oversized upload receive an HTTP error.
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        bytes += chunk.length;
        if (bytes > PROJECT_ARCHIVE_LIMITS.bytes) { rejectSize(); return true; }
        await file.writeFile(chunk);
      }
      await file.close();
      const result = await projectArchive(store, { action: 'import', requestId, sourcePath: filename }, runtimeRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result));
    } finally { await file.close(); await rm(filename, { force: true }); }
    return true;
  }
  const match = url.pathname.match(/^\/api\/project-archives\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\/file$/);
  if (!match || !['GET', 'HEAD'].includes(req.method ?? '')) return false;
  const file = await open(path.join(root, 'files', match[1] + '.zip'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('PROJECT_ARCHIVE_UNAVAILABLE');
    const metadata = await jsonFile<{ filename: string }>(path.join(root, 'files', match[1] + '.json'), { filename: 'OpenMotion-projects.zip' });
    res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': info.size,
      'Content-Disposition': attachmentDisposition(metadata.filename, 'OpenMotion-projects.zip'),
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream({ autoClose: false }), res);
  } finally { await file.close(); }
  return true;
}
