import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, unlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startWorkspaceStudio } from '../shared/workspace-studio.ts';
import { StudioRenderAttempts } from '../shared/studio-render-attempts.ts';

const require = createRequire(import.meta.url);
const dependencies = path.dirname(path.dirname(require.resolve('hyperframes/package.json')));
const hosts = new Map<string, { states: any[]; beforeStart?: () => Promise<void> }>();
(globalThis as any).__studioRenderTestHosts = hosts;
let sequence = 0;

async function fixture(run: (context: any) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-studio-attempts-'));
  const runtime = path.join(root, 'runtime');
  const data = path.join(root, 'data');
  const project = path.join(data, 'project');
  const cli = path.join(runtime, 'node_modules/hyperframes');
  await mkdir(path.join(cli, 'dist'), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(path.join(project, 'index.html'), '<html><body></body></html>');
  await writeFile(path.join(runtime, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(cli, 'package.json'), '{"name":"hyperframes","version":"0.9.7","type":"module"}');
  for (const name of ['@hono', '@hyperframes', 'hono', 'fontkit']) {
    await symlink(path.join(dependencies, name), path.join(runtime, 'node_modules', name));
  }
  await writeFile(path.join(cli, 'dist/studioServer-fixture.js'), `
    import { Hono } from 'hono';
    import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
    import path from 'node:path';
    export function createStudioServer({projectDir, projectName}) {
      const states = [];
      const host = {states, beforeStart: undefined};
      globalThis.__studioRenderTestHosts.set(projectDir, host);
      const adapter = {
        transformPreviewHtml: async ({html}) => html,
        startRender(options) {
          const state = {id: options.jobId, status: 'rendering', progress: 0,
            outputPath: options.outputPath, options, cancelCalls: 0,
            cancel() { this.cancelCalls++; }};
          states.push(state);
          return state;
        },
        history: async () => undefined,
      };
      const app = new Hono()
        .post('/api/projects/:id/render', async c => {
          const body = await c.req.json();
          const directory = path.join(projectDir, 'renders');
          mkdirSync(directory, {recursive: true});
          const jobId = body.testJobId;
          await host.beforeStart?.();
          const state = adapter.startRender({jobId, outputPath: path.join(directory, jobId + '.mp4'),
            project: {id: projectName, dir: projectDir}, format: 'mp4',
            fps: {num: 30, den: 1}, quality: 'standard', ...body});
          state.createdAt = Date.now();
          return c.json({jobId, status: 'rendering'});
        })
        .get('/api/projects/:id/renders', c => c.json({renders: readdirSync(path.join(projectDir, 'renders')).filter(f => f.endsWith('.mp4')).map(filename => ({
          id: filename.slice(0, -4), filename, createdAt: 1, status: 'complete', progress: 100,
        }))}))
        .post('/api/render/:id/cancel', c => {
          const state = states.find(state => state.id === c.req.param('id'));
          state.status = 'cancelled'; state.cancel(); return c.json({status: state.status});
        })
        .get('/api/render/:id/:action{view|download}', c => {
          const state = states.find(state => state.id === c.req.param('id'));
          if (!state) return c.notFound();
          try { return c.body(readFileSync(state.outputPath)); }
          catch { return c.notFound(); }
        })
        .delete('/api/render/:id', c => c.json({deleted: true}));
      return {app, adapter, watcher: {close() {}}, shutdown: async () => {}};
    }
  `);
  let studio = await startWorkspaceStudio(runtime, data, project, 0);
  const request = async (requestId?: string) => fetch(studio.origin + '/api/projects/project/render', {
      method: 'POST', headers: {Origin: studio.origin, 'Content-Type': 'application/json'},
      body: JSON.stringify({testJobId: 'native-' + ++sequence, requestId}),
    });
  const post = async (requestId?: string) => {
    const response = await request(requestId);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const list = async () => {
    const response = await fetch(studio.origin + '/api/projects/project/renders');
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).renders;
  };
  const cancel = async (jobId: string) => (await fetch(studio.origin + '/api/render/' + jobId + '/cancel?projectId=project', {
    method: 'POST', headers: {Origin: studio.origin},
  })).json();
  try {
    await run({project, post, request, list, cancel, beforeStart: (run: () => Promise<void>) => { hosts.get(project)!.beforeStart = run; }, states: () => hosts.get(project)!.states,
      origin: () => studio.origin,
      restart: async () => { await studio.close(); studio = await startWorkspaceStudio(runtime, data, project, 0); },
    });
  } finally { await studio.close(); hosts.delete(project); await rm(root, {recursive: true, force: true}); }
}

test('refresh reconciles the original native attempt and never classifies a partial video as complete', () => fixture(async ({post, list, states, origin}) => {
  const receipt = await post();
  const state = states()[0];
  await writeFile(state.outputPath, 'partial');
  state.progress = 42;
  state.stage = 'capturing';
  const records = await list();
  assert.equal(records.length, 1);
  assert.equal(records[0].id, receipt.jobId);
  assert.equal(records[0].nativeJobId, receipt.jobId);
  assert.equal(records[0].filename, receipt.filename);
  assert.equal(records[0].status, 'rendering');
  assert.equal(records[0].workerActive, true);
  assert.equal(records[0].progress, 42);
  assert.equal(records[0].fileAvailable, false);
  assert.deepEqual(records[0].settings.fps, {num: 30, den: 1});
  assert.equal((await fetch(origin() + '/api/projects/project/renders/file/' + encodeURIComponent(receipt.filename))).status, 404);
  state.status = 'complete'; state.progress = 100;
  await writeFile(state.outputPath, 'finished');
  assert.equal((await list())[0].status, 'complete');
  assert.equal((await list())[0].fileAvailable, true);
  assert.equal(states().length, 1, 'Status reads must not start another render');
}));

test('cancel remains pending until renderer confirmation and keeps a distinct retry after refresh', () => fixture(async ({post, list, cancel, states, restart}) => {
  const first = await post();
  const firstState = states()[0];
  assert.deepEqual(await cancel(first.jobId), {status: 'cancelling'});
  assert.equal(firstState.cancelCalls, 1);
  assert.equal(firstState.status, 'rendering', 'Only the renderer may confirm cancellation');
  assert.equal((await list())[0].status, 'cancelling');
  firstState.status = 'cancelled';
  const second = await post();
  const secondState = states()[1];
  assert.notEqual(second.filename, first.filename);
  await writeFile(secondState.outputPath, 'second-attempt');
  secondState.status = 'complete'; secondState.progress = 100;
  assert.deepEqual(new Map((await list()).map(record => [record.id, record.status])), new Map([[first.jobId, 'cancelled'], [second.jobId, 'complete']]));
  await restart();
  const records = await list();
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.id === first.jobId).status, 'cancelled');
  assert.equal(records.find(record => record.id === second.jobId).status, 'complete');
}));

test('a lost execution becomes unknown while failed and missing-file completion facts survive restart', () => fixture(async ({post, list, states, restart}) => {
  const running = await post();
  states()[0].progress = 23;
  await restart();
  const failed = await post();
  states()[0].status = 'failed'; states()[0].error = 'Audio validation failed';
  const completed = await post();
  states()[1].status = 'complete'; states()[1].progress = 100;
  await writeFile(states()[1].outputPath, 'original');
  await list();
  await unlink(states()[1].outputPath);
  await restart();
  const records = await list();
  const unknown = records.find(record => record.id === running.jobId);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.workerActive, false, 'A missing worker does not turn its unknown result into an active execution');
  assert.equal(unknown.progress, 23);
  assert.ok(unknown.lastCheckedAt);
  assert.equal(records.find(record => record.id === failed.jobId).error, 'Audio validation failed');
  assert.equal(records.find(record => record.id === failed.jobId).status, 'failed');
  assert.equal(records.find(record => record.id === completed.jobId).status, 'complete');
  assert.equal(records.find(record => record.id === completed.jobId).fileAvailable, false);
  const next = await post();
  assert.notEqual(next.filename, completed.filename, 'A deleted output must not let a later attempt replace a historical result');
  const recovered = await list();
  assert.equal(recovered.find(record => record.id === running.jobId).status, 'unknown');
  assert.equal(recovered.find(record => record.id === running.jobId).workerActive, false);
  assert.equal(recovered.find(record => record.id === next.jobId).workerActive, true);
}));

test('a disconnected progress stream does not lose the worker result or submit more work', () => fixture(async ({project, post, list, states, origin, restart}) => {
  const receipt = await post('receipt-lost-request');
  const controller = new AbortController();
  const response = await fetch(origin() + '/api/render/' + receipt.jobId + '/progress?projectId=project', {signal: controller.signal});
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"status":"rendering"/);
  controller.abort();
  await reader.cancel().catch(() => {});
  assert.equal((await list())[0].workerActive, true, 'Disconnecting observation must not unlock a live worker');
  const state = states()[0];
  await writeFile(state.outputPath, 'completed-without-stream');
  state.status = 'complete'; state.progress = 100;
  const snapshot = path.join(project, 'renders/.openmotion-render-attempts.json');
  const deadline = Date.now() + 3000;
  while (JSON.parse(await readFile(snapshot, 'utf8')).attempts[0].status !== 'complete') {
    assert.ok(Date.now() < deadline, 'The terminal fact must persist independently of progress connections');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(states().length, 1);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(snapshot, 'utf8')).attempts[0], 'workerActive'), false, 'Activity is derived, never retained as a stale snapshot fact');
  await restart();
  const records = await list();
  assert.equal(records[0].id, receipt.jobId);
  assert.equal(records[0].requestId, 'receipt-lost-request');
  assert.equal(records[0].status, 'complete');
  assert.equal(records[0].fileAvailable, true);
}));

test('concurrent render submissions accept one worker and return a definite busy refusal for the other', () => fixture(async ({request, list, states, beforeStart}) => {
  await list();
  let entered = 0, release!: () => void;
  const bothEntered = new Promise<void>(resolve => { release = resolve; });
  beforeStart(async () => {
    if (++entered === 2) release();
    await bothEntered;
  });
  const responses = await Promise.all([request('race-first'), request('race-second')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const refusal = await responses.find(response => response.status === 409)!.json();
  assert.equal(refusal.code, 'EXPORT_BUSY');
  assert.equal(refusal.applied, false);
  assert.equal(states().length, 1);
  const records = await list();
  assert.equal(records.length, 1, 'The rejected submission must not reserve a filename or create an accepted attempt');
  assert.equal(records[0].workerActive, true);
}));

test('a pending cancellation stays busy until the renderer confirms it stopped', () => fixture(async ({post, request, cancel, list, states}) => {
  const first = await post();
  const activeRefusal = await request();
  assert.equal(activeRefusal.status, 409);
  assert.equal((await activeRefusal.json()).code, 'EXPORT_BUSY');
  await cancel(first.jobId);
  const cancellingRefusal = await request();
  assert.equal(cancellingRefusal.status, 409);
  assert.equal((await cancellingRefusal.json()).applied, false);
  assert.equal(states().length, 1);
  assert.equal((await list())[0].workerActive, true);
  states()[0].status = 'cancelled';
  await post();
  assert.equal(states().length, 2);
}));

test('cancelled SSE waits for confirmation and completion wins either cancellation race', () => fixture(async ({post, cancel, states, list, origin}) => {
  const pending = await post();
  await cancel(pending.jobId);
  const response = await fetch(origin() + '/api/render/' + pending.jobId + '/progress?projectId=project');
  states()[0].status = 'cancelled';
  const events = await response.text();
  assert.match(events, /"status":"cancelling"/);
  assert.match(events, /"status":"cancelled"/);
  const completing = await post();
  await cancel(completing.jobId);
  await writeFile(states()[1].outputPath, 'won-cancel-race');
  states()[1].status = 'complete'; states()[1].progress = 100;
  assert.deepEqual(await cancel(completing.jobId), {status: 'complete'});
  assert.equal((await list()).find(record => record.id === completing.jobId).fileAvailable, true);
  assert.equal(states()[1].cancelCalls, 1);
  const alreadyComplete = await post();
  await writeFile(states()[2].outputPath, 'already-complete');
  states()[2].status = 'complete';
  assert.deepEqual(await cancel(alreadyComplete.jobId), {status: 'complete'});
  assert.equal(states()[2].cancelCalls, 0);
}));

test('history files remain bound to the original attempt for HEAD, viewing, downloading and deletion', () => fixture(async ({post, list, states, origin, restart}) => {
  const first = await post();
  await writeFile(states()[0].outputPath, 'first-bytes');
  states()[0].status = 'complete';
  await list();
  const second = await post();
  await writeFile(states()[1].outputPath, 'second-bytes');
  states()[1].status = 'complete';
  await list();
  await restart();
  for (const [receipt, bytes] of [[first, 'first-bytes'], [second, 'second-bytes']]) {
    const file = origin() + '/api/projects/project/renders/file/' + encodeURIComponent(receipt.filename);
    assert.equal((await fetch(file, {method: 'HEAD'})).status, 200);
    assert.equal(await (await fetch(file)).text(), bytes);
    assert.equal((await fetch(origin() + '/api/render/' + receipt.jobId + '/view?projectId=project', {method: 'HEAD'})).status, 200);
    assert.equal(await (await fetch(origin() + '/api/render/' + receipt.jobId + '/view?projectId=project')).text(), bytes);
    const download = await fetch(origin() + '/api/render/' + receipt.jobId + '/download?projectId=project');
    assert.equal(await download.text(), bytes);
    assert.match(download.headers.get('Content-Disposition')!, /^attachment;/);
  }
  const deleteResponse = await fetch(origin() + '/api/render/' + first.jobId + '?projectId=project', {
    method: 'DELETE', headers: {Origin: origin()},
  });
  assert.equal(deleteResponse.status, 200);
  assert.equal((await list()).length, 1);
  assert.equal((await fetch(origin() + '/api/projects/project/renders/file/' + encodeURIComponent(first.filename), {method: 'HEAD'})).status, 404);
  assert.equal(await (await fetch(origin() + '/api/projects/project/renders/file/' + encodeURIComponent(second.filename))).text(), 'second-bytes');
}));

test('a replaced or symlinked output cannot impersonate a completed historical file', () => fixture(async ({project, post, list, states, origin}) => {
  const receipt = await post();
  const outputPath = states()[0].outputPath;
  await writeFile(outputPath, 'original');
  states()[0].status = 'complete';
  await list();
  await writeFile(outputPath, 'modified-original');
  assert.equal((await list())[0].fileAvailable, false, 'In-place changes are not the original result either');
  await rename(outputPath, path.join(project, 'original.mp4'));
  await writeFile(outputPath, 'replacement');
  assert.equal((await list())[0].status, 'complete');
  assert.equal((await list())[0].fileAvailable, false);
  const file = origin() + '/api/projects/project/renders/file/' + encodeURIComponent(receipt.filename);
  assert.equal((await fetch(file, {method: 'HEAD'})).status, 404);
  await unlink(outputPath);
  await symlink(path.join(project, 'original.mp4'), outputPath);
  assert.equal((await fetch(file)).status, 404);
}));

test('legacy history retains ids while empty or failed metadata cannot claim a complete video', () => fixture(async ({project, post, list, states, origin}) => {
  const renders = path.join(project, 'renders');
  await mkdir(renders);
  await writeFile(path.join(renders, 'legacy.mp4'), 'legacy-output');
  await writeFile(path.join(renders, 'reserved.mp4'), 'partial-output');
  await writeFile(path.join(renders, 'reserved.meta.json'), '{}');
  await writeFile(path.join(renders, 'failed.mp4'), 'failed-partial-output');
  await writeFile(path.join(renders, 'failed.meta.json'), '{"status":"failed"}');
  await symlink(path.join(renders, 'legacy.mp4'), path.join(renders, 'linked.mp4'));
  const records = await list();
  assert.equal(records.length, 3);
  assert.equal(records.find(record => record.id === 'legacy').status, 'complete');
  assert.equal(records.find(record => record.id === 'reserved').status, 'unknown');
  assert.equal(records.find(record => record.id === 'reserved').workerActive, false);
  assert.equal(records.find(record => record.id === 'failed').status, 'failed');
  assert.equal(await (await fetch(origin() + '/api/render/legacy/download?projectId=project')).text(), 'legacy-output');
  assert.equal((await fetch(origin() + '/api/projects/project/renders/file/reserved.mp4', {method: 'HEAD'})).status, 404);
  assert.equal((await fetch(origin() + '/api/projects/project/renders/file/linked.mp4')).status, 404);
  const next = await post();
  assert.equal(states().length, 1, 'A legacy unknown without a worker must not permanently block a new export');
  const after = await list();
  assert.equal(after.find(record => record.id === 'reserved').status, 'unknown');
  assert.equal(after.find(record => record.id === next.jobId).workerActive, true);
}));

test('existing request-origin and project-scope protections also cover attempt recovery and cancel', () => fixture(async ({post, origin}) => {
  const receipt = await post();
  const route = origin() + '/api/render/' + receipt.jobId + '/cancel?projectId=project';
  assert.equal((await fetch(route, {method: 'POST'})).status, 403);
  assert.equal((await fetch(origin() + '/api/projects/project/renders?projectId=00000000-0000-0000-0000-000000000000')).status, 400);
  assert.equal((await fetch(origin() + '/api/projects/00000000-0000-0000-0000-000000000000/renders')).status, 404);
}));

test('deleting an unknown recovered attempt preserves its partial output, metadata and persisted record', () => fixture(async ({project, post, list, states, origin, restart}) => {
  const receipt = await post();
  const outputPath = states()[0].outputPath;
  const metadata = path.join(path.dirname(outputPath), path.parse(outputPath).name + '.meta.json');
  await writeFile(outputPath, 'unfinished-output');
  states()[0].progress = 31;
  await restart();
  assert.equal((await list())[0].status, 'unknown');
  const response = await fetch(origin() + '/api/render/' + receipt.jobId + '?projectId=project', {
    method: 'DELETE', headers: {Origin: origin()},
  });
  assert.equal(response.status, 409);
  assert.equal(await readFile(outputPath, 'utf8'), 'unfinished-output');
  assert.equal(await readFile(metadata, 'utf8'), '{}');
  assert.equal((await list())[0].status, 'unknown');
  const snapshot = JSON.parse(await readFile(path.join(project, 'renders/.openmotion-render-attempts.json'), 'utf8'));
  assert.equal(snapshot.attempts[0].id, receipt.jobId);
  assert.equal(snapshot.attempts[0].status, 'unknown');
}));

test('deleting legacy unknown history is rejected before native deletion can remove the scene', () => fixture(async ({project, list, origin}) => {
  const renders = path.join(project, 'renders');
  await mkdir(renders);
  const output = path.join(renders, 'legacy-pending.mp4');
  const metadata = path.join(renders, 'legacy-pending.meta.json');
  await writeFile(output, 'legacy-partial');
  await writeFile(metadata, '{}');
  assert.equal((await list())[0].status, 'unknown');
  const response = await fetch(origin() + '/api/render/legacy-pending?projectId=project', {
    method: 'DELETE', headers: {Origin: origin()},
  });
  assert.equal(response.status, 409);
  assert.equal(await readFile(output, 'utf8'), 'legacy-partial');
  assert.equal(await readFile(metadata, 'utf8'), '{}');
  assert.equal((await list())[0].status, 'unknown');
}));

test('a deleted native job cannot read a later attempt that legitimately reuses its filename', () => fixture(async ({post, list, states, origin}) => {
  const first = await post();
  await writeFile(states()[0].outputPath, 'first-result');
  states()[0].status = 'complete';
  await list();
  const removed = await fetch(origin() + '/api/render/' + first.jobId + '?projectId=project', {
    method: 'DELETE', headers: {Origin: origin()},
  });
  assert.equal(removed.status, 200);
  const second = await post();
  assert.equal(second.filename, first.filename, 'Explicit deletion may release the output name');
  await writeFile(states()[1].outputPath, 'second-result');
  states()[1].status = 'complete';
  await list();
  for (const action of ['view', 'download']) {
    const oldUrl = origin() + '/api/render/' + first.jobId + '/' + action + '?projectId=project';
    assert.equal((await fetch(oldUrl)).status, 404);
    assert.equal((await fetch(oldUrl, {method: 'HEAD'})).status, 404);
    const newUrl = origin() + '/api/render/' + second.jobId + '/' + action + '?projectId=project';
    assert.equal(await (await fetch(newUrl)).text(), 'second-result');
    assert.equal((await fetch(newUrl, {method: 'HEAD'})).status, 200);
  }
}));

test('a failed cancellation save can be retried after storage recovers and calls the renderer once', async t => {
  const project = await mkdtemp(path.join(tmpdir(), 'motion-cancel-save-'));
  t.mock.method(Date, 'now', () => 1000);
  const attempts = new StudioRenderAttempts(project);
  const state = {status: 'rendering', progress: 0, cancelCalls: 0, cancel() { this.cancelCalls++; }};
  const id = 'native-cancel-save-failure';
  attempts.start({jobId: id, outputPath: path.join(project, 'renders/native.mp4')}, 'Export', () => state);
  const snapshot = path.join(project, 'renders/.openmotion-render-attempts.json');
  const original = await readFile(snapshot);
  try {
    // Keep reads valid while making the cancellation transition's save fail.
    await unlink(snapshot);
    await mkdir(snapshot);
    assert.throws(() => attempts.cancel(id), /Invalid Studio render attempts file/);
    assert.equal(state.cancelCalls, 0, 'No cancellation was sent before the durable transition');
    await rm(snapshot, {recursive: true});
    await writeFile(snapshot, original);
    assert.equal(attempts.get(id)!.status, 'rendering', 'The failed save must roll back the pending cancellation');
    assert.equal(attempts.cancel(id)!.status, 'cancelling');
    assert.equal(state.cancelCalls, 1);
    assert.equal(attempts.cancel(id)!.status, 'cancelling');
    assert.equal(state.cancelCalls, 1, 'An accepted cancellation must not send another abort');
  } finally {
    await rm(snapshot, {recursive: true, force: true});
    await writeFile(snapshot, original);
    attempts.close();
    await rm(project, {recursive: true, force: true});
  }
});
