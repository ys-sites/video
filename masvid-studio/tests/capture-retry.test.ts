import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { fixCaptureModule } from '../shared/hyperframes-capture-fix.mjs';
import { browserAutomation } from '../browser.ts';
import { HYPERFRAMES_VERSION, runHyperframes, runtimeEnv } from '../hyperframes.ts';

const captureUrl = new URL('../node_modules/hyperframes/dist/chunk-IAZ2A7D6.js', import.meta.url);
const retryUrl = new URL('../node_modules/hyperframes/dist/chunk-Y2R4N6HQ.js', import.meta.url);
const engine = await import(captureUrl.href);
const originalRetry = await readFile(retryUrl, 'utf8');
const retrySource = fixCaptureModule(retryUrl.href, originalRetry);
const bufferError = 'net::ERR_NO_BUFFER_SPACE at http://localhost:62840/index.html';

test('managed Chrome suppresses the macOS search icon and preserves caller-provided disabled features', async () => {
  const browser = await browserAutomation(path.resolve(import.meta.dirname, '..'));
  const args = await browser.defaultArgs({ headless: true, args: ['--disable-features=AudioServiceOutOfProcess'] });
  const disabled = args.find(arg => arg.startsWith('--disable-features='))!.slice('--disable-features='.length).split(',');
  assert.ok(disabled.includes('AudioServiceOutOfProcess'));
  assert.equal(disabled.includes('OmniboxEverywhere'), process.platform === 'darwin');
});

test('an unexpected Chrome launcher still loads with its original options', t => {
  const url = new URL('../node_modules/puppeteer-core/lib/puppeteer/node/ChromeLauncher.js', import.meta.url);
  const warn = t.mock.method(process, 'emitWarning', () => {});
  for (const source of ['const defaultFeatures = [];', '        const disabledFeatures = [\n        const disabledFeatures = [']) {
    assert.equal(fixCaptureModule(url.href, source), source);
  }
  assert.equal(warn.mock.callCount(), process.platform === 'darwin' ? 2 : 0);
});

test('accelerated canvas injection supports modern and legacy HTML-in-Canvas APIs', async () => {
  const source = fixCaptureModule(captureUrl.href, await readFile(captureUrl, 'utf8'));
  const inject = source.match(/^async function injectDrawElementCanvas\([^]*?^}/m)![0];
  for (const modern of [false, true]) {
    const root: any = { parentNode: { insertBefore() {} }, attributes: {}, setAttribute(name: string, value: string) { this.attributes[name] = value; } };
    const canvas: any = { attributes: {}, style: {}, appendChild() {}, setAttribute(name: string, value: string) { this.attributes[name] = value; } };
    const context = {
      HTMLCanvasElement: { prototype: modern ? { content: 'drawable' } : {} },
      document: { querySelector: () => root, getElementById: () => null, createElement: (tag: string) => tag === 'canvas' ? canvas : { style: {} } },
      window: {}, getComputedStyle: () => ({ opacity: '1' }),
    };
    await runInNewContext(inject + '\ninjectDrawElementCanvas', context)({ evaluate: (fn: any, args: any) => fn(args) }, 320, 180);
    assert.equal(canvas.attributes.layoutsubtree, '');
    assert.equal(canvas.attributes.content, modern ? 'drawable' : undefined);
    assert.equal(root.attributes.drawable, modern ? '' : undefined);
    assert.equal(canvas.width, 320); assert.equal(canvas.height, 180);
  }
});

test('the pinned classifier treats socket-buffer pressure as transient while preserving content errors and cancellation', async () => {
  assert.equal(JSON.parse(await readFile(new URL('../node_modules/hyperframes/package.json', import.meta.url), 'utf8')).version, HYPERFRAMES_VERSION);
  await import(retryUrl.href);
  for (const message of [bufferError, '[Parallel] Capture failed: Worker 2: ' + bufferError]) {
    const failure = engine.classifyCaptureFailure(new Error(message));
    assert.equal(failure.kind, 'transient_browser');
    assert.equal(engine.isFatalCaptureFailure(failure), false);
    assert.equal(failure.message, message);
    const controller = new AbortController(); controller.abort();
    assert.equal(engine.classifyCaptureFailure(failure, { signal: controller.signal }).kind, 'cancelled');
  }
  for (const [message, kind] of [
    ['No root [data-composition-id]', 'authoring'],
    ['Composition has zero duration; Runtime ready: true', 'authoring'],
    ['Target closed', 'transient_browser'],
    ['Network.enable timed out', 'protocol_timeout'],
    ['JavaScript heap out of memory', 'memory_exhaustion'],
    ['drawElement self-verify failed', 'verification'],
  ]) assert.equal(engine.classifyCaptureFailure(new Error(message)).kind, kind);
});

// Execute the shipped retry loop with controlled capture outcomes, without a browser or resource exhaustion.
function retryFixture(outcomes: { error?: string; remaining: number }[], initialWorkerCount = 6, allowRetry = true) {
  let remaining = 300;
  const workers: number[] = [], warnings: { message: string; detail: any }[] = [];
  const tasks = (_frames: any, count: number) => Array.from({ length: count }, (_, workerId) => ({ workerId }));
  const context = {
    MAX_TRANSIENT_CAPTURE_RETRIES: 1,
    classifyCaptureFailure: engine.classifyCaptureFailure,
    normalizeErrorMessage: (error: Error) => error.message,
    RenderStageStalledError: class extends Error {},
    isDrawElementVerificationError: () => false,
    isDrawElementCaptureError: () => false,
    join26: path.join,
    countCapturedFrames: () => 300 - remaining,
    findMissingFrameRanges: () => remaining ? [{ startFrame: 300 - remaining, endFrame: 300 }] : [],
    countFrameRanges: (ranges: any[]) => ranges.reduce((sum, range) => sum + range.endFrame - range.startFrame, 0),
    distributeFrames: tasks,
    distributeFramesInterleaved: tasks,
    buildMissingFrameRetryBatches: (_ranges: any, count: number) => [tasks(remaining, count)],
    mergeWorkerFrames: async () => {},
    pushWorkerDedupPerfs: () => {},
    executeParallelCapture: async (_url: any, _dir: any, batch: any[]) => {
      const outcome = outcomes[workers.length];
      assert.ok(outcome, 'Capture must stop at its retry limit');
      workers.push(batch.length);
      remaining = outcome.remaining;
      if (outcome.error) throw engine.classifyCaptureFailure(new Error(outcome.error));
      return [];
    },
  };
  const functions = ['getNextRetryWorkerCount', 'isTransientCaptureRetryEligible', 'captureAttemptMadeProgress',
    'isRecoverableParallelCaptureError', 'executeDiskCaptureWithAdaptiveRetry'];
  const source = functions.map(name => {
    const match = retrySource.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
    assert.ok(match, 'Pinned retry function is missing: ' + name);
    return match[0];
  }).join('\n');
  const run = runInNewContext(source + '\nexecuteDiskCaptureWithAdaptiveRetry', context);
  return {
    workers, warnings,
    run: () => run({ totalFrames: 300, initialWorkerCount, allowRetry, workDir: 'capture-fixture',
      framesDir: 'frames', frameExt: 'png', dedupPerfs: [],
      log: { warn: (message: string, detail: any) => warnings.push({ message, detail }) } }),
  };
}

test('a zero-progress buffer failure retries the same capture at half concurrency and succeeds', async () => {
  const f = retryFixture([{ error: bufferError, remaining: 300 }, { remaining: 0 }]);
  const attempts = await f.run();
  assert.deepEqual(f.workers, [6, 3]);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].reason, 'transient-retry');
  assert.match(f.warnings[0].message, /Socket buffers unavailable/);
  assert.equal(f.warnings[0].detail.nextWorkers, 3);
  assert.ok(f.warnings.every(w => !w.message.includes('structurally broken')));
});

test('persistent buffer failures stop after one retry even when both attempts make partial progress', async () => {
  for (const workers of [6, 2, 1]) {
    const f = retryFixture([{ error: bufferError, remaining: 290 }, { error: bufferError, remaining: 280 }], workers);
    await assert.rejects(f.run(), error => {
      assert.equal(error.kind, 'transient_browser');
      assert.equal(error.message, bufferError);
      return true;
    });
    assert.deepEqual(f.workers, [workers, Math.max(1, Math.floor(workers / 2))]);
    assert.match(f.warnings.at(-1)!.message, /Close unused applications.*retry the export.*--workers 1/);
  }
});

test('content failures, cancellation and disabled retries do not launch another capture', async () => {
  for (const [error, kind, allowRetry] of [
    ['No root [data-composition-id]', 'authoring', true],
    ['capture_cancelled', 'cancelled', true],
    [bufferError, 'transient_browser', false],
  ] as const) {
    const f = retryFixture([{ error, remaining: 300 }], 6, allowRetry);
    await assert.rejects(f.run(), failure => failure.kind === kind);
    assert.deepEqual(f.workers, [6]);
    assert.ok(f.warnings.every(w => !w.message.includes('structurally broken')));
  }
});

test('other transient browser failures retain the existing fresh-session recovery', async () => {
  const f = retryFixture([{ error: 'Target closed', remaining: 300 }, { remaining: 0 }]);
  await f.run();
  assert.deepEqual(f.workers, [6, 6]);
});

test('single-worker disk capture also retries initialization buffer failures once with a fresh session', async () => {
  for (const errors of [[bufferError, undefined], [bufferError, bufferError], ['No root [data-composition-id]']]) {
    let opened = 0, remaining = 300;
    const closed: number[] = [];
    const context = {
      MAX_TRANSIENT_CAPTURE_RETRIES: 1,
      classifyCaptureFailure: engine.classifyCaptureFailure,
      findMissingFrameRanges: () => remaining ? [{ startFrame: 0, endFrame: remaining }] : [],
      frameFileExtension: () => 'png',
      createCaptureSession: async () => ({ id: opened++, options: {}, browserConsoleBuffer: [] }),
      ensureSessionReady: async (session: any) => { if (errors[session.id]) throw new Error(errors[session.id]); },
      captureSessionFrames: async () => { remaining = 0; },
      closeCaptureSession: async (session: any) => { closed.push(session.id); },
      wrapCaptureStageError: (error: Error) => error,
    };
    const functions = ['isTransientCaptureRetryEligible', 'resolveCaptureRange', 'planTransientResume', 'runSequentialDiskCapture'];
    const source = functions.map(name => {
      const match = retrySource.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
      assert.ok(match, 'Pinned sequential function is missing: ' + name);
      return match[0];
    }).join('\n');
    const run = runInNewContext(source + '\nrunSequentialDiskCapture', context);
    const result = run({ fileServer: { url: 'http://localhost' }, framesDir: 'frames', totalFrames: 300,
      log: { warn() {} }, createRenderVideoFrameInjector() {}, assertNotAborted() {} }, {}, {}, () => {});
    if (errors.at(-1)) await assert.rejects(result, error => error.message === errors.at(-1));
    else await result;
    assert.equal(opened, errors.length);
    assert.deepEqual(closed, errors.map((_, i) => i));
  }
});

test('the compatibility fix leaves unrelated modules alone and rejects changed pinned code', () => {
  assert.equal(fixCaptureModule('file:///project/index.js', originalRetry), originalRetry);
  assert.throws(() => fixCaptureModule(retryUrl.href, originalRetry.replaceAll('transientRetriesUsed++;', 'changed();')), /Unsupported Hyperframes capture code/);
});

test('runtime preload reaches CLI, nested Node processes and render workers without changing installed bundles', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion capture retry '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const originalCapture = await readFile(captureUrl);
  const previousOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = [previousOptions, '--stack-trace-limit=40'].filter(Boolean).join(' ');
  t.after(() => { if (previousOptions === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previousOptions; });
  assert.match(runtimeEnv().NODE_OPTIONS!, /--stack-trace-limit=40/);
  const cli = path.join(root, 'node_modules/hyperframes/bin');
  await mkdir(cli, { recursive: true });
  await writeFile(path.join(cli, 'hyperframes.mjs'), `
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const engine = await import(${JSON.stringify(captureUrl.href)});
await import(${JSON.stringify(retryUrl.href)});
const kind = engine.classifyCaptureFailure(new Error(${JSON.stringify(bufferError)})).kind;
if (!isMainThread) parentPort.postMessage(kind);
else if (process.argv.includes('--child')) console.log(kind);
else {
  const worker = new Worker(new URL(import.meta.url), { execArgv: [] });
  const workerKind = await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  const child = await promisify(execFile)(process.execPath, [fileURLToPath(import.meta.url), '--child']);
  console.log(JSON.stringify({ main: kind, worker: workerKind, child: child.stdout.trim() }));
}
`);
  const result = await runHyperframes(root, root, ['render'], 30_000);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { main: 'transient_browser', worker: 'transient_browser', child: 'transient_browser' });
  assert.deepEqual(await readFile(captureUrl), originalCapture);
  assert.equal(await readFile(retryUrl, 'utf8'), originalRetry);
});
