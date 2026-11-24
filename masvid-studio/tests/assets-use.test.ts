import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises';
import { fixture } from './fixtures.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { AssetLibrary } from '../gateway/asset-library.ts';
import { Phase1Service } from '../phase1.ts';
import { phase1Tools, validateInput, phase1TransportTool, phase1McpCapabilities } from '../shared/phase1-tools.ts';
import { buildOpenMotionWebMcpTools } from '../shared/webmcp-tools.ts';
import { transport } from './http.ts';
import { gatewayFor } from '../gateway/service.ts';

const service = (store: any) => new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
async function media(directory: string, filename: string, input: string[], output: string[] = []) {
  const file = path.join(directory, filename);
  const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', ...input, ...output, '-y', file], directory, 20_000);
  assert.equal(result.code, 0, result.stderr); return file;
}
const image = (dir: string, color: string) => media(dir, color + '.png', ['-f', 'lavfi', '-i', `color=c=${color}:s=32x24`], ['-frames:v', '1']);

test('preferred and compatible asset tools are discover save recovery and retain action-specific validation', () => {
  assert.equal(phase1TransportTool({ mcp: phase1McpCapabilities }, 'openmotion_assets_use'), 'openmotion_assets_use');
  assert.equal(phase1TransportTool({ mcp: { protocol: 1, tools: ['openmotion_assets', 'motion_assets'] } }, 'openmotion_assets_use'), undefined);
  const compatible = phase1Tools.find(tool => tool.name === 'openmotion_assets')!;
  assert.ok(compatible.inputSchema.properties.action.enum.includes('resume'));
  assert.ok(!('timestamps' in compatible.inputSchema.properties));
  for (const name of ['openmotion_assets_use']) {
    const tool = phase1Tools.find(tool => tool.name === name);
    assert.ok(tool, name);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.ok(tool.inputSchema.properties.action.enum.includes('brand_kit'));
    assert.throws(() => validateInput(tool.inputSchema, { action: 'read', assetId: crypto.randomUUID() }), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(tool.inputSchema, { action: 'read', assetId: crypto.randomUUID(), versionId: crypto.randomUUID(), timestamps: [Infinity] }), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(tool.inputSchema, { action: 'read', assetId: crypto.randomUUID(), versionId: crypto.randomUUID(), timestamps: [0, 1, 2, 3, 4] }), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(tool.inputSchema, { action: 'generate', requestId: 'missing-model' }), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(tool.inputSchema, { action: 'retry_save', jobId: crypto.randomUUID() }), /INVALID_ARGUMENT/);
    assert.throws(() => validateInput(tool.inputSchema, { action: 'retry_save', requestId: 'save-only' }), /INVALID_ARGUMENT/);
    validateInput(tool.inputSchema, { action: 'retry_save', jobId: crypto.randomUUID(), requestId: 'save-only' });
  }
});

test('both names share upload receipts and read the exact immutable version without changing the library', () => fixture(async store => {
  const api = service(store), library = new AssetLibrary(store);
  const input = { action: 'import', requestId: 'shared', sourcePath: await image(store.directory, 'red'), name: 'Subject' };
  const { asset } = await api.call('openmotion_assets_use', input);
  assert.equal((await api.call('openmotion_assets', input)).asset.id, asset.id);
  await api.call('openmotion_assets_use', { ...input, requestId: 'blue', sourcePath: await image(store.directory, 'blue'), assetId: asset.id, parentVersionId: asset.currentVersionId });
  const before = await library.get(asset.id);
  const args = { action: 'read', assetId: asset.id, versionId: asset.currentVersionId };
  const result = await api.call('openmotion_assets_use', args);
  assert.equal((await api.call('openmotion_assets', { ...args, action: 'get' })).version.sha256, result.version.sha256);
  await assert.rejects(api.call('openmotion_assets', args), /INVALID_ARGUMENT/);
  assert.equal(result.versionId, asset.currentVersionId);
  assert.equal(result.version.sha256, asset.versions[0].sha256);
  assert.equal(result.previews[0].width, 32); assert.equal(result.previews[0].height, 24);
  const preview = result.content.find((item: any) => item.type === 'image');
  assert.equal(preview.mimeType, 'image/png');
  const file = path.join(store.directory, 'preview.png'); await writeFile(file, Buffer.from(preview.data, 'base64'));
  const pixels = await media(store.directory, 'pixels.rgb', ['-i', file], ['-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24']);
  const rgb = await readFile(pixels); assert.ok(rgb[0] > 200 && rgb[2] < 10, 'Read must show red V1, not current blue V2');
  assert.deepEqual(await library.get(asset.id), before);
  assert.deepEqual(await readdir(path.join(library.root, 'staging')), []);
  await api.call('openmotion_assets_use', { action: 'update', assetId: asset.id, changes: { trashed: true } });
  assert.equal((await api.call('openmotion_assets_use', args)).versionId, asset.currentVersionId, 'Retained trash remains readable, like get/download');
  await assert.rejects(api.call('openmotion_assets_use', { ...args, versionId: crypto.randomUUID() }), /UNAVAILABLE/);
  await assert.rejects(api.call('openmotion_assets_use', { ...args, timestamps: [0] }), /timestamps/);
  const source = (await library.resolve({ assetId: asset.id, versionId: asset.currentVersionId }, true)).filename;
  await writeFile(source, await readFile(input.sourcePath.replace('red.png', 'blue.png')));
  await assert.rejects(api.call('openmotion_assets_use', args), /ASSET_CONTENT_CHANGED/);
  assert.deepEqual(await readdir(path.join(library.root, 'staging')), []);
  await rm(source); await symlink(input.sourcePath, source);
  await assert.rejects(api.call('openmotion_assets_use', args));
}, false));

test('preferred tool keeps all nine operations on the existing jobs, receipts and project import authority', () => fixture(async store => {
  const api = service(store), gateway = gatewayFor(store);
  gateway.options.detect = async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, imageGeneration: true, available: true, reason: 'fixture' }];
  let calls = 0;
  gateway.options.codex = async () => { calls++; return readFile(await image(store.directory, 'green')); };
  try {
    const args = { action: 'generate', requestId: 'mock-generation', model: 'codex:image-generation', modality: 'image', prompt: 'Green' };
    const { job } = await api.call('openmotion_assets_use', args);
    assert.equal((await api.call('openmotion_assets', args)).job.id, job.id);
    assert.ok((await api.call('openmotion_assets_use', { action: 'jobs' })).jobs.some((item: any) => item.id === job.id));
    await gateway.tick(); await Promise.all([...gateway.active.values()].map(task => task.done));
    const done = (await api.call('openmotion_assets_use', { action: 'status', jobId: job.id })).job;
    assert.equal(done.state, 'completed'); assert.equal(calls, 1);
    const reference = done.libraryAssets[0];
    assert.equal((await api.call('openmotion_assets_use', { action: 'get', ...reference })).asset.id, reference.assetId);
    assert.ok((await api.call('openmotion_assets_use', { action: 'list' })).assets.some((asset: any) => asset.id === reference.assetId));
    await api.call('openmotion_assets_use', { action: 'update', assetId: reference.assetId, changes: { name: 'Renamed' } });
    const cancelled = (await api.call('openmotion_assets_use', { ...args, requestId: 'cancel-me' })).job;
    assert.equal((await api.call('openmotion_assets_use', { action: 'cancel', jobId: cancelled.id })).job.state, 'cancelled');
    const project = await api.call('openmotion_create_project', { requestId: 'film', projectType: 'natural_language', title: 'Film', requirements: 'Silent' });
    const input = { action: 'import_to_project', projectId: project.projectId, requestId: 'adopt', ...reference };
    const imported = await api.call('openmotion_assets_use', input);
    assert.equal(imported.status, 'completed'); assert.equal(imported.appliedToTimeline, false);
    const replay = await api.call('openmotion_assets', input);
    assert.equal(replay.items[0].assetId, imported.items[0].assetId);
    assert.equal(replay.items[0].path, imported.items[0].path);
    assert.equal(replay.items[0].sha256, imported.items[0].sha256);
  } finally { await gateway.close(); }
}, false));

test('large image previews retain aspect ratio and stay within the advertised pixel and byte limits', () => fixture(async store => {
  const library = new AssetLibrary(store);
  const file = await media(store.directory, 'large.png', ['-f', 'lavfi', '-i', 'color=c=red@0.5:s=2048x1024,format=rgba'], ['-frames:v', '1']);
  const asset = await library.importFile(file, { requestId: 'large', name: 'Large' });
  const result = await service(store).call('openmotion_assets_use', { action: 'read', assetId: asset.id, versionId: asset.currentVersionId });
  assert.equal(result.previews[0].width, 1024); assert.equal(result.previews[0].height, 512);
  assert.ok(result.previews[0].bytes <= 4 * 1024 * 1024);
  assert.equal(result.version.width, 2048);
  const preview = path.join(store.directory, 'alpha.png');
  await writeFile(preview, Buffer.from(result.content.find((item: any) => item.type === 'image').data, 'base64'));
  const pixels = await media(store.directory, 'alpha.rgba', ['-i', preview], ['-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba']);
  const alpha = (await readFile(pixels))[3];
  assert.ok(alpha > 100 && alpha < 150, 'Preview must retain semi-transparent pixels');
}, false));

test('video frames and audio clips are bounded, labelled and returned as media through WebMCP', () => fixture(async store => {
  const library = new AssetLibrary(store), api = service(store);
  const video = await media(store.directory, 'clip.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=64x48:rate=10:duration=1'], ['-an']);
  const a = await library.importFile(video, { requestId: 'video', name: 'Video' });
  const args = { action: 'read', assetId: a.id, versionId: a.currentVersionId, timestamps: [0, 0.5] };
  const request = transport(store, { runtimeRoot: pluginRoot });
  const tool = buildOpenMotionWebMcpTools(request).find(tool => tool.name === 'openmotion_assets_use')!;
  const result = await tool.execute(args);
  assert.equal(result.structuredContent.assetId, a.id);
  assert.deepEqual(result.structuredContent.previews.map((p: any) => p.timestamp), [0, 0.5]);
  assert.equal(result.content.filter((item: any) => item.type === 'image').length, 2);
  assert.ok(result.content.some((item: any) => item.type === 'text' && item.text.includes('0.5')));
  assert.ok(!JSON.stringify(result.structuredContent).includes('"data"'), 'Base64 must not be duplicated in metadata');
  await assert.rejects(api.call('openmotion_assets_use', { ...args, timestamps: [1] }), /timestamp/);
  const audio = await media(store.directory, 'tone.wav', ['-f', 'lavfi', '-i', 'sine=duration=2']);
  const b = await library.importFile(audio, { requestId: 'audio', name: 'Audio' });
  const clip = await tool.execute({ action: 'read', assetId: b.id, versionId: b.currentVersionId, start: 0.25, duration: 0.4 });
  assert.equal(clip.content.filter((item: any) => item.type === 'audio').length, 1);
  assert.equal(clip.structuredContent.previews[0].start, 0.25);
  assert.ok(Math.abs(clip.structuredContent.previews[0].duration - 0.4) < 0.01);
  assert.ok(clip.structuredContent.previews[0].bytes < 20_000);
  await assert.rejects(api.call('openmotion_assets_use', { action: 'read', assetId: b.id, versionId: b.currentVersionId, duration: 16 }), /INVALID_ARGUMENT/);
  await assert.rejects(api.call('openmotion_assets_use', { action: 'read', assetId: b.id, versionId: b.currentVersionId, start: 2 }), /start/);
}, false));
