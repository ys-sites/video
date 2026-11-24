// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToast } from './useToast';
import { StudioToast } from '../components/StudioToast';
import { I18nProvider } from '../i18n/I18n';

let host: HTMLDivElement;
let root: Root;
let api: ReturnType<typeof useToast>;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function Harness() {
  api = useToast();
  return <>{api.toasts.map(toast => <StudioToast key={toast.id} {...toast} onDismiss={() => api.dismissToast(toast.id)} />)}</>;
}
beforeEach(() => { vi.useFakeTimers(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root.render(<Harness />)); });
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
it.each([
  ['"large.mp4" exceeds the size limit. Compress or replace the file.', '“large.mp4”超过大小限制，请压缩或更换文件。'],
  ['Cannot add "clip.mp4". Re-export or replace the file.', '无法添加“clip.mp4”，请重新导出或更换文件。'],
  ['Some changes were saved, but other changes remain incomplete.', '部分修改已保存，但仍有修改未完成。'],
  ['Frame capture timed out. Please capture again.', '截帧超时，请重新截取。'],
  ['Cannot add "ENOENT network error.mp4". Re-export or replace the file.', '无法添加“ENOENT network error.mp4”，请重新导出或更换文件。'],
])('renders approved copy through the error filter: %s', (message, expected) => {
  act(() => root.render(<I18nProvider initialLocale="zh-CN"><Harness /></I18nProvider>));
  act(() => api.showToast(message, 'error'));
  expect(host.querySelector('[role=alert]')?.textContent).toBe(expected);
});
it.each([
  ['info', undefined], ['error', undefined], ['info', 'feedback'], ['error', 'feedback'],
] as const)('expires actionless %s/%s notices after exactly 3 seconds', (tone, presentation) => {
  act(() => { api.showToast('Copied element', tone, presentation); });
  act(() => { vi.advanceTimersByTime(2999); });
  expect(api.toasts[0].leaving).toBeUndefined();
  act(() => { vi.advanceTimersByTime(1); });
  expect(api.toasts[0].leaving).toBe(true);
  act(() => { vi.advanceTimersByTime(160); });
  expect(api.toasts).toHaveLength(0);
});
it('allows early dismissal of an error without exposing raw diagnostics', () => {
  act(() => { api.showToast('Could not save /private/project/file.html', 'error'); });
  act(() => { vi.advanceTimersByTime(1000); });
  expect(api.toasts).toHaveLength(1);
  expect(host.textContent).not.toContain('/private/');
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Dismiss error"]')!;
  expect(close).not.toBeNull();
  act(() => close.click());
  act(() => { vi.advanceTimersByTime(160); });
  expect(api.toasts).toHaveLength(0);
});

it.each([
  ['info', undefined], ['error', undefined], ['info', 'feedback'], ['error', 'feedback'],
] as const)('keeps %s/%s notices with an action until explicitly dismissed', (tone, presentation) => {
  act(() => api.showToast('Action not completed. Please try again.', tone, presentation, { key: 'retry', label: 'Retry', onClick: vi.fn() }));
  act(() => vi.advanceTimersByTime(60000));
  expect(api.toasts).toHaveLength(1);
  expect(api.toasts[0].leaving).toBeUndefined();
  expect(host.querySelector('.hf-toast-action:not([aria-label])')?.textContent).toBe('Retry');
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Dismiss notification"]')!.click());
  act(() => vi.advanceTimersByTime(160));
  expect(api.toasts).toHaveLength(0);
});

it('announces brief failure feedback without actions and removes it after three seconds', () => {
  act(() => { api.showToast('Connection lost. Changes were not saved.', 'error', 'feedback'); });
  expect(host.querySelector('[role=alert]')?.textContent).toContain('Changes were not saved');
  expect(host.querySelector('button')).toBeNull();
  expect(host.querySelector('pre')).toBeNull();
  act(() => { vi.advanceTimersByTime(2999); });
  expect(api.toasts[0].leaving).toBeUndefined();
  act(() => { vi.advanceTimersByTime(161); });
  expect(api.toasts).toHaveLength(0);
});

it.each([undefined, 'feedback'] as const)('coalesces repeated %s errors and restarts their dismissal window', (presentation) => {
  act(() => { api.showToast('Connection lost. Changes were not saved.', 'error', presentation); });
  act(() => { vi.advanceTimersByTime(2000); });
  act(() => { api.showToast('Connection lost. Changes were not saved.', 'error', presentation); });
  expect(api.toasts).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(2000); });
  expect(api.toasts[0].leaving).toBeUndefined();
  act(() => { vi.advanceTimersByTime(1160); });
  expect(api.toasts).toHaveLength(0);
});

it('keeps independent undo notices reachable and prevents repeated action execution', async () => {
  let finish!: () => void;
  const undo = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  act(() => {
    api.showToast('Asset removed', 'info', undefined, { key: 'a', label: 'Undo A', onClick: undo });
    api.showToast('Asset removed', 'info', undefined, { key: 'b', label: 'Undo B', onClick: vi.fn() });
    vi.advanceTimersByTime(10000);
  });
  expect(api.toasts).toHaveLength(2);
  const action = host.querySelector<HTMLButtonElement>('.hf-toast-action')!;
  await act(async () => { action.click(); action.click(); });
  expect(undo).toHaveBeenCalledOnce(); expect(action.disabled).toBe(true);
  await act(async () => finish());
  act(() => vi.advanceTimersByTime(160));
  expect(api.toasts).toHaveLength(1); expect(host.textContent).toContain('Undo B');
});

it('shows one compact notice for repeated errors without diagnostic controls', () => {
  act(() => {
    api.showToast('InternalError: /private/example.html', 'error');
    api.showToast('InternalError: /private/example.html', 'error');
  });
  expect(api.toasts).toHaveLength(1);
  expect(host.querySelector('[role=alert]')?.textContent).toBe('Action not completed. Please try again.');
  expect(host.textContent).not.toContain('/private/');
  expect(host.querySelector('[aria-label="Error details"]')).toBeNull();
  expect(host.querySelectorAll('button')).toHaveLength(1);
  expect(host.querySelector('pre')).toBeNull();
  act(() => { vi.advanceTimersByTime(10000); });
  expect(api.toasts).toHaveLength(0);
});

it('expires action failure feedback while keeping the original action retryable', async () => {
  const retry = vi.fn().mockRejectedValueOnce(new Error('Could not save /private/project.html')).mockResolvedValueOnce(undefined);
  act(() => api.showToast('Action not completed. Please try again.', 'error', undefined, { key: 'retry', label: 'Retry', onClick: retry }));
  await act(async () => host.querySelector<HTMLButtonElement>('.hf-toast-action:not([aria-label])')!.click());
  expect(api.toasts).toHaveLength(2);
  expect(host.textContent).not.toContain('/private/');
  act(() => vi.advanceTimersByTime(3160));
  expect(api.toasts).toHaveLength(1);
  const action = host.querySelector<HTMLButtonElement>('.hf-toast-action:not([aria-label])')!;
  expect(action.disabled).toBe(false);
  await act(async () => action.click());
  act(() => vi.advanceTimersByTime(160));
  expect(retry).toHaveBeenCalledTimes(2);
  expect(api.toasts).toHaveLength(0);
});

it.each([
  ['Could not save: ENOENT /private/project.html', 'Required file not found.'],
  ['Could not save: EACCES /private/project.html', 'No permission to access this file.'],
  ['Could not save: Failed to fetch', 'Connection lost.'],
  ['The preview did not reload (timeout). It was still waiting for ready.', 'Preview update timed out.'],
  ['The preview did not reload (load failed).', 'Preview could not be updated.'],
  ['Failed to save position', 'Changes could not be saved.'],
  ['revision mismatch conflict', 'The project changed elsewhere.'],
  ['unsupported video codec', 'This file format is not supported.'],
])('shows a concise cause for %s', (raw, summary) => {
  act(() => api.showToast(raw, 'error'));
  expect(host.querySelector('[role=alert]')?.textContent).toBe(summary);
  expect(host.querySelector('[aria-label="Error details"]')).toBeNull();
  expect(host.innerHTML).not.toContain('/private/');
});
