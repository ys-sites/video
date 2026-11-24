import { readProjectAssetNames } from '../project-asset-names.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile, readdir, rm, open, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startWorkspaceStudio } from '../shared/workspace-studio.ts';
import { request } from 'node:http';
import { fixture } from './fixtures.ts';
import { pluginRoot } from '../hyperframes.ts';
import { readFontFile } from '../shared/studio-fonts.ts';
import { create } from 'fontkit';

test('system fonts above 5 MiB remain readable with the asset limit and no-follow guard', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-system-font-'));
  const font = { path: path.join(root, 'CJK.ttc'), format: 'ttc' };
  const bytes = Buffer.alloc(6 * 1024 * 1024, 0x42);
  try {
    await writeFile(font.path, bytes);
    assert.deepEqual(await readFontFile(font.path), bytes);
    const link = path.join(root, 'link.ttc');
    await symlink(font.path, link);
    await assert.rejects(readFontFile(link));
    await assert.rejects(readFontFile(root));
    const file = await open(font.path, 'r+');
    try { await file.truncate(500_000_001); } finally { await file.close(); }
    await assert.rejects(readFontFile(font.path), /500 MB/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Studio rejects decimal uploads above 500 MB before saving and still accepts normal uploads', () => fixture(async store => {
  const studio = await startWorkspaceStudio(pluginRoot, store.directory, store.projectDirectory, 0);
  const url = `${studio.origin}/api/projects/${store.projectId}/upload?dir=assets`;
  const assets = path.join(store.projectDirectory, 'assets');
  const before = await readdir(assets);
  try {
    assert.equal((await fetch(studio.origin + '/api/fonts/file')).status, 400);
    assert.equal((await fetch(studio.origin + '/api/fonts/file?family=../../package.json')).status, 404);
    for (const size of [500_000_001, 500_500_000, 524_288_000]) {
      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request(url, { method: 'POST', headers: { Origin: studio.origin, 'Content-Length': size, Connection: 'close' } }, res => {
          let body = '';
          res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
          res.on('error', reject);
          res.on('end', () => { resolve({ status: res.statusCode!, body }); req.destroy(); });
        });
        req.on('error', reject); req.setTimeout(5000, () => req.destroy(new Error('Upload limit response timed out')));
        req.end();
      });
      assert.equal(response.status, 413);
      assert.equal(JSON.parse(response.body).maxBytes, 500_000_000);
      assert.deepEqual(await readdir(assets), before);
    }
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'clip.png');
    const response = await fetch(url, { method: 'POST', headers: { Origin: studio.origin }, body: form });
    assert.equal(response.status, 201, await response.clone().text());
    assert.deepEqual((await response.json()).files, ['assets/clip.png']);
    assert.equal((await fetch(studio.origin + '/api/projects')).status, 200);
  } finally { await studio.close(); }
}));

test('the shipped history availability module loads without plugin-local node_modules', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-history-module-'));
  try {
    const module = path.join(root, 'history.ts');
    await copyFile(new URL('../shared/studio-history-availability.ts', import.meta.url), module);
    const detached = await import(pathToFileURL(module).href);
    assert.equal(typeof detached.withAvailableHistorySteps, 'function');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installed font import copies an actual face into only the requested project', () => fixture(async store => {
  const studio = await startWorkspaceStudio(pluginRoot, store.directory, store.projectDirectory, 0);
  const url = `${studio.origin}/api/projects/${store.projectId}/fonts/import`;
  const post = body => fetch(url, { method: 'POST', headers: { Origin: studio.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ path: '/etc/passwd' })).status, 400);
    assert.equal((await post({ family: '../../package.json' })).status, 404);
    assert.equal((await fetch(url, { method: 'POST', body: JSON.stringify({ family: 'Arial' }) })).status, 403);
    const { fonts } = await (await fetch(studio.origin + '/api/fonts')).json();
    assert.ok(fonts.length > 0, 'The runtime test requires the CI system fonts');
    const response = await post({ family: fonts[0] });
    assert.equal(response.status, 201);
    const font = await response.json();
    assert.ok(font.path.startsWith('assets/fonts/'));
    const decoded = create(await readFontFile(await store.safePath(font.path)));
    assert.equal(decoded.getName('preferredFamily') || decoded.familyName, font.family);
    const listing = await (await fetch(`${studio.origin}/api/projects/${store.projectId}`)).json();
    assert.ok(listing.fonts.some(entry => entry.path === font.path && entry.family === font.family && entry.weight === font.weight));
  } finally { await studio.close(); }
}));

test('workspace host refuses unsupported, missing, ambiguous and incompatible native factories before serving', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-host-contract-'));
  const cli = path.join(root, 'node_modules/hyperframes');
  const manifest = path.join(cli, 'package.json');
  try {
    await mkdir(path.join(cli, 'dist'), { recursive: true });
    const writeVersion = version => writeFile(manifest, JSON.stringify({ name: 'hyperframes', type: 'module', version }));
    await writeVersion('0.9.8');
    await assert.rejects(startWorkspaceStudio(root, root, root, 0), /Unsupported/);
    await writeVersion('0.9.7');
    await assert.rejects(startWorkspaceStudio(root, root, root, 0), /missing or ambiguous/);
    await writeFile(path.join(cli, 'dist/studioServer-first.js'), 'export const other = true;');
    await assert.rejects(startWorkspaceStudio(root, root, root, 0), /factory is unavailable/);
    await writeFile(path.join(cli, 'dist/studioServer-second.js'), 'export const other = true;');
    await assert.rejects(startWorkspaceStudio(root, root, root, 0), /missing or ambiguous/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Studio project listing resolves imported UUID paths to original names and real font faces', () => fixture(async store => {
  const audioPath = 'assets/imported/94dcfb95-f8f9-455d-bca3-382788fa3943.m4a';
  const fontPath = 'assets/fonts/40da8f95-f670-4cbf-87cc-6f843570b7da.ttf';
  await mkdir(path.join(store.projectDirectory, 'assets/imported'), { recursive: true });
  await mkdir(path.join(store.projectDirectory, 'assets/fonts'), { recursive: true });
  await writeFile(path.join(store.projectDirectory, audioPath), 'listing-only audio');
  await copyFile(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url), path.join(store.projectDirectory, fontPath));
  await writeFile(path.join(store.projectDirectory, 'motion-assets.json'), JSON.stringify([{ path: audioPath, name: 'original-audio.m4a' }]));
  await writeFile(path.join(store.projectDirectory, 'motion-project.json'), JSON.stringify({ namingLanguage: 'zh-CN' }));
  const studio = await startWorkspaceStudio(pluginRoot, store.directory, store.projectDirectory, 0);
  try {
    const response = await fetch(`${studio.origin}/api/projects/${store.projectId}`);
    assert.equal(response.status, 200);
    const listing = await response.json();
    assert.equal(listing.namingLanguage, 'zh-CN');
    assert.equal(listing.assetNames[audioPath], 'original-audio');
    assert.match(listing.assetNames[fontPath], /^Orbitron/);
    const mcpNames = await readProjectAssetNames(store, undefined, undefined, pluginRoot);
    assert.equal(mcpNames.assetNames[fontPath], listing.assetNames[fontPath]);
    assert.ok(listing.files.includes(audioPath));
    assert.equal((await fetch(`${studio.origin}/api/projects/${store.projectId}/preview/${audioPath}`)).status, 200);
  } finally { await studio.close(); }
}));
