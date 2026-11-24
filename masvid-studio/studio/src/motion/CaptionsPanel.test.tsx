// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { CaptionsPanel } from './CaptionsPanel';
import { TimelineCaptionsMenu } from './TimelineCaptionsMenu';
import { DEFAULT_CAPTION_SETTINGS } from '../../../shared/caption-style';
import { useCaptionWorkspace } from './captionWorkspace';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { usePlayerStore } from '../player/store/playerStore';
const state = vi.hoisted(() => ({ composition: 'index.html', fail: false, failWrite: false, tracks: [] as any[], documents: [] as any[], elements: [] as any[], wait: vi.fn(), refresh: vi.fn(), toast: vi.fn(), calls: [] as any[] }));
vi.mock('../contexts/StudioContext', () => ({ useStudioPlaybackContext: () => ({ timelineElements: state.elements }), useStudioShellContext: () => ({ projectId: 'project', activeCompPath: state.composition, showToast: state.toast, waitForPendingDomEditSaves: state.wait, writeBlockedReason: null, renderQueue: { isRendering: false } }) }));
vi.mock('../contexts/FileManagerContext', () => ({ useFileManagerContext: () => ({ refreshFileTree: state.refresh }) }));
vi.mock('./transcriptClient', () => ({ transcriptRequest: vi.fn(async input => {
  state.calls.push(input);
  if (input.command === 'caption_tracks') { if (state.fail) throw new Error('Disconnected'); return { tracks: state.tracks }; }
  if (input.command === 'sources') return { sources: [] };
  if (input.command === 'models') return { models: [] };
  if (input.command === 'list') return { documents: state.documents, jobs: [] };
  if (input.command === 'get') return { document: { revision: 1 } };
  if (input.command === 'caption_toggle') {
    if (state.failWrite) throw new Error('Version changed');
    if (!state.tracks.length && input.visible) state.tracks = [{ id: 'empty', kind: 'caption', track: 0, label: 'Captions', cueCount: 0, settings: { ...DEFAULT_CAPTION_SETTINGS }, locked: false }];
    state.tracks = state.tracks.map(t => t.kind === 'caption' ? { ...t, settings: { ...t.settings, visible: input.visible } } : t);
  }
  if (input.command === 'caption_update') {
    if (state.failWrite) throw new Error('Version changed');
    state.tracks = input.remove ? state.tracks.filter(t => t.id !== input.transcriptId) : state.tracks.map(t => t.id === input.transcriptId ? { ...t, settings: { ...t.settings, ...input.captionSettings } } : t);
  }
  return {};
}) }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn(async () => ({ revision: 'snapshot', currentVersionId: 'version' })) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent?.trim() === label || n.getAttribute('aria-label') === label)!;
const render = async (node = <CaptionsPanel />) => act(async () => root.render(<I18nProvider initialLocale="en">{node}</I18nProvider>));
const choose = async (label: string, option: string) => {
  await act(async () => button(label).click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(n => n.textContent?.startsWith(option))!.click());
};
beforeEach(() => {
  state.composition = 'index.html'; state.fail = false; state.failWrite = false; state.calls = []; state.elements = [];
  state.tracks = [{ id: 'doc', kind: 'caption', track: 4, label: 'Speech', cueCount: 2, settings: { ...DEFAULT_CAPTION_SETTINGS }, locked: false }];
  state.documents = [{ id: 'doc', source: { path: 'speech.wav', duration: 3 }, segmentCount: 2 }];
  state.wait.mockReset().mockResolvedValue(undefined); state.refresh.mockReset().mockResolvedValue(undefined); state.toast.mockReset();
  useCaptionWorkspace.setState({ selections: {}, requests: {}, epoch: 0 }); useDockLayoutStore.setState({ visiblePanels: new Set(['captions', 'timeline']) }); usePlayerStore.setState({ selectedElementId: null });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });
it('clicking a style immediately patches only appearance and preserves hidden state and native edits', async () => {
  state.tracks[0].settings.visible = false;
  await render(); await act(async () => button('Paper card').click());
  const input = state.calls.find(c => c.command === 'caption_update');
  expect(input).toMatchObject({ projectId: 'project', compositionPath: 'index.html', transcriptId: 'doc', expectedRevision: 'snapshot', expectedVersionId: 'version', captionSettings: { preset: 'card' } });
  expect(input.captionSettings).toEqual({ preset: 'card' }); expect(input.segments).toBeUndefined(); expect(input.timelineStart).toBeUndefined(); expect(state.refresh).not.toHaveBeenCalled();
  expect(button('Paper card').getAttribute('aria-pressed')).toBe('true'); expect(document.querySelector('[aria-label="Show captions in video"]')?.getAttribute('aria-checked')).toBe('false');
  expect(button('Apply caption style')).toBeUndefined();
});
it('position and size commit immediately without changing the other settings', async () => {
  await render(); await choose('Caption position', 'Top'); await choose('Caption size', '125%');
  expect(state.calls.filter(c => c.command === 'caption_update').map(c => c.captionSettings)).toEqual([{ position: 'top' }, { scale: 1.25 }]);
});
it('a failed write keeps the persisted selection and presents the shared error toast', async () => {
  state.failWrite = true; await render(); await act(async () => button('Paper card').click());
  expect(button('Paper card').getAttribute('aria-pressed')).toBe('false'); expect(state.toast).toHaveBeenCalledWith('Version changed', 'error');
});
it('read recovery retains the track bar; locked tracks cannot be changed, hidden or removed', async () => {
  state.fail = true; await render(); await act(async () => button('Style').click()); expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not load caption tracks'); expect(button('Caption track')).toBeDefined();
  state.fail = false; state.tracks[0].locked = true; await act(async () => button('Retry').click());
  expect(button('Paper card').disabled).toBe(true); expect(button('Hide').disabled).toBe(true); expect(button('Remove caption track').disabled).toBe(true);
});
it('switching compositions while waiting for pending saves prevents an appearance write', async () => {
  let finish!: () => void; state.wait.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await render(); await act(async () => button('Paper card').click());
  state.composition = 'other.html'; await render(); await act(async () => finish());
  expect(state.calls.some(c => c.command === 'caption_update')).toBe(false);
});
it('new styles remain a draft until adding captions with explicit placement', async () => {
  state.tracks = []; await render(); await act(async () => button('Style').click()); await act(async () => button('Paper card').click()); await act(async () => button('Word highlight').click());
  expect(state.calls.some(c => ['caption_update', 'captions'].includes(c.command))).toBe(false);
  await act(async () => button('Add captions to video').click());
  expect(state.calls.find(c => c.command === 'captions')).toMatchObject({ transcriptId: 'doc', expectedTranscriptRevision: 1, captionSettings: { preset: 'card', pacing: 'word' }, sourceStart: 0, sourceEnd: 3, timelineStart: 0, playbackRate: 1, expectedRevision: 'snapshot', expectedVersionId: 'version' });
});
it('recreating a track is explicit, exposes replacement semantics and allows new pacing', async () => {
  await render(); await act(async () => button('Word highlight').click());
  expect(document.body.textContent).toContain('including manual edits'); expect(state.calls.some(c => c.command === 'captions')).toBe(false);
  await act(async () => button('Recreate captions').click()); expect(state.calls.find(c => c.command === 'captions').captionSettings.pacing).toBe('word');
});
it('new transcript captions stay selected through an old preview refresh and select their new clip', async () => {
  const oldClip = { id: 'old-clip', domId: 'transcript-doc-cue', tag: 'div', sourceFile: 'index.html' };
  const newClip = { id: 'new-clip', domId: 'transcript-recording-cue', tag: 'div', sourceFile: 'index.html' };
  state.elements = [oldClip]; usePlayerStore.setState({ selectedElementId: oldClip.id });
  state.documents.push({ id: 'recording', source: { path: 'recording.wav', duration: 3 }, segmentCount: 1 });
  await render(); await choose('Caption track', 'Create from transcript'); await choose('Caption transcript', 'Original · recording.wav');
  await act(async () => button('Word highlight').click());
  state.refresh.mockImplementation(async () => { state.tracks.push({ ...state.tracks[0], id: 'recording', track: 5, label: 'Recording', settings: { ...DEFAULT_CAPTION_SETTINGS, pacing: 'word' } }); });
  await act(async () => button('Add captions to video').click());
  state.elements = []; await render(); state.elements = [oldClip]; await render();
  expect(button('Word highlight').getAttribute('aria-pressed')).toBe('true');
  state.elements = [oldClip, newClip]; await render();
  expect(usePlayerStore.getState().selectedElementId).toBe('new-clip');
  await act(async () => button('By sentence').click());
  expect(button('Cancel')).toBeDefined(); await act(async () => button('Cancel').click());
  expect(button('Word highlight').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('By sentence').click()); expect(button('Recreate captions')).toBeDefined();
});
it('selecting a native caption clip selects its track without confusing display-lane numbers', async () => {
  state.tracks.push({ ...state.tracks[0], id: 'second', track: 8, label: 'French' });
  state.elements = [{ id: 'render-key', domId: 'transcript-second-cue', tag: 'div', track: 0, sourceFile: 'index.html' }];
  await render(); await act(async () => usePlayerStore.setState({ selectedElementId: 'render-key' })); await act(async () => button('Paper card').click());
  expect(state.calls.find(c => c.command === 'caption_update').transcriptId).toBe('second');
  expect(button('Edit transcript')).toBeUndefined(); expect(button('Edit text').disabled).toBe(false); expect(button('Word highlight')).toBeUndefined();
});
it('the CC On/Off label and panel share visibility and track removal', async () => {
  await render(<><CaptionsPanel /><TimelineCaptionsMenu /></>);
  expect(button('Caption visibility').textContent).toBe('On'); expect(button('Caption visibility').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('Hide').click()); expect(button('Caption visibility').getAttribute('aria-pressed')).toBe('false');
  await act(async () => button('Caption visibility').click()); await act(async () => button('Show C1 · Speech').click());
  expect(document.querySelector('[aria-label="Show captions in video"]')?.getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Remove caption track').click()); expect(state.tracks).toHaveLength(0); expect(button('Add captions to video')).toBeDefined();
});

it('creating from the track selector does not jump back to an existing track', async () => {
  await render(); await choose('Caption track', 'Create from transcript');
  expect(button('Recreate captions')).toBeDefined(); expect(button('Word highlight').disabled).toBe(false);
});

it('legacy text selection opens its styles and the CC menu targets that same track', async () => {
  state.documents = [];
  state.tracks = [{ ...state.tracks[0], id: 'old-text', kind: 'text', label: 'Text', settings: { ...DEFAULT_CAPTION_SETTINGS, preset: 'clean', position: 'center' } }];
  state.elements = [{ id: 'title', domId: 'text-old-text-cue', timelineRole: 'text', tag: 'div', track: 0, sourceFile: 'index.html' }];
  await render(<><CaptionsPanel /><TimelineCaptionsMenu /></>);
  await act(async () => usePlayerStore.setState({ selectedElementId: 'title' }));
  expect(button('Caption track').textContent).toContain('T1 · Text');
  expect(document.body.textContent).not.toContain('No caption tracks yet');
  expect(button('Word highlight')).toBeUndefined();
  await act(async () => button('Clean white').click());
  expect(state.calls.find(c => c.command === 'caption_update').transcriptId).toBe('old-text');
  await act(async () => useCaptionWorkspace.getState().open('project', { compositionPath: 'index.html', mode: 'manual' }));
  await act(async () => button('Caption visibility').click());
  await act(async () => button('T1 · Text').click());
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Style');
  expect(button('Caption track').textContent).toContain('T1 · Text');
});

it('text blocks sharing one timeline lane retain its number and use their edited content in both selectors', async () => {
  state.documents = [];
  state.tracks = ['first', 'second'].map(id => ({ ...state.tracks[0], id, kind: 'text', label: 'Original text', track: 5 }));
  state.elements = state.tracks.map((track, index) => ({ id: track.id, domId: `text-${track.id}-cue`, timelineRole: 'text', tag: 'div', track: 0, sourceFile: 'index.html', text: { value: index ? 'Second title' : 'Edited title' } }));
  await render(<><CaptionsPanel /><TimelineCaptionsMenu /></>);
  expect(button('Caption track').textContent).toContain('T1 · Edited title');
  await act(async () => button('Caption visibility').click());
  expect(button('T1 · Edited title')).toBeDefined();
  expect(button('T1 · Second title')).toBeDefined();
  expect(button('T2 · Second title')).toBeUndefined();
  await act(async () => button('T1 · Second title').click());
  expect(button('Caption track').textContent).toContain('T1 · Second title');
  await act(async () => button('Paper card').click());
  expect(state.calls.find(c => c.command === 'caption_update').transcriptId).toBe('second');
});

it('empty styles offer both creation routes and CC opens a specific tool even while the panel is visible', async () => {
  state.tracks = []; state.documents = [];
  await render(<><CaptionsPanel /><TimelineCaptionsMenu /></>);
  await act(async () => button('Style').click());
  expect(button('Caption track')).toBeUndefined();
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[data-testid=caption-controls] button')].find(n => n.textContent === 'Add captions')!.click());
  expect(document.querySelector('textarea[aria-label="Caption text"]')).not.toBeNull();
  await act(async () => button('Caption visibility').click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent === 'Auto captions' && n.getAttribute('role') !== 'tab')!.click());
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Auto captions');
});

it('creation selects its returned track after asynchronous track and preview refresh', async () => {
  await render();
  await act(async () => useCaptionWorkspace.getState().open('project', { compositionPath: 'index.html', mode: 'style', trackId: 'created', selectClip: true }));
  state.tracks = [...state.tracks, { ...state.tracks[0], id: 'created', label: 'New captions' }];
  state.elements = [{ id: 'new-cue', domId: 'transcript-created-cue', tag: 'div', sourceFile: 'index.html' }];
  await act(async () => useCaptionWorkspace.getState().changed());
  await render();
  expect(button('Caption track').textContent).toContain('New captions');
  expect(usePlayerStore.getState().selectedElementId).toBe('new-cue');
  await act(async () => button('Paper card').click());
  expect(state.calls.find(c => c.command === 'caption_update').transcriptId).toBe('created');
});

it('a panel request for another composition does not override this composition', async () => {
  useCaptionWorkspace.getState().open('project', { compositionPath: 'other.html', mode: 'manual' });
  await render();
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Style');
});

it('does no recurring caption discovery and refreshes visible consumers after edits', async () => {
 vi.useFakeTimers();
 const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
 await render(<><CaptionsPanel /><TimelineCaptionsMenu /></>);
 state.calls = [];
 await act(async () => vi.advanceTimersByTimeAsync(20000));
 expect(state.calls).toHaveLength(0);
 await act(async () => useDockLayoutStore.setState({ visiblePanels: new Set(['timeline']) }));
 await act(async () => useCaptionWorkspace.getState().changed());
 expect(state.calls.map(c => c.command)).toEqual(['caption_tracks']);
 state.calls = [];
 await act(async () => { visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); });
 await act(async () => { useCaptionWorkspace.getState().changed(); await vi.advanceTimersByTimeAsync(20000); });
 expect(state.calls).toHaveLength(0);
 await act(async () => { visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); });
 expect(state.calls.map(c => c.command)).toEqual(['caption_tracks']);
});

it('a late created-clip refresh does not replace a newer manual-caption draft', async () => {
  await render();
  await act(async () => useCaptionWorkspace.getState().open('project', { compositionPath: 'index.html', mode: 'style', trackId: 'doc', selectClip: true }));
  await act(async () => button('Add captions').click());
  const input = document.querySelector<HTMLTextAreaElement>('[aria-label="Caption text"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Keep this draft'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  state.elements = [{ id: 'created', domId: 'transcript-doc-cue', tag: 'div', track: 4, sourceFile: 'index.html' }];
  await render();
  expect(document.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Add captions');
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Caption text"]')?.value).toBe('Keep this draft');
  expect(usePlayerStore.getState().selectedElementId).toBeNull();
});


it('the CC switch enables an empty track once and retains Off after reload', async () => {
  state.tracks = [];
  await render(<TimelineCaptionsMenu />); expect(button('Caption visibility').textContent).toBe('Off');
  await act(async () => button('Caption visibility').click());
  await act(async () => button('On').click());
  expect(state.calls.find(c => c.command === 'caption_toggle')).toMatchObject({ visible: true, expectedRevision: 'snapshot', expectedVersionId: 'version', compositionPath: 'index.html' });
  expect(button('Caption visibility').textContent).toBe('On'); expect(state.tracks).toHaveLength(1);
  await act(async () => button('Off').click());
  expect(button('Caption visibility').textContent).toBe('Off'); expect(state.tracks).toHaveLength(1);
  await render(<TimelineCaptionsMenu />); expect(button('Caption visibility').textContent).toBe('Off');
});
it('a rejected global caption toggle leaves the saved state and reports a toast', async () => {
  await render(<TimelineCaptionsMenu />); state.failWrite = true;
  await act(async () => button('Caption visibility').click()); await act(async () => button('Off').click());
  expect(button('Caption visibility').textContent).toBe('On'); expect(state.toast).toHaveBeenCalledWith('Version changed', 'error');
});
