// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ModelEditor } from './ModelEditor';
import { TranscriptEditor } from './TranscriptEditor';
import { TranscriptWorkflowBrief } from './TranscriptWorkflowBrief';
import { usePlayerStore } from '../player/store/playerStore';
import { recordingWav } from './recordingWav';
import { useTranscriptRecorder } from './useTranscriptRecorder';
import type { TranscriptDocument } from '../../../shared/transcript';

const state = vi.hoisted(() => ({ projectId: 'project', composition: 'index.html' as string | null, clips: [] as any[], toast: vi.fn(), wait: vi.fn<() => Promise<void>>(), refresh: vi.fn(), calls: [] as any[] }));
vi.mock('../contexts/StudioContext', () => ({ useStudioPlaybackContext: () => ({ timelineElements: state.clips }), useStudioShellContext: () => ({ projectId: state.projectId, activeCompPath: state.composition, showToast: state.toast, waitForPendingDomEditSaves: state.wait, writeBlockedReason: null, renderQueue: { isRendering: false } }) }));
vi.mock('../contexts/FileManagerContext', () => ({ useFileManagerContext: () => ({ refreshFileTree: state.refresh }) }));
vi.mock('./useIntegrationInfo', () => ({ useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/workspace', transport: { env: { SECRET: 'never-copy' } } }, failed: false, retry: vi.fn() }) }));
vi.mock('./transcriptClient', () => ({ transcriptRequest: vi.fn(async input => { state.calls.push(input); return { document: { ...doc, revision: 2, segments: input.segments ?? doc.segments } }; }), downloadTranscript: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn(async () => ({ revision: 'snapshot', currentVersionId: 'version' })) }));
const doc: TranscriptDocument = { id: 'doc', source: { projectId: 'project', path: 'voice.wav', sha256: 'hash', bytes: 10, duration: 3 }, revision: 1, createdAt: 1, updatedAt: 1, segments: [{ id: 'first', text: 'Original words', start: 0, end: 1, words: [{ text: 'Original', start: 0, end: 0.5 }] }], original: [{ id: 'first', text: 'Original words', start: 0, end: 1 }] };
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === text || node.getAttribute('aria-label') === text)!;
const render = async (element: React.ReactNode) => act(async () => root.render(<I18nProvider initialLocale="en">{element}</I18nProvider>));
async function type(selector: string, text: string) { const input = document.querySelector(selector) as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
beforeEach(() => { doc.id = crypto.randomUUID(); state.projectId = 'project'; state.composition = 'index.html'; state.clips = []; usePlayerStore.setState({ selectedElementId: null }); state.calls = []; state.wait.mockReset().mockResolvedValue(); state.toast.mockReset(); const host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('correction uses the original revision, drops obsolete word alignment and blocks unsaved caption adoption', async () => {
  const saved = vi.fn(), dirty = vi.fn();
  await render(<TranscriptEditor document={doc} busy={false} setDocument={saved} onDirty={dirty} refresh={state.refresh} />);
  await act(async () => button('Edit text').click());
  await type('textarea[aria-label="Segment text"]', 'Corrected words');
  expect(button('Add captions to video').disabled).toBe(true); expect(dirty).toHaveBeenLastCalledWith(true);
  await act(async () => button('Save transcript').click());
  const input = state.calls[0]; expect(input.command).toBe('update'); expect(input.expectedTranscriptRevision).toBe(1); expect(input.segments[0].text).toBe('Corrected words'); expect(input.segments[0].words).toBeUndefined(); expect(input.requestId).toBeTruthy();
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }));
});

it('caption adoption waits for saves and refuses a composition switch', async () => {
  let finish!: () => void; state.wait.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const element = <TranscriptEditor document={doc} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />;
  await render(element); await act(async () => button('Add captions to video').click()); expect(state.calls).toHaveLength(0);
  state.composition = 'other.html'; await render(<TranscriptEditor document={doc} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  await act(async () => finish()); expect(state.calls).toHaveLength(0); expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('composition changed'), 'error');
});

it('workflow handoff carries exact source identity, language/platform choices, safe MCP steps and clipboard recovery', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard denied'));
  await render(<TranscriptWorkflowBrief projectId="project" sourcePaths={['voice.wav']} transcript={doc} />);
  await act(async () => button('English').click());
  await act(async () => button('日本語').click());
  await act(async () => button('Bilibili').click());
  await act(async () => button('More options').click());
  await type('textarea[aria-label="Source links or search brief"]', 'https://youtube.com/watch?v=fixture');
  await act(async () => button('Copy production brief').click());
  const text = (document.querySelector('[aria-label="Complete workflow instruction"]') as HTMLTextAreaElement).value;
  expect(text).toContain('Source projectId: project'); expect(text).toContain(`Selected transcriptId: ${doc.id}`); expect(text).toContain('English, Japanese'); expect(text).toContain('https://youtube.com/watch?v=fixture');
  expect(text).toContain('Bilibili (16:9, 1920×1080)'); expect(text).toContain('YouTube Shorts (9:16, 1080×1920)');
  expect(text).toContain('expectedTranscriptRevision'); expect(text).toContain('openmotion_export_request'); expect(text).not.toContain('never-copy');
  expect(state.toast).toHaveBeenCalledWith(expect.stringContaining('manually'), 'error');
});

it('workflow defaults need no typing and keep source language until translations are chosen', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await render(<TranscriptWorkflowBrief projectId="project" sourcePaths={['voice.wav']} transcript={doc} />);
  expect(button('Source language').getAttribute('aria-pressed')).toBe('true');
  expect(button('YouTube Shorts').getAttribute('aria-pressed')).toBe('true');
  expect(document.querySelector('[aria-label="Source links or search brief"]')).toBeNull();
  await act(async () => button('Copy production brief').click());
  expect(copy).toHaveBeenLastCalledWith(expect.stringContaining('Subtitle languages requested: Keep the source language.'));
  expect(copy.mock.calls[0][0]).toContain('Select up to three self-contained highlights');
  await act(async () => button('English').click());
  expect(button('Source language').getAttribute('aria-pressed')).toBe('false');
  await act(async () => button('English').click());
  expect(button('Source language').getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('YouTube Shorts').click());
  expect(button('Copy production brief').disabled).toBe(true);
  expect(document.querySelector('[role="status"]')?.textContent).toBe('Choose at least one platform');
});

it('workflow custom choices and full-video goal reach the brief, with an explicit source-language reset', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await render(<TranscriptWorkflowBrief projectId="project" sourcePaths={[]} transcript={null} />);
  await act(async () => button('Adapt the full video').click());
  await act(async () => button('More options').click());
  await act(async () => button('YouTube Shorts').click());
  await type('input[aria-label="Other platforms"]', 'Conference screen, 16:9');
  await type('input[aria-label="Other subtitle languages"]', 'Deutsch');
  expect(button('Source language').getAttribute('aria-pressed')).toBe('false');
  await act(async () => button('Copy production brief').click());
  expect(copy.mock.calls[0][0]).toContain('Keep the complete story');
  expect(copy.mock.calls[0][0]).toContain('Platforms requested: Conference screen, 16:9');
  expect(copy.mock.calls[0][0]).toContain('Subtitle languages requested: Deutsch');
  await act(async () => button('Source language').click());
  expect((document.querySelector('[aria-label="Other subtitle languages"]') as HTMLInputElement).value).toBe('');
});

it('workflow waits for pending saves once and discards stale clipboard recovery after a choice changes', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  let finish!: () => void; state.wait.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(<TranscriptWorkflowBrief projectId="project" sourcePaths={['voice.wav']} transcript={doc} />);
  await act(async () => { button('Copy production brief').click(); button('Copy production brief').click(); });
  expect(copy).not.toHaveBeenCalled(); expect(state.wait).toHaveBeenCalledOnce();
  expect(button('English').disabled).toBe(true);
  await act(async () => finish());
  expect(copy).toHaveBeenCalledOnce();
  expect(document.querySelector('[aria-label="Complete workflow instruction"]')).not.toBeNull();
  await render(<TranscriptWorkflowBrief projectId="project" sourcePaths={['voice.wav']} transcript={doc} />);
  expect(document.querySelector('[aria-label="Complete workflow instruction"]')).not.toBeNull();
  await act(async () => button('日本語').click());
  expect(document.querySelector('[aria-label="Complete workflow instruction"]')).toBeNull();
});

it('microphone permission denial and late permission after unmount release capture resources', async () => {
  const errors = vi.fn(); let recording: ReturnType<typeof useTranscriptRecorder>;
  function Harness() { recording = useTranscriptRecorder(errors); return <div>{recording.state}</div>; }
  const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('Denied'), { name: 'NotAllowedError' }));
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  vi.stubGlobal('MediaRecorder', class {});
  await render(<Harness />); await act(async () => recording!.start()); expect(errors).toHaveBeenCalledWith(expect.stringContaining('permission was denied'));
  let finish!: (value: any) => void; getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { void recording!.start(); }); await render(null);
  const stop = vi.fn(); await act(async () => finish({ getTracks: () => [{ stop }] })); expect(stop).toHaveBeenCalledOnce();
});

it('drafts survive project unmounts and keep the revision they were based on', async () => {
  await render(<TranscriptEditor document={doc} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  await act(async () => button('Edit text').click());
  await type('textarea[aria-label="Segment text"]', 'Retained draft'); await render(null);
  await render(<TranscriptEditor document={{ ...doc, revision: 2 }} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  await act(async () => button('Edit text').click());
  expect((document.querySelector('[aria-label="Segment text"]') as HTMLTextAreaElement).value).toBe('Retained draft');
  await act(async () => button('Save transcript').click()); expect(state.calls[0].expectedTranscriptRevision).toBe(1);
});

it('root caption placement maps the selected matching source with trim and playback speed', async () => {
  state.composition = null;
  state.clips = [{ id: 'clip', tag: 'audio', src: 'voice.wav', sourceFile: 'index.html', start: 5, duration: 0.5, playbackStart: 1, playbackRate: 2 }];
  usePlayerStore.setState({ selectedElementId: 'clip' });
  await render(<TranscriptEditor document={doc} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  await act(async () => button('Use selected media clip').click());
  await act(async () => button('Add captions to video').click());
  expect(state.calls[0]).toMatchObject({ command: 'captions', compositionPath: 'index.html', timelineStart: 5, sourceStart: 1, sourceEnd: 2, playbackRate: 2 });
  await act(async () => document.querySelector<HTMLButtonElement>('[role=checkbox]')!.click());
  await act(async () => button('Download captions').click());
  expect(state.calls[1]).toMatchObject({ command: 'export', format: 'srt', timelineStart: 5, sourceStart: 1, sourceEnd: 2, playbackRate: 2 });
});

it('recordings normalize browser containers into bounded mono PCM WAV', async () => {
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData() { return Promise.resolve({ length: 2, duration: 0.000125, sampleRate: 16000, numberOfChannels: 2, getChannelData: () => new Float32Array([1, -1]) }); } });
  const blob = await recordingWav(new Blob(['encoded'])); const view = new DataView(await blob.arrayBuffer());
  expect(blob.type).toBe('audio/wav'); expect(view.getUint16(22, true)).toBe(1); expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getInt16(44, true)).toBe(32767); expect(view.getInt16(46, true)).toBe(-32768);
});

it('a cancelled microphone request releases a late stream without starting a recorder', async () => {
  let finish!: (value: any) => void; const stop = vi.fn(), errors = vi.fn(); let recording: ReturnType<typeof useTranscriptRecorder>;
  function Harness() { recording = useTranscriptRecorder(errors, 'cancelled'); return null; }
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: () => new Promise(resolve => { finish = resolve; }) }, configurable: true });
  const recorder = vi.fn(); vi.stubGlobal('MediaRecorder', recorder);
  await render(<Harness />); await act(async () => { void recording!.start(); }); await act(async () => recording!.stop());
  await act(async () => finish({ getTracks: () => [{ stop }] }));
  expect(stop).toHaveBeenCalledOnce(); expect(recorder).not.toHaveBeenCalled(); expect(recording!.state).toBe('idle');
});

it('custom compatible models expose transcription response controls and save the executable kind', async () => {
  const save = vi.fn().mockResolvedValue(true);
  await render(<ModelEditor provider={{ id: 'custom', protocol: 'openai' } as any} save={save} onClose={vi.fn()} onError={state.toast} />);
  await type('[aria-label="Model ID"]', 'my-whisper'); await act(async () => button('More settings').click());
  await act(async () => button('Transcription').click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Transcription response"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(node => node.textContent?.includes('Timed segments and words'))!.click());
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'my-whisper', kind: 'transcription', defaults: { response_format: 'verbose_json' } }));
});

it('reading views locate speech without altering the saved transcript', async () => {
  await render(<TranscriptEditor document={doc} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  expect(document.querySelector('textarea[aria-label="Segment text"]')).toBeNull();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Transcript view"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(n => n.textContent?.includes('Paragraph view'))!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label^="Go to speech"]')!.click());
  expect(state.calls).toHaveLength(0); expect(button('Save transcript').disabled).toBe(true);
  await act(async () => button('Edit text').click()); expect(document.querySelector('textarea[aria-label="Segment text"]')).not.toBeNull();
});


it('pause markers seek a real gap without editing text or source footage', async () => {
  const spaced: TranscriptDocument = { ...doc, segments: [...doc.segments, { id: 'second', text: 'Next sentence', start: 2, end: 3 }] };
  await render(<TranscriptEditor document={spaced} busy={false} setDocument={vi.fn()} onDirty={vi.fn()} refresh={state.refresh} />);
  expect(button('Pause: 1.0s')).toBeUndefined();
  await act(async () => button('Show pauses').click());
  await act(async () => button('Pause: 1.0s').click());
  expect(document.querySelector('audio')?.currentTime).toBe(1);
  expect(state.calls).toHaveLength(0);
  await act(async () => button('Edit text').click());
  await type('textarea[aria-label="Segment text"]', 'Draft correction');
  expect(button('Caption styles').disabled).toBe(true);
  expect(button('Import SRT / VTT').disabled).toBe(true);
});
