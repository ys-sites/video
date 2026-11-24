// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { phase1Tools } from '../../../shared/phase1-tools';
import { buildOpenMotionWebMcpTools } from '../../../shared/webmcp-tools';
import { webMcpToolNames, studioEvents } from '../../../tracking/events';
import { validProperties } from '../../../tracking/core';
import { buildStudioTools } from './useStudioAgentTools';
import { registerStudioTools } from './registrar';
import { withWebMcpTracking } from './tracking';
import type { ModelContextTool } from './types';

const { track } = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../motion/tracking', () => ({ trackMotion: track }));
vi.mock('../telemetry/client', () => ({ trackEvent: vi.fn() }));
beforeEach(() => { track.mockReset().mockResolvedValue('queued'); });
afterEach(async () => { await vi.dynamicImportSettled(); vi.restoreAllMocks(); });

function descriptor(execute: ModelContextTool['execute']): ModelContextTool {
  return { name: 'openmotion_get_project', description: 'Read a project', execute };
}
function reported(event: string) {
  return track.mock.calls.filter(([name]) => name === event).map(([, properties]) => properties);
}

describe('WebMCP registration and invocation tracking', () => {
  it.each(['success', 'service_failure', 'transport_failure', 'invalid_arguments', 'cancelled'])(
    'measures read action, outcome and exact elapsed time for %s without media or arguments', async mode => {
      let now = 10;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      const request = vi.fn(async () => {
        now = 52.4;
        if (mode === 'transport_failure') throw new Error('PRIVATE_TRANSPORT');
        return mode === 'service_failure' ? Response.json({ error: 'PRIVATE_ERROR', applied: false }, { status: 400 })
          : Response.json({ assetId: crypto.randomUUID(), versionId: crypto.randomUUID(), modality: 'image', version: {}, previews: [],
            content: [{ type: 'image', mimeType: 'image/png', data: 'PRIVATE_BASE64' }] });
      });
      const original = buildOpenMotionWebMcpTools(request).find(tool => tool.name === 'openmotion_assets_use')!;
      const tool = withWebMcpTracking(original);
      const controller = new AbortController();
      if (mode === 'cancelled') controller.abort();
      const args = { action: 'read', assetId: crypto.randomUUID(), ...(mode === 'invalid_arguments' ? {} : { versionId: crypto.randomUUID() }) };
      await tool.execute(args, { signal: controller.signal });
      await vi.dynamicImportSettled();
      const [start] = reported('webmcp_tool_started'), [finish] = reported('webmcp_tool_finished');
      expect(reported('webmcp_tool_started')).toHaveLength(1);
      expect(reported('webmcp_tool_finished')).toHaveLength(1);
      expect(start).toMatchObject({ tool_name: 'openmotion_assets_use', action: 'read' });
      expect(finish).toMatchObject({ ...start, outcome: mode === 'success' ? 'success' : mode === 'cancelled' ? 'cancelled' : 'failure',
        duration_ms: ['invalid_arguments', 'cancelled'].includes(mode) ? 0 : 42 });
      expect(request).toHaveBeenCalledTimes(['invalid_arguments', 'cancelled'].includes(mode) ? 0 : 1);
      expect(validProperties(studioEvents, 'webmcp_tool_finished', finish)).toBe(true);
      if (mode === 'invalid_arguments') expect(finish).toMatchObject({
        error_code: 'INVALID_ARGUMENT', invalid_field: 'versionId', validation_rule: 'missing',
      });
      expect(JSON.stringify(track.mock.calls)).not.toMatch(/PRIVATE|mimeType/);
      expect(finish).not.toHaveProperty('versionId');
    });

  it('keeps action from the start and omits unknown actions and actions on other tools', async () => {
    const input = { action: 'get' };
    const tool = withWebMcpTracking({ name: 'openmotion_assets', description: 'Compatibility tool', execute: async () => {
      input.action = 'read'; return { ok: true };
    } });
    await tool.execute(input);
    for (const [name, action] of [['openmotion_assets_use', 'PRIVATE_ACTION'], ['openmotion_get_project', 'read']])
      await withWebMcpTracking({ name, description: 'Tool', execute: async () => ({ ok: true }) }).execute({ action });
    await vi.dynamicImportSettled();
    expect(reported('webmcp_tool_started')[0].action).toBe('get');
    expect(reported('webmcp_tool_finished')[0].action).toBe('get');
    expect(reported('webmcp_tool_finished').slice(1).every(call => !('action' in call))).toBe(true);
    expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE_ACTION');
  });

  it('covers exactly the 27 public descriptors through the real registrar, preserving schema, signals and replies', async () => {
    const original = [...buildOpenMotionWebMcpTools(vi.fn()), ...buildStudioTools({ current: {} as never })];
    expect([...webMcpToolNames].sort()).toEqual(original.map(tool => tool.name).sort());
    expect(webMcpToolNames).toHaveLength(27);
    const exposed = phase1Tools.filter(tool => !tool.name.startsWith('openmotion_game_'));
    expect(original.slice(0, exposed.length).map(tool => tool.inputSchema)).toEqual(exposed.map(tool => tool.inputSchema));
    const reply = { ok: true, privateResult: 'PRIVATE_CONTENT' };
    const handlers = original.map(() => vi.fn(async () => reply));
    const tools = original.map((tool, i) => ({ ...tool, execute: handlers[i] }));
    const registered: ModelContextTool[] = [];
    const controller = new AbortController();
    await registerStudioTools({ registerTool: async (tool, options) => {
      expect(options?.signal).toBe(controller.signal);
      registered.push(tool);
    } }, tools, controller.signal);
    await vi.dynamicImportSettled();
    expect(reported('webmcp_registration_result')).toHaveLength(original.length);
    const input = { prompt: 'PRIVATE_PROMPT', path: '/PRIVATE_PATH', token: 'PRIVATE_TOKEN' };
    for (const [i, tool] of registered.entries()) {
      expect(tool.inputSchema).toBe(tools[i].inputSchema);
      expect(tool.annotations).toBe(tools[i].annotations);
      const options = { signal: controller.signal };
      expect(await tool.execute(input, options)).toBe(reply);
      expect(handlers[i]).toHaveBeenCalledExactlyOnceWith(input, options);
    }
    await vi.dynamicImportSettled();
    const starts = reported('webmcp_tool_started'), finishes = reported('webmcp_tool_finished');
    expect(starts).toHaveLength(original.length); expect(finishes).toHaveLength(original.length);
    expect(new Set(starts.map(call => call.call_id)).size).toBe(original.length);
    for (const [i, call] of finishes.entries()) {
      expect(call).toMatchObject({ ...starts[i], outcome: 'success' });
      expect(call.duration_ms).toBeGreaterThanOrEqual(0);
    }
    for (const [name, properties] of track.mock.calls) {
      expect(validProperties(studioEvents, name, properties)).toBe(true);
      expect(properties.transport).toBe('webmcp');
    }
    expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE');
    expect(track.mock.calls.every(([event]) => event.startsWith('webmcp_'))).toBe(true);
  });

  it('reports export actions and closed error dimensions without forwarding arbitrary error fields', async () => {
    const tool = withWebMcpTracking({
      ...descriptor(async () => ({ isError: true, error: {
        code: 'INVALID_ARGUMENT', invalid_field: 'versionId', validation_rule: 'missing', message: 'PRIVATE',
      } })),
      name: 'openmotion_export_request',
    });
    await tool.execute({});
    await vi.dynamicImportSettled();
    expect(reported('webmcp_tool_finished')).toEqual([expect.objectContaining({
      action: 'request', outcome: 'failure', error_code: 'INVALID_ARGUMENT', invalid_field: 'versionId', validation_rule: 'missing',
    })]);
    expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE');
  });

  it.each([
    [{ ok: false, kind: 'invalid', reason: 'PRIVATE' }, 'failure'],
    [{ isError: true, error: { code: 'VERSION_CONFLICT', applied: false, message: 'PRIVATE' } }, 'failure'],
    [{ isError: true, error: { code: 'ABORTED', applied: false } }, 'cancelled'],
    [{ isError: true, error: { code: 'ABORTED', applied: 'unknown' } }, 'cancelled'],
    [{ isError: true, error: { code: 'WEBMCP_TRANSPORT_ERROR', applied: 'unknown' } }, 'failure'],
    [{ status: 'failed' }, 'failure'], [{ status: 'partial' }, 'partial'],
    [{ status: 'cancelled' }, 'cancelled'], [undefined, 'unknown'],
  ])('records the observed reply outcome without changing it: %j', async (reply, expected) => {
    const tool = withWebMcpTracking(descriptor(async () => reply));
    expect(await tool.execute({ private: 'PRIVATE' })).toBe(reply);
    await vi.dynamicImportSettled();
    expect(reported('webmcp_tool_finished')).toEqual([expect.objectContaining({ outcome: expected })]);
    expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE');
  });

  it.each([new Error('PRIVATE_ERROR'), new DOMException('PRIVATE_ABORT', 'AbortError'), undefined, null])(
    'preserves thrown values and reports failure or cancellation once', async error => {
      const execute = vi.fn(async () => { throw error; });
      const tool = withWebMcpTracking(descriptor(execute));
      await expect(tool.execute({})).rejects.toBe(error);
      await vi.dynamicImportSettled();
      expect(execute).toHaveBeenCalledTimes(1);
      expect(reported('webmcp_tool_finished')).toEqual([expect.objectContaining({
        outcome: error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failure',
      })]);
      expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE');
    },
  );

  it('measures settlement, correlates concurrent calls and keeps a successful late-aborted reply successful', async () => {
    let now = 10;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const settlements: Array<(value: object) => void> = [];
    const execute = vi.fn(() => new Promise<object>(resolve => settlements.push(resolve)));
    const tool = withWebMcpTracking(descriptor(execute));
    const controller = new AbortController();
    const first = tool.execute({}, { signal: controller.signal });
    now = 20;
    const second = tool.execute({});
    await vi.dynamicImportSettled();
    expect(reported('webmcp_tool_finished')).toHaveLength(0);
    now = 60.4; controller.abort(); settlements[0]({ ok: true }); await first;
    now = 95.8; settlements[1]({ ok: true }); await second;
    await vi.dynamicImportSettled();
    const calls = reported('webmcp_tool_finished');
    expect(calls.map(call => call.duration_ms)).toEqual([50, 76]);
    expect(calls.map(call => call.call_id)).toEqual(reported('webmcp_tool_started').map(call => call.call_id));
    expect(calls.every(call => call.outcome === 'success')).toBe(true);
  });

  it.each(['queued', 'disabled', 'config_unavailable', 'reject', 'throw'])('does not change tools or registration when tracking is %s', async mode => {
    if (mode === 'throw') track.mockImplementation(() => { throw new Error('PRIVATE_COLLECTOR'); });
    else if (mode === 'reject') track.mockRejectedValue(new Error('PRIVATE_COLLECTOR'));
    else track.mockResolvedValue(mode);
    const reply = { ok: true };
    const registered: ModelContextTool[] = [];
    expect(await registerStudioTools({ registerTool: async tool => { registered.push(tool); } },
      [descriptor(async () => reply)], new AbortController().signal)).toEqual({ registered: ['openmotion_get_project'], failed: [] });
    expect(await registered[0].execute({})).toBe(reply);
  });

  it('records success, duplicate/schema refusal, browser refusal and cleanup cancellation at the real registration boundary', async () => {
    const tools = ['openmotion_get_project', 'openmotion_studio_seek', 'openmotion_studio_frame', 'openmotion_studio_inspect', 'openmotion_studio_look']
      .map(name => ({ ...descriptor(async () => ({ ok: true })), name }));
    const registerTool = vi.fn().mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new DOMException('PRIVATE_POLICY', 'NotAllowedError'))
      .mockRejectedValueOnce(new DOMException('PRIVATE_ABORT', 'AbortError'));
    const report = await registerStudioTools({ registerTool },
      [tools[0], tools[0], { ...tools[1], description: '' }, tools[2], tools[3], tools[4]], new AbortController().signal);
    await vi.dynamicImportSettled();
    expect(report.registered).toEqual(['openmotion_get_project']);
    expect(report.failed).toHaveLength(3);
    expect(registerTool).toHaveBeenCalledTimes(3);
    expect(reported('webmcp_registration_result').map(row => row.outcome)).toEqual(['success', 'failure', 'failure', 'failure', 'cancelled']);
    expect(JSON.stringify(track.mock.calls)).not.toContain('PRIVATE');
  });
});
