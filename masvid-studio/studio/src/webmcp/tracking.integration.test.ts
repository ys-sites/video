// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildOpenMotionWebMcpTools } from '../../../shared/webmcp-tools';
import { buildStudioTools } from './useStudioAgentTools';
import type { ModelContextTool } from './types';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(async () => {
  await vi.dynamicImportSettled();
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules();
  Reflect.deleteProperty(navigator, 'doNotTrack');
});

async function registerTools() {
  const { registerStudioTools } = await import('./registrar');
  const reply = { ok: true, private: 'PRIVATE_RESULT' };
  const execute = vi.fn(async () => reply);
  const tools = [...buildOpenMotionWebMcpTools(vi.fn()), ...buildStudioTools({ current: {} as never })]
    .map(tool => ({ ...tool, execute }));
  const registered: ModelContextTool[] = [];
  await registerStudioTools({ registerTool: async tool => { registered.push(tool); } }, tools, new AbortController().signal);
  return { registered, execute, reply };
}

it('delivers all registered tools through the actual browser sender and never queues more events after opt-out', async () => {
  const packets: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') packets.push(...JSON.parse(String(init.body)).events);
    return Response.json({ enabled: true });
  }));
  const tracking = await import('../motion/tracking');
  await tracking.initializeTracking();
  const { registered, execute, reply } = await registerTools();
  for (const tool of registered) {
    expect(await tool.execute({ path: '/PRIVATE', prompt: 'PRIVATE',
      ...(tool.name === 'openmotion_assets_use' ? { action: 'read' } : tool.name === 'openmotion_assets' ? { action: 'get' } : {}) })).toBe(reply);
    // Keep the burst under the bounded browser queue (64); production also flushes on an interval.
    await vi.dynamicImportSettled(); await tracking.flushMotionTracking();
  }
  await vi.dynamicImportSettled();
  for (let i = 0; i < 10 && tracking.getMotionTrackingStatus().pending; i++) await tracking.flushMotionTracking();
  expect(tracking.getMotionTrackingStatus().pending).toBe(0);
  expect(packets.filter(packet => packet.event === 'webmcp_registration_result')).toHaveLength(registered.length);
  expect(packets.filter(packet => packet.event === 'webmcp_tool_started')).toHaveLength(registered.length);
  expect(packets.filter(packet => packet.event === 'webmcp_tool_finished')).toHaveLength(registered.length);
  expect(packets.every(packet => packet.entrypoint === 'studio' && packet.properties.transport === 'webmcp')).toBe(true);
  expect(packets.filter(packet => packet.properties.action === 'read').map(packet => packet.event)).toEqual(['webmcp_tool_started', 'webmcp_tool_finished']);
  expect(packets.filter(packet => packet.properties.action === 'get')).toHaveLength(2);
  expect(JSON.stringify(packets)).not.toMatch(/PRIVATE|installation_id|distinct_id|api_key/);

  tracking.setMotionTrackingEnabled(false);
  for (const tool of registered) expect(await tool.execute({ action: 'read' })).toBe(reply);
  await vi.dynamicImportSettled(); await tracking.flushMotionTracking();
  expect(packets).toHaveLength(registered.length * 3);
  expect(execute).toHaveBeenCalledTimes(registered.length * 2);
});

it.each([[false, '0'], [true, '1']] as const)('keeps tools functional with collection enabled=%s and Do Not Track=%s', async (enabled, dnt) => {
  Object.defineProperty(navigator, 'doNotTrack', { value: dnt, configurable: true });
  const fetcher = vi.fn(async () => Response.json({ enabled }));
  vi.stubGlobal('fetch', fetcher);
  const tracking = await import('../motion/tracking');
  const { registered, reply } = await registerTools();
  for (const tool of registered) expect(await tool.execute({})).toBe(reply);
  await vi.dynamicImportSettled(); await tracking.flushMotionTracking();
  expect(tracking.getMotionTrackingStatus().pending).toBe(0);
  expect(fetcher).toHaveBeenCalledTimes(dnt === '1' ? 0 : 1);
});

it('keeps successful tool calls successful during collector outages without replaying their handlers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') throw new Error('PRIVATE_COLLECTOR');
    return Response.json({ enabled: true });
  }));
  const tracking = await import('../motion/tracking');
  await tracking.initializeTracking();
  const { registered, execute, reply } = await registerTools();
  expect(await registered[0].execute({})).toBe(reply);
  await vi.dynamicImportSettled();
  expect(await tracking.flushMotionTracking()).toBe('retry');
  expect(execute).toHaveBeenCalledTimes(1);
  tracking.setMotionTrackingEnabled(false);
});
