import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { authoredTemplateGuide, isTemplateGuideEvent, parseTemplateGuideDraft, upgradeTemplateGuidePage } from '../shared/template-guide.ts';
import { repositoryCatalogRoot } from '../shared/repository-template-catalog.ts';
import { materializeTemplateGuide } from '../gateway/template-guide.ts';
import { TemplateCatalog } from '../prism-templates.ts';
import { pluginRoot, inspectProject, nativeProjectConfig } from '../hyperframes.ts';
import { Phase1Service } from '../phase1.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { createTracker, deviceContext, type PendingEvent } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';

const lovable = 'motion-be2a4af0-0183-4979-ab05-2a68413c0890';
const stripe = 'motion-80dceb1d-5219-4e1f-9394-6baacf5d0166';

test('every catalog preview receives the common interface and retains its own authored content', async () => {
  const manifest = JSON.parse(await readFile(path.join(repositoryCatalogRoot, 'catalog.json'), 'utf8'));
  let authored = 0;
  const examples = new Set<string>();
  for (const id of manifest.templateIds) {
    const source = await readFile(path.join(repositoryCatalogRoot, id, 'source/preview.html'), 'utf8');
    const guide = authoredTemplateGuide(source); if (guide) { authored++; examples.add(JSON.stringify(guide)); }
    const result = upgradeTemplateGuidePage(source, { id, title: 'This template <script>must stay inert</script>' });
    assert.equal((result.match(/id="openmotion-guide-page"/g) || []).length, 1, id);
    assert(result.includes('"id":"' + id + '"'), id);
    assert(result.includes('/guide-assets/viewer.js'), id);
    assert(!result.includes('<script>must stay inert</script>'), id);
    if (guide) {
      assert(result.includes('data-demo='), id);
      assert(result.includes('viewer/guide.js'), id);
      assert(!result.includes('href="viewer/board.css"'), id);
      assert(!result.includes('openmotion-product-flow'), id);
    }
  }
  assert(manifest.templateIds.length >= 287);
  assert(authored >= 286);
  assert(examples.size > 250, 'entries must retain distinct defaults and durations');
});

test('guide drafts and analytics reject arbitrary fields and never collect changed text', () => {
  assert.deepEqual(parseTemplateGuideDraft({ title: 'My own launch', accent: '#ABCDEF' }), { title: 'My own launch', accent: '#abcdef' });
  for (const value of [{ title: '', accent: '#ffffff' }, { title: 'x'.repeat(61), accent: '#ffffff' }, { title: 'x', accent: 'url(private)' }, { title: 'x', accent: '#ffffff', templateId: stripe }])
    assert.throws(() => parseTemplateGuideDraft(value), /INVALID_GUIDE_DRAFT/);
  const event = { action: 'edit', view_id: crypto.randomUUID(), field: 'title' };
  assert(isTemplateGuideEvent(event)); assert(!isTemplateGuideEvent({ ...event, text: 'Private draft' }));
  assert(!isTemplateGuideEvent({ ...event, field: 'brand' }));
  assert(isTemplateGuideEvent({ action: 'document', view_id: event.view_id, expanded: true }));
  assert(!isTemplateGuideEvent({ ...event, expanded: true }));
  assert(isTemplateGuideEvent({ action: 'download', view_id: event.view_id, delivery_status: 'browser_save_requested' }));
  assert(!isTemplateGuideEvent({ action: 'download', view_id: event.view_id, delivery_status: 'saved_to_disk' }));
});

test('each selected guide materializes its own native canvas, timing and variables', () => fixture(async store => {
  const catalog = new TemplateCatalog(store.directory, { source: 'repository' });
  for (const id of [lovable, stripe]) {
    const directory = path.join(store.directory, id);
    const draft = { title: 'A "launch" <with content>', accent: '#8dff5c' };
    const result = await materializeTemplateGuide(catalog, id, directory, pluginRoot, draft);
    assert.equal(result.source.id, id); assert.equal(result.source.width, 1000); assert.equal(result.source.height, 600);
    assert.equal(result.source.provenance, 'authored-motion-guide-example');
    assert.deepEqual(await readFile(path.join(directory, 'demos/scene.js')), await catalog.sourceFile(id, 'demos/scene.js'));
    const motionDocument = (await readFile(path.join(directory, 'motion.md'))).toString();
    const manifest = JSON.parse((await readFile(path.join(directory, 'manifest.json'))).toString());
    const previewDocument = (await catalog.sourceFile(id, 'preview.html')).toString();
    const dependencies = new Set(['manifest.json', 'demos/sequence.html', ...manifest.files.map((file: { path: string }) => file.path).filter((name: string) => !name.startsWith('assets/') || motionDocument.includes(name) || previewDocument.includes(name)),
      ...[...motionDocument.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]).filter(link => !/^[a-z]+:|^#/.test(link))]);
    for (const dependency of dependencies) assert.deepEqual(await readFile(path.join(directory, dependency)), await catalog.sourceFile(id, dependency), id + ': ' + dependency);
    const index = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert(!index.includes(draft.title)); assert(index.includes('\\u003cwith content>'));
    assert(index.includes('data-composition-variables='));
    const lint = await inspectProject(pluginRoot, directory, 'lint'); assert.equal(lint.exitCode, 0, JSON.stringify(lint));
    const info = await inspectProject(pluginRoot, directory, 'info'); assert.equal(info.result.duration, result.source.durationSeconds);
    assert.equal(info.result.width, 1000); assert.equal(info.result.height, 600);
    const timeline = await inspectProject(pluginRoot, directory, 'timeline');
    const clips = timeline.result.timeline.tracks.flatMap((track: any) => track.rows).filter((clip: any) => !clip.nested);
    assert.deepEqual(clips.map((clip: any) => [clip.id, clip.absStart, clip.absEnd]), [['guide-example', 0, Number(result.source.durationSeconds.toFixed(3))]]);
  }
}, false));

test('MCP guide creation reuses the request, keeps the original template and rejects unsupported source', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const args = { requestId: 'lovable-guide-draft', projectType: 'template', templateId: lovable, title: 'My version', requirements: 'Continue the selected motion example', guideDraft: { title: 'My launch', accent: '#7050da' } };
  const created = await service.call('openmotion_create_project', args);
  const retried = await service.call('openmotion_create_project', args);
  assert.equal(created.projectId, retried.projectId);
  assert.equal(created.source.id, lovable); assert.equal(created.source.provenance, 'authored-motion-guide-example');
  assert.deepEqual(JSON.parse(await readFile(path.join(store.projectDirectoryFor(created.projectId), 'motion-project.json'), 'utf8')).guideDraft, args.guideDraft);
  await assert.rejects(service.call('openmotion_create_project', { ...args, guideDraft: { ...args.guideDraft, title: 'Other draft' } }), /REQUEST_ID_CONFLICT/);
  await assert.rejects(service.call('openmotion_create_project', { ...args, requestId: 'unsupported-guide', templateId: 'motion-orbit-launch' }), /GUIDE_NOT_EDITABLE/);
  assert.equal(store.projectCatalog().projects.filter(item => item.id === created.projectId).length, 1);
}, false));

test('guides with an existing native project keep generated authority and still materialize', () => fixture(async store => {
  const catalog = new TemplateCatalog(store.directory, { source: 'repository' });
  const ids = ['motion-0ad92fd0-b2fb-4885-957c-b71152df15fd', 'motion-1e48dea5-903d-48f6-b10e-99a70f1c183d',
    'motion-5eb6929e-d9f3-4a49-a69e-0363e45884dc', 'motion-664184d9-593e-4984-b473-701248b69cfe',
    'motion-a28f0e5d-aa8b-45a7-87f9-9afcac65a09b', 'motion-b31d078a-4e5e-461e-8b43-3101ee0a2f93',
    'motion-d8eea6d9-b25b-4727-823d-d102070ea694', 'motion-dac924da-010f-4445-baf3-a39cb033e48f',
    'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044'];
  for (const id of ids) {
    const directory = path.join(store.directory, id), draft = { title: 'Preserved guide draft', accent: '#63fe13' };
    await materializeTemplateGuide(catalog, id, directory, pluginRoot, draft);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert(html.includes('id="guide-example"')); assert(html.includes(draft.title));
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'hyperframes.json'), 'utf8')), nativeProjectConfig);
    assert.deepEqual(await readFile(path.join(directory, 'assets/gsap.min.js')), await readFile(path.join(pluginRoot, 'node_modules/gsap/dist/gsap.min.js')));
    assert.deepEqual(await readFile(path.join(directory, 'demos/scene.js')), await catalog.sourceFile(id, 'demos/scene.js'));
    assert.equal((await inspectProject(pluginRoot, directory, 'lint')).exitCode, 0, id);
  }
}, false));

test('the exact requested URLs serve upgraded pages, while raw source and downloads stay byte-identical', () => fixture(async store => {
  const request = transport(store);
  for (const id of [lovable, stripe, 'motion-orbit-launch']) {
    const pathName = `/api/template-source/${id}/preview.html`;
    const response = await request(pathName); assert.equal(response.status, 200);
    assert((await response.text()).includes('openmotion-guide-page'));
    assert.equal(await (await request(pathName + '?raw=1')).text(), await readFile(path.join(repositoryCatalogRoot, id, 'source/preview.html'), 'utf8'));
    const motion = await readFile(path.join(repositoryCatalogRoot, id, 'source/motion.md'), 'utf8');
    assert.equal(await (await request(`/api/template-source/${id}/motion.md`)).text(), motion);
    const download = await request(`/api/template-source/${id}/motion.md?download=1`);
    assert.equal(download.headers.get('content-disposition'), 'attachment; filename="motion.md"');
    assert.equal(await download.text(), motion);
  }
}, false));

test('a cleaned-up creation failure is terminal and unapplied through the real HTTP boundary', t => fixture(async store => {
  const original = TemplateCatalog.prototype.sourceFile;
  let fail = true;
  t.mock.method(TemplateCatalog.prototype, 'sourceFile', async function (...args: Parameters<typeof original>) {
    if (args[1] === 'demos/sequence.html' && fail) { fail = false; throw new Error('Temporary source unavailable'); }
    return original.apply(this, args);
  });
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  const request = transport(store, { phase1: service, runtimeRoot: pluginRoot });
  const args = { requestId: 'guide-source-failure', projectType: 'template', templateId: lovable, title: 'Recovery', requirements: 'Continue this example', guideDraft: { title: 'Recovery', accent: '#7050da' } };
  const create = (arguments_: typeof args) => request('/motion-api/phase1/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'openmotion_create_project', arguments: arguments_ }) });
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await create(args); assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Temporary source unavailable', applied: false });
  }
  const recovered = await create({ ...args, requestId: 'guide-recovered-source' }); assert.equal(recovered.status, 200);
  const project = await recovered.json();
  assert.equal(store.projectCatalog().projects.filter(item => item.id === project.projectId).length, 1);
}, false));


test('guide actions cross real Studio admission with closed metadata and respect opt-out', () => fixture(async store => {
  const received: PendingEvent[] = [];
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0,
    send: async events => { received.push(...events); return 'accepted'; } });
  const request = transport(store, { tracking });
  const view = crypto.randomUUID();
  const properties = [
    { action: 'shown' }, { action: 'edit', field: 'title' }, { action: 'chapter' }, { action: 'reference' },
    { action: 'document', expanded: true }, { action: 'source' },
    { action: 'download', delivery_status: 'browser_save_requested' }, { action: 'download', delivery_status: 'fetch_failed' },
    { action: 'open_editor' }, { action: 'open_editor', outcome: 'success', project_id: crypto.randomUUID() },
    { action: 'copy', outcome: 'manual_fallback' },
  ].map(value => ({ page_name: 'studio', template_id: lovable, view_id: view, ...value }));
  const packet = (value: Record<string, unknown>): PendingEvent => ({ event: 'template_guide_interaction', properties: value,
    event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), entrypoint: 'studio', ...deviceContext() });
  const send = (value: Record<string, unknown>) => request('/motion-api/tracking', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [packet(value)] }) });
  for (const value of properties) assert.equal((await send(value)).status, 200);
  assert.equal(await tracking.flush(), 'accepted'); assert.equal(received.length, properties.length);
  assert(received.every(event => event.properties.template_id === lovable && event.properties.view_id === view));
  assert.equal((await send({ ...properties[1], title: 'PRIVATE_COPY' })).status, 400);
  assert.equal((await send({ ...properties[6], delivery_status: 'saved_to_disk' })).status, 400);
  tracking.setEnabled(false);
  assert.equal((await send(properties[0])).status, 200); assert.equal(tracking.pending(), 0);
  assert.equal(received.length, properties.length); tracking.close();
}, false));
