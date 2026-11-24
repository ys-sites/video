import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildPlugin } from '../integrations/dsh/build.ts';
import { prepareCandidatePlugin } from '../integrations/dsh/release.ts';
import { downloadOrigin, downloadPrefix, downloadPlugin, downloadManifestUrl, manifestUrl, validateDownload } from '../integrations/dsh/download.ts';
import { publishPlugin } from '../integrations/dsh/publish.ts';

const commit = 'a'.repeat(40);
const archive = Buffer.from('a test plugin archive');
const sha256 = createHash('sha256').update(archive).digest('hex');
const manifest = { schemaVersion: 1 as const, name: 'openmotion-dsh' as const, version: '0.1.0', dshVersion: '0.2.2-rc.1', sourceCommit: commit, bytes: archive.length, sha256, tarballUrl: `${downloadOrigin}/${downloadPrefix}/snapshots/${commit}/${sha256}/openmotion-dsh.tgz` };

test('public plugin downloads bind an immutable URL to a source commit and digest', () => {
  assert.equal(validateDownload(manifest), manifest);
  for (const invalid of [
    { schemaVersion: 2 }, { sourceCommit: 'main' }, { sha256: 'bad' }, { bytes: -1 },
    { version: 'latest' }, { dshVersion: '*' }, { tarballUrl: 'https://example.com/evil.tgz' },
    { tarballUrl: `${downloadOrigin}/${downloadPrefix}/main/openmotion-dsh.tgz` },
  ]) assert.throws(() => validateDownload({ ...manifest, ...invalid } as typeof manifest));
});

test('download helper follows one manifest snapshot, verifies bytes and preserves existing files', async t => {
  const destination = await mkdtemp(path.join(tmpdir(), 'dsh-download-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  const requests: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push(String(url)); assert.equal(init?.redirect, 'error');
    return String(url) === manifestUrl ? Response.json(manifest) : new Response(archive);
  };
  const result = await downloadPlugin(destination, fetcher);
  assert.deepEqual(requests, [manifestUrl, manifest.tarballUrl]);
  assert.deepEqual(await readFile(result.filename), archive);
  assert.equal(result.sourceCommit, commit);
  await assert.rejects(downloadPlugin(destination, fetcher), { code: 'EEXIST' });
  assert.deepEqual(await readFile(result.filename), archive);
});

test('download failure or corrupt bytes never create an installable file', async t => {
  const destination = await mkdtemp(path.join(tmpdir(), 'dsh-download-fail-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  for (const broken of [new Response('missing', { status: 404 }), new Response(Buffer.alloc(archive.length))]) {
    await assert.rejects(downloadPlugin(destination, async url => String(url) === manifestUrl ? Response.json(manifest) : broken));
    assert.deepEqual(await readdir(destination), []);
  }
  await assert.rejects(downloadPlugin(destination, async () => new Response('not yet published', { status: 404 })), /source build/);
});

async function publicationFixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'plugin.tgz'); await writeFile(filename, archive);
  const objects = new Map<string, Buffer>(), writes: string[] = [], verified: string[] = [];
  const execute = async (command: string, args: string[]) => {
    assert.equal(command, 'aws'); assert(args.includes('s3api'));
    const key = args[args.indexOf('--key') + 1];
    if (key.includes('/snapshots/')) assert(args.includes('--if-none-match'));
    else assert(verified.includes(manifest.tarballUrl), 'The public package must pass verification before promoting its pointer');
    writes.push(key); objects.set(key, await readFile(args[args.indexOf('--body') + 1])); return '{}';
  };
  const fetcher: typeof fetch = async url => {
    verified.push(String(url));
    const bytes = objects.get(new URL(String(url)).pathname.slice(1));
    return new Response(bytes ?? 'missing', { status: bytes ? 200 : 404 });
  };
  const config = { commit, endpoint: 'https://example.r2.cloudflarestorage.com', bucket: 'example-releases', archive: filename, version: manifest.version, dshVersion: manifest.dshVersion };
  return { config, execute, fetcher, objects, writes, currentCommit: async () => commit };
}

test('publisher verifies the tarball before updating the fixed entry and verifies that entry too', async t => {
  const fixture = await publicationFixture(t);
  assert.deepEqual(await publishPlugin(fixture.config, fixture), manifest);
  assert.deepEqual(fixture.writes, [new URL(manifest.tarballUrl).pathname.slice(1), `${downloadPrefix}/main/latest.json`]);
  const destination = await mkdtemp(path.join(tmpdir(), 'dsh-cold-download-'));
  t.after(() => rm(destination, { recursive: true, force: true }));
  const downloaded = await downloadPlugin(destination, fixture.fetcher, 'main');
  assert.deepEqual(await readFile(downloaded.filename), archive);
});

test('failed public verification and stale main builds retain the previous download entry', async t => {
  for (const failure of ['verification', 'stale']) {
    const fixture = await publicationFixture(t);
    const pointer = `${downloadPrefix}/main/latest.json`, previous = Buffer.from('previous download');
    fixture.objects.set(pointer, previous);
    if (failure === 'verification') fixture.fetcher = async () => new Response('wrong bytes');
    else fixture.currentCommit = async () => 'b'.repeat(40);
    await assert.rejects(publishPlugin(fixture.config, fixture), failure === 'stale' ? /stale/ : /verification/);
    assert.deepEqual(fixture.objects.get(pointer), previous);
    assert.equal(fixture.writes.length, 1);
  }
});

test('rerun accepts an existing immutable object only after public byte verification', async t => {
  const fixture = await publicationFixture(t);
  const key = new URL(manifest.tarballUrl).pathname.slice(1);
  fixture.objects.set(key, archive);
  const execute = async (command: string, args: string[]) => {
    if (args.includes('--if-none-match')) throw new Error('PreconditionFailed (412)');
    return fixture.execute(command, args);
  };
  await publishPlugin(fixture.config, { ...fixture, execute });
  fixture.objects.set(key, Buffer.from('unexpected existing bytes'));
  await assert.rejects(publishPlugin(fixture.config, { ...fixture, execute }), /verification/);
});

test('installation routing and workflow keep plugin distribution separate from npm publication', async () => {
  const install = await readFile(new URL('../docs/install.md', import.meta.url), 'utf8');
  assert(install.indexOf('## DSH:') < install.indexOf('## Codex:'));
  assert(install.includes(manifestUrl) && install.includes('integrations/dsh/README.md#download-and-install-the-plugin'));
  const workflow = await readFile(new URL('../.github/workflows/dsh-integration.yml', import.meta.url), 'utf8');
  const step = workflow.slice(workflow.indexOf('      - name: Publish verified main plugin downloads'));
  assert(step.includes("github.repository == 'nexu-io/openmotion' && github.ref == 'refs/heads/main'"));
  assert(step.includes("github.event_name == 'push' || github.event_name == 'workflow_dispatch'"));
  assert(!workflow.slice(0, workflow.indexOf(step)).includes('secrets.'));
  assert(step.includes('run: node integrations/dsh/publish.ts'));
  assert(!workflow.includes('npm publish') && !workflow.includes('id-token: write'));
  const filters = [...workflow.matchAll(/paths:\n((?: +- .+\n)+)/g)].map(match => [...match[1].matchAll(/- '([^']+)'/g)].map(item => item[1]));
  assert.equal(filters.length, 2);
  for (const patterns of filters) {
    for (const dependency of ['preview.ts', 'mcp.ts', 'install.md', 'docs/install.md', 'server.ts', 'editor-runtime.ts', 'workspace.ts', 'shared/process-lock.ts', 'scripts/release-version.mjs', '.github/scripts/motion-release.mjs', '.github/scripts/motion-scan.mjs', '.github/workflows/motion-candidate.yml', '.github/workflows/motion-publish-test.yml']) {
      assert(patterns.some(pattern => path.matchesGlob(dependency, pattern)), `DSH checks must run for ${dependency}`);
    }
  }
  assert(workflow.includes('npm run test --prefix integrations/dsh'));
});

test('installable plugin carries the licenses for its bundled icon artwork', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'dsh-license-package-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  await buildPlugin(output);
  const { stdout } = await promisify(execFile)('npm', ['pack', '--dry-run', '--ignore-scripts', '--json', output]);
  const files = new Set(JSON.parse(stdout)[0].files.map((file: { path: string }) => file.path));
  for (const filename of ['remix-icon-LICENSE.txt', 'remix-icon-NOTICE.txt']) {
    assert(files.has(filename), `Missing bundled artwork license: ${filename}`);
    assert.deepEqual(await readFile(path.join(output, filename)), await readFile(new URL('../packages/design-system/' + filename, import.meta.url)));
    assert((await readFile(path.join(output, 'README.md'), 'utf8')).includes(filename));
  }
});

test('candidate preparation packs the real plugin at the application version without editing source manifests', async t => {
  const output = await mkdtemp(path.join(tmpdir(), 'dsh-release-build-'));
  t.after(() => rm(output, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = promisify(execFile);
  const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  const original = await readFile(path.join(root, 'integrations/dsh/plugin/package.json'));
  const metadata = await prepareCandidatePlugin(root, output, '0.0.3-test.99', commit);
  const archive = path.join(output, 'openmotion-dsh-0.0.3-test.99.tgz');
  const pkg = JSON.parse((await run('tar', ['-xOf', archive, 'package/package.json'])).stdout);
  assert.equal(pkg.name, 'openmotion-dsh'); assert.equal(pkg.version, '0.0.3-test.99');
  assert.equal(metadata.sourceCommit, commit);
  assert.equal(metadata.sha256, createHash('sha256').update(await readFile(archive)).digest('hex'));
  assert.deepEqual(await readFile(path.join(root, 'integrations/dsh/plugin/package.json')), original);
});
