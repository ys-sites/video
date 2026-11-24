import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { AssetLibrary, assetHash } from '../gateway/asset-library.ts';
import { audioAssetTitle, classifyAudioKind } from '../shared/audio-kind.ts';
import { probeLibraryMedia } from '../gateway/asset-probe.ts';
import { ModelGateway, gatewayFor } from '../gateway/service.ts';
import { assetOperation } from '../gateway/asset-operations.ts';
import { AssetConversations, type AssetAgentRpc } from '../gateway/asset-chat.ts';
import { Phase1Service } from '../phase1.ts';
import { assetDownloadUrl } from '../shared/asset-library.ts';
import { mediaFilename } from '../shared/render-name.ts';

async function image(dir: string, name = 'image.png', color = 'red') {
  const file = path.join(dir, name);
  const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=32x24`, '-frames:v', '1', '-y', file], dir, 20_000);
  assert.equal(result.code, 0, result.stderr); return file;
}
const agents = async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'ready' }];
const until = async (predicate: () => boolean | Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('Timed out'); };

test('media download names preserve Unicode and keep version suffixes within portable limits', () => {
  assert.equal(mediaFilename('测试.PNG', '.png'), '测试.png');
  assert.equal(mediaFilename('CON', '.mp4'), '_CON.mp4');
  assert.equal(mediaFilename('../配乐:春天 v3', '.mp3'), '__配乐_春天 v3.mp3');
  const longName = mediaFilename('夏'.repeat(120) + ' v4', '.mp3');
  assert.match(longName, / v4\.mp3$/u);
  assert.ok(Buffer.byteLength(longName, 'utf8') < 255);
});

test('missing media tools reject library generation before invoking the model and preserve idempotency', () => fixture(async store => {
  const original = process.env.HYPERFRAMES_FFPROBE_PATH;
  process.env.HYPERFRAMES_FFPROBE_PATH = path.join(store.directory, 'missing-ffprobe');
  let calls = 0;
  const gateway = new ModelGateway(store, { detect: agents, codex: async () => { calls++; return Buffer.alloc(0); } });
  try {
    const input = { modality: 'image' as const, model: 'codex:image-generation', prompt: 'A lake', library: {}, idempotencyKey: 'missing-media' };
    const job = await gateway.submit(input);
    await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
    const failed = await gateway.getJob(job.id);
    assert.equal(failed.state, 'failed'); assert.match(failed.error!, /ASSET_MEDIA_RUNTIME_NOT_READY.*ffprobe/);
    assert.equal(calls, 0); assert.equal((await new AssetLibrary(store).list()).total, 0);
    assert.equal((await gateway.submit(input)).id, job.id);
    await gateway.tick(); assert.equal(calls, 0);
  } finally {
    await gateway.close();
    if (original === undefined) delete process.env.HYPERFRAMES_FFPROBE_PATH; else process.env.HYPERFRAMES_FFPROBE_PATH = original;
  }
}, false));

test('immutable upload versions, content-based receipts, filters and reversible trash survive reopening', () => fixture(async store => {
  const library = new AssetLibrary(store), first = await image(store.directory), duplicate = path.join(store.directory, 'copy.png');
  await writeFile(duplicate, await readFile(first));
  const a = await library.importFile(first, { requestId: 'upload', name: 'Landscape' });
  assert.equal((await library.importFile(duplicate, { requestId: 'upload', name: 'Landscape' })).id, a.id);
  assert.equal((await library.list()).total, 1);
  const old = await library.resolve({ assetId: a.id, versionId: a.currentVersionId });
  const second = await image(store.directory, 'second.png', 'blue');
  await assert.rejects(library.importFile(second, { requestId: 'upload', name: 'Landscape' }), /REQUEST_ID_CONFLICT/);
  const b = await library.importFile(second, { requestId: 'edit', name: 'Landscape', assetId: a.id, parentVersionId: a.currentVersionId });
  assert.equal(b.versions.length, 2); assert.equal(b.versions[1].parentVersionId, a.currentVersionId);
  assert.deepEqual(await readFile(old.filename), await readFile(first));
  assert.equal((await library.list({ modality: 'video' })).total, 0);
  assert.equal((await library.list({ source: 'upload', query: 'land' })).total, 1);
  await library.update(a.id, { trashed: true }); assert.equal((await library.list()).total, 0); assert.equal((await library.list({ trash: true })).total, 1);
  await assert.rejects(library.resolve({ assetId: a.id, versionId: a.currentVersionId }), /UNAVAILABLE/);
  await library.update(a.id, { trashed: false, currentVersionId: a.currentVersionId });
  assert.equal((await new AssetLibrary(store).get(a.id)).versions.length, 2);
  assert.equal((await stat(old.filename)).mode & 0o777, 0o600);
  await assert.rejects(library.get('../outside'), /NOT_FOUND/);
  await symlink(first, path.join(store.directory, 'linked.png'));
  await assert.rejects(library.importFile(path.join(store.directory, 'linked.png'), { requestId: 'link', name: 'link' }));
  await writeFile(path.join(store.directory, 'fake.png'), '<script>bad</script>');
  await assert.rejects(library.importFile(path.join(store.directory, 'fake.png'), { requestId: 'fake', name: 'fake' }), /not readable/);
}, false));

test('an AVIF still is probed as an image, not as the MP4 its container resembles', () => fixture(async store => {
  // 64 x 64 red still, major brand "avif".
  const still = Buffer.from('AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAlAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAABAAAAAQAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAtbWRhdAoLAgAABVV//Gr5gEAyFhAA1wIZZMMCAAAIAYtJxybx8/EU+8A=', 'base64');
  const file = path.join(store.directory, 'still.avif');
  await writeFile(file, still);
  assert.deepEqual(await probeLibraryMedia(file), { modality: 'image', mimeType: 'image/avif', extension: 'avif', bytes: still.length, width: 64, height: 64 });
  const asset = await new AssetLibrary(store).importFile(file, { requestId: 'avif', name: 'Still' });
  assert.equal(asset.modality, 'image');
}));

test('a video stored sideways is probed at the size it plays at', () => fixture(async store => {
  const ffmpeg = async (...args: string[]) => { const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', ...args], store.directory, 20_000); assert.equal(result.code, 0, result.stderr); };
  const flat = path.join(store.directory, 'flat.mp4'), turned = path.join(store.directory, 'turned.mp4'), flipped = path.join(store.directory, 'flipped.mp4');
  await ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=10:duration=1', '-an', '-y', flat);
  // What a phone held upright records: landscape frames plus a display matrix.
  await ffmpeg('-display_rotation', '90', '-i', flat, '-c', 'copy', '-y', turned);
  await ffmpeg('-display_rotation', '180', '-i', flat, '-c', 'copy', '-y', flipped);
  const size = async (file: string) => { const media = await probeLibraryMedia(file); return [media.width, media.height]; };
  assert.deepEqual(await size(flat), [64, 48]);
  assert.deepEqual(await size(turned), [48, 64]);
  assert.deepEqual(await size(flipped), [64, 48]);
}));

test('workspace generation keeps job identity and pinned references without requiring a project', () => fixture(async store => {
  const original = await image(store.directory), bytes = await readFile(original); let calls = 0;
  const gateway = new ModelGateway(store, { detect: agents, codex: async () => { calls++; return bytes; } });
  const input = { modality: 'image' as const, model: 'codex:image-generation', prompt: 'A lake\nAt sunrise', library: {}, idempotencyKey: 'generate' };
  const job = await gateway.submit(input); assert.equal(job.projectId, undefined);
  assert.equal((await gateway.submit(input)).id, job.id);
  await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
  const completed = await gateway.getJob(job.id); assert.equal(completed.state, 'completed', completed.error); assert.equal(calls, 1);
  const reference = completed.libraryAssets![0], asset = await new AssetLibrary(store).get(reference.assetId);
  assert.equal(asset.versions[0].prompt, 'A lake\nAt sunrise'); assert.equal(asset.name, 'A lake At sunrise');
  const edited = await gateway.submit({ ...input, idempotencyKey: 'edit', library: { assetId: asset.id, parentVersionId: reference.versionId, references: [reference] } });
  await new AssetLibrary(store).update(asset.id, { trashed: true });
  await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
  assert.equal((await gateway.getJob(edited.id)).state, 'completed');
  assert.ok((await new AssetLibrary(store).get(asset.id)).trashedAt, 'A running job preserves trash state and retains its paid output');
  const versions = (await new AssetLibrary(store).get(asset.id)).versions;
  assert.equal(versions.length, 2); assert.deepEqual(versions[1].references, [reference]);
  assert.equal((await gateway.submit(input)).id, job.id); assert.equal(calls, 2);
  await gateway.close();
}, false));

test('asset HTTP uploads are replayable and media supports byte ranges; project imports pin independent copies', () => fixture(async store => {
  const source = await image(store.directory), bytes = await readFile(source), fetch = transport(store);
  const upload = (request = 'browser-upload') => fetch('/motion-api/assets/upload?requestId=' + request, { method: 'POST', body: new Blob([bytes]), headers: { 'X-File-Name': encodeURIComponent('My image.png') } });
  const refused = await upload('video-picker&modality=video');
  assert.equal(refused.ok, false);
  assert.match(await refused.text(), /Unsupported media type/);
  assert.equal((await new AssetLibrary(store).list()).total, 0);
  const response = await upload(); assert.equal(response.status, 200, await response.clone().text());
  const { asset } = await response.json(); assert.equal((await (await upload()).json()).asset.id, asset.id);
  const url = `/motion-api/assets/${asset.id}/versions/${asset.currentVersionId}/file`;
  const range = await fetch(url, { headers: { Range: 'bytes=0-7' } }); assert.equal(range.status, 206); assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(0, 8));
  const download = await fetch(url + '?download=1'); assert.match(download.headers.get('content-disposition')!, /attachment/);
  const named = await fetch(assetDownloadUrl(asset.id, asset.currentVersionId, "测试 · 夏日's 封面"), { method: 'HEAD' });
  assert.equal(named.status, 200);
  const utf8Name = named.headers.get('content-disposition')!.split("UTF-8''")[1];
  assert.ok(utf8Name.includes('%27'));
  assert.equal(decodeURIComponent(utf8Name), "测试 · 夏日's 封面.png");
  const invalid = await fetch(url, { headers: { Range: 'bytes=999999-' } }); assert.equal(invalid.status, 416);
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const project = await service.call('openmotion_create_project', { requestId: 'project', projectType: 'natural_language', title: 'Film', requirements: 'A silent film' });
  await new AssetLibrary(store).update(asset.id, { name: 'User chosen name' });
  const imported = await service.call('openmotion_assets', { action: 'import_to_project', projectId: project.projectId, requestId: 'import', assetId: asset.id, versionId: asset.currentVersionId });
  assert.equal(imported.items[0].name, 'User chosen name');
  assert.equal(imported.status, 'completed', JSON.stringify(imported)); assert.equal(imported.appliedToTimeline, false);
  const copied = path.join(store.projectDirectoryFor(project.projectId), imported.items[0].path);
  await new AssetLibrary(store).update(asset.id, { name: 'Later library name' });
  const reused = await service.call('openmotion_assets', { action: 'import_to_project', projectId: project.projectId, requestId: 'import-again', assetId: asset.id, versionId: asset.currentVersionId });
  assert.equal(reused.status, 'completed');
  assert.equal(reused.items[0].assetId, imported.items[0].assetId);
  assert.equal(reused.items[0].name, 'User chosen name');
  const replay = await service.call('openmotion_assets', { action: 'import_to_project', projectId: project.projectId, requestId: 'import', assetId: asset.id, versionId: asset.currentVersionId });
  assert.equal(replay.items[0].assetId, imported.items[0].assetId);
  assert.equal(replay.items[0].name, 'User chosen name');
  await new AssetLibrary(store).update(asset.id, { trashed: true });
  assert.deepEqual(await readFile(copied), bytes);
}, false));

test('in-app Agent streams, confirms generation, persists threads, rejects duplicate turns and stops without resubmitting', t => fixture(async store => {
  const binaries: any[] = [];
  class FakeRpc {
    notify: (message: any) => void; sent: any[] = []; requests: any[] = [];
    constructor(_bin: string, _cwd: string, notify: (message: any) => void) { this.notify = notify; binaries.push(this); }
    async request(method: string, params: any) { this.requests.push({ method, params }); return method.startsWith('thread/') ? { thread: { id: 'codex-thread' } } : method === 'turn/start' ? { turn: { id: 'turn' } } : {}; }
    send(value: any) { this.sent.push(value); }
    close() {}
  }
  const chats = new AssetConversations(store, { resolve: async () => '/fake/codex', rpc: FakeRpc as unknown as typeof AssetAgentRpc });
  t.after(() => chats.close());
  const chat = await chats.create(), input = { requestId: 'one', text: 'Make a lake image', model: 'fixture-model', reasoning: 'high' };
  assert.equal(chats.pending, 0);
  await chats.start(chat.id, input); await until(() => binaries[0]?.requests.some((r: any) => r.method === 'turn/start'));
  assert.equal(chats.pending, 1);
  const rpc = binaries[0];
  const accountGateway = gatewayFor(store); accountGateway.options.detect = agents;
  const refreshes: boolean[] = [];
  let accountTier = 'go';
  const summary = t.mock.method(accountGateway.account, 'summary', async (refresh = false) => {
    refreshes.push(refresh);
    if (refresh) accountTier = 'plus';
    return { state: 'signed-in', plan: accountTier, balance: '0.00', billingUnavailable: false, consoleUrl: 'https://example.test', user: { email: 'private@example.test' } };
  });
  rpc.notify({ id: 88, method: 'item/tool/call', params: { tool: 'openmotion_asset_models', arguments: {} } });
  await until(() => rpc.sent.some((r: any) => r.id === 88));
  const reply = rpc.sent.find((r: any) => r.id === 88).result;
  assert.equal(reply.success, true);
  assert.deepEqual(refreshes, [false]);
  const account = JSON.parse(reply.contentItems[0].text).providers.find((p: any) => p.id === 'account');
  assert.deepEqual(account, { id: 'account', available: true, reason: 'Signed in; multimodal generation requires OpenDesign Plus or above', mediaEntitlement: 'not-included', plan: 'go', hasBalance: false });
  assert.doesNotMatch(reply.contentItems[0].text, /0\.00|private@example|"balance"/);
  rpc.notify({ id: 87, method: 'item/tool/call', params: { tool: 'openmotion_asset_models', arguments: { refreshAccount: true } } });
  await until(() => rpc.sent.some((r: any) => r.id === 87));
  const refreshedReply = rpc.sent.find((r: any) => r.id === 87).result;
  assert.equal(refreshedReply.success, true);
  assert.deepEqual(refreshes, [false, true]);
  const refreshedAccount = JSON.parse(refreshedReply.contentItems[0].text).providers.find((p: any) => p.id === 'account');
  assert.deepEqual(refreshedAccount, { id: 'account', available: true, reason: 'Included with your account', mediaEntitlement: 'included', plan: 'plus' });
  rpc.notify({ id: 86, method: 'item/tool/call', params: { tool: 'openmotion_asset_models', arguments: { refreshAccount: 'yes' } } });
  await until(() => rpc.sent.some((r: any) => r.id === 86));
  assert.equal(rpc.sent.find((r: any) => r.id === 86).result.success, false);
  summary.mock.restore();
  rpc.notify({ id: 89, method: 'item/tool/call', params: { tool: 'openmotion_asset_models', arguments: {} } });
  await until(() => rpc.sent.some((r: any) => r.id === 89));
  const signedOut = JSON.parse(rpc.sent.find((r: any) => r.id === 89).result.contentItems[0].text).providers.find((p: any) => p.id === 'account');
  assert.deepEqual(Object.keys(signedOut).sort(), ['available', 'id', 'reason']);

  assert.equal(rpc.requests.find((r: any) => r.method === 'turn/start').params.effort, 'high');
  await assert.rejects(chats.start(chat.id, { requestId: 'invalid-effort', text: 'hello', reasoning: 'high' }), /Choose an Agent model/);
  assert.equal(rpc.requests.find((r: any) => r.method === 'thread/start').params.sandbox, 'read-only');
  assert.ok(rpc.requests.find((r: any) => r.method === 'thread/start').params.dynamicTools.some((tool: any) => tool.name === 'openmotion_assets_use'));
  rpc.notify({ method: 'item/agentMessage/delta', params: { itemId: 'message', delta: 'Creating an image.' } });
  assert.equal((await chats.get(chat.id)).messages.at(-1)?.text, 'Creating an image.');
  await assert.rejects(chats.start(chat.id, { ...input, requestId: 'two' }), /already working/);
  assert.equal((await chats.start(chat.id, input)).id, chat.id);
  rpc.notify({ id: 90, method: 'item/tool/call', params: { tool: 'openmotion_assets', callId: 'paid', arguments: { action: 'generate', requestId: 'agent-choice', model: 'codex:image-generation', modality: 'image', prompt: 'A lake' } } });
  await until(async () => (await chats.get(chat.id)).approvals.length === 1);
  assert.equal((await gatewayFor(store).listJobs()).length, 0);
  const approval = (await chats.get(chat.id)).approvals[0]; await chats.answer(chat.id, approval.id, false);
  await until(() => rpc.sent.some((r: any) => r.id === 90));
  assert.equal(rpc.sent.find((r: any) => r.id === 90).result.success, false);
  assert.equal((await gatewayFor(store).listJobs()).length, 0);
  const gateway = gatewayFor(store); gateway.options.detect = agents;
  gateway.options.codex = async () => readFile(await image(store.directory));
  rpc.notify({ id: 91, method: 'item/tool/call', params: { tool: 'openmotion_assets', callId: 'approved', arguments: { action: 'generate', requestId: 'proposed', model: 'codex:image-generation', modality: 'image', prompt: 'A lake' } } });
  await until(async () => (await chats.get(chat.id)).approvals.length === 1);
  await chats.answer(chat.id, (await chats.get(chat.id)).approvals[0].id, true);
  await until(() => rpc.sent.some((r: any) => r.id === 91));
  const toolResult = rpc.sent.find((r: any) => r.id === 91).result;
  assert.equal(toolResult.success, true, JSON.stringify(toolResult));
  const approvedJob = JSON.parse(toolResult.contentItems[0].text).job;
  assert.equal(approvedJob.library.conversationId, chat.id);
  await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
  assert.equal((await gateway.getJob(approvedJob.id)).state, 'completed');
  const pinned = (await gateway.getJob(approvedJob.id)).libraryAssets![0];
  rpc.notify({ id: 92, method: 'item/tool/call', params: { tool: 'openmotion_assets_use', arguments: { action: 'read', ...pinned } } });
  await until(() => rpc.sent.some((r: any) => r.id === 92));
  const viewed = rpc.sent.find((r: any) => r.id === 92).result;
  assert.equal(viewed.success, true);
  assert.ok(viewed.contentItems.some((item: any) => item.type === 'inputImage' && item.imageUrl.startsWith('data:image/png;base64,')));
  const tone = path.join(store.directory, 'chat-audio.wav');
  assert.equal((await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.2', tone], store.directory)).code, 0);
  const audio = await new AssetLibrary(store).importFile(tone, { requestId: 'chat-audio', name: 'Audio' });
  rpc.notify({ id: 93, method: 'item/tool/call', params: { tool: 'openmotion_assets_use', arguments: { action: 'read', assetId: audio.id, versionId: audio.currentVersionId } } });
  await until(() => rpc.sent.some((r: any) => r.id === 93));
  assert.ok(rpc.sent.find((r: any) => r.id === 93).result.contentItems.some((item: any) => item.type === 'inputAudio' && item.audioUrl.startsWith('data:audio/wav;base64,')));
  assert.doesNotMatch(JSON.stringify((await chats.get(chat.id)).messages), /base64|"data":/);
  rpc.notify({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
  await until(() => !chats.active.size);
  assert.equal(chats.pending, 0);
  await chats.start(chat.id, { requestId: 'follow-up', text: 'Try another idea' });
  await until(() => binaries[1]?.requests.some((r: any) => r.method === 'turn/start'));
  assert.equal(binaries[1].requests.find((r: any) => r.method === 'thread/resume').params.threadId, 'codex-thread');
  assert.equal((await chats.start(chat.id, input)).id, chat.id);
  await assert.rejects(chats.start(chat.id, { ...input, text: 'Different paid work' }), /REQUEST_ID_CONFLICT/);
  await chats.stop(chat.id); assert.equal((await chats.get(chat.id)).state, 'cancelled');
  await chats.start(chat.id, { requestId: 'follow-up', text: 'Try another idea' }); assert.equal(binaries.length, 2);
  await chats.start(chat.id, input);
  const restarted = new AssetConversations(store, { resolve: async () => { throw new Error('Replay must not need Codex'); } });
  const replay = await restarted.start(chat.id, input);
  assert.equal(replay.messages.filter(message => message.role === 'user').length, 2);
  assert.equal(replay.requestReceipts?.length, 2);
  await assert.rejects(restarted.start(chat.id, { ...input, text: 'Different paid work' }), /REQUEST_ID_CONFLICT/);
  assert.equal(binaries.length, 2);
  await chats.close(); await gatewayFor(store).close();
}, false));

test('legacy conversation receipts survive new turns and replay after references are trashed', () => fixture(async store => {
  const library = new AssetLibrary(store), asset = await library.importFile(await image(store.directory), { requestId: 'reference', name: 'Reference' });
  let launches = 0;
  class FakeRpc {
    constructor() { launches++; }
    async request(method: string) { return method.startsWith('thread/') ? { thread: { id: 'legacy-thread' } } : method === 'turn/start' ? { turn: { id: 'turn' } } : {}; }
    send() {}
    close() {}
  }
  const chats = new AssetConversations(store, { resolve: async () => '/fake/codex', rpc: FakeRpc as unknown as typeof AssetAgentRpc });
  try {
    const chat = await chats.create(), input = { requestId: 'legacy', text: 'Use this reference', references: [{ assetId: asset.id, versionId: asset.currentVersionId }] };
    await writeFile(await chats.file(chat.id), JSON.stringify({ ...chat, lastRequestId: input.requestId, lastRequestHash: assetHash(input) }));
    await chats.start(chat.id, { requestId: 'next', text: 'A new turn' });
    await until(() => launches === 1);
    await chats.stop(chat.id);
    await library.update(asset.id, { trashed: true });
    const restarted = new AssetConversations(store, { resolve: async () => null });
    assert.equal((await restarted.start(chat.id, input)).requestReceipts?.length, 2);
    await assert.rejects(restarted.start(chat.id, { ...input, text: 'Changed legacy input' }), /REQUEST_ID_CONFLICT/);
    assert.equal(launches, 1);
  } finally { await chats.close(); }
}, false));

test('audio assets persist probed waveforms, filter by server-side audioKind, search voice names, and derive short titles', () => fixture(async store => {
  const library = new AssetLibrary(store);
  const wav = path.join(store.directory, 'voice-sample.wav');
  assert.equal((await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', wav], store.directory)).code, 0);
  const uploaded = await library.importFile(wav, { requestId: 'upload-audio-1', name: 'Uploaded cue' });
  assert.ok(Array.isArray(uploaded.versions[0].waveform) && uploaded.versions[0].waveform!.length === 128);
  assert.equal(uploaded.versions[0].audioKind, 'upload');

  const speechPrepared = await library.prepare(wav);
  const speech = await store.lock(() => library.addLocked(speechPrepared, {
    name: audioAssetTitle('把需求详情页做成一个交付视图。负责人打开需求后，可以直接看出需求拆成了哪些工作、每项进展如何。'),
    expectedModality: 'audio',
    version: { source: 'generated', prompt: '把需求详情页做成一个交付视图。负责人打开需求后，可以直接看出需求拆成了哪些工作、每项进展如何。', model: 'opendesign:elevenlabs-v3', parameters: { voice: '21m00Tcm4TlvDq8ikWAM' }, references: [], requestId: 'gen-speech-1', requestHash: 'h1' },
  }));
  assert.equal(speech.name, '把需求详情页做成一个交付视图。');
  assert.equal(speech.versions[0].audioKind, 'speech');

  const sfxPrepared = await library.prepare(wav);
  await store.lock(() => library.addLocked(sfxPrepared, {
    name: 'Whoosh',
    expectedModality: 'audio',
    version: { source: 'generated', prompt: 'Cinema whoosh', model: 'fal:fal-ai/elevenlabs/sound-effects/v2', parameters: { duration_seconds: 2 }, references: [], requestId: 'gen-sfx-1', requestHash: 'h2' },
  }));

  // Persisted audioKind preserves catalogue mode/label classification even for opaque endpoint IDs.
  const opaqueSpeechPrepared = await library.prepare(wav);
  const opaqueSpeech = await store.lock(() => library.addLocked(opaqueSpeechPrepared, {
    name: 'Opaque narrator',
    expectedModality: 'audio',
    version: {
      source: 'generated',
      prompt: 'Narrator intro',
      model: 'opendesign:acme/narrator-v2',
      audioKind: classifyAudioKind('opendesign:acme/narrator-v2', 'text-to-speech', 'generated', 'acme/narrator-v2 Acme Narrator'),
      parameters: {},
      references: [],
      requestId: 'gen-opaque-speech',
      requestHash: 'h3',
    },
  }));
  assert.equal(opaqueSpeech.versions[0].audioKind, 'speech');

  const opaqueSfxPrepared = await library.prepare(wav);
  const opaqueSfx = await store.lock(() => library.addLocked(opaqueSfxPrepared, {
    name: 'Opaque impact',
    expectedModality: 'audio',
    version: {
      source: 'generated',
      prompt: 'Impact boom',
      model: 'opendesign:acme/impact-v1',
      audioKind: classifyAudioKind('opendesign:acme/impact-v1', 'text-to-audio', 'generated', 'acme/impact-v1 Acme Sound Effects'),
      parameters: {},
      references: [],
      requestId: 'gen-opaque-sfx',
      requestHash: 'h4',
    },
  }));
  assert.equal(opaqueSfx.versions[0].audioKind, 'sfx');

  assert.equal((await library.list({ modality: 'audio', audioKind: 'speech' })).total, 2);
  assert.equal((await library.list({ modality: 'audio', audioKind: 'sfx' })).total, 2);
  assert.equal((await library.list({ modality: 'audio', audioKind: 'upload' })).total, 1);
  assert.equal((await library.list({ modality: 'audio', audioKind: 'music' })).total, 0);
  // Searching by friendly voice name finds assets storing the raw ElevenLabs voice ID.
  assert.equal((await library.list({ modality: 'audio', query: 'Rachel' })).assets.map(a => a.id).includes(speech.id), true);
}, false));
