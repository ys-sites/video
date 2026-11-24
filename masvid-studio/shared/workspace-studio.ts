import { deleteProjectAsset, readProjectAssetNames } from '../project-asset-names.ts';
import { attachmentDisposition } from './http-header.ts';
import { FONT_EXT } from './asset-names.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
import { lstatSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceStore, projectPath } from '../workspace.ts';
import { HYPERFRAMES_VERSION, repairGeneratedRegistry } from '../hyperframes.ts';
import { isMain } from './entry.ts';
import { withAvailableHistorySteps } from './studio-history-availability.ts';
import { MAX_ASSET_BYTES } from './asset-limits.ts';
import { repairCodeExtrudeMaterial } from './registry-material-compat.ts';
import { WorkRounds } from '../inline-video.ts';
import { createAppTracking, closeTracking } from './tracking.ts';
import { StudioRenderAttempts, StudioRenderBusy } from './studio-render-attempts.ts';

import { createFontCatalog, prepareFont, preparedFontResponse } from './studio-fonts.ts';
import { createPreviewFontPreparation } from './preview-fonts.ts';

export async function startWorkspaceStudio(runtimeRoot: string, dataDirectory: string, initialDirectory: string, port: number) {
  const require = createRequire(path.join(runtimeRoot, 'package.json'));
  const cli = path.dirname(require.resolve('hyperframes/package.json'));
  const manifest = JSON.parse(await readFile(path.join(cli, 'package.json'), 'utf8'));
  if (manifest.version !== HYPERFRAMES_VERSION) throw new Error('Unsupported Hyperframes workspace host version');
  // shortcut: 0.9.7 exposes the complete host only in its bundle; use a public host factory when upstream provides one.
  const bundles = (await readdir(path.join(cli, 'dist'))).filter(name => /^studioServer-[\w-]+\.js$/.test(name));
  if (bundles.length !== 1) throw new Error('Hyperframes workspace host bundle is missing or ambiguous');
  const { createStudioServer } = await import(pathToFileURL(path.join(cli, 'dist', bundles[0])).href);
  if (typeof createStudioServer !== 'function') throw new Error('Hyperframes workspace host factory is unavailable');
  const { getRequestListener } = await import(pathToFileURL(require.resolve('@hono/node-server')).href);
  const { Hono } = await import(pathToFileURL(require.resolve('hono')).href);
  const { streamSSE } = await import(pathToFileURL(require.resolve('hono/streaming')).href);
  const { serveStatic } = await import(pathToFileURL(require.resolve('@hono/node-server/serve-static')).href);
  const { bodyLimit } = await import(pathToFileURL(require.resolve('hono/body-limit')).href);
  const coreRoot = path.dirname(require.resolve('@hyperframes/core/package.json'));
  const core = JSON.parse(await readFile(path.join(coreRoot, 'package.json'), 'utf8'));
  const { collectFontFileEntries, fontDirectories } = await import(pathToFileURL(path.join(coreRoot, core.exports['./fonts/system-locator'].import)).href);
  const { injectDeterministicFontFaces } = await import(pathToFileURL(path.join(coreRoot, core.exports['./fonts/embed'].import)).href);
  const preparePreviewFonts = createPreviewFontPreparation(injectDeterministicFontFaces);
  const { create: parseFont } = require('fontkit');
  const fonts = createFontCatalog(fontDirectories().flatMap(directory => collectFontFileEntries(directory).map(entry => entry.path)), parseFont);
  const historyModule = path.join(path.dirname(require.resolve('@hyperframes/studio-server/package.json')), 'dist/history/index.js');
  const { DEFAULT_HISTORY_ROOT } = await import(pathToFileURL(historyModule).href);
  const historyRoot = process.env.HYPERFRAMES_HISTORY_ROOT ?? DEFAULT_HISTORY_ROOT;
  const store = new WorkspaceStore(dataDirectory);
  const tracking = await createAppTracking(dataDirectory, 'worker');
  const workRounds = new WorkRounds(store, tracking);
  const hosts = new Map<string, Promise<any>>();
  let origin = '', closing = false;
  const hostFor = (id: string): Promise<any> => {
    store.forProject(id);
    let opening = hosts.get(id);
    if (!opening) {
      opening = (async () => {
        const scoped = store.forProject(id);
        await scoped.safePath('index.html');
        await repairGeneratedRegistry(scoped.projectDirectory);
        if (closing) throw new Error('Studio is stopping');
        const host = createStudioServer({ projectDir: scoped.projectDirectory, projectName: id,
          origin: () => origin, historyRoot });
        const transformPreviewHtml = host.adapter.transformPreviewHtml.bind(host.adapter);
        host.adapter.transformPreviewHtml = async options => transformPreviewHtml({
          ...options, html: await preparePreviewFonts(options.html),
        });
        // Keep the upstream catalog, but repair its pinned WebGL 1 material defect.
        // This adapter is shared by Studio registry-install callers.
        const installRegistryBlock = host.adapter.installRegistryBlock?.bind(host.adapter);
        if (installRegistryBlock) host.adapter.installRegistryBlock = async options => {
          const result = await installRegistryBlock(options);
          if (options.blockName === 'code-3d-extrude') {
            for (const file of result.written ?? []) {
              if (!file.endsWith('.html')) continue;
              const filename = await scoped.safePath(file);
              const source = await readFile(filename, 'utf8');
              const repaired = repairCodeExtrudeMaterial(source);
              if (repaired !== source) await writeFile(filename, repaired);
            }
          }
          return result;
        };
        const nativeApp = host.app;
        const attempts = new StudioRenderAttempts(scoped.projectDirectory, async attempt => {
          if (attempt.workId) await workRounds.exported(id, attempt.workId, 'studio');
        });
        const shutdown = host.shutdown.bind(host);
        host.shutdown = async () => { try { await shutdown(); } finally { attempts.close(); await attempts.flushNotifications(); } };
        const renderRequest = new AsyncLocalStorage<{ filename?: string; createdAt?: number; requestId?: string; workId?: string; busy?: boolean }>();
        const startRender = host.adapter.startRender.bind(host.adapter);
        host.adapter.startRender = (options: { outputPath: string; jobId: string }) => {
          const request = renderRequest.getStore();
          if (!request) return startRender(options);
          const title = scoped.projectCatalog().projects.find(project => project.id === id)?.title;
          try {
            const { state, attempt } = attempts.start(options, title, startRender, request.requestId, request.workId);
            request.filename = attempt.filename;
            request.createdAt = attempt.createdAt;
            return state;
          } catch (error) {
            if (error instanceof StudioRenderBusy) request.busy = true;
            throw error;
          }
        };
        host.app = new Hono().get('/api/fonts', async c => c.json({ fonts: await fonts.families() }))
          .post('/api/projects/:id/render', async c => {
            const busy = () => c.json({ code: 'EXPORT_BUSY', applied: false, error: 'An export is already in progress. Check the original task.' }, 409);
            if (attempts.hasActiveWorker()) return busy();
            const body = await c.req.raw.clone().json().catch(() => null);
            const result: { filename?: string; createdAt?: number; requestId?: string; workId?: string; busy?: boolean } = {};
            if (typeof body?.requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(body.requestId)) result.requestId = body.requestId;
            // Bind to the authored work at request time. Completion retains this
            // identity even when another work round starts while rendering.
            if (body?.telemetryOptOut !== true && tracking.enabled())
              result.workId = (await workRounds.latestGenerated(id).catch(() => undefined))?.id;
            return renderRequest.run(result, async () => {
              const response = await nativeApp.fetch(c.req.raw);
              // Native handlers may turn adapter errors into a 500 response.
              // Keep a racing refusal distinct from an accepted render.
              if (result.busy) return busy();
              if (!response.ok || !result.filename) return response;
              return c.json({ ...await response.json(), filename: result.filename, createdAt: result.createdAt });
            });
          })
          .get('/api/projects/:id/renders', c => c.json({ renders: attempts.list() }))
          .get('/api/render/:jobId/progress', c => {
            const jobId = c.req.param('jobId');
            if (attempts.wasDeleted(jobId)) return c.notFound();
            if (!attempts.get(jobId)) return nativeApp.fetch(c.req.raw);
            return streamSSE(c, async stream => {
              while (!stream.aborted) {
                const current = attempts.get(jobId);
                if (!current) break;
                await stream.writeSSE({ event: 'progress', data: JSON.stringify(current) });
                if (current.status !== 'rendering' && current.status !== 'cancelling') break;
                await stream.sleep(500);
              }
            });
          })
          .post('/api/render/:jobId/cancel', c => {
            const jobId = c.req.param('jobId');
            if (attempts.wasDeleted(jobId)) return c.notFound();
            const attempt = attempts.cancel(jobId);
            return attempt ? c.json({ status: attempt.status }) : nativeApp.fetch(c.req.raw);
          })
          .delete('/api/render/:jobId', c => {
            try {
              return attempts.delete(c.req.param('jobId')) ? c.json({ deleted: true }) : nativeApp.fetch(c.req.raw);
            } catch (error) {
              if (error instanceof Error && error.message === 'Render has no confirmed terminal state') return c.json({ error: error.message }, 409);
              throw error;
            }
          })
          .get('/api/render/:jobId/:action{view|download}', (c, next) => {
            const jobId = c.req.param('jobId');
            if (attempts.wasDeleted(jobId)) return c.notFound();
            const attempt = attempts.get(jobId) ?? attempts.list().find(attempt => attempt.id === jobId);
            if (!attempt) return next();
            if (!attempt.fileAvailable) return c.notFound();
            if (c.req.param('action') === 'download') {
              c.header('Content-Disposition', attachmentDisposition(attempt.filename));
            }
            return serveStatic({ root: attempts.directory, path: attempt.filename })(c, () => c.notFound());
          })
          .get('/api/projects/:id/renders/file/:filename', async c => {
            const filename = c.req.param('filename');
            if (/[\/\\\x00]/.test(filename) || !/\.(mp4|mov|webm|gif)$/i.test(filename)) return c.notFound();
            const attempt = attempts.list().find(attempt => attempt.filename === filename);
            if (attempt && !attempt.fileAvailable) return c.notFound();
            const directory = path.join(scoped.projectDirectory, 'renders');
            if (!lstatSync(directory, { throwIfNoEntry: false })?.isDirectory() ||
                !lstatSync(path.join(directory, filename), { throwIfNoEntry: false })?.isFile()) return c.notFound();
            return serveStatic({ root: directory, path: filename })(c, () => c.notFound());
          })
          .get('/api/fonts/file', async c => {
            const family = c.req.query('family');
            if (!family) return c.json({ error: 'family parameter required' }, 400);
            const font = await fonts.file(family);
            return font ? preparedFontResponse(font) : c.json({ error: 'font not found' }, 404);
          }).post('/api/fonts/prepare', bodyLimit({ maxSize: MAX_ASSET_BYTES }), async c => {
            try { return preparedFontResponse(prepareFont(Buffer.from(await c.req.arrayBuffer()), parseFont)); }
            catch { return c.json({ error: 'Unsupported or invalid font file' }, 400); }
          }).post('/api/projects/:id/fonts/import', bodyLimit({ maxSize: 4096 }), async c => {
            const input = await c.req.json().catch(() => null);
            if (!input || typeof input.family !== 'string' || !input.family.trim()) return c.json({ error: 'Font family required' }, 400);
            const font = await fonts.file(input.family);
            if (!font) return c.json({ error: 'Font not found' }, 404);
            const name = font.postscriptName.replace(/[^a-zA-Z0-9_-]/g, '_') + '-' + randomUUID().slice(0, 8);
            const asset = `assets/fonts/${name}.${font.format}`;
            await mkdir(await scoped.safePath('assets/fonts'), { recursive: true });
            await writeFile(await scoped.safePath(asset), font.data, { flag: 'wx' });
            return c.json({ family: font.family, weight: font.weight, style: font.style, path: asset }, 201);
          }).get('/api/projects/:id', async c => {
            const response = await nativeApp.fetch(c.req.raw);
            if (!response.ok) return response;
            const data = await response.json();
            const projectFonts = [];
            for (const file of data.files ?? []) {
              if (!FONT_EXT.test(file)) continue;
              try {
                const faces = await fonts.inspect(await scoped.safePath(file));
                // Existing collections retain their actual first face until explicitly re-imported.
                const { index: _index, ...face } = faces[0];
                projectFonts.push({ ...face, path: file });
              } catch { /* Invalid historical files remain on disk but are not offered as fonts. */ }
            }
            return c.json({ ...data, fonts: projectFonts, ...await readProjectAssetNames(scoped, data.files ?? [], projectFonts) });
          }).delete('/api/projects/:id/files/*', c => {
            const pathname = new URL(c.req.url).pathname;
            let assetPath: string;
            try { assetPath = projectPath(decodeURIComponent(pathname.slice(pathname.indexOf('/files/') + '/files/'.length))); }
            catch { return c.json({ error: 'Invalid project path' }, 400); }
            return deleteProjectAsset(scoped, assetPath, () => nativeApp.fetch(c.req.raw));
          }).post('/api/projects/:id/upload', bodyLimit({
          maxSize: MAX_ASSET_BYTES,
          onError: c => c.json({ error: 'Upload exceeds 500 MB (500000000 bytes)', maxBytes: MAX_ASSET_BYTES }, 413),
        }), c => nativeApp.fetch(c.req.raw)).all('*', c => nativeApp.fetch(c.req.raw));
        const openHistory = host.adapter.history;
        const histories = new WeakMap();
        host.adapter.history = async () => {
          const history = await openHistory();
          // Native window/close requests compare history objects by identity.
          if (history && !histories.has(history)) histories.set(history, withAvailableHistorySteps(history, historyRoot));
          return history && histories.get(history);
        };
        return host;
      })().catch(error => { hosts.delete(id); throw error; });
      hosts.set(id, opening);
    }
    return opening;
  };
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  const fetchRequest = async (request: Request) => {
    try {
      const url = new URL(request.url);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return json({ error: 'Local hosts only' }, 403);
      if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== url.origin) return json({ error: 'Same-origin writes only' }, 403);
      if (closing) return json({ error: 'Studio is stopping' }, 503);
      const matched = url.pathname.match(/^\/api\/projects\/([^/]+)/);
      const pathId = matched ? decodeURIComponent(matched[1]) : undefined;
      const queryId = url.searchParams.get('projectId') ?? undefined;
      if (pathId && queryId && pathId !== queryId) return json({ error: 'PROJECT_SCOPE_MISMATCH' }, 400);
      const id = pathId ?? queryId;
      if (id !== undefined) store.forProject(id);
      if (url.pathname === '/__hyperframes_config') {
        if (id) await hostFor(id);
        return json({ isHyperframes: true, version: HYPERFRAMES_VERSION, pid: process.pid,
          projectDir: id ? store.projectDirectoryFor(id) : initialDirectory, dataDirectory, multiProject: true });
      }
      if (url.pathname === '/api/projects') return json({ projects: store.projectCatalog().projects.map(project => ({ id: project.id, title: project.title, dir: store.projectDirectoryFor(project.id) })) });
      const sharedResource = url.pathname === '/' || url.pathname.startsWith('/assets/') || /^\/api\/(?:runtime\.js|vendor\/|fonts|environment\/|assets\/global)/.test(url.pathname);
      const catalog = store.projectCatalog();
      const target = id ?? (catalog.projects.length === 1 || sharedResource ? catalog.projects.find(project => store.projectDirectoryFor(project.id) === initialDirectory)?.id : undefined);
      if (!target) return json({ error: 'PROJECT_NOT_BOUND: specify projectId' }, 400);
      const host = await hostFor(target);
      return await host.app.fetch(request);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Studio request failed' }, /PROJECT_NOT_FOUND|ENOENT/.test(String(error)) ? 404 : 400);
    }
  };
  const server = createServer(getRequestListener(fetchRequest));
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }
      else reject(error);
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { server, origin, close: async () => {
    closing = true;
    server.closeAllConnections(); server.close();
    const contexts = await Promise.allSettled(hosts.values());
    await Promise.all(contexts.map(async context => { if (context.status === 'fulfilled') { context.value.watcher.close(); await context.value.shutdown(); } }));
    await closeTracking(tracking);
  } };
}

if (isMain(import.meta.url)) {
  const [runtimeRoot, dataDirectory, initialDirectory, port] = process.argv.slice(2);
  const running = await startWorkspaceStudio(runtimeRoot, dataDirectory, initialDirectory, Number(port));
  console.log(JSON.stringify({ ok: true, result: { ready: true, projectDir: initialDirectory, studioUrl: running.origin } }));
  const stop = () => { void running.close().finally(() => process.exit(0)); };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}
