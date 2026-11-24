import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFile, writeFile, mkdir, symlink, access } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { importProjects } from '../project-archive.ts';
import { manageProject, projectRevealCommand } from '../project-management.ts';
import { Phase1Service } from '../phase1.ts';
import { zip } from '../scripts/zip.mjs';
import { pluginRoot, nativeProjectConfig } from '../hyperframes.ts';
import { WorkspaceStore } from '../workspace.ts';
import { reviewComments } from '../review-comments.ts';
import { renderNext } from '../server.ts';

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div data-composition-id="main" data-start="0" data-duration="1" data-width="320" data-height="180">Editable</div><script>window.__timelines = {};</script></body></html>';
const bundle = () => zip([
  { name: 'index.html', data: Buffer.from(html) },
  { name: 'hyperframes.json', data: Buffer.from(JSON.stringify(nativeProjectConfig)) },
  { name: 'assets/local.txt', data: Buffer.from('Original asset') },
  { name: '.hyperframes/studio-motion.json', data: Buffer.from('{}') },
]);
const api = (store: any) => new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => ({}) });

for (const [action, next] of [['trash', 'restore'], ['restore', 'trash']] as const) {
  test(`retrying ${action} after a failed receipt write does not undo a later ${next}`, t => fixture(async store => {
    const { projects: [project] } = await importProjects(store, 'recover-trash-request', bundle(), pluginRoot);
    const projectId = project.projectId;
    if (action === 'restore') await manageProject(store, { action: 'trash', projectId, requestId: 'setup' });
    const mutation = { action, projectId, requestId: 'interrupted' };
    const receiptDirectory = path.join(store.directory, 'project-operations', action);
    const rename = fs.rename;
    const write = t.mock.method(fs, 'rename', async (...args: Parameters<typeof rename>) => {
      if (path.dirname(String(args[1])) === receiptDirectory) throw new Error('Interrupted receipt write');
      return rename(...args);
    });
    syncBuiltinESMExports();
    try {
      await assert.rejects(manageProject(store, mutation), /Interrupted receipt write/);
      assert.equal(Boolean(store.projectCatalog().projects.find(p => p.id === projectId)?.trashedAt), action === 'trash');
    } finally {
      write.mock.restore();
      syncBuiltinESMExports();
    }
    const reopened = new WorkspaceStore(store.directory);
    await manageProject(reopened, { action: next, projectId, requestId: 'later-choice' });
    assert.equal((await manageProject(reopened, mutation)).replayed, true);
    assert.equal(Boolean(reopened.projectCatalog().projects.find(p => p.id === projectId)?.trashedAt), next === 'trash');
  }, false));
}

test('HTTP and MCP rename the explicit project with conflict protection and stable retry receipts', () => fixture(async store => {
  const id = (await importProjects(store, 'import', bundle(), pluginRoot)).projects[0].projectId;
  const service = api(store), http = transport(store, { runtimeRoot: pluginRoot });
  const info = await service.call('openmotion_manage_project', { action: 'info', projectId: id });
  assert.equal(info.path, store.projectDirectoryFor(id));
  const input = { action: 'rename', projectId: id, title: 'Renamed film', expectedTitle: info.title, requestId: 'rename' };
  const response = await http('/motion-api/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'openmotion_manage_project', arguments: input }) });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).title, 'Renamed film');
  await store.renameProject(id, 'Later name');
  const replay = await service.call('openmotion_manage_project', input);
  assert.equal(replay.title, 'Later name', 'A stale retry never reverts a later rename');
  await assert.rejects(service.call('openmotion_manage_project', { ...input, title: 'Different' }), /REQUEST_ID_CONFLICT/);
  await assert.rejects(service.call('openmotion_manage_project', { ...input, requestId: 'stale' }), /PROJECT_NAME_CONFLICT/);
  await assert.rejects(service.call('openmotion_manage_project', { ...input, requestId: 'empty', title: ' ' }), /1.*100/);
  assert.equal(store.projectCatalog().projects.find(p => p.id === id)!.titleKey, null);
  assert.equal(store.projectCatalog().activeId, 'project');
}, false));

test('duplicate snapshots editable source and assets independently and deduplicates concurrent retries', () => fixture(async store => {
  const source = (await importProjects(store, 'import', bundle(), pluginRoot)).projects[0];
  const original = store.projectDirectoryFor(source.projectId), service = api(store);
  await writeFile(path.join(original, '.env'), 'private');
  await mkdir(path.join(original, 'renders')); await writeFile(path.join(original, 'renders/movie.mp4'), 'render');
  const before = await store.forProject(source.projectId).get();
  await reviewComments(store, { action: 'comments', operation: 'create', projectId: source.projectId,
    requestId: 'review-original', expectedRevision: before.revision, text: 'Review the original only', anchor: { scope: 'project', compositionPath: 'index.html' } });
  const input = { action: 'duplicate', projectId: source.projectId, title: 'Independent copy', requestId: 'duplicate', expectedRevision: before.revision };
  const [copy, replay] = await Promise.all([service.call('openmotion_manage_project', input), service.call('openmotion_manage_project', input)]);
  assert.equal(copy.projectId, replay.projectId); assert.notEqual(copy.projectId, source.projectId); assert.notEqual(copy.sessionId, source.sessionId);
  assert.equal(copy.sourceRevision, before.revision);
  assert.deepEqual((await reviewComments(store, { action: 'comments', operation: 'list', projectId: copy.projectId })).comments, []);
  const directory = store.projectDirectoryFor(copy.projectId);
  assert.equal(await readFile(path.join(directory, 'index.html'), 'utf8'), html);
  assert.equal(await readFile(path.join(directory, '.hyperframes/studio-motion.json'), 'utf8'), '{}');
  await assert.rejects(readFile(path.join(directory, '.env')), /ENOENT/);
  await assert.rejects(readFile(path.join(directory, 'renders/movie.mp4')), /ENOENT/);
  await writeFile(path.join(directory, 'assets/local.txt'), 'Edited copy');
  assert.equal(await readFile(path.join(original, 'assets/local.txt'), 'utf8'), 'Original asset');
  await writeFile(path.join(original, 'assets/local.txt'), 'Edited original');
  assert.equal((await service.call('openmotion_manage_project', input)).projectId, copy.projectId);
  assert.equal(store.projectCatalog().projects.length, 3);
  assert.equal(store.projectCatalog().activeId, 'project');
  await assert.rejects(service.call('openmotion_manage_project', { ...input, requestId: 'stale' }), /revision/);
  await assert.rejects(service.call('openmotion_manage_project', { ...input, title: 'Other name' }), /REQUEST_ID_CONFLICT/);
}, false));

test('location and reveal are confined to existing managed projects with explicit launcher errors', () => fixture(async store => {
  let calls = 0;
  const launch = async (command: string, args: string[]) => {
    calls++; assert.deepEqual({ command, args }, projectRevealCommand(store.projectDirectoryFor(id), process.platform));
  };
  const id = (await importProjects(store, 'import', bundle(), pluginRoot)).projects[0].projectId;
  const result = await manageProject(store, { action: 'reveal', projectId: id }, pluginRoot, launch);
  assert.equal('revealed' in result && result.revealed, true);
  await assert.rejects(manageProject(store, { action: 'reveal', projectId: '../other' }, pluginRoot, launch), /PROJECT_NOT_FOUND/);
  await assert.rejects(manageProject(store, { action: 'reveal', projectId: 'project' }, pluginRoot, launch), /PROJECT_NOT_READY/);
  assert.equal(calls, 1);
  await assert.rejects(manageProject(store, { action: 'reveal', projectId: id }, pluginRoot, async () => { throw new Error('No desktop'); }), /REVEAL_UNAVAILABLE/);
  await symlink(store.projectDirectoryFor(id), path.join(store.directory, 'project'));
  await assert.rejects(manageProject(store, { action: 'reveal', projectId: 'project' }, pluginRoot, launch), /PROJECT_NOT_READY/);
}, false));

test('duplicate can retry a missing HyperFrames runtime without leaving a partial copy', () => fixture(async store => {
  const { projects: [source] } = await importProjects(store, 'duplicate-source', bundle(), pluginRoot);
  const before = store.projectCatalog();
  const input = { action: 'duplicate' as const, projectId: source.projectId, requestId: 'duplicate-after-repair' };
  const missingRuntime = path.join(store.directory, 'not-installed');
  await assert.rejects(manageProject(store, input, missingRuntime), {
    message: /^PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE: The HyperFrames validator could not run\./,
  });
  assert.deepEqual(store.projectCatalog(), before);
  await assert.rejects(access(path.join(store.directory, 'project-archives', 'files')), /ENOENT/);
  const copy = await manageProject(store, input, pluginRoot);
  assert.notEqual(copy.projectId, source.projectId);
  assert.equal((await manageProject(store, input, pluginRoot)).projectId, copy.projectId);
  assert.equal(store.projectCatalog().projects.length, before.projects.length + 1);
}, false));

test('file manager paths remain a single argument on each supported platform', () => {
  const directory = '/tmp/Project with spaces $(echo unsafe)';
  assert.deepEqual(projectRevealCommand(directory, 'darwin'), { command: '/usr/bin/open', args: ['-R', directory] });
  assert.deepEqual(projectRevealCommand(directory, 'win32'), { command: 'explorer.exe', args: ['/select,', directory] });
  assert.deepEqual(projectRevealCommand(directory, 'linux'), { command: 'xdg-open', args: [directory] });
  assert.throws(() => projectRevealCommand(directory, 'unsupported'), /REVEAL_UNAVAILABLE/);
});

test('trash, restore and permanent delete keep active fallback and stable receipts', () => fixture(async store => {
  const imported = await importProjects(store, 'lifecycle-import', bundle());
  const id = imported.projects[0].projectId;
  const directory = store.projectDirectoryFor(id);
  const apiClient = api(store);
  await store.lock(() => store.selectProject(id));
  await store.addSessionMessage(imported.projects[0].sessionId, crypto.randomUUID(), 'Project conversation');
  const separateSession = await store.createSession({ mode: 'motion', title: 'Unrelated conversation' });
  await writeFile(path.join(directory, 'delete-me.txt'), 'remove me');
  const comment = (await reviewComments(store, { action: 'comments', operation: 'create', projectId: id, requestId: 'review-lifecycle',
    expectedRevision: (await store.forProject(id).get()).revision, text: 'Keep through Trash', anchor: { scope: 'project', compositionPath: 'index.html' } })).comment;

  const trashed = await manageProject(store, { action: 'trash', projectId: id, requestId: 'trash-project' });
  assert.equal(trashed.trashed, true);
  assert.equal(trashed.activeProjectId, 'project');
  assert.ok(store.projectCatalog().projects.find(project => project.id === id)?.trashedAt);
  assert.deepEqual((await apiClient.call('openmotion_get_project', { trashed: true })).projects.map((p: any) => p.id), [id]);
  assert.ok(!(await apiClient.call('openmotion_get_project', {})).projects.some((p: any) => p.id === id));
  assert.equal((await manageProject(store, { action: 'info', projectId: id })).path, directory);
  assert.throws(() => store.forProject(id), /PROJECT_TRASHED/);
  await assert.rejects(reviewComments(store, { action: 'comments', operation: 'list', projectId: id }), /PROJECT_TRASHED/);
  assert.equal((await manageProject(store, { action: 'trash', projectId: id, requestId: 'trash-project' })).replayed, true);

  const restored = await manageProject(store, { action: 'restore', projectId: id, requestId: 'restore-project' });
  assert.equal(restored.trashed, false);
  assert.equal(store.projectCatalog().projects.find(project => project.id === id)?.trashedAt, undefined);
  assert.deepEqual((await reviewComments(store, { action: 'comments', operation: 'list', projectId: id })).comments, [comment]);
  await manageProject(store, { action: 'trash', projectId: id, requestId: 'trash-before-delete' });

  const deleted = await manageProject(store, { action: 'delete', projectId: id, requestId: 'delete-project' });
  assert.equal(deleted.deleted, true);
  assert.equal(deleted.activeProjectId, 'project');
  await assert.rejects(access(directory));
  await assert.rejects(access(path.join(store.directory, 'review-comments', id + '.json')), /ENOENT/);
  await assert.rejects(access(path.join(store.directory, 'sessions', imported.projects[0].sessionId + '.json')));
  assert.equal((await store.session(separateSession.id)).title, 'Unrelated conversation');
  assert.equal((await importProjects(store, 'lifecycle-import', bundle())).projects[0].projectId, id);
  assert.deepEqual((await apiClient.call('openmotion_get_project', { trashed: true })).projects, []);
  assert.equal(store.projectCatalog().projects.some(project => project.id === id), false);
  assert.equal(store.projectCatalog().sessions!.some(session => session.artifacts.some(artifact => artifact.projectId === id)), false);
  const replay = await manageProject(store, { action: 'delete', projectId: id, requestId: 'delete-project' });
  assert.equal(replay.replayed, true);
  assert.equal(replay.deleted, true);
  await assert.rejects(manageProject(store, { action: 'delete', projectId: 'project', requestId: 'delete-active' }), /PROJECT_DELETE_REQUIRES_TRASH/);
  await assert.rejects(manageProject(store, { action: 'trash', projectId: 'project', requestId: 'trash-last' }), /PROJECT_DELETE_LAST_ACTIVE/);
}, false));

test('renderNext cancels queued exports and reconciles interrupted exports after a project is trashed or deleted', () => fixture(async store => {
  const first = (await importProjects(store, 'export-trash-import', bundle(), pluginRoot)).projects[0].projectId;
  const firstExport = await store.forProject(first).requestExport((await store.forProject(first).get()).revision);
  await manageProject(store, { action: 'trash', projectId: first, requestId: 'trash-with-pending-export' });

  await renderNext(store, pluginRoot);
  assert.equal((await store.job(firstExport.id))?.state, 'cancelled');
  await assert.rejects(access(store.snapshotDirectory(firstExport.id)), /ENOENT/);
  // Subsequent worker ticks on the terminal job of a trashed project must not throw.
  await renderNext(store, pluginRoot);

  // Another active project can immediately queue an export without hitting EXPORT_BUSY.
  const activeExport = await store.forProject('project').requestExport((await store.forProject('project').get()).revision);
  assert.equal(activeExport.state, 'pending');
  await store.saveJob({ ...(await store.job(activeExport.id))!, state: 'cancelled', stage: 'cancelled', observedOutcome: 'cancelled', terminalAt: Date.now() });

  // An interrupted running export for a permanently deleted project must reconcile instead of wedging the queue.
  const second = (await importProjects(store, 'export-delete-import', bundle(), pluginRoot)).projects[0].projectId;
  const secondExport = await store.forProject(second).requestExport((await store.forProject(second).get()).revision);
  const claimed = await store.claimExport();
  assert.equal(claimed?.id, secondExport.id);
  await store.saveJob({ ...claimed!, stage: 'rendering', workerPid: undefined });
  await manageProject(store, { action: 'trash', projectId: second, requestId: 'trash-before-delete-export' });
  await manageProject(store, { action: 'delete', projectId: second, requestId: 'delete-with-interrupted-export' });

  await renderNext(store, pluginRoot);
  const reconciled = await store.job(secondExport.id);
  assert.equal(reconciled?.state, 'failed');
  assert.equal(reconciled?.failureCode, 'EXPORT_WORKER_INTERRUPTED');
  // Subsequent worker ticks on the terminal job of a deleted project must not throw.
  await renderNext(store, pluginRoot);

  const followUp = await store.forProject('project').requestExport((await store.forProject('project').get()).revision);
  assert.equal(followUp.state, 'pending');
}));
