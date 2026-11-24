import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { createTracker, type PendingEvent } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import { mediaBytes } from './media-fixtures.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { gatewayFor } from '../gateway/service.ts';
import { assetOperation } from '../gateway/asset-operations.ts';
import { mediaUse } from '../gateway/media-use.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import type { WorkspaceStore } from '../workspace.ts';
import type { Modality } from '../shared/gateway.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
async function setup(store: WorkspaceStore, bytes = png, count = 1) {
  const gateway = gatewayFor(store); let submissions = 0;
  gateway.options.detect = async () => [];
  gateway.options.pollMs = 1;
  gateway.options.download = async () => bytes;
  gateway.options.fetcher = async (_url, init = {}) => {
    if (init.method === 'POST') { submissions++; return Response.json({ request_id: 'remote', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' }); }
    return Response.json({ status: 'COMPLETED', images: Array.from({ length: count }, () => ({ url: 'https://cdn.example/image.png' })) });
  };
  await gateway.configureProvider('fal', { apiKey: 'private-test-key' });
  const api = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  return { gateway, api, submissions: () => submissions };
}
async function finish(store: WorkspaceStore, id: string) {
  const gateway = gatewayFor(store); await gateway.tick();
  await Promise.all([...gateway.active.values()].map(task => task.done));
  return gateway.getJob(id);
}
const request = (store: WorkspaceStore, requestId = 'generate') => ({ action: 'generate', provider: 'fal', model: 'vendor/image', modality: 'image', prompt: 'A reusable lake', projectId: store.projectId, requestId });

for (const kind of ['image', 'video', 'audio'] as Modality[]) test(`project ${kind} keeps its original path and independent workspace asset`, () => fixture(async store => {
  const bytes = kind === 'image' ? png : await mediaBytes(kind);
  const { gateway } = await setup(store, bytes);
  try {
    // The dedicated adapter is shared across modalities; use a fixture provider response.
    gateway.options.fetcher = async (_url, init = {}) => Response.json(init.method === 'POST' ? { request_id: 'remote', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' } : { status: 'COMPLETED', [kind === 'image' ? 'images' : kind === 'video' ? 'video' : 'audio']: kind === 'image' ? [{ url: 'https://cdn.example/output' }] : { url: 'https://cdn.example/output' } });
    const input = { ...request(store), modality: kind, model: `vendor/${kind}` };
    const queued = await mediaUse(store, input), job = await finish(store, queued.job.id);
    assert.equal(job.state, 'completed', job.error); assert.equal(job.savePending, false);
    assert.match(job.assets[0].path, new RegExp(`^assets/generated/${job.id}-1\\.`));
    assert.equal(job.libraryAssets?.length, 1);
    const library = new AssetLibrary(store), resolved = await library.resolve(job.libraryAssets![0]);
    const projectFile = path.join(store.projectDirectory, job.assets[0].path);
    assert.deepEqual(await readFile(projectFile), bytes); assert.deepEqual(await readFile(resolved.filename), bytes);
    assert.notEqual((await stat(projectFile)).ino, (await stat(resolved.filename)).ino);
    assert.equal(resolved.version.source, 'generated'); assert.equal(resolved.version.jobId, job.id);
    assert.equal(resolved.version.model, `fal:vendor/${kind}`); assert.equal(resolved.version.prompt, input.prompt);
    await library.update(resolved.asset.id, { trashed: true });
    assert.deepEqual(await readFile(projectFile), bytes);
    await rm(projectFile); assert.deepEqual(await readFile(resolved.filename), bytes);
    assert.equal((await gateway.submit({ projectId: store.projectId, modality: kind, model: `fal:vendor/${kind}`, prompt: input.prompt, idempotencyKey: 'generate' })).id, job.id);
    assert.equal((await library.list({ trash: true })).total, 1);
  } finally { await gateway.close(); }
}));

test('partial commits recover through public retry_save after restart without paid retries or duplicate versions', t => fixture(async store => {
  const { gateway, api, submissions } = await setup(store, png, 2);
  const original = AssetLibrary.prototype.addLocked;
  let commits = 0;
  const failure = t.mock.method(AssetLibrary.prototype, 'addLocked', async function(this: AssetLibrary, ...args: Parameters<typeof original>) {
    const saved = await original.apply(this, args);
    if (++commits === 2) throw new Error('Simulated crash after metadata commit');
    return saved;
  });
  try {
    const queued = await api.call('openmotion_media_use', request(store));
    let job = await finish(store, queued.job.id);
    assert.equal(job.phase, 'save_failed'); assert.equal(job.savePending, true); assert.equal(submissions(), 1);
    assert.equal((await new AssetLibrary(store).list()).total, 2);
    assert.ok((await assetOperation(store, { action: 'jobs' })).jobs.some(j => j.id === job.id));
    assert.equal((await api.call('openmotion_media_use', request(store))).job.id, job.id);
    failure.mock.restore();
    await gateway.close();
    // A restarted worker must not need credentials or provider access to save.
    const { ModelGateway } = await import('../gateway/service.ts');
    const reopened = new ModelGateway(store, { detect: async () => { throw new Error('must not discover models'); }, fetcher: async () => { throw new Error('must not contact provider'); } });
    try {
      const [a, b] = await Promise.all([reopened.retrySave(job.id), reopened.retrySave(job.id)]);
      assert.equal(a.id, b.id); assert.equal(a.state, 'queued');
      await reopened.tick(); await Promise.all([...reopened.active.values()].map(task => task.done));
      job = await reopened.getJob(job.id);
      assert.equal(job.state, 'completed', job.error); assert.equal(job.assets.length, 2); assert.equal(job.libraryAssets?.length, 2);
      const assets = (await new AssetLibrary(store).list()).assets;
      assert.equal(assets.length, 2); assert.ok(assets.every(a => a.versions.length === 1));
      for (const output of job.assets) assert.deepEqual(await readFile(path.join(store.projectDirectory, output.path)), png);
      assert.equal((await reopened.retrySave(job.id)).state, 'completed');
      await assert.rejects(stat(path.join(gateway.root, 'work', job.id)), { code: 'ENOENT' });
      assert.equal(submissions(), 1);
    } finally { await reopened.close(); }
  } finally { failure.mock.restore(); await gateway.close(); }
}));

test('a project file conflict preserves generated assets and recovery refuses to overwrite edited bytes', () => fixture(async store => {
  const { gateway, api, submissions } = await setup(store);
  try {
    const { job: queued } = await api.call('openmotion_media_use', request(store));
    const target = path.join(store.projectDirectory, `assets/generated/${queued.id}-1.png`);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, 'user content');
    let job = await finish(store, queued.id);
    assert.equal(job.phase, 'save_failed'); assert.match(job.error!, /refusing to overwrite/);
    assert.equal((await readFile(target)).toString(), 'user content'); assert.equal(job.libraryAssets?.length, 1);
    await assert.rejects(api.call('openmotion_media_use', { action: 'retry_save', jobId: job.id, projectId: store.projectId }), /requestId/);
    await api.call('openmotion_assets_use', { action: 'retry_save', jobId: job.id, requestId: 'retry-conflict' });
    job = await finish(store, job.id); assert.equal(job.phase, 'save_failed');
    assert.equal((await readFile(target)).toString(), 'user content');
    await rm(target);
    await api.call('openmotion_media_use', { action: 'retry_save', projectId: store.projectId, jobId: job.id, requestId: 'save-only' });
    job = await finish(store, job.id); assert.equal(job.state, 'completed', job.error);
    assert.equal(submissions(), 1); assert.equal((await new AssetLibrary(store).list()).assets[0].versions.length, 1);
  } finally { await gateway.close(); }
}));

test('interrupted saving retains local bytes and missing/corrupted recovery never generates again', () => fixture(async store => {
  const { gateway, submissions } = await setup(store);
  try {
    const queued = await mediaUse(store, request(store));
    const jobFile = path.join(gateway.root, 'jobs', `${queued.job.id}.json`);
    const work = path.join(gateway.root, 'work', queued.job.id);
    await mkdir(work, { recursive: true });
    await writeFile(path.join(work, 'outputs.json'), JSON.stringify([{ path: `assets/generated/${queued.job.id}-1.png`, mimeType: 'image/png', bytes: png.length, sha256: '0'.repeat(64) }]));
    await writeFile(path.join(work, `${queued.job.id}-1.png`), png);
    await writeFile(jobFile, JSON.stringify({ ...queued.job, state: 'running', workerPid: 2147483647 }));
    let job = await finish(store, queued.job.id);
    assert.equal(job.phase, 'save_failed'); assert.equal(job.savePending, true);
    await assert.rejects(gateway.retrySave(job.id), /SAVE_NOT_AVAILABLE/); job = await gateway.getJob(job.id);
    assert.equal(job.phase, 'save_unavailable'); assert.equal(job.savePending, false); assert.equal(submissions(), 0);
    await rm(path.join(work, 'outputs.json'));
    await assert.rejects(gateway.retrySave(job.id), /SAVE_NOT_AVAILABLE/); assert.equal(submissions(), 0);
    assert.equal((await gateway.getJob(job.id)).savePending, false);
    assert.equal((await new AssetLibrary(store).list()).total, 0);
  } finally { await gateway.close(); }
}));

test('library edits recover an already-committed version without duplicating it or changing the original', t => fixture(async store => {
  const { gateway, api, submissions } = await setup(store);
  const events: PendingEvent[] = [];
  const tracking = createTracker({ registry: omEvents, entrypoint: 'worker', enabled: true, flushIntervalMs: 0,
    send: async batch => { events.push(...batch); return 'accepted'; } });
  gateway.options.tracking = tracking;
  const source = path.join(store.directory, 'original.png'); await writeFile(source, png);
  const library = new AssetLibrary(store), asset = await library.importFile(source, { requestId: 'original', name: 'Original' });
  const original = AssetLibrary.prototype.addLocked;
  const failure = t.mock.method(AssetLibrary.prototype, 'addLocked', async function(this: AssetLibrary, ...args: Parameters<typeof original>) {
    await original.apply(this, args); throw new Error('Job receipt write failed after asset commit');
  });
  try {
    const { job: queued } = await api.call('openmotion_assets_use', { action: 'generate', requestId: 'edit-original', model: 'fal:vendor/image', modality: 'image', prompt: 'Edit the lake', assetId: asset.id, parentVersionId: asset.currentVersionId });
    let job = await finish(store, queued.id);
    assert.equal(job.savePending, true); assert.equal((await library.get(asset.id)).versions.length, 2);
    failure.mock.restore();
    await api.call('openmotion_assets_use', { action: 'retry_save', jobId: job.id, requestId: 'save-edit' });
    job = await finish(store, job.id);
    assert.equal(job.state, 'completed', job.error); assert.equal(job.assets.length, 0); assert.equal(submissions(), 1);
    await tracking.flush();
    assert.deepEqual(events.map(e => e.event), ['media_generation_requested', 'media_generation_submitted', 'media_generation_result', 'media_generation_result']);
    assert.deepEqual(events.at(-1)?.properties, { job_id: job.id, modality: 'image', job_state: 'completed', asset_count: 1 });
    const edited = await library.get(asset.id);
    assert.equal(edited.versions.length, 2); assert.equal(edited.versions[1].parentVersionId, asset.currentVersionId);
    assert.deepEqual(await readFile((await library.resolve({ assetId: asset.id, versionId: asset.currentVersionId })).filename), png);
  } finally { failure.mock.restore(); await gateway.close(); tracking.close(); }
}));

for (const damage of ['missing-manifest', 'corrupt-manifest', 'empty-manifest', 'missing-file', 'changed-file', 'missing-after-queue']) test(`unrecoverable ${damage} clears save recovery without model usage`, () => fixture(async store => {
  const { gateway, api, submissions } = await setup(store);
  try {
    const { job: queued } = await mediaUse(store, request(store));
    const work = path.join(gateway.root, 'work', queued.id), file = path.join(work, `${queued.id}-1.png`), manifest = path.join(work, 'outputs.json');
    await mkdir(work, { recursive: true }); await writeFile(file, png);
    const output = { path: `assets/generated/${queued.id}-1.png`, mimeType: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') };
    await writeFile(manifest, JSON.stringify([output]));
    await writeFile(path.join(gateway.root, 'jobs', `${queued.id}.json`), JSON.stringify({ ...queued, state: 'failed', phase: 'save_failed', savePending: true }));
    if (damage === 'missing-manifest') await rm(manifest);
    if (damage === 'corrupt-manifest') await writeFile(manifest, '{');
    if (damage === 'empty-manifest') await writeFile(manifest, '[]');
    if (damage === 'missing-file') await rm(file);
    if (damage === 'changed-file') await writeFile(file, 'Changed retained bytes');
    const retry = { action: 'retry_save', jobId: queued.id, requestId: 'save-only' };
    if (damage === 'missing-after-queue') {
      await api.call('openmotion_assets_use', retry); await rm(file); await finish(store, queued.id);
    } else await assert.rejects(api.call('openmotion_assets_use', retry), /SAVE_NOT_AVAILABLE/);
    let failed = await gateway.getJob(queued.id);
    assert.equal(failed.state, 'failed'); assert.equal(failed.phase, 'save_unavailable'); assert.equal(failed.savePending, false);
    assert.match(failed.error!, /SAVE_NOT_AVAILABLE/); assert.equal(submissions(), 0);
    await gateway.tick(); failed = await gateway.getJob(queued.id);
    assert.equal(failed.savePending, false); assert.equal(submissions(), 0);
    assert.equal((await new AssetLibrary(store).list()).total, 0);
    if (!['missing-file', 'missing-after-queue', 'changed-file'].includes(damage)) assert.deepEqual(await readFile(file), png, 'Remaining paid bytes are preserved');
  } finally { await gateway.close(); }
}));

test('an unavailable decoder preserves save recovery instead of declaring retained bytes lost', () => fixture(async store => {
  const { gateway, submissions } = await setup(store);
  const previous = process.env.HYPERFRAMES_FFPROBE_PATH;
  try {
    const { job: queued } = await mediaUse(store, request(store));
    const work = path.join(gateway.root, 'work', queued.id), file = path.join(work, `${queued.id}-1.png`);
    await mkdir(work, { recursive: true }); await writeFile(file, png);
    await writeFile(path.join(work, 'outputs.json'), JSON.stringify([{ path: `assets/generated/${queued.id}-1.png`, mimeType: 'image/png', bytes: png.length, sha256: createHash('sha256').update(png).digest('hex') }]));
    await writeFile(path.join(gateway.root, 'jobs', `${queued.id}.json`), JSON.stringify({ ...queued, state: 'failed', phase: 'save_failed', savePending: true }));
    process.env.HYPERFRAMES_FFPROBE_PATH = path.join(store.directory, 'missing-ffprobe');
    await assert.rejects(gateway.retrySave(queued.id), error => !String(error).includes('SAVE_NOT_AVAILABLE'));
    const job = await gateway.getJob(queued.id);
    assert.equal(job.savePending, true); assert.equal(job.phase, 'save_failed'); assert.equal(submissions(), 0);
    assert.deepEqual(await readFile(file), png);
  } finally {
    if (previous === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH; else process.env.HYPERFRAMES_FFPROBE_PATH = previous;
    await gateway.close();
  }
}));

test('retained outputs that vanished or became unreadable end as a terminal failure instead of an endless retry', () => fixture(async store => {
  const { gateway, submissions } = await setup(store);
  const stage = async (broken: 'missing-bytes' | 'corrupt-manifest' | 'missing-manifest', state: 'failed' | 'queued') => {
    const queued = await mediaUse(store, request(store, broken));
    const work = path.join(gateway.root, 'work', queued.job.id), staged = path.join(work, `${queued.job.id}-1.png`);
    await mkdir(work, { recursive: true }); await writeFile(staged, png);
    await writeFile(path.join(work, 'outputs.json'), JSON.stringify([{ path: `assets/generated/${queued.job.id}-1.png`, mimeType: 'image/png', bytes: png.length, sha256: '0'.repeat(64) }]));
    await writeFile(path.join(gateway.root, 'jobs', `${queued.job.id}.json`), JSON.stringify({ ...queued.job, state, phase: state === 'queued' ? 'saving' : 'save_failed', savePending: true }));
    if (broken === 'missing-bytes') await rm(staged);
    else if (broken === 'corrupt-manifest') await writeFile(path.join(work, 'outputs.json'), '{ not json');
    else await rm(path.join(work, 'outputs.json'));
    return queued.job.id;
  };
  try {
    for (const broken of ['missing-bytes', 'corrupt-manifest', 'missing-manifest'] as const) {
      const id = await stage(broken, 'failed');
      await assert.rejects(gateway.retrySave(id), /SAVE_NOT_AVAILABLE/);
      await assert.rejects(gateway.retrySave(id), /SAVE_NOT_AVAILABLE/);
      const job = await gateway.getJob(id);
      assert.equal(job.savePending, false, broken); assert.equal(job.state, 'failed', broken); assert.equal(job.phase, 'save_unavailable', broken);
      assert.match(job.error!, /SAVE_NOT_AVAILABLE/);
    }
    // A recovery claimed before its staged bytes disappear also ends terminally rather than staying retryable.
    const orphaned = await stage('missing-bytes', 'queued');
    const job = await finish(store, orphaned);
    assert.equal(job.state, 'failed'); assert.equal(job.phase, 'save_unavailable'); assert.equal(job.savePending, false);
    assert.match(job.error!, /retained outputs are missing/);
    assert.equal(submissions(), 0); assert.equal((await new AssetLibrary(store).list()).total, 0);
  } finally { await gateway.close(); }
}));

