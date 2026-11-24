// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';
import { studioUsageProperties } from '../../../tracking/studio-properties.ts';

const attemptId = '11111111-1111-4111-8111-111111111111';
beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'doNotTrack');
});

async function observeHelper() {
  const client = await import('./client');
  const track = vi.spyOn(client, 'trackEvent').mockImplementation(() => {});
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(attemptId);
  return { track, ...(await import('./ioRecovery')) };
}

it.each(['import_files', 'replace_failed_import', 'refresh_import_list', 'recheck_render', 'recheck_file', 'open_render', 'download_render', 'reload_editor'] as const)(
  'correlates the manual %s action and one result', async action => {
    const { track, beginStudioIo } = await observeHelper();
    const finish = beginStudioIo(action, { requested_count: 2 });
    finish({ outcome: 'partial', added_count: 1, failed_count: 1, listing_status: 'ready' });
    finish({ outcome: 'success', added_count: 2 });
    expect(track.mock.calls).toEqual([
      ['studio_io_action', { action, attempt_id: attemptId, requested_count: 2 }],
      ['studio_io_result', { action, attempt_id: attemptId, requested_count: 2, outcome: 'partial', added_count: 1, failed_count: 1, listing_status: 'ready' }],
    ]);
  },
);

it('keeps the generated identity and selected action when untyped callers supply overrides', async () => {
  const { track, beginStudioIo } = await observeHelper();
  const finish = beginStudioIo('recheck_render', { action: 'download_render', attempt_id: 'PRIVATE_JOB_ID' } as any);
  finish({ outcome: 'success', state_after: 'failed', action: 'open_render', attempt_id: 'PRIVATE_FILE_ID' } as any);
  expect(track.mock.calls.map(([, properties]) => properties)).toEqual([
    { action: 'recheck_render', attempt_id: attemptId },
    { action: 'recheck_render', attempt_id: attemptId, outcome: 'success', state_after: 'failed' },
  ]);
});

it.each(['absent', 'throws', 'invalid'] as const)('skips measurement with an %s UUID source', async mode => {
  const { track, beginStudioIo } = await observeHelper();
  vi.stubGlobal('crypto', mode === 'absent' ? {} : {
    randomUUID: () => { if (mode === 'throws') throw new Error('unavailable'); return 'invalid'; },
  });
  const finish = beginStudioIo('import_files', { requested_count: 1 });
  expect(() => finish({ outcome: 'success', added_count: 1 })).not.toThrow();
  expect(track).not.toHaveBeenCalled();
});

it('keeps telemetry exceptions outside the operation and completes measurement at most once', async () => {
  const { track, beginStudioIo } = await observeHelper();
  track.mockImplementation(() => { throw new Error('collector unavailable'); });
  const finish = beginStudioIo('open_render');
  expect(() => finish({ outcome: 'success', file_status: 'available', delivery_status: 'opened' })).not.toThrow();
  finish({ outcome: 'failure' });
  expect(track).toHaveBeenCalledTimes(2);
});

it('admits only the bounded Studio I/O contract and strips private fields before queueing', () => {
  const safe = { action: 'import_files', attempt_id: attemptId, outcome: 'partial', requested_count: 4,
    added_count: 1, failed_count: 1, unknown_count: 1, pending_count: 1, listing_status: 'failed',
    state_after: 'unknown', file_status: 'unknown', delivery_status: 'browser_save_requested' } as const;
  expect(studioUsageProperties('studio_io_result', { ...safe, project_id: 'PRIVATE_PROJECT', task_id: 'PRIVATE_TASK',
    file_name: 'PRIVATE_FILE', path: 'PRIVATE_PATH', content: 'PRIVATE_CONTENT', error: 'PRIVATE_ERROR' })).toEqual(safe);
  expect(validProperties(studioEvents, 'studio_io_result', safe)).toBe(true);
  expect(validProperties(studioEvents, 'studio_io_result', { ...safe, file_name: 'PRIVATE_FILE' })).toBe(false);
  expect(validProperties(studioEvents, 'studio_io_result', { ...safe, requested_count: -1 })).toBe(false);
  expect(validProperties(studioEvents, 'studio_io_result', { ...safe, added_count: 0.5 })).toBe(false);
  expect(studioUsageProperties('studio_io_result', { ...safe, requested_count: -1, added_count: 0.5,
    file_status: 'https://private.example/file', delivery_status: 'saved' })).toEqual({
    action: 'import_files', attempt_id: attemptId, outcome: 'partial', failed_count: 1, unknown_count: 1,
    pending_count: 1, listing_status: 'failed', state_after: 'unknown',
  });
  for (const [field, value] of [['action', 'automatic_refresh'], ['attempt_id', 'private-task'], ['outcome', 'done']] as const) {
    expect(studioUsageProperties('studio_io_result', { ...safe, [field]: value })).toBeNull();
    const missing: Record<string, unknown> = { ...safe }; delete missing[field];
    expect(studioUsageProperties('studio_io_result', missing)).toBeNull();
  }
  expect(studioUsageProperties('studio_io_action', { action: 'download_render', attempt_id: attemptId })).toEqual({ action: 'download_render', attempt_id: attemptId });
});

function collector(enabled = true) {
  const packets: Array<{ event: string; event_id: string; entrypoint: string; properties: Record<string, unknown> }> = [];
  const urls: string[] = [];
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    if (init?.body) packets.push(...JSON.parse(String(init.body)).events);
    return Response.json({ enabled });
  });
  vi.stubGlobal('fetch', fetcher);
  return { packets, urls, fetcher };
}

it('delivers real helper events through the existing same-origin transport with the privacy filter', async () => {
  const { packets, urls } = collector();
  const { beginStudioIo } = await import('./ioRecovery');
  const { flushStudioUsage } = await import('../motion/studioTracking');
  const finish = beginStudioIo('download_render', { file_name: 'PRIVATE_FILE', path: 'PRIVATE_PATH' } as any);
  finish({ outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested', error: 'PRIVATE_ERROR' } as any);
  await flushStudioUsage();
  expect(packets.map(packet => packet.event)).toEqual(['studio_io_action', 'studio_io_result']);
  expect(packets.every(packet => packet.entrypoint === 'studio')).toBe(true);
  expect(packets[1].properties).toEqual({ action: 'download_render', attempt_id: packets[0].properties.attempt_id,
    outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
  expect(packets[0].event_id).not.toBe(packets[1].event_id);
  expect(urls.every(url => { const target = new URL(url, location.href); return target.origin === location.origin && target.pathname === '/motion-api/tracking'; })).toBe(true);
  expect(JSON.stringify(packets)).not.toMatch(/PRIVATE|api_key|installation_id|distinct_id|phc_/);
});

it('drops both events after opt-out and reports only new attempts after re-enabling', async () => {
  const { packets } = collector();
  const { beginStudioIo } = await import('./ioRecovery');
  const { flushStudioUsage } = await import('../motion/studioTracking');
  const tracking = await import('../motion/tracking');
  tracking.setMotionTrackingEnabled(false);
  beginStudioIo('import_files', { requested_count: 1 })({ outcome: 'success', added_count: 1 });
  await flushStudioUsage();
  expect(packets).toHaveLength(0);
  tracking.setMotionTrackingEnabled(true);
  beginStudioIo('recheck_render')({ outcome: 'success', state_after: 'failed' });
  await flushStudioUsage();
  expect(packets.map(packet => packet.properties.action)).toEqual(['recheck_render', 'recheck_render']);
});

it('respects installation opt-out without sending an event packet', async () => {
  const { packets } = collector(false);
  const { beginStudioIo } = await import('./ioRecovery');
  const { flushStudioUsage } = await import('../motion/studioTracking');
  beginStudioIo('refresh_import_list')({ outcome: 'failure', listing_status: 'failed' });
  await flushStudioUsage();
  expect(packets).toHaveLength(0);
});

it('respects browser Do Not Track without making a configuration or collection request', async () => {
  Object.defineProperty(navigator, 'doNotTrack', { configurable: true, value: '1' });
  const { fetcher } = collector();
  const { beginStudioIo } = await import('./ioRecovery');
  const { flushStudioUsage } = await import('../motion/studioTracking');
  beginStudioIo('recheck_file')({ outcome: 'unknown', file_status: 'unknown' });
  await flushStudioUsage();
  expect(fetcher).not.toHaveBeenCalled();
});
