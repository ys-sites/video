// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { FeedbackLayer } from './FeedbackLayer';
import { mountFeedbackLayer } from '../../../web/feedback-layer';
import { SettingsDialog } from '../motion/settingsPrimitives';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('escapes a clipping ancestor and retains interactive portal content', () => {
  const host = document.createElement('div'); document.body.append(host);
  host.style.overflow = 'hidden'; const root = createRoot(host); const dismiss = vi.fn();
  act(() => root.render(<FeedbackLayer><button onClick={dismiss}>Dismiss</button></FeedbackLayer>));
  expect(host.querySelector('button')).toBeNull();
  act(() => document.querySelector<HTMLButtonElement>('button')!.click());
  expect(dismiss).toHaveBeenCalledOnce();
  act(() => root.unmount());
  expect(document.querySelector('.motion-feedback-layer')).toBeNull();
});

it('follows nested modal open/close and restores the original feedback node on cleanup', async () => {
  const origin = document.createElement('div'); const feedback = document.createElement('div');
  origin.append(feedback); document.body.append(origin);
  const dialogs = [document.createElement('dialog'), document.createElement('dialog')];
  for (const dialog of dialogs) {
    document.body.append(dialog);
    const matches = dialog.matches.bind(dialog);
    vi.spyOn(dialog, 'matches').mockImplementation(selector => selector === ':modal' ? dialog.open : matches(selector));
  }
  const stop = mountFeedbackLayer(feedback);
  expect(feedback.parentElement).toBe(document.body);
  dialogs[0].open = true; await new Promise(resolve => setTimeout(resolve, 0));
  expect(feedback.parentElement).toBe(dialogs[0]);
  dialogs[1].open = true; await new Promise(resolve => setTimeout(resolve, 0));
  expect(feedback.parentElement).toBe(dialogs[1]);
  dialogs[1].open = false; await new Promise(resolve => setTimeout(resolve, 0));
  expect(feedback.parentElement).toBe(dialogs[0]);
  stop(); expect(feedback.parentElement).toBe(origin);
  dialogs[0].open = false; await new Promise(resolve => setTimeout(resolve, 0));
  expect(feedback.parentElement).toBe(origin);
});

it('keeps actions inside a shared modal focus boundary and returns them when it closes', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host), undo = vi.fn();
  const content = (modal: boolean) => <><FeedbackLayer><button onClick={undo}>Undo</button></FeedbackLayer>{modal && <SettingsDialog title="Choose an asset" onClose={() => {}}><button>Pick</button></SettingsDialog>}</>;
  await act(async () => root.render(content(false)));
  await act(async () => { root.render(content(true)); });
  const layer = document.querySelector<HTMLElement>('[data-feedback-layer]')!;
  expect(layer.closest('[role=dialog]')).not.toBeNull();
  expect(layer.closest('[aria-hidden=true], [inert], [data-base-ui-inert]')).toBeNull();
  await act(async () => layer.querySelector<HTMLButtonElement>('button')!.click());
  expect(undo).toHaveBeenCalledOnce();
  await act(async () => root.render(content(false)));
  expect(layer.parentElement).toBe(document.body);
  await act(async () => root.unmount());
});

it('follows fullscreen entry and exit without losing the interactive feedback node', () => {
  const origin = document.createElement('div'), feedback = document.createElement('button'), player = document.createElement('div');
  origin.append(feedback); document.body.append(origin, player);
  const original = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
  const stop = mountFeedbackLayer(feedback), dismiss = vi.fn();
  feedback.addEventListener('click', dismiss);
  try {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: player });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(feedback.parentElement).toBe(player);
    feedback.click(); expect(dismiss).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(feedback.parentElement).toBe(document.body);
  } finally {
    stop();
    if (original) Object.defineProperty(document, 'fullscreenElement', original);
    else Reflect.deleteProperty(document, 'fullscreenElement');
  }
  expect(feedback.parentElement).toBe(origin);
});
