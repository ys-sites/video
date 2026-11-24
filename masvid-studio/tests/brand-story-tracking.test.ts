import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, deviceContext } from '../tracking/core.ts';
import { omEvents } from '../tracking/events.ts';
import { createPosthogSender } from '../tracking/node.ts';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';

test('brand-series events traverse real admission and the Node sender; invalid fields and opt-out preserve the boundary', () => fixture(async store => {
  const indexed: any[] = [];
  const sender = createPosthogSender({ host: 'https://us.i.posthog.com', token: 'phc_test', appVersion: '0.0.1', env: 'test',
    identity: { installation_id: crypto.randomUUID(), utm_source: null, created_at: new Date().toISOString() },
    fetch: async (_url, init) => { indexed.push(...JSON.parse(String(init?.body)).batch); return Response.json({ status: 1 }); } });
  const tracking = createTracker({ registry: omEvents, entrypoint: 'mcp', enabled: true, flushIntervalMs: 0, send: sender });
  const request = transport(store, { tracking });
  const source = { series_id: 'series-e5f00b', series_list_id: crypto.randomUUID(), series_view_id: crypto.randomUUID(),
    series_placement: 'discovery', series_surface: 'timeline', series_position: 8, series_rank: 1, series_work_count: 16,
    ranking_policy: 'works59-ctr41-v1', ranking_snapshot: 'ctr-20261118-v2', sort: 'recommended', applied_filter_count: 0 };
  const copy = crypto.randomUUID(), download = crypto.randomUUID();
  const rows = [
    ['surface_view', { page_name: 'studio', area: 'template_series_card', element: 'card', ...source }],
    ['ui_click', { page_name: 'studio', area: 'template_series_detail', element: 'start_use', template_id: 'work-one', copy_attempt_id: copy, ...source }],
    ['template_instruction_copy_result', { host_product: 'codex', copy_status: 'clipboard_written', copy_attempt_id: copy, template_id: 'work-one', ...source }],
    ['resource_download_result', { resource_kind: 'motion_guide', delivery_status: 'browser_save_requested', download_attempt_id: download, template_id: 'work-one', ...source }],
  ].map(([event, properties]) => ({ event, properties, event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), entrypoint: 'studio', ...deviceContext() }));
  const post = (events: unknown[]) => request('/motion-api/tracking', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
  try {
    assert.equal((await post(rows)).status, 200);
    assert.equal(await tracking.flush(), 'accepted');
    assert.equal(indexed.length, rows.length);
    assert(indexed.every(row => row.properties.series_view_id === source.series_view_id && row.properties.product === 'openmotion' && row.properties.env === 'test'));
    assert.equal((await post([{ ...rows[0], properties: { ...source, page_name: 'studio', area: 'template_series_card', element: 'card', brand_name: 'PRIVATE' } }])).status, 400);
    assert.equal((await post([{ ...rows[0], properties: { ...source, page_name: 'studio', area: 'template_series_card', element: 'card', ranking_policy: 'PRIVATE' } }])).status, 400);
    tracking.setEnabled(false);
    assert.deepEqual(await (await post(rows)).json(), { accepted: 0, enabled: false });
    assert.equal(indexed.length, rows.length); assert.equal(tracking.pending(), 0);
  } finally { tracking.close(); }
}, false));
