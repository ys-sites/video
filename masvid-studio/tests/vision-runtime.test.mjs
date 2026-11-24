import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { checkVisionLock, prepareVisionAssets, visionConfiguration, visionEnvironment } from '../scripts/vision-runtime.mjs';
import { runFile } from '../scripts/runtime-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = JSON.parse(await readFile(path.join(root, 'scripts/runtime-lock.json')));

test('vision locks require both platform wheels, exact versions and integrity hashes', () => {
  checkVisionLock(runtime);
  for (const mutate of [
    lock => { delete lock.targets['mac-arm64'].vision; },
    lock => { lock.vision.numpy = 'latest'; },
    lock => { lock.targets['win-x64'].vision.wheels.pop(); },
    lock => { lock.targets['mac-arm64'].vision.python.sha256 = ''; },
    lock => { lock.targets['win-x64'].vision.python.executable = '../python.exe'; },
    lock => { lock.targets['win-x64'].vision.wheels[0].url = 'http://invalid/numpy.whl'; },
    lock => { lock.vision.opencv = '1.0.0'; },
  ]) {
    const invalid = structuredClone(runtime);
    mutate(invalid);
    assert.throws(() => checkVisionLock(invalid));
  }
});

test('vision processes ignore host Python, virtualenv and pip configuration', () => {
  const env = visionEnvironment({ PATH: 'keep', PYTHONHOME: '/bad', PYTHONPATH: '/bad', PYTHONUSERBASE: '/bad', VIRTUAL_ENV: '/bad', PIP_INDEX_URL: 'https://invalid', pip_config_file: '/bad' });
  assert.deepEqual(env, { PATH: 'keep', PIP_CONFIG_FILE: os.devNull });
});

test('vision assets use the existing verified cache and reject corrupt downloads', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'motion-vision-assets-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bytes = Buffer.from('fixture');
  const asset = { url: 'https://example.invalid/python.tar.gz', sha256: createHash('sha256').update(bytes).digest('hex') };
  const lock = { targets: { fixture: { vision: { python: asset, wheels: [1, 2].map(id => ({ ...asset, url: `https://example.invalid/${id}.whl` })) } } } };
  let downloads = 0;
  t.mock.method(globalThis, 'fetch', async () => { downloads++; return new Response(bytes); });
  await Promise.all([prepareVisionAssets(lock, 'fixture', directory), prepareVisionAssets(lock, 'fixture', directory)]);
  assert.equal(downloads, 3);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network disabled'); });
  await prepareVisionAssets(lock, 'fixture', directory);
  await writeFile(path.join(directory, '1.whl'), 'corrupt');
  await assert.rejects(prepareVisionAssets(lock, 'fixture', directory), /Network disabled/);
  t.mock.method(globalThis, 'fetch', async () => new Response('wrong'));
  await assert.rejects(prepareVisionAssets(lock, 'fixture', directory), /SHA256 mismatch/);
  t.mock.method(globalThis, 'fetch', async () => new Response(bytes));
  await prepareVisionAssets(lock, 'fixture', directory);
});

test('installed vision configuration is tied to its own manifest and cache', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'motion-vision-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Configuration checks also run on Linux, without claiming a supported native target.
  const lock = structuredClone(runtime);
  const info = lock.targets['mac-arm64'];
  info.platform = process.platform;
  info.arch = process.arch;
  delete info.vision.minimumDarwinMajor;
  lock.targets = { fixture: info };
  const cache = path.join(directory, 'private-cache');
  await writeFile(path.join(directory, '.npm-install.json'), JSON.stringify({ runtime: lock, cacheDirectory: cache }));
  const config = await visionConfiguration(directory);
  assert.equal(config.cache, cache);
  assert(config.python.startsWith(cache + path.sep));
  assert.equal(config.target, 'fixture');
  lock.vision.python = '3.13.19';
  await writeFile(path.join(directory, '.npm-install.json'), JSON.stringify({ runtime: lock, cacheDirectory: cache }));
  assert.notEqual((await visionConfiguration(directory)).identity, config.identity);
});

for (const layout of ['source', 'flat', 'bundle']) {
  test(`vision Skill entry resolves its ${layout} runtime from an unrelated working directory`, async t => {
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'motion-vision-entry-')));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const application = path.join(directory, 'application # 1');
    const skill = layout === 'source' ? path.join(application, 'skills/openmotion-recreate') : path.join(directory, 'host/skills/openmotion-recreate');
    await mkdir(path.join(application, 'scripts'), { recursive: true });
    await mkdir(path.join(skill, 'scripts'), { recursive: true });
    await cp(path.join(root, 'skills/openmotion-recreate/scripts/vision-tools.mjs'), path.join(skill, 'scripts/vision-tools.mjs'));
    await writeFile(path.join(application, 'scripts/vision-runtime.mjs'), `export async function ensureVisionRuntime(root) { return {python: root, runtime: {vision: {fixture: true}}}; } export function visionEnvironment() { return {}; }`);
    if (layout !== 'source') await writeFile(path.join(layout === 'flat' ? skill : path.dirname(path.dirname(skill)), layout === 'flat' ? 'openmotion-install.json' : 'scope.json'), JSON.stringify({ runtimeRoot: application }));
    const output = JSON.parse(await runFile(process.execPath, [path.join(skill, 'scripts/vision-tools.mjs'), 'prepare'], { cwd: os.tmpdir() }));
    assert.equal(output.python, application);
  });
}
