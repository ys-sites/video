// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GenerationJob } from '../../../shared/gateway';
import { AssetGenerationCard } from './AssetCreationVisuals';
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => text }) }));
let root: Root, container: HTMLDivElement;
const cancel = vi.fn(), view = vi.fn();
const initial: GenerationJob = { id: 'job-1', state: 'queued', phase: 'queued', modality: 'image', prompt: 'A forest at dawn', model: { id: 'codex:image', provider: 'codex', modelId: 'image', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image' }, parameters: {}, requestHash: '', createdAt: 1, updatedAt: 1, assets: [] };
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(job: GenerationJob) { await act(async () => root.render(<AssetGenerationCard job={job} onCancel={cancel} onView={view} />)); }
it('follows service phases and exposes cancellation only until a terminal state', async () => {
  await render(initial);
  expect(container.textContent).toContain('Your idea is in the queue');
  expect(container.querySelector('[data-current="true"]')?.textContent).toContain('Submitted');
  const running = { ...initial, state: 'running' as const, phase: 'generating' };
  await render(running);
  expect(container.querySelector('[data-current="true"]')?.textContent).toContain('Creating');
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(cancel).toHaveBeenCalledWith(running);
  await render({ ...running, phase: 'downloading' });
  expect(container.textContent).toContain('Bringing your asset home');
  expect(container.querySelector('[data-current="true"]')?.textContent).toContain('Saved to assets');
  await render({ ...running, state: 'cancelled' });
  expect(container.textContent).toContain('Generation stopped');
  expect(container.querySelector('button')).toBeNull();
  expect(container.querySelector('[data-working="true"]')).toBeNull();
});
it('opens the exact completed result and recovers from an unavailable thumbnail', async () => {
  const job = { ...initial, state: 'completed' as const, libraryAssets: [{ assetId: 'asset-1', versionId: 'version-2' }] };
  await render(job);
  const preview = container.querySelector('img')!;
  expect(preview.getAttribute('src')).toContain('/assets/asset-1/versions/version-2/file');
  await act(async () => preview.dispatchEvent(new Event('error')));
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toContain('View asset');
  await act(async () => container.querySelector<HTMLButtonElement>('button')!.click());
  expect(view).toHaveBeenCalledWith(job);
  await render({ ...job, libraryAssets: [{ assetId: 'asset-1', versionId: 'version-3' }] });
  expect(container.querySelector('img')?.getAttribute('src')).toContain('/versions/version-3/file');
});
it('shows a provider failure without a success result or automatic retry', async () => {
  await render({ ...initial, state: 'failed', error: 'Provider timed out' });
  expect(container.textContent).toContain('Provider timed out');
  expect(container.querySelector('[data-working="true"]')).toBeNull();
  expect(container.textContent).not.toContain('Saved to your asset library');
  expect(container.querySelector('button')).toBeNull();
  expect(cancel).not.toHaveBeenCalled(); expect(view).not.toHaveBeenCalled();
});
it('distinguishes missing proxy credentials from general Codex authorization failures', async () => {
  await render({ ...initial, state: 'failed', error: 'CODEX_IMAGE_PROXY_AUTH_REQUIRED: upstream detail' });
  expect(container.textContent).toContain('select the configured proxy provider');
  expect(container.textContent).toContain('Signing in again alone will not fix a missing proxy key');
  expect(container.textContent).not.toContain('upstream detail');
  await render({ ...initial, state: 'failed', error: 'CODEX_IMAGE_AUTH_REQUIRED: upstream detail' });
  expect(container.textContent).toContain('Check the active provider, endpoint and authentication');
  expect(container.textContent).not.toContain('proxy key');
  await render({ ...initial, state: 'failed', error: 'ASSET_MEDIA_RUNTIME_NOT_READY: ffprobe is unavailable' });
  expect(container.textContent).toContain('No model request was made');
  expect(container.textContent).not.toContain('ffprobe');
  expect(container.querySelector('button')).toBeNull();
  expect(cancel).not.toHaveBeenCalled(); expect(view).not.toHaveBeenCalled();
});

it('retries only saving retained outputs, disables duplicate clicks and can inspect partial results', async () => {
  let complete!: () => void;
  const retrySave = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const job = { ...initial, state: 'failed' as const, phase: 'save_failed', savePending: true, error: 'Disk unavailable', libraryAssets: [{ assetId: 'asset', versionId: 'version' }] };
  await act(async () => root.render(<AssetGenerationCard job={job} onCancel={cancel} onView={view} onRetrySave={retrySave} />));
  expect(container.textContent).toContain('Saving needs attention');
  expect(container.textContent).toContain('Generated files are kept locally');
  const retry = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry saving')!;
  await act(async () => retry.click());
  expect(retry.disabled).toBe(true); expect(retrySave).toHaveBeenCalledExactlyOnceWith(job);
  await act(async () => retry.click()); expect(retrySave).toHaveBeenCalledTimes(1);
  await act(async () => complete()); expect(retry.disabled).toBe(false);
  expect(container.textContent).toContain('View asset'); expect(cancel).not.toHaveBeenCalled();
});

it('removes save recovery for unavailable retained files and explains that nothing was regenerated', async () => {
  const retrySave = vi.fn();
  const job = { ...initial, state: 'failed' as const, phase: 'save_unavailable', savePending: false, error: 'SAVE_NOT_AVAILABLE: retained data missing' };
  await act(async () => root.render(<AssetGenerationCard job={job} onCancel={cancel} onView={view} onRetrySave={retrySave} />));
  expect(container.textContent).toContain('Saving cannot be retried');
  expect(container.textContent).toContain('No new generation was requested');
  expect(container.textContent).not.toContain('Retry saving'); expect(container.textContent).not.toContain('SAVE_NOT_AVAILABLE');
  expect(retrySave).not.toHaveBeenCalled();
});

it('checks an eligible original Cloud task once and shows reconnection without new generation', async () => {
  let complete!: () => void;
  const resume = vi.fn(() => new Promise<void>(resolve => { complete = resolve; }));
  const job: GenerationJob = { ...initial, model: { ...initial.model, provider: 'opendesign' }, state: 'failed', remoteId: 'original-task' };
  await act(async () => root.render(<AssetGenerationCard job={job} onCancel={cancel} onView={view} onResume={resume} />));
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === 'Check original task')!;
  await act(async () => { button.click(); button.click(); });
  expect(resume).toHaveBeenCalledExactlyOnceWith(job); expect(button.disabled).toBe(true);
  await act(async () => complete()); expect(button.disabled).toBe(false);
  for (const patch of [{ state: 'cancelled' as const }, { state: 'running' as const }, { state: 'completed' as const }, { savePending: true }, { remoteTerminal: true }, { remoteId: undefined }, { remoteId: '../bad' }, { model: initial.model }]) {
    await act(async () => root.render(<AssetGenerationCard job={{ ...job, ...patch }} onCancel={cancel} onView={view} onResume={resume} />));
    expect(container.textContent).not.toContain('Check original task');
  }
  await render({ ...job, state: 'running', phase: 'reconnecting' });
  expect(container.textContent).toContain('Reconnecting…');
  expect(cancel).not.toHaveBeenCalled();
});

it('continues the original account image download with progress and guards duplicate clicks', async () => {
  let finish!: () => void;
  const resume = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const job: GenerationJob = { ...initial, prompt: 'original prompt', model: { ...initial.model, provider: 'account' }, modality: 'image', state: 'failed', remoteId: 'original-task',
    download: { assetId: 'original-image', receivedBytes: 1048576, totalBytes: 4194304 } };
  await act(async () => root.render(<AssetGenerationCard job={job} onCancel={cancel} onView={view} onResume={resume} />));
  expect(container.textContent).toContain('original prompt'); expect(container.textContent).toContain('1.0 / 4.0 MB');
  expect(container.textContent).toContain('Draft changes apply only to your next generation.');
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === 'Continue download')!;
  await act(async () => { button.click(); button.click(); });
  expect(resume).toHaveBeenCalledExactlyOnceWith(job); expect(button.disabled).toBe(true);
  await act(async () => finish()); expect(button.disabled).toBe(false);
  await act(async () => root.render(<AssetGenerationCard job={{ ...job, remoteTerminal: true }} onCancel={cancel} onView={view} onResume={resume} />));
  expect(container.textContent).not.toContain('Continue download');
});
