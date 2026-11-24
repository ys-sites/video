import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { providerAdapters } from '../gateway/providers.ts';
import { resumableJob, type GenerationJob, type Model } from '../shared/gateway.ts';
import { mediaBytes } from './media-fixtures.ts';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot, execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { Fetcher } from '../gateway/network.ts';

const mp4 = await mediaBytes('video');
const audio = await mediaBytes('audio');
const catalogue = [
  { model: 'edit-image', kind: 'image', capabilities: { edits: true, max_input_images: 2, quality: { values: ['low', 'high'], default: 'low' } } },
  { model: 'one-ref', kind: 'image', capabilities: { edits: true, max_input_images: 1 } },
  { model: 'gen-only', kind: 'image', capabilities: {} },
  { model: 'i2v', kind: 'video', capabilities: { max_input_images: 1, durations: { values: [5, 10], default: 5 } } },
  { model: 't2v-only', kind: 'video', capabilities: {} },
  { model: 'wide-edit', kind: 'image', capabilities: { edits: true, max_input_images: 20 } },
  { model: 'multi-input-video', kind: 'video', capabilities: { max_input_images: 2 } },
  ...['wan-2.7', 'doubao-seedance-2-5-260628'].map(model => ({ model, kind: 'video', capabilities: { max_input_images: 1, ratios: { values: ['16:9', 'adaptive'], default: '16:9' } } })),
];
function service(store: any) { return new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} }); }
async function finish(store: any, id: string) { const g = gatewayFor(store); await g.tick(); await Promise.all([...g.active.values()].map(task => task.done)); return g.getJob(id); }
async function image(dir: string, name: string, color: string) {
  const file = path.join(dir, name);
  const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24`, '-frames:v', '1', '-y', file], dir, 20_000);
  assert.equal(result.code, 0, result.stderr); return file;
}
async function libraryRef(store: any, name: string, color: string) {
  const asset = await new AssetLibrary(store).importFile(await image(store.directory, name, color), { requestId: name.replace(/\W/g, '-'), name });
  return { assetId: asset.id, versionId: asset.currentVersionId };
}

/** Records Cloud calls; uploads return ma_<n>, storage PUTs must not carry credentials. */
function cloud(gateway: any, onSubmit: (pathname: string, body: any) => void, task: Record<string, unknown> = {}, putStatus = 200) {
  const calls: string[] = []; let uploads = 0;
  gateway.options.fetcher = (async (url, init = {}) => {
    const target = new URL(String(url)), method = init.method ?? 'GET';
    calls.push(`${method} ${target.host === 'bucket.example' ? 'bucket' : target.pathname}`);
    if (target.host === 'bucket.example') {
      assert.equal(method, 'PUT'); assert.equal(new Headers(init.headers).get('Authorization'), null);
      assert.equal(new Headers(init.headers).get('Content-Type'), 'image/png');
      assert.equal(Number(new Headers(init.headers).get('Content-Length')), (init.body as Buffer).length);
      return new Response(null, { status: putStatus });
    }
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer cloud-key');
    if (target.pathname.endsWith('/models')) return Response.json({ models: catalogue });
    if (target.pathname.endsWith('/uploads')) return Response.json({ asset_id: `ma_${uploads}`, upload_url: `https://bucket.example/put/${uploads++}` }, { status: 201 });
    if (target.pathname.endsWith('/commit')) return Response.json({ status: 'ready' });
    if (method === 'POST') { onSubmit(target.pathname, JSON.parse(String(init.body))); return Response.json({ task_id: 'cloud-task' }, { status: 202 }); }
    if (target.pathname.endsWith('/content')) return new Response(mp4);
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }], ...task });
  }) as Fetcher;
  return calls;
}

test('Cloud discovery exposes edit references, first-frame input and native options', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  cloud(gateway, () => assert.fail('discovery must not submit'));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const models = (await gateway.listModels({ provider: 'opendesign', refresh: true })).models;
  const pick = (id: string) => models.find(m => m.modelId === id)!;
  assert.deepEqual([pick('edit-image').supportsImageReference, pick('edit-image').maxInputImages], [true, 2]);
  assert.deepEqual((pick('edit-image').nativeOptions as any).quality.values, ['low', 'high']);
  assert.equal(pick('gen-only').supportsImageReference, undefined);
  assert.deepEqual([pick('i2v').supportsImageReference, pick('i2v').maxInputImages], [undefined, 1]);
  assert.equal(pick('t2v-only').maxInputImages, undefined);
  await gateway.close();
}));

test('Cloud image editing uploads every library reference and submits their asset IDs to /images/edits', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => (await import('node:fs/promises')).readFile(await image(store.directory, 'out.png', 'green'));
  const submits: [string, any][] = [];
  const calls = cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
  const job = await finish(store, (await gateway.submit({ library: { references: [a, b] }, model: 'opendesign:edit-image', modality: 'image', prompt: 'make the plate red', parameters: { quality: 'low', ratio: '16:9' } })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/images/edits', { quality: 'low', ratio: '16:9', model: 'edit-image', prompt: 'make the plate red', images: ['ma_0', 'ma_1'] }]]);
  assert.deepEqual(calls.filter(c => !c.includes('/models') && !c.includes('/tasks/')), ['POST /api/v1/media/uploads', 'PUT bucket', 'POST /api/v1/media/uploads/ma_0/commit',
    'POST /api/v1/media/uploads', 'PUT bucket', 'POST /api/v1/media/uploads/ma_1/commit', 'POST /api/v1/media/images/edits']);
  assert.deepEqual(job.references!.map(r => r.path), [`asset:${a.assetId}/${a.versionId}`, `asset:${b.assetId}/${b.versionId}`]);
  assert.equal(job.reference!.path, job.references![0].path);
  await gateway.close();
}));

test('OpenDesign image guards: Seedream 5.5 takes one reference, GPT Image 2.6 forwards a transparent background, references stay within 2 MiB', () => fixture(async store => {
  const added = [
    { model: 'gpt-image-2.6-sunburst', kind: 'image', capabilities: { edits: true, max_input_images: 16, quality: { values: ['low', 'medium', 'high'], default: 'low' } } },
    // A catalogue that overstates the limit still meets the measured cap of one.
    { model: 'seedream-5.5', kind: 'image', capabilities: { edits: true, max_input_images: 4 } },
  ];
  catalogue.push(...added);
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  try {
    gateway.options.download = async () => readFile(await image(store.directory, 'out.png', 'green'));
    const submits: [string, any][] = [];
    cloud(gateway, (p, body) => submits.push([p, body]));
    await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
    const models = (await gateway.listModels({ provider: 'opendesign', refresh: true })).models;
    const seedream = models.find(m => m.modelId === 'seedream-5.5')!, sunburst = models.find(m => m.modelId === 'gpt-image-2.6-sunburst')!;
    assert.deepEqual(seedream.generationOptions?.fields.map(f => [f.key, f.choices?.map(c => c.value)]), [['size', ['1K', '2K']]]);
    assert.deepEqual(sunburst.generationOptions?.fields.map(f => [f.key, f.choices?.map(c => c.value)]), [['quality', ['low', 'medium', 'high']], ['background', ['transparent']]]);
    const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
    await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: seedream.id, modality: 'image', prompt: 'merge', parameters: {} }), /at most 1 input image\b/);
    const job = await finish(store, (await gateway.submit({ library: { references: [a] }, model: sunburst.id, modality: 'image', prompt: 'cut out', parameters: { quality: 'medium', background: 'transparent' } })).id);
    assert.equal(job.state, 'completed', job.error);
    assert.deepEqual(submits, [['/api/v1/media/images/edits', { quality: 'medium', background: 'transparent', model: 'gpt-image-2.6-sunburst', prompt: 'cut out', images: ['ma_0'] }]]);
    const noisy = path.join(store.directory, 'noisy.png');
    const made = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'nullsrc=s=1200x1200,geq=random(1)*255:random(2)*255:random(3)*255', '-frames:v', '1', '-y', noisy], store.directory, 20_000);
    assert.equal(made.code, 0, made.stderr);
    assert.ok((await readFile(noisy)).length > 2 * 1024 * 1024);
    const large = await new AssetLibrary(store).importFile(noisy, { requestId: 'noisy', name: 'noisy.png' });
    await assert.rejects(gateway.submit({ library: { references: [{ assetId: large.id, versionId: large.currentVersionId }] }, model: sunburst.id, modality: 'image', prompt: 'cut out', parameters: {} }), /larger than the 2 MiB OpenDesign upload limit/);
    assert.equal(submits.length, 1);
  } finally {
    catalogue.splice(catalogue.length - added.length, added.length);
    await gateway.close();
  }
}));
test('reference counts follow each model: the published maximum, no edits, no video input image', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submitted = 0; cloud(gateway, () => submitted++);
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
  await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: 'opendesign:one-ref', modality: 'image', prompt: 'x' }), /at most 1 input image$/);
  await assert.rejects(gateway.submit({ library: { references: [a] }, model: 'opendesign:gen-only', modality: 'image', prompt: 'x' }), /capability is unknown/);
  await assert.rejects(gateway.submit({ library: { references: [a] }, model: 'opendesign:t2v-only', modality: 'video', prompt: 'x' }), /does not accept an input image/);
  await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: 'opendesign:i2v', modality: 'video', prompt: 'x' }), /at most 1 input image$/);
  assert.equal(submitted, 0);
  await gateway.close();
}));

test('Cloud image-to-video uploads the first frame and keeps the video timeout above fifteen minutes', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'frame.png', 'red');
  const job = await finish(store, (await gateway.submit({ library: { references: [a] }, model: 'opendesign:i2v', modality: 'video', prompt: 'slow push in', parameters: { duration: 5 } })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/videos/tasks', { duration: 5, model: 'i2v', prompt: 'slow push in', images: [{ asset_id: 'ma_0', role: 'first_frame' }] }]]);
  const source = await (await import('node:fs/promises')).readFile(new URL('../gateway/service.ts', import.meta.url), 'utf8');
  assert.match(source, /job\.modality === 'video' \? 30 : 15\) \* 60_000/);
  await gateway.close();
}));

test('Cloud rejects explicit first-frame ratios through MCP before reference resolution or provider requests', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const calls = cloud(gateway, () => assert.fail('invalid first-frame ratio must not submit'));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true }); calls.length = 0;
  // These references do not exist: ratio validation must fail before opening them.
  const references = [{ assetId: randomUUID(), versionId: randomUUID() }];
  for (const modelId of ['wan-2.7', 'doubao-seedance-2-5-260628']) {
    await assert.rejects(api.call('openmotion_assets_use', { action: 'generate', requestId: `bad-ratio-${modelId.replaceAll('.', '-')}`, model: `opendesign:${modelId}`,
      modality: 'video', prompt: 'slow push', references, parameters: { ratio: '16:9' } }), /First-frame video.*Remove parameters.ratio.*adaptive/);
    await assert.rejects(gateway.submit({ library: {}, model: `opendesign:${modelId}`, modality: 'video', prompt: 'hosted first frame',
      parameters: { ratio: '16:9', images: [{ asset_id: 'ma_existing', role: 'first_frame' }] } }), /First-frame video/);
  }
  assert.deepEqual(calls, []); assert.equal((await gateway.listJobs()).length, 0);
  await gateway.close();
}));

test('Cloud first-frame video accepts omitted or adaptive ratios despite saved text-to-video defaults', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const ref = await libraryRef(store, 'first-frame.png', 'red');
  for (const modelId of ['wan-2.7', 'doubao-seedance-2-5-260628']) {
    await gateway.registerModel({ provider: 'opendesign', modelId, label: modelId, modality: 'video', mode: 'text-to-video', defaults: { ratio: '16:9', duration: 5 } });
    for (const ratio of [undefined, 'adaptive']) {
      const parameters = ratio ? { ratio } : {};
      const input = { action: 'generate', requestId: `${modelId.replaceAll('.', '-')}-${ratio ?? 'omitted'}`, model: `opendesign:${modelId}`, modality: 'video', prompt: 'slow push', references: [ref], parameters };
      const queued = (await api.call('openmotion_assets_use', input)).job;
      const completed = await finish(store, queued.id);
      assert.equal(completed.state, 'completed', completed.error);
      assert.deepEqual(submits.at(-1), ['/api/v1/media/videos/tasks', { duration: 5, ...parameters, model: modelId, prompt: 'slow push', images: [{ asset_id: `ma_${submits.filter(([, body]) => body.images).length - 1}`, role: 'first_frame' }] }]);
      assert.equal((await api.call('openmotion_assets_use', input)).job.id, queued.id);
      assert.equal(completed.model.defaults?.ratio, '16:9');
    }
    const textOnly = await finish(store, (await gateway.submit({ library: {}, model: `opendesign:${modelId}`, modality: 'video', prompt: 'text only' })).id);
    assert.equal(textOnly.state, 'completed', textOnly.error);
    assert.deepEqual(submits.at(-1), ['/api/v1/media/videos/tasks', { ratio: '16:9', duration: 5, model: modelId, prompt: 'text only' }]);
  }
  assert.equal(submits.length, 6);
  await gateway.close();
}));

test('Cloud adapter protects queued and raw first-frame requests before reading or uploading a reference', async () => {
  const model: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live' };
  const job = { id: 'queued-before-upgrade', model, modality: 'video', prompt: 'slow push', parameters: { ratio: '16:9' } } as GenerationJob;
  let calls = 0;
  const context = { key: 'fixture-only', baseUrl: 'https://cloud.example', signal: new AbortController().signal, progress: async () => {},
    fetcher: async () => { calls++; throw new Error('unexpected network request'); } };
  await assert.rejects(providerAdapters.opendesign.generate(job, { ...context, references: [{ file: '/missing-first-frame.png', mimeType: 'image/png', bytes: 10 }] }), /First-frame video/);
  await assert.rejects(providerAdapters.opendesign.generate({ ...job, parameters: { ...job.parameters, images: [{ asset_id: 'ma_existing', role: 'first_frame' }] } }, context), /First-frame video/);
  assert.equal(calls, 0);
});

test('Cloud polling of an accepted first-frame task ignores new submission validation and never uploads or resubmits', async () => {
  const model: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live' };
  const job = { id: 'accepted-before-upgrade', remoteId: 'accepted-task', model, modality: 'video', prompt: 'slow push', parameters: { ratio: '16:9' } } as GenerationJob;
  const calls: string[] = [];
  const result = await providerAdapters.opendesign.generate(job, {
    key: 'fixture-only', baseUrl: 'https://cloud.example', signal: new AbortController().signal, progress: async () => {}, pollMs: 0,
    references: [{ file: '/missing-first-frame.png', mimeType: 'image/png', bytes: 10 }],
    fetcher: async (url, init = {}) => {
      const pathname = new URL(String(url)).pathname; calls.push(`${init.method ?? 'GET'} ${pathname}`);
      assert.equal(init.method ?? 'GET', 'GET');
      return pathname.endsWith('/content') ? new Response(mp4) : Response.json({ status: 'succeeded' });
    },
  });
  assert.deepEqual(result, [mp4]);
  assert.deepEqual(calls, ['GET /api/v1/media/videos/tasks/accepted-task', 'GET /api/v1/media/videos/tasks/accepted-task/content']);
});

test('Cloud speech timestamps stay on the job and reach the MCP status result', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => audio;
  const alignment = { characters: ['你', '好'], character_start_times_seconds: [0, 0.2], character_end_times_seconds: [0.2, 0.4] };
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]), { result: { alignment } });
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const queued = await api.call('openmotion_media_use', { action: 'generate', provider: 'opendesign', projectId: store.projectId, requestId: 'speech-ts', model: 'elevenlabs-v3',
    modality: 'audio', mode: 'text-to-speech', prompt: '你好', parameters: { voice: 'voice-1', voice_settings: { speed: 1.1 } } });
  const job = await finish(store, queued.job.id); assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits, [['/api/v1/media/audio/speech', { model: 'elevenlabs-v3', voice: 'voice-1', parameters: { voice_settings: { speed: 1.1 }, text: '你好' } }]]);
  const status = await api.call('openmotion_media_use', { action: 'status', projectId: store.projectId, jobId: job.id });
  assert.deepEqual(status.job.result, { alignment });
  await gateway.close();
}));

test('a dropped Cloud poll or download connection is retried instead of discarding a paid result', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let polls = 0, downloads = 0, posts = 0;
  gateway.options.download = async () => { if (++downloads === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }); return audio; };
  gateway.options.fetcher = (async (url, init = {}) => {
    if (init.method === 'POST') { posts++; return Response.json({ task_id: 'cloud-task' }, { status: 202 }); }
    if (++polls === 1) throw new Error('socket hang up');
    if (polls === 2) return new Response('busy', { status: 503 });
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: 'calm piano' })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual([posts, polls, downloads], [1, 3, 2]);
  await gateway.close();
}));

test('a rejected Cloud poll is not retried', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let polls = 0;
  gateway.options.fetcher = (async (_url, init = {}) => {
    if (init.method === 'POST') return Response.json({ task_id: 'cloud-task' }, { status: 202 });
    polls++; return new Response('nope', { status: 401 });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: 'calm piano' })).id);
  assert.equal(job.state, 'failed'); assert.match(job.error!, /401/); assert.equal(polls, 1);
  await gateway.close();
}));

test('video input stays at one first frame even when the provider advertises more', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submitted = 0; cloud(gateway, () => submitted++);
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const video = (await gateway.listModels({ provider: 'opendesign', refresh: true })).models.find(m => m.modelId === 'multi-input-video')!;
  assert.deepEqual([video.maxInputImages, (video.nativeOptions as any).max_input_images], [1, 2]);
  const a = await libraryRef(store, 'a.png', 'red'), b = await libraryRef(store, 'b.png', 'blue');
  await assert.rejects(gateway.submit({ library: { references: [a, b] }, model: 'opendesign:multi-input-video', modality: 'video', prompt: 'x' }), /at most 1 input image$/);
  assert.equal(submitted, 0);
  await gateway.close();
}));

test('more than eight references reach a model that publishes a larger maximum', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => (await import('node:fs/promises')).readFile(await image(store.directory, 'out.png', 'green'));
  const submits: [string, any][] = []; cloud(gateway, (p, body) => submits.push([p, body]));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const colors = ['red', 'blue', 'green', 'yellow', 'white', 'black', 'gray', 'orange', 'purple', 'pink'];
  const refs = []; for (const [i, c] of colors.entries()) refs.push(await libraryRef(store, `r${i}.png`, c));
  const job = await finish(store, (await gateway.submit({ library: { references: refs }, model: 'opendesign:wide-edit', modality: 'image', prompt: 'combine' })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(submits[0][1].images, refs.map((_, i) => `ma_${i}`));
  await assert.rejects(gateway.submit({ library: { references: refs.slice(0, 2) }, model: 'opendesign:one-ref', modality: 'image', prompt: 'x' }), /at most 1 input image$/);
  await gateway.close();
}));

test('a storage upload rejection fails the job without rejecting the Cloud API key', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let submitted = 0; cloud(gateway, () => submitted++, {}, 403);
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const a = await libraryRef(store, 'a.png', 'red');
  const job = await finish(store, (await gateway.submit({ library: { references: [a] }, model: 'opendesign:edit-image', modality: 'image', prompt: 'x' })).id);
  assert.equal(job.state, 'failed'); assert.match(job.error!, /storage HTTP 403/); assert.equal(submitted, 0);
  const provider = (await gateway.status()).providers.find(p => p.id === 'opendesign')!;
  assert.equal(provider.available, true); assert.notEqual(provider.verification, 'rejected');
  await gateway.close();
}));

test('a permanent download rejection is not retried; a server error is', async () => {
  for (const [status, expected, downloadsExpected] of [[404, 'failed', 1], [503, 'completed', 2]] as const) await fixture(async store => {
    const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
    let downloads = 0;
    gateway.options.download = async () => { if (++downloads === 1) throw Object.assign(new Error(`Media download HTTP ${status}`), { status }); return audio; };
    cloud(gateway, () => {});
    await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
    const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: `calm piano ${status}` })).id);
    assert.equal(job.state, expected, `${status}: ${job.error ?? ''}`); assert.equal(downloads, downloadsExpected, `${status} downloads`);
    assert.notEqual((await gateway.status()).providers.find(p => p.id === 'opendesign')!.verification, 'rejected');
    await gateway.close();
  });
});

test('MCP initialization and the connection guide describe per-model references and first-frame video', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of ['../shared/mcp-profiles.json', '../shared/integration.ts']) {
    const text = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /library-reference image-to-video is unavailable|one fixed image version/, file);
    assert.match(text, /up to their maxInputImages/, file);
    assert.match(text, /take one image as the first frame/, file);
  }
});

test('the project-direct referenceAsset route stays image-only', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submitted = 0; cloud(gateway, () => submitted++);
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  await assert.rejects(gateway.submit({ projectId: store.projectId, referenceAsset: 'frame.png', model: 'opendesign:i2v', modality: 'video', prompt: 'x' }), /does not accept an input image/);
  assert.equal(submitted, 0);
  await gateway.close();
}));

for (const recovery of ['poll failure', 'interruption'] as const) test(`explicit Cloud resume after ${recovery} reuses one paid submission and saves once`, () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const output = await readFile(await image(store.directory, 'output.png', 'green'));
  gateway.options.download = async () => output;
  const calls = cloud(gateway, () => {}, { result: { alignment: { characters: ['a'] }, nested: ['cloud-key', { text: 'prefix cloud-key "\\\n suffix' }] } });
  const base = gateway.options.fetcher!; let failing = true;
  gateway.options.fetcher = (async (url, init = {}) => String(url).includes('/tasks/') && failing ? new Response(null, { status: 400 }) : base(url, init)) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const ref = await libraryRef(store, 'input.png', 'red');
  const queued = (await api.call('openmotion_assets_use', { action: 'generate', requestId: 'original', model: 'opendesign:edit-image', modality: 'image', prompt: 'edit', references: [ref] })).job;
  const failed = await finish(store, queued.id); assert.equal(failed.state, 'failed'); assert.equal(resumableJob(failed), true);
  assert.match(failed.error!, /action=resume/);
  if (recovery === 'interruption') {
    await writeFile(path.join(gateway.root, 'jobs', failed.id + '.json'), JSON.stringify({ ...failed, state: 'running', workerPid: 2147483647 }));
    await gateway.tick(); assert.equal((await gateway.getJob(failed.id)).state, 'failed'); assert.equal(gateway.active.size, 0);
  }
  failing = false;
  const resume = { action: 'resume', jobId: failed.id, requestId: 'resume-original' };
  await assert.rejects(api.call('openmotion_assets_use', { action: 'resume', jobId: failed.id }), /requestId|required/);
  const pair = await Promise.all([api.call('openmotion_assets_use', resume), api.call('openmotion_assets_use', resume)]);
  assert.equal(pair[0].job.id, pair[1].job.id);
  await Promise.all([gateway.tick(), gateway.tick()]); assert.equal(gateway.active.size, 1);
  await Promise.all([...gateway.active.values()].map(task => task.done));
  const done = await gateway.getJob(failed.id); assert.equal(done.state, 'completed', done.error);
  assert.equal((await api.call('openmotion_assets', resume)).job.state, 'completed');
  assert.equal(calls.filter(c => c === 'POST /api/v1/media/uploads').length, 1);
  assert.equal(calls.filter(c => c === 'POST /api/v1/media/images/edits').length, 1);
  const asset = await new AssetLibrary(store).get(done.libraryAssets![0].assetId);
  assert.equal(asset.versions.length, 1); assert.deepEqual(asset.versions[0].result, done.result);
  assert.deepEqual(done.result?.alignment, { characters: ['a'] });
  assert.doesNotMatch(await readFile(path.join(gateway.root, 'jobs', done.id + '.json'), 'utf8'), /cloud-key/);
  assert.doesNotMatch(JSON.stringify(asset), /cloud-key/);
  await gateway.close();
}));

test('resume guards invalid jobs, changed origin, unavailable provider and deleted project', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let posts = 0;
  gateway.options.fetcher = (async (_url, init = {}) => { if (init.method === 'POST') { posts++; return Response.json({ task_id: 'original-task' }); } return new Response(null, { status: 400 }); }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  const failed = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
  const file = path.join(gateway.root, 'jobs', failed.id + '.json');
  for (const patch of [{ state: 'cancelled' }, { savePending: true }, { remoteTerminal: true }, { model: { ...failed.model, provider: 'fal' } }, { remoteId: undefined }, { remoteId: '../bad' }, { projectId: randomUUID() }]) {
    await writeFile(file, JSON.stringify({ ...failed, ...patch }));
    await assert.rejects(gateway.resume(failed.id, 'resume')); assert.equal(posts, 1);
  }
  await writeFile(file, JSON.stringify(failed));
  await gateway.configureProvider('opendesign', { baseUrl: 'https://other.example' });
  await assert.rejects(gateway.resume(failed.id, 'resume'), /origin changed/);
  await gateway.configureProvider('opendesign', { baseUrl: 'https://cloud.example', enabled: false });
  await assert.rejects(gateway.resume(failed.id, 'resume'), /no longer available/);
  await gateway.close();
}));

test('project media resume retains project ownership and the original task', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1; gateway.options.download = async () => audio;
  let posts = 0, fail = true;
  gateway.options.fetcher = (async (_url, init = {}) => {
    if (init.method === 'POST') { posts++; return Response.json({ task_id: 'project-task' }); }
    return fail ? new Response(null, { status: 400 }) : Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/audio' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  const queued = (await api.call('openmotion_media_use', { action: 'generate', projectId: store.projectId, provider: 'opendesign', model: 'music', modality: 'audio', prompt: 'x', requestId: 'original' })).job;
  await finish(store, queued.id); fail = false;
  const args = { action: 'resume', projectId: store.projectId, jobId: queued.id, requestId: 'resume' };
  await assert.rejects(api.call('openmotion_media_use', { ...args, projectId: randomUUID() }), /PROJECT_NOT_FOUND/);
  await api.call('openmotion_media_use', args);
  assert.equal((await finish(store, queued.id)).state, 'completed'); assert.equal(posts, 1);
  await gateway.close();
}));

test('cancellation during resumed polling stays cancelled and ignores late result callbacks', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let posts = 0, fail = true, id = '';
  gateway.options.fetcher = (async (_url, init = {}) => {
    if (init.method === 'POST') { posts++; return Response.json({ task_id: 'original-task' }); }
    if (fail) return new Response(null, { status: 400 });
    await gateway.cancel(id);
    return Response.json({ status: 'succeeded', result: { late: true }, assets: [{ url: 'https://cdn.example/audio' }] });
  }) as Fetcher;
  gateway.options.download = async () => assert.fail('cancelled poll must not download');
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  id = (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id;
  await finish(store, id); fail = false; await gateway.resume(id, 'resume');
  const cancelled = await finish(store, id); assert.equal(cancelled.state, 'cancelled'); assert.equal(cancelled.result, undefined); assert.equal(posts, 1);
  // Exercise the persistence callback itself after cancellation, not only the adapter abort guard.
  const adapter = providerAdapters.opendesign.generate;
  providerAdapters.opendesign.generate = async (_job, ctx) => { await gateway.cancel(id); await ctx.result?.({ late: true }, true); await ctx.progress('generating'); throw new Error('cancelled fixture'); };
  try {
    id = (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'late callback' })).id;
    const late = await finish(store, id); assert.equal(late.state, 'cancelled'); assert.equal(late.phase, 'cancelled'); assert.equal(late.result, undefined); assert.equal(late.remoteTerminal, undefined);
  } finally { providerAdapters.opendesign.generate = adapter; await gateway.close(); }
}));

for (const state of ['failed', 'cancelled']) test(`Cloud terminal ${state} records structured error and cannot resume`, () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  cloud(gateway, () => {}, { status: state, error: { code: 'audio_outcome_unknown', retryable: false } });
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
  assert.equal(job.remoteTerminal, true); assert.equal(resumableJob(job), false);
  assert.deepEqual(job.result, { error: { code: 'audio_outcome_unknown', retryable: false } });
  assert.doesNotMatch(job.error!, /action=resume/); await assert.rejects(gateway.resume(job.id, 'resume'), /cannot be resumed/);
  await gateway.close();
}));

test('result metadata structurally redacts escaped credentials and rejects oversized or non-object replacements', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const key = 'fixture-"\\-key';
  await gateway.configureProvider('opendesign', { apiKey: key, baseUrl: 'https://cloud.example' });
  const adapter = providerAdapters.opendesign.generate;
  providerAdapters.opendesign.generate = async (_job, ctx) => {
    await ctx.result?.({ nested: [key, { text: `prefix ${key} suffix` }], [key]: 'value' });
    await ctx.result?.(['not an object'] as any);
    await ctx.result?.(Object.assign(Object.create(null), { invalid: true }));
    await ctx.result?.({ oversized: 'x'.repeat(2_000_000) });
    return [audio];
  };
  try {
    const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
    assert.equal(job.state, 'completed', job.error);
    assert.deepEqual(job.result, { nested: ['[redacted]', { text: 'prefix [redacted] suffix' }], '[redacted]': 'value' });
    const asset = await new AssetLibrary(store).get(job.libraryAssets![0].assetId);
    assert.deepEqual(asset.versions[0].result, job.result);
    const stored = await readFile(path.join(gateway.root, 'jobs', job.id + '.json'), 'utf8');
    assert.equal(stored.includes(JSON.stringify(key).slice(1, -1)), false);
    assert.equal(JSON.stringify(asset).includes(JSON.stringify(key).slice(1, -1)), false);
  } finally { providerAdapters.opendesign.generate = adapter; await gateway.close(); }
}));

test('Cloud native image handles choose edits, conflicting inputs fail before POST, and all nine outputs save', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const png = await readFile(await image(store.directory, 'out.png', 'green')); gateway.options.download = async () => png;
  const submits: [string, any][] = []; const calls = cloud(gateway, (p, body) => submits.push([p, body]), { assets: Array.from({ length: 9 }, () => ({ url: 'https://cdn.example/image' })) });
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  const missing = { assetId: randomUUID(), versionId: randomUUID() };
  await assert.rejects(gateway.submit({ library: { references: [missing] }, model: 'opendesign:edit-image', modality: 'image', prompt: 'x', parameters: { images: ['ma_existing'] } }), /Choose pinned references/);
  await assert.rejects(gateway.submit({ projectId: store.projectId, referenceAsset: 'missing.png', model: 'opendesign:edit-image', modality: 'image', prompt: 'x', parameters: { images: ['ma_existing'] } }), /Choose pinned references/);
  assert.equal(calls.filter(c => c.startsWith('POST')).length, 0);
  const job = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:edit-image', modality: 'image', prompt: 'x', parameters: { images: ['ma_existing'] } })).id);
  assert.equal(job.state, 'completed', job.error); assert.equal(job.libraryAssets!.length, 9);
  assert.equal(submits[0][0], '/api/v1/media/images/edits'); assert.deepEqual(submits[0][1].images, ['ma_existing']);
  await gateway.close();
}));

test('twenty references pass the public schema, while model count rejection precedes reference resolution', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  const png = await readFile(await image(store.directory, 'out.png', 'green')); gateway.options.download = async () => png;
  const submits: any[] = []; cloud(gateway, (_p, body) => submits.push(body));
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' }); await gateway.listModels({ provider: 'opendesign', refresh: true });
  const missing = { assetId: randomUUID(), versionId: randomUUID() };
  await assert.rejects(gateway.submit({ library: { references: Array(21).fill(missing) }, model: 'opendesign:wide-edit', modality: 'image', prompt: 'x' }), /at most 20 input images/);
  await assert.rejects(gateway.submit({ library: { references: [null as any] }, model: 'opendesign:wide-edit', modality: 'image', prompt: 'x' }), /Invalid asset reference/);
  const ref = await libraryRef(store, 'input.png', 'red');
  const queued = (await api.call('openmotion_assets_use', { action: 'generate', requestId: 'twenty', model: 'opendesign:wide-edit', modality: 'image', prompt: 'x', references: Array(20).fill(ref) })).job;
  assert.equal((await finish(store, queued.id)).state, 'completed'); assert.equal(submits[0].images.length, 20);
  await gateway.close();
}));

test('a failed save-only retry keeps a cancelled Cloud job cancelled and not resumable', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let posts = 0;
  gateway.options.fetcher = (async (_url, init = {}) => { if (init.method === 'POST') { posts++; return Response.json({ task_id: 'original-task' }); } return new Response(null, { status: 400 }); }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  const failed = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
  await writeFile(path.join(gateway.root, 'jobs', failed.id + '.json'), JSON.stringify({ ...failed, state: 'cancelled', phase: 'cancelled' }));
  await assert.rejects(api.call('openmotion_assets_use', { action: 'retry_save', jobId: failed.id, requestId: 'save' }), /SAVE_NOT_AVAILABLE/);
  const after = await gateway.getJob(failed.id);
  assert.equal(after.state, 'cancelled'); assert.equal(resumableJob(after), false);
  await assert.rejects(api.call('openmotion_assets_use', { action: 'resume', jobId: failed.id, requestId: 'resume' }), /cannot be resumed/);
  assert.equal(posts, 1); assert.equal(gateway.active.size, 0);
  await gateway.close();
}));

test('jobs from the earlier adapter keep confirmed remote failures non-resumable', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.fetcher = (async (_url, init = {}) => init.method === 'POST' ? Response.json({ task_id: 'original-task' }) : new Response(null, { status: 400 })) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  const failed = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
  const file = path.join(gateway.root, 'jobs', failed.id + '.json');
  for (const status of ['failed', 'cancelled']) {
    const legacy = { ...failed, error: `OpenDesign Cloud task ${status}; inspect the original task before retrying` };
    delete (legacy as any).remoteTerminal;
    await writeFile(file, JSON.stringify(legacy));
    assert.equal(resumableJob(await gateway.getJob(failed.id)), false);
    await assert.rejects(gateway.resume(failed.id, 'resume'), /cannot be resumed/);
  }
  const transient = { ...failed, error: 'Provider HTTP 502' }; delete (transient as any).remoteTerminal;
  await writeFile(file, JSON.stringify(transient));
  assert.equal(resumableJob(await gateway.getJob(failed.id)), true);
  await gateway.close();
}));

test('a failed save-only retry keeps an earlier Cloud-terminal job non-resumable', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let posts = 0;
  gateway.options.fetcher = (async (_url, init = {}) => { if (init.method === 'POST') { posts++; return Response.json({ task_id: 'original-task' }); } return new Response(null, { status: 400 }); }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  const failed = await finish(store, (await gateway.submit({ library: {}, model: 'opendesign:music', modality: 'audio', prompt: 'x' })).id);
  const file = path.join(gateway.root, 'jobs', failed.id + '.json');
  for (const status of ['failed', 'cancelled']) {
    const legacy = { ...failed, error: `OpenDesign Cloud task ${status}; inspect the original task before retrying` };
    delete (legacy as any).remoteTerminal;
    await writeFile(file, JSON.stringify(legacy));
    await assert.rejects(api.call('openmotion_assets_use', { action: 'retry_save', jobId: failed.id, requestId: `save-${status}` }), /SAVE_NOT_AVAILABLE/);
    const after = await gateway.getJob(failed.id);
    assert.equal(after.remoteTerminal, true); assert.equal(resumableJob(after), false);
    await assert.rejects(gateway.resume(failed.id, 'resume'), /cannot be resumed/);
  }
  assert.equal(posts, 1); assert.equal(gateway.active.size, 0);
  await gateway.close();
}));

test('Cloud discovery replaces legacy and removed rows, preserves unknown versus unsupported, and binds the current key', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'catalogue-fixture-key', baseUrl: 'https://cloud.example' });
  await writeFile(path.join(gateway.root, 'catalog.json'), JSON.stringify([
    { id: 'opendesign:legacy', provider: 'opendesign', modelId: 'legacy', modality: 'image', supportsImageReference: true },
    { id: 'fal:retained', provider: 'fal', modelId: 'retained', modality: 'image' },
  ]));
  let rows = [
    { model: 'edit', kind: 'image', capabilities: { edits: true, max_input_images: 3 } },
    { model: 'no-edit', kind: 'image', capabilities: { edits: false } },
    { model: 'unknown', kind: 'image', capabilities: {} },
  ];
  let reads = 0;
  gateway.options.fetcher = (async (url, init) => {
    assert.equal(String(url), 'https://cloud.example/api/v1/media/models');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer catalogue-fixture-key'); reads++;
    return Response.json({ models: rows });
  }) as Fetcher;
  const first = await gateway.listModels({ provider: 'opendesign', modality: 'image' });
  assert.deepEqual(first.models.map(model => [model.modelId, model.supportsImageReference]), [['edit', true], ['no-edit', false], ['unknown', undefined]]);
  assert.equal(first.models[0].maxInputImages, 3);
  assert.equal((await gateway.listModels({ provider: 'opendesign' })).warnings.length, 0); assert.equal(reads, 1);
  rows = [rows[1]];
  assert.deepEqual((await gateway.listModels({ provider: 'opendesign', modality: 'image', refresh: true })).models.map(model => model.modelId), ['no-edit']);
  assert.equal((await gateway.listModels({ provider: 'fal' })).models.some(model => model.id === 'fal:retained'), true);
  const saved = await readFile(path.join(gateway.root, 'cloud-catalog.json'), 'utf8');
  assert.equal(saved.includes('catalogue-fixture-key'), false);
  assert.equal(JSON.stringify(first).includes('identity'), false);
  await gateway.close();
}));

test('Cloud catalogue coalesces reads and discards responses from a previous credential generation', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'key-A', baseUrl: 'https://cloud.example' });
  let release!: () => void, started!: () => void, reads = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const begun = new Promise<void>(resolve => { started = resolve; });
  gateway.options.fetcher = (async (_url, init) => {
    reads++; const key = new Headers(init?.headers).get('Authorization');
    if (key === 'Bearer key-A') { started(); await waiting; }
    return Response.json({ models: [{ model: key === 'Bearer key-A' ? 'old-model' : 'new-model', kind: 'image', capabilities: { edits: true } }] });
  }) as Fetcher;
  const first = gateway.listModels({ provider: 'opendesign' }); await begun;
  const second = gateway.listModels({ provider: 'opendesign' });
  // Let the second caller reach the in-flight read before rotating the key.
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(reads, 1);
  await gateway.configureProvider('opendesign', { apiKey: 'key-B' });
  assert.equal((await gateway.listModels({ provider: 'opendesign', modality: 'image' })).models[0].modelId, 'new-model');
  release(); const stale = await Promise.all([first, second]);
  for (const result of stale) { assert.deepEqual(result.warnings, []); assert.equal(result.models.some(model => model.modelId === 'old-model'), false); }
  assert.equal(reads, 2);
  const saved = JSON.parse(await readFile(path.join(gateway.root, 'cloud-catalog.json'), 'utf8'));
  assert.deepEqual(saved.models.map((model: any) => model.modelId), ['new-model']);
  await gateway.close();
}));

test('Cloud catalogue failures retain only the current connection cache and never reuse it after an origin change', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  gateway.options.fetcher = (async () => Response.json({ models: [{ model: 'editing', kind: 'image', capabilities: { edits: true } }] })) as Fetcher;
  await gateway.listModels({ provider: 'opendesign' });
  gateway.options.fetcher = (async () => new Response(null, { status: 503 })) as Fetcher;
  const retained = await gateway.listModels({ provider: 'opendesign', modality: 'image', refresh: true });
  assert.equal(retained.models.length, 1); assert.match(retained.warnings.join(), /unavailable/);
  await gateway.configureProvider('opendesign', { baseUrl: 'https://other.example' });
  const changed = await gateway.listModels({ provider: 'opendesign', modality: 'image' });
  assert.deepEqual(changed.models, []); assert.match(changed.warnings.join(), /unavailable/);
  await gateway.close();
}));

test('Cloud live capabilities survive custom labels/defaults and disappear on a successful empty catalogue', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  await gateway.registerModel({ provider: 'opendesign', modelId: 'edit', label: 'My image', modality: 'image', mode: 'text-to-image', defaults: { quality: 'high' } });
  let rows: unknown[] = [{ model: 'edit', kind: 'image', capabilities: { edits: true, max_input_images: 4 } }, { model: 'bad', kind: 'image', capabilities: { edits: 'true' } }];
  gateway.options.fetcher = (async () => Response.json({ models: rows })) as Fetcher;
  const result = await gateway.listModels({ provider: 'opendesign', modality: 'image' });
  const custom = result.models.find(m => m.modelId === 'edit')!;
  assert.equal(custom.label, 'My image'); assert.deepEqual(custom.defaults, { quality: 'high' }); assert.equal(custom.supportsImageReference, true); assert.equal(custom.maxInputImages, 4);
  assert.equal(result.models.find(m => m.modelId === 'bad')!.supportsImageReference, undefined);
  rows = []; const empty = await gateway.listModels({ provider: 'opendesign', modality: 'image', refresh: true });
  assert.equal(empty.models.length, 1); assert.equal(empty.models[0].source, 'custom'); assert.equal(empty.models[0].supportsImageReference, undefined);
  await gateway.close();
}));

test('Cloud automatic failure cooldown is bypassed by explicit sync', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  let reads = 0, fail = true;
  gateway.options.fetcher = (async () => { reads++; return fail ? new Response(null, { status: 503 }) : Response.json({ models: [] }); }) as Fetcher;
  await gateway.listModels({ provider: 'opendesign' }); await gateway.listModels({ provider: 'opendesign' }); assert.equal(reads, 1);
  fail = false; assert.deepEqual((await gateway.listModels({ provider: 'opendesign', refresh: true })).warnings, []); assert.equal(reads, 2);
  await gateway.close();
}));

test('Cloud configuration A to B to A does not accept an old A discovery response', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'key-A', baseUrl: 'https://cloud.example' });
  let release!: () => void, started!: () => void, reads = 0;
  const wait = new Promise<void>(resolve => { release = resolve; }), begun = new Promise<void>(resolve => { started = resolve; });
  gateway.options.fetcher = (async () => { const first = ++reads === 1; if (first) { started(); await wait; } return Response.json({ models: [{ model: first ? 'obsolete' : 'current', kind: 'image', capabilities: { edits: true } }] }); }) as Fetcher;
  const old = gateway.listModels({ provider: 'opendesign' }); await begun;
  await gateway.configureProvider('opendesign', { apiKey: 'key-B' }); await gateway.configureProvider('opendesign', { apiKey: 'key-A' });
  await gateway.listModels({ provider: 'opendesign' }); release();
  assert.equal((await old).models.some(m => m.modelId === 'obsolete'), false);
  assert.equal((await gateway.listModels({ provider: 'opendesign', modality: 'image' })).models[0].modelId, 'current');
  await gateway.close();
}));

test('Cloud credential changes during submission reject before resolving any references or submitting', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'key-A', baseUrl: 'https://cloud.example' });
  let calls = 0;
  gateway.options.fetcher = (async () => { calls++; return Response.json({ models: [{ model: 'edit', kind: 'image', capabilities: { edits: true } }] }); }) as Fetcher;
  await gateway.listModels({ provider: 'opendesign' });
  const original = (gateway as any).models.bind(gateway); let reads = 0;
  (gateway as any).models = async () => { const models = await original(); if (++reads === 2) await gateway.configureProvider('opendesign', { apiKey: 'key-B' }); return models; };
  await assert.rejects(gateway.submit({ modality: 'image', prompt: 'x', model: 'opendesign:edit', library: { references: [{ assetId: 'missing', versionId: 'missing' }] } }), /Cloud configuration changed/);
  assert.equal(calls, 1); assert.deepEqual(await gateway.listJobs(), []); await gateway.close();
}));

test('Cloud rows cannot survive credential rotation while other model sources are loading', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'key-A', baseUrl: 'https://cloud.example' });
  gateway.options.fetcher = (async () => Response.json({ models: [{ model: 'old', kind: 'image', capabilities: { edits: true } }] })) as Fetcher;
  await gateway.listModels({ provider: 'opendesign' });
  const original = gateway.account.mediaModels.bind(gateway.account); let rotate = true;
  gateway.account.mediaModels = async () => { if (rotate) { rotate = false; await gateway.configureProvider('opendesign', { apiKey: 'key-B' }); } return original(); };
  const result = await gateway.listModels({ provider: 'opendesign', modality: 'image' });
  assert.deepEqual(result.models, []); await gateway.close();
}));

test('general model discovery never waits for a pending Cloud discovery', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'fixture', baseUrl: 'https://cloud.example' });
  let release!: () => void, started!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }), begun = new Promise<void>(resolve => { started = resolve; });
  gateway.options.fetcher = (async () => { started(); await wait; return Response.json({ models: [] }); }) as Fetcher;
  const pending = gateway.listModels({ provider: 'opendesign' }); await begun;
  try { assert.equal((await gateway.listModels()).models.some(m => m.provider === 'codex'), true); }
  finally { release(); await pending; await gateway.close(); }
}));

test('pre-upgrade Cloud cache rows normalize synthetic maxInputImages: 1 during discovery without refresh', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  await gateway.configureProvider('opendesign', { apiKey: 'stale-key', baseUrl: 'https://cloud.example' });
  gateway.options.fetcher = (async () => Response.json({
    models: [
      { model: 'gpt-image-2.6-sunburst', kind: 'image', capabilities: { edits: true } },
      { model: 'seedream-5.0-flash', kind: 'image', capabilities: { edits: true } },
    ],
  })) as Fetcher;
  await gateway.listModels({ provider: 'opendesign', refresh: true });
  // Simulate a pre-upgrade cloud-catalog.json written by the old adapter that persisted synthetic maxInputImages: 1.
  const catalogPath = path.join(gateway.root, 'cloud-catalog.json');
  const saved = JSON.parse(await readFile(catalogPath, 'utf8'));
  for (const row of saved.models) row.maxInputImages = 1;
  await writeFile(catalogPath, JSON.stringify(saved), 'utf8');

  let refreshed = false;
  gateway.options.fetcher = (async () => { refreshed = true; return Response.json({ models: [] }); }) as Fetcher;
  const listed = (await gateway.listModels({ provider: 'opendesign', modality: 'image' })).models;
  assert.equal(refreshed, false);
  const byId = new Map(listed.map(model => [model.modelId, model.maxInputImages]));
  assert.equal(byId.get('gpt-image-2.6-sunburst'), 16);
  assert.equal(byId.get('seedream-5.0-flash'), 10);
  await gateway.close();
}));
