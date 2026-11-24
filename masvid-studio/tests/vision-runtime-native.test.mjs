import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { ensureVisionRuntime, prepareVisionAssets, visionEnvironment } from '../scripts/vision-runtime.mjs';
import { runFile } from '../scripts/runtime-assets.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = JSON.parse(await readFile(path.join(root, 'scripts/runtime-lock.json')));

test('native cold, concurrent, offline and copied-Skill vision paths work without host Python', { timeout: 300_000 }, async t => {
  const target = Object.entries(runtime.targets).find(([, info]) => info.platform === process.platform && info.arch === process.arch)?.[0];
  assert(target, 'This mandatory native test must run on a supported target');
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'om-vision-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const application = path.join(directory, 'app #1');
  await mkdir(path.join(application, 'scripts'), { recursive: true });
  for (const name of ['vision-runtime.mjs', 'npm-runtime.mjs', 'runtime-assets.mjs', 'runtime-lock.json']) await cp(path.join(root, 'scripts', name), path.join(application, 'scripts', name));
  await cp(path.join(root, 'skills/openmotion-recreate'), path.join(application, 'skills/openmotion-recreate'), { recursive: true });
  await mkdir(path.join(application, 'tests'));
  await cp(path.join(root, 'tests/recreate-registration.py'), path.join(application, 'tests/recreate-registration.py'));
  const assets = path.join(application, 'runtime/vision-assets');
  const started = performance.now();
  await prepareVisionAssets(runtime, target, assets);
  const downloadMs = performance.now() - started;
  // An empty environment cache plus shipped assets exercises a complete ZIP offline.
  await writeFile(path.join(application, '.npm-install.json'), JSON.stringify({ schemaVersion: 1, runtime, cacheDirectory: path.join(directory, 'cache') }));
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Network disabled after asset preparation'); });
  const coldStarted = performance.now();
  const [first, joined] = await Promise.all([ensureVisionRuntime(application), ensureVisionRuntime(application)]);
  const coldMs = performance.now() - coldStarted;
  assert.equal(first.python, joined.python);
  const warmStarted = performance.now();
  assert.equal((await ensureVisionRuntime(application)).python, first.python);
  const warmMs = performance.now() - warmStarted;
  const env = { ...visionEnvironment(), PYTHONHOME: path.join(directory, 'invalid'), PYTHONPATH: path.join(directory, 'poison'), VIRTUAL_ENV: path.join(directory, 'absent'), PYTHON: 'missing-python', UV_PYTHON: 'missing-python' };
  await mkdir(env.PYTHONPATH);
  await writeFile(path.join(env.PYTHONPATH, 'cv2.py'), 'raise RuntimeError("Host Python path was used")');
  const entry = path.join(application, 'skills/openmotion-recreate/scripts/vision-tools.mjs');
  const run = (...args) => runFile(process.execPath, [entry, ...args], { cwd: directory, env });
  const identity = JSON.parse(await run('python', '-c', 'import sys,numpy,cv2,json; print(json.dumps(dict(executable=sys.executable,numpy=numpy.__file__,opencv=cv2.__file__)))'));
  for (const filename of Object.values(identity)) assert(filename.startsWith(first.directory + path.sep));
  const regressionStarted = performance.now();
  await run('python', path.join(application, 'tests/recreate-registration.py'));
  const regressionMs = performance.now() - regressionStarted;
  // Run both normal helper entry points on a real decoded video and inspect reports.
  const reference = path.join(directory, 'reference.avi');
  await run('python', '-c', 'import cv2,numpy as n,sys; w=cv2.VideoWriter(sys.argv[1],cv2.VideoWriter_fourcc(*"MJPG"),10,(320,180)); a=n.random.default_rng(18).integers(0,256,(180,320,3),dtype=n.uint8); [w.write(cv2.warpAffine(a,n.float32([[1,0,i*2],[0,1,0]]),(320,180))) for i in range(10)]; w.release()', reference);
  const motion = path.join(directory, 'motion.json');
  await run('measure', reference, reference, '--start', '0', '--end', '.8', '--roi', '20,20,260,140', '--out', motion);
  assert((await readFile(motion, 'utf8')).includes('measured'));
  const registration = path.join(directory, 'registration.json');
  await run('register', reference, '--anchor', '0', '--times', '.2,.4', '--out', registration);
  assert(JSON.parse(await readFile(registration)).samples.every(sample => sample.status === 'measured'));
  for (const layout of ['flat', 'bundle']) {
    const destination = path.join(directory, layout, 'skills/openmotion-recreate');
    await cp(path.dirname(path.dirname(entry)), destination, { recursive: true });
    await writeFile(path.join(layout === 'flat' ? destination : path.dirname(path.dirname(destination)), layout === 'flat' ? 'openmotion-install.json' : 'scope.json'), JSON.stringify({ runtimeRoot: application }));
    const copied = JSON.parse(await runFile(process.execPath, [path.join(destination, 'scripts/vision-tools.mjs'), 'prepare'], { cwd: os.tmpdir(), env }));
    assert.equal(copied.python, first.python);
  }
  // A complete ZIP's configured plugin is copied into a host cache. Its scope
  // must keep pointing to the complete package after that copy.
  await cp(path.join(root, 'scripts/bundle/configure-plugin.mjs'), path.join(application, 'scripts/configure-plugin.mjs'));
  const bundledNode = path.join(application, 'runtime/node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  await mkdir(path.dirname(bundledNode), { recursive: true });
  await writeFile(bundledNode, 'access-only fixture');
  await writeFile(path.join(application, 'release.json'), JSON.stringify({ target, version: '0.0.1-local.1' }));
  await writeFile(path.join(application, '.mcp.json'), JSON.stringify({ mcpServers: { openmotion: {} } }));
  await cp(path.join(application, 'skills'), path.join(application, 'plugin/skills'), { recursive: true });
  await runFile(process.execPath, [path.join(application, 'scripts/configure-plugin.mjs')]);
  const hostCache = path.join(directory, 'complete-plugin-cache');
  await cp(path.join(application, 'plugin'), hostCache, { recursive: true });
  const complete = JSON.parse(await runFile(process.execPath, [path.join(hostCache, 'skills/openmotion-recreate/scripts/vision-tools.mjs'), 'prepare'], { env }));
  assert.equal(complete.python, first.python);
  // Incomplete installations are retried, with verified downloads reused offline.
  await writeFile(path.join(first.directory, 'ready.json'), '{interrupted');
  await ensureVisionRuntime(application);
  t.diagnostic(JSON.stringify({ target, versions: runtime.vision, downloadMs, coldMs, warmMs, regressionMs }));
});
