import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.ts';
import { gatewayFor } from '../gateway/service.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';
import { mediaUse } from '../gateway/media-use.ts';

function setup(store: any) {
  const gateway = gatewayFor(store);
  gateway.options.detect = async () => [{ id: 'codex', label: 'Codex', installed: true, authenticated: true, available: true, imageGeneration: true, reason: 'fixture' }];
  return gateway;
}
function api(store: any) { return new Phase1Service(store, pluginRoot, { origin: () => 'http://localhost:4173', nativeUrl: () => undefined,
  openProject: async () => {}, mutation: async task => task(), cancel: async () => {} }); }

test('asset aliases share one receipt for the same request', () => fixture(async store => {
  setup(store); const service = api(store);
  const args = { action: 'generate', requestId: 'same', model: 'codex:image-generation', modality: 'image', prompt: 'Fixture only' };
  const first = await service.call('openmotion_assets_use', args);
  assert.equal((await service.call('openmotion_assets', args)).job.id, first.job.id);
}, false));

test('new project jobs are visible from Assets; library jobs retain their separate project ownership', () => fixture(async store => {
  const gateway = setup(store), service = api(store);
  // No worker is ticked: these fixtures only queue, inspect and cancel local jobs.
  await gateway.configureProvider('fal', { apiKey: 'synthetic-fixture-only' });
  const project = (await mediaUse(store, { action: 'generate', provider: 'fal', model: 'fal-ai/flux/schnell', requestId: 'same-id', projectId: store.projectId, modality: 'image', prompt: 'Fixture only' })).job;
  assert.equal((await mediaUse(store, { action: 'status', projectId: store.projectId, jobId: project.id })).job.id, project.id);
  assert.equal((await service.call('openmotion_assets_use', { action: 'status', jobId: project.id })).job.id, project.id);
  assert.ok((await service.call('openmotion_assets_use', { action: 'jobs' })).jobs.some((j: any) => j.id === project.id));
  const library = await service.call('openmotion_assets_use', { action: 'generate', requestId: 'same-id', model: 'fal:fal-ai/flux/schnell', modality: 'image', prompt: 'Fixture only' });
  assert.notEqual(library.job.id, project.id, 'Changing the destination does not replay a different request');
  await assert.rejects(mediaUse(store, { action: 'status', projectId: store.projectId, jobId: library.job.id }), /GENERATION_NOT_FOUND/);
}));

test('media discovery accepts the Codex image provider that Settings offers, and points new Codex images at the asset Tool', () => fixture(async store => {
  setup(store);
  const inspect = await mediaUse(store, { action: 'inspect' });
  const codex = inspect.providers.find((p: any) => p.id === 'codex');
  assert.equal(codex?.available, true);
  assert.deepEqual(inspect.references.find((r: any) => r.provider === 'codex'), { provider: 'codex', uri: 'openmotion://workflow/media/codex' });
  const models = await mediaUse(store, { action: 'models', provider: 'codex', modality: 'image' });
  assert.deepEqual(models.providers, ['codex']);
  assert(models.catalogs[0].models.some((model: any) => model.id === 'codex:image-generation'));
  const guide = await mediaUse(store, { action: 'reference', provider: 'codex' });
  assert.equal(guide.documentId, 'skills/openmotion-media/references/providers/codex.md');
  assert.match(guide.content, /"model":"codex:image-generation"/);
  await assert.rejects(mediaUse(store, { action: 'generate', provider: 'codex', model: 'image-generation', requestId: 'codex-direct', projectId: store.projectId, modality: 'image', prompt: 'Fixture only' }),
    (error: any) => error.invalid_field === 'provider' && /openmotion_assets_use/.test(error.message));
}, false));
