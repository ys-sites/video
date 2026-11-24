import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { projectArchive, importProjects } from '../project-archive.ts';
import { readProjectZip } from '../shared/project-zip.ts';
import { firstFoldedDuplicate, portableNameProblem } from '../shared/project-name.ts';
import { zip } from '../scripts/zip.mjs';
import { Phase1Service } from '../phase1.ts';
import { nativeProjectConfig, pluginRoot } from '../hyperframes.ts';

const html = '<!doctype html><html><head><meta charset="utf-8"></head><body><div data-composition-id="main" data-start="0" data-duration="1" data-width="320" data-height="180"><p>Portable project</p></div><script>window.__timelines = {};</script></body></html>';
const native = (prefix = '') => zip([
  { name: prefix + 'index.html', data: Buffer.from(html) },
  { name: prefix + 'hyperframes.json', data: Buffer.from(JSON.stringify(nativeProjectConfig)) },
  { name: prefix + 'assets/local-font.woff2', data: Buffer.from('font-fixture') },
  { name: prefix + 'assets/LICENSE.txt', data: Buffer.from('Fixture font license') },
  { name: prefix + 'assets/image.png', data: Buffer.from([137, 80, 78, 71]) },
  { name: prefix + '.hyperframes/studio-manual-edits.json', data: Buffer.from('{}') },
]);

for (const action of ['export', 'import'] as const) {
  test(`${action} leaves the workspace writable while native validation waits`, () => fixture(async store => {
    const { projects: [source] } = await importProjects(store, 'source', native('Original/'), pluginRoot);
    const runtime = path.join(store.directory, 'waiting-engine'), core = path.join(runtime, 'node_modules/@hyperframes/core');
    const started = path.join(runtime, 'started'), release = path.join(runtime, 'release');
    await mkdir(core, { recursive: true });
    await writeFile(path.join(core, 'package.json'), JSON.stringify({ exports: { './lint': { import: './lint.mjs' } } }));
    await writeFile(path.join(core, 'lint.mjs'), `
      import { access, writeFile } from 'node:fs/promises';
      import { setTimeout } from 'node:timers/promises';
      export async function lintProject() {
        await writeFile(${JSON.stringify(started)}, '');
        while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await setTimeout(15);
        return { totalErrors: 0, totalWarnings: 0, totalInfos: 0, results: [] };
      }
    `);
    const operation = action === 'export'
      ? projectArchive(store, { action, projectIds: [source.projectId], requestId: 'delayed' }, runtime)
      : importProjects(store, 'delayed', native('Another/'), runtime);
    void operation.catch(() => {});
    try {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (await access(started).then(() => true, () => false)) break;
        await delay(15);
      }
      await access(started);
      await assert.rejects(access(path.join(store.directory, 'workspace.lock')), { code: 'ENOENT' });
      await store.renameProject(source.projectId, 'Renamed during validation');
    } finally {
      await writeFile(release, '');
      await operation;
    }
    assert.equal(store.projectCatalog().projects.find(project => project.id === source.projectId)?.title, 'Renamed during validation');
    const result = await operation;
    if (action === 'export' && 'archivePath' in result) {
      const manifest = readProjectZip(await readFile(result.archivePath)).get('openmotion-projects.json')!;
      assert.equal(JSON.parse(manifest.toString()).projects[0].title, 'Original');
    } else assert.ok(result.projects.length);
  }, false));
}
const service = (store: any) => new Phase1Service(store, pluginRoot, {
  origin: () => 'http://localhost:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => ({}),
});

test('ZIP roundtrip preserves source, assets, fonts and edits as independent projects; retries do not duplicate', () => fixture(async store => {
  const before = store.projectCatalog();
  const imported = await importProjects(store, 'first-import', native('Shared film/'));
  const id = imported.projects[0].projectId;
  assert.equal(imported.projects[0].title, 'Shared film');
  assert.equal(store.projectCatalog().activeId, before.activeId);
  assert.equal(store.projectCatalog().activeSessionId, before.activeSessionId);
  assert.deepEqual((await importProjects(store, 'first-import', native('Shared film/'))).projects, imported.projects);
  const directory = store.projectDirectoryFor(id);
  await writeFile(path.join(directory, '.env'), 'secret');
  await writeFile(path.join(directory, 'motion-project.json'), '{"private":"metadata"}');
  await mkdir(path.join(directory, 'renders')); await writeFile(path.join(directory, 'renders/out.mp4'), 'render');
  const api = service(store);
  const exported = await api.call('openmotion_project_archive', { action: 'export', requestId: 'export', projectIds: [id] });
  assert.match(exported.downloadUrl, /^http:\/\/localhost:4173\/motion-api\/project-archives\//);
  const bytes = await readFile(exported.archivePath), entries = readProjectZip(bytes);
  assert.ok(![...entries.keys()].some(name => /\/\.env|\/motion-project\.json|\/renders\//.test(name)));
  assert.equal((await api.call('openmotion_project_archive', { action: 'export', requestId: 'export', projectIds: [id] })).archiveId, exported.archiveId);
  const copied = await api.call('openmotion_project_archive', { action: 'import', requestId: 'second-import', sourcePath: exported.archivePath });
  assert.notEqual(copied.projects[0].projectId, id);
  const copy = store.forProject(copied.projects[0].projectId);
  for (const [name, bytes] of readProjectZip(native())) assert.deepEqual(await readFile(path.join(copy.projectDirectory, name)), bytes, name);
  const version = await api.call('openmotion_get_project', { projectId: copy.projectId });
  assert.ok(version.version.versionId);
  await api.call('openmotion_edit_project', { projectId: copy.projectId, requestId: 'continue-editing', expectedRevision: version.revision, expectedVersionId: version.version.versionId, files: [{ path: 'note.txt', content: 'New independent edit' }] });
  assert.ok(!(await readdir(directory)).includes('note.txt'));
  const all = await api.call('openmotion_project_archive', { action: 'export', requestId: 'export-all', all: true });
  assert.equal(all.projects.length, 2);
  assert.deepEqual(all.skippedProjectIds, ['project']);
  const bundle = await importProjects(store, 'bundle-import', await readFile(all.archivePath));
  assert.equal(bundle.projects.length, 2);
  assert.equal(store.projectCatalog().activeId, before.activeId);
}, false));

test('native HyperFrames composition folders may omit a marker config and receive defaults', () => fixture(async store => {
  const markerless = zip([
    { name: 'index.html', data: Buffer.from(html) },
    { name: 'assets/local.js', data: Buffer.from('window.__timelines = {};') },
  ]);
  const imported = await importProjects(store, 'markerless-native', markerless, pluginRoot);
  assert.equal(imported.projects[0].title, 'Imported project');
  const directory = store.projectDirectoryFor(imported.projects[0].projectId);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'hyperframes.json'))), nativeProjectConfig);
}, false));

test('browser ZIP upload/download and MCP use the same archive format and request receipts', () => fixture(async store => {
  const http = transport(store, { runtimeRoot: pluginRoot });
  const body = new Blob([native()]);
  const upload = () => http('/motion-api/project-archives/import?requestId=http-import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body });
  const response = await upload(); assert.equal(response.status, 200, await response.clone().text());
  const imported = await response.json();
  assert.deepEqual((await (await upload()).json()).projects, imported.projects);
  const id = imported.projects[0].projectId, { revision } = await store.forProject(id).get();
  const exportAtRevision = (revision: string) => http('/motion-api/phase1/call', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'openmotion_project_archive', arguments: { action: 'export', requestId: 'http-export', projectIds: [id], expectedRevisions: { [id]: revision } } }) });
  const badRevision = await exportAtRevision('invalid');
  assert.equal(badRevision.status, 400);
  assert.match((await badRevision.json()).error, /INVALID_ARGUMENT: arguments\.expectedRevisions/);
  const stale = await exportAtRevision('0'.repeat(64));
  assert.equal(stale.status, 400);
  assert.match((await stale.json()).error, /revision/i);
  const exportedResponse = await exportAtRevision(revision);
  assert.equal(exportedResponse.status, 200, await exportedResponse.clone().text());
  const exported = await exportedResponse.json();
  assert.deepEqual(exported.projects, [{ projectId: id, revision }]);
  const downloaded = await http(new URL(exported.downloadUrl).pathname);
  assert.equal(downloaded.headers.get('content-type'), 'application/zip');
  assert.match(downloaded.headers.get('content-disposition')!, /attachment/);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), await readFile(exported.archivePath));
  const bad = await http('/motion-api/project-archives/import?requestId=bad', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: new Blob(['bad']) });
  assert.equal(bad.ok, false);
  const typed = await http('/motion-api/project-archives/import?requestId=http-import-typed', { method: 'POST', headers: { 'Content-Type': 'application/x-zip-compressed; charset=binary' }, body });
  assert.equal(typed.status, 200, await typed.clone().text());
  const oversized = await http('/motion-api/project-archives/import?requestId=oversized', { method: 'POST', headers: { 'Content-Type': 'application/zip', 'Content-Length': '500000001' } });
  assert.equal(oversized.status, 413);
}, false));

test('invalid packages, checksum changes and stale revisions cannot alter existing projects', () => fixture(async store => {
  const imported = await importProjects(store, 'initial', native()), id = imported.projects[0].projectId;
  const current = await store.forProject(id).get(), catalog = store.projectCatalog();
  const exported = await projectArchive(store, { action: 'export', requestId: 'export', projectIds: [id] });
  assert.ok('archivePath' in exported);
  const entries = readProjectZip(await readFile(exported.archivePath));
  const index = [...entries.keys()].find(name => name.endsWith('/index.html'))!;
  entries.set(index, Buffer.from(html + 'changed'));
  await assert.rejects(importProjects(store, 'tampered', zip([...entries].map(([name, data]) => ({ name, data })))), /checksum/);
  await assert.rejects(importProjects(store, 'initial', native('different/')), /REQUEST_ID_CONFLICT/);
  await assert.rejects(projectArchive(store, { action: 'export', requestId: 'stale', projectIds: [id], expectedRevisions: { [id]: '0'.repeat(64) } }), /revision/);
  await assert.rejects(projectArchive(store, { action: 'export', requestId: 'export', all: true }), /REQUEST_ID_CONFLICT/);
  await assert.rejects(importProjects(store, 'invalid-html', zip([{ name: 'index.html', data: Buffer.from('not a composition') }, { name: 'hyperframes.json', data: Buffer.from('{}') }])));
  const badPaths = [...readProjectZip(native())].map(([name, data]) => ({ name, data: name === 'hyperframes.json' ? Buffer.from('{"paths":{"assets":"../../outside"}}') : data }));
  await assert.rejects(importProjects(store, 'outside', zip(badPaths)), /relative/);
  assert.deepEqual(store.projectCatalog(), catalog);
  assert.deepEqual(await store.forProject(id).get(), current);
  assert.deepEqual(await readdir(path.join(store.directory, 'project-archives/staging')), []);
}, false));

test('export refuses symbolic links and outside sources', () => fixture(async store => {
  const { projects } = await importProjects(store, 'import', native());
  const id = projects[0].projectId;
  await writeFile(path.join(store.directory, 'private.txt'), 'outside');
  await symlink(path.join(store.directory, 'private.txt'), path.join(store.projectDirectoryFor(id), 'leak.txt'));
  await assert.rejects(projectArchive(store, { action: 'export', requestId: 'leak', projectIds: [id] }), /符号链接/);
}, false));

test('a failing member rejects the entire bundle before any project is registered', () => fixture(async store => {
  const roots = ['projects/' + randomUUID(), 'projects/' + randomUUID()];
  const entries: { name: string; data: Buffer }[] = [];
  const projects = roots.map((root, index) => {
    const files = [...readProjectZip(native())].map(([name, bytes]) => {
      const data = index && name === 'index.html' ? Buffer.from('invalid composition') : bytes;
      entries.push({ name: root + '/' + name, data });
      return { path: name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    });
    return { title: 'Bundle member', root, files };
  });
  entries.push({ name: 'openmotion-projects.json', data: Buffer.from(JSON.stringify({ format: 'openmotion.project-archive', version: 1, projects })) });
  const catalog = store.projectCatalog();
  await assert.rejects(importProjects(store, 'invalid-bundle', zip(entries)), /validation failed/);
  assert.deepEqual(store.projectCatalog(), catalog);
  assert.deepEqual(await readdir(path.join(store.directory, 'project-archives/staging')), []);
}, false));

test('concurrent retries register one copy and preserve unrelated catalog entries', () => fixture(async store => {
  const [a, b] = await Promise.all([importProjects(store, 'same-upload', native()), importProjects(store, 'same-upload', native())]);
  assert.deepEqual(a.projects, b.projects);
  assert.equal(store.projectCatalog().projects.length, 2);
  assert.equal(store.projectId, 'project');
}, false));

test('separate imports preserve same titles as independent projects', () => fixture(async store => {
  const first = await importProjects(store, 'same-title-a', native('Shared film/'));
  const second = await importProjects(store, 'same-title-b', native('Shared film/'));
  assert.equal(first.projects[0].title, 'Shared film');
  assert.equal(second.projects[0].title, 'Shared film');
  assert.notEqual(first.projects[0].projectId, second.projects[0].projectId);
  assert.equal(store.projectCatalog().projects.filter(project => project.title === 'Shared film').length, 2);
}, false));

test('ZIP parser rejects traversal, collisions, symlinks, encryption, corrupted CRCs and expanded bombs', () => {
  for (const name of ['../out.txt', '/out.txt', 'C:/out.txt', 'a\\b.txt', 'a/../out', 'NUL.txt', 'a./x', 'x\u0000.txt']) assert.throws(() => readProjectZip(zip([{ name, data: Buffer.from('x') }])));
  for (const names of [['A.txt', 'a.txt'], ['a', 'a/b'], ['é.txt', 'e\u0301.txt']]) assert.throws(() => readProjectZip(zip(names.map(name => ({ name, data: Buffer.from('x') })))));
  const original = zip([{ name: 'file.txt', data: Buffer.from('hello') }]);
  for (const mutation of ['crc', 'symlink', 'encryption', 'bomb', 'local-name']) {
    const bytes = Buffer.from(original), central = bytes.readUInt32LE(bytes.length - 6);
    if (mutation === 'crc') bytes[38] ^= 1;
    if (mutation === 'symlink') bytes.writeUInt32LE(0xa0000000, central + 38);
    if (mutation === 'encryption') bytes.writeUInt16LE(1, central + 8);
    if (mutation === 'bomb') { bytes.writeUInt32LE(500000001, central + 24); bytes.writeUInt32LE(500000001, 22); }
    if (mutation === 'local-name') bytes[30] = 65;
    assert.throws(() => readProjectZip(bytes), undefined, mutation);
  }
});

test('ZIP parser accepts ordinary DEFLATE archives without extracting executable paths', () => {
  const data = Buffer.from('compressed source '.repeat(100)), packed = deflateRawSync(data);
  const bytes = zip([{ name: 'index.html', data: packed }]);
  const central = bytes.readUInt32LE(bytes.length - 6);
  bytes.writeUInt16LE(0x802, 6); bytes.writeUInt16LE(0x802, central + 8);
  bytes.writeUInt16LE(8, 8); bytes.writeUInt16LE(8, central + 10);
  bytes.writeUInt32LE(data.length, 22); bytes.writeUInt32LE(data.length, central + 24);
  bytes.writeUInt32LE(crc32(data), 14); bytes.writeUInt32LE(crc32(data), central + 16);
  assert.deepEqual(readProjectZip(bytes).get('index.html'), data);
});


test('archive validation uses the installation runtime supplied by the transport', () => fixture(async store => {
  const runtime = path.join(store.directory, 'missing-runtime');
  const input = path.join(store.directory, 'project.zip');
  await writeFile(input, native());
  const before = store.projectCatalog();
  await assert.rejects(projectArchive(store, { action: 'import', requestId: 'runtime', sourcePath: input }, runtime), /PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE/);
  assert.deepEqual(store.projectCatalog(), before);
  const result = await projectArchive(store, { action: 'import', requestId: 'runtime', sourcePath: input }, pluginRoot);
  assert.equal(result.projects.length, 1);
}, false));

test('export rejects a source snapshot that the shared import validator would reject', () => fixture(async store => {
  const { projects: [project] } = await importProjects(store, 'source', native('Broken config/'), pluginRoot);
  const file = path.join(store.projectDirectoryFor(project.projectId), 'hyperframes.json');
  const exportInput = { action: 'export' as const, requestId: 'validate-export', projectIds: [project.projectId] };
  await writeFile(file, '{"paths":{"assets":"../outside"}}');
  await assert.rejects(projectArchive(store, exportInput, pluginRoot), /Broken config.*Project paths must be relative/);
  await assert.rejects(readdir(path.join(store.directory, 'project-archives', 'files')), /ENOENT/);
  assert.deepEqual(await readdir(path.join(store.directory, 'project-archives', 'staging')), []);
  await writeFile(file, JSON.stringify(nativeProjectConfig));
  const exported = await projectArchive(store, exportInput, pluginRoot);
  assert.ok('archivePath' in exported);
  const reimported = await importProjects(store, 'verified-archive', await readFile(exported.archivePath), pluginRoot);
  assert.equal(reimported.projects[0].title, project.title);
  assert.notEqual(reimported.projects[0].projectId, project.projectId);
}, false));

test('a re-compressed OpenMotion ZIP can have one enclosing folder and Finder metadata', () => fixture(async store => {
  const { projects } = await importProjects(store, 'source', native('Original title/'), pluginRoot);
  const exported = await projectArchive(store, { action: 'export', requestId: 'original', projectIds: [projects[0].projectId] }, pluginRoot);
  assert.ok('archivePath' in exported);
  const entries = readProjectZip(await readFile(exported.archivePath));
  const packaged = zip([
    ...[...entries].map(([name, data]) => ({ name: '外部分享包/' + name, data })),
    { name: '外部分享包/.DS_Store', data: Buffer.from('mac metadata') },
    { name: '__MACOSX/外部分享包/._openmotion-projects.json', data: Buffer.from('mac metadata') },
  ]);
  const imported = await importProjects(store, 'recompressed', packaged, pluginRoot);
  assert.equal(imported.projects[0].title, 'Original title');
}, false));

test('portable project names follow one rule for writes and archive import', () => {
  assert.equal(portableNameProblem('con.html'), 'con.html');
  assert.equal(portableNameProblem('assets/AUX.png'), 'AUX.png');
  assert.equal(portableNameProblem('notes. '), 'notes. ');
  assert.equal(portableNameProblem('assets/cover.png'), null);
  assert.equal(firstFoldedDuplicate(['A.css', 'a.css'], true), 'a.css');
  assert.equal(firstFoldedDuplicate(['A.css', 'a.css'], false), null);
  assert.equal(firstFoldedDuplicate(['A.css', 'b.css'], true), null);
});
test('import refuses a reserved device name that a write would now reject', () => {
  const bytes = zip([
    { name: 'index.html', data: Buffer.from(html) },
    { name: 'hyperframes.json', data: Buffer.from(JSON.stringify(nativeProjectConfig)) },
    { name: 'con.html', data: Buffer.from('<html></html>') },
  ]);
  assert.throws(() => readProjectZip(bytes), /Invalid or unsupported ZIP/);
});

test('archive CI lane checks portable names through project write and asset APIs', () => fixture(async store => {
  const current = await store.get();
  await assert.rejects(store.writeFiles(current.revision, [{ path: 'con.html', content: html }]), /路径无效/);
  const source = path.join(store.directory, 'portable-source.png');
  await writeFile(source, Buffer.from('asset-fixture'));
  await assert.rejects(store.importAsset(current.revision, source, 'assets/nul.png'), /路径无效/);
}));

test('archive CI lane keeps the entry-file guard exact on every platform', () => fixture(async store => {
  const current = await store.get();
  await assert.rejects(store.writeFiles(current.revision, [{ path: 'Index.html', content: html }]), /index\.html/);
}, false));

test('archive import rejects a source that would block without a writer', { skip: process.platform === 'win32' && 'FIFO sources are POSIX-only' }, () => fixture(async store => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-archive-fifo-'));
  try {
    const source = path.join(directory, 'project.zip');
    execFileSync('mkfifo', [source]);
    const started = Date.now();
    // A blocking open would wait for a writer and stall the serialized tool queue.
    await assert.rejects(projectArchive(store, { action: 'import', requestId: 'fifo-source', sourcePath: source }), /regular file/);
    assert.ok(Date.now() - started < 5000, 'a FIFO source must be rejected without waiting for a writer');
  } finally { await rm(directory, { recursive: true, force: true }); }
}));
