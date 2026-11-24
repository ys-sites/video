// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtifactViewer } from './ArtifactViewer';
import { I18nProvider } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { readEditorLoadingLayout } from './EditorLoading';
import type { SessionArtifact } from '../../../shared/session';

const state = vi.hoisted(() => ({ error: false, hiddenError: false, loaded: true, value: 'first', saves: 0 }));
vi.mock('../App', () => ({ StudioApp: ({ resolvedProjectId }: { resolvedProjectId: string }) => <div>
  <header className="motion-studio-header"><input aria-label="Edit" defaultValue={resolvedProjectId} onChange={() => state.saves++} /></header>
  <div className="hf-dock"><div className="dv-groupview"><div data-preview-pan-surface /><div data-studio-timeline /></div></div>
  {state.error && <div hidden={state.hiddenError}><div role="alert">Preview failed</div></div>}
</div> }));
vi.mock('./WorkspaceFrame', () => ({ useOptionalWorkspaceChrome: () => ({ workspace: { status: state.loaded ? { projectId: state.value } : null, error: '' } }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
beforeEach(() => {
  state.error = false; state.hiddenError = false; state.loaded = true; state.value = 'first'; state.saves = 0;
  usePlayerStore.getState().reset();
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const artifact = (projectId: string): SessionArtifact => ({ id: projectId, projectId, kind: 'motion-project', title: projectId });
async function render(projectId = 'first') {
  await act(async () => root.render(<I18nProvider><ArtifactViewer key={projectId} artifact={artifact(projectId)} /></I18nProvider>));
}
async function settle() {
  for (let index = 0; index < 4; index++) await act(async () => {
    const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(index * 16));
  });
}
function boot(projectId: string) {
  act(() => { usePlayerStore.getState().beginTimelineSession(projectId); usePlayerStore.getState().setTimelineReady(true); usePlayerStore.getState().markPreviewBooted(); });
}

it('waits for the current project and stable layout, then stays visible during normal state changes', async () => {
  boot('other'); await render(); await settle();
  expect(container.querySelector('.motion-project-editor')?.hasAttribute('inert')).toBe(true);
  expect(container.querySelectorAll('.motion-loading')).toHaveLength(1);
  boot('first'); await settle();
  expect(container.querySelector('[data-editor-initializing="false"]')).not.toBeNull();
  expect(container.querySelector('.motion-project-editor')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.motion-loading')).toBeNull();
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Changed');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(state.saves).toBe(1);
  act(() => usePlayerStore.getState().reset());
  await settle();
  expect(container.querySelector('input')).toBe(input);
  expect(container.querySelector('.motion-loading')).toBeNull();
});

it('keeps a prepared viewer hidden until its scoped workspace status is available', async () => {
  state.loaded = false; boot('first'); await render(); await settle();
  expect(container.querySelector('[data-editor-initializing="true"]')).not.toBeNull();
  state.loaded = true; await render(); await settle();
  expect(container.querySelector('[data-editor-initializing="false"]')).not.toBeNull();
});

it('shows errors immediately and cancels pending presentation when switching projects', async () => {
  boot('first'); await render();
  expect(frames.size).toBe(1);
  state.value = 'second'; await render('second');
  expect(frames.size).toBe(0);
  expect(container.querySelector('input')?.defaultValue).toBe('second');
  expect(container.querySelector('.motion-loading')).not.toBeNull();
  state.error = true; await render('second');
  vi.spyOn(container.querySelector('[role="alert"]')!, 'getClientRects').mockReturnValue([{} as DOMRect] as unknown as DOMRectList);
  await act(async () => container.querySelector('[role="alert"]')!.append('!'));
  expect(container.querySelector('[data-editor-initializing="false"]')).not.toBeNull();
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Preview failed!');
  expect(container.querySelector('.motion-loading')).toBeNull();
});

it('does not reveal for a partial preview or a hidden error, and bounds slow initialization', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  state.error = true; state.hiddenError = true;
  act(() => { usePlayerStore.getState().beginTimelineSession('first'); usePlayerStore.getState().markPreviewBooted(); });
  await render(); await settle();
  expect(container.querySelector('[data-editor-initializing="true"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(5000));
  await settle();
  expect(container.querySelector('[data-editor-initializing="false"]')).not.toBeNull();
});

it('captures only settled geometry for the transition placeholder', async () => {
  await render();
  expect(readEditorLoadingLayout(container)).toBeNull();
  boot('first'); await settle();
  const box = (x: number, width: number, height: number) => ({ x, y: 0, left: x, right: x + width, top: 0, bottom: height, width, height, toJSON() {} });
  vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 800));
  vi.spyOn(container.querySelector('.motion-studio-header')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 40));
  vi.spyOn(container.querySelector('[data-studio-timeline]')!, 'getBoundingClientRect').mockReturnValue(box(200, 1000, 260));
  vi.spyOn(container.querySelector('.dv-groupview')!, 'getBoundingClientRect').mockReturnValue(box(400, 752, 500));
  expect(readEditorLoadingLayout(container)).toEqual({ header: 40, timeline: 260, left: 200, right: 48 });
});
