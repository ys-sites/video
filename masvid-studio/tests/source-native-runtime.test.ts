import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureNativeEnvironment, ensureNativeRuntime, nativeRuntimeStatus } from '../scripts/npm-runtime.mjs';

const environmentKeys = ['HYPERFRAMES_BROWSER_PATH', 'HYPERFRAMES_FFMPEG_PATH', 'HYPERFRAMES_FFPROBE_PATH', 'MOTION_BROWSER_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH'];

async function fixture(t: any, bundledMedia = false, environment = 'prod') {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'motion-source-native-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previous = environmentKeys.map(key => process.env[key]);
  environmentKeys.forEach(key => delete process.env[key]);
  t.after(() => environmentKeys.forEach((key, i) => previous[i] === undefined ? delete process.env[key] : process.env[key] = previous[i]));
  t.mock.method(os, 'homedir', () => directory);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Source discovery must not download'); });
  const root = path.join(directory, 'source');
  await mkdir(path.join(root, 'scripts'), { recursive: true });
  const asset = (name: string, digit: string) => ({ executable: name, sha256: digit.repeat(64) });
  const info = { platform: process.platform, arch: process.arch, browser: asset('browser', '1'),
    ...(bundledMedia ? { media: { directory: 'tools', sha256: '2'.repeat(64) } }
      : { ffmpeg: asset('ffmpeg', '2'), ffprobe: asset('ffprobe', '3') }) };
  const runtime = { targets: { fixture: info } };
  await writeFile(path.join(root, 'scripts/runtime-lock.json'), JSON.stringify(runtime));
  // LOCALAPPDATA is only read on Windows; keep the simulated installation isolated.
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === 'win32') process.env.LOCALAPPDATA = directory;
  t.after(() => localAppData === undefined ? delete process.env.LOCALAPPDATA : process.env.LOCALAPPDATA = localAppData);
  const installHome = path.join(process.platform === 'win32' ? directory : path.join(directory, '.local/share'), environment === 'dev' ? 'openmotion-dev' : 'openmotion');
  const paths: Record<string, string> = {};
  const cache = async (layout = 'cache/native') => {
    for (const [name, value] of Object.entries(info).filter(([, value]) => typeof value === 'object') as [string, any][]) {
      const destination = path.join(installHome, layout, 'fixture', name + '-' + value.sha256);
      const tools = name === 'media' ? ['ffmpeg', 'ffprobe'] : [name];
      for (const tool of tools) {
        const filename = path.join(destination, name === 'media' ? `tools/bin/${tool}${process.platform === 'win32' ? '.exe' : ''}` : value.executable);
        await mkdir(path.dirname(filename), { recursive: true });
        await writeFile(filename, '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
        paths['HYPERFRAMES_' + tool.toUpperCase() + '_PATH'] = filename;
      }
      await writeFile(path.join(destination, 'ready.json'), JSON.stringify({ sha256: value.sha256 }));
    }
  };
  return { root, runtime, installHome, paths, cache };
}

for (const layout of ['cache/native', 'cache']) {
  test(`source startup reuses pinned installed tools from ${layout} without managing or downloading them`, async t => {
    const { root, cache, paths } = await fixture(t);
    await cache(layout);
    assert.equal(await configureNativeEnvironment(root), null);
    for (const [key, filename] of Object.entries(paths)) assert.equal(process.env[key], filename);
    await ensureNativeRuntime(root);
    assert.equal((await nativeRuntimeStatus(root)).managed, false);
    assert.deepEqual(await readdir(root), ['scripts']);
  });
}

test('source discovery preserves explicit paths and legacy environment aliases', async t => {
  const { root, cache, paths } = await fixture(t);
  await cache();
  process.env.HYPERFRAMES_FFMPEG_PATH = '/explicit/ffmpeg';
  process.env.FFMPEG_PATH = '/lower-priority/ffmpeg';
  process.env.FFPROBE_PATH = '/explicit/ffprobe';
  process.env.MOTION_BROWSER_PATH = '/explicit/browser';
  await configureNativeEnvironment(root);
  assert.equal(process.env.HYPERFRAMES_FFMPEG_PATH, '/explicit/ffmpeg');
  assert.equal(process.env.HYPERFRAMES_FFPROBE_PATH, '/explicit/ffprobe');
  assert.equal(process.env.HYPERFRAMES_BROWSER_PATH, '/explicit/browser');
  assert.notEqual(process.env.HYPERFRAMES_FFMPEG_PATH, paths.HYPERFRAMES_FFMPEG_PATH);
});

test('source startup falls back to the default DEV installation cache', async t => {
  const { root, cache, paths } = await fixture(t, false, 'dev');
  await cache();
  assert.equal(await configureNativeEnvironment(root), null);
  for (const [key, filename] of Object.entries(paths)) assert.equal(process.env[key], filename);
});

test('source discovery ignores incomplete, corrupt, wrong-hash and non-executable cached tools', { skip: process.platform === 'win32' }, async t => {
  const { root, cache, paths } = await fixture(t);
  await cache();
  const marker = path.join(path.dirname(paths.HYPERFRAMES_FFMPEG_PATH), 'ready.json');
  await rm(marker);
  await writeFile(path.join(path.dirname(paths.HYPERFRAMES_FFPROBE_PATH), 'ready.json'), '{broken');
  await chmod(paths.HYPERFRAMES_BROWSER_PATH, 0o644);
  await configureNativeEnvironment(root);
  for (const key of Object.keys(paths)) assert.equal(process.env[key], undefined);
  await writeFile(marker, JSON.stringify({ sha256: '0'.repeat(64) }));
  await configureNativeEnvironment(root);
  assert.equal(process.env.HYPERFRAMES_FFMPEG_PATH, undefined);
  // A complete legacy cache remains usable when the preferred cache is incomplete.
  await cache('cache');
  await configureNativeEnvironment(root);
  for (const [key, filename] of Object.entries(paths)) assert.equal(process.env[key], filename);
});

test('an unreadable or unpinned source runtime lock keeps system-tool fallback', async t => {
  const { root, runtime, cache, paths } = await fixture(t);
  await cache();
  const warnings: string[] = [];
  t.mock.method(console, 'error', (message: unknown) => warnings.push(String(message)));
  const lock = path.join(root, 'scripts/runtime-lock.json');
  const unpinned = { targets: { fixture: { platform: process.platform, arch: process.arch, browser: { executable: 'browser' } } } };
  for (const content of ['<<<<<<< HEAD\n{broken', JSON.stringify(unpinned)]) {
    await writeFile(lock, content);
    assert.equal(await configureNativeEnvironment(root), null);
    for (const key of environmentKeys) assert.equal(process.env[key], undefined);
  }
  assert.equal(warnings.length, 2);
  assert(warnings.every(warning => warning.includes('Source native cache discovery was skipped')));
  await writeFile(lock, JSON.stringify(runtime));
  await configureNativeEnvironment(root);
  for (const [key, filename] of Object.entries(paths)) assert.equal(process.env[key], filename);
});

test('an uncached source checkout retains system-tool fallback and creates no installation', async t => {
  const { root, installHome } = await fixture(t);
  await ensureNativeRuntime(root);
  for (const key of environmentKeys) assert.equal(process.env[key], undefined);
  await assert.rejects(readdir(installHome), { code: 'ENOENT' });
  assert.deepEqual(await readdir(root), ['scripts']);
});

test('managed installations keep their own cache configuration', async t => {
  const { root, runtime, cache, paths } = await fixture(t);
  await cache();
  const cacheDirectory = path.join(root, 'managed-cache');
  await writeFile(path.join(root, '.npm-install.json'), JSON.stringify({ schemaVersion: 1, runtime, cacheDirectory }));
  const native = await configureNativeEnvironment(root);
  assert.equal(native.config.cacheDirectory, cacheDirectory);
  for (const key of Object.keys(paths)) {
    assert.equal(process.env[key], native.paths[key]);
    assert.notEqual(process.env[key], paths[key]);
  }
});

test('source discovery supports the bundled Windows media layout', async t => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', platform));
  const { root, cache, paths } = await fixture(t, true);
  await cache();
  await configureNativeEnvironment(root);
  for (const [key, filename] of Object.entries(paths)) assert.equal(process.env[key], filename);
  assert(paths.HYPERFRAMES_FFPROBE_PATH.endsWith('ffprobe.exe'));
  process.env.HYPERFRAMES_FFMPEG_PATH = '/explicit/ffmpeg.exe';
  delete process.env.HYPERFRAMES_FFPROBE_PATH;
  await configureNativeEnvironment(root);
  assert.equal(process.env.HYPERFRAMES_FFMPEG_PATH, '/explicit/ffmpeg.exe');
  assert.equal(process.env.HYPERFRAMES_FFPROBE_PATH, paths.HYPERFRAMES_FFPROBE_PATH);
});
