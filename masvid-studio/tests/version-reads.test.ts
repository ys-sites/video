import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WorkspaceStore } from '../workspace.ts';
import { ProjectVersions } from '../phase1-versions.ts';
import type { ContentVersion, NativeHistory } from '../phase1-versions.ts';
import { ModelGateway } from '../gateway/service.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';

test('project catalog reads finish after a stalled preview has entered the shared service', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-catalog-queue-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root);
  await mkdir(store.projectDirectory, { recursive: true });
  await writeFile(path.join(store.projectDirectory, 'index.html'), 'catalog fixture');
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
  });
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const dispatch = service.dispatch.bind(service);
  service.dispatch = async (name, args, host) => {
    if (name === 'motion_open_preview') { entered.resolve(); await release.promise; return { projectId: args.projectId }; }
    return dispatch(name, args, host);
  };
  let openingSettled = false;
  const opening = service.call('openmotion_open_preview', { projectId: 'project' }).finally(() => { openingSettled = true; });
  let listing: Promise<any> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await entered.promise;
    listing = service.call('openmotion_get_project', {});
    const listed = await Promise.race([listing, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Catalog read queued behind the stalled preview')), 1000);
    })]);
    assert.ok(listed.projects.some((project: any) => project.id === 'project'));
    assert.equal(openingSettled, false);
  } finally { clearTimeout(timer); release.resolve(); await Promise.allSettled([opening, listing]); }
});

test('queries share streaming hash checks and invalidate changed, deleted and repaired historical blobs', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-version-reads-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.HYPERFRAMES_HISTORY_ROOT;
  process.env.HYPERFRAMES_HISTORY_ROOT = path.join(root, 'native');
  t.after(() => { if (previous === undefined) delete process.env.HYPERFRAMES_HISTORY_ROOT; else process.env.HYPERFRAMES_HISTORY_ROOT = previous; });
  const store = new WorkspaceStore(root), versions = new ProjectVersions(store, pluginRoot), id = crypto.randomUUID();
  await mkdir(path.join(store.projectDirectory, '.hyperframes'), { recursive: true });
  await writeFile(path.join(store.projectDirectory, '.hyperframes/history-id'), id);
  const bytes = Buffer.alloc(2 * 1024 * 1024, 35), hash = createHash('sha256').update(bytes).digest('hex');
  const native = path.join(process.env.HYPERFRAMES_HISTORY_ROOT, id, 'blobs', hash.slice(0, 2), hash), retained = versions.blob(hash);
  for (const file of [native, retained]) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); }
  const version: ContentVersion = { versionId: crypto.randomUUID(), versionNumber: 1, nativePoint: 'start', createdAt: Date.now(), source: 'baseline', summary: 'Fixture', revision: 'fixture',
    files: [{ path: 'image.png', hash, size: bytes.length }, { path: 'video.mp4', hash, size: bytes.length, retained: true }] };
  let streams = 0;
  const original = fs.createReadStream;
  fs.createReadStream = ((...args: Parameters<typeof fs.createReadStream>) => { if ([native, retained].includes(String(args[0]))) streams++; return original(...args); }) as typeof fs.createReadStream;
  syncBuiltinESMExports();
  t.after(() => { fs.createReadStream = original; syncBuiltinESMExports(); });
  const history = { readBlob: () => readFile(native) } as unknown as NativeHistory;
  const shown = await Promise.all(Array.from({ length: 5 }, () => versions.publicVersion(version, history, true)));
  assert.ok(shown.every(version => version.restorable)); assert.equal(streams, 2, 'shared files are hashed once, including in-flight checks');
  const scoped = new ProjectVersions(store.forProject('project'), pluginRoot);
  await scoped.publicVersion(version, history, true); assert.equal(streams, 2, 'a later scoped request reuses unchanged checks');
  for (const [file, name] of [[native, 'image.png'], [retained, 'video.mp4']]) {
    for (const damage of ['corrupt', 'missing']) {
      if (damage === 'corrupt') await writeFile(file, Buffer.alloc(bytes.length)); else await rm(file);
      const listed = await scoped.publicVersion(version, history, true);
      assert.equal(listed.restorable, false); assert.deepEqual(listed.unavailableFiles, [name]);
      await assert.rejects(scoped.restore(history, version, 'fixture', version.versionId, 'restore-' + damage), /VERSION_NOT_RESTORABLE/);
      await writeFile(file, bytes);
      assert.equal((await scoped.publicVersion(version, history, true)).restorable, true);
    }
  }
  const moved = path.join(process.env.HYPERFRAMES_HISTORY_ROOT, id, 'aside', hash.slice(0, 2), hash);
  await mkdir(path.dirname(moved), { recursive: true }); await writeFile(moved, bytes); await rm(native);
  assert.equal((await scoped.publicVersion(version, history, true)).restorable, true, 'native aside remains readable');
});
test('the initial version follows media native history adopts into its baseline after the first read', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-baseline-adopt-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root), versions = new ProjectVersions(store, pluginRoot);
  const html = Buffer.from('<div data-composition-id="main"></div>'), media = Buffer.alloc(2 * 1024 * 1024, 61);
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  await mkdir(path.join(store.projectDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(store.projectDirectory, 'index.html'), html);
  await writeFile(path.join(store.projectDirectory, 'assets/clip.mp4'), media);
  // Native history copies large files later, so its first baseline omits them.
  let baseline: Record<string, string> = { 'index.html': sha(html) };
  const history = { checkpoint: async () => {}, list: () => [], peek: (point: string) => point === 'start' ? baseline : null,
    pin: async () => {}, readBlob: async () => Buffer.alloc(0) } as unknown as NativeHistory;
  await assert.rejects(versions.current(history), /VERSION_CONFLICT/);
  const first = (await versions.index()).versions[0];
  baseline = { ...baseline, 'assets/clip.mp4': sha(media) };
  const current = await versions.current(history);
  assert.equal(current.revision, (await store.get()).revision);
  assert.equal(current.versionId, first.versionId); assert.equal(current.versionNumber, 1);
  assert.deepEqual(current.files.map(file => file.path), ['assets/clip.mp4', 'index.html']);
  assert.equal((await versions.current(history)).versionId, first.versionId);
  assert.equal((await versions.index()).versions.length, 1);
});
test('empty export and model queues do not acquire workspace locks', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-idle-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root), gateway = new ModelGateway(store); t.after(() => gateway.close());
  store.lock = async () => assert.fail('An idle queue must not acquire a workspace lock');
  for (let i = 0; i < 4; i++) { assert.equal(await store.claimExport(), null); await gateway.tick(); }
});
test('adding a caption reuses verified historical media instead of reading its bytes again', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-caption-reads-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.HYPERFRAMES_HISTORY_ROOT;
  process.env.HYPERFRAMES_HISTORY_ROOT = path.join(root, 'native');
  t.after(() => { if (previous === undefined) delete process.env.HYPERFRAMES_HISTORY_ROOT; else process.env.HYPERFRAMES_HISTORY_ROOT = previous; });
  const store = new WorkspaceStore(root), service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
  });
  const created = await service.call('openmotion_create_project', { requestId: 'create', projectType: 'natural_language', title: 'Caption performance', requirements: 'Editable captions' });
  const scoped = store.forProject(created.projectId), media = path.join(scoped.projectDirectory, 'assets/media.mp4');
  await mkdir(path.dirname(media), { recursive: true });
  await writeFile(media, Buffer.alloc(2 * 1024 * 1024, 51));
  const detail = await service.call('openmotion_get_project', { projectId: created.projectId });
  const versions = service.versions(created.projectId), version = (await versions.index()).versions.at(-1)!;
  const mediaFile = version.files.find(file => file.path === 'assets/media.mp4')!;
  const historicalMedia = mediaFile.retained ? versions.blob(mediaFile.hash) : await versions.nativeBlob(mediaFile.hash);
  let mediaReads = 0;
  const original = fs.createReadStream;
  fs.createReadStream = ((...args: Parameters<typeof fs.createReadStream>) => {
    if (String(args[0]) === historicalMedia) mediaReads++;
    return original(...args);
  }) as typeof fs.createReadStream;
  syncBuiltinESMExports();
  t.after(() => { fs.createReadStream = original; syncBuiltinESMExports(); });
  const added = await service.call('openmotion_assets_use', { action: 'transcript', transcript: {
    command: 'caption_add', projectId: created.projectId, compositionPath: 'index.html', requestId: 'caption',
    expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId,
    segments: [{ id: 'line', text: 'New caption', start: 0, end: 3 }],
  } });
  assert.equal(added.captionCount, 1);
  assert.equal(mediaReads, 0, 'a caption-only commit must not reread unchanged retained media');
  assert.equal(added.version.restorable, true);
  assert.match(await readFile(path.join(scoped.projectDirectory, 'index.html'), 'utf8'), /New caption/);
  await assert.rejects(service.call('openmotion_assets_use', { action: 'transcript', transcript: {
    command: 'caption_add', projectId: created.projectId, compositionPath: 'index.html', requestId: 'stale-caption',
    expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId,
    segments: [{ id: 'line', text: 'Stale caption', start: 0, end: 3 }],
  } }), /VERSION_CONFLICT/);
});
test('export copies remain immutable under in-place source writes and preserve revision checks', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-snapshot-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root);
  await mkdir(path.join(store.projectDirectory, 'assets'), { recursive: true });
  await writeFile(path.join(store.projectDirectory, 'index.html'), '<div id="main" data-composition-id="main" data-width="1920" data-height="1080" data-duration="1" data-fps="30"></div>');
  const source = path.join(store.projectDirectory, 'assets/bytes.bin'), bytes = Buffer.alloc(64 * 1024, 53);
  await writeFile(source, bytes);
  const before = await store.get(), job = await store.requestExport(before.revision);
  const handle = await (await import('node:fs/promises')).open(source, 'r+');
  try { await handle.write(Buffer.alloc(bytes.length, 54), 0, bytes.length, 0); } finally { await handle.close(); }
  assert.deepEqual(await readFile(path.join(store.snapshotDirectory(job.id), 'assets/bytes.bin')), bytes);
  assert.equal(store.revision(await store.files(store.snapshotDirectory(job.id))), before.revision);
  assert.notEqual((await store.get()).revision, before.revision);
  await assert.rejects(store.requestExport(before.revision), /工程已经/);
  const claims = await Promise.all([store.claimExport(), new WorkspaceStore(root).claimExport()]);
  assert.equal(claims.filter(Boolean).length, 1, 'claiming still rechecks the job under the lock');
});
test('native history restores retained media after later edits and refuses corrupted retention without applying changes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-native-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.HYPERFRAMES_HISTORY_ROOT;
  process.env.HYPERFRAMES_HISTORY_ROOT = path.join(root, 'native');
  t.after(() => { if (previous === undefined) delete process.env.HYPERFRAMES_HISTORY_ROOT; else process.env.HYPERFRAMES_HISTORY_ROOT = previous; });
  const store = new WorkspaceStore(root), service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
  });
  const created = await service.call('openmotion_create_project', { requestId: 'create', projectType: 'natural_language', title: 'Restore fixture', requirements: 'Keep the historical media' });
  const scoped = store.forProject(created.projectId), file = path.join(scoped.projectDirectory, 'assets/fixture.mp4'), bytes = Buffer.alloc(4096, 41);
  await writeFile(file, bytes);
  const imported = await service.call('openmotion_get_project', { projectId: created.projectId });
  await writeFile(file, Buffer.alloc(bytes.length, 42));
  const latest = await service.call('openmotion_get_project', { projectId: created.projectId });
  const args = { projectId: created.projectId, versionId: imported.currentVersionId, expectedRevision: latest.revision, expectedVersionId: latest.currentVersionId };
  const restored = await service.call('openmotion_restore_version', { ...args, requestId: 'restore' });
  assert.deepEqual(await readFile(file), bytes);
  assert.ok(restored.version.versionNumber > latest.currentVersionNumber);
  const versions = service.versions(created.projectId), target = (await versions.index()).versions.find(version => version.versionId === imported.currentVersionId)!;
  const media = target.files.find(item => item.path === 'assets/fixture.mp4')!;
  assert.equal(media.retained, true);
  await writeFile(versions.blob(media.hash), Buffer.alloc(bytes.length));
  const before = await scoped.get();
  await assert.rejects(service.call('openmotion_restore_version', { ...args, expectedRevision: restored.revision, expectedVersionId: restored.version.versionId, requestId: 'corrupt' }), /VERSION_NOT_RESTORABLE/);
  assert.deepEqual(await scoped.get(), before);
  const listed = await service.call('openmotion_list_versions', { projectId: created.projectId });
  assert.equal(listed.versions.find((version: any) => version.versionId === target.versionId).restorable, false);
});
test('media kept only in native aside reads as restorable and restores through the native reader', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-aside-restore-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = process.env.HYPERFRAMES_HISTORY_ROOT, nativeRoot = path.join(root, 'native');
  process.env.HYPERFRAMES_HISTORY_ROOT = nativeRoot;
  t.after(() => { if (previous === undefined) delete process.env.HYPERFRAMES_HISTORY_ROOT; else process.env.HYPERFRAMES_HISTORY_ROOT = previous; });
  const store = new WorkspaceStore(root), service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {},
  });
  const created = await service.call('openmotion_create_project', { requestId: 'create', projectType: 'natural_language', title: 'Aside fixture', requirements: 'Restore media only native history keeps aside' });
  const scoped = store.forProject(created.projectId), media = path.join(scoped.projectDirectory, 'assets/aside.mp4'), bytes = Buffer.from('media bytes native history keeps in aside');
  // Studio adds media and undoes the addition, so native history moves the bytes out of the project into aside.
  const native = await import(pathToFileURL(path.join(pluginRoot, 'node_modules/@hyperframes/studio-server/dist/history/index.js')).href);
  const history = await native.openProjectHistory({ projectDir: scoped.projectDirectory, historyRoot: nativeRoot, ownerWaitMs: 50 });
  try {
    const window = await history.beginWindow({ kind: 'person', name: 'You' }, 'Add media');
    await mkdir(path.dirname(media), { recursive: true });
    await writeFile(media, bytes);
    const added = await window.close();
    await history.checkpoint();
    await history.undo(added.id, { who: { kind: 'person', name: 'You' } });
    await history.checkpoint();
  } finally { await history.close(); }
  const detail = await service.call('openmotion_get_project', { projectId: created.projectId });
  const versions = service.versions(created.projectId), target = (await versions.index()).versions.find(version => version.files.some(item => item.path === 'assets/aside.mp4'))!;
  const blob = target.files.find(item => item.path === 'assets/aside.mp4')!;
  const historyId = (await readFile(path.join(scoped.projectDirectory, '.hyperframes/history-id'), 'utf8')).trim();
  const sharded = path.join('blobs', blob.hash.slice(0, 2), blob.hash), aside = path.join(nativeRoot, historyId, 'aside', blob.hash.slice(0, 2), blob.hash);
  assert.equal(blob.retained, undefined, 'native history keeps this media, so it is not retained');
  assert.equal(fs.existsSync(versions.blob(blob.hash)), false, 'no retained copy exists');
  assert.equal(fs.existsSync(path.join(nativeRoot, historyId, sharded)), false, 'no copied native blob exists');
  assert.equal(fs.existsSync(aside), true, 'the bytes live only under native aside');
  const listed = await service.call('openmotion_list_versions', { projectId: created.projectId });
  assert.equal(listed.versions.find((version: any) => version.versionId === target.versionId).restorable, true, 'the cached verdict accepts the aside location');
  const restored = await service.call('openmotion_restore_version', { projectId: created.projectId, versionId: target.versionId,
    expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: 'restore-aside' });
  assert.deepEqual(await readFile(media), bytes, 'restore stages the aside blob through the native reader');
  assert.ok(restored.version.versionNumber > detail.currentVersionNumber);
});
