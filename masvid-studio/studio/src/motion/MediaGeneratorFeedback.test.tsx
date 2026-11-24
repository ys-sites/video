// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { MediaGenerator } from './MediaGenerator';
import { I18nProvider } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { TimelineMediaActionError } from '../utils/timelineMediaActionError';
import { StudioSaveHttpError, StudioSaveNetworkError } from '../utils/studioSaveDiagnostics';
import type { GenerationJob, Model } from './gatewayClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; usePlayerStore.getState().reset(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const model = { id: 'test:model', provider: 'codex', label: 'Test', modality: 'image', supportsImageReference: true } as Model;
const selection = { key: 'image', elementId: 'image', path: 'assets/original.png', src: 'assets/original.png', modality: 'image' as const, label: 'Image' };
const initialJob = { id: 'job', projectId: 'project', model, prompt: 'forest', state: 'completed', updatedAt: 10, reference: { path: selection.path }, assets: [{ path: 'assets/result.png', mimeType: 'image/png' }] } as GenerationJob;
function button(text: string) { return [...document.querySelectorAll('button')].find(item => item.textContent === text)!; }
function messages() { return [...document.querySelectorAll('.hf-toast-surface')].map(item => item.textContent); }
async function mount(options: { action?: () => Promise<void>; job?: GenerationJob; cancel?: () => Promise<Response>; zh?: boolean } = {}) {
  vi.useFakeTimers();
  usePlayerStore.setState({ timelineProjectId: 'project' });
  const state = { jobs: [options.job ?? initialJob], projectId: 'project', failStatus: false };
  const action = vi.fn(options.action ?? (async () => {}));
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('models/capabilities')) return Response.json({ providers: [{ id: 'codex', available: true }], routes: {} });
    if (url.includes('/models?')) return Response.json({ models: [model], nextOffset: null });
    if (url.includes('project/status')) { if (state.failStatus) throw new TypeError('Failed to fetch'); return Response.json({ projectId: state.projectId }); }
    if (url.endsWith('/cancel')) return options.cancel ? options.cancel() : Response.json({ job: { ...state.jobs[0], state: 'cancelled', updatedAt: 20 } });
    if (url.includes('/generations?')) return Response.json({ jobs: state.jobs });
    throw new Error(`Unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale={options.zh ? 'zh-CN' : 'en'}><MediaGenerator request={{ id: 'request', intent: 'edit', selection, prompt: 'forest', target: { projectId: 'project', compositionId: 'main', place: action, replace: action, importFiles: async () => {}, currentPlacement: () => ({ start: 0, duration: 3, track: 0 }) } }} onClose={() => {}} onSettings={() => {}} /></I18nProvider>));
  return { action, state, fetcher };
}
const actions = [
  ['Place on timeline', 'Could not place the asset on the timeline.', 'Could not confirm placement. Check the timeline.', 'Return to the original project before placing this asset on the timeline.'],
  ['Replace selected image', 'Could not replace the image.', 'Could not confirm image replacement. Check the timeline.', 'Return to the original project before replacing this image.'],
] as const;
it.each(actions)('reports known failure for %s once without a form error', async (label, message) => {
  const { action } = await mount({ action: async () => { throw new TimelineMediaActionError('failed'); } });
  await act(async () => button(label).click());
  expect(action).toHaveBeenCalledOnce(); expect(messages()).toEqual([message]);
  expect(document.querySelector('.motion-generator > .motion-media-error')).toBeNull();
  expect(button(label).disabled).toBe(false);
});
it.each(actions)('keeps uncertain %s distinct from failure and blocks a duplicate action', async (label, _failure, message) => {
  const { action } = await mount({ action: async () => { throw new StudioSaveNetworkError('Lost response'); } });
  await act(async () => { button(label).click(); button(label).click(); });
  expect(action).toHaveBeenCalledOnce(); expect(messages()).toEqual([message]);
  expect(button('Check the timeline').disabled).toBe(true);
  await act(async () => button('Check the timeline').click());
  expect(action).toHaveBeenCalledOnce(); expect(document.body.textContent).not.toContain('Replaced ·');
});
it.each(actions)('refuses %s from another project without calling its target', async (label, _failure, _unknown, message) => {
  const { state, action } = await mount(); state.projectId = 'another';
  await act(async () => button(label).click());
  expect(action).not.toHaveBeenCalled(); expect(messages()).toEqual([message]);
});
it('reports a preflight read failure as no placement, and a rejected write as no replacement', async () => {
  const { state, action } = await mount({ action: async () => { throw new StudioSaveHttpError('Conflict', 409); } });
  state.failStatus = true;
  await act(async () => button('Place on timeline').click());
  expect(action).not.toHaveBeenCalled(); expect(messages()).toEqual([actions[0][1]]);
  state.failStatus = false;
  await act(async () => button('Replace selected image').click());
  expect(messages()).toEqual([actions[0][1], actions[1][1]]);
});
it('does not duplicate an existing save recovery notice', async () => {
  await mount({ action: async () => { throw new StudioSaveHttpError('Already reported', 409, { alreadyToasted: true }); } });
  await act(async () => button('Place on timeline').click());
  expect(messages()).toEqual([]);
});
it('keeps parameter validation in the form when an independent action fails', async () => {
  await mount({ action: async () => { throw new TimelineMediaActionError('failed'); } });
  await act(async () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[aria-label="Advanced parameters (JSON)"]')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, '[]');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Generate').click());
  const error = document.querySelector('.motion-generator > .motion-media-error')!.textContent;
  await act(async () => button('Replace selected image').click());
  expect(document.querySelector('.motion-generator > .motion-media-error')!.textContent).toBe(error);
  expect(messages()).toEqual([actions[1][1]]);
});
it.each(['network', 'malformed'])('does not invent cancellation after a %s failure and recovers through polling', async kind => {
  const { state } = await mount({ job: { ...initialJob, state: 'running', assets: [] }, cancel: async () => { if (kind === 'network') throw new TypeError('Lost response'); return Response.json({}); } });
  await act(async () => button('Cancel').click());
  expect(messages()).toEqual(['Could not confirm cancellation. Check the task status.']);
  expect(document.querySelector('.motion-generation-results')!.textContent).toContain('running');
  expect(document.querySelector('.motion-generator > .motion-media-error')).toBeNull();
  state.jobs = [{ ...initialJob, state: 'cancelled', updatedAt: 20, assets: [] }];
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(document.querySelector('.motion-generation-results')!.textContent).toContain('cancelled');
});
it('uses a completed cancellation response and ignores an older running poll', async () => {
  const { fetcher } = await mount({ job: { ...initialJob, state: 'running', assets: [] }, cancel: async () => Response.json({ job: { ...initialJob, updatedAt: 20 } }) });
  await act(async () => { button('Cancel').click(); button('Cancel').click(); });
  expect(fetcher.mock.calls.filter(([url]) => url.endsWith('/cancel'))).toHaveLength(1);
  expect(messages()).toEqual(['Generation already completed.']);
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(document.querySelector('.motion-generation-results')!.textContent).toContain('completed');
  expect(document.querySelector('.motion-generation-results')!.textContent).not.toContain('cancelled');
  expect(button('Place on timeline')).toBeTruthy();
});
it('shows Chinese action-specific feedback', async () => {
  await mount({ zh: true, action: async () => { throw new TimelineMediaActionError('failed'); } });
  await act(async () => button('替换所选图片').click());
  expect(messages()).toEqual(['未能替换图片。']);
});
it('keeps confirmed cancellation when an older running poll arrives', async () => {
  await mount({ job: { ...initialJob, state: 'running', assets: [] } });
  await act(async () => button('Cancel').click());
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  expect(document.querySelector('.motion-generation-results')!.textContent).toContain('cancelled');
  expect(button('Cancel')).toBeUndefined(); expect(messages()).toEqual([]);
});
it('does not claim cancellation when the server still returns a running job', async () => {
  const running = { ...initialJob, state: 'running' as const, assets: [], updatedAt: 20 };
  await mount({ job: running, cancel: async () => Response.json({ job: running }) });
  await act(async () => button('Cancel').click());
  expect(messages()).toEqual(['Could not confirm cancellation. Check the task status.']);
  expect(document.querySelector('.motion-generation-results')!.textContent).toContain('running');
});
