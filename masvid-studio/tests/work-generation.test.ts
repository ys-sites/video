import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { WorkRounds } from '../inline-video.ts';
import { renderNext } from '../server.ts';
import { pluginRoot } from '../hyperframes.ts';
import { createTracker, validProperties } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import { StudioRenderAttempts } from '../shared/studio-render-attempts.ts';

const film = `<!doctype html><html><head><meta charset="utf-8"><script src="assets/gsap.min.js"></script><style>
body{margin:0}#main{position:relative;width:320px;height:180px;background:#14354a}
#title{color:white;font-size:28px}</style></head><body>
<div id="main" data-composition-id="main" data-start="0" data-duration="2" data-width="320" data-height="180" data-fps="24">
<div id="title" class="clip" data-start="0" data-duration="2" data-track-index="0">An authored video</div></div><script>const tl=gsap.timeline({paused:true});tl.to('#title',{opacity:0.5,duration:2},0);window.__timelines={main:tl};</script></body></html>`;

function setup(store: any) {
  const events: any[] = [];
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0,
    send: async batch => { events.push(...batch); return 'accepted'; } });
  const service = new Phase1Service(store, pluginRoot, {
    origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async () => { assert.fail('Generation must not open the editor'); },
    mutation: async task => task(), cancel: async () => {}, tracking,
  });
  return { service, tracking, events };
}
async function begin(service: Phase1Service) {
  const project = await service.call('openmotion_create_project', { requestId: crypto.randomUUID(),
    projectType: 'natural_language', title: 'Telemetry fixture', requirements: 'A silent video' });
  const args = { action: 'begin', projectId: project.projectId, requestId: crypto.randomUUID(), mode: 'create' };
  const { inlineWork: work } = await service.call('openmotion_open_preview', args);
  return { project, work, args };
}
async function complete(service: Phase1Service, projectId: string, workId: string) {
  const current = await service.call('openmotion_get_project', { projectId });
  const args = { action: 'complete_generation', projectId, workId, requestId: crypto.randomUUID(),
    expectedRevision: current.revision, expectedVersionId: current.currentVersionId };
  return { result: await service.call('openmotion_open_preview', args), args };
}
const fixtureEvents: any[] = [];
const recordFixture = (events: any[]) => {
  const installation = crypto.randomUUID();
  fixtureEvents.push(...stages(events).map(e => ({ ...e, installation_id: installation })));
};
const stages = (events: any[]) => events.filter(e => e.event === 'work_generation_stage');

test('a video artifact completes independently of save, preview and export; replay reports one occurrence', () => fixture(async store => {
  const { service, tracking, events } = setup(store);
  const { project, work, args: beginArgs } = await begin(service);
  await service.call('openmotion_open_preview', beginArgs);
  // External Agents can author native files directly. No edit/save tool is called.
  await writeFile(path.join(store.projectDirectoryFor(project.projectId), 'index.html'), film);
  const { result, args } = await complete(service, project.projectId, work.id);
  await service.call('openmotion_open_preview', args);
  await complete(service, project.projectId, work.id);
  await tracking.flush();
  assert.ok(result.generation.completedAt);
  assert.deepEqual(stages(events).map(e => e.properties.stage), ['started', 'generated']);
  assert.ok(stages(events).every(e => e.properties.work_id === work.id && e.properties.project_id === project.projectId));
  assert.equal((await store.status()).exportJob, null);
  recordFixture(events);
  tracking.close();
}, false));

test('blank projects and metadata saves cannot count as generated video; a corrected artifact can complete', () => fixture(async store => {
  const { service, tracking, events } = setup(store);
  const { project, work } = await begin(service);
  await assert.rejects(complete(service, project.projectId, work.id), /GENERATION_CONTENT_UNCHANGED/);
  const edited = await service.call('openmotion_edit_project', { projectId: project.projectId, workId: work.id,
    requestId: crypto.randomUUID(), expectedRevision: project.revision, expectedVersionId: project.currentVersionId,
    files: [], requirements: 'Changed brief only' });
  await assert.rejects(complete(service, project.projectId, work.id), /GENERATION_CONTENT_UNCHANGED/);
  await service.call('openmotion_edit_project', { projectId: project.projectId, workId: work.id,
    requestId: crypto.randomUUID(), expectedRevision: edited.revision, expectedVersionId: edited.version.versionId,
    files: [{ path: 'index.html', content: film }] });
  await tracking.flush();
  assert.deepEqual(stages(events).map(e => e.properties.stage), ['started'], 'Saving alone never means generation completed');
  recordFixture(events);
  await complete(service, project.projectId, work.id);
  await tracking.flush();
  assert.deepEqual(stages(events).map(e => e.properties.stage), ['started', 'generated']);
  tracking.close();
}, false));

test('Studio content edits and background export keep the originating work after another round begins', t => fixture(async store => {
  const { service, tracking, events } = setup(store);
  const { project, work } = await begin(service);
  await writeFile(path.join(store.projectDirectoryFor(project.projectId), 'index.html'), film);
  await complete(service, project.projectId, work.id);
  const rounds = new WorkRounds(store, tracking);
  assert.equal((await rounds.latestGenerated(project.projectId))?.id, work.id);
  const edit = (extra: object) => rounds.studioEdited({ event: 'studio_edit_result',
    occurred_at: new Date().toISOString(), properties: { project_id: project.projectId,
      outcome: 'success', surface: 'timeline', edit_kind: 'timeline_trim', ...extra } });
  await edit({ outcome: 'failure' });
  await edit({ project_id: crypto.randomUUID() });
  await edit({ edit_kind: 'project_rename' });
  await edit({ surface: 'assets', edit_kind: 'asset_rename' });
  await edit({ surface: 'assets', edit_kind: 'asset_delete' });
  await tracking.flush();
  assert.equal(stages(events).length, 2);
  const insertFromAssets = { surface: 'assets', edit_kind: 'add_asset' };
  await Promise.all([edit(insertFromAssets), edit(insertFromAssets)]);
  await service.call('openmotion_open_preview', { action: 'begin', mode: 'modify',
    projectId: project.projectId, requestId: crypto.randomUUID() });
  assert.equal(await rounds.latestGenerated(project.projectId), undefined, 'A pending new generation cannot borrow the previous completion');
  const output = path.join(store.projectDirectoryFor(project.projectId), 'renders', 'unused.mp4');
  const state = { status: 'rendering', progress: 0 };
  let nativeOutput = '';
  const attempts = new StudioRenderAttempts(store.projectDirectoryFor(project.projectId), async attempt => {
    await rounds.exported(project.projectId, attempt.workId!, 'studio');
  });
  try {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { attempt } = attempts.start({ jobId: crypto.randomUUID(), outputPath: output },
      'Video', options => { nativeOutput = options.outputPath; return state; }, crypto.randomUUID(), work.id);
    await writeFile(nativeOutput, 'deterministic renderer fixture');
    state.status = 'complete'; state.progress = 100;
    // The server reconciliation timer runs with no browser or SSE reader.
    t.mock.timers.tick(500);
    await attempts.flushNotifications();
    await rounds.exported(project.projectId, work.id, 'mcp');
    assert.equal(attempts.get(attempt.id)?.fileAvailable, true);
    await tracking.flush();
    const result = stages(events).filter(e => e.properties.work_id === work.id);
    assert.deepEqual(result.map(e => e.properties.stage), ['started','generated','edited','exported']);
    assert.equal(result.at(-1).properties.export_route, 'studio');
    assert.ok(result.every(e => validProperties(omEvents, e.event, e.properties)));
    recordFixture(result);
    if (process.env.OPENMOTION_FUNNEL_FIXTURE)
      await writeFile(process.env.OPENMOTION_FUNNEL_FIXTURE, JSON.stringify(fixtureEvents, null, 2));
  } finally { attempts.close(); tracking.close(); }
}, false));

test('MCP rendering reports export completion on the same generated work', { timeout: 120_000 }, () => fixture(async store => {
  const { service, tracking, events } = setup(store);
  const { project, work } = await begin(service);
  await writeFile(path.join(store.projectDirectoryFor(project.projectId), 'index.html'), film);
  await complete(service, project.projectId, work.id);
  const current = await service.call('openmotion_get_project', { projectId: project.projectId });
  const requested = await service.call('openmotion_export_request', {
    projectId: project.projectId, workId: work.id, requestId: crypto.randomUUID(),
    versionId: current.currentVersionId, expectedRevision: current.revision, audio: 'silent',
  });
  await renderNext(store, pluginRoot, tracking);
  const job = await store.job(requested.job.id);
  assert.equal(job?.state, 'completed', JSON.stringify(job));
  await tracking.flush();
  assert.deepEqual(stages(events).map(e => e.properties.stage), ['started','generated','exported']);
  assert.equal(stages(events).at(-1).properties.work_id, work.id);
  assert.equal(stages(events).at(-1).properties.export_route, 'mcp');
  tracking.close();
}, false));

test('generation recorded while tracking is disabled is not replayed after opt-in', () => fixture(async store => {
  const { service, tracking, events } = setup(store);
  tracking.setEnabled(false);
  const { project, work } = await begin(service);
  await writeFile(path.join(store.projectDirectoryFor(project.projectId), 'index.html'), film);
  await complete(service, project.projectId, work.id);
  tracking.setEnabled(true);
  await new WorkRounds(store, tracking).exported(project.projectId, work.id, 'studio');
  await tracking.flush();
  assert.deepEqual(stages(events), []);
  tracking.close();
}, false));

test('telemetry rejects arbitrary project identifiers and accepts the built-in project', () => {
  const edit = { outcome: 'success', edit_kind: 'text', surface: 'canvas' };
  assert.ok(validProperties(omEvents,'studio_edit_result',{ ...edit, project_id: 'project' }));
  assert.equal(validProperties(omEvents,'studio_edit_result',{ ...edit, project_id: 'private-project-title' }), false);
});
