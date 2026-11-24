import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultInstallationHome, nativeCacheDirectory } from './npm-runtime.mjs';
import { executable, extractArchive, obtainAsset, readJSON, relativePath, runFile, withCacheLock, writeJSON } from './runtime-assets.mjs';

const versionProbe = `
import sys
import json
import importlib.metadata as metadata
import numpy
import cv2

assert callable(cv2.ORB_create)
assert callable(cv2.findHomography)
assert callable(cv2.calcOpticalFlowPyrLK)
print(json.dumps(dict(
    python=".".join(map(str, sys.version_info[:3])),
    numpy=numpy.__version__,
    opencv=metadata.version("opencv-python-headless"),
)))
`;

export function checkVisionLock(runtime) {
  for (const name of ['python', 'numpy', 'opencv']) assert.match(runtime.vision?.[name] || '', /^\d+\.\d+\.\d+(?:\.\d+)?$/, 'Pin vision version: ' + name);
  for (const target of Object.values(runtime.targets)) {
    const vision = target.vision;
    assert(vision?.python && vision.wheels?.length === 2, 'Vision runtime requires Python and two pinned wheels');
    relativePath('.', vision.python.executable);
    relativePath('.', vision.sitePackages);
    for (const asset of [vision.python, ...vision.wheels]) {
      assert.equal(new URL(asset.url).protocol, 'https:', 'Vision sources require HTTPS');
      assert.match(asset.sha256, /^[a-f0-9]{64}$/, 'Pin vision SHA256');
    }
    for (const name of ['numpy', 'opencv_python_headless']) {
      const version = runtime.vision[name === 'numpy' ? 'numpy' : 'opencv'];
      assert(vision.wheels.some(asset => path.basename(new URL(asset.url).pathname).startsWith(name + '-' + version + '-')), 'Vision wheel version mismatch: ' + name);
    }
  }
}

// Downloads are also used by cross-platform ZIP builds, without executing target Python.
export async function prepareVisionAssets(runtime, target, directory, allowLocal = false) {
  const info = runtime.targets[target]?.vision;
  assert(info, 'No pinned vision runtime for ' + target);
  return Promise.all([info.python, ...info.wheels].map(async asset => {
    const filename = path.join(directory, path.basename(new URL(asset.url).pathname));
    await obtainAsset(asset, filename, allowLocal);
    return filename;
  }));
}

export function visionEnvironment(environment = process.env) {
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) => !/^(?:PYTHON|PIP_|VIRTUAL_ENV$)/i.test(key)));
  return { ...clean, PIP_CONFIG_FILE: os.devNull };
}

export async function visionConfiguration(root) {
  const installed = await readJSON(path.join(root, '.npm-install.json'));
  const runtime = installed?.runtime || await readJSON(path.join(root, 'scripts/runtime-lock.json'));
  checkVisionLock(runtime);
  const found = Object.entries(runtime.targets).find(([, info]) => info.platform === process.platform && info.arch === process.arch);
  assert(found, `No pinned vision runtime for ${process.platform}-${process.arch}`);
  const [target, info] = found;
  if (info.vision.minimumDarwinMajor) assert(Number(os.release().split('.')[0]) >= info.vision.minimumDarwinMajor, 'Vision tools require macOS 13 or later');
  if (process.platform === 'win32') assert(Number(os.release().split('.')[2]) >= 22000, 'Vision tools require Windows 11 or later');
  const environment = (await readJSON(path.join(root, 'shared/template-config.json')))?.environment;
  const cache = installed?.cacheDirectory || nativeCacheDirectory(defaultInstallationHome(environment));
  assert(path.isAbsolute(cache), 'Vision cache must be absolute');
  const identity = createHash('sha256').update(JSON.stringify({ versions: runtime.vision, target, assets: info.vision })).digest('hex');
  const directory = path.join(cache, target, 'vision-' + identity);
  return { root, runtime, target, info: info.vision, identity, directory, cache, allowLocal: installed?.allowLocalAssets === true,
    python: relativePath(directory, info.vision.python.executable) };
}

async function ready(config) {
  const marker = await readJSON(path.join(config.directory, 'ready.json')).catch(error => { if (error instanceof SyntaxError) return null; throw error; });
  if (marker?.identity !== config.identity) return false;
  try {
    await executable(config.python);
    const site = relativePath(config.directory, config.info.sitePackages);
    await access(path.join(site, 'numpy/__init__.py'));
    await access(path.join(site, 'cv2/__init__.py'));
    return true;
  } catch (error) {
    if (['ENOENT', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
}

export async function ensureVisionRuntime(root) {
  const config = await visionConfiguration(root);
  if (await ready(config)) return config;
  await withCacheLock(config.directory + '.lock', async () => {
    if (await ready(config)) return;
    console.error('OpenMotion: preparing pinned Python, NumPy and OpenCV for vision tools.');
    const assets = [config.info.python, ...config.info.wheels];
    const directory = path.join(config.cache, config.target, 'vision-downloads');
    await mkdir(directory, { recursive: true });
    const files = await Promise.all(assets.map(async asset => {
      const name = path.basename(new URL(asset.url).pathname);
      const bundled = path.join(root, 'runtime/vision-assets', name);
      const present = await access(bundled).then(() => true, error => { if (error.code !== 'ENOENT') throw error; return false; });
      const source = present ? { ...asset, url: pathToFileURL(bundled).href } : asset;
      const filename = path.join(directory, name);
      await obtainAsset(source, filename, present || config.allowLocal);
      return filename;
    }));
    await mkdir(path.dirname(config.directory), { recursive: true });
    const temporary = await mkdtemp(path.join(path.dirname(config.directory), 'vision-'));
    try {
      await extractArchive(files[0], temporary);
      const python = relativePath(temporary, config.info.python.executable);
      await executable(python);
      const env = visionEnvironment();
      await runFile(python, ['-I', '-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-index', '--no-deps', '--no-compile', '--only-binary=:all:', '--no-warn-script-location', '--target', relativePath(temporary, config.info.sitePackages), ...files.slice(1)], { env });
      const versions = JSON.parse(await runFile(python, ['-I', '-c', versionProbe], { env }));
      assert.deepEqual(versions, config.runtime.vision, 'Vision runtime version mismatch');
      await writeJSON(path.join(temporary, 'ready.json'), { identity: config.identity, versions });
      await rm(config.directory, { recursive: true, force: true });
      await rename(temporary, config.directory);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
  return config;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureVisionRuntime(process.argv[2] || fileURLToPath(new URL('../', import.meta.url)))
    .then(config => console.log(JSON.stringify({ python: config.python, versions: config.runtime.vision })))
    .catch(error => { console.error('VISION_RUNTIME_ERROR: ' + error.message); process.exitCode = 1; });
}
