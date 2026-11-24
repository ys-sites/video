// @vitest-environment happy-dom
import { act, useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanupMounted, mountHost } from '../components/ui/mountHost.testHelpers';
import { addStudioPendingEditFlushListener, flushStudioPendingEdits, trackStudioPendingEdit } from '../utils/studioPendingEdits';
import { STUDIO_AUTOSAVE_INTERVAL_MS, useStudioAutosave } from './useStudioAutosave';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanupMounted(); vi.useRealTimers(); vi.restoreAllMocks(); });
function Probe({ blocked = false, projectId = 'autosave', flush }: { blocked?: boolean; projectId?: string; flush: () => Promise<void> }) {
  useStudioAutosave({ projectId, blocked, flush });
  return <input aria-label="Editing" />;
}
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(STUDIO_AUTOSAVE_INTERVAL_MS); });

it('flushes staged edits periodically without blurring the active field or rewriting clean work', async () => {
  let dirty = true;
  const write = vi.fn(async () => { dirty = false; });
  const remove = addStudioPendingEditFlushListener(() => dirty ? write() : undefined);
  try {
    mountHost(<Probe flush={async () => { await flushStudioPendingEdits({ blur: false }); }} />);
    const input = document.querySelector('input')!;
    input.focus();
    await tick();
    expect(write).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(input);
    await tick(); await tick();
    expect(write).toHaveBeenCalledOnce();
  } finally { remove(); }
});

it('joins no overlapping drain and stops timers after unmount', async () => {
  let finish!: () => void;
  const flush = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  mountHost(<Probe flush={flush} />);
  await tick(); await tick();
  expect(flush).toHaveBeenCalledOnce();
  await act(async () => finish());
  await tick();
  expect(flush).toHaveBeenCalledTimes(2);
  await act(async () => finish());
  cleanupMounted();
  await tick();
  expect(flush).toHaveBeenCalledTimes(2);
});

it('defers a live edit and skips blocked or background idle work', async () => {
  const flush = vi.fn(async () => {});
  let setBlocked!: (value: boolean) => void;
  function Host() {
    const [blocked, updateBlocked] = useState(false);
    setBlocked = updateBlocked;
    return <Probe blocked={blocked} flush={flush} />;
  }
  mountHost(<Host />);
  let finish!: () => void;
  trackStudioPendingEdit(new Promise<void>(resolve => { finish = resolve; }));
  await tick();
  expect(flush).not.toHaveBeenCalled();
  await act(async () => finish());
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(flush).toHaveBeenCalledOnce();
  await tick();
  expect(flush).toHaveBeenCalledOnce();
  visibility.mockReturnValue('visible');
  act(() => setBlocked(true));
  await tick();
  expect(flush).toHaveBeenCalledOnce();
});
