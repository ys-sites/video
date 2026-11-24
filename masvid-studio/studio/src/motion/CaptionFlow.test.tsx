// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { TranscriptPanel } from './TranscriptPanel';
import { useCaptionWorkspace } from './captionWorkspace';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { TimelineCaptionActions } from './TimelineCaptionActions';
const state = vi.hoisted(() => ({ model: false, failSubmit: false, failLoad: false, jobs: [] as any[], composition: 'index.html', wait: vi.fn(), upload: vi.fn(), toast: vi.fn(), settings: vi.fn(), clear: vi.fn(), file: null as File | null, calls: [] as any[] }));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: 'project', activeCompPath: state.composition, showToast: state.toast, waitForPendingDomEditSaves: state.wait, writeBlockedReason: null, renderQueue: { isRendering: false } }) }));
vi.mock('../contexts/FileManagerContext', () => ({ useFileManagerContext: () => ({ uploadProjectFiles: state.upload }) }));
vi.mock('./WorkspaceChromeContext', () => ({ useOptionalWorkspaceChrome: () => ({ openModelSettings: state.settings }) }));
vi.mock('./useTranscriptRecorder', () => ({ useTranscriptRecorder: () => ({ file: state.file, state: 'idle', seconds: 2, start: vi.fn(), stop: vi.fn(), clear: state.clear }) }));
vi.mock('./transcriptClient', () => ({ downloadTranscript: vi.fn(), transcriptRequest: vi.fn(async input => { state.calls.push(input); if (state.failLoad && input.command === 'sources') throw new Error('Offline'); if (input.command === 'submit' && state.failSubmit) throw new Error('Response interrupted'); if (input.command === 'sources') return { sources: [{ path: 'speech.wav', sha256: 'hash', bytes: 10 }] }; if (input.command === 'models') return { models: state.model ? [{ id: 'asr', label: 'Speech model' }] : [], defaultModel: state.model ? 'asr' : null }; return { documents: [], jobs: state.jobs }; }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(n => n.textContent?.trim() === text || n.getAttribute('aria-label') === text)!;
const render = async (node: React.ReactNode) => act(async () => root.render(<I18nProvider initialLocale="en">{node}</I18nProvider>));
beforeEach(() => { useDockLayoutStore.setState({ visiblePanels: new Set(['transcript', 'timeline']) }); state.model = false; state.failSubmit = false; state.failLoad = false; state.jobs = []; state.composition = 'index.html'; state.calls = []; state.wait.mockReset().mockResolvedValue(undefined); state.upload.mockReset().mockResolvedValue(['assets/recording.wav']); state.clear.mockReset(); state.settings.mockReset(); state.file = new File(['recorded'], 'recording.wav'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host); vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recording'); vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {}); vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {}); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });
it('missing model offers an actionable setup path and independent subtitle import', async () => {
 await render(<TranscriptPanel />);
 expect(document.querySelector('[data-testid="transcript-workflow"]')).toBeNull();
 expect(button('Connect speech model').disabled).toBe(false); expect(button('Transcribe')).toBeUndefined();
 await act(async () => button('Connect speech model').click()); expect(state.settings).toHaveBeenCalledOnce();
 expect(button('Import SRT / VTT').disabled).toBe(false);
 expect(document.querySelector('[role=toolbar] [aria-label="Transcript view"]')).not.toBeNull();
 expect(button('Edit text').disabled).toBe(true);
 expect(document.querySelector('[data-testid="transcript-reading-area"] [role=toolbar]')).toBeNull();
 expect(state.calls.some(c => c.command === 'submit')).toBe(false);
});
it('caption recognition uses the selected source and explicit model without exposing model setup by default', async () => {
 state.model = true; await render(<TranscriptPanel />); expect(document.querySelector('[aria-label="Transcription model"]')).toBeNull();
 await act(async () => button('Recognition settings').click());
 expect(document.querySelector('[aria-label="Transcription model"]')).not.toBeNull();
 expect(document.querySelector('[data-testid="transcript-reading-area"] [aria-label="Transcription model"]')).toBeNull();
 await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
 await act(async () => button('Transcribe').click());
 expect(state.calls.find(c => c.command === 'submit')).toMatchObject({ projectId: 'project', sourcePath: 'speech.wav', model: 'asr', language: 'auto', requestId: expect.any(String) });
});
it('recording adoption retries timeline placement without uploading the audio twice', async () => {
 const add = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true); await render(<TimelineCaptionActions onAddToTimeline={add} />);
 await act(async () => button('Record voiceover').click()); await act(async () => button('Add recording at playhead').click());
 expect(state.clear).not.toHaveBeenCalled(); await act(async () => button('Add recording at playhead').click());
 expect(state.upload).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledTimes(2); expect(state.clear).toHaveBeenCalledOnce();
});
it('composition change while waiting for saves prevents adopting a recording into the wrong composition', async () => {
 let finish!: () => void; state.wait.mockImplementation(() => new Promise<void>(r => { finish = r; })); const add = vi.fn();
 await render(<TimelineCaptionActions onAddToTimeline={add} />); await act(async () => button('Record voiceover').click()); await act(async () => button('Add recording at playhead').click());
 state.composition = 'other.html'; await render(<TimelineCaptionActions onAddToTimeline={add} />); await act(async () => finish());
 expect(state.upload).not.toHaveBeenCalled(); expect(add).not.toHaveBeenCalled(); expect(state.clear).not.toHaveBeenCalled();
});

it('record and transcribe retries reuse the paid request identity without inserting duplicate audio', async () => {
 state.model = true; state.failSubmit = true;
 const add = vi.fn().mockResolvedValue(true); await render(<TimelineCaptionActions onAddToTimeline={add} />);
 await act(async () => button('Record voiceover').click()); await act(async () => button('Add and transcribe').click());
 expect(state.clear).not.toHaveBeenCalled(); const submitted = state.calls.find(c => c.command === 'submit');
 state.failSubmit = false; await act(async () => button('Add and transcribe').click());
 expect(state.upload).toHaveBeenCalledOnce(); expect(add).toHaveBeenCalledOnce(); expect(state.clear).toHaveBeenCalledOnce();
 const retry = state.calls.filter(c => c.command === 'submit'); expect(retry).toHaveLength(2); expect(retry[1]).toEqual(submitted);
});


it('load recovery keeps the toolbar available instead of replacing the entire workspace', async () => {
 state.failLoad = true; await render(<TranscriptPanel />);
 expect(button('Retry')).toBeDefined(); expect(button('Caption styles').disabled).toBe(false);
 expect(document.querySelector('[role=toolbar]')).not.toBeNull();
 state.failLoad = false; await act(async () => button('Retry').click());
 expect(button('Retry')).toBeUndefined(); expect(button('Import SRT / VTT').disabled).toBe(false);
});

it('running recognition uses the reading area and cancels the original job', async () => {
 state.model = true; state.jobs = [{ id: 'running-job', source: { path: 'speech.wav' }, state: 'running', totalChunks: 4, completedChunks: 2 }];
 await render(<TranscriptPanel />);
 expect(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow')).toBe('2');
 expect(button('Transcribe')).toBeUndefined();
 expect(document.querySelector('[aria-label="Source media"]')?.getAttribute('disabled')).not.toBeNull();
 await act(async () => button('Cancel transcription').click());
 expect(state.calls.find(c => c.command === 'cancel')).toEqual({ command: 'cancel', projectId: 'project', jobId: 'running-job' });
});

it('timeline recording and transcript shortcuts are icon-only with accessible names', async () => {
 await render(<TimelineCaptionActions onAddToTimeline={vi.fn()} />);
 expect(button('Record voiceover').textContent).toBe(''); expect(button('Record voiceover').querySelector('svg')).not.toBeNull();
 expect(button('Open transcript').textContent).toBe(''); expect(button('Open transcript').querySelector('svg')).not.toBeNull();
 await act(async () => button('Record voiceover').click()); expect(button('Listen to recording')).toBeDefined();
});


it('the icon-only T shortcut opens manual captions in the active composition', async () => {
 await render(<TimelineCaptionActions onAddToTimeline={vi.fn()} />);
 expect(button('Manual captions').textContent).toBe('');
 await act(async () => button('Manual captions').click());
 expect(useCaptionWorkspace.getState().requests.project).toMatchObject({ mode: 'manual', compositionPath: 'index.html' });
});

it('retains hidden transcript state without polling and refreshes on return to the foreground', async () => {
 vi.useFakeTimers();
 const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
 useDockLayoutStore.setState({ visiblePanels: new Set(['timeline']) });
 await render(<TranscriptPanel />);
 await act(async () => { useCaptionWorkspace.getState().changed(); await vi.advanceTimersByTimeAsync(15000); });
 expect(state.calls).toHaveLength(0);
 await act(async () => useDockLayoutStore.setState({ visiblePanels: new Set(['transcript', 'timeline']) }));
 expect(state.calls.filter(c => c.command === 'sources')).toHaveLength(1);
 state.calls = [];
 await act(async () => vi.advanceTimersByTimeAsync(15000));
 expect(state.calls).toHaveLength(0);
 await act(async () => { visibility.mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); });
 await act(async () => { useCaptionWorkspace.getState().changed(); await vi.advanceTimersByTimeAsync(15000); });
 expect(state.calls).toHaveLength(0);
 await act(async () => { visibility.mockReturnValue('visible'); document.dispatchEvent(new Event('visibilitychange')); });
 expect(state.calls.filter(c => c.command === 'sources')).toHaveLength(1);
});

it('polls only the known active job while visible, without repeating media or model discovery', async () => {
 vi.useFakeTimers();
 const job = { id: 'running-job', source: { path: 'speech.wav' }, state: 'running', totalChunks: 4, completedChunks: 2 };
 state.jobs = [job];
 const { transcriptRequest } = await import('./transcriptClient');
 const original = vi.mocked(transcriptRequest).getMockImplementation()!;
 vi.mocked(transcriptRequest).mockImplementation(async input => input.command === 'status' ? (state.calls.push(input), { job } as any) : original(input));
 try {
  await render(<TranscriptPanel />); state.calls = [];
  await act(async () => vi.advanceTimersByTimeAsync(2500));
  expect(state.calls).toEqual([{ command: 'status', projectId: 'project', jobId: job.id }]);
  await act(async () => useDockLayoutStore.setState({ visiblePanels: new Set(['timeline']) }));
  state.calls = [];
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(state.calls).toHaveLength(0);
 } finally { vi.mocked(transcriptRequest).mockImplementation(original); }
});
