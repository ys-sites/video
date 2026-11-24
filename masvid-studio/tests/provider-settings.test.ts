import test from 'node:test';
import { mediaBytes } from './media-fixtures.ts';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, readdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { execFile, spawn, type SpawnOptions } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures.ts';
import { gatewayFor, ModelGateway } from '../gateway/service.ts';
import { ProviderConnections, connectionBaseUrl } from '../gateway/connections.ts';
import { AccountRequestError, OpenDesignAccount, systemBrowserCommand, type SignInRecord } from '../gateway/account.ts';
import { accountDirectory, sharedAccountDirectory } from '../gateway/account-directory.ts';
import { ConnectorUnavailable, findNpmCli, installConnector, manualInstallCommand, npmCliCandidates } from '../gateway/account-connector.ts';
import { createTracker, validProperties } from '../tracking/core.ts';
import { createPosthogSender } from '../tracking/node.ts';
import { omEvents } from '../tracking/events.ts';
import { providerDirectory, setDefaultModel } from '../gateway/settings.ts';
import { mediaUse } from '../gateway/media-use.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import type { Fetcher } from '../gateway/network.ts';
import { providerRegistry, mediaProviders, registeredProvider } from '../shared/provider-registry.ts';
import { providerAdapters } from '../gateway/providers.ts';
import { transport } from './http.ts';
import { callTool } from '../mcp.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2ioAAAAASUVORK5CYII=', 'base64');
const binary = fileURLToPath(new URL('./fixtures/account-cli.mjs', import.meta.url));
function imageTransport(directory: string) {
  const home = path.join(directory, 'account', 'credentials');
  return {
    fetcher: (async (input: any, init: any) => {
      assert.match(String(input), /^https:\/\/amr-api.open-design.ai\/api\/v1\/media\/images\/tasks\/fixture-task-\d+$/);
      assert.equal(init.headers.Authorization, 'Bearer synthetic-private-control-key');
      const taskId = String(input).split('/').at(-1)!;
      const calls = JSON.parse(await readFile(path.join(home, 'submissions.json'), 'utf8')) as string[][];
      const args = calls[Number(taskId.split('-').at(-1)) - 1];
      return Response.json({ task_id: taskId, status: 'succeeded', model: args[args.indexOf('--model') + 1],
        assets: [{ asset_id: 'fixture-asset', status: 'ready', mime_type: 'image/png', size_bytes: png.length, url: 'https://media.example/image' }] });
    }) as Fetcher,
    download: async () => new Response(png, { headers: { etag: '"fixture"', 'content-length': String(png.length) } }),
  };
}

async function until(check: () => Promise<boolean>) { for (let n = 0; n < 500; n++) { if (await check()) return; await delay(20); } throw new Error('Fixture timed out'); }
async function finish(store: any, id: string) { const g = gatewayFor(store); await g.tick(); await Promise.all([...g.active.values()].map(task => task.done)); return g.getJob(id); }
async function signIn(account: OpenDesignAccount) {
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes');
  await until(async () => (await account.summary()).state === 'signed-in');
}

test('one registry supplies the settings directory and every dedicated media adapter', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  assert.equal(new Set(providerRegistry.map(provider => provider.id)).size, providerRegistry.length);
  assert.deepEqual(Object.keys(providerAdapters).sort(), [...mediaProviders].sort());
  const directory = await providerDirectory(gateway);
  assert.deepEqual(directory.providers.map(provider => provider.id).sort(), providerRegistry.map(provider => provider.id).sort());
  for (const provider of directory.providers) {
    const definition = registeredProvider(provider.id)!;
    assert.equal(provider.label, definition.label);
    assert.equal(provider.baseUrlEditable, definition.baseUrlEditable);
    assert.equal(provider.website, definition.website);
    if (definition.integration === 'media') assert.equal(provider.docs, `/motion-api/models/providers/${provider.id}/reference`);
  }
  await gateway.close();
}));

test('legacy files retain credentials, models and defaults across shared HTTP, MCP and configuration writes', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const root = gateway.root, custom = 'custom-existing-1';
  const model = { id: 'openai:picture', provider: 'openai', modelId: 'picture', label: 'Saved picture', kind: 'image', enabled: true, source: 'custom' };
  const files = {
    'config.json': { version: 1, providers: { codex: { enabled: false }, fal: { enabled: true, verification: 'verified', keyHash: createHash('sha256').update('legacy-fal-key').digest('hex'), checkedAt: 123 }, opendesign: { baseUrl: 'https://cloud.example', enabled: true } },
      routes: { image: 'openai:picture' }, customModels: [{ id: 'fal:saved-model', provider: 'fal', modelId: 'saved-model', label: 'Saved media', modality: 'video', mode: 'text-to-video', source: 'custom' }] },
    'secrets.json': { fal: 'legacy-fal-key', opendesign: 'legacy-cloud-key' },
    'connections.json': { providers: { openai: { enabled: true }, [custom]: { custom: true, label: 'Saved endpoint', protocol: 'openai', baseUrl: 'https://saved.example/v1', enabled: true, revision: 'saved-revision' } },
      models: [model, { id: custom + ':language', provider: custom, modelId: 'language', label: 'Saved language', kind: 'text', enabled: true, source: 'custom' }],
      defaults: { text: custom + ':language' }, modelOverrides: { 'fal:saved-model': { group: 'Saved group', defaults: { duration: 5 } } } },
    'connection-secrets.json': { openai: 'legacy-openai-key', [custom]: 'legacy-custom-key' },
  };
  await mkdir(root, { recursive: true });
  for (const [file, content] of Object.entries(files)) await writeFile(path.join(root, file), JSON.stringify(content), { mode: 0o600 });
  const before = await Promise.all(Object.keys(files).map(file => readFile(path.join(root, file), 'utf8')));
  const previous = process.env.FAL_KEY; process.env.FAL_KEY = 'environment-fal-key';
  try {
    const request = transport(store), directory = await (await request('/motion-api/settings/providers')).json();
    assert.equal(directory.defaults.image, model.id); assert.equal(directory.defaults.text, custom + ':language');
    assert.equal(directory.models.find((row: any) => row.id === 'fal:saved-model').group, 'Saved group');
    assert.equal(directory.providers.find((row: any) => row.id === 'opendesign').baseUrl, 'https://cloud.example');
    assert.equal((await gateway.status()).providers.find(provider => provider.id === 'fal')!.verification, 'verified');
    assert.equal(await gateway.connections.credential('fal'), 'legacy-fal-key');
    assert.equal(await gateway.connections.credential(custom), 'legacy-custom-key');
    assert.equal(await gateway.connections.identity(custom), 'saved-revision');
    assert.deepEqual(await Promise.all(Object.keys(files).map(file => readFile(path.join(root, file), 'utf8'))), before, 'Reading old configuration must not rewrite it');
    assert.doesNotMatch(JSON.stringify(directory), /legacy-.*-key|environment-fal-key/);
    const publicFields = new Set(['id', 'label', 'protocol', 'baseUrl', 'kinds', 'category', 'website', 'docs', 'setupRequired', 'baseUrlEditable', 'configured', 'enabled', 'available', 'custom', 'credentialSource', 'reason', 'verification']);
    for (const provider of [...directory.providers, ...await gateway.connections.list()]) {
      assert.deepEqual(Object.keys(provider).filter(key => !publicFields.has(key)), [], `${provider.id} must contain only public connection fields`);
    }

    const update = await request('/motion-api/settings/providers/fal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: 'replacement-fal-key' }) });
    assert.equal(update.status, 200); assert.doesNotMatch(await update.text(), /replacement-fal-key/);
    assert.equal(await gateway.connections.credential('fal'), 'replacement-fal-key');
    assert.equal((await gateway.status()).providers.find(provider => provider.id === 'fal')!.verification, 'unverified');
    await callTool('openmotion_configure_provider', { provider: 'openai', apiKey: 'replacement-openai-key' }, store);
    assert.equal(await gateway.connections.credential('openai'), 'replacement-openai-key');
    const cleared = await request('/motion-api/models/providers/fal', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: null }) });
    assert.equal(cleared.status, 200);
    assert.equal((await gateway.status()).providers.find(provider => provider.id === 'fal')!.credentialSource, 'environment');
    assert.equal(await gateway.connections.credential('fal'), 'environment-fal-key');
    const customUpdate = await request(`/motion-api/models/providers/${custom}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label: 'Renamed endpoint' }) });
    assert.equal(customUpdate.status, 200);
    assert.equal((await gateway.connections.list()).find(provider => provider.id === custom)?.label, 'Renamed endpoint');
    await gateway.connections.setDefault('image', model.id);
    await gateway.connections.setDefault('text', custom + ':language');
    const restarted = new ModelGateway(store, { detect: async () => [] });
    assert.equal((await restarted.status()).routes.image, model.id);
    assert.deepEqual(await restarted.connections.defaults(), { image: model.id, text: custom + ':language' });
    assert.equal((await restarted.config()).customModels[0].id, 'fal:saved-model');
    assert.equal(await restarted.connections.credential('opendesign'), 'legacy-cloud-key');
    assert.equal(await restarted.connections.credential(custom), 'legacy-custom-key');
    assert.equal((await stat(path.join(root, 'secrets.json'))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(root, 'connection-secrets.json'))).mode & 0o777, 0o600);
    await assert.rejects(restarted.connections.configure('codex', { apiKey: 'must-not-save' }), /own local login/);
    await assert.rejects(restarted.connections.configure('account', { apiKey: 'must-not-save' }), /account sign-in/);
    await assert.rejects(restarted.connections.configure('fal', { baseUrl: 'https://other.example' }), /built-in API origin/);
    await restarted.close();
  } finally {
    if (previous === undefined) delete process.env.FAL_KEY; else process.env.FAL_KEY = previous;
    await gateway.close();
  }
}));

test('a queued legacy media job uses its existing credential and adapter after restart', () => fixture(async store => {
  const root = path.join(store.directory, 'model-gateway'), id = randomUUID();
  await mkdir(path.join(root, 'jobs'), { recursive: true });
  await writeFile(path.join(root, 'config.json'), JSON.stringify({ version: 1, providers: { fal: { enabled: true } }, routes: {}, customModels: [] }));
  await writeFile(path.join(root, 'secrets.json'), JSON.stringify({ fal: 'queued-legacy-key' }));
  await writeFile(path.join(root, 'jobs', id + '.json'), JSON.stringify({ id, projectId: store.projectId, state: 'queued', modality: 'image', prompt: 'saved request',
    model: { id: 'fal:fal-ai/flux/schnell', provider: 'fal', modelId: 'fal-ai/flux/schnell', label: 'FLUX Schnell', modality: 'image', mode: 'text-to-image', source: 'builtin' },
    parameters: {}, requestHash: 'existing-hash', createdAt: 1, updatedAt: 1, phase: 'queued', assets: [] }));
  let submissions = 0;
  const gateway = new ModelGateway(store, { detect: async () => [], pollMs: 1, download: async () => png, fetcher: async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Key queued-legacy-key');
    if (init.method === 'POST') { submissions++; return Response.json({ request_id: 'existing-task', status_url: 'https://queue.fal.run/task/status', response_url: 'https://queue.fal.run/task/result' }); }
    return Response.json(String(url).endsWith('status') ? { status: 'COMPLETED' } : { images: [{ url: 'https://cdn.example/image.png' }] });
  } });
  try {
    await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
    const job = await gateway.getJob(id);
    assert.equal(job.state, 'completed', job.error); assert.equal(submissions, 1);
    assert.deepEqual(await readFile(path.join(store.projectDirectory, job.assets[0].path)), png);
    await gateway.tick(); assert.equal(submissions, 1);
  } finally { await gateway.close(); }
}));

test('provider registry is searchable configuration; custom keys stay private and media routes execute once', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let submissions = 0;
  const fetcher: Fetcher = async (url, init = {}) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-custom-key');
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'language' }, { id: 'picture', architecture: { output_modalities: ['image'] } }] });
    assert.equal(String(url), 'https://provider.example/prefix/v1/images/generations');
    assert.equal(init.method, 'POST'); assert.deepEqual(JSON.parse(String(init.body)), { model: 'picture', prompt: 'cup' });
    submissions++; return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  gateway.options.fetcher = fetcher; gateway.connections = new ProviderConnections(store, fetcher);
  const id = await gateway.connections.configure(null, { label: 'My provider', protocol: 'openai', baseUrl: 'https://provider.example/prefix/v1/', apiKey: 'synthetic-custom-key' });
  await gateway.connections.sync(id);
  const directory = await providerDirectory(gateway);
  assert(directory.providers.length >= 70); assert.equal(directory.models.find(m => m.id === id + ':picture')?.kind, 'image');
  assert.doesNotMatch(JSON.stringify(directory), /synthetic-custom-key/);
  assert.equal((await stat(path.join(gateway.root, 'connection-secrets.json'))).mode & 0o777, 0o600);
  await setDefaultModel(gateway, 'image', id + ':picture');
  assert.equal((await providerDirectory(gateway)).defaults.image, id + ':picture');
  const guide = await mediaUse(store, { action: 'reference', provider: id }); assert.match(guide.content, /images\/generations/);
  const args = { action: 'generate', provider: id, model: 'picture', projectId: store.projectId, modality: 'image', prompt: 'cup', requestId: 'only-once' };
  const first = await mediaUse(store, args); const completed = await finish(store, first.job.id);
  assert.equal(completed.state, 'completed', completed.error); assert.equal(submissions, 1);
  assert.deepEqual(await readFile(path.join(store.projectDirectory, completed.assets[0].path)), png);
  assert.equal((await mediaUse(store, args)).job.id, first.job.id);
  await assert.rejects(gateway.connections.configure(id, { baseUrl: 'https://different.example/v1' }), /API key again/);
  const queued = await gateway.submit({ model: id + ':picture', modality: 'image', prompt: 'pending' });
  await gateway.connections.configure(id, { apiKey: 'replacement-key' });
  assert.match((await finish(store, queued.id)).error!, /configuration changed/); assert.equal(submissions, 1);
  await gateway.connections.updateModel(id + ':picture', false);
  await assert.rejects(setDefaultModel(gateway, 'image', id + ':picture'), /enabled model/);
  await gateway.connections.remove(id);
  assert(!(await gateway.connections.list()).some(provider => provider.id === id));
  assert(!JSON.parse(await readFile(path.join(gateway.root, 'connection-secrets.json'), 'utf8'))[id]);
  await gateway.close();
}));

for (const protocol of ['anthropic', 'google']) test(`${protocol} catalogue uses correct auth/pagination and keeps manual models`, () => fixture(async store => {
  let page = 0;
  const connections = new ProviderConnections(store, async (url, init) => {
    page++; const headers = new Headers(init?.headers);
    assert.equal(headers.get(protocol === 'google' ? 'x-goog-api-key' : 'x-api-key'), 'synthetic-key'); assert.equal(headers.get('Authorization'), null);
    if (page === 2) assert.match(String(url), protocol === 'google' ? /pageToken=next/ : /after_id=next/);
    return Response.json(protocol === 'google' ? { models: [{ name: 'models/model-' + page, displayName: 'Model ' + page }], ...(page === 1 ? { nextPageToken: 'next' } : {}) }
      : { data: [{ id: 'model-' + page }], has_more: page === 1, last_id: 'next' });
  });
  const id = await connections.configure(null, { label: 'API', protocol, baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'text' });
  await connections.sync(id); assert.equal(page, 2); assert.equal((await connections.models()).length, 3);
}));

test('unsafe custom endpoints and failed catalogue sync cannot leak keys or erase configured models', () => fixture(async store => {
  for (const url of ['http://public.example/v1', 'https://127.0.0.1/v1', 'https://10.0.0.1/v1', 'https://user:secret@public.example/v1', 'https://public.example/v1?key=secret']) assert.throws(() => connectionBaseUrl(url));
  const connections = new ProviderConnections(store, async () => Response.json({ error: 'synthetic-secret' }, { status: 401 }));
  const id = await connections.configure(null, { label: 'API', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-secret' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'image' });
  await assert.rejects(connections.sync(id), error => { assert.doesNotMatch(String(error), /synthetic-secret/); return true; });
  assert.equal((await connections.models()).length, 1);
}));

test('account device authorization, billing, remote models and all media outputs use the same isolated session', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory) });
  t.after(() => gateway.close());
  await mkdir(account.home, { recursive: true });
  await Promise.all((['video', 'audio'] as const).map(async kind => writeFile(path.join(account.home, `fixture-${kind}`), await mediaBytes(kind))));
  assert.equal((await account.summary()).state, 'signed-out');
  await signIn(account);
  const summary = await account.summary(true);
  assert.equal(summary.plan, 'pro'); assert.equal(summary.balance, '12.50'); assert.doesNotMatch(JSON.stringify(summary), /synthetic-private/);
  assert.equal(summary.errorCode, undefined); assert.equal(summary.attempt?.receipt, 'accepted'); assert.equal(summary.attempt?.exitCode, 0);
  assert.deepEqual(summary.attempt?.stages, ['attempt_started:started', 'device_auth_create_result:success', 'activation_ready:success', 'browser_open_result:success',
    'device_authorization_result:success', 'token_exchange_result:success', 'credential_persist_result:success']);
  assert.equal((await stat(path.join(account.home, 'config.json'))).mode & 0o777, 0o600);
  const directory = await providerDirectory(gateway);
  assert(directory.providers.find(p => p.id === 'account')?.available); assert.equal(directory.models.find(m => m.modelId === 'disabled-one')?.enabled, false);
  assert.equal(directory.models.find(m => m.modelId === 'fixture-audio')?.kind, 'audio'); assert.equal(directory.models.find(m => m.modelId === 'fixture-music')?.mode, 'text-to-audio');
  for (const kind of ['image', 'video', 'audio'] as const) {
    const args = { action: 'generate', provider: 'account', model: `fixture-${kind}`, projectId: store.projectId, modality: kind, prompt: 'hello', parameters: kind === 'audio' ? { voice: 'test-voice' } : {}, requestId: 'account-' + kind };
    const queued = await mediaUse(store, args); const completed = await finish(store, queued.job.id);
    assert.equal(completed.state, 'completed', completed.error); assert.match(completed.remoteId!, /fixture-task-/);
    assert.equal((await mediaUse(store, args)).job.id, queued.job.id);
  }
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 3);
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-failure');
  assert.equal((await account.summary(true)).billingUnavailable, true);
  const queued = await gateway.submit({ model: 'account:fixture-image', modality: 'image', prompt: 'pending' });
  await account.logout(); assert.equal((await account.summary()).state, 'signed-out');
  assert.equal((await account.models()).length, 0);
  assert.equal((await finish(store, queued.id)).state, 'failed');
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 3);
  await gateway.close();
}));

test('account music, default-voice speech and one-image editing run the matching connector commands', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory) });
  t.after(() => gateway.close());
  await signIn(account); await account.models(true);
  await writeFile(path.join(account.home, 'fixture-audio'), await mediaBytes('audio'));
  const models = (await providerDirectory(gateway)).models;
  const api = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  assert.equal(models.find(m => m.modelId === 'fixture-image')?.supportsImageReference, true);
  assert.equal(models.find(m => m.modelId === 'fixture-image-basic')?.supportsImageReference, undefined);
  const submissions = async () => JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')) as string[][];

  const music = { action: 'generate', provider: 'account', model: 'fixture-music', projectId: store.projectId, modality: 'audio', mode: 'text-to-audio', prompt: 'calm piano', parameters: { duration: 12 }, requestId: 'account-music' };
  const queuedMusic = await mediaUse(store, music);
  assert.equal((await finish(store, queuedMusic.job.id)).state, 'completed');
  assert.deepEqual((await submissions()).at(-1)?.slice(0, 2), ['audio', 'music']);
  assert.deepEqual((await submissions()).at(-1)?.slice(-4), ['--no-wait', '--json', '--duration', '12']);
  await assert.rejects(mediaUse(store, { ...music, parameters: { duration: 1.5 }, requestId: 'account-music-fraction' }), /Invalid Duration/);
  // A speech-only parameter fails the music job locally, before any connector submission.
  const voiced = await mediaUse(store, { ...music, parameters: { voice: 'narrator' }, requestId: 'account-music-voice' });
  assert.equal((await finish(store, voiced.job.id)).state, 'failed');
  // A caller mode cannot switch an account model to another connector command.
  await assert.rejects(mediaUse(store, { ...music, mode: 'text-to-speech', parameters: { voice: 'narrator' }, requestId: 'account-music-as-speech' }), /does not match the selected account model/);
  assert.equal((await submissions()).length, 1);

  await writeFile(path.join(store.projectDirectoryFor(store.projectId), 'cup.png'), png);
  const editInputProject = { action: 'generate', provider: 'account', model: 'fixture-image', projectId: store.projectId, modality: 'image', prompt: 'make it blue', referenceAsset: 'cup.png', requestId: 'account-project-edit' };
  await assert.rejects(api.call('openmotion_media_use', { ...editInputProject, model: 'fixture-image-basic' }), /does not support reference image editing/);
  await assert.rejects(api.call('openmotion_media_use', { ...editInputProject, referenceAsset: '../cup.png' }));
  const { job: edit } = await api.call('openmotion_media_use', editInputProject);
  await writeFile(path.join(store.projectDirectoryFor(store.projectId), 'cup.png'), 'changed after queueing');
  assert.deepEqual(await readFile(path.join(gateway.root, 'work', edit.id, 'reference.png')), png);
  assert.equal((await api.call('openmotion_media_use', editInputProject)).job.id, edit.id);
  const edited = await finish(store, edit.id);
  assert.equal(edited.state, 'completed', edited.error); assert.equal(edited.reference?.path, 'cup.png');
  const call = (await submissions()).at(-1)!;
  assert.deepEqual(call.slice(0, 2), ['image', 'edit']);
  assert.match(call[call.indexOf('--image') + 1], /reference\.png$/);
  assert.equal((await submissions()).length, 2);

  // The public asset tool edits a pinned library version through the same connector command.
  const source = path.join(store.directory, 'cup-source.png'); await writeFile(source, png);
  const cup = await new AssetLibrary(store).importFile(source, { requestId: 'account-cup', name: 'Cup' });
  const reference = { assetId: cup.id, versionId: cup.currentVersionId };
  const editInput = { action: 'generate', requestId: 'account-library-edit', model: 'account:fixture-image', modality: 'image', mode: 'text-to-image', prompt: 'make it blue', assetId: cup.id, parentVersionId: cup.currentVersionId, references: [reference] };
  const queued = await api.call('openmotion_assets_use', editInput);
  assert.equal((await api.call('openmotion_assets', editInput)).job.id, queued.job.id, 'Compatibility replay must not submit another account edit');
  await finish(store, queued.job.id);
  const status = await api.call('openmotion_assets_use', { action: 'status', jobId: queued.job.id });
  assert.equal(status.job.state, 'completed', status.job.error);
  const versions = (await new AssetLibrary(store).get(cup.id)).versions;
  assert.equal(versions.length, 2); assert.deepEqual(versions[1].references, [reference]);
  const libraryCall = (await submissions()).at(-1)!;
  assert.deepEqual(libraryCall.slice(0, 2), ['image', 'edit']);
  assert.match(libraryCall[libraryCall.indexOf('--image') + 1], /reference\.png$/);
  assert.equal((await submissions()).length, 3, 'The replay submits no additional paid operation');

  // A checked account speech model falls back to its first voice when the caller names none.
  const speech = await mediaUse(store, { ...music, model: 'elevenlabs-v3', mode: 'text-to-speech', prompt: 'Welcome', parameters: {}, requestId: 'account-default-voice' });
  assert.equal((await finish(store, speech.job.id)).state, 'completed');
  assert.deepEqual((await submissions()).at(-1)?.slice(-2), ['--voice', '21m00Tcm4TlvDq8ikWAM']);
}));

test('signed-in accounts expose built-in audio fallbacks when omitted by the remote catalogue without overriding live entries', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory) });
  t.after(() => gateway.close());
  assert.deepEqual(await account.models(), []);
  assert.deepEqual((await gateway.listModels({ provider: 'account', modality: 'audio' })).models, []);

  await signIn(account); await account.models(true);
  await writeFile(path.join(account.home, 'fixture-audio'), await mediaBytes('audio'));
  const directory = await providerDirectory(gateway);
  // Fixture returns elevenlabs-v3 live, while omitting byteplus-tts-2 and elevenlabs-music-v2.
  assert.equal(directory.models.find(m => m.id === 'account:elevenlabs-v3')?.source, 'live');
  assert.equal(directory.models.find(m => m.id === 'account:byteplus-tts-2')?.source, 'builtin');
  assert.equal(directory.models.find(m => m.id === 'account:byteplus-tts-2')?.mode, 'text-to-speech');
  assert.equal(directory.models.find(m => m.id === 'account:elevenlabs-music-v2')?.source, 'builtin');
  assert.equal(directory.models.find(m => m.id === 'account:elevenlabs-music-v2')?.mode, 'text-to-audio');

  const listed = (await gateway.listModels({ provider: 'account', modality: 'audio' })).models;
  const musicModel = listed.find(m => m.id === 'account:elevenlabs-music-v2');
  const byteplusModel = listed.find(m => m.id === 'account:byteplus-tts-2');
  assert.equal(musicModel?.generationOptions?.fields[0]?.key, 'duration');
  assert.equal(byteplusModel?.generationOptions?.fields[0]?.default, 'zh_female_vv_uranus_bigtts');

  const queuedMusic = await mediaUse(store, { action: 'generate', provider: 'account', model: 'elevenlabs-music-v2', projectId: store.projectId, modality: 'audio', mode: 'text-to-audio', prompt: 'soft piano', parameters: { duration: 15 }, requestId: 'account-builtin-music' });
  assert.equal((await finish(store, queuedMusic.job.id)).state, 'completed');
  const submissions = JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')) as string[][];
  assert.deepEqual(submissions.at(-1)?.slice(0, 4), ['audio', 'music', '--model', 'elevenlabs-music-v2']);
  assert.deepEqual(submissions.at(-1)?.slice(-2), ['--duration', '15']);

  // A live catalogue entry with enabled=false must suppress the built-in fallback.
  const disabled = new OpenDesignAccount(store.directory, {
    run: async args => args[0] === 'model'
      ? JSON.stringify({ source: 'remote', data: [] })
      : JSON.stringify({ models: [{ model: 'elevenlabs-music-v2', kind: 'audio_music', enabled: false }] }),
  });
  t.after(() => disabled.close());
  const refreshed = await disabled.models(true);
  assert.equal(refreshed.find(m => m.id === 'account:elevenlabs-music-v2')?.enabled, false);
  assert.equal(refreshed.find(m => m.id === 'account:elevenlabs-music-v2')?.source, 'live');
  assert.equal((await disabled.mediaModels()).some(m => m.id === 'account:elevenlabs-music-v2'), false);
  assert.equal((await disabled.mediaModels()).some(m => m.id === 'account:byteplus-tts-2'), true);

  await account.logout();
  assert.deepEqual(await account.models(), []);
}));

test('account media failures report the service reason without connector output', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory) });
  t.after(() => gateway.close());
  await signIn(account); await account.models(true);
  const cases: [string, RegExp][] = [
    ['media-invalid', /^OpenDesign rejected this request for the selected model\./],
    ['media-plan', /^Your OpenDesign plan does not include this model\./],
    ['media-401', /^Your OpenDesign sign-in is no longer accepted\. Sign out/],
    ['media-unknown-code', /^OpenDesign could not complete this request\. Try again later/],
    ['media-empty-code', /^OpenDesign could not complete this request\. Try again later/],
    // The task was accepted; a failed download must not suggest choosing another model and paying again.
    ['media-get-502', /^OpenDesign accepted this task, but its result could not be read\./],
    // A rejected sign-in while reading the task keeps the sign-out hint; the account still reports signed-in.
    ['media-get-401', /^OpenDesign accepted this task, but your sign-in was rejected while reading its result\. Sign out, then sign in again/],
  ];
  for (const [scenario, expected] of cases) {
    await writeFile(path.join(account.home, 'fixture-mode'), scenario);
    const failed = await finish(store, (await gateway.submit({ model: 'account:fixture-video', modality: 'video', prompt: scenario })).id);
    assert.equal(failed.state, 'failed', scenario); assert.match(failed.error!, expected, scenario);
    assert.doesNotMatch(failed.error!, /private|fixture-user-id|HTTP/, scenario);
  }
  // Generic API errors keep their status and code; a bodiless media response keeps only its status.
  const generic = new AccountRequestError('Error: fetch billing summary: API request failed with status 401: invalid_api_key');
  assert.deepEqual([generic.status, generic.code], [401, 'invalid_api_key']); assert.match(generic.message, /Sign out, then sign in again/);
  const bodiless = new AccountRequestError('Error: media API request failed (, HTTP 504)');
  assert.deepEqual([bodiless.status, bodiless.code], [504, undefined]);
  assert.equal(new AccountRequestError('spawn failed').status, undefined);
}));

test('source installations use the connector locked with their dependencies instead of installing one at runtime', async t => {
  const packaged = createRequire(import.meta.url)('@powerformer/vela-cli').resolveVelaCliBin() as string | null;
  if (!packaged) return t.skip('The connector has no binary for this platform');
  await fixture(async store => {
    const explicit = process.env.OPENMOTION_ACCOUNT_CLI; delete process.env.OPENMOTION_ACCOUNT_CLI;
    t.after(() => { if (explicit !== undefined) process.env.OPENMOTION_ACCOUNT_CLI = explicit; });
    const account = new OpenDesignAccount(store.directory); t.after(() => account.close());
    // Preparation may install; it must pick the checkout's binary before `vela` on PATH or the private installation.
    assert.equal(await account['prepare'](), packaged);
    account['runtime'] = path.join(store.directory, 'removed-vela');
    assert.equal(await account['prepare'](), packaged);
    await assert.rejects(stat(path.join(store.directory, 'account', 'runtime')), { code: 'ENOENT' });
  });
});

test('the connector installer finds npm beside Homebrew and other Node layouts, then on PATH', { skip: process.platform === 'win32' }, async t => {
  // A Homebrew Node reports its resolved Cellar binary; npm lives under libexec there, not under lib.
  assert.deepEqual(npmCliCandidates('/opt/homebrew/Cellar/node/24.1.0/bin/node', 'darwin', {}), [
    '/opt/homebrew/Cellar/node/24.1.0/lib/node_modules/npm/bin/npm-cli.js', '/opt/homebrew/Cellar/node/24.1.0/libexec/lib/node_modules/npm/bin/npm-cli.js']);
  // npm's own entry is preferred when npm launched this process; another package manager's entry is ignored.
  assert.equal(npmCliCandidates('/usr/local/bin/node', 'darwin', { npm_execpath: '/x/npm/bin/npm-cli.js' })[0], '/x/npm/bin/npm-cli.js');
  assert.equal(npmCliCandidates('/usr/local/bin/node', 'darwin', { npm_execpath: '/x/pnpm/bin/pnpm.cjs' })[0], '/usr/local/lib/node_modules/npm/bin/npm-cli.js');
  assert.deepEqual(npmCliCandidates('C:\\Program Files\\nodejs\\node.exe', 'win32', {}), ['C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']);
  await fixture(async store => {
    const cellar = path.join(store.directory, 'Cellar/node/24.1.0'), cli = path.join(cellar, 'libexec/lib/node_modules/npm/bin/npm-cli.js');
    await mkdir(path.dirname(cli), { recursive: true }); await writeFile(cli, '');
    assert.equal(await findNpmCli(path.join(cellar, 'bin/node'), 'darwin', { PATH: '' }), cli);
    // Without npm beside Node, the `npm` link on PATH is followed to its entry.
    const bin = path.join(store.directory, 'path-bin'); await mkdir(bin); await symlink(cli, path.join(bin, 'npm'));
    assert.equal(await findNpmCli(path.join(store.directory, 'standalone/bin/node'), 'darwin', { PATH: '/missing:' + bin }), await realpath(cli));
    assert.equal(await findNpmCli(path.join(store.directory, 'standalone/bin/node'), 'darwin', { PATH: '/missing' }), undefined);
  });
});

test('the manual connector command quotes the private directory for the shell, and its failure telemetry is valid', t => fixture(async store => {
  assert.equal(manualInstallCommand("/Users/o'neil/$HOME/runtime", 'darwin'), `npm install --prefix '/Users/o'\\''neil/$HOME/runtime' --ignore-scripts @powerformer/vela-cli@0.1.10`);
  assert.equal(manualInstallCommand('C:\\Users\\me\\runtime', 'win32'), 'npm install --prefix "C:\\Users\\me\\runtime" --ignore-scripts @powerformer/vela-cli@0.1.10');
  const records: SignInRecord[] = [];
  const account = new OpenDesignAccount(store.directory, { binary: path.join(store.directory, 'missing-connector'), log: () => {}, track: record => records.push(record) });
  t.after(() => account.close());
  await account.login(); await until(async () => (await account.summary()).state !== 'authorizing');
  assert.equal(records.length, 1); assert.equal(records[0].error_code, 'connector_unavailable'); assert.equal(records[0].connector_problem, 'start_failed');
  assert(validProperties(omEvents, 'account_sign_in_result', records[0]), JSON.stringify(records[0]));
  assert.doesNotMatch(JSON.stringify(records[0]), /missing-connector|ENOENT/);
}));

test('the connector installation reports why it failed and reuses a working installation', { skip: process.platform === 'win32' }, async t => {
  await fixture(async store => {
    // A stand-in npm: installs a connector whose binary prints the requested version, or fails like an unreachable registry.
    const npm = path.join(store.directory, 'fake-npm.mjs');
    await writeFile(npm, `import { mkdirSync, writeFileSync, chmodSync, appendFileSync } from 'node:fs'; import path from 'node:path';
const prefix = process.argv[process.argv.indexOf('--prefix') + 1], mode = process.env.FAKE_NPM;
appendFileSync(path.join(path.dirname(prefix), 'npm-calls'), 'x');
if (mode === 'offline') { console.error('npm error code ECONNREFUSED'); process.exit(1); }
const pkg = path.join(prefix, 'node_modules/@powerformer/vela-cli'); mkdirSync(pkg, { recursive: true });
writeFileSync(path.join(prefix, 'package.json'), '{}');
writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@powerformer/vela-cli', main: 'index.js' }));
writeFileSync(path.join(pkg, 'vela'), '#!/bin/sh\\necho ' + (mode === 'wrong' ? '0.0.9' : '0.1.10') + '\\n'); chmodSync(path.join(pkg, 'vela'), 0o755);
writeFileSync(path.join(pkg, 'index.js'), 'exports.resolveVelaCliBin = () => __dirname + "/vela";');`);
    const install = async (name: string, mode: string, findNpm: () => Promise<string | undefined> = async () => npm) => {
      process.env.FAKE_NPM = mode;
      try { return await installConnector(path.join(store.directory, name, 'runtime'), { findNpm }); } finally { delete process.env.FAKE_NPM; }
    };
    const problem = (name: string, mode: string, findNpm?: () => Promise<string | undefined>) => install(name, mode, findNpm).then(() => assert.fail('installed'), (error: ConnectorUnavailable) => {
      assert.ok(error instanceof ConnectorUnavailable); return [error.problem, error.detail];
    });
    assert.deepEqual(await problem('none', 'ok', async () => undefined), ['npm_missing', `npm was not found next to ${process.execPath} or on PATH`]);
    const [offline, detail] = await problem('offline', 'offline'); assert.equal(offline, 'install_failed'); assert.match(detail, /ECONNREFUSED/);
    assert.equal((await problem('wrong', 'wrong'))[0], 'start_failed');
    const binary = await install('ok', 'ok'); assert.match(binary, /vela$/);
    // A data directory that cannot be written is an installation failure, not a connector that fails to start.
    await writeFile(path.join(store.directory, 'blocked'), '');
    assert.equal((await installConnector(path.join(store.directory, 'blocked', 'runtime'), { findNpm: async () => npm }).catch((error: ConnectorUnavailable) => error.problem)), 'install_failed');
    // An existing working installation is reused without running npm again.
    assert.equal(await install('ok', 'offline'), binary);
    assert.equal(await readFile(path.join(store.directory, 'ok', 'npm-calls'), 'utf8'), 'x');
  });
});

test('cancelling account authorization cannot register a provider from a late completion', t => fixture(async store => {
  await chmod(binary, 0o755); const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  assert.equal((await account.summary()).userCode, 'TEST-123');
  await account.cancel(); await writeFile(path.join(account.home, 'authorize'), 'late'); await delay(50);
  const cancelled = await account.summary();
  assert.equal(cancelled.state, 'signed-out'); assert.equal(cancelled.errorCode, undefined); assert.equal(await account.identity(), undefined); account.close();
}));

test('sign-in failures are classified by the stage reached and logged without account data', t => fixture(async store => {
  await chmod(binary, 0o755);
  const logs: string[] = [];
  const attempt = async (scenario: string, options: { authorize?: boolean; binary?: string; authorizationMs?: number } = {}) => {
    const account = new OpenDesignAccount(store.directory, { binary: options.binary ?? binary, authorizationMs: options.authorizationMs, log: line => logs.push(line) });
    t.after(() => account.close());
    await mkdir(account.home, { recursive: true });
    await writeFile(path.join(account.home, 'fixture-mode'), scenario); await rm(path.join(account.home, 'authorize'), { force: true });
    await account.login();
    if (options.authorize !== false) { await until(async () => Boolean((await account.summary()).authorizationUrl)); await writeFile(path.join(account.home, 'authorize'), 'yes'); }
    await until(async () => (await account.summary()).state !== 'authorizing');
    const summary = await account.summary();
    assert.equal(summary.state, 'signed-out', scenario); assert.equal(await account.identity(), undefined, scenario);
    assert.equal(summary.authorizationUrl, undefined); assert.equal(summary.userCode, undefined);
    return summary;
  };
  const created = await attempt('login-create-failure', { authorize: false });
  assert.equal(created.errorCode, 'setup_failed'); assert.equal(created.error, "Can't connect to OpenDesign right now. Check your network and try again.");
  assert.deepEqual(created.attempt?.stages, ['attempt_started:started', 'device_auth_create_result:failed:network_error']); assert.equal(created.attempt?.exitCode, 1);
  const missing = await attempt('', { binary: path.join(store.directory, 'missing-connector'), authorize: false });
  assert.equal(missing.errorCode, 'connector_unavailable');
  assert.equal(missing.error, "The OpenDesign sign-in component set by OPENMOTION_ACCOUNT_CLI couldn't start. Check or clear that path, then select Retry.");
  // An explicit connector path is used as is, so the private-directory command would not help it.
  assert.equal(missing.connectorInstall, undefined);
  const denied = await attempt('login-denied');
  assert.equal(denied.errorCode, 'authorization_expired'); assert.equal(denied.attempt?.stages.at(-1), 'device_authorization_result:failed:oauth_denied');
  assert.equal((await attempt('', { authorize: false, authorizationMs: 300 })).errorCode, 'authorization_expired');
  const incomplete = await attempt('login-incomplete');
  assert.equal(incomplete.errorCode, 'credentials_rejected'); assert.equal(incomplete.attempt?.receipt, 'rejected'); assert.equal(incomplete.attempt?.persisted, true);
  const unconfirmed = await attempt('login-complete-failure');
  assert.equal(unconfirmed.errorCode, 'credentials_rejected'); assert.equal(unconfirmed.attempt?.receipt, 'accepted'); assert.equal(unconfirmed.attempt?.exitCode, 1);
  assert.equal(unconfirmed.attempt?.stages.at(-1), 'credential_persist_result:success');
  const approved = await attempt('login-missing-key-id');
  assert.equal(approved.errorCode, 'credentials_rejected'); assert.equal(approved.attempt?.stages.at(-1), 'device_authorization_result:success');
  // Nothing was accepted or stored, so a transient exchange or local write failure stays retryable.
  const exchange = await attempt('login-exchange-failure');
  assert.equal(exchange.errorCode, 'setup_failed'); assert.equal(exchange.attempt?.stages.at(-1), 'token_exchange_result:failed:network_error');
  assert.equal(exchange.attempt?.persisted, false);
  const persisted = await attempt('login-persist-failure');
  assert.equal(persisted.errorCode, 'setup_failed'); assert.equal(persisted.attempt?.stages.at(-1), 'credential_persist_result:failed:credential_persist_error');
  assert.equal(persisted.attempt?.persisted, false);
  assert.equal(logs.length, 9);
  // The local log keeps why the connector was unavailable for support.
  assert.match(logs.join('\n'), /"connectorProblem":"start_failed","connectorDetail":"spawn [^"]*missing-connector ENOENT"/);
  assert.doesNotMatch(logs.join('\n'), /synthetic-private|TEST-123|open-design\.ai|fixture@example|Fixture user|fixture-user-id|private upstream/);
}));

test('an interrupted sign-in is confirmed by the next attempt, or replaced by a new authorization once the service refuses it', t => fixture(async store => {
  await chmod(binary, 0o755);
  const logs: string[] = [], records: SignInRecord[] = [];
  const account = new OpenDesignAccount(store.directory, { binary, log: line => logs.push(line), track: record => records.push(record) }); t.after(() => account.close());
  const config = path.join(account.home, 'config.json');
  const mode = async (scenario: string) => {
    await mkdir(account.home, { recursive: true });
    await writeFile(path.join(account.home, 'fixture-mode'), scenario); await rm(path.join(account.home, 'authorize'), { force: true });
  };
  const interrupt = async () => {
    await mode('login-complete-unavailable');
    await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
    await writeFile(path.join(account.home, 'authorize'), 'yes');
    await until(async () => (await account.summary()).state !== 'authorizing');
    // The service could not confirm the saved credentials: they stay pending and the failure reads as a connection problem.
    const failed = await account.summary();
    assert.equal(failed.state, 'signed-out'); assert.equal(failed.errorCode, 'setup_failed'); assert.equal(failed.attempt?.receipt, 'accepted');
    assert(JSON.parse(await readFile(config, 'utf8')).profiles.prod.pendingLogin);
  };
  await interrupt();
  await mode('');
  await account.login(); await until(async () => (await account.summary()).state !== 'authorizing');
  const resumed = await account.summary();
  assert.equal(resumed.state, 'signed-in'); assert.equal(resumed.errorCode, undefined); assert.equal(resumed.attempt?.resumed, true);
  assert.deepEqual(resumed.attempt?.stages, ['attempt_started:started', 'device_authorization_result:success', 'token_exchange_result:success', 'credential_persist_result:success']);
  await account.logout();
  await interrupt();
  // The service refuses the old attempt and the connector rolls it back; the same sign-in continues with a new link.
  // Offline, the rolled-back key stays queued for revocation next to the new session until a refresh delivers it.
  await mode('resume-rejected'); await writeFile(path.join(account.home, 'offline'), 'yes');
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  const fresh = await account.summary();
  assert.equal(fresh.state, 'authorizing'); assert.equal(fresh.userCode, 'TEST-123'); assert.equal(fresh.attempt?.resumed, undefined);
  await writeFile(path.join(account.home, 'authorize'), 'yes');
  await until(async () => (await account.summary()).state === 'signed-in');
  assert.equal(JSON.parse(await readFile(config, 'utf8')).pendingRevocations.length, 1);
  await rm(path.join(account.home, 'offline')); await account.summary(true);
  await until(async () => !JSON.parse(await readFile(config, 'utf8')).pendingRevocations);
  assert.equal((await account.summary()).state, 'signed-in');
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'revoked.json'), 'utf8')).length, 2);
  assert.equal(logs.length, 3); assert.match(logs[2], /"errorCode":"credentials_rejected".*"resumed":true/);
  assert.doesNotMatch(logs.join('\n'), /synthetic-private|TEST-123|open-design\.ai|fixture@example|fixture-user-id/);
  // The refused attempt is reported as replaced, so one click still counts as one completed sign-in.
  assert.deepEqual(records.map(record => [record.outcome, record.resumed, record.error_code]), [
    ['failure', false, 'setup_failed'], ['success', true, undefined], ['failure', false, 'setup_failed'], ['replaced', true, 'credentials_rejected'], ['success', false, undefined]]);
  assert.equal(records[3].entry_id, records[4].entry_id);
  assert.equal(records[3].entry_occurred_at, records[4].entry_occurred_at);
  assert.notEqual(records[2].entry_id, records[3].entry_id);
}));

test('completed sign-in delivers its source through the shared sender and respects opt-out', t => fixture(async store => {
  await chmod(binary, 0o755);
  const batches: any[] = [], installationId = randomUUID();
  let enabled = true;
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, isEnabled: () => enabled, flushIntervalMs: 0,
    send: createPosthogSender({ identity: { installation_id: installationId, utm_source: 'creator', created_at: new Date().toISOString() },
      appVersion: '0.0.1', env: 'test', host: 'https://collector.example', token: 'phc_test',
      fetch: async (_url, init) => { batches.push(JSON.parse(String(init?.body))); return Response.json({ status: 1 }); } }) });
  t.after(() => tracking.close());
  const account = new OpenDesignAccount(store.directory, { binary, track: record => { tracking.track('account_sign_in_result', record); } });
  t.after(() => account.close());
  await signIn(account);
  assert.equal(await tracking.flush(), 'accepted');
  const batch = batches[0].batch;
  assert.equal(batch.length, 1); assert.equal(batch[0].event, 'account_sign_in_result');
  const fields = batch[0].properties;
  assert.equal(fields.outcome, 'success'); assert.equal(fields.product, 'openmotion');
  assert.equal(fields.source_product, 'openmotion'); assert.equal(fields.source_detail, 'openmotion_editor_login');
  assert.equal(fields.amr_user_id, 'fixture-user-id');
  assert.equal(fields.installation_id, installationId); assert.equal(fields.distinct_id, installationId); assert.equal(fields.utm_source, 'creator');
  assert.notEqual(fields.entry_id, fields.attempt_id);
  assert.doesNotMatch(JSON.stringify(batches), /fixture@example|synthetic-private|TEST-123|open-design\.ai/);
  enabled = false;
  await account.logout(); await rm(path.join(account.home, 'authorize'));
  await signIn(account);
  assert.equal(await tracking.flush(), 'disabled'); assert.equal(batches.length, 1);
}));

test('finished sign-in reports the confirmed account only on success, without credentials or personal details', t => fixture(async store => {
  await chmod(binary, 0o755);
  const records: SignInRecord[] = [];
  const account = new OpenDesignAccount(store.directory, { binary, track: record => records.push(record) }); t.after(() => account.close());
  const file = (name: string) => path.join(account.home, name);
  // Holds the model catalogue sync so the step after browser approval can be observed.
  let release: (() => void) | undefined;
  const connector = (args: string[]) => new Promise<string>((resolve, reject) => execFile(binary, args, { env: { ...process.env, AMR_HOME: account.home } }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  account.options.run = async args => { if (args[0] === 'model') await new Promise<void>(resolve => { release = resolve; }); return connector(args); };
  await account.login(); await until(async () => (await account.summary()).browserOpened !== undefined);
  const waiting = await account.summary();
  assert.equal(waiting.browserOpened, true); assert.equal(waiting.syncing, undefined); assert(waiting.authorizationUrl);
  await writeFile(file('authorize'), 'yes'); await until(async () => Boolean(release));
  const syncing = await account.summary();
  assert.equal(syncing.state, 'authorizing'); assert.equal(syncing.syncing, true); assert.equal(syncing.authorizationUrl, undefined); assert.equal(records.length, 0);
  release!(); await until(async () => (await account.summary()).state === 'signed-in');
  assert.equal((await account.summary()).syncing, undefined);
  await account.logout(); await rm(file('authorize'));
  // Two clients cancelling the same attempt still count it once.
  await account.login(); await until(async () => (await account.summary()).browserOpened === true); await Promise.all([account.cancel(), account.cancel()]);
  await writeFile(file('fixture-mode'), 'login-denied');
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(file('authorize'), 'yes'); await until(async () => (await account.summary()).state !== 'authorizing');
  assert.deepEqual(records.map(record => record.outcome), ['success', 'cancelled', 'failure']);
  const [success, cancelled, failure] = records;
  const { attempt_id: _id, entry_id, entry_occurred_at, duration_ms, prepare_ms, link_ms, approved_ms, ...fixed } = success;
  assert.deepEqual(fixed, { outcome: 'success', connector_version: '0.1.10', resumed: false, last_stage: 'credential_persist_result', last_result: 'success',
    source_product: 'openmotion', source_detail: 'openmotion_editor_login', amr_user_id: 'fixture-user-id',
    browser_opened: true, receipt: 'accepted', exit_code: 0 });
  assert.match(entry_id!, /^[0-9a-f-]{36}$/); assert.notEqual(entry_id, success.attempt_id);
  assert.equal(new Date(entry_occurred_at!).toISOString(), entry_occurred_at);
  assert.equal(new Set(records.map(record => record.entry_id)).size, 3);
  assert(prepare_ms! <= link_ms! && link_ms! <= approved_ms! && approved_ms! <= duration_ms);
  assert.equal(cancelled.error_code, undefined); assert.equal(cancelled.last_stage, 'browser_open_result'); assert.equal(cancelled.approved_ms, undefined);
  assert.equal(failure.error_code, 'authorization_expired'); assert.equal(failure.error_kind, 'oauth_denied');
  assert.equal(failure.last_stage, 'device_authorization_result'); assert.equal(failure.last_result, 'failed'); assert.equal(failure.exit_code, 1);
  assert.equal(cancelled.amr_user_id, undefined); assert.equal(failure.amr_user_id, undefined);
  assert.equal(new Set(records.map(record => record.attempt_id)).size, 3);
  for (const record of records) assert(validProperties(omEvents, 'account_sign_in_result', record), JSON.stringify(record));
  assert.doesNotMatch(JSON.stringify(records), /synthetic-private|TEST-123|open-design\.ai|fixture@example|Fixture user/);
}));

test('sign-out keeps an undelivered revocation and retries it after a restart and on refresh', t => fixture(async store => {
  await chmod(binary, 0o755);
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  const file = (name: string) => path.join(account.home, name);
  const exists = (name: string) => access(file(name)).then(() => true, () => false);
  const retries = async () => await exists('retries') ? (await readFile(file('retries'), 'utf8')).length : 0;
  await signIn(account);
  await writeFile(file('offline'), 'yes');
  assert.equal((await account.logout()).state, 'signed-out'); assert.deepEqual(await account.models(), []);
  const queued = JSON.parse(await readFile(file('config.json'), 'utf8'));
  assert.equal(queued.pendingRevocations.length, 1); assert.doesNotMatch(JSON.stringify(queued.profiles), /synthetic-private/);
  await account.summary(true); await until(async () => await retries() === 1);
  assert(await exists('config.json')); assert.equal(await exists('revoked.json'), false);
  // Back online: the first status read after a restart delivers the revocation and removes the file.
  await rm(file('offline'));
  const restarted = new OpenDesignAccount(store.directory, { binary }); t.after(() => restarted.close());
  assert.equal((await restarted.summary()).state, 'signed-out');
  await until(async () => !await exists('config.json'));
  assert.equal(await retries(), 2); assert.deepEqual(JSON.parse(await readFile(file('revoked.json'), 'utf8')), ['fixture-control-key-id']);
  // A refresh retries as well.
  await rm(file('authorize')); await signIn(account);
  await writeFile(file('offline'), 'yes'); await account.logout(); await rm(file('offline'));
  await account.summary(true); await until(async () => !await exists('config.json'));
  assert.equal(await retries(), 3); assert.equal(JSON.parse(await readFile(file('revoked.json'), 'utf8')).length, 2);
}));

test('a revocation retry in flight holds back sign-in and sign-out and cannot remove the credentials they use', t => fixture(async store => {
  await chmod(binary, 0o755);
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  const file = (name: string) => path.join(account.home, name);
  // Holds every `logout --retry-pending` until released; other commands run the fixture connector.
  let release: ((output: string) => void) | undefined;
  const connector = (args: string[]) => new Promise<string>((resolve, reject) => execFile(binary, args, { env: { ...process.env, AMR_HOME: account.home } }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  const hold = () => { release = undefined; account.options.run = args => args.includes('--retry-pending') ? new Promise(resolve => { release = resolve; }) : connector(args); };
  const delivered = JSON.stringify({ ok: true, revocationPending: false });
  await signIn(account);
  await writeFile(file('offline'), 'yes'); await account.logout(); await rm(file('offline')); await rm(file('authorize'));
  hold(); await account.summary(true); await until(async () => Boolean(release));
  // Sign-in waits for the retry: no connector runs and no activation link appears before it finishes.
  await account.login(); await delay(200);
  const waiting = await account.summary();
  assert.equal(waiting.state, 'authorizing'); assert.equal(waiting.authorizationUrl, undefined);
  release!(delivered);
  await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(file('authorize'), 'yes'); await until(async () => (await account.summary()).state === 'signed-in');
  assert((await access(file('config.json')).then(() => true, () => false)));
  // Sign in again while offline so a key stays queued; the refresh at the end of sign-in starts a held retry.
  await writeFile(file('offline'), 'yes'); await account.logout(); await rm(file('authorize'));
  hold(); await signIn(account); await until(async () => Boolean(release)); await rm(file('offline'));
  // Sign-out waits for that retry, and the retry finishing during sign-out cannot remove the file first.
  let signedOut = false; const logout = account.logout().then(summary => { signedOut = true; return summary; });
  await delay(200);
  assert.equal(signedOut, false); assert(JSON.parse(await readFile(file('config.json'), 'utf8')).profiles.prod.controlKey);
  release!(delivered);
  assert.equal((await logout).state, 'signed-out');
  assert.equal(await access(file('config.json')).then(() => true, () => false), false);
}));

test('production billing uses the authenticated summary and preserves HTTP refusals', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory);
  await mkdir(account.home, { recursive: true });
  await writeFile(path.join(store.directory, 'account/session.json'), JSON.stringify({ id: 'test-session' }));
  const profile = { apiUrl: 'https://amr-api.open-design.ai', user: { id: 'test' }, controlKey: 'test-control', controlKeyId: 'test-id', runtimeKey: 'test-runtime' };
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({ profiles: { prod: profile } }));
  let response = Response.json({ membershipTier: 'pro', balanceUsd: '12.3456' });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://amr-api.open-design.ai/api/v1/billing/summary');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-control');
    assert.equal(init.redirect, 'error');
    return response;
  });
  const summary = await account.summary(true);
  assert.equal(summary.plan, 'pro'); assert.equal(summary.balance, '12.3456');
  response = Response.json({ membershipTier: 'free', balanceUsd: '0.00', totalAvailableCreditsUsd: '5.50' });
  const credited = await account.summary(true);
  assert.equal(credited.plan, 'free'); assert.equal(credited.balance, '5.50');
  response = Response.json({ error: 'workspace_billing_scope_locked' }, { status: 403 });
  const denied = await account.summary(true);
  assert.deepEqual(denied.billingError, { status: 403, code: 'workspace_billing_scope_locked' });
  assert.equal(denied.balance, undefined);
}));

test('the subscription page opens in the system browser through a one-time account intent, falling back to the plain page', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory);
  await mkdir(account.home, { recursive: true });
  await writeFile(path.join(store.directory, 'account/session.json'), JSON.stringify({ id: 'test-session' }));
  const profile = { apiUrl: 'https://amr-api.open-design.ai', user: { id: 'test' }, controlKey: 'test-control', controlKeyId: 'test-id', runtimeKey: 'test-runtime' };
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({ profiles: { prod: profile } }));
  const targets: string[] = [];
  let response: () => Response = () => Response.json({ intentId: 'intent_1-a', expiresAt: '2026-11-20T00:10:00.000Z' });
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://amr-api.open-design.ai/api/v1/auth/intents');
    assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-control');
    targets.push(JSON.parse(String(init.body)).target);
    return response();
  });
  const opened: string[] = [];
  const launch = async (url: string) => { opened.push(url); };
  assert.deepEqual(await account.openSubscription(launch), { url: 'https://open-design.ai/cloud/login?intentId=intent_1-a', opened: true });
  assert.deepEqual(opened, ['https://open-design.ai/cloud/login?intentId=intent_1-a']);
  const target = new URL(targets[0], 'https://open-design.ai'), params = target.searchParams;
  assert.equal(target.pathname, '/dashboard');
  assert.deepEqual([...params.keys()].sort(), ['billing', 'od_entry_at', 'od_entry_id', 'od_entry_source', 'od_origin']);
  assert.equal(params.get('billing'), 'plan'); assert.equal(params.get('od_origin'), 'openmotion');
  assert.equal(params.get('od_entry_source'), 'openmotion_manage_subscription');
  assert.match(params.get('od_entry_id')!, /^[0-9a-f-]{36}$/); assert.equal(new Date(params.get('od_entry_at')!).toISOString(), params.get('od_entry_at'));
  // Each open carries a fresh entry; a refused or malformed intent still opens the plain page.
  for (const refusal of [() => Response.json({ error: 'unauthorized' }, { status: 401 }), () => Response.json({ intentId: '../evil' }), () => { throw new TypeError('offline'); }]) {
    response = refusal;
    const result = await account.openSubscription(launch);
    assert.equal(new URL(result.url).origin + new URL(result.url).pathname, 'https://open-design.ai/cloud/dashboard');
    assert.equal(new URL(result.url).searchParams.get('od_origin'), 'openmotion'); assert.equal(result.opened, true);
  }
  assert.equal(new Set(targets.map(value => new URL(value, 'https://x.test').searchParams.get('od_entry_id'))).size, targets.length);
  // A launcher failure hands the link back to Studio.
  response = () => Response.json({ intentId: 'intent-2' });
  assert.deepEqual(await account.openSubscription(async () => { throw new Error('no browser'); }), { url: 'https://open-design.ai/cloud/login?intentId=intent-2', opened: false });
  // Signed out (or another connector environment): no intent request, the plain page opens.
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({ profiles: { prod: { ...profile, apiUrl: 'https://amr-api.example.test' } } }));
  const calls = targets.length;
  assert.match((await account.openSubscription(launch)).url, /^https:\/\/open-design\.ai\/cloud\/dashboard\?billing=plan&/);
  await rm(path.join(store.directory, 'account/session.json'));
  await writeFile(path.join(account.home, 'config.json'), JSON.stringify({ profiles: { prod: profile } }));
  assert.match((await account.openSubscription(launch)).url, /^https:\/\/open-design\.ai\/cloud\/dashboard\?/);
  assert.equal(targets.length, calls);
}));

test('the subscription launcher uses the system default browser on each platform', () => {
  const url = 'https://open-design.ai/cloud/login?intentId=a&b=c';
  assert.deepEqual(systemBrowserCommand(url, 'darwin'), { command: '/usr/bin/open', args: [url] });
  assert.deepEqual(systemBrowserCommand(url, 'win32'), { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] });
  assert.deepEqual(systemBrowserCommand(url, 'linux'), { command: 'xdg-open', args: [url] });
});

test('billing reads an empty tier as Free, keeps the session on refusal and asks to sign in again on a rejected key', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary }); t.after(() => gateway.close());
  const mode = (scenario: string) => writeFile(path.join(account.home, 'fixture-mode'), scenario);
  const provider = async () => (await providerDirectory(gateway)).providers.find(p => p.id === 'account')!;
  await signIn(account);
  await mode('billing-free');
  const free = await account.summary(true);
  assert.equal(free.plan, 'free'); assert.equal(free.balance, '0.00'); assert.equal(free.billingUnavailable, false);
  await mode('billing-403');
  const refused = await account.summary(true);
  assert.equal(refused.state, 'signed-in'); assert.equal(refused.billingUnavailable, true); assert.equal(refused.plan, undefined); assert.equal(refused.balance, undefined);
  assert.deepEqual(refused.billingError, { status: 403, code: 'workspace_billing_scope_locked' }); assert((await provider()).available);
  await mode('billing-failure');
  const failed = await account.summary(true);
  assert.equal(failed.billingUnavailable, true); assert.equal(failed.billingError, undefined); assert.doesNotMatch(JSON.stringify(failed), /private upstream/);
  await mode('billing-401');
  const rejected = await account.summary(true);
  assert.equal(rejected.state, 'reauth-required'); assert.equal(rejected.billingUnavailable, false); assert.equal(rejected.plan, undefined);
  assert.equal((await provider()).available, false); assert.match((await provider()).reason, /sign-in expired/);
  const gatewayAccount = (await gateway.status()).providers.find(p => p.id === 'account')!;
  assert.equal(gatewayAccount.available, false); assert.match(gatewayAccount.reason, /sign-in expired/);
  assert.equal((await account.summary()).state, 'reauth-required');
  for (const scenario of ['billing-failure', 'billing-502']) {
    await mode(scenario); assert.equal((await account.summary(true)).state, 'reauth-required', scenario);
  }
  await mode('billing-403-text');
  const untyped = await account.summary(true);
  assert.equal(untyped.state, 'signed-in'); assert.deepEqual(untyped.billingError, { status: 403 });
  await mode('billing-401'); await account.summary(true);
  await mode('billing-403');
  assert.equal((await account.summary(true)).state, 'signed-in');
  await mode('billing-401'); await account.summary(true);
  await mode('');
  const restored = await account.summary(true);
  assert.equal(restored.state, 'signed-in'); assert.equal(restored.plan, 'pro'); assert.equal(restored.billingError, undefined);
}));

test('a late catalogue response cannot replace models after a protocol change', () => fixture(async store => {
  let release!: (value: Response) => void;
  const response = new Promise<Response>(resolve => { release = resolve; });
  let requested = false;
  const connections = new ProviderConnections(store, async () => { requested = true; return response; });
  const id = await connections.configure(null, { label: 'API', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await connections.saveModel(id, { modelId: 'manual', label: 'Manual', kind: 'text' });
  const sync = connections.sync(id);
  await until(async () => requested);
  await connections.configure(id, { protocol: 'anthropic' });
  const rejected = assert.rejects(sync, /Provider changed/);
  release(Response.json({ data: [{ id: 'late-model' }] })); await rejected;
  assert.deepEqual((await connections.models()).map(model => model.modelId), ['manual']);
}));

test('cancelling after credentials arrive cannot restore a session through a late model sync', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  let release!: (value: string) => void, requested = false;
  const response = new Promise<string>(resolve => { release = resolve; });
  account.options.run = async args => {
    if (args[0] === 'model') { requested = true; return response; }
    return JSON.stringify({ models: [] });
  };
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes'); await until(async () => requested);
  await account.cancel();
  release(JSON.stringify({ source: 'remote', data: [{ id: 'late-model' }] }));
  await delay(50);
  assert.equal((await account.summary()).state, 'signed-out');
  assert.equal(await account.identity(), undefined); assert.deepEqual(await account.models(), []);
  assert.deepEqual(JSON.parse(await readFile(path.join(store.directory, 'account', 'models.json'), 'utf8')), []);
}));

test('account fixture publishes complete credentials while sign-in is being polled', t => fixture(async store => {
  await chmod(binary, 0o755);
  const started = path.join(store.directory, 'credential-write-started');
  const release = path.join(store.directory, 'allow-credential-publication');
  const preload = path.join(store.directory, 'pause-credential-write.mjs');
  await writeFile(preload, `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const write = fs.writeFileSync;
fs.writeFileSync = (file, ...args) => {
  if (String(file).includes('config.json')) {
    write(file, '', args[1]);
    write(${JSON.stringify(started)}, 'ready');
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(${JSON.stringify(release)})) {
      if (Date.now() > deadline) throw new Error('Credential publication fixture timed out');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  return write(file, ...args);
};
syncBuiltinESMExports();`);
  const spawnFixture = ((_command: string, args: readonly string[], options: SpawnOptions) =>
    spawn(process.execPath, ['--import', preload, binary, ...args], options)) as typeof spawn;
  const account = new OpenDesignAccount(store.directory, { binary, spawn: spawnFixture });
  t.after(() => account.close());
  await account.login(); await until(async () => Boolean((await account.summary()).authorizationUrl));
  await writeFile(path.join(account.home, 'authorize'), 'yes');
  await until(async () => access(started).then(() => true, () => false));
  try { assert.equal((await account.summary()).state, 'authorizing'); }
  finally { await writeFile(release, 'continue'); }
  await until(async () => (await account.summary()).state === 'signed-in');
}));

test('an in-flight billing refresh cannot report an old account after sign-out', t => fixture(async store => {
  const account = new OpenDesignAccount(store.directory, { binary }); t.after(() => account.close());
  await signIn(account); await account.summary(true);
  let release!: (value: string) => void, requested = false;
  const response = new Promise<string>(resolve => { release = resolve; });
  account.options.run = async args => { if (args[0] === 'billing') { requested = true; return response; } return '{}'; };
  const pending = account.summary(true); await until(async () => requested);
  await account.logout(); release(JSON.stringify({ membershipTier: 'pro', balanceUsd: '99.00' }));
  const summary = await pending;
  assert.equal(summary.state, 'signed-out'); assert.equal(summary.plan, undefined); assert.equal(summary.balance, undefined);
}));

test('concurrent billing reads keep the latest plan and sync newly entitled account models', t => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary }); t.after(() => gateway.close());
  await signIn(account);
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-go');
  assert.equal((await account.summary(true)).plan?.trim().toLowerCase(), 'go');
  // Remember the last verified entitlement even when a temporary billing failure hides the plan.
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-403');
  assert.equal((await account.summary(true)).plan, undefined);

  const staleGo = Promise.withResolvers<string>(), stale401 = Promise.withResolvers<string>();
  const staleCatalog = Promise.withResolvers<string>();
  let billingReads = 0, catalogReads = 0;
  account.options.run = async args => {
    if (args[0] === 'billing') {
      billingReads++;
      if (billingReads === 1) return staleGo.promise;
      if (billingReads === 2) return stale401.promise;
      return JSON.stringify({ membershipTier: 'Plus', balanceUsd: '4.00' });
    }
    if (args[0] === 'model') return JSON.stringify({ source: 'remote', data: [{ id: 'language-one' }] });
    assert.deepEqual(args, ['media', 'models', '--json']);
    if (++catalogReads === 1) return staleCatalog.promise;
    return JSON.stringify({ models: [{ model: 'new-plus-image', kind: 'image' }] });
  };
  const oldSync = account.models(true); await until(async () => catalogReads === 1);
  const slow = account.summary(true); await until(async () => billingReads === 1);
  const failed = account.summary(true); await until(async () => billingReads === 2);
  const updated = await gateway.status(false, { refreshAccount: true });
  staleGo.resolve(JSON.stringify({ membershipTier: 'Go', balanceUsd: '0.00' }));
  stale401.reject(new AccountRequestError('API request failed with status 401'));
  assert.equal(updated.providers.find(p => p.id === 'account')?.plan, 'plus');
  assert.deepEqual(updated.capabilities.find(capability => capability.modality === 'image')?.modelIds, ['account:new-plus-image']);
  for (const result of await Promise.all([slow, failed, account.summary(true)])) {
    assert.equal(result.state, 'signed-in');
    assert.equal(result.plan, 'Plus');
    assert.equal(result.balance, '4.00');
    assert.equal(result.billingUnavailable, false);
  }
  staleCatalog.resolve(JSON.stringify({ models: [] }));
  await oldSync;
  assert.equal(catalogReads, 2, 'a stable entitled plan does not keep refreshing the catalogue');
  assert((await account.models()).some(model => model.id === 'account:new-plus-image'));
}));

test('model overrides survive catalogue sync and reach generation with per-request precedence', () => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const fetcher: Fetcher = async (url, init) => {
    if (String(url).endsWith('/models')) return Response.json({ data: [{ id: 'picture', context_length: 128000, architecture: { output_modalities: ['image'], input_modalities: ['text', 'image'] }, supported_parameters: ['reasoning', 'tools'] }] });
    assert.deepEqual(JSON.parse(String(init?.body)), { model: 'picture', prompt: 'cup', quality: 'high', size: '1024x1024' });
    return Response.json({ data: [{ b64_json: png.toString('base64') }] });
  };
  gateway.options.fetcher = fetcher; gateway.connections = new ProviderConnections(store, fetcher);
  const provider = await gateway.connections.configure(null, { label: 'Test', protocol: 'openai', baseUrl: 'https://models.example/v1', apiKey: 'synthetic-key' });
  await gateway.connections.sync(provider);
  const id = provider + ':picture';
  const synced = (await providerDirectory(gateway)).models.find(model => model.id === id)!;
  assert.deepEqual(synced.inputs, ['vision']); assert.deepEqual(synced.capabilities, ['reasoning', 'tools']);
  await gateway.connections.updateMetadata(id, { label: 'My picture', group: 'Creative', contextWindow: null, capabilities: [], inputs: ['vision'], defaults: { quality: 'standard', size: '1024x1024' } });
  await gateway.connections.sync(provider);
  const edited = (await providerDirectory(gateway)).models.find(model => model.id === id)!;
  assert.equal(edited.label, 'My picture'); assert.equal(edited.group, 'Creative'); assert.equal(edited.contextWindow, null); assert.deepEqual(edited.capabilities, []);
  const job = await gateway.submit({ model: id, modality: 'image', prompt: 'cup', parameters: { quality: 'high' } });
  assert.equal((await finish(store, job.id)).state, 'completed');
  for (const invalid of [{ contextWindow: -1 }, { contextWindow: 128000, maxInputTokens: 200000 }, { inputs: ['unknown'] }, { defaults: { authorization: 'secret' } }, { defaults: [] }]) await assert.rejects(gateway.connections.updateMetadata(id, invalid));
  await gateway.connections.updateModel(id, null); assert.equal((await gateway.connections.modelOverrides())[id], undefined);
  await gateway.close();
}));

test('media setup discovery rechecks saved and removed keys without executing a model', () => fixture(async store => {
  const gateway = gatewayFor(store);
  gateway.options.detect = async () => [];
  gateway.options.fetcher = async () => { throw new Error('Setup must not call a paid model'); };
  const inspect = () => mediaUse(store, { action: 'inspect' });
  const before = await inspect();
  assert.deepEqual(before.settingsHandoff, { tool: 'openmotion_open_preview', arguments: { target: 'providers', entry: 'agent_media_signed_out' } });
  assert.match(before.settings, /Model providers > OpenDesign to sign in or upgrade to Plus/);
  assert.equal(before.providers.some(provider => provider.available), false);
  await gateway.configureProvider('atlascloud', { apiKey: 'synthetic-onboarding-key' });
  const saved = await inspect();
  assert.equal(saved.providers.find(provider => provider.id === 'atlascloud')?.available, true);
  assert.doesNotMatch(JSON.stringify(saved), /synthetic-onboarding-key/);
  assert.deepEqual(saved.settingsHandoff.arguments, { target: 'providers' });
  assert((await mediaUse(store, { action: 'models' })).providers.includes('atlascloud'));
  await gateway.connections.verifyKey('atlascloud', 'synthetic-onboarding-key', 'rejected');
  const rejected = await inspect();
  assert.deepEqual(rejected.settingsHandoff.arguments, { target: 'providers', entry: 'agent_media_key_rejected' });
  const connection = (await providerDirectory(gateway)).providers.find(provider => provider.id === 'atlascloud')!;
  assert.equal(connection.verification, 'rejected'); assert.equal(connection.enabled, true); assert.equal(connection.available, false);
  assert.doesNotMatch(JSON.stringify(connection), /synthetic-onboarding-key|keyHash/);
  assert.deepEqual(await mediaUse(store, { action: 'models', provider: 'atlascloud', refresh: true }), { providers: [], catalogs: [], setupRequired: true });
  assert(!(await mediaUse(store, { action: 'models' })).providers.includes('atlascloud'));
  await gateway.configureProvider('atlascloud', { apiKey: null });
  assert.equal((await inspect()).providers.find(provider => provider.id === 'atlascloud')?.available, false);
}));

test('media inspection refreshes advisory billing without disabling account models or leaking balances', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary });
  t.after(() => gateway.close());
  const inspect = () => mediaUse(store, { action: 'inspect' });
  const signedOut = (await inspect()).providers.find(p => p.id === 'account')!;
  assert.equal(signedOut.available, false); assert.equal(Object.hasOwn(signedOut, 'mediaEntitlement'), false);
  assert.equal(signedOut.plan, undefined); assert.equal(signedOut.hasBalance, undefined);
  await signIn(account);
  for (const [mode, entitlement, plan, hasBalance] of [
    ['billing-free', 'not-included', 'free', false], ['billing-go', 'not-included', 'go', false],
    ['billing-plus', 'included', 'plus', undefined], ['', 'included', 'pro', undefined],
    ['billing-topup', 'not-included', 'free', true], ['billing-malformed', 'not-included', 'free', undefined],
    ['billing-missing', 'not-included', 'go', undefined], ['billing-403', 'unknown', undefined, undefined],
    ['billing-failure', 'unknown', undefined, undefined],
  ] as const) {
    await writeFile(path.join(account.home, 'fixture-mode'), mode);
    const report = await inspect();
    const provider = report.providers.find(p => p.id === 'account')!;
    assert.equal(provider.mediaEntitlement, entitlement, mode); assert.equal(provider.available, true, mode);
    assert.deepEqual(report.settingsHandoff.arguments, plan === 'free' || plan === 'go'
      ? { target: 'providers', entry: 'agent_media_upgrade_' + plan } : { target: 'providers' }, mode);
    const { capabilities } = await gateway.status();
    for (const capability of capabilities) {
      assert.equal(capability.available, entitlement !== 'not-included', mode + '/' + capability.modality);
      if (entitlement === 'not-included') assert.deepEqual(capability.modelIds, []);
    }
    assert.equal(provider.plan, plan, mode); assert.equal(provider.hasBalance, hasBalance, mode);
    const directory = await providerDirectory(gateway);
    const official = directory.providers.find(p => p.id === 'account')!;
    assert.equal(official.reason, provider.reason); assert.equal(official.available, true);
    assert(!('mediaEntitlement' in official), 'ProviderConnection public fields remain unchanged');
    assert(directory.models.some(m => m.modelId === 'language-one' && m.enabled), 'Go text discovery remains usable');
    await setDefaultModel(gateway, 'text', 'account:language-one');
    const models = await mediaUse(store, { action: 'models', provider: 'account', modality: 'image' });
    assert(models.catalogs.some(page => page.models.length > 0), 'advisory entitlement must not filter discovery');
    assert.doesNotMatch(JSON.stringify(provider), /"balance"|12\.50|1\.2345|controlKey|runtimeKey|fixture-user/);
    if (mode === 'billing-free') {
      const queued = await gateway.submit({ projectId: store.projectId, model: 'account:fixture-image', modality: 'image', prompt: 'cup', idempotencyKey: 'free-advisory' });
      assert.equal(queued.state, 'queued', 'local submission retains server-side enforcement');
      await gateway.cancel(queued.id);
    }
  }
  // An eligible alternative keeps the generic handoff and supplies its own capabilities.
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-go');
  await gateway.configureProvider('atlascloud', { apiKey: 'synthetic-onboarding-key' });
  assert.deepEqual((await inspect()).settingsHandoff.arguments, { target: 'providers' });
  const { capabilities } = await gateway.status();
  assert(capabilities.some(capability => capability.available));
  assert(capabilities.every(capability => capability.modelIds.every(id => id.startsWith('atlascloud:'))));
  await gateway.connections.verifyKey('atlascloud', 'synthetic-onboarding-key', 'rejected');
  assert.deepEqual((await inspect()).settingsHandoff.arguments, { target: 'providers', entry: 'agent_media_upgrade_go' });
  await gateway.configureProvider('atlascloud', { apiKey: null });
  await writeFile(path.join(account.home, 'fixture-mode'), 'billing-401');
  const expired = await inspect();
  assert.deepEqual(expired.settingsHandoff.arguments, { target: 'providers', entry: 'agent_media_signed_out' });
  const rejected = expired.providers.find(p => p.id === 'account')!;
  assert.equal(rejected.available, false); assert.equal(Object.hasOwn(rejected, 'mediaEntitlement'), false);
  assert.equal((await account.summary()).state, 'reauth-required');
}));


test('provider directory keeps a signed-in account usable before billing is fetched', t => fixture(async store => {
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  t.after(() => gateway.close());
  t.mock.method(gateway.account, 'summary', async (refresh = false) => {
    assert.equal(refresh, false, 'the directory must not refresh billing');
    return { state: 'signed-in', consoleUrl: 'https://example.test' };
  });
  const account = (await providerDirectory(gateway)).providers.find(p => p.id === 'account')!;
  assert.equal(account.available, true);
  assert.equal(account.reason, 'Signed in; model access and balance are checked when generating');
  assert.equal(Object.hasOwn(account, 'mediaEntitlement'), false, 'directory public fields stay unchanged');
}));

test('account image recovery through MCP keeps the original task and snapshot without a second submission', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const transport = imageTransport(store.directory);
  let interrupted = true, downloads = 0;
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...transport,
    download: async (_url, init) => {
      downloads++;
      const offset = Number(new Headers(init.headers).get('range')?.match(/\d+/)?.[0] ?? 0);
      if (!interrupted) return new Response(png.subarray(offset), { status: offset ? 206 : 200, headers: {
        etag: '"original"', ...(offset ? { 'content-range': `bytes ${offset}-${png.length - 1}/${png.length}` } : {}) } });
      let read = false;
      return new Response(new ReadableStream({ pull(controller) { if (read) controller.error(new Error('private signed URL')); else { read = true; if (!offset) controller.enqueue(png.subarray(0, 32)); } } }), {
        status: offset ? 206 : 200, headers: { etag: '"original"', ...(offset ? { 'content-range': `bytes ${offset}-${png.length - 1}/${png.length}` } : {}) } });
    } });
  t.after(() => gateway.close()); await signIn(account); await account.models(true);
  const api = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const queued = await api.call('openmotion_assets_use', { action: 'generate', model: 'account:fixture-image', modality: 'image', prompt: 'original prompt', requestId: 'original-download' });
  const failed = await finish(store, queued.job.id);
  assert.equal(failed.state, 'failed'); assert.equal(failed.download?.receivedBytes, 32); assert.equal(downloads, 3);
  assert.doesNotMatch(JSON.stringify(failed), /private signed|media.example/);
  // Disk exhaustion can leave a truncated output before the manifest is committed.
  const unfinishedOutput = path.join(gateway.root, 'work', failed.id, `${failed.id}-1.png`);
  await writeFile(unfinishedOutput, png.subarray(0, 16));
  // A crashed worker must leave the verified partial file available after restart recovery.
  await writeFile(path.join(gateway.root, 'jobs', failed.id + '.json'), JSON.stringify({ ...failed, state: 'running', workerPid: 2147483647 }));
  await gateway.tick();
  assert.equal((await gateway.getJob(failed.id)).phase, 'interrupted');
  assert.equal((await stat(path.join(gateway.root, 'work', failed.id, 'image.partial'))).size, 32);
  assert.equal((await stat(unfinishedOutput)).size, 16);
  interrupted = false;
  const resumed = await api.call('openmotion_assets_use', { action: 'resume', jobId: failed.id, requestId: 'resume-original' });
  assert.equal(resumed.job.id, failed.id);
  const duplicate = await gateway.resume(failed.id, 'resume-original'); assert.equal(duplicate.id, failed.id);
  const completed = await finish(store, failed.id);
  assert.equal(completed.state, 'completed', completed.error); assert.equal(completed.remoteId, failed.remoteId);
  assert.equal(completed.prompt, 'original prompt'); assert.deepEqual(completed.parameters, failed.parameters); assert.deepEqual(completed.model, failed.model);
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 1);
  await assert.rejects(access(path.join(gateway.root, 'work', failed.id, 'image.partial')));
  assert.equal((await gateway.resume(failed.id, 'again-completed')).state, 'completed');
  assert.equal(downloads, 4);
}));

async function interruptedAccountImage(t: any, store: any) {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  let downloads = 0;
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory),
    download: async (_url, init) => {
      downloads++;
      const offset = Number(new Headers(init.headers).get('range')?.match(/\d+/)?.[0] ?? 0);
      let pulled = false;
      return new Response(new ReadableStream({ pull(controller) {
        if (pulled) controller.error(new Error('fixture disconnect'));
        else { pulled = true; if (!offset) controller.enqueue(png.subarray(0, 32)); }
      } }), { status: offset ? 206 : 200, headers: { etag: '"original"', ...(offset ? { 'content-range': `bytes ${offset}-${png.length - 1}/${png.length}` } : {}) } });
    } });
  t.after(() => gateway.close()); await signIn(account); await account.models(true);
  const api = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const queued = await api.call('openmotion_assets_use', { action: 'generate', model: 'account:fixture-image', modality: 'image', prompt: 'original prompt', requestId: 'interrupted-image' });
  const failed = await finish(store, queued.job.id);
  assert.equal(failed.state, 'failed'); assert.equal(failed.download?.receivedBytes, 32);
  return { gateway, account, api, failed, downloads: () => downloads, directory: path.join(gateway.root, 'work', failed.id) };
}

test('account image recovery replaces an output left before manifest commit using the complete verified download', t => fixture(async store => {
  const { gateway, account, api, failed, downloads, directory } = await interruptedAccountImage(t, store);
  // Reproduce a crash after the image and final-name output reached disk, before outputs.json.
  const checkpoint = { assetId: 'fixture-asset', size: png.length, mime: 'image/png', bytes: png.length,
    sha256: createHash('sha256').update(png).digest('hex'), etag: '"original"' };
  await writeFile(path.join(directory, 'image.partial'), png);
  await writeFile(path.join(directory, 'image-download.json'), JSON.stringify(checkpoint));
  await writeFile(path.join(directory, `${failed.id}-1.png`), png);
  await writeFile(path.join(gateway.root, 'jobs', failed.id + '.json'), JSON.stringify({ ...failed, state: 'running', workerPid: 2147483647 }));
  await gateway.tick();
  assert.equal((await gateway.getJob(failed.id)).phase, 'interrupted');
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'image-download.json'), 'utf8')), checkpoint);
  await assert.rejects(access(path.join(directory, 'outputs.json')));
  const before = downloads();
  await api.call('openmotion_assets_use', { action: 'resume', jobId: failed.id, requestId: 'resume-complete-download' });
  const completed = await finish(store, failed.id);
  assert.equal(completed.state, 'completed', completed.error); assert.equal(completed.remoteId, failed.remoteId);
  assert.equal(downloads(), before, 'the verified complete download needs no new transfer');
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 1);
  const result = await new AssetLibrary(store).resolve(completed.libraryAssets![0]);
  assert.deepEqual(await readFile(result.filename), png);
  await assert.rejects(access(directory));
}));

test('cancelling a queued account image recovery removes partial files despite a prior started attempt', t => fixture(async store => {
  const { gateway, account, api, failed, downloads, directory } = await interruptedAccountImage(t, store);
  assert(failed.startedAt); assert.equal(failed.workerPid, process.pid);
  await access(path.join(directory, 'image.partial')); await access(path.join(directory, 'image-download.json'));
  await api.call('openmotion_assets_use', { action: 'resume', jobId: failed.id, requestId: 'resume-then-cancel' });
  assert.equal((await gateway.getJob(failed.id)).state, 'queued');
  const before = downloads();
  await api.call('openmotion_assets_use', { action: 'cancel', jobId: failed.id });
  await assert.rejects(access(directory));
  await api.call('openmotion_assets_use', { action: 'cancel', jobId: failed.id });
  await gateway.tick();
  const restarted = new ModelGateway(store); t.after(() => restarted.close());
  assert.equal((await restarted.cancel(failed.id)).state, 'cancelled'); await restarted.tick();
  assert.equal(restarted.active.size, 0); assert.equal(gateway.active.size, 0);
  assert.equal(downloads(), before);
  assert.equal(JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')).length, 1);
  await assert.rejects(access(directory));
}));

test('AccountRequestError classifies local CLI flag errors as invalid requests rather than connection failures', () => {
  const cases = [
    'Error: if any flags in the group [aspect-ratio resolution] are set they must all be set; missing [aspect-ratio]\n',
    'Error: if any flags in the group [size aspect-ratio] are set none of the others can be; [aspect-ratio size] were all set\n',
    'Error: unknown flag: --bad-flag\n',
    'Error: invalid argument "abc" for "--duration" flag: strconv.ParseInt: parsing "abc": invalid syntax\n',
    'Error: required flag(s) "model" not set\n',
  ];
  for (const stderr of cases) {
    const error = new AccountRequestError(stderr);
    assert.equal(error.status, undefined, stderr);
    assert.equal(error.code, undefined, stderr);
    assert.equal(error.message, 'OpenDesign rejected this request for the selected model. Choose another model or change the options, then try again.', stderr);
  }
  const connection = new AccountRequestError('spawn failed');
  assert.equal(connection.message, 'OpenDesign account request failed. Check your connection and sign in again if needed.');
});

test('account video first-frame uses --first-frame and OpenDesign providers reject reference images over 2 MiB before queueing', t => fixture(async store => {
  await chmod(binary, 0o755);
  const gateway = gatewayFor(store); gateway.options.detect = async () => [];
  const account = gateway.account = new OpenDesignAccount(store.directory, { binary, pollMs: 1, ...imageTransport(store.directory) });
  t.after(() => gateway.close());
  await signIn(account); await account.models(true);
  await writeFile(path.join(account.home, 'fixture-video'), await mediaBytes('video'));
  const api = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const models = (await gateway.listModels({ provider: 'account', modality: 'video' })).models;
  assert.equal(models.find(m => m.modelId === 'fixture-i2v')?.maxInputImages, 1);
  assert.equal(models.find(m => m.modelId === 'fixture-video')?.maxInputImages, undefined);

  const source = path.join(store.directory, 'first-frame.png'); await writeFile(source, png);
  const frame = await new AssetLibrary(store).importFile(source, { requestId: 'account-first-frame', name: 'First Frame' });
  const reference = { assetId: frame.id, versionId: frame.currentVersionId };
  const queued = await api.call('openmotion_assets_use', {
    action: 'generate', requestId: 'account-video-i2v', model: 'account:fixture-i2v', modality: 'video', prompt: 'slow camera push', references: [reference],
  });
  const completed = await finish(store, queued.job.id);
  assert.equal(completed.state, 'completed', completed.error);
  const calls = JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')) as string[][];
  assert.deepEqual(calls.at(-1)?.slice(0, 2), ['video', 'gen']);
  assert.match(calls.at(-1)![calls.at(-1)!.indexOf('--first-frame') + 1], /reference\.png$/);

  // Oversized reference (> 2 MiB) is rejected before queueing for OpenDesign account and Cloud providers.
  const { crc32 } = await import('node:zlib');
  const textType = Buffer.from('tEXt'), textPayload = Buffer.alloc(2 * 1024 * 1024 + 16, 0x61);
  const length = Buffer.alloc(4); length.writeUInt32BE(textPayload.length, 0);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([textType, textPayload])), 0);
  const oversizedPng = Buffer.concat([png.subarray(0, png.length - 12), length, textType, textPayload, checksum, png.subarray(png.length - 12)]);
  const oversizedPath = path.join(store.directory, 'oversized.png');
  await writeFile(oversizedPath, oversizedPng);
  const oversized = await new AssetLibrary(store).importFile(oversizedPath, { requestId: 'oversized-ref', name: 'Oversized' });
  const oversizedRef = { assetId: oversized.id, versionId: oversized.currentVersionId };
  await assert.rejects(
    api.call('openmotion_assets_use', { action: 'generate', requestId: 'account-too-large', model: 'account:fixture-image', modality: 'image', prompt: 'edit', references: [oversizedRef] }),
    /2 MiB OpenDesign upload limit/,
  );
  await assert.rejects(
    api.call('openmotion_assets_use', { action: 'generate', requestId: 'account-i2v-too-large', model: 'account:fixture-i2v', modality: 'video', prompt: 'animate', references: [oversizedRef] }),
    /2 MiB OpenDesign upload limit/,
  );
  assert.equal((JSON.parse(await readFile(path.join(account.home, 'submissions.json'), 'utf8')) as string[][]).length, 1);
}));

test('the account directory is per user, except for temporary workspaces and an explicit MOTION_ACCOUNT_DIR', () => {
  assert.equal(sharedAccountDirectory('darwin', {}, '/synthetic/account-holder'), '/synthetic/account-holder/Library/Application Support/OpenDesign/account');
  assert.equal(sharedAccountDirectory('win32', { LOCALAPPDATA: 'C:\\Profile\\AppData\\Local' }, 'C:\\Profile'), 'C:\\Profile\\AppData\\Local\\OpenDesign\\account');
  assert.equal(sharedAccountDirectory('win32', {}, 'C:\\Profile'), 'C:\\Profile\\AppData\\Local\\OpenDesign\\account');
  assert.equal(sharedAccountDirectory('linux', {}, '/synthetic/account-holder'), '/synthetic/account-holder/.local/share/OpenDesign/account');
  assert.equal(sharedAccountDirectory('linux', { XDG_DATA_HOME: '/data/xdg' }, '/synthetic/account-holder'), '/data/xdg/OpenDesign/account');
  const env = { ...process.env }; delete env.MOTION_ACCOUNT_DIR;
  // Workspaces selected by different installations, channels or MOTION_DATA_DIR values share one sign-in.
  const workspace = path.join(path.dirname(fileURLToPath(import.meta.url)), 'never-created-workspace');
  assert.equal(accountDirectory(workspace, env), sharedAccountDirectory(process.platform, env));
  assert.equal(accountDirectory(path.join(workspace, '-dev'), env), sharedAccountDirectory(process.platform, env));
  assert.equal(accountDirectory(path.join(tmpdir(), 'motion-scratch'), env), path.join(path.resolve(tmpdir()), 'motion-scratch', 'account'));
  assert.equal(accountDirectory(workspace, { ...env, MOTION_ACCOUNT_DIR: '/srv/motion/account' }), path.resolve('/srv/motion/account'));
});

/** Points every workspace created in this test at one account directory, as the per-user default does outside tests. */
function sharedAccount(t: { after: (fn: () => void) => void }, directory: string) {
  const previous = process.env.MOTION_ACCOUNT_DIR;
  process.env.MOTION_ACCOUNT_DIR = directory;
  t.after(() => { if (previous === undefined) delete process.env.MOTION_ACCOUNT_DIR; else process.env.MOTION_ACCOUNT_DIR = previous; });
}

test('workspaces with different data directories share one sign-in, catalogue and sign-out', t => fixture(async store => {
  await chmod(binary, 0o755);
  sharedAccount(t, path.join(store.directory, 'shared-account'));
  const studio = new OpenDesignAccount(path.join(store.directory, 'studio-data'), { binary }); t.after(() => studio.close());
  const agent = new OpenDesignAccount(path.join(store.directory, 'agent-data'), { binary }); t.after(() => agent.close());
  assert.equal(studio.home, agent.home);
  assert.equal((await agent.summary()).state, 'signed-out');
  await signIn(studio);
  // The Agent host's workspace was never signed in, yet it sees the account and its catalogue without another sign-in.
  assert.equal((await agent.summary()).state, 'signed-in');
  assert.equal(await agent.identity(), await studio.identity());
  assert.deepEqual(await agent.models(), await studio.models());
  await assert.rejects(stat(path.join(store.directory, 'agent-data', 'account')), { code: 'ENOENT' });
  assert.equal((await agent.logout()).state, 'signed-out');
  assert.equal((await studio.summary()).state, 'signed-out');
  assert.deepEqual(await studio.models(), []);
}));

test('a workspace sign-in from before the shared directory moves there once and is not restored after sign-out', t => fixture(async store => {
  await chmod(binary, 0o755);
  const first = path.join(store.directory, 'first-data'), second = path.join(store.directory, 'second-data'), shared = path.join(store.directory, 'shared-account');
  // Earlier releases kept the credentials, session and catalogue in each workspace.
  const legacy = async (directory: string) => {
    sharedAccount(t, path.join(directory, 'account'));
    const account = new OpenDesignAccount(directory, { binary }); await signIn(account); const identity = await account.identity(); await account.close();
    return identity;
  };
  const third = path.join(store.directory, 'third-data');
  const firstIdentity = await legacy(first);
  await legacy(second); await legacy(third);
  sharedAccount(t, shared);
  const moved = new OpenDesignAccount(first, { binary }); t.after(() => moved.close());
  assert.equal((await moved.summary()).state, 'signed-in');
  assert.equal(await moved.identity(), firstIdentity);
  assert((await moved.models()).length > 0);
  assert.equal((await stat(path.join(shared, 'credentials', 'config.json'))).mode & 0o777, 0o600);
  for (const file of ['credentials/config.json', 'session.json', 'models.json']) await assert.rejects(stat(path.join(first, 'account', file)), { code: 'ENOENT' });
  // A second workspace finds the shared account signed in: it keeps that account and drops its own copy.
  const other = new OpenDesignAccount(second, { binary }); t.after(() => other.close());
  assert.equal((await other.summary()).state, 'signed-in');
  assert.equal(await other.identity(), firstIdentity);
  await assert.rejects(stat(path.join(second, 'account', 'credentials', 'config.json')), { code: 'ENOENT' });
  await moved.logout();
  const restarted = new OpenDesignAccount(second, { binary }); t.after(() => restarted.close());
  assert.equal((await restarted.summary()).state, 'signed-out');
  // A workspace opened for the first time after the sign-out does not sign the computer in again with its old copy.
  const late = new OpenDesignAccount(third, { binary }); t.after(() => late.close());
  assert.equal((await late.summary()).state, 'signed-out');
  await assert.rejects(stat(path.join(third, 'account', 'credentials', 'config.json')), { code: 'ENOENT' });
  // A workspace that signed in after that sign-out (with an earlier release) still brings its sign-in along.
  const fourth = path.join(store.directory, 'fourth-data');
  const fourthIdentity = await legacy(fourth); sharedAccount(t, shared);
  const newer = new OpenDesignAccount(fourth, { binary }); t.after(() => newer.close());
  assert.equal((await newer.summary()).state, 'signed-in');
  assert.equal(await newer.identity(), fourthIdentity);
}));

test('a workspace whose account directory is the shared one under another spelling keeps its sign-in', t => fixture(async store => {
  await chmod(binary, 0o755);
  const workspace = path.join(store.directory, 'data');
  sharedAccount(t, path.join(workspace, 'account'));
  const original = new OpenDesignAccount(workspace, { binary }); await signIn(original); await original.close();
  await symlink(path.join(workspace, 'account'), path.join(store.directory, 'linked-account'));
  sharedAccount(t, path.join(store.directory, 'linked-account'));
  const linked = new OpenDesignAccount(workspace, { binary }); t.after(() => linked.close());
  assert.equal((await linked.summary()).state, 'signed-in');
  assert((await stat(path.join(workspace, 'account', 'credentials', 'config.json'))).isFile());
}));

test('a failed legacy migration keeps the workspace sign-in and leaves no shared marker behind', t => fixture(async store => {
  await chmod(binary, 0o755);
  const shared = path.join(store.directory, 'shared-account');
  const createLegacy = async (name: string) => {
    const directory = path.join(store.directory, name);
    sharedAccount(t, path.join(directory, 'account'));
    const account = new OpenDesignAccount(directory, { binary }); await signIn(account); const identity = await account.identity(); await account.close();
    return { directory, identity };
  };
  const first = await createLegacy('failed-first');
  // Replace models.json with a directory so copying fails after session.json has already been staged.
  const firstModels = path.join(first.directory, 'account', 'models.json');
  await rm(firstModels, { force: true });
  await mkdir(firstModels);

  sharedAccount(t, shared);
  const logs: string[] = [];
  const failed = new OpenDesignAccount(first.directory, { binary, log: line => logs.push(line) }); t.after(() => failed.close());
  assert.equal((await failed.summary()).state, 'signed-out');
  assert(logs.some(line => line.includes('could not be moved to the shared directory')));
  // No shared marker or temporary file is left behind, and the workspace still owns its only sign-in.
  await assert.rejects(stat(path.join(shared, 'session.json')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(shared, 'models.json')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(shared, 'credentials', 'config.json')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(shared)).filter(name => name.endsWith('.tmp')), []);
  assert.deepEqual((await readdir(path.join(shared, 'credentials'))).filter(name => name.endsWith('.tmp')), []);
  assert((await stat(path.join(first.directory, 'account', 'credentials', 'config.json'))).isFile());
  assert((await stat(path.join(first.directory, 'account', 'session.json'))).isFile());

  // Once the transient copy failure is gone, the next start adopts the preserved workspace sign-in cleanly.
  await rm(firstModels, { recursive: true, force: true });
  const recovered = new OpenDesignAccount(first.directory, { binary }); t.after(() => recovered.close());
  assert.equal((await recovered.summary()).state, 'signed-in');
  assert.equal(await recovered.identity(), first.identity);
  assert.equal((await stat(path.join(shared, 'credentials', 'config.json'))).mode & 0o777, 0o600);
  await assert.rejects(stat(path.join(first.directory, 'account', 'credentials', 'config.json')), { code: 'ENOENT' });

  // A failed migration when the shared directory already has a sign-out marker preserves that marker and still recovers.
  await recovered.logout();
  const markerBefore = (await stat(path.join(shared, 'session.json'))).mtimeMs;
  await delay(25);
  const second = await createLegacy('failed-second');
  const secondModels = path.join(second.directory, 'account', 'models.json');
  await rm(secondModels, { force: true });
  await mkdir(secondModels);

  sharedAccount(t, shared);
  const failedAgain = new OpenDesignAccount(second.directory, { binary, log: () => {} }); t.after(() => failedAgain.close());
  assert.equal((await failedAgain.summary()).state, 'signed-out');
  assert.equal((await stat(path.join(shared, 'session.json'))).mtimeMs, markerBefore);
  await assert.rejects(stat(path.join(shared, 'credentials', 'config.json')), { code: 'ENOENT' });
  assert((await stat(path.join(second.directory, 'account', 'credentials', 'config.json'))).isFile());

  await rm(secondModels, { recursive: true, force: true });
  const recoveredAgain = new OpenDesignAccount(second.directory, { binary }); t.after(() => recoveredAgain.close());
  assert.equal((await recoveredAgain.summary()).state, 'signed-in');
  assert.equal(await recoveredAgain.identity(), second.identity);
  await assert.rejects(stat(path.join(second.directory, 'account', 'credentials', 'config.json')), { code: 'ENOENT' });
}));
