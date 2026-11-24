import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { packageProject } from '../skills/openmotion-template-to-video/scripts/delivery.mjs';
import { playbackServer, byteRange } from '../skills/openmotion-template-to-video/scripts/playback.mjs';
import { WorkspaceStore } from '../workspace.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
async function setSource(detail, project, name, data) {
  await mkdir(path.dirname(path.join(project, name)), { recursive: true });
  await writeFile(path.join(project, name), data);
  const entry = { path: name, hash: hash(data) };
  const index = detail.project.files.findIndex(file => file.path === name);
  if (index === -1) detail.project.files.push(entry); else detail.project.files[index] = entry;
}
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-template-delivery-'));
  const project = path.join(directory, 'project'); await mkdir(project);
  const contents = { 'index.html': '<html><script src="vendor/gsap-3.14.2/dist/gsap.min.js"></script><main data-composition-src="compositions/scene.html"></main></html>',
    'compositions/scene.html': '<template><p>Original</p></template>', 'vendor/gsap-3.14.2/dist/gsap.min.js': 'window.gsap={};',
    '.hyperframes/history-id': 'history', '.hyperframes/video-state.json': '{}', '.hyperframes/preview/frame.png': 'frame',
    '.hyperframes/session.json': '{}', '.hyperframes/studio-motion.json': '{"motion":true}', '.thumbnails/cache.png': 'cache',
    'renders/old-export.mp4': 'render', 'output/export.mp4': 'output' };
  for (const [name, data] of Object.entries(contents)) { await mkdir(path.dirname(path.join(project, name)), { recursive: true }); await writeFile(path.join(project, name), data); }
  const detail = { projectId: '11111111-1111-1111-1111-111111111111', currentVersionId: 'version-1',
    ...await new WorkspaceStore(directory).get() };
  return { directory, project, detail };
}

test('packages the pinned original files, hidden history identity and local dependency without runtime caches', async () => {
  const f = await fixture();
  try {
    const receipt = await packageProject(f.detail, path.join(f.directory, 'delivery'));
    assert.equal(receipt.versionId, 'version-1'); assert.equal(receipt.sourceUnchanged, true);
    assert.equal(await readFile(path.join(f.directory, 'delivery/HTML/.hyperframes/history-id'), 'utf8'), 'history');
    assert.equal(await readFile(path.join(f.directory, 'delivery/HTML/vendor/gsap-3.14.2/dist/gsap.min.js'), 'utf8'), 'window.gsap={};', 'A vendored dist tree the page loads stays packaged even though WorkspaceStore omits it from the revision');
    assert.equal(await readFile(path.join(f.directory, 'delivery/HTML/.hyperframes/studio-motion.json'), 'utf8'), '{"motion":true}', 'Native Studio manifest stays packaged');
    assert.ok(!receipt.files.some(file => file.path.includes('.thumbnails') || file.path.includes('video-state')));
    assert.deepEqual(receipt.files.map(file => file.path), ['HTML/.hyperframes/history-id', 'HTML/.hyperframes/studio-motion.json', 'HTML/compositions/scene.html', 'HTML/index.html', 'HTML/vendor/gsap-3.14.2/dist/gsap.min.js'], 'Package holds the pinned source, native identity and vendored dist dependency');
    const written = (await readdir(path.join(f.directory, 'delivery/HTML'), { recursive: true })).map(name => String(name).split(path.sep).join('/'));
    for (const nonSource of ['renders', 'output', '.hyperframes/preview', '.hyperframes/session.json']) {
      assert.ok(!written.some(name => name === nonSource || name.startsWith(nonSource + '/')), 'Render output and cache stays out of the package: ' + nonSource);
    }
    const archive = await readFile(receipt.archive); assert.equal(hash(archive), receipt.archiveSHA256);
    const integrity = spawnSync('unzip', ['-t', receipt.archive], { encoding: 'utf8' }); assert.equal(integrity.status, 0, integrity.stderr);
    const listing = spawnSync('unzip', ['-Z1', receipt.archive], { encoding: 'utf8' }); assert.equal(listing.status, 0);
    assert.ok(listing.stdout.includes('HTML/index.html') && listing.stdout.includes('HTML/vendor/gsap-3.14.2/dist/gsap.min.js'));
    assert.deepEqual(listing.stdout.split('\n').filter(Boolean).sort(), receipt.files.map(file => file.path).sort(), 'Archive contains exactly the receipted files');
    await assert.rejects(packageProject(f.detail, path.join(f.directory, 'delivery')), /EEXIST/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('refuses source drift, unsafe inventory paths, missing dependencies and foreign symlinks before delivery', async () => {
  const f = await fixture();
  try {
    const output = path.join(f.directory, 'delivery');
    await symlink(f.project, path.join(f.directory, 'project-alias'));
    await assert.rejects(packageProject(f.detail, path.join(f.directory, 'project-alias/nested/delivery')), /OUTPUT_INSIDE_PROJECT/);
    await writeFile(path.join(f.project, 'index.html'), 'changed');
    await assert.rejects(packageProject(f.detail, output), /SOURCE_DRIFT/);
    const changed = structuredClone(f.detail); changed.project.files[0].path = '../outside';
    await assert.rejects(packageProject(changed, output), /UNSAFE_PROJECT_PATH/);
    const original = '<html><script src="missing.js"></script></html>';
    await writeFile(path.join(f.project, 'index.html'), original); f.detail.project.files.find(file => file.path === 'index.html').hash = hash(original);
    await assert.rejects(packageProject(f.detail, output), /MISSING_DEPENDENCY/);
    await symlink(path.join(f.directory, 'foreign'), path.join(f.project, 'foreign-link'));
    await assert.rejects(packageProject(f.detail, output), /PROJECT_SYMLINK/);
    assert.ok(!(await readdir(f.directory)).includes('delivery'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('refuses source additions outside the pinned inventory', async () => {
  const f = await fixture();
  try {
    const output = path.join(f.directory, 'delivery');
    // Studio writes the manifest after the project-detail read, so it is absent from the pinned inventory.
    await mkdir(path.join(f.project, '.hyperframes'), { recursive: true });
    await writeFile(path.join(f.project, '.hyperframes/studio-manual-edits.json'), '{"edits":true}');
    assert.notEqual((await new WorkspaceStore(f.directory).get()).revision, f.detail.revision);
    await assert.rejects(packageProject(f.detail, output), /SOURCE_DRIFT: unpinned source file \.hyperframes\/studio-manual-edits\.json/, 'Native manifest added after the project read changes the revision');
    f.detail.project.files.push({ path: '.hyperframes/studio-manual-edits.json', hash: hash('{"edits":true}') });
    await writeFile(path.join(f.project, 'compositions/added.html'), '<template><p>Added</p></template>');
    await assert.rejects(packageProject(f.detail, output), /SOURCE_DRIFT: unpinned source file compositions\/added\.html/, 'Ordinary source added after the project read');
    assert.ok(!(await readdir(f.directory)).includes('delivery'), 'A refused package leaves no partial output');
    Object.assign(f.detail, await new WorkspaceStore(f.directory).get());
    await writeFile(path.join(f.project, '.hyperframes/history-id'), 'updated history');
    await writeFile(path.join(f.project, '.DS_Store'), 'desktop metadata');
    assert.equal((await new WorkspaceStore(f.directory).get()).revision, f.detail.revision, 'History and hidden metadata do not change the revision');
    const receipt = await packageProject(f.detail, output);
    assert.ok(!receipt.files.some(file => file.path.endsWith('.DS_Store')));
    assert.equal(await readFile(path.join(output, 'HTML/.hyperframes/history-id'), 'utf8'), 'updated history');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('validates quoted CSS imports before declaring dependencies local', async () => {
  const f = await fixture();
  try {
    const output = path.join(f.directory, 'delivery');
    const page = style => '<html><style>' + style + '</style><script src="vendor/gsap-3.14.2/dist/gsap.min.js"></script></html>';
    await setSource(f.detail, f.project, 'index.html', page('@import "vendor/missing.css";'));
    await assert.rejects(packageProject(f.detail, output), /MISSING_DEPENDENCY: index\.html -> vendor\/missing\.css/);
    await setSource(f.detail, f.project, 'index.html', page('@import "https://cdn.example/sheet.css";'));
    await assert.rejects(packageProject(f.detail, output), /REMOTE_DEPENDENCY/);
    await setSource(f.detail, f.project, 'vendor/gsap/theme.css', '@import "base.css";');
    await setSource(f.detail, f.project, 'index.html', page('@import "vendor/gsap/theme.css";'));
    await assert.rejects(packageProject(f.detail, output), /MISSING_DEPENDENCY: vendor\/gsap\/theme\.css -> base\.css/, 'Imports resolve relative to the importing stylesheet');
    await setSource(f.detail, f.project, 'vendor/gsap/theme.css', "@import '//cdn.example/base.css';");
    await assert.rejects(packageProject(f.detail, output), /REMOTE_DEPENDENCY/, 'Protocol-relative and single-quoted imports stay remote');
    await setSource(f.detail, f.project, 'vendor/gsap/theme.css', "@import 'https://cdn.example/base.css';");
    await assert.rejects(packageProject(f.detail, output), /REMOTE_DEPENDENCY/, 'Standalone quoted remote imports are rejected');
    await setSource(f.detail, f.project, 'vendor/gsap/theme.css', "@import 'base.css';");
    await setSource(f.detail, f.project, 'vendor/gsap/base.css', 'body{}');
    const receipt = await packageProject(f.detail, output);
    assert.equal(receipt.dependencies, 'local');
    assert.ok(receipt.files.some(file => file.path === 'HTML/vendor/gsap/base.css'));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('ignores quoted import examples in CSS comments and HTML scripts', async () => {
  const f = await fixture();
  try {
    await setSource(f.detail, f.project, 'index.html', `<style>/* @import "missing.css"; */</style><script>const example = '@import "script-example.css"';</script>`);
    await setSource(f.detail, f.project, 'styles/example.css', '/* @import "https://cdn.example/commented.css"; */ body {}');
    assert.equal((await packageProject(f.detail, path.join(f.directory, 'delivery'))).dependencies, 'local');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('thin exported helper resolves scope metadata instead of assuming a repository-relative runtime', async () => {
  const f = await fixture();
  try {
    const thin = path.join(f.directory, 'thin/scripts'); await mkdir(thin, { recursive: true });
    await writeFile(path.join(thin, 'delivery.mjs'), await readFile(path.join(root, 'skills/openmotion-template-to-video/scripts/delivery.mjs')));
    await writeFile(path.join(f.directory, 'thin/scope.json'), JSON.stringify({ runtimeRoot: root }));
    const detail = path.join(f.directory, 'detail.json'); await writeFile(detail, JSON.stringify(f.detail));
    const child = spawnSync(process.execPath, [path.join(thin, 'delivery.mjs'), 'package', '--project-json', detail, '--output', path.join(f.directory, 'thin-output')], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr); assert.equal(JSON.parse(child.stdout).files, 5);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('Range parsing preserves middle, suffix and open-ended byte requests and rejects invalid ranges', () => {
  assert.deepEqual(byteRange('bytes=2-4', 10), { start: 2, end: 4, status: 206 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9, status: 206 });
  for (const header of ['bytes=10-', 'bytes=4-2', 'bytes=-0', 'bytes=0-1,3-4', 'not-a-range']) assert.equal(byteRange(header, 10), null);
});

test('playback server supports real GET/HEAD/206/416 and rejects cross-origin reports and arbitrary files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-playback-'));
  const video = path.join(directory, 'final.mp4'), report = path.join(directory, 'report.json');
  await writeFile(video, '0123456789');
  const server = await playbackServer(video, report);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const middle = await fetch(origin + '/video.mp4', { headers: { Range: 'bytes=2-4' } });
    assert.equal(middle.status, 206); assert.equal(middle.headers.get('content-range'), 'bytes 2-4/10'); assert.equal(await middle.text(), '234');
    const head = await fetch(origin + '/video.mp4', { method: 'HEAD' }); assert.equal(head.status, 200); assert.equal(head.headers.get('accept-ranges'), 'bytes'); assert.equal(head.headers.get('content-length'), '10'); assert.equal(await head.text(), '');
    const invalid = await fetch(origin + '/video.mp4', { headers: { Range: 'bytes=99-' } }); assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), 'bytes */10');
    assert.equal((await fetch(origin + '/secret.json')).status, 404);
    assert.equal((await fetch(origin + '/report', { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: '{"status":"passed"}' })).status, 403);
    const result = await fetch(origin + '/report', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"status":"passed","scope":"final-file-playback"}' });
    assert.equal(result.status, 201); assert.equal(JSON.parse(await readFile(report, 'utf8')).sha256, hash('0123456789'));
    assert.equal((await fetch(origin + '/report', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{"status":"passed"}' })).status, 400, 'Report cannot overwrite prior evidence');
    assert.ok((await (await fetch(origin + '/playback.html')).text()).includes('Start playback check'));
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
