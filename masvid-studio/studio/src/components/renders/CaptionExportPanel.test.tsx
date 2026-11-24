// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18n';
import { CaptionExportPanel } from './CaptionExportPanel';
const state = vi.hoisted(() => ({ projectId: 'p', activeCompPath: 'index.html', fail: false, empty: false, save: vi.fn<() => Promise<void>>(), request: vi.fn(), download: vi.fn() }));
vi.mock('../../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: state.projectId, activeCompPath: state.activeCompPath, waitForPendingDomEditSaves: state.save, writeBlockedReason: null }) }));
vi.mock('../../contexts/FileManagerContext', () => ({ useFileManagerContextOptional: () => ({ compositions: ['index.html', 'scenes/outro.html'] }) }));
vi.mock('../../motion/transcriptClient', () => ({ transcriptRequest: state.request, downloadTranscript: state.download }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const render = () => act(async () => root.render(<I18nProvider initialLocale="en"><CaptionExportPanel onClose={() => {}} /></I18nProvider>));
beforeEach(async () => {
  state.projectId = 'p'; state.activeCompPath = 'index.html'; state.fail = state.empty = false;
  state.save.mockReset().mockResolvedValue(); state.download.mockReset(); state.request.mockReset().mockImplementation(async input => {
    if (state.fail) throw new Error('Disconnected');
    return input.command === 'caption_tracks' ? { tracks: state.empty ? [] : [{ id: 'caption', kind: 'caption', label: 'Captions', cueCount: 2, settings: { visible: true } }] } : { content: 'saved subtitles', extension: input.format, mimeType: 'text/vtt' };
  });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; });
it('waits for saves, downloads once through the shared operation, and shows floating feedback', async () => {
  state.save.mockClear(); let finish!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => { button('Download SRT').click(); button('Download SRT').click(); });
  expect(state.save).toHaveBeenCalledOnce(); expect(state.download).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(state.request).toHaveBeenLastCalledWith({ command: 'caption_export', projectId: 'p', compositionPath: 'index.html', format: 'srt' });
  expect(state.download).toHaveBeenCalledOnce(); expect(state.download.mock.calls[0][1]).toBe('index-captions.srt');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Subtitle download started');
});
it('exports the chosen scene and VTT without changing the editor composition', async () => {
  await act(async () => button('Export scene').click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(el => el.textContent?.includes('scenes/outro'))!.click());
  await act(async () => document.querySelector<HTMLElement>('[role=radio][aria-label=VTT]')!.click());
  await act(async () => button('Download VTT').click());
  expect(state.request).toHaveBeenLastCalledWith({ command: 'caption_export', projectId: 'p', compositionPath: 'scenes/outro.html', format: 'vtt' });
  expect(state.activeCompPath).toBe('index.html');
});
it('does not download after switching projects during a save', async () => {
  let finish!: () => void; state.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  await act(async () => button('Download SRT').click()); state.projectId = 'q'; await render();
  await act(async () => finish()); expect(state.download).not.toHaveBeenCalled();
});
it('replaces failed loading with retry and blocks empty subtitle downloads', async () => {
  state.fail = true; state.projectId = 'failed'; await render(); expect(button('Download SRT').disabled).toBe(true);
  expect(document.body.textContent).toContain('Could not load captions');
  state.fail = false; state.empty = true; await act(async () => button('Retry').click());
  expect(button('Download SRT').disabled).toBe(true); expect(button('Add captions')).toBeTruthy();
});
