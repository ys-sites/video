import assert from 'node:assert/strict';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { designProjectsFor } from '../design-projects.ts';
import { ScenarioRuns, type ScenarioHost } from '../gateway/scenario-runs.ts';
import { gatewayFor } from '../gateway/service.ts';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { Service } from '../server.ts';
import { draftSocialPosts } from '../shared/scenario-content.ts';
import { SCENARIO_LIMITS } from '../shared/scenario-runs.ts';
import { findScenario } from '../shared/scenarios.ts';
import { studioScenes } from '../shared/studio-catalog.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';

async function makePng(dir: string, name = 'product.png', color = 'orange'): Promise<string> {
  const file = path.join(dir, name);
  const result = await execute(
    verificationBinaries().ffmpeg,
    ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=48x36`, '-frames:v', '1', '-y', file],
    dir,
    20_000,
  );
  assert.equal(result.code, 0, result.stderr);
  return file;
}

async function callScenario(
  api: ReturnType<typeof transport>,
  scenarioArgs: Record<string, unknown>,
) {
  const res = await api('/motion-api/phase1/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'openmotion_assets_use',
      arguments: { action: 'scenario', scenario: scenarioArgs },
    }),
  });
  const body = await res.json();
  return { status: res.status, body };
}

test('scenario generation localizes video and audio names using the current or saved draft locale', () =>
  fixture(async store => {
    const runs = new ScenarioRuns(store.directory, store);
    const submittedNames: unknown[] = [];
    const host: ScenarioHost = {
      origin: () => 'http://localhost',
      assets: async input => {
        submittedNames.push(input.name);
        return { job: { id: `job-${submittedNames.length}`, state: 'queued' } };
      },
      design: designProjectsFor(store.directory),
      resolveAsset: async () => null,
      createMotionProject: async () => { throw new Error('Unexpected Motion project creation'); },
      exportMotionArchive: async () => { throw new Error('Unexpected Motion archive export'); },
    };
    const { run } = await runs.create({ scenarioId: 'motion-full-chain', requestId: 'localized-media-english' });
    const date = run.title.split(' · ').at(-1);
    const { run: afterMusic } = await runs.generate({
      runId: run.id, expectedRevision: run.revision, requestId: 'localized-media-audio',
      stepId: 'soundtrack', modality: 'audio', model: 'account:elevenlabs-music-v2', prompt: 'Calm piano', locale: 'zh-CN',
    }, host);
    const video = {
      runId: run.id, expectedRevision: afterMusic.revision, requestId: 'localized-media-video',
      stepId: 'motion-film', modality: 'video' as const, model: 'test:video', prompt: 'A moving title', locale: 'zh-CN',
    };
    const { run: afterVideo } = await runs.generate(video, host);
    await runs.generate(video, host);
    await runs.generate({
      ...video, expectedRevision: afterVideo.revision, requestId: 'localized-media-video-en', locale: 'en',
    }, host);

    const { run: custom } = await runs.create({
      scenarioId: 'motion-full-chain', requestId: 'localized-media-custom', title: 'My 夏日短片', locale: 'ja',
    });
    await runs.generate({
      ...video, runId: custom.id, expectedRevision: custom.revision, requestId: 'localized-media-video-ja', locale: undefined,
    }, host);
    assert.deepEqual(submittedNames, [
      `创意到动效短片 · ${date} · 配乐与音频 v1`,
      `创意到动效短片 · ${date} · 动效影片 v1`,
      `Idea to Motion Film · ${date} · Motion film v2`,
      'My 夏日短片 · モーション映像 v1',
    ]);
  }),
);

test('scenario runs end-to-end: catalog, CRUD, conflicts, pool, iterations, generation, design embed, motion and persistence', () =>
  fixture(async store => {
    const api = transport(store, { runtimeRoot: pluginRoot } as Service);

    // 1. catalog returns 5 scenarios across 3 categories, unique step ids, valid studioScenes
    const catRes = await callScenario(api, { command: 'catalog' });
    assert.equal(catRes.status, 200);
    assert.equal(catRes.body.scenarios.length, 5);
    assert.equal(catRes.body.categories.length, 3);
    const validScenes = new Set<string>(studioScenes.map(s => s.id));
    for (const scenario of catRes.body.scenarios) {
      const ids = scenario.steps.map((s: any) => s.id);
      assert.equal(new Set(ids).size, ids.length, `Unique step ids in ${scenario.id}`);
      for (const step of scenario.steps) {
        for (const sceneId of step.scenes ?? []) {
          assert.ok(validScenes.has(sceneId), `Scene ${sceneId} exists in studioScenes`);
        }
      }
    }

    // 2. create idempotency & conflict on mismatched input
    const created1 = await callScenario(api, {
      command: 'create',
      requestId: 'req-create-bf',
      scenarioId: 'black-friday',
      title: 'Holiday Tote Campaign',
      locale: 'zh-CN',
    });
    assert.equal(created1.status, 200);
    const run1 = created1.body.run;
    assert.equal(run1.revision, 1);
    assert.equal(run1.scenarioId, 'black-friday');
    assert.match(run1.steps['product-images'].draft.prompt, /^拍摄一张商业产品图/);
    assert.equal(run1.steps['product-images'].draft.promptLocale, 'zh-CN');

    const createdReplay = await callScenario(api, {
      command: 'create',
      requestId: 'req-create-bf',
      scenarioId: 'black-friday',
      title: 'Holiday Tote Campaign',
      locale: 'zh-CN',
    });
    assert.equal(createdReplay.status, 200);
    assert.equal(createdReplay.body.run.id, run1.id);

    const createdConflict = await callScenario(api, {
      command: 'create',
      requestId: 'req-create-bf',
      scenarioId: 'ai-influencer',
      title: 'Different',
    });
    assert.equal(createdConflict.status, 400);
    assert.match(createdConflict.body.error, /^INVALID_ARGUMENT:/);

    // 3. update_brief stale expectedRevision -> SCENARIO_CONFLICT; current -> revision +1 & seeds prompts
    const staleBrief = await callScenario(api, {
      command: 'update_brief',
      runId: run1.id,
      expectedRevision: 99,
      requestId: 'req-brief-stale',
      brief: { productName: 'Holiday Tote' },
    });
    assert.equal(staleBrief.status, 400);
    assert.match(staleBrief.body.error, /^SCENARIO_CONFLICT:.*currentRevision is 1/);

    const updatedBrief = await callScenario(api, {
      command: 'update_brief',
      runId: run1.id,
      expectedRevision: 1,
      requestId: 'req-brief-1',
      brief: {
        idea: 'Limited-run canvas tote for weekend escapes',
        productName: 'Holiday Tote',
        productDescription: 'Waxed cotton canvas with brass hardware',
        originalPrice: '$129',
        salePrice: '$79',
        promoCode: 'BF40',
        saleWindow: 'Nov 27 – Dec 1',
      },
    });
    assert.equal(updatedBrief.status, 200);
    let currentRun = updatedBrief.body.run;
    assert.equal(currentRun.revision, 2);
    assert.match(String(currentRun.steps['product-images'].draft.prompt), /产品名称：Holiday Tote/);
    assert.match(String(currentRun.steps['sales-film'].draft.prompt), /\$79/);

    // 4. add_pool with real uploaded asset pins version, dedupes ref, rejects unknown asset
    const pngPath = await makePng(store.directory, 'tote.png', 'crimson');
    const pngBytes = await readFile(pngPath);
    const uploadRes = await api('/motion-api/assets/upload?requestId=req-upload-tote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('tote.png') },
      body: new Blob([new Uint8Array(pngBytes)]),
    });
    assert.equal(uploadRes.status, 200);
    const uploadedAsset = (await uploadRes.json()).asset;

    const addPoolRes = await callScenario(api, {
      command: 'add_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-pool-add-1',
      items: [
        {
          ref: { type: 'asset', assetId: uploadedAsset.id, versionId: uploadedAsset.currentVersionId },
          label: 'Tote Hero',
          source: 'upload',
          stepId: 'product-images',
          tags: ['product'],
        },
        {
          ref: { type: 'asset', assetId: uploadedAsset.id, versionId: uploadedAsset.currentVersionId },
          label: 'Duplicate Tote',
          source: 'upload',
        },
      ],
    });
    assert.equal(addPoolRes.status, 200);
    currentRun = addPoolRes.body.run;
    assert.equal(currentRun.pool.length, 1, 'Duplicate ref is deduped');
    const uploadedPoolId = currentRun.pool[0].id;

    const unknownPoolRes = await callScenario(api, {
      command: 'add_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-pool-missing',
      items: [{
        ref: {
          type: 'asset',
          assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        },
        source: 'workspace',
      }],
    });
    assert.equal(unknownPoolRes.status, 400);
    assert.match(unknownPoolRes.body.error, /^ASSET_NOT_FOUND:/);

    // 5. add_iteration with social posts, promote, and remove_pool strips from bindings
    const posts = draftSocialPosts(findScenario('black-friday')!, currentRun.brief, ['x', 'xiaohongshu'], { variant: 0 });
    const addIterRes = await callScenario(api, {
      command: 'add_iteration',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-social-iter-1',
      stepId: 'social',
      iteration: { source: 'local', outputs: [{ type: 'social', posts }], note: 'First draft' },
    });
    assert.equal(addIterRes.status, 200);
    currentRun = addIterRes.body.run;
    const firstIterId = addIterRes.body.iteration.id;

    const addIter2Res = await callScenario(api, {
      command: 'add_iteration',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-social-iter-2',
      stepId: 'social',
      iteration: {
        source: 'local',
        outputs: [{ type: 'social', posts: draftSocialPosts(findScenario('black-friday')!, currentRun.brief, ['x', 'xiaohongshu'], { variant: 1 }) }],
      },
    });
    assert.equal(addIter2Res.status, 200);
    currentRun = addIter2Res.body.run;
    const secondIterId = addIter2Res.body.iteration.id;
    assert.equal(currentRun.steps.social.activeIterationId, secondIterId);

    const promoteRes = await callScenario(api, {
      command: 'promote',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-promote-social-1',
      stepId: 'social',
      iterationId: firstIterId,
    });
    assert.equal(promoteRes.status, 200);
    currentRun = promoteRes.body.run;
    assert.equal(currentRun.steps.social.activeIterationId, firstIterId);

    // Bind uploaded pool item to product-images, then remove a second pool item and confirm bindings stripped
    const secondPngPath = await makePng(store.directory, 'extra.png', 'navy');
    const uploadRes2 = await api('/motion-api/assets/upload?requestId=req-upload-extra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent('extra.png') },
      body: new Blob([new Uint8Array(await readFile(secondPngPath))]),
    });
    const extraAsset = (await uploadRes2.json()).asset;
    const addExtra = await callScenario(api, {
      command: 'add_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-pool-extra',
      items: [{ ref: { type: 'asset', assetId: extraAsset.id, versionId: extraAsset.currentVersionId }, label: 'Extra', source: 'upload' }],
    });
    currentRun = addExtra.body.run;
    const extraPoolId = addExtra.body.poolItemIds[0];

    const bindRes = await callScenario(api, {
      command: 'update_step',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-bind-extra',
      stepId: 'product-images',
      bindings: { references: [uploadedPoolId, extraPoolId] },
    });
    assert.equal(bindRes.status, 200);
    currentRun = bindRes.body.run;
    assert.deepEqual(currentRun.steps['product-images'].bindings.references, [uploadedPoolId, extraPoolId]);

    const removeRes = await callScenario(api, {
      command: 'remove_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-remove-extra',
      poolItemId: extraPoolId,
    });
    assert.equal(removeRes.status, 200);
    currentRun = removeRes.body.run;
    assert.deepEqual(currentRun.steps['product-images'].bindings.references, [uploadedPoolId]);

    // 6. generate with no configured provider fails with PROVIDER_UNAVAILABLE and persists no iteration
    const gateway = gatewayFor(store);
    gateway.options.detect = async () => [];
    const noProvRes = await callScenario(api, {
      command: 'generate',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-gen-none',
      stepId: 'product-images',
      modality: 'image',
      model: 'codex:image-generation',
      prompt: 'Studio tote photo',
    });
    assert.equal(noProvRes.status, 400);
    assert.match(noProvRes.body.error, /^PROVIDER_UNAVAILABLE:/);
    const afterFailedGen = await callScenario(api, { command: 'get', runId: currentRun.id });
    assert.equal(afterFailedGen.body.run.steps['product-images'].iterations.length, 0);

    // 7. generate with synthetic codex provider + tick + sync -> pool gains generated image, auto-promotes
    gateway.options.detect = async () => [{
      id: 'codex',
      label: 'Codex',
      installed: true,
      authenticated: true,
      imageGeneration: true,
      available: true,
      reason: 'ready',
    }];
    gateway.options.codex = async () => pngBytes;
    await gateway.agents(true);

    const genRes = await callScenario(api, {
      command: 'generate',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-gen-codex-1',
      stepId: 'product-images',
      modality: 'image',
      model: 'codex:image-generation',
      prompt: 'Studio tote photo on marble',
    });
    assert.equal(genRes.status, 200, JSON.stringify(genRes.body));
    currentRun = genRes.body.run;
    assert.equal(currentRun.steps['product-images'].iterations.length, 1);

    await gateway.tick();
    await Promise.all([...gateway.active.values()].map(task => task.done));

    const syncedRes = await callScenario(api, { command: 'sync', runId: currentRun.id });
    assert.equal(syncedRes.status, 200);
    currentRun = syncedRes.body.run;
    const genIter = currentRun.steps['product-images'].iterations[0];
    assert.equal(genIter.job.state, 'completed');
    assert.equal(currentRun.steps['product-images'].activeIterationId, genIter.id, 'Auto-promoted completed generation');
    const generatedPoolItem = currentRun.pool.find((item: any) => item.source === 'generated' && item.stepId === 'product-images');
    assert.ok(generatedPoolItem, 'Pool gained generated image with stepId');

    // 8. create_page starter creates Design project with productName and data-om-slot="hero"
    const createPageRes = await callScenario(api, {
      command: 'create_page',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-page-starter',
      stepId: 'detail-page',
      mode: 'starter',
    });
    assert.equal(createPageRes.status, 200, JSON.stringify(createPageRes.body));
    currentRun = createPageRes.body.run;
    const designProjectId = createPageRes.body.project.id;
    const designProject = await designProjectsFor(store.directory).get(designProjectId);
    const indexBefore = await designProjectsFor(store.directory).readFile(designProjectId, 'index.html');
    assert.ok(indexBefore.content.includes('Holiday Tote'));
    assert.ok(indexBefore.content.includes('data-om-slot="hero"'));

    // 9. embed_image: stale design revision -> DESIGN_CONFLICT; current -> assets/*, ./assets/..., new version, pool ref updated
    const staleEmbed = await callScenario(api, {
      command: 'embed_image',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-embed-stale',
      stepId: 'detail-page',
      designProjectId,
      expectedDesignRevision: '0'.repeat(64),
      poolItemId: generatedPoolItem.id,
      target: { kind: 'slot', slot: 'hero' },
      alt: 'Holiday Tote Hero',
    });
    assert.equal(staleEmbed.status, 400);
    assert.match(staleEmbed.body.error, /^DESIGN_CONFLICT:/);

    const embedRes = await callScenario(api, {
      command: 'embed_image',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-embed-1',
      stepId: 'detail-page',
      designProjectId,
      expectedDesignRevision: designProject.revision,
      poolItemId: generatedPoolItem.id,
      target: { kind: 'slot', slot: 'hero' },
      alt: 'Holiday Tote Hero',
    });
    assert.equal(embedRes.status, 200, JSON.stringify(embedRes.body));
    currentRun = embedRes.body.run;
    assert.match(embedRes.body.path, /^assets\/.+\.png$/);
    const designAfter = await designProjectsFor(store.directory).get(designProjectId);
    assert.ok(designAfter.files.some(f => f.path === embedRes.body.path));
    const indexAfter = await designProjectsFor(store.directory).readFile(designProjectId, 'index.html');
    assert.ok(indexAfter.content.includes(`./${embedRes.body.path}`));
    const versions = await designProjectsFor(store.directory).listVersions(designProjectId);
    assert.ok(versions.versions.length >= 3, 'New design versions created for import and write');
    const pagePoolItem = currentRun.pool.find((item: any) => item.kind === 'page' && item.ref.projectId === designProjectId);
    assert.equal(pagePoolItem.ref.revision, designAfter.revision);

    // 10. create_motion registers Motion project with imported pool assets and links
    const motionRes = await callScenario(api, {
      command: 'create_motion',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-motion-1',
      stepId: 'sales-film',
      projectType: 'natural_language',
      title: 'Holiday Tote 30s Film',
      poolItemIds: [uploadedPoolId],
    });
    assert.equal(motionRes.status, 200, JSON.stringify(motionRes.body));
    currentRun = motionRes.body.run;
    const motionProjectId = motionRes.body.project.projectId;
    assert.equal(currentRun.steps['sales-film'].links.motionProjectId, motionProjectId);
    assert.ok(currentRun.pool.some((item: any) => item.kind === 'motion' && item.ref.projectId === motionProjectId));
    const importedAssetIndex = JSON.parse(
      await readFile(path.join(store.projectDirectoryFor(motionProjectId), 'motion-assets.json'), 'utf8'),
    );
    assert.equal(importedAssetIndex.length, 1, 'Pool asset was imported into Motion project');

    // 10b. Agent write-back via add_pool with recordIteration=true adds to Assets and step history atomically (idempotent on retry)
    const writeBackRes = await callScenario(api, {
      command: 'add_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision,
      requestId: 'req-agent-writeback-1',
      recordIteration: true,
      note: 'Agent refined keyshot',
      items: [{
        ref: { type: 'asset', assetId: extraAsset.id, versionId: extraAsset.currentVersionId },
        label: 'Agent Refined Hero',
        stepId: 'product-images',
        source: 'agent',
      }],
    });
    assert.equal(writeBackRes.status, 200, JSON.stringify(writeBackRes.body));
    currentRun = writeBackRes.body.run;
    const writtenPoolId = writeBackRes.body.poolItemIds[0];
    assert.ok(currentRun.pool.some((item: any) => item.id === writtenPoolId && item.source === 'agent'));
    const productIters = currentRun.steps['product-images'].iterations;
    const latestProductIter = productIters[productIters.length - 1];
    assert.equal(latestProductIter.source, 'agent');
    assert.equal(latestProductIter.note, 'Agent refined keyshot');
    assert.deepEqual(latestProductIter.outputs, [{ type: 'pool', poolItemId: writtenPoolId }]);
    assert.equal(currentRun.steps['product-images'].activeIterationId, latestProductIter.id);

    const retryWriteBack = await callScenario(api, {
      command: 'add_pool',
      runId: currentRun.id,
      expectedRevision: currentRun.revision - 1,
      requestId: 'req-agent-writeback-1',
      recordIteration: true,
      note: 'Agent refined keyshot',
      items: [{
        ref: { type: 'asset', assetId: extraAsset.id, versionId: extraAsset.currentVersionId },
        label: 'Agent Refined Hero',
        stepId: 'product-images',
        source: 'agent',
      }],
    });
    assert.equal(retryWriteBack.status, 200);
    assert.equal(retryWriteBack.body.run.revision, currentRun.revision, 'Idempotent replay reuses revision');
    assert.equal(retryWriteBack.body.run.steps['product-images'].iterations.length, productIters.length);

    // 11. Persistence: fresh ScenarioRuns instance reads run, no .tmp files remain, corrupt file skipped by list
    const runsDir = path.join(store.directory, 'scenarios', 'runs');
    const dirEntries = await readdir(runsDir);
    assert.ok(!dirEntries.some(name => name.endsWith('.tmp')), 'No .tmp files left in runs directory');

    await writeFile(path.join(runsDir, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc.json'), '{not valid json', 'utf8');
    const freshService = new ScenarioRuns(store.directory, store);
    const loaded = await freshService.get(currentRun.id);
    assert.equal(loaded.run.id, currentRun.id);
    assert.equal(loaded.run.revision, currentRun.revision);
    const listed = await freshService.list();
    assert.equal(listed.runs.length, 1, 'Corrupt run file is skipped without failing list');
    assert.equal(listed.runs[0].id, currentRun.id);

    // 11b. sync gracefully marks orphaned/missing jobs as failed instead of throwing and stalling polling
    const orphanHostBase = {
      resolveAsset: async () => null,
      createDesign: async () => { throw new Error('unused'); },
      importDesignAsset: async () => { throw new Error('unused'); },
      writeDesignFile: async () => { throw new Error('unused'); },
      readDesignFile: async () => { throw new Error('unused'); },
      getDesignProject: async () => { throw new Error('unused'); },
      createMotion: async () => { throw new Error('unused'); },
      importToMotion: async () => { throw new Error('unused'); },
    };
    const orphanGenRes = await freshService.generate(
      {
        runId: currentRun.id,
        expectedRevision: loaded.run.revision,
        requestId: 'req-orphan-gen',
        stepId: 'product-images',
        modality: 'image',
        model: 'codex:image-generation',
        prompt: 'Orphaned job test',
      },
      {
        ...orphanHostBase,
        assets: async () => ({
          job: {
            id: 'job-missing-after-restart',
            state: 'running',
            modality: 'image',
            model: 'codex:image-generation',
          },
        }),
      } as any,
    );
    const syncedOrphan = await freshService.sync(
      { runId: currentRun.id },
      {
        ...orphanHostBase,
        assets: async () => {
          throw new Error('ASSET_JOB_NOT_FOUND');
        },
      } as any,
    );
    const healed = syncedOrphan.run.steps['product-images'].iterations.find(
      iter => iter.id === orphanGenRes.iteration.id,
    );
    assert.equal(healed?.job?.state, 'failed');
    assert.match(healed?.job?.error ?? '', /interrupted or expired/i);

    // 12. Schema validation through phase1/call
    const badCommand = await callScenario(api, { command: 'unknown_cmd' });
    assert.equal(badCommand.status, 400);
    assert.equal(badCommand.body.validation_rule, 'invalid_enum');

    const missingRunId = await callScenario(api, { command: 'get' });
    assert.equal(missingRunId.status, 400);
    assert.equal(missingRunId.body.validation_rule, 'missing');

    // 13. generate adopts already-submitted paid job when revision bumps concurrently
    let assetsCallCount = 0;
    const { run: concurrentBase } = await freshService.get(currentRun.id);
    const adoptedRes = await freshService.generate(
      {
        runId: currentRun.id,
        expectedRevision: concurrentBase.revision,
        requestId: 'req-generate-adopt-conflict',
        stepId: 'product-images',
        modality: 'image',
        model: 'codex:image-generation',
        prompt: 'Concurrent adoption test',
      },
      {
        ...orphanHostBase,
        assets: async () => {
          assetsCallCount += 1;
          // Simulate a concurrent revision bump (e.g., background sync or brief edit) while provider call is in flight
          await freshService.updateBrief({
            runId: currentRun.id,
            expectedRevision: concurrentBase.revision,
            requestId: 'req-concurrent-brief-bump',
            brief: { productName: 'Holiday Tote Pro' },
          });
          return {
            job: {
              id: 'job-adopted-after-concurrent-bump',
              state: 'running',
              modality: 'image',
              model: 'codex:image-generation',
            },
          };
        },
      } as any,
    );
    assert.equal(assetsCallCount, 1);
    assert.equal(adoptedRes.iteration.job?.jobId, 'job-adopted-after-concurrent-bump');
    assert.equal(adoptedRes.run.brief.productName, 'Holiday Tote Pro');
    assert.ok(
      adoptedRes.run.steps['product-images'].iterations.some(iter => iter.job?.jobId === 'job-adopted-after-concurrent-bump'),
      'Submitted paid job must be adopted into the latest run instead of orphaned',
    );

    // 14. generate rejects at iteration limit before invoking paid host.assets
    const { run: limitRun } = await freshService.create({
      scenarioId: 'black-friday',
      requestId: 'req-limit-run',
      title: 'Limit Check Run',
    });
    let limitRev = limitRun.revision;
    for (let i = 0; i < SCENARIO_LIMITS.iterationsPerStep; i += 1) {
      const added = await freshService.addIteration({
        runId: limitRun.id,
        expectedRevision: limitRev,
        requestId: `req-limit-iter-${i}`,
        stepId: 'product-images',
        iteration: { source: 'manual', outputs: [], note: `v${i}` },
      });
      limitRev = added.run.revision;
    }
    let paidCalledAtLimit = 0;
    await assert.rejects(
      () => freshService.generate(
        {
          runId: limitRun.id,
          expectedRevision: limitRev,
          requestId: 'req-generate-over-limit',
          stepId: 'product-images',
          modality: 'image',
          model: 'codex:image-generation',
          prompt: 'Should fail before provider call',
        },
        {
          ...orphanHostBase,
          assets: async () => {
            paidCalledAtLimit += 1;
            return { job: { id: 'should-not-happen', state: 'running', modality: 'image', model: 'codex:image-generation' } };
          },
        } as any,
      ),
      /LIMIT_EXCEEDED/,
    );
    assert.equal(paidCalledAtLimit, 0, 'host.assets must not be called when step is already at iteration limit');

    await gateway.close();
  }, false));
