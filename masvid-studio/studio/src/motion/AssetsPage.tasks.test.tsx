// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetsPage } from './AssetsPage';
import type { AssetComposer } from './AssetComposer';
import { assetRequest } from './assetClient';
import { gatewayRequest } from './gatewayClient';
import type { LibraryAsset } from '../../../shared/asset-library';
import type { GenerationJob } from '../../../shared/gateway';
import type { AssetChatSummary } from './assetTasks';

vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string, values?: { count: number }) => text.replace('{count}', String(values?.count)), formatDate: () => 'Nov 15' }) }));
vi.mock('./ResizablePane', () => ({ ResizablePane: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./assetClient', () => ({ assetRequest: vi.fn(), uploadLibraryAsset: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn() }));
vi.mock('./game/gameCatalog', async importOriginal => {
  const actual = await importOriginal<typeof import('./game/gameCatalog')>();
  return { ...actual, gameApi: { ...actual.gameApi, catalog: async () => ({ games: [] }) } };
});
vi.mock('./AssetComposer', () => ({ AssetComposer: (props: ComponentProps<typeof AssetComposer>) => {
  composer = props;
  return <aside data-testid="composer"><span>{props.mode}:{props.taskIds[props.mode]}</span>
    <button onClick={() => props.onCreated(submitted)}>Submit fixture task</button>
    <button onClick={props.onClose}>Close creator</button>
  </aside>;
} }));

const asset: LibraryAsset = { id: 'picture', name: 'Selected picture', modality: 'image', createdAt: 1, updatedAt: 2, currentVersionId: 'v2', versions: ['v1', 'v2'].map((id, index) => ({ id, createdAt: index + 1, source: 'upload', filename: id + '.png', mimeType: 'image/png', bytes: 1024, sha256: id, references: [] })) };
function job(id = 'edit', updatedAt = 20, state: GenerationJob['state'] = 'running'): GenerationJob {
  return { id, state, modality: 'image', prompt: 'Add a warm glow', model: { id: 'codex:image', provider: 'codex', modelId: 'image', label: 'Codex Image', modality: 'image', source: 'builtin', mode: 'text-to-image' }, parameters: { quality: 'high' }, requestHash: '', createdAt: 10, updatedAt, assets: [], library: { assetId: asset.id, parentVersionId: 'v1', references: [{ assetId: asset.id, versionId: 'v1' }] } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
let root: Root, container: HTMLDivElement, composer: ComponentProps<typeof AssetComposer>, submitted: GenerationJob;
let jobs: GenerationJob[], chats: AssetChatSummary[], offline: boolean;
let delayedJobs: ReturnType<typeof deferred<{ jobs: GenerationJob[] }>> | undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); jobs = []; chats = []; offline = false; delayedJobs = undefined; submitted = job();
  vi.mocked(assetRequest).mockImplementation(async args => {
    if (args.action === 'jobs') {
      if (delayedJobs) { const pending = delayedJobs; delayedJobs = undefined; return pending.promise; }
      if (offline) throw new Error('offline');
      return { jobs: structuredClone(jobs) };
    }
    if (args.action === 'list') return { assets: [structuredClone(asset)], total: 1, nextOffset: null };
    if (args.action === 'get') return { asset: structuredClone(asset) };
    if (args.action === 'retry_save') return { job: { ...structuredClone(jobs.find(job => job.id === args.jobId)!), state: 'queued', phase: 'saving', updatedAt: 50 } };
    throw new Error(`Unexpected action ${args.action}`);
  });
  vi.mocked(gatewayRequest).mockImplementation(async () => ({ conversations: structuredClone(chats) }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function render() { await act(async () => root.render(<AssetsPage active />)); await flush(); }
async function click(name: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === name || node.getAttribute('aria-label') === name);
  expect(button, name).toBeDefined(); await act(async () => button!.click()); await flush();
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(2500); }); await flush(); }
const trigger = () => container.querySelector<HTMLButtonElement>('[aria-label="View tasks"]')!;
const preview = () => container.querySelector('.om-asset-viewer img')?.getAttribute('src');
async function selectTask(title: string) {
  await click('View tasks');
  const row = [...document.querySelectorAll<HTMLButtonElement>('.om-task-item')].find(node => node.textContent?.includes(title));
  expect(row).toBeDefined(); await act(async () => row!.click()); await flush();
}

it('keeps a submitted task visible after closing the editor and resumes it beside the exact selected version', async () => {
  await render(); await click('Selected picture');
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.om-asset-version')[1].click());
  expect(preview()).toContain('/versions/v1/');
  await click('Edit as new version'); await click('Submit fixture task'); await click('Close creator');
  expect(container.querySelector('[data-testid=composer]')).toBeNull();
  expect(trigger().textContent).toContain('1 in progress');
  expect(trigger().closest('.om-asset-workspace-header')).not.toBeNull();
  await selectTask('Add a warm glow');
  expect(preview()).toContain('/versions/v1/');
  expect(composer.taskIds.direct).toBe('edit');
  expect(composer.draft).toMatchObject({ model: 'codex:image', parameters: { quality: 'high' }, target: { versionId: 'v1' }, references: [{ reference: { assetId: 'picture', versionId: 'v1' } }] });
  expect(vi.mocked(assetRequest).mock.calls.some(([args]) => args.action === 'generate')).toBe(false);
});

it('loads persisted Agent approvals before opening a creator and resumes the exact conversation', async () => {
  chats = [{ id: 'chat-1', title: 'Polish the poster', state: 'waiting', updatedAt: 30 }];
  jobs = [job('child', 20)]; jobs[0].library!.conversationId = 'chat-1';
  await render();
  expect(trigger().textContent).toContain('1 awaiting approval');
  await click('Selected picture'); await selectTask('Polish the poster');
  expect(composer.mode).toBe('agent'); expect(composer.taskIds.agent).toBe('chat-1');
  expect(preview()).toContain('/versions/v2/');
  await click('Close creator');
  expect(trigger().dataset.state).toBe('waiting');
  chats = [{ ...chats[0], state: 'idle', updatedAt: 40 }]; await tick();
  expect(trigger().textContent).toContain('1 in progress');
  await act(async () => composer.onChatChanged({ ...chats[0], state: 'waiting', updatedAt: 30 }));
  expect(trigger().textContent).toContain('1 in progress');
});

it('updates task state without refreshing the asset list until new output arrives', async () => {
  jobs = [job()]; await render(); await click('Selected picture');
  const lists = () => vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list').length;
  const initialLists = lists();
  jobs = [{ ...job('edit', 30), phase: 'saving' }]; await tick();
  expect(lists()).toBe(initialLists);
  jobs = [{ ...job('edit', 40, 'completed'), libraryAssets: [{ assetId: 'picture', versionId: 'v2' }] }]; await tick();
  expect(trigger().dataset.state).toBe('idle'); expect(trigger().textContent).toContain('1');
  expect(lists()).toBe(initialLists + 1);
  await click('View tasks'); expect(document.querySelector('.om-task-item')?.textContent).toContain('completed');
});

it('retains known tasks through polling failure and recovers from the dropdown', async () => {
  jobs = [job()]; await render(); await click('Selected picture');
  offline = true; await tick();
  expect(trigger().textContent).toContain('Task status unavailable');
  await click('View tasks'); expect(document.querySelectorAll('.om-task-item')).toHaveLength(1);
  offline = false; jobs = [job('edit', 40, 'failed')]; await click('Retry');
  expect(trigger().dataset.state).toBe('idle');
  expect(document.querySelector('.om-task-item')?.textContent).toContain('failed');
});

it('does not lose a new submission when an older empty poll resolves after the creator closes', async () => {
  await render(); await click('Selected picture'); await click('Edit as new version');
  const pending = deferred<{ jobs: GenerationJob[] }>(); delayedJobs = pending; await tick();
  await click('Submit fixture task'); await click('Close creator');
  await act(async () => pending.resolve({ jobs: [] })); await flush();
  expect(trigger().textContent).toContain('1 in progress');
  await selectTask('Add a warm glow'); expect(composer.taskIds.direct).toBe('edit');
});

it('opens a recoverable project task and retries local saving through the shared asset operation', async () => {
  jobs = [{ ...job('project-save', 40, 'failed'), library: undefined, projectId: 'project', saveToLibrary: true, savePending: true }];
  await render(); await selectTask('Add a warm glow');
  expect(composer.taskIds.direct).toBe('project-save');
  await act(async () => composer.onRetrySave!(jobs[0]));
  expect(vi.mocked(assetRequest).mock.calls.some(([args]) => args.action === 'retry_save' && args.jobId === 'project-save' && args.requestId === 'save-project-save')).toBe(true);
  expect(composer.jobs.find(job => job.id === 'project-save')?.state).toBe('queued');
  expect(vi.mocked(assetRequest).mock.calls.some(([args]) => args.action === 'generate')).toBe(false);
});
