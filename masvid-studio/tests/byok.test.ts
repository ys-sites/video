// Keep Cloud contract cases in the maintained BYOK entry for both CI and npm test.
import './cloud-native-media.cases.ts';
import test from 'node:test';
import { mediaBytes } from './media-fixtures.ts';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { accountMediaState } from '../gateway/account-media.ts';
import { providerOrigin } from '../gateway/network.ts';
import type { Fetcher } from '../gateway/network.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
const mp4 = await mediaBytes('video');
const audio = await mediaBytes('audio');
function service(store: any) { return new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} }); }
async function finish(store: any, id: string) { const g = gatewayFor(store); await g.tick(); await Promise.all([...g.active.values()].map(task => task.done)); return g.getJob(id); }

test('public media tool reads guides, generates fal media once and binds job queries to their project', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let submissions = 0;
  gateway.options.fetcher = (async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Key test-fal-private');
    if (init.method === 'POST') { submissions++; assert.equal(JSON.parse(String(init.body)).prompt, 'cup'); return Response.json({ request_id: 'remote', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' }); }
    return Response.json(String(url).endsWith('status') ? { status: 'COMPLETED' } : { images: [{ url: 'https://cdn.example/image.png' }] });
  }) as Fetcher;
  gateway.options.download = async () => png;
  await gateway.configureProvider('fal', { apiKey: 'test-fal-private' });
  assert.equal((await stat(path.join(gateway.root, 'secrets.json'))).mode & 0o777, 0o600);
  const inspect = await api.call('openmotion_media_use', { action: 'inspect' });
  assert.deepEqual(inspect.providers.map((p: any) => [p.id, p.enabled]), [['atlascloud', false], ['fal', true], ['opendesign', false], ['wavespeed', false], ['account', false]]);
  assert.doesNotMatch(JSON.stringify(inspect), /test-fal-private/);
  const reference = await api.call('openmotion_media_use', { action: 'reference', provider: 'fal' });
  assert.match(reference.content, /https:\/\/fal.ai\/docs\//);
  assert.equal(reference.workflow, 'media');
  assert.equal(reference.documentId, 'skills/openmotion-media/references/providers/fal.md');
  assert(inspect.references.every((ref: any) => ref.uri.startsWith('openmotion://workflow/media/')));
  const args = { action: 'generate', provider: 'fal', model: 'fal-ai/flux/schnell', projectId: store.projectId, requestId: 'same-task', modality: 'image', prompt: 'cup', parameters: { image_size: 'square_hd' } };
  const queued = await api.call('openmotion_media_use', args);
  assert.equal(queued.job.state, 'queued');
  assert.equal((await api.call('openmotion_media_use', args)).job.id, queued.job.id);
  await assert.rejects(api.call('openmotion_media_use', { ...args, prompt: 'different' }), /Idempotency/);
  const completed = await finish(store, queued.job.id); assert.equal(completed.state, 'completed', completed.error); assert.equal(submissions, 1);
  const result = await api.call('openmotion_media_use', { action: 'status', projectId: store.projectId, jobId: queued.job.id });
  assert.deepEqual(await readFile(path.join(store.projectDirectory, result.job.assets[0].path)), png);
  await assert.rejects(api.call('openmotion_media_use', { ...args, apiKey: 'must-not-accept' }), /unknown/);
  await assert.rejects(api.call('openmotion_media_use', { ...args, projectId: undefined }), /projectId/);
  await assert.rejects(api.call('openmotion_media_use', { action: 'status', projectId: crypto.randomUUID(), jobId: queued.job.id }), /PROJECT_NOT_FOUND/);
  await gateway.close();
}));

for (const kind of ['image', 'video', 'audio', 'music'] as const) test(`Cloud ${kind} preserves authentication, task identity and downloads into the project`, () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => kind === 'image' ? png : audio;
  const methods: string[] = [];
  gateway.options.fetcher = (async (url, init = {}) => {
    const target = String(url); assert(target.startsWith('https://cloud.example/api/v1/media/'));
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-cloud-private');
    if (kind === 'music' && target.endsWith('/models')) return Response.json({ models: [{ model: 'workspace-music', kind: 'audio_music' }] });
    methods.push(`${init.method ?? 'GET'} ${new URL(target).pathname}`);
    if (init.method === 'POST') {
      assert.match(new Headers(init.headers).get('Idempotency-Key')!, /^[a-f0-9-]{36}$/);
      const body = JSON.parse(String(init.body));
      if (kind === 'audio') { assert.equal(body.voice, '21m00Tcm4TlvDq8ikWAM'); assert.equal(body.parameters.text, 'hello'); assert.equal(body.parameters.speed, 1); }
      else if (kind === 'music') {
        assert.equal(new URL(target).pathname, '/api/v1/media/audio/music');
        assert.deepEqual(body, { model: 'workspace-music', parameters: { music_length_ms: 10000, force_instrumental: true, prompt: 'hello' } });
      }
      else assert.equal(body.prompt, 'hello');
      return Response.json({ task_id: 'cloud-task' }, { status: 202 });
    }
    if (target.endsWith('/content')) return new Response(mp4);
    assert.equal(new URL(target).pathname, `/api/v1/media/${kind === 'music' || kind === 'audio' ? 'audio' : kind + 's'}/tasks/cloud-task`);
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'test-cloud-private', baseUrl: 'https://cloud.example/v1' });
  if (kind === 'music') await api.call('openmotion_media_use', { action: 'models', provider: 'opendesign', modality: 'audio', refresh: true });
  const args = { action: 'generate', provider: 'opendesign', projectId: store.projectId, requestId: `cloud-${kind}`, model: kind === 'music' ? 'workspace-music' : kind === 'audio' ? 'elevenlabs-v3' : 'test-model', modality: kind === 'music' ? 'audio' : kind,
    ...(kind === 'music' ? {} : { mode: kind === 'audio' ? 'text-to-speech' : `text-to-${kind}` }), prompt: 'hello', parameters: kind === 'music' ? { music_length_ms: 10000, force_instrumental: true } : kind === 'audio' ? { speed: 1 } : { duration: 5 } };
  const queued = await api.call('openmotion_media_use', args);
  const job = await finish(store, queued.job.id); assert.equal(job.state, 'completed', job.error);
  assert.equal(job.remoteId, 'cloud-task'); assert.equal(job.providerOrigin, 'https://cloud.example');
  assert.equal(methods.length, kind === 'video' ? 3 : 2);
  assert.equal((await api.call('openmotion_media_use', args)).job.id, job.id);
  assert.doesNotMatch(JSON.stringify(job), /test-cloud-private/);
  await gateway.close();
}));

test('Cloud built-in music model is discoverable without a catalogue entry and submits to the music endpoint', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1; gateway.options.download = async () => audio;
  const posts: [string, any][] = [];
  gateway.options.fetcher = (async (url, init = {}) => {
    const target = new URL(String(url)).pathname;
    if (target.endsWith('/models')) return Response.json({ models: [{ model: 'workspace-image', kind: 'image' }] });
    if (init.method === 'POST') { posts.push([target, JSON.parse(String(init.body))]); return Response.json({ task_id: 'music-task' }, { status: 202 }); }
    return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/output' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const music = (await gateway.listModels({ provider: 'opendesign', refresh: true })).models.find(m => m.modelId === 'elevenlabs-music-v2');
  assert.deepEqual([music?.modality, music?.mode, music?.source], ['audio', 'text-to-audio', 'builtin']);
  await assert.rejects(gateway.submit({ projectId: store.projectId, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', mode: 'text-to-speech', prompt: 'calm music' }), /does not match the selected Cloud model/);
  const job = await finish(store, (await gateway.submit({ projectId: store.projectId, model: 'opendesign:elevenlabs-music-v2', modality: 'audio', prompt: 'calm piano', parameters: { music_length_ms: 10000 } })).id);
  assert.equal(job.state, 'completed', job.error);
  assert.deepEqual(posts, [['/api/v1/media/audio/music', { model: 'elevenlabs-music-v2', parameters: { music_length_ms: 10000, prompt: 'calm piano' } }]]);
  await gateway.close();
}));

test('Cloud discovery uses workspace credentials; origin changes stop queued calls and missing voice fails before charging', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  let calls = 0;
  gateway.options.fetcher = (async (_url, init = {}) => {
    calls++; assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer cloud-key');
    return Response.json({ models: [{ model: 'workspace-image', kind: 'image' }, { model: 'workspace-video', kind: 'video' },
      { model: 'workspace-speech', kind: 'audio_speech' }, { model: 'workspace-music', kind: 'audio_music' }, { model: 'legacy-speech', kind: 'audio' }, { model: 'language-model', kind: 'text' }] });
  }) as Fetcher;
  await gateway.configureProvider('opendesign', { apiKey: 'cloud-key', baseUrl: 'https://cloud.example' });
  const models = await gateway.listModels({ provider: 'opendesign', refresh: true });
  assert(models.models.some(m => m.modelId === 'workspace-image')); assert.equal(calls, 1);
  assert.deepEqual(models.models.filter(m => m.source === 'live' && m.modality === 'audio').map(m => [m.modelId, m.mode]),
    [['workspace-speech', 'text-to-speech'], ['workspace-music', 'text-to-audio'], ['legacy-speech', 'text-to-speech']]);
  assert(!models.models.some(m => m.modelId === 'language-model'));
  await assert.rejects(gateway.submit({ projectId: store.projectId, model: 'opendesign:workspace-music', modality: 'audio', mode: 'text-to-speech', prompt: 'calm music' }), /does not match the selected Cloud model/);
  await assert.rejects(gateway.submit({ projectId: store.projectId, model: 'opendesign:workspace-speech', modality: 'audio', mode: 'text-to-audio', prompt: 'hello' }), /does not match the selected Cloud model/);
  // A live speech model without checked voices still requires one.
  await assert.rejects(gateway.submit({ projectId: store.projectId, model: 'opendesign:workspace-speech', modality: 'audio', prompt: 'hello' }), /Voice ID is required/);
  const first = await gateway.submit({ projectId: store.projectId, model: 'opendesign:workspace-image', modality: 'image', prompt: 'cup' });
  await gateway.configureProvider('opendesign', { baseUrl: 'https://changed.example' });
  assert.match((await finish(store, first.id)).error!, /origin changed/); assert.equal(calls, 1);
  await assert.rejects(gateway.submit({ projectId: store.projectId, model: 'opendesign:byteplus-tts-2', modality: 'audio', prompt: 'hello', parameters: { voice: '' } }), /Invalid Speech voice/);
  assert.equal(calls, 1);
  await gateway.configureProvider('opendesign', { apiKey: null });
  assert.equal((await gateway.status()).providers.find(p => p.id === 'opendesign')!.enabled, false);
  await gateway.close();
}));

test('custom Cloud origins reject credentials, private IPs, paths and non-HTTPS URLs', () => {
  assert.equal(providerOrigin('https://cloud.example/v1/'), 'https://cloud.example');
  for (const raw of ['http://cloud.example', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://10.0.0.1', 'https://user:pass@cloud.example', 'https://cloud.example/path', 'https://cloud.example?key=secret']) assert.throws(() => providerOrigin(raw));
});

for (const [model, category, field, parameters] of [
  ['fal-ai/elevenlabs/tts/eleven-v3', 'text-to-speech', 'text', { voice: 'narrator' }],
  ['fal-ai/elevenlabs/music', 'text-to-audio', 'prompt', { music_length_ms: 10000 }],
  ['fal-ai/elevenlabs/sound-effects/v2', 'text-to-audio', 'text', { duration_seconds: 2, loop: true }],
  ['elevenlabs/sound-effects/v3', 'text-to-audio', 'text', { duration_seconds: 2, loop: true }],
  ['fal-ai/elevenlabs/sound-effects/v3', 'text-to-audio', 'text', { duration_seconds: 2, loop: true }],
] as const) test(`fal discovers and runs ${model} with its native audio input`, () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  gateway.options.download = async () => audio;
  let submissions = 0;
  gateway.options.fetcher = (async (url, init = {}) => {
    if (String(url).startsWith('https://api.fal.ai/v1/models')) return Response.json({ models: [{ endpoint_id: model, metadata: { category } }] });
    assert.equal(new Headers(init.headers).get('Authorization'), 'Key audio-fixture');
    if (init.method === 'POST') {
      submissions++;
      assert.equal(String(url), `https://queue.fal.run/${model}`);
      assert.deepEqual(JSON.parse(String(init.body)), { ...parameters, [field]: 'audio brief' });
      return Response.json({ request_id: 'audio-original', status_url: 'https://queue.fal.run/audio/status', response_url: 'https://queue.fal.run/audio/result' });
    }
    return Response.json(String(url).endsWith('/status') ? { status: 'COMPLETED' } : { audio: { url: 'https://cdn.example/audio.wav' } });
  }) as Fetcher;
  await gateway.configureProvider('fal', { apiKey: 'audio-fixture' });
  const found = await api.call('openmotion_media_use', { action: 'models', provider: 'fal', modality: 'audio', refresh: true });
  const selected = found.catalogs[0].models.find((m: any) => m.modelId === model);
  assert.equal(selected.mode, category);
  const args = { action: 'generate', provider: 'fal', projectId: store.projectId, requestId: 'audio-once', model, modality: 'audio', prompt: 'audio brief', parameters };
  const queued = await api.call('openmotion_media_use', args);
  const completed = await finish(store, queued.job.id);
  assert.equal(completed.state, 'completed', completed.error);
  assert.equal((await api.call('openmotion_media_use', args)).job.id, queued.job.id);
  assert.equal(submissions, 1);
  assert.deepEqual(await readFile(path.join(store.projectDirectory, completed.assets[0].path)), audio);
  await gateway.close();
}));

for (const provider of ['atlascloud', 'wavespeed'] as const) for (const kind of ['image', 'video', 'audio'] as const) {
  test(`${provider} ${kind} uses the public tool, one authenticated submit and project-owned output`, () => fixture(async store => {
    const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
    const model = kind === 'audio' ? 'minimax/speech-test' : `vendor/test-${kind}`;
    const expected = kind === 'image' ? png : kind === 'video' ? mp4 : audio;
    let submits = 0, polls = 0;
    gateway.options.download = async () => expected;
    gateway.options.fetcher = (async (raw, init = {}) => {
      const url = String(raw);
      assert.equal(new Headers(init.headers).get('Authorization'), `Bearer private-${provider}`);
      if (init.method === 'POST') {
        submits++;
        const body = JSON.parse(String(init.body));
        assert.equal(body[kind === 'audio' ? 'text' : 'prompt'], 'test input');
        assert.equal(body.voice_id, kind === 'audio' ? 'voice-test' : undefined);
        if (provider === 'atlascloud') {
          assert.equal(url, `https://api.atlascloud.ai/api/v1/model/generate${kind === 'image' ? 'Image' : kind === 'video' ? 'Video' : 'Audio'}`);
          assert.equal(body.model, model);
        } else {
          assert.equal(url, `https://api.wavespeed.ai/api/v3/${model}`);
          assert.equal(body.model, undefined);
        }
        return Response.json({ code: 200, data: { id: 'remote-test', status: 'created', urls: { get: 'https://untrusted.example/do-not-follow' } } });
      }
      assert.equal(url, provider === 'atlascloud' ? 'https://api.atlascloud.ai/api/v1/model/prediction/remote-test' : 'https://api.wavespeed.ai/api/v3/predictions/remote-test/result');
      return Response.json({ code: 200, data: ++polls === 1 ? { status: 'processing' } : { status: 'completed', outputs: ['https://cdn.example/output'] } });
    }) as Fetcher;
    await gateway.configureProvider(provider, { apiKey: `private-${provider}` });
    const inspected = await api.call('openmotion_media_use', { action: 'inspect' });
    assert.equal(inspected.providers.find((p: any) => p.id === provider).enabled, true);
    const guide = await api.call('openmotion_media_use', { action: 'reference', provider });
    assert.match(guide.content, new RegExp(provider === 'wavespeed' ? 'wavespeed.ai/docs/' : 'atlascloud.ai/docs/'));
    const request = { action: 'generate', provider, model, projectId: store.projectId, requestId: `${provider}-${kind}`, modality: kind,
      mode: kind === 'audio' ? 'text-to-speech' : `text-to-${kind}`, prompt: 'test input', parameters: kind === 'audio' ? { voice_id: 'voice-test' } : {} };
    const submitted = await api.call('openmotion_media_use', request);
    assert.equal((await api.call('openmotion_media_use', request)).job.id, submitted.job.id);
    const job = await finish(store, submitted.job.id);
    assert.equal(job.state, 'completed', job.error); assert.equal(job.remoteId, 'remote-test');
    assert.equal(submits, 1); assert.equal(polls, 2);
    assert.deepEqual(await readFile(path.join(store.projectDirectory, job.assets[0].path)), expected);
    assert.doesNotMatch(JSON.stringify(job), /private-/);
    await gateway.configureProvider(provider, { apiKey: null });
    assert.equal((await gateway.status()).providers.find(p => p.id === provider)!.enabled, false);
    await gateway.close();
  }));
}

test('WaveSpeed discovers authenticated media models and excludes text, training and 3D outputs', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let calls = 0;
  gateway.options.fetcher = (async (url, init = {}) => {
    calls++; assert.equal(String(url), 'https://api.wavespeed.ai/api/v3/models');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer wavespeed-discovery');
    return Response.json({ code: 200, data: [
      { model_id: 'vendor/image', name: 'Image test', type: 'text-to-image' },
      { model_id: 'vendor/video', type: 'image-to-video' },
      { model_id: 'vendor/voice', type: 'text-to-audio' },
      { model_id: 'vendor/caption', type: 'image-to-text' },
      { model_id: 'vendor/3d', type: 'image-to-3d' },
      { model_id: 'vendor/train', type: 'training' },
      { model_id: '../invalid', type: 'text-to-image' },
    ] });
  }) as Fetcher;
  assert.equal((await api.call('openmotion_media_use', { action: 'models', provider: 'wavespeed', refresh: true })).setupRequired, true);
  assert.equal(calls, 0);
  await gateway.configureProvider('wavespeed', { apiKey: 'wavespeed-discovery' });
  const result = await api.call('openmotion_media_use', { action: 'models', provider: 'wavespeed', refresh: true });
  assert.deepEqual(result.catalogs[0].models.map((m: any) => m.modality), ['image', 'video', 'audio']);
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(result), /wavespeed-discovery/);
  await gateway.close();
}));

test('WaveSpeed stops deleted tasks, rejects unsafe remote IDs and records auth rejection without paid retries', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => []; gateway.options.pollMs = 1;
  for (const outcome of ['deleted', 'unsafe-id', 'unauthorized'] as const) {
    let submits = 0;
    gateway.options.fetcher = (async (_url, init = {}) => {
      if (init.method === 'POST') {
        submits++;
        if (outcome === 'unauthorized') return new Response('private-provider-diagnostics', { status: 401 });
        return Response.json({ code: 200, data: { id: outcome === 'unsafe-id' ? '../outside' : 'safe-id', status: 'created' } });
      }
      return Response.json({ code: 200, data: { status: 'deleted' } });
    }) as Fetcher;
    await gateway.configureProvider('wavespeed', { apiKey: 'test-wavespeed-key' });
    const submitted = await gateway.submit({ projectId: store.projectId, model: 'wavespeed:vendor/image', modality: 'image', prompt: 'test' });
    const job = await finish(store, submitted.id);
    assert.equal(job.state, 'failed'); assert.equal(submits, 1); assert.deepEqual(job.assets, []);
    assert.match(job.error!, outcome === 'deleted' ? /deleted/ : outcome === 'unsafe-id' ? /prediction ID/ : /401/);
    assert.doesNotMatch(JSON.stringify(job), /test-wavespeed-key|private-provider-diagnostics/);
  }
  assert.equal((await gateway.status()).providers.find(p => p.id === 'wavespeed')!.verification, 'rejected');
  await gateway.close();
}));

test('public inspect requests billing refresh and exposes only sanitized account hints', t => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  t.after(() => gateway.close());
  const refreshes: boolean[] = [];
  t.mock.method(gateway.account, 'summary', async (refresh = false) => {
    refreshes.push(refresh);
    return { state: 'signed-in', plan: ' Go ', balance: '0.00', billingUnavailable: false,
      user: { email: 'private@example.test' }, consoleUrl: 'https://example.test', authorizationUrl: 'private-url' };
  });
  await gateway.status(); assert(refreshes.every(value => value === false));
  refreshes.length = 0;
  const result = await service(store).call('openmotion_media_use', { action: 'inspect' });
  assert(refreshes.includes(true));
  const account = result.providers.find((p: any) => p.id === 'account');
  assert.equal(account.mediaEntitlement, 'not-included'); assert.equal(account.available, true);
  assert.equal(account.plan, 'go'); assert.equal(account.hasBalance, false);
  assert.doesNotMatch(JSON.stringify(result), /0\.00|"balance"|private@example|private-url|controlKey|runtimeKey/);
}));

test('account media hints distinguish personal tiers, invalid balances and unfetched billing', () => {
  const summary = { state: 'signed-in' as const, billingUnavailable: false, consoleUrl: 'https://example.test' };
  for (const plan of ['plus', 'PRO', 'max', ' Max ']) {
    assert.equal(accountMediaState({ ...summary, plan }).mediaEntitlement, 'included', plan);
  }
  for (const balance of [undefined, null, '', '  ', 'NaN', 'Infinity', 'invalid']) {
    const hint = accountMediaState({ ...summary, plan: 'free', balance });
    assert.equal(hint.mediaEntitlement, 'not-included', String(balance)); assert.equal(hint.hasBalance, undefined);
  }
  // Free and Go entitle text models only; credits (signup grants, Go allowances, top-ups) never unlock media.
  for (const [plan, balance, hasBalance] of [['free', '-0.25', false], ['free', '5.00', true], [' Go ', '8.00', true], ['go', '0', false]] as const) {
    const hint = accountMediaState({ ...summary, plan, balance });
    assert.equal(hint.mediaEntitlement, 'not-included', plan + balance); assert.equal(hint.hasBalance, hasBalance, plan + balance);
    assert.equal(hint.reason, 'Signed in; multimodal generation requires OpenDesign Plus or above');
  }
  for (const plan of ['team_plus', 'team_pro', 'team_max', 'future-tier']) {
    assert.equal(accountMediaState({ ...summary, plan, balance: '0' }).mediaEntitlement, 'unknown', plan);
  }
  for (const input of [{ ...summary, plan: '   ', balance: '1.00' }, { ...summary }, { ...summary, plan: 'plus', billingUnavailable: true },
    { ...summary, plan: 'plus', billingUnavailable: undefined }, { ...summary, plan: 'plus', state: 'reauth-required' as const }]) {
    const hint = accountMediaState(input);
    assert.equal(hint.mediaEntitlement, input.state === 'signed-in' ? 'unknown' : undefined); assert.equal(hint.plan, undefined); assert.equal(hint.hasBalance, undefined);
  }
});
