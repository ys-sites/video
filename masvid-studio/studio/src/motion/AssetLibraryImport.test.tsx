// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetsTab } from '../components/sidebar/AssetsTab';
import { useFileTree } from '../hooks/useFileTree';
import { assetRequest } from './assetClient';
import type { LibraryAsset } from '../../../shared/asset-library';

const { waitForSaves } = vi.hoisted(() => ({ waitForSaves: vi.fn() }));
vi.mock('./WorkspaceChromeContext', () => ({ useOptionalWorkspaceChrome: () => ({ beforeViewChange: waitForSaves, switchingDisabled: false }) }));
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string, values?: { count: number }) => text.replace('{count}', String(values?.count)) }) }));
vi.mock('./assetClient', () => ({ assetRequest: vi.fn() }));
vi.mock('../components/feedback/projectProvenance', () => ({ captureProjectProvenance: vi.fn() }));
vi.mock('../utils/studioTelemetry', () => ({ trackStudioEvent: vi.fn() }));

const imported = 'assets/imported/pinned-image.png';
const original = ['assets/original.png', 'assets/music.mp3'];
const asset: LibraryAsset = { id: 'image', name: 'Library image', modality: 'image', currentVersionId: 'v2', createdAt: 1, updatedAt: 2, versions: ['v1', 'v2'].map(id => ({ id, createdAt: 1, source: 'upload', filename: `${id}.png`, mimeType: 'image/png', bytes: 100, sha256: id, references: [] })) };
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function Harness({ projectId = 'project-a' }: { projectId?: string }) {
  const projectIdRef = useRef(projectId); projectIdRef.current = projectId;
  const { assets, refreshFileTree } = useFileTree({ projectId, projectIdRef });
  return <AssetsTab projectId={projectId} assets={assets} onImport={vi.fn()} onLibraryImport={refreshFileTree} />;
}
let root: Root, container: HTMLDivElement;
let files: string[], treeFailure: boolean;
let pendingImport: ReturnType<typeof deferred<void>> | undefined;
let pendingTree: ReturnType<typeof deferred<void>> | undefined;
const calls = () => vi.mocked(assetRequest).mock.calls.map(([args]) => args).filter(args => args.action === 'import_to_project');
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent === label || el.getAttribute('aria-label') === label)!;
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function click(label: string) { await act(async () => button(label).click()); await flush(); }
async function render(projectId = 'project-a') { await act(async () => root.render(<Harness projectId={projectId} />)); await flush(); }
async function choose() {
  await click('Import media');
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent === 'Import from asset library')!.click());
  await flush(); await click('Library image');
}
const listing = () => container.querySelector('[data-assets-list]')!;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); waitForSaves.mockResolvedValue(undefined);
  files = [...original]; treeFailure = false; pendingImport = undefined; pendingTree = undefined;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (String(url).endsWith('manifest.jsonl')) return new Response('', { status: 404 });
    if (String(url) === '/api/projects/project-b') return Response.json({ files: ['assets/other.png'], compositions: [] });
    if (treeFailure) throw new Error('Offline');
    if (pendingTree) await pendingTree.promise;
    return Response.json({ files: [...files], compositions: [] });
  });
  vi.mocked(assetRequest).mockImplementation(async args => {
    if (args.action === 'list') return { assets: [asset], total: 1, nextOffset: null };
    if (args.action === 'import_to_project') {
      if (pendingImport) await pendingImport.promise;
      files = [...original, imported];
      return { projectId: args.projectId, status: 'completed', items: [{ itemId: `library-${args.assetId}-${args.versionId}`, status: 'completed', path: imported }] };
    }
    throw new Error(`Unexpected action: ${args.action}`);
  });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('refreshes My assets, clears hiding filters and reveals the pinned import without reloading the page', async () => {
  await render(); await click('Audio 1');
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Search assets"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'music');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(listing().textContent).not.toContain('original.png');
  await choose();
  await click('Version'); await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes('V1'))!.click());
  await click('Import selected version');
  expect(calls()).toEqual([expect.objectContaining({ projectId: 'project-a', assetId: 'image', versionId: 'v1', requestId: expect.any(String) })]);
  expect(document.querySelector('.om-settings-dialog')).toBeNull();
  expect(input.value).toBe('');
  expect(listing().textContent).toContain('pinned-image.png');
  expect(listing().textContent!.indexOf('pinned-image.png')).toBeLessThan(listing().textContent!.indexOf('original.png'));
  expect(document.querySelector('[role="status"]')?.textContent).toContain('Asset imported.');
});

it('keeps the dialog busy until the refreshed listing arrives and prevents duplicate imports', async () => {
  await render(); await choose();
  pendingImport = deferred<void>();
  await act(async () => { button('Import selected version').click(); button('Import selected version').click(); });
  expect(calls()).toHaveLength(1); expect(button('Importing…').disabled).toBe(true);
  pendingTree = deferred<void>();
  await act(async () => pendingImport!.resolve()); await flush();
  expect(document.querySelector('.om-settings-dialog')).not.toBeNull();
  expect(document.querySelector('[role="status"]')).toBeNull();
  await act(async () => pendingTree!.resolve()); await flush();
  expect(listing().textContent).toContain('pinned-image.png');
  expect(document.querySelector('.om-settings-dialog')).toBeNull();
});

it('retries a failed list refresh without copying the asset again or showing premature success', async () => {
  await render(); await choose(); treeFailure = true;
  await click('Import selected version');
  expect(document.querySelector('.om-settings-dialog')).not.toBeNull();
  expect(document.body.textContent).toContain('My assets could not refresh');
  expect(listing().textContent).not.toContain('pinned-image.png');
  treeFailure = false;
  await click('Import selected version');
  expect(calls()).toHaveLength(1);
  expect(listing().textContent).toContain('pinned-image.png');
});

it('reuses the request identity when retrying an unknown transport outcome', async () => {
  await render(); await choose(); pendingImport = deferred<void>();
  await click('Import selected version');
  await act(async () => pendingImport!.reject(new Error('Failed to fetch'))); await flush();
  expect(document.body.textContent).toContain('Connection lost.');
  pendingImport = undefined; await click('Import selected version');
  expect(calls()).toHaveLength(2);
  expect(calls()[1].requestId).toBe(calls()[0].requestId);
  expect(listing().textContent).toContain('pinned-image.png');
});

it('keeps a definite import failure retryable with a fresh request', async () => {
  await render(); await choose();
  vi.mocked(assetRequest).mockResolvedValueOnce({ projectId: 'project-a', status: 'failed', items: [{ itemId: 'library-image-v2', status: 'failed', error: 'Import failed' }] });
  await click('Import selected version');
  expect(document.body.textContent).toContain('Import failed');
  expect(document.querySelector('.om-settings-dialog')).not.toBeNull();
  await click('Import selected version');
  expect(calls()[1].requestId).not.toBe(calls()[0].requestId);
  expect(listing().textContent).toContain('pinned-image.png');
});

it('does not start an import if the project changes while pending editor saves finish', async () => {
  await render(); await choose(); const saving = deferred<void>(); waitForSaves.mockReturnValueOnce(saving.promise);
  await click('Import selected version'); await render('project-b');
  await act(async () => saving.resolve()); await flush();
  expect(calls()).toHaveLength(0);
  expect(listing().textContent).toContain('other.png');
});

it('does not apply a late import result or success notification to another project', async () => {
  await render(); await choose(); pendingImport = deferred<void>();
  await click('Import selected version'); await render('project-b');
  await act(async () => pendingImport!.resolve()); await flush();
  expect(calls()[0].projectId).toBe('project-a');
  expect(listing().textContent).toContain('other.png');
  expect(listing().textContent).not.toContain('pinned-image.png');
  expect(document.querySelector('[role="status"]')).toBeNull();
});
