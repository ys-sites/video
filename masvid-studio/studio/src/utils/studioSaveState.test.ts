import { afterEach, expect, it, vi } from 'vitest';
import { clearStudioSaveFailures, getStudioSaveSnapshot, observeStudioSavedAt, subscribeStudioSaves, trackStudioProjectSave } from './studioSaveState';
afterEach(() => vi.restoreAllMocks());

it('reports only confirmed writes and keeps simultaneous writes and projects independent', async () => {
  const id = 'concurrent-project';
  const changed = vi.fn();
  const unsubscribe = subscribeStudioSaves(changed);
  let finish!: () => void;
  const first = trackStudioProjectSave(id, 'index.html', () => new Promise<void>(resolve => { finish = resolve; }));
  expect(getStudioSaveSnapshot(id)).toEqual({ pending: 1, savedAt: null, failed: false });
  await trackStudioProjectSave(id, 'styles.css', async () => {});
  expect(getStudioSaveSnapshot(id).pending).toBe(1);
  expect(getStudioSaveSnapshot('unopened').savedAt).toBeNull();
  finish(); await first;
  expect(getStudioSaveSnapshot(id)).toMatchObject({ pending: 0, failed: false });
  expect(getStudioSaveSnapshot(id).savedAt).toBeGreaterThan(0);
  expect(changed).toHaveBeenCalledTimes(4);
  unsubscribe();
});

it('does not let an unrelated success or history refresh hide a failed save', async () => {
  const id = 'failed-project';
  observeStudioSavedAt(id, 100);
  await expect(trackStudioProjectSave(id, 'index.html', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  expect(getStudioSaveSnapshot(id)).toEqual({ pending: 0, savedAt: 100, failed: true });
  await trackStudioProjectSave(id, 'styles.css', async () => {});
  observeStudioSavedAt(id, 200);
  expect(getStudioSaveSnapshot(id).failed).toBe(true);
  await trackStudioProjectSave(id, 'index.html', async () => {});
  expect(getStudioSaveSnapshot(id).failed).toBe(false);
  await expect(trackStudioProjectSave(id, 'index.html', async () => { throw new Error('conflict'); })).rejects.toThrow('conflict');
  clearStudioSaveFailures(id);
  expect(getStudioSaveSnapshot(id).failed).toBe(false);
});
