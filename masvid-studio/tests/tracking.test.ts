import test from 'node:test';
import { legacyToolName } from '../shared/public-names.mjs';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTracker, deviceContext, validProperties } from '../tracking/core.ts';
import { createNodeTracking, createPosthogSender, loadIdentity } from '../tracking/node.ts';
import { omEvents, studioEvents } from '../tracking/events.ts';
import { assetActions, toolFailureFields, toolInputFields } from '../tracking/tool-fields.ts';
import { closeTracking, createAppTracking, saveTrackingPreference, trackingError } from '../shared/tracking.ts';
import { Phase1Service } from '../phase1.ts';
import { cancelExport, renderNext, technicalCheckResult, trackExportTerminal } from '../server.ts';
import { TaskLedger } from '../tracking/task-ledger.ts';
import { pluginRoot } from '../hyperframes.ts';
import { fixture } from './fixtures.ts';
import { phase1Tools, validateInput } from '../shared/phase1-tools.ts';
import { toolNames } from '../tracking/events.ts';
import { identifyHost } from '../tracking/host.ts';
import { transport } from './http.ts';
import type { PendingEvent } from '../tracking/core.ts';

function packet(): PendingEvent {
  return { event: 'ui_click', event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), entrypoint: 'studio',
    ...deviceContext(), properties: { page_name: 'home', area: 'workspace', element: 'new_creation' } };
}
const core = (send: Parameters<typeof createTracker>[0]['send'], maxQueue = 64) =>
  createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, maxQueue, send });

test('Studio event types reject Node-only events and invalid semantic fields', () => {
  execFileSync(process.execPath, [path.join(pluginRoot, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--allowImportingTsExtensions', '--module', 'ESNext', '--moduleResolution', 'Bundler',
    '--target', 'ES2022', '--lib', 'ES2023,DOM', '--skipLibCheck', path.join(pluginRoot, 'tests/tracking-types.ts')],
  { cwd: pluginRoot, stdio: 'pipe' });
});

test('Motion editor events admit only closed categories, bounded project identities and bounded counts', () => {
  const projectId = crypto.randomUUID(), exportId = crypto.randomUUID();
  const settings = { origin: 'export_panel', format: 'mp4', quality: 'standard', resolution: '1080p', fps: '30' };
  const valid: Array<[string, Record<string, unknown>]> = [
    ['studio_edit_result', { outcome: 'success', edit_kind: 'move', surface: 'canvas', project_id: 'project' }],
    ['studio_load_result', { load_id: exportId, outcome: 'success', duration_ms: 10, embedded: false, project_scope: 'default' }],
    ['ui_click', { page_name: 'studio', area: 'header', element: 'export', interaction_method: 'pointer', project_scope: 'managed', project_id: projectId }],
    ['ui_click', { page_name: 'studio', area: 'project_drawer', element: 'language_change', option: 'pt-BR' }],
    ['ui_click', { page_name: 'studio', area: 'settings', element: 'theme_toggle', option: 'dark', interaction_method: 'pointer' }],
    ['studio_export_request_result', { export_id: exportId, outcome: 'rejected', ...settings, error_code: 'FFMPEG_MISSING' }],
    ['studio_export_result', { export_id: exportId, job_state: 'failed', duration_ms: 1200, ...settings, error_code: 'RENDER_FAILED', project_id: projectId }],
    ['studio_notice_shown', { notice: 'ffmpeg_missing' }],
    ['studio_edit_result', { outcome: 'success', edit_kind: 'timeline_trim', surface: 'timeline', project_scope: 'managed', project_id: projectId }],
    ['studio_edit_result', { outcome: 'failure', edit_kind: 'other', surface: 'other', error_code: 'CONFLICT' }],
    ['studio_history_step_result', { action: 'redo', outcome: 'unavailable', interaction_method: 'keyboard' }],
    ['studio_asset_import_result', { outcome: 'partial', entry_point: 'assets_drop', requested_count: 3, added_count: 2, failed_count: 1, error_category: 'too_large' }],
    ['studio_export_request_result', { export_id: exportId, outcome: 'unknown', ...settings, error_code: 'INVALID_RESPONSE' }],
    ['studio_asset_import_result', { outcome: 'unknown', entry_point: 'assets_button', requested_count: 3, added_count: 0, failed_count: 0, unknown_count: 2, pending_count: 1 }],
  ];
  for (const [event, properties] of valid) {
    assert.equal(validProperties(studioEvents, event, properties), true, event);
    // Every new event is Studio-produced and so admitted by the browser ingress registry.
    assert.deepEqual((omEvents as Record<string, { producers: readonly string[] }>)[event].producers, ['studio'], event);
  }
  const invalid: Array<[string, Record<string, unknown>]> = [
    ['studio_edit_result', { outcome: 'success', edit_kind: 'move', surface: 'canvas', project_id: 'a-private-project-title' }],
    ['studio_edit_result', { outcome: 'success', edit_kind: 'move', surface: 'canvas', project_name: 'Launch film' }],
    ['studio_edit_result', { outcome: 'success', edit_kind: 'Edit layer style', surface: 'canvas' }],
    ['studio_edit_result', { outcome: 'success', edit_kind: 'move' }],
    ['studio_export_request_result', { export_id: exportId, outcome: 'accepted', ...settings, composition: 'scenes/intro.html' }],
    ['studio_export_request_result', { export_id: 'demo_2026-11-10_10-00-00', outcome: 'accepted', ...settings }],
    ['studio_export_request_result', { export_id: exportId, outcome: 'rejected', ...settings, error_code: 'ENOENT /srv/a/b' }],
    ['studio_export_result', { export_id: exportId, job_state: 'completed', duration_ms: 1, ...settings, filename: 'out.mp4' }],
    ['studio_export_result', { export_id: exportId, job_state: 'completed', duration_ms: 1, ...settings, fps: 30 }],
    ['studio_asset_import_result', { outcome: 'failure', entry_point: 'assets_button', requested_count: 1, added_count: 0, failed_count: 1, error_category: 'clip.mov too large' }],
    ['studio_asset_import_result', { outcome: 'success', entry_point: 'assets_button', requested_count: -1, added_count: 0, failed_count: 0 }],
    ['studio_history_step_result', { action: 'undo', outcome: 'success', label: 'Undid: Move Title' }],
    ['studio_notice_shown', { notice: 'ffmpeg_missing', command: 'brew install ffmpeg' }],
    ['ui_click', { page_name: 'studio', area: 'header', element: 'export', option: 'My private folder' }],
    ['ui_click', { page_name: 'studio', area: 'assets', element: 'asset_search', query: 'invoice' }],
  ];
  for (const [event, properties] of invalid) assert.equal(validProperties(studioEvents, event, properties), false, JSON.stringify(properties));
  // The worker's terminal event stays worker-only; Studio cannot submit it.
  assert.equal(Object.hasOwn(studioEvents, 'export_result'), false);
});

test('editor dimensions are closed buckets and a bounded template id, never raw values', () => {
  const exportId = crypto.randomUUID();
  const settings = { origin: 'export_panel', format: 'mp4', quality: 'standard', resolution: 'auto', fps: '30' };
  const request = { export_id: exportId, outcome: 'accepted', ...settings };
  const result = { export_id: exportId, job_state: 'completed', duration_ms: 900, ...settings };
  const load = { load_id: exportId, outcome: 'success', duration_ms: 10, embedded: false };
  const ok = (event: string, properties: Record<string, unknown>) => assert.equal(validProperties(studioEvents, event, properties), true, JSON.stringify(properties));
  const no = (event: string, properties: Record<string, unknown>) => assert.equal(validProperties(studioEvents, event, properties), false, JSON.stringify(properties));

  for (const bucket of ['lt_15s', '15_60s', '1_3min', '3_10min', 'gt_10min', 'unknown']) {
    ok('studio_export_request_result', { ...request, video_duration_bucket: bucket });
    ok('studio_export_result', { ...result, video_duration_bucket: bucket });
  }
  for (const raw of [42.5, '42.5', '42s', 'long']) no('studio_export_result', { ...result, video_duration_bucket: raw });
  no('studio_export_result', { ...result, video_duration_seconds: 42 });

  for (const bucket of ['0', '1_5', '6_20', '21_50', 'gt_50', 'unknown']) {
    ok('studio_load_result', { ...load, clip_count_bucket: bucket, asset_count_bucket: bucket });
    ok('studio_export_request_result', { ...request, clip_count_bucket: bucket, asset_count_bucket: bucket });
  }
  for (const bucket of ['1', '2_5', '6_20', 'gt_20', 'unknown']) ok('studio_load_result', { ...load, composition_count_bucket: bucket });
  no('studio_load_result', { ...load, clip_count_bucket: 37 });
  no('studio_load_result', { ...load, asset_count_bucket: '37' });
  no('studio_load_result', { ...load, composition_count_bucket: '0' });
  no('studio_load_result', { ...load, project_bytes: 1024 });
  // The terminal event describes the render, not the project: scale stays on the request.
  no('studio_export_result', { ...result, clip_count_bucket: '1_5' });
  // The events are still valid when a dimension is simply absent.
  ok('studio_load_result', load); ok('studio_export_request_result', request); ok('studio_export_result', result);

  const click = { page_name: 'studio', area: 'templates', element: 'copy_template' };
  const copied = { host_product: 'codex', copy_status: 'clipboard_written' };
  for (const id of ['product-promo', 'hf-moment-M1147', 'hf-block-ai-chat-reveal', 'a', 'A1', 'x'.repeat(64)]) {
    ok('ui_click', { ...click, template_id: id });
    ok('template_instruction_copy_result', { ...copied, page_name: 'studio', template_id: id });
    ok('studio_load_result', { ...load, template_id: id });
    ok('studio_export_request_result', { ...request, template_id: id });
    ok('studio_export_result', { ...result, template_id: id });
  }
  for (const id of ['', 'x'.repeat(65), 'Launch Film', 'launch_film', 'a.b', 'a/b', '../etc', 'https://x.test/t', 'a--b', '-a', 'a-', 'café', 'a\nb', 7]) {
    no('ui_click', { ...click, template_id: id });
    no('studio_export_result', { ...result, template_id: id });
  }
  no('ui_click', { ...click, template_title: 'Product Promo' });
  no('template_instruction_copy_result', { ...copied, template_author: 'someone' });
  no('ui_click', { ...click, element: 'template_category', option: 'my-private-category' });
  ok('ui_click', { ...click, element: 'template_category', option: 'featured' });
  // No host field was added to the load event: the Studio page does not know its host.
  no('studio_load_result', { ...load, host_product: 'codex' });
});

test('tool dimensions use only the published actions, defaults and schema field names', () => {
  assert.deepEqual([...assetActions], phase1Tools.find(tool => tool.name === 'openmotion_assets_use')!.inputSchema.properties.action.enum);
  for (const tool of phase1Tools) {
    const schema = tool.inputSchema as { properties: { action?: { enum: string[] } } };
    for (const action of schema.properties.action?.enum ?? []) {
      assert.equal(toolInputFields(tool.name, { action, prompt: 'PRIVATE_PROMPT' }).action, action);
    }
    for (const action of ['PRIVATE_ACTION', 42, ['read']]) assert.equal(toolInputFields(tool.name, { action }).action, undefined);
  }
  assert.deepEqual(toolInputFields('openmotion_export_request', {}), { action: 'request' });
  assert.deepEqual(toolInputFields('openmotion_open_preview', {}), { action: 'open', target: 'project' });
  assert.deepEqual(toolInputFields('openmotion_open_preview', { action: 'begin', target: 'PRIVATE' }), { action: 'begin' });
  assert.equal(toolInputFields('openmotion_assets', { action: 'read' }).action, undefined);
  assert.equal(toolInputFields('openmotion_media_use', { action: 'read' }).action, undefined);
  for (const event of ['mcp_tool_started', 'mcp_tool_finished', 'webmcp_tool_started', 'webmcp_tool_finished']) {
    const web = event.startsWith('webmcp');
    const fields = { tool_name: web ? 'openmotion_assets_use' : 'motion_assets', call_id: crypto.randomUUID(),
      ...(web ? { transport: 'webmcp' } : { accepted: true }),
      ...(event.endsWith('finished') ? { outcome: 'success', duration_ms: 12 } : {}) };
    assert(validProperties(omEvents, event, fields), 'Existing events without action remain valid');
    for (const action of assetActions) assert(validProperties(omEvents, event, { ...fields, action }));
    for (const action of ['PRIVATE_ACTION', 42, ['read']]) assert(!validProperties(omEvents, event, { ...fields, action }));
    assert(!validProperties(omEvents, event, { ...fields, action: 'read', data: 'PRIVATE_BASE64' }));
  }
  const edit = phase1Tools.find(tool => tool.name === 'openmotion_edit_project')!.inputSchema;
  const args = { projectId: 'project', requestId: 'request', expectedRevision: 'a'.repeat(64), expectedVersionId: 'v1' };
  for (const [files, field, rule] of [
    [[{ content: 'PRIVATE_SOURCE' }], 'files[].path', 'missing'],
    [[{ path: 'index.html', content: 'PRIVATE_SOURCE', PRIVATE_KEY: 1 }], 'unknown_field', 'unknown_field'],
  ] as const) {
    assert.throws(() => validateInput(edit, { ...args, files }), error => {
      const normalized = toolFailureFields(error);
      assert.deepEqual(normalized, { error_code: 'INVALID_ARGUMENT', invalid_field: field, validation_rule: rule });
      const result = { call_id: crypto.randomUUID(), tool_name: 'openmotion_edit_project', transport: 'webmcp', outcome: 'failure', duration_ms: 1 };
      assert(validProperties(studioEvents, 'webmcp_tool_finished', { ...result, ...normalized }));
      assert(!validProperties(studioEvents, 'webmcp_tool_finished', { ...result, ...normalized, invalid_field: 'PRIVATE_KEY' }));
      assert(!validProperties(studioEvents, 'webmcp_tool_finished', { ...result, ...normalized, error_code: 'PRIVATE_ERROR' }));
      return true;
    });
  }
});

test('nested tool inputs identify missing fields and invalid operation or command names', () => {
  const schema = phase1Tools.find(tool => tool.name === 'openmotion_assets_use')!.inputSchema;
  for (const [args, field, rule] of [
    [{}, 'action', 'missing'],
    [{ unknown: true }, 'action', 'missing'],
    [{ action: 'brand_kit', brandKit: { operation: 'PRIVATE_VALUE' } }, 'brandKit.operation', 'invalid_enum'],
    [{ action: 'brand_kit', brandKit: {} }, 'brandKit.operation', 'missing'],
    [{ action: 'brand_kit', brandKit: { operation: 'retry' } }, 'brandKit.kitId', 'missing'],
    [{ action: 'brand_kit', brandKit: [] }, 'brandKit', 'invalid_type'],
    [{ action: 'transcript', transcript: { command: 'PRIVATE_VALUE' } }, 'transcript.command', 'invalid_enum'],
    [{ action: 'transcript', transcript: { command: 'get', projectId: 'project' } }, 'transcript.transcriptId', 'missing'],
  ] as const) {
    assert.throws(() => validateInput(schema, args), error => {
      assert.deepEqual(toolFailureFields(error), { error_code: 'INVALID_ARGUMENT', invalid_field: field, validation_rule: rule });
      return true;
    });
  }
});

test('review comment tracking keeps closed action and error fields without review content', () => {
  const schema = phase1Tools.find(tool => tool.name === 'openmotion_manage_project')!.inputSchema;
  assert.deepEqual(toolInputFields('openmotion_manage_project', { action: 'comments', text: 'PRIVATE_COMMENT' }), { action: 'comments' });
  for (const [args, field, rule] of [
    [{ operation: 'PRIVATE_OPERATION' }, 'operation', 'invalid_enum'],
    [{ expectedCommentRevision: 0 }, 'expectedCommentRevision', 'out_of_range'],
    [{ anchor: { scope: 'frame', compositionPath: 'index.html', time: -1 } }, 'anchor.time', 'out_of_range'],
    [{ anchor: { scope: 'element', compositionPath: 'index.html', element: { handle: 'PRIVATE_HANDLE', sourceFile: 'index.html', label: 'PRIVATE_LABEL', tagName: 'h1', PRIVATE_KEY: true } } }, 'unknown_field', 'unknown_field'],
    [{ anchor: { scope: 'frame', compositionPath: 'index.html', annotation: { version: 1, coordinateSpace: 'normalized', width: 640, height: 360, marks: [{ kind: 'pen', points: [{ x: 2, y: 0 }] }] } } }, 'anchor.annotation.marks[].points[].x', 'out_of_range'],
  ] as const) {
    assert.throws(() => validateInput(schema, { action: 'comments', projectId: 'project', ...args }), error => {
      assert.deepEqual(toolFailureFields(error), { error_code: 'INVALID_ARGUMENT', invalid_field: field, validation_rule: rule });
      assert(!JSON.stringify(toolFailureFields(error)).includes('PRIVATE'));
      return true;
    });
  }
  for (const code of ['COMMENT_TARGET_NOT_FOUND', 'COMMENT_NOT_FOUND', 'COMMENT_CONFLICT', 'COMMENT_LIMIT']) {
    const normalized = toolFailureFields(new Error(`${code}: PRIVATE_COMMENT`));
    assert.deepEqual(normalized, { error_code: code });
    assert(validProperties(omEvents, 'mcp_tool_finished', { tool_name: legacyToolName('openmotion_manage_project'), accepted: true, call_id: crypto.randomUUID(), action: 'comments', outcome: 'failure', duration_ms: 1, ...normalized }));
  }
});

test('bounded queue rejects private properties, preserves UUID/time on retries and serializes flushes', async () => {
  const batches: PendingEvent[][] = []; let attempts = 0;
  const tracker = core(async events => { batches.push(structuredClone([...events])); return ++attempts === 1 ? 'retry' : 'accepted'; }, 2);
  const event = packet();
  assert.equal(tracker.ingest({ ...event, properties: { ...event.properties, prompt: 'private text' } }), 'invalid');
  assert.equal(tracker.ingest({ ...event, device_id: crypto.randomUUID() }), 'invalid');
  assert.equal(tracker.ingest({ ...event, occurred_at: 123 }), 'invalid');
  assert.equal(tracker.ingest({ ...event, device_timezone: 'not/a/timezone' }), 'invalid');
  assert.equal(tracker.ingest(event), 'queued');
  assert.equal(tracker.ingest(event), 'duplicate');
  assert.equal(tracker.ingest(packet()), 'queued');
  assert.equal(tracker.ingest(packet()), 'full');
  const first = tracker.flush(); assert.equal(tracker.flush(), first);
  assert.equal(await first, 'retry'); assert.equal(tracker.pending(), 2);
  assert.equal(await tracker.flush(), 'accepted'); assert.deepEqual(batches[0], batches[1]);
  assert.equal(tracker.pending(), 0); tracker.close();
});

test('opting out aborts the in-flight request, erases the queue and prevents later reports', async () => {
  let aborted = false, sends = 0;
  const tracker = core(async (_events, signal) => { sends++; return new Promise(resolve => {
    signal.addEventListener('abort', () => { aborted = true; resolve('retry'); }, { once: true });
  }); });
  tracker.ingest(packet()); const pending = tracker.flush(); tracker.setEnabled(false);
  assert.equal(await pending, 'disabled'); assert.equal(aborted, true); assert.equal(tracker.pending(), 0);
  assert.equal(tracker.ingest(packet()), 'disabled'); assert.equal(await tracker.flush(), 'disabled'); assert.equal(sends, 1);
});

test('concurrent identity creation has one winner, keeps its first source and fails closed on corruption', () => fixture(async store => {
  const directory = path.join(store.directory, 'tracking');
  const identities = await Promise.all(Array.from({ length: 20 }, () => loadIdentity(directory, 'alice')));
  assert.equal(new Set(identities.map(value => value.installation_id)).size, 1);
  assert.equal((await loadIdentity(directory, 'bob')).utm_source, 'alice');
  assert.deepEqual(await readdir(directory), ['identity.json']);
  await writeFile(path.join(directory, 'identity.json'), JSON.stringify({ installation_id: identities[0].installation_id, created_at: identities[0].created_at }));
  await assert.rejects(loadIdentity(directory), /INVALID_IDENTITY/);
  await writeFile(path.join(directory, 'identity.json'), '{}');
  await assert.rejects(loadIdentity(directory), /INVALID_IDENTITY/);
  await assert.rejects(loadIdentity(directory, 'https://private.example'), /INVALID_SOURCE/);
}, false));

test('PostHog adapter uses public ingest only, privacy fields and real receipt semantics', async () => {
  const identity = { installation_id: crypto.randomUUID(), utm_source: 'alice', created_at: new Date().toISOString() };
  const options = { identity, appVersion: '0.0.0', env: 'test' as const, host: 'https://us.i.posthog.com', token: 'phc_test' };
  assert.throws(() => createPosthogSender({ ...options, token: 'phx_private' }), /PUBLIC_PROJECT/);
  assert.throws(() => createPosthogSender({ ...options, host: 'http://example.com' }), /INVALID_INGEST/);
  assert.throws(() => createPosthogSender({ ...options, host: 'https://user:secret@example.com' }), /INVALID_INGEST/);
  const event = packet(); const seen: any[] = []; let response = new Response('{"status":1}');
  const sender = createPosthogSender({ ...options, fetch: async (url, init) => {
    assert.equal(String(url), 'https://us.i.posthog.com/batch/'); seen.push(JSON.parse(String(init?.body))); return response;
  } });
  assert.equal(await sender([event], new AbortController().signal), 'accepted');
  const data = seen[0].batch[0];
  assert.equal(data.uuid, event.event_id); assert.equal(data.timestamp, event.occurred_at);
  assert.equal(data.properties.distinct_id, identity.installation_id);
  assert.equal(data.properties.device_id, 'unknown'); assert.equal(data.properties.device_id_source, 'unavailable');
  assert.equal(data.properties.utm_source, 'alice'); assert.equal(data.properties.event_schema_version, 1);
  assert.equal(data.properties.$ip, '0.0.0.0'); assert.equal(data.properties.$geoip_disable, true);
  assert.equal(data.properties.$process_person_profile, false);
  response = new Response('{"status":"Ok"}'); assert.equal(await sender([event], new AbortController().signal), 'accepted');
  response = new Response('{"status":1,"quota_limited":["events"]}'); assert.equal(await sender([event], new AbortController().signal), 'retry');
  response = new Response('{}', { status: 429 }); assert.equal(await sender([event], new AbortController().signal), 'retry');
  response = new Response('{}', { status: 400 }); assert.equal(await sender([event], new AbortController().signal), 'drop');
  response = new Response('not json'); assert.equal(await sender([event], new AbortController().signal), 'retry');
  assert.equal(trackingError(new Error('private user prompt and /local/path')), 'TOOL_FAILED');
  const enriched: any[] = [];
  const geoip = createPosthogSender({ ...options, geoip: true, fetch: async (_url, init) => { enriched.push(JSON.parse(String(init?.body))); return Response.json({ status: 'Ok' }); } });
  await geoip([event], new AbortController().signal);
  assert.equal(enriched[0].batch[0].properties.$geoip_disable, false);
  assert.equal(Object.hasOwn(enriched[0].batch[0].properties, '$ip'), false);
});

test('all application versions report in development, test and production environments', async t => {
  const identity = { installation_id: crypto.randomUUID(), utm_source: null, created_at: new Date().toISOString() };
  let bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body))); return Response.json({ status: 'Ok' });
  });
  for (const appVersion of ['0.6.4', '0.6.4-test.8', '0.6.4-test.42.2', '0.6.4-local.1', '0.6.4-beta.1']) {
    for (const env of ['development', 'test', 'production'] as const) {
      bodies = [];
      const options = { registry: omEvents, identity, appVersion, env, entrypoint: 'mcp' as const, enabled: true,
        flushIntervalMs: 0, host: 'https://us.i.posthog.com', token: 'phc_test' };
      const tracking = createNodeTracking(options);
      try {
        assert.equal(tracking.enabled(), true); assert.equal(tracking.ingest(packet()), 'queued');
        assert.equal(await tracking.flush(), 'accepted');
        assert.equal(await createPosthogSender(options)([packet()], new AbortController().signal), 'accepted');
        assert.equal(bodies.length, 2);
        for (const body of bodies) {
          assert.equal(body.batch[0].properties.app_version, appVersion);
          assert.equal(body.batch[0].properties.env, env);
        }
      } finally { tracking.close(); }
    }
  }
});

test('browser ingress rejects forged identity, worker events and oversized batches', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const request = transport(store, { tracking });
  const config = await (await request('/motion-api/tracking')).json(); assert.deepEqual(config, { enabled: true });
  const send = (data: unknown) => request('/motion-api/tracking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const event = packet(); assert.equal((await send({ events: [event] })).status, 200);
  assert.equal((await send({ events: [event] })).status, 200);
  for (const data of [
    { events: [{ ...packet(), properties: { ...packet().properties, distinct_id: 'forged' } }] },
    { events: [{ ...packet(), utm_source: 'forged' }] },
    { events: [{ ...packet(), entrypoint: 'worker' }] },
    { events: [{ ...packet(), event: 'mcp_tool_started', properties: { tool_name: 'motion_get_project', call_id: crypto.randomUUID(), accepted: true } }] },
    { events: [{ ...packet(), event: 'export_result', properties: { job_id: crypto.randomUUID(), job_state: 'completed', duration_ms: 100, technical_check: 'passed' } }] },
    { events: Array.from({ length: 17 }, packet) },
    { events: [packet()], token: 'forged' },
  ]) assert.equal((await send(data)).status, 400);
  assert.equal((await send({ events: [packet()], padding: 'x'.repeat(65536) })).status, 400);
  await tracking.flush(); assert.equal(events.length, 1); tracking.close();
  assert.equal((await send({ events: [packet()] })).status, 200); assert.equal(tracking.pending(), 0);
}, false));

test('browser ingress admits manual I/O pairs and rejects private or incomplete recovery properties', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const request = transport(store, { tracking });
  const send = (event: string, properties: Record<string, unknown>) => request('/motion-api/tracking', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ ...packet(), event, properties }] }),
  });
  const shared = { action: 'download_render', attempt_id: crypto.randomUUID() };
  const result = { ...shared, outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' };
  assert.equal((await send('studio_io_action', shared)).status, 200);
  assert.equal((await send('studio_io_result', result)).status, 200);
  for (const properties of [
    { ...result, file_name: 'PRIVATE_FILE' }, { ...result, path: 'PRIVATE_PATH' }, { ...result, error: 'PRIVATE_ERROR' },
    { ...result, action: 'automatic_refresh' }, { ...result, attempt_id: 'PRIVATE_TASK_ID' },
    { ...result, outcome: 'saved' }, { ...result, delivery_status: 'saved' }, { ...result, requested_count: -1 },
    { action: 'recheck_file', outcome: 'unknown' }, { ...shared },
  ]) assert.equal((await send('studio_io_result', properties)).status, 400);
  await tracking.flush();
  assert.deepEqual(events.map(event => [event.event, event.properties]), [['studio_io_action', shared], ['studio_io_result', result]]);
  tracking.close();
}, false));

test('domain events follow real commits, skip replay and retain safe failure without source contents', () => fixture(async store => {
  assert.deepEqual([...toolNames].sort(), [...new Set(phase1Tools.map(tool => legacyToolName(tool.name)))].sort());
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const service = new Phase1Service(store, pluginRoot, { tracking, origin: () => 'http://127.0.0.1:4173',
    nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(), cancel: async () => {} });
  await service.call('openmotion_open_preview', { target: 'templates' });
  const args = { requestId: crypto.randomUUID(), projectType: 'natural_language', title: 'PRIVATE_TITLE', requirements: 'PRIVATE_PROMPT' };
  const created = await service.call('motion_create_project', args);
  assert.equal((await service.call('motion_create_project', args)).replayed, true);
  const edit = { projectId: created.projectId, requestId: crypto.randomUUID(), expectedRevision: created.revision,
    expectedVersionId: created.version.versionId, files: [{ path: 'private.txt', content: 'PRIVATE_SOURCE' }] };
  await service.call('motion_edit_project', edit);
  await assert.rejects(service.call('motion_edit_project', { ...edit, requestId: crypto.randomUUID() }), /VERSION_CONFLICT/);
  await tracking.flush();
  assert.deepEqual(events.map(event => [event.event, event.properties.outcome]), [
    ['project_create_result', 'success'], ['project_edit_result', 'success'], ['project_edit_result', 'failure'],
  ]);
  assert.equal(events[2].properties.error_code, 'VERSION_CONFLICT');
  assert.equal(events[0].properties.creation_route, 'natural_language');
  const { inlineWork } = await service.call('openmotion_open_preview', {
    projectId: created.projectId, action: 'begin', mode: 'modify', requestId: crypto.randomUUID(),
  });
  await service.workRounds.failed(created.projectId, inlineWork.id, 'PRIVATE_FAILURE');
  await assert.rejects(service.call('openmotion_edit_project', {
    ...edit, workId: inlineWork.id, requestId: crypto.randomUUID(),
  }), /WORK_CLOSED/);
  await tracking.flush();
  assert.equal(events.filter(event => event.event === 'project_edit_result').at(-1)?.properties.error_code, 'WORK_CLOSED');
  assert.equal(events.find(event => event.event === 'host_run_failed')?.properties.error_code, 'WORK_CLOSED');
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE_|private\.txt/); tracking.close();
}, false));

test('DO_NOT_TRACK creates no identity and sends nothing', () => fixture(async store => {
  const before = process.env.DO_NOT_TRACK; process.env.DO_NOT_TRACK = '1';
  try {
    const tracking = await createAppTracking(store.directory, 'mcp');
    assert.equal(tracking.enabled(), false); assert.equal(tracking.ingest(packet()), 'disabled');
    await closeTracking(tracking);
    await assert.rejects(readFile(path.join(store.directory, 'tracking', 'identity.json')), /ENOENT/);
  } finally { if (before === undefined) delete process.env.DO_NOT_TRACK; else process.env.DO_NOT_TRACK = before; }
}, false));

test('default configuration reports without opt-in; saved opt-out covers runtimes, restart and re-enable', t => fixture(async store => {
  const keys = ['OPENMOTION_TELEMETRY', 'DO_NOT_TRACK', 'OPENMOTION_POSTHOG_HOST', 'OPENMOTION_POSTHOG_KEY', 'OPENMOTION_TRACKING_ENV', 'OPENMOTION_TRACKING_TEST_RUN_ID'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const bodies: any[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: any, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return Response.json({ status: 'Ok' }); });
  const runtimes: Awaited<ReturnType<typeof createAppTracking>>[] = [];
  try {
    for (const key of keys) delete process.env[key];
    process.env.OPENMOTION_TRACKING_ENV = 'test'; process.env.OPENMOTION_TRACKING_TEST_RUN_ID = crypto.randomUUID();
    const mcp = await createAppTracking(store.directory, 'mcp'), worker = await createAppTracking(store.directory, 'worker'); runtimes.push(mcp, worker);
    assert.equal(mcp.enabled(), true); assert.equal(worker.enabled(), true);
    mcp.ingest(packet()); assert.equal(await mcp.flush(), 'accepted'); assert.equal(bodies.length, 1);
    assert.equal(bodies[0].batch[0].properties.$geoip_disable, false);
    const request = transport(store, { tracking: worker });
    mcp.ingest(packet()); worker.ingest(packet());
    const set = (enabled: unknown) => request('/motion-api/tracking/preferences', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled }) });
    assert.equal((await set('false')).status, 400);
    assert.equal((await set(false)).status, 200);
    assert.equal(await mcp.flush(), 'disabled'); assert.equal(await worker.flush(), 'disabled');
    assert.equal(mcp.pending(), 0); assert.equal(worker.pending(), 0); assert.equal(bodies.length, 1);
    const restarted = await createAppTracking(store.directory, 'mcp'); runtimes.push(restarted);
    assert.equal(restarted.enabled(), false); assert.equal(restarted.ingest(packet()), 'disabled');
    for (let cycle = 0; cycle < 2; cycle++) {
      assert.equal((await set(true)).status, 200);
      for (const runtime of runtimes) {
        assert.equal(runtime.enabled(), true); assert.equal(runtime.ingest(packet()), 'queued');
        assert.equal(await runtime.flush(), 'accepted');
      }
      assert.equal(bodies.length, 1 + (cycle + 1) * runtimes.length);
      assert.equal((await set(false)).status, 200);
      for (const runtime of runtimes) {
        assert.equal(runtime.ingest(packet()), 'disabled'); assert.equal(await runtime.flush(), 'disabled');
      }
    }
    assert.equal((await set(true)).status, 200);
    assert.equal(new Set(bodies.flatMap(body => body.batch.map((event: any) => event.properties.installation_id))).size, 1);
    assert.equal(restarted.enabled(), true);
    process.env.OPENMOTION_TELEMETRY = '0'; assert.equal(restarted.ingest(packet()), 'disabled');
    assert.equal((await set(true)).status, 403); delete process.env.OPENMOTION_TELEMETRY;
    await writeFile(path.join(store.directory, 'tracking/preferences.json'), 'corrupted');
    assert.equal(restarted.ingest(packet()), 'disabled');
  } finally {
    for (const runtime of runtimes) runtime.close();
    for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; }
  }
}, false));

test('cancelled and unfinished exports are unreviewed technical checks, not errors', () => {
  const base = { id: crypto.randomUUID(), revision: 'a'.repeat(64), createdAt: 0, expiresAt: 0 };
  assert.equal(technicalCheckResult({ ...base, state: 'cancelled' }), 'unreviewed');
  assert.equal(technicalCheckResult({ ...base, state: 'pending' }), 'unreviewed');
  assert.equal(technicalCheckResult({ ...base, state: 'failed' }), 'unreviewed', 'a render failure without a report is not a technical-check error');
  assert.equal(technicalCheckResult({ ...base, state: 'failed', verification: { status: 'failed' } }), 'fail');
  assert.equal(technicalCheckResult({ ...base, state: 'completed' }), 'error', 'a completed job without a report is unexpected');
  assert.equal(technicalCheckResult({ ...base, state: 'completed', verification: { status: 'passed' } }), 'pass');
});

test('repeated MCP cancels leave one terminal export result and one ledger outcome', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const service = new Phase1Service(store, pluginRoot, { tracking, origin: () => 'http://127.0.0.1:4173',
    nativeUrl: () => undefined, openProject: async () => {}, mutation: async task => task(),
    cancel: (projectId, jobId) => cancelExport(store, projectId, jobId, tracking) });
  try {
    const current = await store.get();
    const job = await store.requestExport(current.revision);
    const args = { projectId: store.projectId, jobId: job.id };
    const [first, second] = await Promise.all([crypto.randomUUID(), crypto.randomUUID()].map(requestId =>
      service.call('openmotion_export_cancel', { ...args, requestId })));
    assert.equal(first.job.state, 'cancelled');
    assert.deepEqual(second.job, first.job);
    await tracking.flush();
    assert.equal(events.filter(event => event.event === 'export_result').length, 1);
    assert.equal(events.filter(event => event.event === 'task_terminal').length, 1);
    assert.equal(events.filter(event => event.event === 'export_cancel_result').length, 2);
    assert.equal((await new TaskLedger(store.directory).snapshot())[job.id].outcome, 'cancelled');
  } finally { tracking.close(); }
}));

test('worker reports a real terminal render failure once, separately from queue acceptance', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const host = identifyHost({ name: 'dsh-mcp-client', version: '0.0.1' });
  const current = await store.get(), job = await store.requestExport(current.revision, { trackingHost: host });
  assert.equal(job.state, 'pending'); assert.equal(tracking.pending(), 0);
  await writeFile(path.join(store.snapshotDirectory(job.id), 'index.html'), '<html><body>Invalid composition for a failure test</body></html>');
  await renderNext(store, pluginRoot, tracking);
  assert.equal((await store.job(job.id))!.state, 'failed');
  await renderNext(store, pluginRoot, tracking);
  await tracking.flush();
  const terminal = events.filter(event => event.event === 'export_result');
  assert.equal(terminal.length, 1); assert.equal(terminal[0].entrypoint, 'worker'); assert.equal(terminal[0].properties.job_state, 'failed');
  assert.deepEqual(terminal[0].host_context, host);
  assert.equal(events.filter(event => event.event === 'task_terminal').length, 1);
  const queue = events.filter(event => ['queue_snapshot', 'worker_heartbeat'].includes(event.event));
  assert.deepEqual(queue.map(event => event.event), ['queue_snapshot', 'worker_heartbeat']);
  assert.deepEqual(queue.map(event => event.entrypoint), ['worker', 'worker'], 'queue evidence is worker-attributed, not MCP-attributed');
  assert.equal(queue[0].properties.queued_count, 1);
  assert.equal(events.filter(event => event.event === 'check_completed').length, 0, 'legacy exports have no version-bound quality check');
  assert.equal((await store.get()).revision, current.revision);
  assert.equal(terminal[0].properties.technical_check, 'unknown');
  assert.equal(terminal[0].properties.failure_stage, 'lint');
  assert.equal(terminal[0].properties.error_code, 'EXPORT_LINT_FAILED');
  assert.equal(events.find(event => event.event === 'task_terminal')?.properties.error_code, 'EXPORT_LINT_FAILED');
  assert.equal((await store.job(job.id))?.failureStage, 'lint'); tracking.close();
}));

test('an interrupted export is closed by the worker tick with one unknown terminal outcome', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const current = await store.get(), job = await store.requestExport(current.revision);
  await store.saveJob({ ...(await store.job(job.id))!, expiresAt: Date.now() - 1 });
  await renderNext(store, pluginRoot, tracking);
  await renderNext(store, pluginRoot, tracking);
  await tracking.flush();
  const terminal = events.filter(event => event.event === 'task_terminal');
  assert.equal(terminal.length, 1, 'a second tick does not claim the same outcome again');
  assert.equal(terminal[0].entrypoint, 'worker');
  assert.equal(terminal[0].properties.outcome, 'unknown');
  assert.equal(terminal[0].properties.error_code, 'EXPORT_DEADLINE_EXCEEDED');
  const exportResults = events.filter(event => event.event === 'export_result');
  assert.equal(exportResults.length, 1);
  assert.equal(exportResults[0].properties.error_code, 'EXPORT_DEADLINE_EXCEEDED');
  assert.equal(exportResults[0].properties.failure_stage, 'queued');
  assert.equal(terminal[0].properties.applied, 'unknown');
  assert.ok(terminal[0].properties.terminal_at);
  assert.equal((await store.job(job.id))!.state, 'failed');
  assert.equal((await new TaskLedger(store.directory).snapshot())[job.id].outcome, 'unknown');
  tracking.close();
}));

test('a status read captures an interrupted worker as a single export result', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  store.tracking = tracking;
  try {
    const current = await store.get(), job = await store.requestExport(current.revision);
    assert.equal((await store.claimExport())?.id, job.id);
    await store.saveJob({ ...(await store.job(job.id))!, stage: 'rendering', workerPid: undefined });
    assert.equal((await store.status(job.id)).exportJob?.state, 'failed');
    await renderNext(store, pluginRoot, tracking);
    await tracking.flush();
    const results = events.filter(event => event.event === 'export_result');
    assert.equal(results.length, 1);
    assert.equal(results[0].properties.job_id, job.id);
    assert.equal(results[0].properties.failure_stage, 'render');
    assert.equal(results[0].properties.error_code, 'EXPORT_WORKER_INTERRUPTED');
    assert.equal(events.find(event => event.event === 'task_terminal')?.properties.outcome, 'unknown');
  } finally { tracking.close(); }
}));

test('a claimed export past its deadline is closed once and not restated by its worker', () => fixture(async store => {
  const events: PendingEvent[] = [], tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const current = await store.get(), job = await store.requestExport(current.revision);
  // This process owns the render, so nothing can abort it when its accepted deadline passes.
  assert.equal((await store.claimExport())!.state, 'running');
  await store.saveJob({ ...(await store.job(job.id))!, expiresAt: Date.now() - 1 });
  await renderNext(store, pluginRoot, tracking);
  const final = (await store.job(job.id))!;
  assert.equal(final.state, 'failed');
  assert.equal(final.observedOutcome, 'unknown');
  const closed = (await new TaskLedger(store.directory).snapshot())[job.id];
  assert.equal(closed.outcome, 'unknown');
  await tracking.flush();
  // The worker that held the job still reaches its own terminal path after that reconciliation.
  await trackExportTerminal(store, final, tracking);
  await tracking.flush();
  const terminal = events.filter(event => event.event === 'task_terminal');
  assert.equal(terminal.length, 1, 'only the reconciliation owner states the terminal outcome');
  assert.equal(terminal[0].properties.outcome, 'unknown');
  assert.equal((await new TaskLedger(store.directory).snapshot())[job.id].terminal_at, closed.terminal_at, 'the recorded terminal time does not move');
  tracking.close();
}));

test('template library events: the search keyword is the only free text and stays bounded', () => {
  const id = '4f6d1c2e-8a3b-4c5d-9e7f-0a1b2c3d4e5f';
  const search = { search_id: id, query_length: 6, result_count: 1, outcome: 'success' };
  const ok = (event: string, properties: Record<string, unknown>) => assert.equal(validProperties(studioEvents, event, properties), true, JSON.stringify(properties));
  const no = (event: string, properties: Record<string, unknown>) => assert.equal(validProperties(studioEvents, event, properties), false, JSON.stringify(properties));
  ok('template_search_result', { ...search, search_keyword: 'saas 发布会 launch', page_name: 'studio', area: 'template_discovery' });
  for (const search_keyword of ['', ' padded ', 'x'.repeat(101), 'line\nbreak', 42]) no('template_search_result', { ...search, search_keyword });
  no('template_search_result', { query_length: 6, result_count: 1, outcome: 'success' });
  // No other template event accepts text: an option is a slug and a title is not a field at all.
  no('ui_click', { page_name: 'studio', area: 'template_discovery', element: 'filter_option', filter_value: 'Two Words' });
  no('ui_click', { page_name: 'studio', area: 'template_card', element: 'open_detail', title: 'Private title' });
  no('ui_click', { page_name: 'studio', area: 'template_discovery', element: 'category_select', search_keyword: 'x' });
  no('ui_click', { page_name: 'studio', area: 'template_card', element: 'open_detail', template_id: 'https://example.com/a' });
  ok('ui_click', { page_name: 'studio', area: 'template_card', element: 'open_detail', template_id: 'motion-e6ac921a-f56f-4170-a2be-938cec5d028b', placement: 'related', position: 1 });
  ok('surface_view', { page_name: 'studio', area: 'template_detail', element: 'detail', detail_view_id: id, detail_mode: 'modal', placement: 'random' });
  ok('surface_view', { page_name: 'studio', area: 'template_card', element: 'card', template_id: 'hf-moment-M1147', placement: 'catalog', position: 12, sort: 'duration', applied_filter_count: 0 });
  ok('template_filter_result', { action: 'sort_change', result_count: 0, outcome: 'success', sort: 'reverse' });
  ok('resource_download_result', { resource_kind: 'motion_guide', download_attempt_id: id, delivery_status: 'fetch_failed', error_code: 'HTTP_404' });
  no('resource_download_result', { resource_kind: 'motion_guide', download_attempt_id: id, delivery_status: 'saved_to_disk' });
});

test('provider setup handoff tracks MCP entries exclusively without counting WebMCP HTTP calls', () => fixture(async store => {
  const { startServer } = await import('../server.ts');
  const { rpc } = await import('../mcp.ts');
  const events: PendingEvent[] = [];
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, maxQueue: 64,
    send: async batch => { events.push(...batch); return 'accepted'; } });
  const running = await startServer(store, 0, { editor: false });
  const address = running.server.address();
  assert.ok(address && typeof address !== 'string');
  await writeFile(path.join(store.directory, 'preview.json'), JSON.stringify({ port: address.port }));
  store.tracking = tracking;
  try {
    // WebMCP / direct HTTP phase1 calls must never emit the MCP-only provider_setup_opened event.
    const http = transport(store, { tracking, runtimeRoot: pluginRoot });
    const webmcp = await http('/motion-api/phase1/call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'openmotion_open_preview', arguments: { target: 'providers', entry: 'agent_media_upgrade_go' } }),
    });
    assert.equal(webmcp.status, 200);
    const webmcpUrl = new URL((await webmcp.json()).previewUrl);
    assert.equal(webmcpUrl.searchParams.has('entry_from'), false);
    assert.equal(webmcpUrl.searchParams.get('provider'), 'account');

    await rpc({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { clientInfo: { name: 'codex-mcp-client', version: '1.2.3' } } }, store);
    await rpc({ jsonrpc: '2.0', id: 'p1', method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'providers' } } }, store);
    await rpc({ jsonrpc: '2.0', id: 'p2', method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'providers', entry: 'agent_media_upgrade_free', presentation: 'now', embedded: false } } }, store);
    const badProvider: any = await rpc({ jsonrpc: '2.0', id: 'p2b', method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'providers', projectId: 'project', entry: 'agent_media_upgrade_free' } } }, store);
    assert.equal(badProvider.result.isError, true);
    const badTemplate: any = await rpc({ jsonrpc: '2.0', id: 'p3', method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'templates', entry: 'agent_media_signed_out' } } }, store);
    assert.equal(badTemplate.result.isError, true);
    const badProject: any = await rpc({ jsonrpc: '2.0', id: 'p4', method: 'tools/call', params: { name: 'openmotion_open_preview', arguments: { target: 'project', action: 'begin', entry: 'agent_media_signed_out' } } }, store);
    assert.equal(badProject.result.isError, true);

    await tracking.flush();
    const opened = events.filter(event => event.event === 'provider_setup_opened');
    assert.equal(opened.length, 2);
    assert.deepEqual(opened[0].properties, { entry_from: 'agent_providers', presentation: 'foreground', embedded: true });
    assert.deepEqual(opened[1].properties, { entry_from: 'agent_media_upgrade_free', presentation: 'now', embedded: false });
    assert.equal(opened[1].host_context?.host_agent, 'codex');
    assert.equal(Object.hasOwn(studioEvents, 'provider_setup_opened'), false);
    assert.equal(validProperties(studioEvents, 'page_view', { page_name: 'settings', view_id: crypto.randomUUID(), embedded: true, has_project: false, settings_section: 'providers', entry_from: 'agent_media_upgrade_go' }), true);
    assert.equal(validProperties(studioEvents, 'ui_click', { page_name: 'settings', area: 'account', element: 'manage_subscription', entry_from: 'agent_media_upgrade_go' }), true);
    assert.equal(validProperties(studioEvents, 'ui_click', { page_name: 'settings', area: 'account', element: 'manage_subscription', entry_from: 'PRIVATE_PROMPT' }), false);
  } finally {
    await running.close();
    tracking.close();
  }
}));

test('template handoff admits observed results and rejects content, made-up outcomes and invalid identities', () => {
  const ids = { template_id: 'motion-example', operation_id: crypto.randomUUID(), handoff_attempt_id: crypto.randomUUID(), detail_view_id: crypto.randomUUID() };
  const valid = { ...ids, page_name: 'studio', stage: 'open', outcome: 'success', project_id: crypto.randomUUID() };
  assert.equal(validProperties(studioEvents, 'template_project_result', valid), true);
  const click = { page_name: 'studio', area: 'template_detail', element: 'start_use', template_action: 'open_edit', operation_id: ids.operation_id };
  assert.equal(validProperties(studioEvents, 'ui_click', click), true);
  assert.equal(validProperties(studioEvents, 'ui_click', { ...click, operation_id: 'private-path' }), false);
  for (const stage of ['create', 'reconcile', 'open']) for (const outcome of ['success', 'failure', 'unknown', 'not_found']) {
    assert.equal(validProperties(studioEvents, 'template_project_result', { ...valid, stage, outcome }), true);
  }
  for (const extra of [{ prompt: 'private text' }, { color: '#123456' }, { url: 'https://private.invalid' }, { raw_error: 'private stack' }, { materials: 'private asset' }]) {
    assert.equal(validProperties(studioEvents, 'template_project_result', { ...valid, ...extra }), false);
  }
  assert.equal(validProperties(studioEvents, 'template_project_result', { ...valid, outcome: 'film_created' }), false);
  assert.equal(validProperties(studioEvents, 'template_project_result', { ...valid, operation_id: 'not-a-uuid' }), false);
  assert.equal(validProperties(studioEvents, 'template_project_result', { ...valid, template_id: '/private/path' }), false);
  assert.equal(validProperties(studioEvents, 'surface_view', { page_name: 'studio', area: 'template_card', element: 'card', placement: 'related', ...ids, source_template_id: 'motion-source', position: 1 }), false);
  assert.equal(validProperties(studioEvents, 'surface_view', { page_name: 'studio', area: 'template_card', element: 'card', placement: 'related', template_id: ids.template_id, detail_view_id: ids.detail_view_id, source_template_id: 'motion-source', position: 1 }), true);
});

test('MCP export failures keep action and service validation details on the original call and replay', () => fixture(async store => {
  const { startServer } = await import('../server.ts');
  const { rpc } = await import('../mcp.ts');
  const events: PendingEvent[] = [];
  const tracking = core(async batch => { events.push(...batch); return 'accepted'; });
  const running = await startServer(store, 0, { editor: false });
  const address = running.server.address();
  assert.ok(address && typeof address !== 'string');
  await writeFile(path.join(store.directory, 'preview.json'), JSON.stringify({ port: address.port }));
  store.tracking = tracking;
  try {
    const requestId = crypto.randomUUID();
    for (const [id, name, args] of [
      [1, 'openmotion_export_request', { requestId }],
      [2, 'openmotion_export_request', { action: 'record_review', projectId: 'project', requestId }],
      [3, 'openmotion_export_request', { action: 'record_review', projectId: 'project', requestId }],
      [4, 'openmotion_show_video', { PRIVATE_KEY: 1 }],
      [5, 'openmotion_show_template_recommendations', { PRIVATE_KEY: 1 }],
    ] as const) {
      const reply: any = await rpc({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }, store);
      assert.equal(reply.result.isError, true);
    }
    await tracking.flush();
    const finished = events.filter(e => e.event === 'mcp_tool_finished');
    assert.deepEqual(finished.map(({ properties: p }) => [p.tool_name, p.action, p.accepted, p.error_code, p.invalid_field, p.validation_rule]), [
      ['motion_export_request', 'request', false, 'INVALID_ARGUMENT', 'projectId', 'missing'],
      ['motion_export_request', 'record_review', true, 'INVALID_ARGUMENT', 'jobId', 'missing'],
      ['motion_export_request', 'record_review', true, 'INVALID_ARGUMENT', 'jobId', 'missing'],
      ['motion_show_video', undefined, false, 'MCP_TOOL_NOT_EXPOSED', undefined, undefined],
      ['motion_show_template_recommendations', undefined, false, 'MCP_TOOL_NOT_EXPOSED', undefined, undefined],
    ]);
    assert(finished.slice(0, 3).every(e => e.properties.operation_id === requestId));
    assert.doesNotMatch(JSON.stringify(events), /PRIVATE_KEY|is required/);
  } finally {
    await running.close();
    tracking.close();
  }
}));
