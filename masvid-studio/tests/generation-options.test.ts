import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleImageResolutions, generationOptions, modelDefaults, resolveGenerationParameters, usesInputImageRatio, validateGenerationOptions } from '../shared/generation-options.ts';
import { builtinModels } from '../gateway/catalog.ts';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { providerAdapters } from '../gateway/providers.ts';
import type { GenerationJob, Model } from '../shared/gateway.ts';
import {
  defaultVideoFeatureChoices,
  videoFeatureCapable,
  videoFeatureParameters,
  videoFeaturePrompt,
  videoFeatureSupported,
  videoModelBadge,
  videoModelLabel,
  type VideoFeatureId,
} from '../shared/video-features.ts';
import { imageFeatureCapable, imageFeatureSupported, type ImageFeatureId } from '../shared/image-features.ts';
import { modelCapabilities } from '../shared/model-capabilities.ts';
import { openDesignImageReferenceCap, openDesignModels } from '../shared/opendesign-models.ts';
import { OpenDesignAccount } from '../gateway/account.ts';
import type { AccountSummary } from '../shared/provider-directory.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

for (const provider of ['opendesign', 'account']) for (const modelId of ['wan-2.7', 'doubao-seedance-2-5-260628']) {
  test(`${provider}:${modelId} first-frame parameters follow the image without inheriting a fixed ratio`, () => {
    const model: Model = { id: `${provider}:${modelId}`, provider, modelId, label: modelId, modality: 'video', mode: 'text-to-video', source: 'live',
      defaults: { ratio: '16:9', duration: 5 }, nativeOptions: { ratios: { default: '16:9' } } };
    const explicit = { ratio: '9:16', duration: 4 };
    assert.throws(() => resolveGenerationParameters(model, explicit, true), /First-frame video.*Remove parameters.ratio.*adaptive/);
    for (const ratio of ['16:9', '', null, 1]) assert.throws(() => resolveGenerationParameters(model, { ratio }, true), /First-frame video/);
    assert.deepEqual(resolveGenerationParameters(model, {}, true), { duration: 5 });
    assert.deepEqual(resolveGenerationParameters(model, { ratio: 'adaptive' }, true), { duration: 5, ratio: 'adaptive' });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: { ratio: 'adaptive' } }, {}, true), { ratio: 'adaptive' });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: undefined }, {}, true), {});
    // Text-only generation keeps both saved and explicit fixed ratios, without mutating their source.
    assert.deepEqual(resolveGenerationParameters(model, {}), { ratio: '16:9', duration: 5 });
    assert.deepEqual(resolveGenerationParameters(model, explicit), explicit);
    assert.deepEqual(model.defaults, { ratio: '16:9', duration: 5 });
    assert.deepEqual(explicit, { ratio: '9:16', duration: 4 });
    const images = [{ asset_id: 'ma_frame', role: 'first_frame' }];
    assert.equal(usesInputImageRatio(model, false, { images }), true);
    assert.throws(() => resolveGenerationParameters(model, { images, ratio: '16:9' }), /First-frame video/);
    assert.deepEqual(resolveGenerationParameters(model, { images }), { duration: 5, images });
    assert.deepEqual(resolveGenerationParameters({ ...model, defaults: { ...model.defaults, images } }, {}), { duration: 5, images });
  });
}

test('first-frame ratio policy leaves other providers, models and image editing unchanged', () => {
  const base: Model = { id: 'opendesign:wan-2.7', provider: 'opendesign', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live', defaults: { ratio: '16:9' } };
  for (const model of [{ ...base, provider: 'fal' }, { ...base, provider: 'atlascloud' }, { ...base, modelId: 'future-video' }, { ...base, modality: 'image' as const }]) {
    assert.equal(usesInputImageRatio(model, true), false);
    assert.deepEqual(resolveGenerationParameters(model, { ratio: '4:3' }, true), { ratio: '4:3' });
  }
});

test('account first-frame video rejects fixed ratios before running the connector, forwards --first-frame, and still rejects audio references', () => fixture(async store => {
  const calls: string[][] = [];
  const account = new OpenDesignAccount(store.directory, {
    pollMs: 0,
    run: async args => {
      calls.push(args);
      if (args[1] === 'gen') return JSON.stringify({ task_id: `task-${calls.length}` });
      if (args[1] === 'get') {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(args[args.indexOf('--output') + 1], Buffer.from('mp4'));
        return JSON.stringify({ task_id: args[2], status: 'succeeded' });
      }
      throw new Error('unexpected connector call');
    },
  });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  const model: Model = { id: 'account:wan-2.7', provider: 'account', modelId: 'wan-2.7', label: 'Wan', modality: 'video', mode: 'text-to-video', source: 'live', maxInputImages: 1, defaults: { ratio: '16:9' } };
  const job = { model, modality: 'video', prompt: 'Walk forward', providerOrigin: 'fixture-session', parameters: { ratio: '16:9' } } as GenerationJob;
  try {
    const run = (parameters: Record<string, unknown>, target: GenerationJob = job) => account.generate({ ...target, parameters }, store.directory, new AbortController().signal, async () => {}, 'first-frame.png');
    await assert.rejects(run({ ratio: '16:9' }), /First-frame video/);
    const audioModel: Model = { id: 'account:elevenlabs-v3', provider: 'account', modelId: 'elevenlabs-v3', label: 'Eleven', modality: 'audio', mode: 'text-to-speech', source: 'live' };
    await assert.rejects(run({ voice: 'v1' }, { ...job, model: audioModel, modality: 'audio' }), /Account reference images are supported for image editing and video first frames only/);
    assert.equal(calls.length, 0);
    await run({});
    await run({ ratio: 'adaptive' });
    const submits = calls.filter(args => args[1] === 'gen');
    assert.deepEqual(submits, [
      ['video', 'gen', '--model', 'wan-2.7', '--prompt', 'Walk forward', '--first-frame', 'first-frame.png', '--no-wait', '--json', '--generate-audio'],
      ['video', 'gen', '--model', 'wan-2.7', '--prompt', 'Walk forward', '--first-frame', 'first-frame.png', '--no-wait', '--json', '--ratio', 'adaptive', '--generate-audio'],
    ]);
  } finally { account.close(); }
}));

test('account image jobs with a transparent background or several references go to the media API with the account key', () => fixture(async store => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
  const calls: { url: string; method: string; body?: any; auth?: string }[] = [];
  let submitResponse = () => Response.json({ task_id: 'task-1', status: 'queued' }, { status: 202 });
  const fetcher = (async (input: any, init: any = {}) => {
    const url = String(input), method = init.method ?? 'GET';
    calls.push({ url, method, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    if (url.startsWith('https://storage.example/')) return new Response(null, { status: 200 });
    const api = url.replace('https://amr-api.open-design.ai/api/v1/media', '');
    if (api === '/uploads') return Response.json({ asset_id: `upload-${calls.filter(call => call.url.endsWith('/uploads')).length}`, upload_url: `https://storage.example/${calls.length}` });
    if (/^\/uploads\/upload-\d+\/commit$/.test(api)) return Response.json({ status: 'ready' });
    if (api === '/images/edits' || api === '/images/generations') return submitResponse();
    if (api === '/images/tasks/task-1') return Response.json({ task_id: 'task-1', status: 'succeeded', model: 'gpt-image-2.6-sunburst',
      assets: [{ asset_id: 'result', status: 'ready', mime_type: 'image/png', size_bytes: png.length, url: 'https://media.example/result' }] });
    throw new Error('unexpected request ' + url);
  }) as typeof fetch;
  const account = new OpenDesignAccount(store.directory, { pollMs: 1, fetcher, run: async () => { throw new Error('unexpected connector call'); },
    download: async () => new Response(png, { headers: { etag: '"fixture"', 'content-length': String(png.length) } }) });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  await mkdir(account.home, { recursive: true });
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({ profiles: { prod: { user: { id: 'test' }, controlKey: 'test-control', controlKeyId: 'test-id', runtimeKey: 'test-runtime' } } }));
  const references = await Promise.all(['one', 'two'].map(async name => { const file = path.join(store.directory, name + '.png'); await writeFile(file, png); return { file, mimeType: 'image/png', bytes: png.length }; }));
  const model: Model = { id: 'account:gpt-image-2.6-sunburst', provider: 'account', modelId: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', modality: 'image', mode: 'text-to-image', source: 'live', supportsImageReference: true, maxInputImages: 16 };
  const job = { id: 'job-1', model, modality: 'image', prompt: 'Keep only the speaker.', providerOrigin: 'fixture-session', parameters: { background: 'transparent', quality: 'low' } } as unknown as GenerationJob;
  const run = (input: GenerationJob, inputs = references.slice(0, 1)) => account.generate(input, store.directory, new AbortController().signal, async () => {}, inputs[0]?.file, inputs);
  try {
    await run(job);
    const submit = calls.find(call => call.url.endsWith('/images/edits'))!;
    assert.deepEqual(submit.body, { background: 'transparent', quality: 'low', model: 'gpt-image-2.6-sunburst', prompt: 'Keep only the speaker.', images: ['upload-1'] });
    assert.ok(calls.filter(call => call.url.startsWith('https://amr-api')).every(call => call.auth === 'Bearer test-control'));
    calls.length = 0;
    await run({ ...job, parameters: { quality: 'low' } }, references);
    assert.deepEqual(calls.find(call => call.url.endsWith('/images/edits'))!.body.images, ['upload-1', 'upload-2']);
    submitResponse = () => Response.json({ error: { code: 'insufficient_balance' } }, { status: 402 });
    await assert.rejects(run(job), /Your OpenDesign balance is too low/);
  } finally { account.close(); }
}));
test('exact endpoint schemas preserve provider types and never guess from a model label', () => {
  const seedance = builtinModels.find(m => m.modelId === 'bytedance/seedance-2.0/text-to-video')!;
  const schema = generationOptions(seedance)!;
  assert.equal(schema.fields.find(f => f.key === 'duration')!.choices![2].value, 5);
  assert.ok(schema.fields.some(f => f.key === 'ratio'));
  assert.ok(!schema.fields.some(f => f.key === 'aspect_ratio'));
  assert.throws(() => validateGenerationOptions(seedance, { duration: '5' }), /Invalid Duration/);
  assert.throws(() => validateGenerationOptions(seedance, { generate_audio: 'true' }), /Invalid Generate audio/);
  validateGenerationOptions(seedance, { duration: 5, generate_audio: true });
  assert.throws(() => validateGenerationOptions(seedance, { resolution: '4k', ratio: '9:16' }), /requires ratio 16:9/);
  validateGenerationOptions(seedance, { resolution: '4k', ratio: '16:9' });
  assert.equal(generationOptions({ ...seedance, modelId: 'unknown', label: seedance.label }), undefined);
  const flux = builtinModels.find(m => m.modelId === 'fal-ai/flux/schnell')!;
  validateGenerationOptions(flux, { image_size: { width: 1280, height: 720 } });
  assert.throws(() => validateGenerationOptions(flux, { num_images: 1.5 }), /Output count/);
  const codex = builtinModels.find(m => m.provider === 'codex')!;
  assert.equal(generationOptions(codex)?.delivery, 'prompt');
});

test('discovery returns the same schema used to reject invalid submissions before queueing', () => fixture(async store => {
  const gateway = gatewayFor(store);
  await gateway.configureProvider('atlascloud', { apiKey: 'fixture-only' });
  const { models } = await gateway.listModels({ provider: 'atlascloud', modality: 'video' });
  const model = models.find(m => m.modelId === 'bytedance/seedance-2.0/text-to-video')!;
  assert.deepEqual(model.generationOptions, generationOptions(model));
  const input = { modality: 'video' as const, prompt: 'Ocean', model: model.id, library: {}, idempotencyKey: 'typed-video' };
  await assert.rejects(gateway.submit({ ...input, parameters: { duration: '5' } }), /Invalid Duration/);
  assert.equal((await gateway.listJobs()).length, 0);
  const original = await gateway.submit({ ...input, parameters: { duration: 5, ratio: '9:16' } });
  assert.deepEqual(original.parameters, { duration: 5, ratio: '9:16' });
  assert.equal((await gateway.submit({ ...input, parameters: original.parameters })).id, original.id);
  assert.equal((await gateway.listJobs()).length, 1);
}));

test('Kokoro sends spoken text in prompt alongside native voice and speed, without retry', async () => {
  const bodies: any[] = [], model = builtinModels.find(m => m.modelId === 'fal-ai/kokoro/american-english')!;
  const job = { model, modality: 'audio', prompt: 'Hello world', parameters: { voice: 'af_heart', speed: 1.2 } } as GenerationJob;
  const urls = await providerAdapters.fal.generate(job, {
    key: 'fixture-only', signal: new AbortController().signal, progress: async () => {}, pollMs: 0,
    fetcher: async (_url, init) => {
      if (init?.method === 'POST') { bodies.push(JSON.parse(String(init.body))); return Response.json({ request_id: 'test', status_url: 'https://queue.fal.run/request/status', response_url: 'https://queue.fal.run/request/result' }); }
      return Response.json(String(_url).endsWith('status') ? { status: 'COMPLETED' } : { audio: { url: 'https://cdn.example/voice.wav' } });
    },
  });
  assert.deepEqual(bodies, [{ prompt: 'Hello world', voice: 'af_heart', speed: 1.2 }]);
  assert.deepEqual(urls, ['https://cdn.example/voice.wav']);
});

test('ElevenLabs Sound Effects v2 exposes bounded duration_seconds and seamless loop options', () => {
  const sfx = builtinModels.find(m => m.modelId === 'fal-ai/elevenlabs/sound-effects/v2')!;
  const schema = generationOptions(sfx)!;
  assert.deepEqual(schema.fields.map(f => [f.key, f.kind, f.min, f.max]), [
    ['duration_seconds', 'number', 0.5, 22],
    ['loop', 'boolean', undefined, undefined],
  ]);
  assert.doesNotThrow(() => validateGenerationOptions(sfx, { duration_seconds: 2.5, loop: true }));
  assert.throws(() => validateGenerationOptions(sfx, { duration_seconds: 0.1 }), /Invalid Duration/);
  assert.throws(() => validateGenerationOptions(sfx, { duration_seconds: 30 }), /Invalid Duration/);
  assert.throws(() => validateGenerationOptions(sfx, { loop: 'yes' }), /Invalid Seamless loop/);
});

test('OpenDesign speech offers checked voices with a default, accepts other voice IDs, and keeps a free voice ID for other models', () => fixture(async store => {
  const byteplus = builtinModels.find(m => m.id === 'opendesign:byteplus-tts-2')!, eleven = builtinModels.find(m => m.id === 'opendesign:elevenlabs-v3')!;
  const [voice] = generationOptions(byteplus)!.fields;
  assert.deepEqual([voice.key, voice.kind, voice.default, voice.required, voice.allowCustom], ['voice', 'choice', 'zh_female_vv_uranus_bigtts', undefined, true]);
  assert.equal(generationOptions(eleven)!.fields[0].choices!.length, 6);
  assert.ok(generationOptions(eleven)!.fields[0].choices!.every(c => typeof c.previewUrl === 'string' && c.previewUrl.startsWith('https://')));
  // The list is a checked subset: an unlisted voice ID still reaches the provider, but a blank or non-string one does not.
  assert.doesNotThrow(() => validateGenerationOptions(byteplus, { voice: 'zh_female_xiaohe_uranus_bigtts' }));
  assert.throws(() => validateGenerationOptions(byteplus, { voice: ' ' }), /Invalid Speech voice/);
  assert.throws(() => validateGenerationOptions(eleven, { voice: 1 }), /Invalid Speech voice/);
  assert.deepEqual(modelDefaults({ ...eleven, id: 'account:elevenlabs-v3', provider: 'account' }), { voice: '21m00Tcm4TlvDq8ikWAM' });
  // A saved override still wins over the built-in default.
  assert.deepEqual(modelDefaults({ ...eleven, defaults: { voice: 'JBFqnCBsd6RMkjVDRZzb' } }), { voice: 'JBFqnCBsd6RMkjVDRZzb' });
  const other = { ...byteplus, id: 'opendesign:other-tts', modelId: 'other-tts' };
  assert.deepEqual(modelDefaults(other), {});
  assert.throws(() => validateGenerationOptions(other, {}), /Voice ID is required/);
  const prototypeName = { ...byteplus, id: 'opendesign:constructor', modelId: 'constructor' };
  assert.deepEqual(modelDefaults(prototypeName), {});
  assert.throws(() => validateGenerationOptions(prototypeName, {}), /Voice ID is required/);
  assert.deepEqual(modelDefaults({ ...byteplus, mode: 'text-to-audio' }), {});
  // Discovery shows the default through the schema; the model's saved defaults stay empty for Settings.
  const gateway = gatewayFor(store);
  await gateway.configureProvider('opendesign', { apiKey: 'fixture-only' });
  const { models } = await gateway.listModels({ provider: 'opendesign', modality: 'audio' });
  const listed = models.find(m => m.id === byteplus.id)!;
  assert.equal(listed.generationOptions!.fields[0].default, 'zh_female_vv_uranus_bigtts');
  assert.equal(listed.defaults?.voice, undefined);
  await gateway.close();
}));

test('OpenDesign Cloud and account video models derive options from published capabilities and native audio policy', async () => {
  // Unsorted AMR-style arrays where default `5` comes first.
  const seedanceDurations = [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)];
  const wanDurations = [5, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => i + 6)];
  for (const provider of ['opendesign', 'account']) {
    const seedance: Model = {
      id: `${provider}:doubao-seedance-2-5-260628`, provider, modelId: 'doubao-seedance-2-5-260628', label: 'doubao-seedance-2-5-260628',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        durations: { values: seedanceDurations, default: 5 },
        ratios: { values: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'], default: '16:9' },
        resolutions: { values: ['720p', '480p', '1080p'], default: '720p' },
      },
    };
    const seedanceFlash: Model = {
      ...seedance, id: `${provider}:doubao-seedance-2-5-flash-261115`, modelId: 'doubao-seedance-2-5-flash-261115', label: 'doubao-seedance-2-5-flash-261115',
    };
    const wan: Model = {
      id: `${provider}:wan-2.7`, provider, modelId: 'wan-2.7', label: 'wan-2.7',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        durations: { values: wanDurations, default: 5 },
        ratios: { values: ['16:9', '9:16', '1:1', '4:3', '3:4', 'adaptive'], default: '16:9' },
        resolutions: { values: ['720p', '1080p'], default: '720p' },
      },
    };
    const seedance20: Model = {
      id: `${provider}:doubao-seedance-2-0-260128`, provider, modelId: 'doubao-seedance-2-0-260128', label: 'doubao-seedance-2-0-260128',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: { durations: { values: [5, 10], default: 5 } },
    };
    const rawArraySeedance: Model = {
      id: `${provider}:doubao-seedance-2-5-260628`, provider, modelId: 'doubao-seedance-2-5-260628', label: 'doubao-seedance-2-5-260628',
      modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        durations: seedanceDurations,
        ratios: ['16:9', '9:16', 'adaptive'],
        resolutions: ['720p', '480p', '1080p'],
      },
    };

    const seedanceFields = generationOptions(seedance)!.fields;
    assert.deepEqual(seedanceFields.map(f => f.key), ['ratio', 'resolution', 'duration', 'generate_audio']);
    assert.equal(seedanceFields.find(f => f.key === 'ratio')!.presentation, 'ratio');
    assert.deepEqual(seedanceFields.find(f => f.key === 'resolution')!.choices!.map(c => c.value), ['480p', '720p', '1080p']);
    assert.equal(seedanceFields.find(f => f.key === 'resolution')!.default, '720p');
    const seedanceDuration = seedanceFields.find(f => f.key === 'duration')!;
    assert.deepEqual([seedanceDuration.kind, seedanceDuration.min, seedanceDuration.max, seedanceDuration.step, seedanceDuration.default], ['number', 4, 30, 1, 5]);
    const seedanceAudio = seedanceFields.find(f => f.key === 'generate_audio')!;
    assert.deepEqual([seedanceAudio.kind, seedanceAudio.default], ['boolean', true]);

    const flashFields = generationOptions(seedanceFlash)!.fields;
    assert.equal(flashFields.find(f => f.key === 'generate_audio')!.default, true);
    assert.equal(usesInputImageRatio(seedanceFlash, true), true);

    const wanFields = generationOptions(wan)!.fields;
    assert.deepEqual(wanFields.map(f => f.key), ['ratio', 'resolution', 'duration']);
    const wanDuration = wanFields.find(f => f.key === 'duration')!;
    assert.deepEqual([wanDuration.kind, wanDuration.min, wanDuration.max, wanDuration.step, wanDuration.default], ['number', 2, 15, 1, 5]);
    assert.equal(wanFields.some(f => f.key === 'generate_audio'), false);

    const [seedance20Duration] = generationOptions(seedance20)!.fields;
    assert.equal(seedance20Duration.kind, 'choice');
    assert.deepEqual(seedance20Duration.choices!.map(c => c.value), [5, 10]);

    const rawFields = generationOptions(rawArraySeedance)!.fields;
    assert.equal(rawFields.find(f => f.key === 'ratio')!.default, '16:9');
    assert.equal(rawFields.find(f => f.key === 'resolution')!.default, '720p');
    assert.deepEqual(rawFields.find(f => f.key === 'resolution')!.choices!.map(c => c.value), ['480p', '720p', '1080p']);
    assert.equal(rawFields.find(f => f.key === 'duration')!.default, 5);

    validateGenerationOptions(seedance, { duration: 15, generate_audio: false });
    validateGenerationOptions(seedance, { duration: 30, resolution: '1080p', ratio: '16:9' });
    assert.throws(() => validateGenerationOptions(seedance, { duration: 31 }), /Invalid Duration/);
    assert.throws(() => validateGenerationOptions(seedance, { duration: 15.5 }), /Invalid Duration/);
    assert.throws(() => validateGenerationOptions(seedance, { duration: '15' }), /Invalid Duration/);
    validateGenerationOptions(wan, { duration: 2 });
    validateGenerationOptions(wan, { duration: 15 });
    assert.throws(() => validateGenerationOptions(wan, { duration: 16 }), /Invalid Duration/);
    assert.equal(generationOptions({ ...wan, nativeOptions: {} }), undefined);
    assert.equal(generationOptions({ ...wan, nativeOptions: { durations: { values: [] } } }), undefined);
  }
});

test('account catalogue preserves capabilities and forwards explicit duration and native audio policy', () => fixture(async store => {
  const calls: string[][] = [];
  const account = new OpenDesignAccount(store.directory, {
    run: async args => {
      calls.push(args);
      if (args[0] === 'model') return JSON.stringify({ source: 'remote', data: [] });
      if (args[0] === 'media') {
        return JSON.stringify({
          models: [
            {
              model: 'doubao-seedance-2-5-260628', kind: 'video',
              capabilities: {
                durations: { values: [5, 4, ...Array.from({ length: 25 }, (_, i) => i + 6)], default: 5 },
                ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
                resolutions: { values: ['720p', '480p', '1080p'], default: '720p' },
              },
            },
            {
              model: 'wan-2.7', kind: 'video',
              capabilities: {
                durations: { values: [5, 2, 3, 4, ...Array.from({ length: 10 }, (_, i) => i + 6)], default: 5 },
                ratios: { values: ['16:9', '9:16', 'adaptive'], default: '16:9' },
                resolutions: { values: ['720p', '1080p'], default: '720p' },
              },
            },
          ],
        });
      }
      if (args[0] === 'video' && args[1] === 'gen') return JSON.stringify({ task_id: `vt_${calls.length}` });
      if (args[0] === 'video' && args[1] === 'get') {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(args[args.indexOf('--output') + 1], Buffer.from('mp4'));
        return JSON.stringify({ task_id: args[2], status: 'succeeded' });
      }
      throw new Error(`unexpected call: ${args.join(' ')}`);
    },
    pollMs: 0,
  });
  account.profile = async () => ({ runtimeKey: 'fixture-key' });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  try {
    await account.models(true);
    const media = await account.mediaModels();
    const seedance = media.find(m => m.modelId === 'doubao-seedance-2-5-260628')!;
    const wan = media.find(m => m.modelId === 'wan-2.7')!;
    assert.equal(generationOptions(seedance)!.fields.find(f => f.key === 'duration')!.max, 30);
    assert.equal(generationOptions(wan)!.fields.find(f => f.key === 'duration')!.min, 2);

    // 1. Seedance 2.5 with omitted generate_audio defaults to `--generate-audio`.
    await account.generate(
      { id: 'job-15s-audio-default', model: seedance, modality: 'video', prompt: 'Drive along the boulevard', providerOrigin: 'fixture-session', parameters: { duration: 15 } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const defaultAudioArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(defaultAudioArgs[defaultAudioArgs.indexOf('--duration') + 1], '15');
    assert.ok(defaultAudioArgs.includes('--generate-audio'));
    assert.ok(!defaultAudioArgs.includes('--generate-audio=false'));

    // 2. Seedance 2.5 with explicit generate_audio: false passes `--generate-audio=false`.
    await account.generate(
      { id: 'job-15s-audio-off', model: seedance, modality: 'video', prompt: 'Silent boulevard', providerOrigin: 'fixture-session', parameters: { duration: 15, generate_audio: false } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const silentArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(silentArgs[silentArgs.indexOf('--duration') + 1], '15');
    assert.ok(silentArgs.includes('--generate-audio=false'));

    // 3. wan-2.7 passes `--generate-audio` so @powerformer/vela-cli@0.1.10 does not default to generate_audio=false (rejected by AMR with HTTP 400).
    await account.generate(
      { id: 'job-wan-3s', model: wan, modality: 'video', prompt: 'Ocean cliff', providerOrigin: 'fixture-session', parameters: { duration: 3 } } as GenerationJob,
      store.directory, new AbortController().signal, async () => {},
    );
    const wanArgs = calls.filter(args => args[0] === 'video' && args[1] === 'gen').at(-1)!;
    assert.equal(wanArgs[wanArgs.indexOf('--duration') + 1], '3');
    assert.ok(wanArgs.includes('--generate-audio'));
    assert.ok(!wanArgs.includes('--generate-audio=false'));
  } finally { account.close(); }
}));

test('OpenDesign Cloud and account video models derive ratio, resolution and integer duration from published capabilities', () => {
  for (const provider of ['opendesign', 'account'] as const) {
    const model: Model = {
      id: `${provider}:wan-2.7`, provider, modelId: 'wan-2.7', label: 'Wan 2.7', modality: 'video', mode: 'text-to-video', source: 'live',
      nativeOptions: {
        ratios: { values: ['16:9', '9:16', '1:1'], default: '16:9' },
        resolutions: { values: ['720P', '1080P'], default: '720P' },
        durations: { values: [5, 10], default: 5 },
      },
    };
    const schema = generationOptions(model)!;
    assert.deepEqual(schema.fields.map(f => [f.key, f.default, f.presentation]), [
      ['ratio', '16:9', 'ratio'],
      ['resolution', '720P', undefined],
      ['duration', 5, undefined],
    ]);
    assert.doesNotThrow(() => validateGenerationOptions(model, { ratio: '9:16', resolution: '1080P', duration: 10 }));
    assert.throws(() => validateGenerationOptions(model, { duration: '5' }), /Invalid Duration/);
    assert.throws(() => validateGenerationOptions(model, { ratio: '21:9' }), /Invalid Aspect ratio/);
  }
  // Plain array capabilities (without { values, default } envelope) are also supported; AMR video arrays place the default first.
  const arrayModel: Model = {
    id: 'opendesign:kling-v2', provider: 'opendesign', modelId: 'kling-v2', label: 'Kling', modality: 'video', mode: 'text-to-video', source: 'live',
    nativeOptions: { ratios: ['16:9', '9:16'], resolutions: ['720p', '1080p'], durations: [5, 10] },
  };
  const schema = generationOptions(arrayModel)!;
  assert.deepEqual(schema.fields.map(f => f.key), ['ratio', 'resolution', 'duration']);
  assert.deepEqual(schema.fields.map(f => f.default), ['16:9', '720p', 5]);
});

test('OpenDesign Cloud and account image models derive paired profiles, complete missing pair values, and fall back to sizes', () => {
  const profiled: Model = {
    id: 'account:nano-banana-2', provider: 'account', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [
            { aspect_ratio: '1:1', resolution: '1K' },
            { aspect_ratio: '1:1', resolution: '2K' },
            { aspect_ratio: '16:9', resolution: '2K' },
            { aspect_ratio: '9:16', resolution: '2K' },
          ],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
      },
      quality: { values: ['standard', 'high'], default: 'standard' },
    },
  };
  const schema = generationOptions(profiled)!;
  assert.deepEqual(schema.fields.map(f => [f.key, f.default, f.presentation]), [
    ['aspect_ratio', '1:1', 'ratio'],
    ['resolution', '1K', undefined],
    ['quality', 'standard', undefined],
  ]);
  assert.deepEqual(compatibleImageResolutions(profiled, '1:1'), ['1K', '2K']);
  assert.deepEqual(compatibleImageResolutions(profiled, '16:9'), ['2K']);
  assert.deepEqual(resolveGenerationParameters(profiled, { aspect_ratio: '16:9' }), { aspect_ratio: '16:9', resolution: '2K' });
  assert.deepEqual(resolveGenerationParameters(profiled, { aspect_ratio: '1:1' }), { aspect_ratio: '1:1', resolution: '1K' });
  assert.deepEqual(resolveGenerationParameters(profiled, { resolution: '2K' }), { resolution: '2K', aspect_ratio: '1:1' });
  assert.throws(() => resolveGenerationParameters(profiled, { aspect_ratio: '16:9', resolution: '1K' }), /Resolution 1K is not available for aspect ratio 16:9/);
  assert.throws(() => resolveGenerationParameters(profiled, { aspect_ratio: '16:9', size: '1024x1024' }), /Cannot combine size with aspect_ratio or resolution/);
  assert.throws(() => resolveGenerationParameters(profiled, { aspect_ratio: '16:9', output: { aspect_ratio: '1:1', resolution: '1K' } }), /Cannot combine output with aspect_ratio or resolution/);
  assert.deepEqual(resolveGenerationParameters(profiled, { size: '1024x1024' }), { size: '1024x1024' });

  const sized: Model = {
    id: 'opendesign:gpt-image-1', provider: 'opendesign', modelId: 'gpt-image-1', label: 'GPT Image', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: {
      sizes: { values: ['1024x1024', '1536x1024'], default: '1024x1024' },
      quality: { values: ['medium', 'high'], default: 'medium' },
    },
  };
  const sizedSchema = generationOptions(sized)!;
  assert.deepEqual(sizedSchema.fields.map(f => [f.key, f.default]), [['size', '1024x1024'], ['quality', 'medium']]);

  const rawSized: Model = {
    ...sized,
    nativeOptions: { sizes: ['1024x1024', '1536x1024'], quality: ['medium', 'high'] },
  };
  assert.deepEqual(generationOptions(rawSized)!.fields.map(f => [f.key, f.default]), [['size', undefined], ['quality', undefined]]);
});

test('production OpenDesign image models show only the fields they honour', () => {
  const image = (provider: string, modelId: string, nativeOptions?: Record<string, unknown>): Model => ({ id: `${provider}:${modelId}`, provider, modelId, label: modelId, modality: 'image', mode: 'text-to-image', source: 'live', nativeOptions });
  const fields = (model: Model) => generationOptions(model)?.fields.map(f => [f.key, f.choices?.map(c => c.value), f.default]);
  // Seedream 5.5 publishes a 1:1 profile, but only size is offered: other ratios fail and size excludes output.
  const profiles = { profiles: { generations: { profiles: [{ aspect_ratio: '1:1', resolution: '1K' }, { aspect_ratio: '1:1', resolution: '2K' }] } } };
  assert.deepEqual(fields(image('opendesign', 'seedream-5.5', profiles)), [['size', ['1K', '2K'], '1K']]);
  assert.deepEqual(fields(image('account', 'seedream-5.0-flash')), [['size', ['1K', '1.5K', '2K'], '1K']]);
  assert.deepEqual(fields(image('opendesign', 'gpt-image-2.6-flare')), [['quality', ['low', 'medium', 'high'], 'low'], ['background', ['transparent'], undefined]]);
  assert.deepEqual(fields(image('account', 'gpt-image-2.6-sunburst', { quality: { values: ['low', 'high'], default: 'high' } })), [['quality', ['low', 'high'], 'high'], ['background', ['transparent'], undefined]]);
  assert.doesNotThrow(() => validateGenerationOptions(image('opendesign', 'seedream-5.0-flash'), { size: '1.5K' }));
  assert.throws(() => validateGenerationOptions(image('opendesign', 'seedream-5.5'), { size: '1.5K' }), /Invalid Resolution/);
});
test('OpenDesign image edit mode validates and filters against the distinct edits profile envelope', () => {
  const model: Model = {
    id: 'opendesign:nano-banana-2', provider: 'opendesign', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    supportsImageReference: true,
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [
            { aspect_ratio: '1:1', resolution: '1K' },
            { aspect_ratio: '16:9', resolution: '2K' },
          ],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
        edits: {
          profiles: [{ aspect_ratio: '1:1', resolution: '2K' }],
          default: { aspect_ratio: '1:1', resolution: '2K' },
        },
      },
    },
  };
  assert.deepEqual(generationOptions(model, false)!.fields.map(f => [f.key, f.choices!.map(c => c.value)]), [
    ['aspect_ratio', ['1:1', '16:9']],
    ['resolution', ['1K', '2K']],
  ]);
  assert.deepEqual(generationOptions(model, true)!.fields.map(f => [f.key, f.choices!.map(c => c.value)]), [
    ['aspect_ratio', ['1:1']],
    ['resolution', ['2K']],
  ]);
  assert.deepEqual(compatibleImageResolutions(model, '16:9', false), ['2K']);
  assert.deepEqual(compatibleImageResolutions(model, '16:9', true), []);
  assert.deepEqual(compatibleImageResolutions(model, '1:1', true), ['2K']);
  assert.deepEqual(resolveGenerationParameters(model, { aspect_ratio: '1:1' }, true), { aspect_ratio: '1:1', resolution: '2K' });
  assert.throws(() => resolveGenerationParameters(model, { aspect_ratio: '16:9', resolution: '2K' }, true), /Aspect ratio 16:9 is not available/);
  assert.throws(() => resolveGenerationParameters(model, { aspect_ratio: '16:9' }, true), /Aspect ratio 16:9 is not available/);
  assert.throws(() => resolveGenerationParameters(model, { resolution: '1K' }, true), /Resolution 1K is not available/);
  assert.throws(() => resolveGenerationParameters(model, { images: ['ma_1'], aspect_ratio: '16:9', resolution: '2K' }), /Aspect ratio 16:9 is not available/);
  assert.throws(() => validateGenerationOptions(model, { aspect_ratio: '16:9', resolution: '2K' }, true), /Invalid Aspect ratio/);
  assert.doesNotThrow(() => validateGenerationOptions(model, { aspect_ratio: '1:1', resolution: '2K' }, true));
  // Saved generation-only defaults are dropped during edit mode when the caller did not specify them.
  const withDefaults: Model = { ...model, defaults: { aspect_ratio: '16:9', resolution: '1K' } };
  assert.deepEqual(resolveGenerationParameters(withDefaults, {}, true), {});
});

test('OpenDesign Cloud packs image aspect_ratio and resolution into output, preserves explicit output, and rejects lone fields without profiles', async () => {
  const bodies: Record<string, unknown>[] = [];
  const model: Model = {
    id: 'opendesign:nano-banana-2', provider: 'opendesign', modelId: 'nano-banana-2', label: 'Nano Banana 2', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: {
      profiles: {
        generations: {
          profiles: [{ aspect_ratio: '9:16', resolution: '2K' }, { aspect_ratio: '1:1', resolution: '1K' }],
          default: { aspect_ratio: '1:1', resolution: '1K' },
        },
      },
    },
  };
  const unprofiled: Model = { id: 'opendesign:custom-image', provider: 'opendesign', modelId: 'custom-image', label: 'Custom Image', modality: 'image', mode: 'text-to-image', source: 'live' };
  const run = async (target: Model, parameters: Record<string, unknown>) => providerAdapters.opendesign.generate(
    { id: 'job-1', model: target, modality: 'image', prompt: 'A poster', parameters } as GenerationJob,
    {
      key: 'fixture-only', baseUrl: 'https://cloud.example', signal: new AbortController().signal, progress: async () => {}, pollMs: 0,
      fetcher: async (url, init) => {
        if (init?.method === 'POST') {
          bodies.push(JSON.parse(String(init.body)));
          return Response.json({ task_id: 'task_1' });
        }
        assert.match(String(url), /\/images\/tasks\/task_1$/);
        return Response.json({ status: 'succeeded', assets: [{ url: 'https://cdn.example/out.png' }] });
      },
    },
  );
  await run(model, { aspect_ratio: '9:16', quality: 'high' });
  await run(model, { output: { aspect_ratio: '1:1', resolution: '1K' } });
  await run(unprofiled, { aspect_ratio: '16:9', resolution: '2K' });
  assert.deepEqual(bodies[0], { model: 'nano-banana-2', prompt: 'A poster', quality: 'high', output: { aspect_ratio: '9:16', resolution: '2K' } });
  assert.deepEqual(bodies[1], { model: 'nano-banana-2', prompt: 'A poster', output: { aspect_ratio: '1:1', resolution: '1K' } });
  assert.deepEqual(bodies[2], { model: 'custom-image', prompt: 'A poster', output: { aspect_ratio: '16:9', resolution: '2K' } });
  await assert.rejects(run(unprofiled, { aspect_ratio: '16:9' }), /require both aspect_ratio and resolution together/);
  await assert.rejects(run(unprofiled, { resolution: '2K' }), /require both aspect_ratio and resolution together/);
  await assert.rejects(run(unprofiled, { aspect_ratio: '16:9', resolution: '2K', size: '1024x1024' }), /Cannot combine size/);
  await assert.rejects(run(unprofiled, { aspect_ratio: '16:9', resolution: '2K', output: { aspect_ratio: '1:1', resolution: '1K' } }), /Cannot combine output/);
  assert.equal(bodies.length, 3);
});

test('account media model sync preserves capabilities in nativeOptions for generationOptions and exposes first-frame maxInputImages', () => fixture(async store => {
  const account = new OpenDesignAccount(store.directory, {
    run: async args => {
      if (args[0] === 'model') return JSON.stringify({ source: 'remote', data: [] });
      if (args[0] === 'media') return JSON.stringify({
        models: [
          { model: 'wan-2.7', kind: 'video', capabilities: { max_input_images: 1, ratios: { values: ['16:9', '9:16'], default: '16:9' }, durations: { values: [5, 10], default: 5 } } },
          { model: 'multi-video', kind: 'video', capabilities: { max_input_images: 2 } },
          { model: 'text-only-video', kind: 'video', capabilities: {} },
        ],
      });
      return '{}';
    },
  });
  account.identity = async () => 'fixture-session';
  (account as any).profile = async () => ({ runtimeKey: 'runtime-key' });
  try {
    await account.models(true);
    const videos = await account.mediaModels();
    const wan = videos.find(m => m.modelId === 'wan-2.7')!;
    assert.equal(wan.id, 'account:wan-2.7');
    assert.equal(wan.maxInputImages, 1);
    assert.deepEqual(generationOptions(wan)!.fields.map(f => f.key), ['ratio', 'duration']);
    assert.equal(videos.find(m => m.modelId === 'multi-video')?.maxInputImages, 1);
    assert.equal(videos.find(m => m.modelId === 'text-only-video')?.maxInputImages, undefined);
  } finally { account.close(); }
}));

test('OpenDesign account and Cloud image models without profiles reject incomplete pairs and conflicting size/output before submission', () => fixture(async store => {
  let calls = 0;
  const account = new OpenDesignAccount(store.directory, { run: async () => { calls++; throw new Error('unexpected connector call'); } });
  account.identity = async () => 'fixture-session';
  account.summary = async () => ({ state: 'signed-in' } as AccountSummary);
  const seedream: Model = {
    id: 'account:seedream-5.0-flash', provider: 'account', modelId: 'seedream-5.0-flash', label: 'Seedream 5.0 Flash', modality: 'image', mode: 'text-to-image', source: 'live',
    nativeOptions: { sizes: { values: ['1K', '1.5K', '2K'], default: '2K' } },
  };
  const seedreamCloud: Model = { ...seedream, id: 'opendesign:seedream-5.5', provider: 'opendesign', modelId: 'seedream-5.5' };
  const job = { model: seedream, modality: 'image', prompt: 'Poster', providerOrigin: 'fixture-session', parameters: {} } as GenerationJob;
  try {
    assert.throws(() => resolveGenerationParameters(seedream, { resolution: '2K' }), /require both aspect_ratio and resolution together/);
    assert.throws(() => resolveGenerationParameters(seedream, { aspect_ratio: '16:9' }), /require both aspect_ratio and resolution together/);
    assert.throws(() => resolveGenerationParameters(seedream, { aspect_ratio: '16:9', resolution: '2K', size: '2K' }), /Cannot combine size with aspect_ratio or resolution/);
    assert.throws(() => resolveGenerationParameters(seedreamCloud, { size: '2K', output: { aspect_ratio: '1:1', resolution: '2K' } }), /Cannot combine size with output/);
    await assert.rejects(account.generate({ ...job, parameters: { resolution: '2K' } }, store.directory, new AbortController().signal, async () => {}), /require both aspect_ratio and resolution together/);
    await assert.rejects(account.generate({ ...job, parameters: { aspect_ratio: '16:9' } }, store.directory, new AbortController().signal, async () => {}), /require both aspect_ratio and resolution together/);
    await assert.rejects(account.generate({ ...job, parameters: { size: '2K', aspect_ratio: '1:1', resolution: '2K' } }, store.directory, new AbortController().signal, async () => {}), /Cannot combine size/);
    assert.equal(calls, 0);
  } finally { account.close(); }
}));

test('videoModelLabel and videoModelBadge cover Seedance 2.5, Seedance 2.5 Flash, Wan 2.7 and BYOK passthrough', () => {
  assert.equal(videoModelLabel({ modelId: 'doubao-seedance-2-5-260628', label: 'doubao-seedance-2-5-260628' }), 'Seedance 2.5');
  assert.equal(videoModelLabel({ modelId: 'doubao-seedance-2-5-flash-261115', label: 'doubao-seedance-2-5-flash-261115' }), 'Seedance 2.5 Flash');
  assert.equal(videoModelLabel({ modelId: 'wan-2.7', label: 'wan-2.7' }), 'Wan 2.7');
  assert.equal(videoModelLabel({ modelId: 'fal-ai/wan/v2.2', label: 'Wan 2.2' }), 'Wan 2.2');
  assert.equal(videoModelBadge({ modelId: 'doubao-seedance-2-5-flash-261115' }), 'New');
  assert.equal(videoModelBadge({ modelId: 'doubao-seedance-2-5-260628' }), 'Popular');
  assert.equal(videoModelBadge({ modelId: 'wan-2.7' }), 'Popular');
});

test('videoFeaturePrompt composes structured camera and multi-shot directions', () => {
  const cam = videoFeaturePrompt('camera-control', 'A ceramic cup steaming on oak', { movement: 'orbit', pace: 'slow' });
  assert.match(cam, /360-degree camera orbit/);
  assert.match(cam, /slow, deliberate cinematic pacing/);
  assert.match(cam, /A ceramic cup steaming on oak$/);

  const multi = videoFeaturePrompt('multi-shot', 'A surfer catching sunrise waves', { shots: '4', style: 'match' });
  assert.match(multi, /4-shot storyboard sequence/);
  assert.match(multi, /match cuts/);

  assert.deepEqual(defaultVideoFeatureChoices('camera-control'), { movement: 'push-in', pace: 'slow' });
  assert.deepEqual(defaultVideoFeatureChoices('multi-shot'), { shots: '3', style: 'narrative' });
  const multiDefault = videoFeaturePrompt('multi-shot', 'A cyclist crossing a misty bridge');
  assert.match(multiDefault, /3-shot narrative sequence/);
  assert.match(multiDefault, /establishing wide shot to medium action and an intimate close-up/);
  assert.equal(videoFeaturePrompt('camera-control', '   '), '');
});

test('videoFeatureParameters seeds 10s for multi-shot only on known OpenDesign models', () => {
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'opendesign', modelId: 'doubao-seedance-2-5-260628' }), { duration: 10 });
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'opendesign', modelId: 'doubao-seedance-2-5-flash-261115' }), { duration: 10 });
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'opendesign', modelId: 'wan-2.7' }), { duration: 10 });

  // Unknown or BYOK models must never receive undeclared duration parameters.
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'fal', modelId: 'fal-ai/wan/v2.2' }), {});
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'opendesign', modelId: 'unknown-future-model' }), {});
});

const capImageModel = (overrides: Partial<Model>): Model => ({
  id: 'opendesign:test-image',
  provider: 'opendesign',
  modelId: 'test-image',
  label: 'Test Image',
  modality: 'image',
  mode: 'text-to-image',
  source: 'live',
  ...overrides,
});

const capVideoModel = (overrides: Partial<Model>): Model => ({
  id: 'opendesign:test-video',
  provider: 'opendesign',
  modelId: 'test-video',
  label: 'Test Video',
  modality: 'video',
  mode: 'text-to-video',
  source: 'live',
  ...overrides,
});

const placeholderOpenDesignModel = (provider: 'opendesign' | 'account', modelId: string): Model => {
  const entry = openDesignModels.find(item => item.modelId === modelId)!;
  const placeholder: Model = {
    id: `${provider}:${entry.modelId}`,
    provider,
    modelId: entry.modelId,
    label: entry.label,
    modality: entry.modality,
    mode: entry.mode,
    source: 'builtin',
  };
  const cap = entry.modality === 'image' ? openDesignImageReferenceCap(entry.modelId) : undefined;
  if (cap) Object.assign(placeholder, { supportsImageReference: true, maxInputImages: cap });
  else if (entry.modality === 'video') Object.assign(placeholder, { maxInputImages: 1 });
  const options = generationOptions(placeholder);
  return options ? { ...placeholder, generationOptions: options } : placeholder;
};

test('existing OpenDesign image and video models keep exact feature eligibility across Cloud, account and placeholders', () => {
  const imageMatrix: [string, Record<ImageFeatureId, boolean>][] = [
    ['gpt-image-2.6-sunburst', { 'remove-background': true, relight: true, character: true }],
    ['gpt-image-2.6-flare', { 'remove-background': true, relight: true, character: true }],
    ['seedream-5.5', { 'remove-background': false, relight: true, character: true }],
    ['seedream-5.0-flash', { 'remove-background': false, relight: true, character: true }],
  ];
  const videoMatrix: [string, Record<VideoFeatureId, boolean>][] = [
    ['doubao-seedance-2-5-260628', { 'camera-control': true, 'multi-shot': true }],
    ['doubao-seedance-2-5-flash-261115', { 'camera-control': true, 'multi-shot': true }],
    ['wan-2.7', { 'camera-control': true, 'multi-shot': true }],
  ];

  for (const provider of ['opendesign', 'account'] as const) {
    for (const [modelId, expected] of imageMatrix) {
      const live = capImageModel({
        id: `${provider}:${modelId}`, provider, modelId,
        supportsImageReference: true, maxInputImages: openDesignImageReferenceCap(modelId) ?? 1,
      });
      const placeholder = placeholderOpenDesignModel(provider, modelId);
      for (const candidate of [live, placeholder]) {
        for (const [feature, ok] of Object.entries(expected) as [ImageFeatureId, boolean][]) {
          assert.equal(imageFeatureSupported(feature, candidate), ok, `${provider}:${modelId} (${candidate.source}) -> ${feature}`);
        }
      }
    }
    for (const [modelId, expected] of videoMatrix) {
      const live = capVideoModel({ id: `${provider}:${modelId}`, provider, modelId, maxInputImages: 1 });
      const placeholder = placeholderOpenDesignModel(provider, modelId);
      for (const candidate of [live, placeholder]) {
        for (const [feature, ok] of Object.entries(expected) as [VideoFeatureId, boolean][]) {
          assert.equal(videoFeatureSupported(feature, candidate), ok, `${provider}:${modelId} (${candidate.source}) -> ${feature}`);
        }
      }
    }
  }
});

test('modelCapabilities derives image edit, reference limits and transparent background without model ID allowlists', () => {
  const futureTransparent = capImageModel({
    id: 'opendesign:future-studio-image-v3',
    modelId: 'future-studio-image-v3',
    supportsImageReference: true,
    maxInputImages: 8,
    nativeOptions: { background: ['opaque', 'transparent'] },
  });
  const futureNoEdit = capImageModel({
    id: 'opendesign:future-txt2img-only',
    modelId: 'future-txt2img-only',
    supportsImageReference: false,
    maxInputImages: 0,
  });
  // An image-to-image endpoint with zero reference limit cannot satisfy reference-backed image features.
  const zeroRefI2i = capImageModel({
    id: 'opendesign:broken-i2i',
    modelId: 'broken-i2i',
    mode: 'image-to-image',
    supportsImageReference: false,
    maxInputImages: 0,
    nativeOptions: { background: ['transparent'] },
  });
  const codex = capImageModel({ id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', source: 'builtin', supportsImageReference: true, maxInputImages: 1 });
  const falFlux = capImageModel({ id: 'fal:fal-ai/flux/schnell', provider: 'fal', modelId: 'fal-ai/flux/schnell', source: 'builtin' });

  assert.deepEqual(modelCapabilities(futureTransparent).image, { edit: true, maxReferences: 8, transparentBackground: true });
  assert.deepEqual(modelCapabilities(futureNoEdit).image, { edit: false, maxReferences: 0, transparentBackground: false });
  assert.deepEqual(modelCapabilities(zeroRefI2i).image, { edit: false, maxReferences: 0, transparentBackground: true });
  assert.deepEqual(modelCapabilities(codex).image, { edit: true, maxReferences: 1, transparentBackground: true });
  assert.deepEqual(modelCapabilities(falFlux).image, { edit: false, maxReferences: 0, transparentBackground: false });

  assert.equal(imageFeatureSupported('remove-background', futureTransparent), true);
  assert.equal(imageFeatureSupported('relight', futureTransparent), true);
  assert.equal(imageFeatureSupported('character', futureTransparent), true);
  assert.equal(imageFeatureSupported('relight', futureNoEdit), false);
  assert.equal(imageFeatureSupported('character', futureNoEdit), false);
  assert.equal(imageFeatureSupported('remove-background', zeroRefI2i), false);

  // Pure capability checks remain provider-agnostic, while Studio feature checks scope to OpenDesign.
  assert.equal(imageFeatureCapable('remove-background', codex), true);
  assert.equal(imageFeatureSupported('remove-background', codex), false);
  assert.equal(imageFeatureCapable('relight', falFlux), false);
});

test('videoFeatureParameters strictly honors published duration schemas and keeps BYOK consistent', () => {
  // Seedance publishing durations that omit 10s must NOT fall back to the static 4–30s table.
  const narrowSeedance = capVideoModel({
    modelId: 'doubao-seedance-2-5-260628',
    maxInputImages: 1,
    nativeOptions: { durations: [5, 4, 6, 8, 12] },
  });
  const narrowWan = capVideoModel({
    modelId: 'wan-2.7',
    maxInputImages: 1,
    nativeOptions: { durations: [5, 2, 15] },
  });
  const futureVideo = capVideoModel({
    id: 'opendesign:future-video-3',
    modelId: 'future-video-3',
    nativeOptions: { durations: [4, 5, 10, 20] },
  });
  const imageOnlyVideo = capVideoModel({
    id: 'opendesign:future-i2v-only',
    modelId: 'future-i2v-only',
    mode: 'image-to-video',
    maxInputImages: 1,
  });
  const atlasSeedance = capVideoModel({
    id: 'atlascloud:bytedance/seedance-2.0/text-to-video',
    provider: 'atlascloud',
    modelId: 'bytedance/seedance-2.0/text-to-video',
    source: 'builtin',
  });

  assert.deepEqual(videoFeatureParameters('multi-shot', narrowSeedance), {});
  assert.deepEqual(videoFeatureParameters('multi-shot', narrowWan), {});
  assert.deepEqual(videoFeatureParameters('multi-shot', futureVideo), { duration: 10 });
  assert.equal(videoFeatureSupported('camera-control', futureVideo), true);
  assert.equal(videoFeatureSupported('multi-shot', imageOnlyVideo), false);

  // BYOK video models never receive OpenDesign seeded parameters regardless of full Model vs Pick shape,
  // while remaining capability-eligible for provider-agnostic consumers such as Workflows.
  assert.deepEqual(videoFeatureParameters('multi-shot', atlasSeedance), {});
  assert.deepEqual(videoFeatureParameters('multi-shot', { provider: 'atlascloud', modelId: 'bytedance/seedance-2.0/text-to-video' }), {});
  assert.equal(videoFeatureCapable('multi-shot', atlasSeedance), true);
  assert.equal(videoFeatureCapable('camera-control', atlasSeedance), true);
  assert.equal(videoFeatureSupported('multi-shot', atlasSeedance), false);
});

test('modelReferenceLimit falls back to measured caps for OpenDesign Cloud models omitting max_input_images', () => {
  const freshSunburst = capImageModel({
    id: 'opendesign:gpt-image-2.6-sunburst',
    modelId: 'gpt-image-2.6-sunburst',
    supportsImageReference: true,
    nativeOptions: { edits: true },
  });
  const staleCachedSunburst = capImageModel({
    id: 'opendesign:gpt-image-2.6-sunburst',
    modelId: 'gpt-image-2.6-sunburst',
    supportsImageReference: true,
    maxInputImages: 1,
    nativeOptions: { edits: true },
  });
  const explicitSingleSunburst = capImageModel({
    id: 'opendesign:gpt-image-2.6-sunburst',
    modelId: 'gpt-image-2.6-sunburst',
    supportsImageReference: true,
    maxInputImages: 1,
    nativeOptions: { edits: true, max_input_images: 1 },
  });
  const freshFlash = capImageModel({
    id: 'opendesign:seedream-5.0-flash',
    modelId: 'seedream-5.0-flash',
    supportsImageReference: true,
    nativeOptions: { edits: true },
  });
  const seedream55 = capImageModel({
    id: 'opendesign:seedream-5.5',
    modelId: 'seedream-5.5',
    supportsImageReference: true,
    maxInputImages: 4,
    nativeOptions: { edits: true, max_input_images: 4 },
  });
  const unknownCloud = capImageModel({
    id: 'opendesign:future-single-ref',
    modelId: 'future-single-ref',
    supportsImageReference: true,
    nativeOptions: { edits: true },
  });

  assert.equal(modelCapabilities(freshSunburst).image.maxReferences, 16);
  assert.equal(modelCapabilities(staleCachedSunburst).image.maxReferences, 16);
  assert.equal(modelCapabilities(explicitSingleSunburst).image.maxReferences, 1);
  assert.equal(modelCapabilities(freshFlash).image.maxReferences, 10);
  assert.equal(modelCapabilities(seedream55).image.maxReferences, 1);
  assert.equal(modelCapabilities(unknownCloud).image.maxReferences, 1);
});

test('cloudModels populates measured maxInputImages when OpenDesign Cloud omits max_input_images', async () => {
  const { cloudModels } = await import('../gateway/opendesign.ts');
  const models = await cloudModels('https://cloud.example', 'test-key', (async () => Response.json({
    models: [
      { model: 'gpt-image-2.6-sunburst', kind: 'image', capabilities: { edits: true } },
      { model: 'seedream-5.0-flash', kind: 'image', capabilities: { edits: true } },
      { model: 'seedream-5.5', kind: 'image', capabilities: { edits: true } },
      { model: 'future-unknown-image', kind: 'image', capabilities: { edits: true } },
    ],
  })) as never);
  const byId = new Map(models.map(model => [model.modelId, model.maxInputImages]));
  assert.equal(byId.get('gpt-image-2.6-sunburst'), 16);
  assert.equal(byId.get('seedream-5.0-flash'), 10);
  assert.equal(byId.get('seedream-5.5'), 1);
  assert.equal(byId.get('future-unknown-image'), 1);
});
