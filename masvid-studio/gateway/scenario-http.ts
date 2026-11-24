import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { jsonFile } from '../phase1-versions.ts';
import { attachmentDisposition } from '../shared/http-header.ts';
import type { WorkspaceStore } from '../workspace.ts';

const BUNDLE_ROUTE_RE = /^\/api\/scenarios\/bundles\/([^/]+)\/file$/;
const UUID_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Browser download transport for scenario ZIP bundles. Building and receipts live in gateway/scenario-bundle.ts. */
export async function scenarioHttp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  store: WorkspaceStore,
): Promise<boolean> {
  const match = BUNDLE_ROUTE_RE.exec(url.pathname);
  if (!match || !['GET', 'HEAD'].includes(req.method ?? '')) return false;

  const notFound = () => {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'BUNDLE_NOT_FOUND' }));
    return true;
  };

  const bundleId = match[1];
  if (!UUID_RE.test(bundleId)) return notFound();

  const bundlesDir = path.join((store.workspaceStore ?? store).directory, 'scenarios', 'bundles');
  const zipPath = path.join(bundlesDir, `${bundleId}.zip`);
  let file;
  try {
    file = await open(zipPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return notFound();
    throw error;
  }

  try {
    const info = await file.stat();
    if (!info.isFile()) return notFound();
    const metadata = await jsonFile<{ filename: string }>(
      path.join(bundlesDir, `${bundleId}.json`),
      { filename: 'OpenMotion-workflow.zip' },
    );
    const name = metadata.filename || 'OpenMotion-workflow.zip';
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': info.size,
      'Content-Disposition': attachmentDisposition(name, /^[\x20-\x7e]+$/.test(name) ? name : 'OpenMotion-workflow.zip'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    if (req.method === 'HEAD') res.end();
    else await pipeline(file.createReadStream({ autoClose: false }), res);
  } finally {
    await file.close();
  }
  return true;
}
