// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OpenMotionAgentTools } from './OpenMotionAgentTools';
import { phase1Tools } from '../../../shared/phase1-tools';
import { registerStudioTools } from '../webmcp/registrar';
import { buildStudioTools, type StudioAgentToolsDeps } from '../webmcp/useStudioAgentTools';
import type { ModelContext, ModelContextTool } from '../webmcp/types';

const { loadPolyfill, request } = vi.hoisted(() => ({ loadPolyfill: vi.fn(), request: vi.fn() }));
vi.mock('../webmcp/polyfill', () => ({ loadModelContextPolyfill: loadPolyfill }));
vi.mock('../utils/studioApiFetch', () => ({ studioApiFetch: request }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  Reflect.deleteProperty(document, 'modelContext'); vi.unstubAllGlobals(); localStorage.clear();
});

function context() {
  const registered = new Map<string, ModelContextTool>();
  const registerTool = vi.fn<ModelContext['registerTool']>(async (tool, options) => {
    options?.signal?.throwIfAborted();
    if (registered.has(tool.name)) throw new DOMException('Duplicate', 'InvalidStateError');
    registered.set(tool.name, tool);
    options?.signal?.addEventListener('abort', () => registered.delete(tool.name), { once: true });
  });
  return { registered, registerTool };
}

it('native registration coexists with the five Studio observation/navigation tools and survives rerenders without duplicate registration', async () => {
  const native = context();
  Object.defineProperty(document, 'modelContext', { value: native, configurable: true });
  const studioController = new AbortController();
  const studio = buildStudioTools({ current: {} as StudioAgentToolsDeps });
  expect((await registerStudioTools(native, studio, studioController.signal)).failed).toEqual([]);
  await act(async () => root.render(<StrictMode><OpenMotionAgentTools /></StrictMode>));
  expect([...native.registered.keys()].sort()).toEqual([...studio, ...phase1Tools.filter(tool => !tool.name.startsWith('openmotion_game_'))].map(tool => tool.name).sort());
  expect(native.registered.size).toBe(27);
  expect([...native.registered.keys()]).not.toContain('openmotion_studio_set_text');
  expect(loadPolyfill).not.toHaveBeenCalled();
  const count = native.registerTool.mock.calls.length;
  await act(async () => root.render(<StrictMode><OpenMotionAgentTools /></StrictMode>));
  expect(native.registerTool).toHaveBeenCalledTimes(count);
  request.mockResolvedValue(Response.json({ projects: [] }));
  expect(await native.registered.get('openmotion_get_project')!.execute({})).toEqual({ projects: [] });
  expect(request).toHaveBeenCalledWith('/motion-api/phase1/call', expect.objectContaining({ method: 'POST' }));
  await act(async () => root.unmount());
  expect([...native.registered.keys()].sort()).toEqual(studio.map(tool => tool.name).sort());
  studioController.abort();
});

it('uses the existing polyfill and unregisters only its own tools on cleanup', async () => {
  const fallback = context(); loadPolyfill.mockResolvedValue(fallback);
  await act(async () => root.render(<OpenMotionAgentTools />));
  expect(loadPolyfill).toHaveBeenCalledOnce();
  expect(fallback.registered.size).toBe(22);
  await act(async () => root.unmount());
  expect(fallback.registered.size).toBe(0);
});

it('honors the existing disabled preference and does not initialize a fallback', async () => {
  localStorage.setItem('hf-studio-ui-preferences', JSON.stringify({ agentToolsEnabled: false }));
  await act(async () => root.render(<OpenMotionAgentTools />));
  expect(loadPolyfill).not.toHaveBeenCalled();
});

it('does not register after an asynchronous fallback outlives the page', async () => {
  const fallback = context();
  let resolve!: (value: ModelContext | null) => void;
  loadPolyfill.mockReturnValue(new Promise<ModelContext | null>(done => { resolve = done; }));
  await act(async () => root.render(<OpenMotionAgentTools />));
  await act(async () => root.unmount());
  await act(async () => resolve(fallback));
  expect(fallback.registerTool).not.toHaveBeenCalled();
});

it('keeps the page usable when no WebMCP context is available', async () => {
  loadPolyfill.mockResolvedValue(null);
  await act(async () => root.render(<><OpenMotionAgentTools /><p>Editor ready</p></>));
  expect(container.textContent).toBe('Editor ready');
});
