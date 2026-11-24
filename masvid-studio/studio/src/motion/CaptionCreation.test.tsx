// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { AutoCaptionsPanel } from './AutoCaptionsPanel';
import { ManualTextPanel } from './ManualTextPanel';
import { useCaptionWorkspace } from './captionWorkspace';
import { usePlayerStore } from '../player/store/playerStore';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
const state = vi.hoisted(() => ({ composition: 'index.html', model: true, fail: false, wait: vi.fn(), refresh: vi.fn(), toast: vi.fn(), calls: [] as any[] }));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: 'project', activeCompPath: state.composition, waitForPendingDomEditSaves: state.wait, showToast: state.toast, renderQueue: { isRendering: false } }) }));
vi.mock('../contexts/FileManagerContext', () => ({ useFileManagerContext: () => ({ refreshFileTree: state.refresh }) }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn(async () => ({ revision: 'revision', currentVersionId: 'version' })) }));
vi.mock('./transcriptClient', () => ({ transcriptRequest: vi.fn(async input => {
  state.calls.push(input);
  if (input.command === 'sources') return { sources: [{ path: 'speech.wav' }] };
  if (input.command === 'models') return { models: state.model ? [{ id: 'speech', label: 'Speech' }] : [] };
  if (input.command === 'submit') { if (state.fail) throw new Error('Interrupted'); return { job: { id: 'job', state: 'queued', totalChunks: 1, completedChunks: 0 } }; }
  if (input.command === 'status') return { job: { id: 'job', state: 'completed', transcriptId: 'doc' } };
  if (input.command === 'get') return { document: { id: 'doc', revision: 2, source: { path: 'speech.wav', duration: 10 } } };
  return { trackId: input.command === 'captions' ? 'doc' : 'manual-track' };
}) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === label)!;
const render = async (node: React.ReactNode) => act(async () => root.render(<I18nProvider initialLocale="en">{node}</I18nProvider>));
beforeEach(() => useDockLayoutStore.setState({ visiblePanels: new Set(['captions', 'timeline']) }));
beforeEach(() => { useCaptionWorkspace.setState({ selections: {}, requests: {}, epoch: 0 }); state.composition = 'index.html'; state.model = true; state.fail = false; state.calls = []; state.wait.mockReset().mockResolvedValue(undefined); state.refresh.mockReset().mockResolvedValue(undefined); state.toast.mockReset(); usePlayerStore.setState({ currentTime: 4, selectedElementId: null, elements: [] }); const host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); });
it('adds plain editable text at the playhead without requiring speech or a model', async () => {
  state.model = false; await render(<ManualTextPanel />); await act(async () => button('Add text').click());
  expect(state.calls).toHaveLength(1);
  expect(state.calls[0]).toMatchObject({ command: 'caption_add', textKind: 'text', timelineStart: 4, compositionPath: 'index.html', segments: [{ id: 'cue-1', text: 'Default text', start: 0, end: 3 }], expectedRevision: 'revision', expectedVersionId: 'version' });
});
it('creates consecutive manual captions from pasted lines', async () => {
  await render(<ManualTextPanel kind="caption" />);
  const input = document.querySelector('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'First line\nSecond line'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => button('Add captions').click());
  expect(useCaptionWorkspace.getState().requests.project).toMatchObject({ compositionPath: 'index.html', mode: 'style', trackId: 'manual-track', selectClip: true });
  expect(state.calls[0].segments).toEqual([{ id: 'cue-1', text: 'First line', start: 0, end: 3 }, { id: 'cue-2', text: 'Second line', start: 3, end: 6 }]);
});
it('finishes a saved caption without waiting for unrelated file inventory work', async () => {
  state.refresh.mockImplementation(() => new Promise(() => {}));
  await render(<ManualTextPanel />);
  await act(async () => button('Add text').click());
  expect(state.refresh).not.toHaveBeenCalled();
  expect(useCaptionWorkspace.getState().requests.project).toMatchObject({ trackId: 'manual-track', selectClip: true });
  expect(button('Add text').disabled).toBe(false);
  expect(state.toast).toHaveBeenCalledWith('Text added to the timeline', 'info');
});
it('does not write into a different composition after pending saves', async () => {
  let finish!: () => void; state.wait.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(<ManualTextPanel />); await act(async () => button('Add text').click());
  state.composition = 'other.html'; await render(<ManualTextPanel />); await act(async () => finish());
  expect(state.calls).toHaveLength(0);
});
it('auto captions use the selected trimmed and retimed source and add completed cues directly', async () => {
  vi.useFakeTimers();
  usePlayerStore.setState({ selectedElementId: 'audio', elements: [{ id: 'audio', tag: 'audio', src: 'speech.wav', start: 4, duration: 3, playbackStart: 2, playbackRate: 2, track: 0 }] as any });
  await render(<AutoCaptionsPanel />); await act(async () => button('Generate captions').click());
  expect(state.calls.find(input => input.command === 'submit')).toMatchObject({ sourcePath: 'speech.wav', model: 'speech', language: 'auto' });
  await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(state.calls.find(input => input.command === 'captions')).toMatchObject({ transcriptId: 'doc', expectedTranscriptRevision: 2, sourceStart: 2, sourceEnd: 8, timelineStart: 4, playbackRate: 2 });
});
it('an interrupted paid request reuses its request id on explicit retry', async () => {
  state.fail = true; await render(<AutoCaptionsPanel />); await act(async () => button('Generate captions').click());
  state.fail = false; await act(async () => button('Generate captions').click());
  const calls = state.calls.filter(input => input.command === 'submit'); expect(calls).toHaveLength(2); expect(calls[1].requestId).toBe(calls[0].requestId);
});
it('pauses a hidden recognition surface and resumes the same job without resubmitting', async () => {
  vi.useFakeTimers();
  await render(<AutoCaptionsPanel />);
  await act(async () => button('Generate captions').click());
  await render(<AutoCaptionsPanel visible={false} />);
  state.calls = [];
  await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(state.calls).toHaveLength(0);
  await render(<AutoCaptionsPanel />);
  await act(async () => vi.advanceTimersByTimeAsync(1100));
  expect(state.calls.filter(input => input.command === 'status')).toEqual([{ command: 'status', projectId: 'project', jobId: 'job' }]);
  expect(state.calls.some(input => input.command === 'captions')).toBe(true);
  expect(state.calls.some(input => input.command === 'submit')).toBe(false);
});
