// @vitest-environment happy-dom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToast } from '../hooks/useToast';
import { I18nProvider } from '../i18n/I18n';
import { StudioToastViewport } from './StudioToastViewport';
import { StudioConnectionToast } from './StudioConnectionToast';
import { SettingsDialog } from '../motion/settingsPrimitives';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const owners: Record<string, ReturnType<typeof useToast>> = {};
function Owner({ name }: { name: string }) {
  const toast = useToast(); owners[name] = toast;
  return <StudioToastViewport {...toast} />;
}
function render({ first = true, reconnecting = true, modal = false } = {}) {
  root.render(<StrictMode><I18nProvider initialLocale="zh-CN">
    {first && <Owner name="first" />}
    <Owner name="second" />
    <StudioConnectionToast reconnecting={reconnecting} />
    {modal && <SettingsDialog title="Test dialog" onClose={() => {}}><button>Dialog action</button></SettingsDialog>}
  </I18nProvider></StrictMode>);
}
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => render());
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); });
const connectionNotice = () => [...document.querySelectorAll('[role=status]')].find(node => node.textContent === '连接已断开，正在重连');

it('expires errors and connection feedback while keeping actions in the shared stack', () => {
  act(() => {
    owners.first.showToast('Some changes were saved, but other changes remain incomplete.');
    owners.second.showToast('Asset removed', 'info', undefined, { key: 'undo', label: 'Undo', onClick: vi.fn() });
  });
  const stack = document.querySelector('.hf-toast-viewport')!;
  expect(document.querySelectorAll('.hf-toast-viewport')).toHaveLength(1);
  expect(stack.children).toHaveLength(3);
  expect(stack.textContent).toContain('部分修改已保存');
  expect(stack.textContent).toContain('Undo');
  expect(connectionNotice()?.querySelector('button')).toBeNull();
  act(() => vi.advanceTimersByTime(2999));
  expect(connectionNotice()).toBeDefined();
  // Unrelated renders during the same outage do not renew the timer.
  act(() => render());
  act(() => vi.advanceTimersByTime(1));
  expect(connectionNotice()?.classList.contains('hf-toast-exit')).toBe(true);
  act(() => vi.advanceTimersByTime(160));
  expect(connectionNotice()).toBeUndefined();
  expect(stack.children).toHaveLength(1);
  expect(stack.textContent).toContain('Undo');
  act(() => render());
  act(() => vi.advanceTimersByTime(10000));
  expect(connectionNotice()).toBeUndefined();
  expect(stack.children).toHaveLength(1);
});

it('clears connection feedback on recovery and gives each new outage its own timer', () => {
  act(() => vi.advanceTimersByTime(1000));
  act(() => render({ reconnecting: false }));
  expect(connectionNotice()).toBeUndefined();
  act(() => render({ reconnecting: true }));
  expect(connectionNotice()).toBeDefined();
  act(() => vi.advanceTimersByTime(2999));
  expect(connectionNotice()?.classList.contains('hf-toast-exit')).toBe(false);
  act(() => vi.advanceTimersByTime(161));
  expect(connectionNotice()).toBeUndefined();
  expect(document.querySelector('.motion-feedback-layer')).toBeNull();
});

it('retains each action target and other owners when a source unmounts', async () => {
  const undoFirst = vi.fn(), undoSecond = vi.fn();
  act(() => {
    owners.first.showToast('Asset removed', 'info', undefined, { key: 'same-local-key', label: 'Undo first', onClick: undoFirst });
    owners.second.showToast('Asset removed', 'info', undefined, { key: 'same-local-key', label: 'Undo second', onClick: undoSecond });
  });
  expect(document.querySelectorAll('.hf-toast-action:not([aria-label])')).toHaveLength(2);
  act(() => render({ first: false }));
  const action = document.querySelector<HTMLButtonElement>('.hf-toast-action:not([aria-label])')!;
  expect(action.textContent).toBe('Undo second');
  await act(async () => { action.click(); action.click(); });
  expect(undoFirst).not.toHaveBeenCalled(); expect(undoSecond).toHaveBeenCalledOnce();
  act(() => vi.advanceTimersByTime(160));
  expect(document.querySelectorAll('.hf-toast-viewport')).toHaveLength(1);
  expect(connectionNotice()).toBeDefined();
  act(() => render({ first: false, reconnecting: false }));
  expect(document.querySelector('.motion-feedback-layer')).toBeNull();
});

it('coalesces a repeated owner notice but does not drop unrelated results on recovery', () => {
  act(() => {
    owners.first.showToast('Copied!', 'info');
    owners.first.showToast('Copied!', 'info');
    owners.second.showToast('Some changes were saved, but other changes remain incomplete.');
    render({ reconnecting: false });
  });
  expect(document.querySelector('.hf-toast-viewport')?.children).toHaveLength(2);
  act(() => vi.advanceTimersByTime(3160));
  expect(document.querySelector('.motion-feedback-layer')).toBeNull();
});

it('keeps the shared stack and its actions inside the active dialog boundary', async () => {
  vi.useRealTimers();
  const undo = vi.fn();
  await act(async () => owners.first.showToast('Asset removed', 'info', undefined, { key: 'a', label: 'Undo', onClick: undo }));
  await act(async () => render({ modal: true }));
  const layer = document.querySelector('[data-feedback-layer]')!;
  expect(document.querySelectorAll('[data-feedback-layer]')).toHaveLength(1);
  expect(layer.closest('[role=dialog]')).not.toBeNull();
  expect(layer.closest('[aria-hidden=true], [inert], [data-base-ui-inert]')).toBeNull();
  await act(async () => layer.querySelector<HTMLButtonElement>('.hf-toast-action')!.click());
  expect(undo).toHaveBeenCalledOnce();
  await act(async () => render({ modal: false }));
  expect(layer.parentElement).toBe(document.body);
});
