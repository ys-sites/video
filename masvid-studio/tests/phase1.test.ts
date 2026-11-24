import test from 'node:test';
import { createTracker } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, mkdir, stat, truncate } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot, execute } from '../hyperframes.ts';
import { cancelExport } from '../server.ts';
import { atomicJson, fileHash, recoverProjectTransactions } from '../phase1-versions.ts';
import { validateInput, phase1Tools } from '../shared/phase1-tools.ts';
import { transport } from './http.ts';
import { MAX_ASSET_BYTES, isAssetFileWithinLimit } from '../shared/asset-limits.ts';
import { sessionPath } from '../shared/workspace-url.ts';
import { stampProjectHfIds } from '@hyperframes/studio-server/hf-ids';

function api(store: any) { return new Phase1Service(store, pluginRoot, {
  origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: async () => {},
  mutation: async task => task(), cancel: (pid, jobId) => cancelExport(store, pid, jobId),
}); }
const create = (service: Phase1Service, requestId = crypto.randomUUID()) => service.call('openmotion_create_project', {
  requestId, projectType: 'natural_language', title: '一期测试', requirements: '用真实原生文件制作静音短片',
});
const edit = (service: Phase1Service, p: any, content: string) => service.call('openmotion_edit_project', {
  requestId: crypto.randomUUID(), projectId: p.projectId, expectedRevision: p.revision,
  expectedVersionId: p.version.versionId, files: [{ path: 'note.txt', content }],
});

test('guarded preview accepts native ID stamping and returns its current version on first open and after edits', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async id => stampProjectHfIds(store.projectDirectoryFor(id)),
    mutation: async task => task(), cancel: async () => {},
  });
  let current = await create(service);
  for (let i = 0; i < 2; i++) {
    if (i) current = await service.call('openmotion_edit_project', {
      projectId: current.projectId, requestId: 'add-element', expectedRevision: current.revision, expectedVersionId: current.currentVersionId,
      files: [{ path: 'index.html', content: current.project.html.replace('</div>', '<div id="new-label">Preview label</div></div>') }],
    });
    const versionId = current.currentVersionId ?? current.version.versionId;
    const opened = await service.call('openmotion_open_preview', { projectId: current.projectId, expectedRevision: current.revision, expectedVersionId: versionId });
    assert.notEqual(opened.revision, current.revision);
    assert.equal(opened.currentVersionNumber, current.version.versionNumber + 1);
    assert.match(opened.project.html, /data-hf-id=/);
    assert.equal(opened.previewHandoff.revision, opened.revision);
    assert.equal(opened.previewHandoff.versionId, opened.currentVersionId);
    await assert.rejects(service.call('openmotion_open_preview', { projectId: current.projectId, expectedRevision: current.revision, expectedVersionId: versionId }), /VERSION_CONFLICT/);
    current = opened;
  }
}, false));

test('guarded preview preserves empty IDs when native stamping adds no attributes in a secondary file', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async id => stampProjectHfIds(store.projectDirectoryFor(id)),
    mutation: async task => task(), cancel: async () => {},
  });
  const created = await create(service);
  const secondary = '<div data-composition-id="secondary" data-hf-id=""><span data-hf-id="">Secondary</span></div>';
  const current = await service.call('openmotion_edit_project', {
    projectId: created.projectId, requestId: 'empty-secondary-ids', expectedRevision: created.revision, expectedVersionId: created.currentVersionId,
    files: [{ path: 'compositions/secondary.html', content: secondary }],
  });
  const opened = await service.call('openmotion_open_preview', { projectId: current.projectId, expectedRevision: current.revision, expectedVersionId: current.version.versionId });
  assert.notEqual(opened.revision, current.revision);
  assert.equal(opened.currentVersionNumber, current.version.versionNumber + 1);
  assert.match(opened.project.html, /data-hf-id=/);
  assert.equal(await readFile(path.join(store.projectDirectoryFor(current.projectId), 'compositions/secondary.html'), 'utf8'), secondary);
  const repeated = await service.call('openmotion_open_preview', { projectId: opened.projectId, expectedRevision: opened.revision, expectedVersionId: opened.currentVersionId });
  assert.equal(repeated.revision, opened.revision);
  assert.equal(repeated.currentVersionId, opened.currentVersionId);
}, false));

test('guarded preview rejects real edits and same-content restores made during native opening', () => fixture(async store => {
  let opening: (id: string) => Promise<void> = async () => {};
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined, openProject: id => opening(id),
    mutation: async task => task(), cancel: async () => {},
  });
  let current = await create(service);
  opening = async id => {
    stampProjectHfIds(store.projectDirectoryFor(id));
    await writeFile(path.join(store.projectDirectoryFor(id), 'person.txt'), 'Concurrent edit');
  };
  await assert.rejects(service.call('openmotion_open_preview', { projectId: current.projectId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId }), /VERSION_CONFLICT/);
  assert.equal(await readFile(path.join(store.projectDirectoryFor(current.projectId), 'person.txt'), 'utf8'), 'Concurrent edit');
  current = await service.call('openmotion_get_project', { projectId: current.projectId });
  opening = async id => {
    const versions = service.versions(id);
    await versions.withHistory(async history => {
      const target = (await versions.index()).versions.find(version => version.versionId === current.currentVersionId)!;
      const changed = await versions.transaction(history, current.revision, current.currentVersionId, 'during-open-edit',
        [{ path: 'person.txt', content: 'Temporary change' }], { label: 'Concurrent edit' });
      await versions.restore(history, target, changed.revision, changed.version.versionId, 'during-open-restore');
    });
  };
  await assert.rejects(service.call('openmotion_open_preview', { projectId: current.projectId, expectedRevision: current.revision, expectedVersionId: current.currentVersionId }), /VERSION_CONFLICT/);
}, false));

test('MCP validation failures remain unchanged while local diagnostics record the failure', () => fixture(async store => {
  const service = api(store);
  await assert.rejects(service.call('openmotion_get_project', null), /INVALID_ARGUMENT: arguments must be an object/);
  const event = JSON.parse((await readFile(path.join(store.directory, 'diagnostics/events.log'), 'utf8')).trim());
  assert.equal(event.kind, 'mcp_failure'); assert.equal(event.tool, 'motion_get_project');
  assert.match(event.message, /INVALID_ARGUMENT/);
}, false));

test('asset limits enforce decimal 500 MB without rounding', () => fixture(async store => {
  assert.equal(MAX_ASSET_BYTES, 500_000_000);
  const file = path.join(store.directory, 'sparse-media');
  await writeFile(file, '');
  for (const [size, accepted] of [[499_999_999, true], [500_000_000, true], [500_000_001, false], [500_500_000, false], [524_288_000, false]] as const) {
    await truncate(file, size);
    assert.equal(isAssetFileWithinLimit(await stat(file)), accepted, String(size));
  }
  assert.equal(isAssetFileWithinLimit(await stat(store.directory)), false);
}, false));

test('phase1 validates real inputs before effects, creates idempotently and pages without switching', () => fixture(async store => {
  const service = api(store), p = await create(service, 'first');
  assert.equal(p.version.versionNumber, 1); assert.equal(p.filmComplete, false);
  assert.equal(p.limits.assetBytes, MAX_ASSET_BYTES);
  await assert.rejects(service.call('openmotion_create_project', { requestId: 'mixed-sources', projectType: 'natural_language', title: 'x', requirements: 'x', templateId: 'nyt-graph' }), /INVALID_ARGUMENT/);
  await assert.rejects(service.call('openmotion_get_project', { projectId: p.projectId, sessionId: crypto.randomUUID() }), /PROJECT_SESSION_MISMATCH/);
  assert.equal((await create(service, 'first')).projectId, p.projectId);
  await assert.rejects(service.call('openmotion_create_project', { requestId: 'first', projectType: 'natural_language', title: 'changed', requirements: 'x' }), /REQUEST_ID_CONFLICT/);
  for (let i = 0; i < 5; i++) await create(service);
  const selected = store.projectId;
  const first = await service.call('openmotion_get_project', {});
  assert.equal(first.projects.length, 5); assert.equal(first.hasMore, true);
  const second = await service.call('openmotion_get_project', { cursor: first.nextCursor });
  assert.equal(second.projects.length, 1); assert.equal(second.hasMore, false);
  assert.equal(store.projectId, selected);
  await assert.rejects(service.call('openmotion_open_preview', {}), /PROJECT_NOT_BOUND/);
  for (const tool of phase1Tools) assert.throws(() => validateInput(tool.inputSchema, { unknown: true }), /INVALID_ARGUMENT/);
}, false));

test('v5 to v3 creates v6, retains v4/v5, rejects stale writes and recovers after restart', () => fixture(async store => {
  let service = api(store), p = await create(service), original = p;
  const versions = [p];
  for (let i = 2; i <= 5; i++) { p = await edit(service, p, 'version ' + i); versions.push(p); }
  const restored = await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'restore-3', versionId: versions[2].version.versionId, expectedVersionId: p.version.versionId, expectedRevision: p.revision });
  assert.equal(restored.version.versionNumber, 6); assert.equal(restored.revision, versions[2].revision);
  assert.equal(await readFile(path.join(store.projectDirectoryFor(p.projectId), 'note.txt'), 'utf8'), 'version 3');
  await assert.rejects(edit(service, versions[2], 'stale same hash'), (error: Error) => {
    assert.match(error.message, /^VERSION_CONFLICT/);
    assert.ok(error.message.includes(restored.revision) && error.message.includes(restored.version.versionId), 'The conflict reports the current revision and version');
    assert.match(error.message, /openmotion_get_project/);
    return true;
  });
  // v4 content differs from the current v6, so its revision is distinguishable from the live one.
  assert.notEqual(versions[3].revision, restored.revision);
  await assert.rejects(edit(service, versions[3], 'stale different hash'), (error: Error) => {
    assert.ok(error.message.includes(restored.revision), 'The conflict reports the current revision, not the stale one');
    assert.ok(!error.message.includes(versions[3].revision));
    return true;
  });
  const list = await service.call('openmotion_list_versions', { projectId: p.projectId });
  assert.deepEqual(list.versions.map((v: any) => v.versionNumber), [6, 5, 4, 3, 2]);
  assert.equal((await service.call('openmotion_list_versions', { projectId: p.projectId, cursor: list.nextCursor })).versions[0].versionId, original.version.versionId);
  service = api(store);
  const v7 = await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'restore-5', versionId: p.version.versionId, expectedVersionId: restored.version.versionId, expectedRevision: restored.revision });
  assert.equal(v7.version.versionNumber, 7); assert.equal(v7.revision, p.revision);
  const before = await store.forProject(p.projectId).get();
  await assert.rejects(service.call('openmotion_edit_project', { projectId: p.projectId, requestId: 'bad-path', expectedRevision: v7.revision, expectedVersionId: v7.version.versionId, files: [{ path: 'note.txt', content: 'bad' }, { path: '../escape.txt', content: 'bad' }] }), /文件路径/);
  assert.deepEqual(await store.forProject(p.projectId).get(), before);
  await assert.rejects(service.call('openmotion_edit_project', { projectId: p.projectId, requestId: 'conflicting-paths', expectedRevision: v7.revision, expectedVersionId: v7.version.versionId, files: [{ path: 'nested.txt', content: 'x' }, { path: 'nested.txt/file.txt', content: 'x' }] }), /INVALID_FILE_TYPE|CONFLICTING_FILE_PATHS/);
  assert.deepEqual(await store.forProject(p.projectId).get(), before);
  const source = '中文🙂abc';
  const v8 = await edit(service, v7, source);
  const text = await service.call('openmotion_get_project', { projectId: p.projectId, expectedRevision: v8.revision, file: { path: 'note.txt', length: 7 } });
  assert.equal(text.file.content, '中文'); assert.equal(text.file.nextOffset, 6);
  await assert.rejects(service.call('openmotion_get_project', { projectId: p.projectId, file: { path: 'note.txt', offset: 1 } }), /INVALID_UTF8_OFFSET/);
}, false));

test('imports retain historical media and reject missing or corrupt blobs without changing the project', t => fixture(async store => {
  const previous = process.env.HYPERFRAMES_HISTORY_ROOT, historyRoot = path.join(store.directory, 'native-history');
  process.env.HYPERFRAMES_HISTORY_ROOT = historyRoot;
  t.after(() => { if (previous === undefined) delete process.env.HYPERFRAMES_HISTORY_ROOT; else process.env.HYPERFRAMES_HISTORY_ROOT = previous; });
  const service = api(store), p = await create(service);
  const events: import('../tracking/core.ts').PendingEvent[] = [];
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0,
    send: async batch => { events.push(...batch); return 'accepted'; } });
  service.context.tracking = tracking;
  t.after(() => tracking.close());
  const png = path.join(store.directory, 'source.png');
  const pngResult = await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=16x16', '-frames:v', '1', png], store.directory);
  assert.equal(pngResult.code, 0, pngResult.stderr);
  const video = path.join(store.directory, 'source.mp4');
  const videoResult = await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=0.2:size=16x16:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video], store.directory);
  assert.equal(videoResult.code, 0, videoResult.stderr);
  const wav = path.join(store.directory, 'source.wav'), fake = path.join(store.directory, 'fake.png');
  const made = await execute('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', wav], store.directory);
  assert.equal(made.code, 0, made.stderr); await writeFile(fake, 'not an image');
  const oversized = path.join(store.directory, 'oversized.mp4');
  await writeFile(oversized, ''); await truncate(oversized, MAX_ASSET_BYTES + 1);
  const args = { projectId: p.projectId, requestId: crypto.randomUUID(), items: [{ itemId: 'audio', sourcePath: wav }, { itemId: 'fake', sourcePath: fake }, { itemId: 'image', sourcePath: png }, { itemId: 'video', sourcePath: video }, { itemId: 'oversized', sourcePath: oversized }] };
  const imported = await service.call('openmotion_import_assets', args);
  assert.equal(imported.status, 'partial'); assert.equal(imported.items[0].mimeType, 'audio/wav'); assert.equal(imported.items[1].status, 'failed'); assert.equal(imported.items[2].mimeType, 'image/png'); assert.equal(imported.items[3].mimeType, 'video/mp4');
  assert.equal(imported.items[4].status, 'failed');
  assert.match(imported.items[4].error, /^ASSET_TOO_LARGE_OR_NOT_FILE: max 500 MB/);
  assert.equal((await service.call('openmotion_import_assets', args)).items[0].assetId, imported.items[0].assetId);
  const deduped = await service.call('openmotion_import_assets', { ...args, requestId: 'new-import', items: [args.items[0]] });
  assert.equal(deduped.items[0].reused, true);
  await tracking.flush();
  const imports = events.filter(event => event.event === 'asset_import_result').map(event => event.properties);
  assert.equal(imports.length, 2, 'a replay has no extra business result');
  assert.deepEqual(imports.map(({ outcome, requested_count, added_count, reused_count, failed_count }) =>
    [outcome, requested_count, added_count, reused_count, failed_count]), [['partial', 5, 3, 0, 2], ['success', 1, 0, 1, 0]]);
  const failures = events.filter(event => event.event === 'asset_import_item_failure').map(event => event.properties);
  assert.deepEqual(failures.map(({ error_code, failed_count }) => [error_code, failed_count]),
    [['INVALID_MEDIA', 1], ['ASSET_TOO_LARGE_OR_NOT_FILE', 1]]);
  assert(failures.every(row => row.operation_id === args.requestId && row.project_id === p.projectId));
  assert.doesNotMatch(JSON.stringify(events), /oversized.mp4|fake.png|not an image/);
  await rm(wav);
  const after = await service.call('openmotion_get_project', { projectId: p.projectId });
  const restored = await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'before-media', versionId: p.version.versionId, expectedVersionId: after.version.versionId, expectedRevision: after.revision });
  const complete = await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'after-media', versionId: imported.version.versionId, expectedVersionId: restored.version.versionId, expectedRevision: restored.revision });
  const media = imported.items.filter((item: any) => item.status !== 'failed');
  for (const item of media) assert.equal(await fileHash(path.join(store.projectDirectoryFor(p.projectId), item.path)), item.sha256);
  const noop = await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'same-media', versionId: imported.version.versionId, expectedVersionId: complete.version.versionId, expectedRevision: complete.revision });
  assert.equal(noop.changed, false); assert.equal(noop.version.versionId, complete.version.versionId);
  await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'remove-media', versionId: p.version.versionId, expectedVersionId: complete.version.versionId, expectedRevision: complete.revision });
  const before = await service.call('openmotion_get_project', { projectId: p.projectId });
  const scoped = store.forProject(p.projectId), beforeFiles = await scoped.files();
  const beforeAssets = await readFile(path.join(scoped.projectDirectory, 'motion-assets.json'));
  const versions = service.versions(p.projectId);
  const target = (await versions.index()).versions.find(version => version.versionId === imported.version.versionId)!;
  const historyId = (await readFile(path.join(scoped.projectDirectory, '.hyperframes/history-id'), 'utf8')).trim();
  const request = transport(store, { runtimeRoot: pluginRoot, phase1: service });
  for (const item of media) {
    const file = target.files.find(file => file.path === item.path)!;
    const blob = file.retained ? versions.blob(file.hash) : path.join(historyRoot, historyId, 'blobs', file.hash.slice(0, 2), file.hash);
    const bytes = await readFile(blob);
    for (const damage of ['missing', 'corrupt']) {
      if (damage === 'missing') await rm(blob); else await writeFile(blob, Buffer.alloc(bytes.length));
      const list = await service.call('openmotion_list_versions', { projectId: p.projectId });
      const listed = list.versions.find((version: any) => version.versionId === target.versionId);
      assert.equal(listed.restorable, false, item.mimeType + ': ' + damage);
      assert.deepEqual(listed.unavailableFiles, [item.path]);
      const requestId = crypto.randomUUID();
      const response = await request('/motion-api/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'openmotion_restore_version', arguments: {
        projectId: p.projectId, requestId, versionId: target.versionId,
        expectedVersionId: before.currentVersionId, expectedRevision: before.revision,
      } }) });
      assert.equal(response.status, 400);
      const error = await response.json();
      assert.match(error.error, /^VERSION_NOT_RESTORABLE:/); assert.ok(error.error.includes(item.path));
      assert.equal(error.applied, false);
      const status = await request('/motion-api/project/status?projectId=' + p.projectId);
      assert.deepEqual((await status.json()).historyRestoreError, { requestId, message: error.error });
      const after = await service.call('openmotion_get_project', { projectId: p.projectId });
      assert.equal(after.revision, before.revision); assert.equal(after.currentVersionId, before.currentVersionId);
      assert.deepEqual(after.assets, before.assets); assert.deepEqual(await scoped.files(), beforeFiles);
      assert.deepEqual(await readFile(path.join(scoped.projectDirectory, 'motion-assets.json')), beforeAssets);
      await writeFile(blob, bytes);
    }
  }
  const available = (await service.call('openmotion_list_versions', { projectId: p.projectId })).versions.find((version: any) => version.versionId === target.versionId);
  assert.equal(available.restorable, true); assert.deepEqual(available.unavailableFiles, []);
  const other = await create(service);
  assert.equal((await (await request('/motion-api/project/status?projectId=' + other.projectId)).json()).historyRestoreError, null);
  await service.call('openmotion_restore_version', { projectId: p.projectId, requestId: 'recovered-media', versionId: target.versionId,
    expectedVersionId: before.currentVersionId, expectedRevision: before.revision });
  assert.equal((await (await request('/motion-api/project/status?projectId=' + p.projectId)).json()).historyRestoreError, null);
}, false));

test('version availability rechecks native blobs and does not persist missing-file flags', () => fixture(async store => {
  const service = api(store), p = await create(service), versions = service.versions(p.projectId);
  const target = (await versions.index()).versions[0], file = target.files.find(file => file.path === 'index.html')!;
  await versions.withHistory(async history => {
    const bytes = await history.readBlob(file.hash);
    for (const blob of [null, Buffer.alloc(bytes.length)]) {
      const unavailable = { ...history, readBlob: async (hash: string) => {
        if (hash !== file.hash) return history.readBlob(hash);
        if (blob === null) throw new Error('ENOENT');
        return blob;
      } };
      const listed = await versions.publicVersion(target, unavailable);
      assert.equal(listed.restorable, false); assert.deepEqual(listed.unavailableFiles, [file.path]);
      await assert.rejects(versions.restore(unavailable, target, p.revision, p.version.versionId, 'native-missing'), /VERSION_NOT_RESTORABLE:.*index\.html/);
    }
    const listed = await versions.publicVersion({ ...target, files: target.files.map(file => ({ ...file, missing: true })) }, history);
    assert.equal(listed.restorable, true); assert.deepEqual(listed.unavailableFiles, []);
    let reads = 0;
    const disappears = { ...history, readBlob: async (hash: string) => {
      if (hash === file.hash && ++reads > 1) throw new Error('ENOENT');
      return history.readBlob(hash);
    } };
    await assert.rejects(versions.restore(disappears, target, p.revision, p.version.versionId, 'native-disappears'), /VERSION_NOT_RESTORABLE:.*index\.html/);
  });
  const after = await service.call('openmotion_get_project', { projectId: p.projectId });
  assert.equal(after.currentVersionId, p.version.versionId); assert.equal(after.revision, p.revision);
}, false));

test('an interrupted partial save rolls back, but recovery never overwrites foreign writes', () => fixture(async store => {
  const service = api(store), p = await create(service), scoped = store.forProject(p.projectId);
  const file = path.join(scoped.projectDirectory, 'note.txt'); await writeFile(file, 'before');
  await service.call('openmotion_get_project', { projectId: p.projectId });
  const directory = path.join(store.directory, 'phase1/transactions/interrupted');
  await mkdir(path.join(directory, 'old'), { recursive: true }); await writeFile(path.join(directory, 'old/0'), 'before');
  const before = await fileHash(file); await writeFile(file, 'after'); const after = await fileHash(file);
  await atomicJson(path.join(directory, 'journal.json'), { projectId: p.projectId, requestId: 'interrupted', state: 'prepared', windowId: 'interrupted-window', changes: [{ path: 'note.txt', before, after }] });
  await recoverProjectTransactions(store, pluginRoot); assert.equal(await readFile(file, 'utf8'), 'before');
  await mkdir(path.join(directory, 'old'), { recursive: true }); await writeFile(path.join(directory, 'old/0'), 'before');
  await atomicJson(path.join(directory, 'journal.json'), { projectId: p.projectId, requestId: 'conflict', state: 'prepared', windowId: 'conflict-window', changes: [{ path: 'note.txt', before, after }] });
  await writeFile(file, 'foreign');
  await assert.rejects(recoverProjectTransactions(store, pluginRoot), /RECOVERY_CONFLICT/); assert.equal(await readFile(file, 'utf8'), 'foreign');
}, false));

test('queued export cancel is project-bound and historical jobs remain addressable', () => fixture(async store => {
  const service = api(store), p = await create(service);
  const events: any[] = [], tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, send: async batch => { events.push(...batch); return 'accepted'; } });
  service.context.tracking = tracking;
  const args = { projectId: p.projectId, requestId: 'export', expectedRevision: p.revision, versionId: p.version.versionId, audio: 'silent' };
  const host = { host_agent: 'deepseek', host_agent_source: 'mcp_client_info' } as const;
  const exported = await service.call('openmotion_export_request', args, host);
  await tracking.flush();
  assert.equal(events.filter(event => event.event === 'task_accepted').length, 1);
  assert.equal(events.filter(event => event.event === 'check_required').length, 1);
  const status = await (await transport(store)('/api/project/status')).json();
  assert.equal(status.exportJob.trackingHost, undefined, 'public status omits internal analytics metadata');
  assert.deepEqual((await store.job(exported.job.id))!.trackingHost, host);
  assert.equal(exported.job.trackingHost, undefined);
  assert.equal((await service.call('openmotion_export_request', args)).job.id, exported.job.id);
  await assert.rejects(cancelExport(store, crypto.randomUUID(), exported.job.id), /EXPORT_NOT_FOUND/);
  const cancelled = await service.call('openmotion_export_cancel', { projectId: p.projectId, requestId: 'cancel', jobId: exported.job.id });
  assert.equal(cancelled.job.state, 'cancelled'); assert.equal(await store.claimExport(), null);
  tracking.setEnabled(false);
  const next = await service.call('openmotion_export_request', { ...args, requestId: 'export2' }, host);
  assert.equal((await store.job(next.job.id))!.trackingHost, undefined, 'opt-out does not persist new tracking metadata');
  assert.notEqual(next.job.id, exported.job.id);
  const old = await service.call('openmotion_get_project', { projectId: p.projectId, exportJobId: exported.job.id });
  assert.equal(old.exportJob.state, 'cancelled');
}, false));

test('a failed work round reports its recorded mode and only observed state changes', () => fixture(async store => {
  const service = api(store), events: any[] = [], tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, send: async batch => { events.push(...batch); return 'accepted'; } });
  service.context.tracking = tracking;
  const p = await create(service);
  const { inlineWork: work } = await service.call('openmotion_open_preview', { action: 'begin', projectId: p.projectId, requestId: 'begin', mode: 'create' });
  // Rejected before the round is writable, so the round is still open.
  await assert.rejects(service.call('openmotion_export_request', { projectId: p.projectId, workId: work.id, requestId: 'wrong', versionId: crypto.randomUUID(), expectedRevision: p.revision, audio: 'silent' }), /WORK_VERSION_MISMATCH/);
  // Fails after the write gate, so this failure really closes the round.
  await store.requestExport(p.revision);
  await assert.rejects(service.call('openmotion_export_request', { projectId: p.projectId, workId: work.id, requestId: 'busy', versionId: p.version.versionId, expectedRevision: p.revision, audio: 'silent' }), /EXPORT_BUSY/);
  await tracking.flush();
  assert.deepEqual(events.filter(event => event.event === 'host_run_started').map(event => event.properties.task_type), ['create']);
  assert.deepEqual(events.filter(event => event.event === 'host_run_failed').map(event => event.properties.task_type), ['create', 'create'], 'a creation round is never reported as a modification');
  assert.deepEqual(events.filter(event => event.event === 'host_state_changed').map(event => event.properties.state), ['active', 'failed'], 'an open round failure claims no terminal state');
}, false));

test('preview delivery evidence needs the confirmed version and the round version', () => fixture(async store => {
  const service = api(store), events: any[] = [], tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, send: async batch => { events.push(...batch); return 'accepted'; } });
  service.context.tracking = tracking;
  const p = await create(service);
  const previewUrl = 'http://127.0.0.1:4173' + sessionPath(p.sessionId, p.projectId, { embedded: true });
  const { inlineWork: work } = await service.call('openmotion_open_preview', { action: 'begin', projectId: p.projectId, requestId: 'begin', mode: 'create' });
  const record = (revision: string, versionId: string) => service.call('openmotion_open_preview', { action: 'record_display',
    projectId: p.projectId, requestId: crypto.randomUUID(), workId: work.id,
    display: { revision, versionId, previewUrl, visibility: 'visible', contentVerified: true, evidence: 'Host reported a visible panel' } });
  // A round still bound to the confirmed version delivers its observed preview.
  await record(p.revision, p.version.versionId);
  await tracking.flush();
  assert.deepEqual(events.filter(event => event.event === 'host_run_delivered').map(event => event.properties.delivery_mode), ['preview']);
  // A save the round never observed keeps the observation but does not claim delivery.
  const saved = await service.call('openmotion_edit_project', { requestId: 'foreign', projectId: p.projectId,
    expectedRevision: p.revision, expectedVersionId: p.version.versionId, files: [{ path: 'note.txt', content: 'saved outside the round' }] });
  await record(saved.revision, saved.version.versionId);
  await tracking.flush();
  assert.equal(events.filter(event => event.event === 'host_run_delivered').length, 1);
  assert.deepEqual(events.filter(event => event.event === 'check_completed' && event.properties.check_type === 'preview_observed').map(event => event.properties.result), ['pass', 'pass']);
  // A display rejected by the version guard observed nothing, so it records no preview evidence.
  const observed = events.length, realDetail = service.detail.bind(service), scoped = store.forProject(p.projectId);
  let reads = 0;
  service.detail = async (...args: any[]) => {
    if (++reads === 2) await writeFile(path.join(scoped.projectDirectory, 'note.txt'), 'changed during display confirmation');
    return realDetail(...args);
  };
  try { await assert.rejects(record(saved.revision, saved.version.versionId), /VERSION_CONFLICT/); }
  finally { service.detail = realDetail; }
  await tracking.flush();
  const evidence = ['host_preview_observed', 'host_run_delivered', 'check_required', 'check_completed'];
  assert.deepEqual(events.slice(observed).map(event => event.event).filter(name => evidence.includes(name)), []);
}, false));

test('creation supports actual builtin templates and reference carriers, and requirements-only edits are versioned', () => fixture(async store => {
  const service = api(store);
  const template = await service.call('openmotion_create_project', { requestId: 'template', projectType: 'template', templateId: 'decision-tree', title: 'Real template', requirements: '保留模板默认内容' });
  assert.equal(template.source.id, 'decision-tree'); assert.ok(template.project.html.length > 100);
  const reference = await service.call('openmotion_create_project', { requestId: 'reference', projectType: 'reference_video', referenceVideoId: 'hf-reference-jake-lovable', title: 'Reference carrier', requirements: '分析参考后重建' });
  assert.equal(reference.source.id, 'hf-reference-jake-lovable'); assert.equal(reference.filmComplete, false);
  const saved = await service.call('openmotion_edit_project', { projectId: reference.projectId, requestId: 'requirements', expectedRevision: reference.revision, expectedVersionId: reference.currentVersionId, files: [], requirements: '更新需求并保留源码' });
  const after = await service.call('openmotion_get_project', { projectId: reference.projectId });
  assert.equal(after.requirements, '更新需求并保留源码'); assert.equal(after.project.html, reference.project.html);
  assert.equal(after.currentVersionId, saved.version.versionId);
  const noop = await service.call('openmotion_edit_project', { projectId: reference.projectId, requestId: 'noop', expectedRevision: after.revision, expectedVersionId: after.currentVersionId, files: [] });
  assert.equal(noop.changed, false); assert.equal(noop.version.versionId, after.currentVersionId);
}, false));

test('runtime schema rejects prototype-property names at the top level and in nested inputs', () => {
  const schema = phase1Tools.find(tool => tool.name === 'openmotion_get_project')!.inputSchema;
  for (const key of ['constructor', '__proto__', 'toString']) {
    assert.throws(() => validateInput(schema, JSON.parse(`{"${key}":true}`)), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(schema, { file: JSON.parse(`{"path":"index.html","${key}":true}`) }), /INVALID_ARGUMENT/);
  }
});

test('project pagination rejects cursors with invalid ordering values', () => fixture(async store => {
  const service = api(store);
  for (const after of [['not-a-timestamp', 'id'], [1, {}], [-1, 'id'], [1.5, 'id'], [1, '']]) {
    const cursor = Buffer.from(JSON.stringify({ kind: 'projects', scope: 'workspace', after })).toString('base64url');
    await assert.rejects(service.call('openmotion_get_project', { cursor }), /INVALID_CURSOR/);
  }
}, false));
