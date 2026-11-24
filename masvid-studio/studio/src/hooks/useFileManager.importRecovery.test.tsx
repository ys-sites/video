// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useFileManager } from './useFileManager';
import { FileManagerProvider } from '../contexts/FileManagerContext';
import { AssetsTab } from '../components/sidebar/AssetsTab';

const { ioOperations, assetImportResults } = vi.hoisted(() => ({ ioOperations: [] as { action: string; properties?: Record<string, unknown>; finish: ReturnType<typeof vi.fn> }[], assetImportResults: vi.fn() }));
vi.mock('../motion/editorTracking', async original => ({ ...await original<Record<string, unknown>>(), reportAssetImport: assetImportResults }));
vi.mock('../telemetry/ioRecovery', () => ({ beginStudioIo: (action: string, properties?: Record<string, unknown>) => {
  const finish = vi.fn();
  ioOperations.push({ action, properties, finish });
  return finish;
} }));
vi.mock('../components/feedback/projectProvenance', () => ({ captureProjectProvenance: vi.fn() }));
vi.mock('../utils/studioTelemetry', () => ({ trackStudioEvent: vi.fn() }));
vi.mock('./useEditorSave', () => ({ useEditorSave: () => ({ saveRafRef: { current: null }, handleContentChange: vi.fn() }) }));
vi.mock('../components/sidebar/AudioRow', () => ({ AudioRow: ({ asset }: { asset: string }) => <div data-asset>{asset}</div> }));
vi.mock('../components/sidebar/AssetCard', () => ({
  AssetCard: ({ asset }: { asset: string }) => <div data-asset>{asset}</div>,
  FontRow: ({ asset }: { asset: string }) => <div data-asset>{asset}</div>,
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement, manager: ReturnType<typeof useFileManager>;
let files: Record<string, string[]>, treeFailed: boolean;
let upload: (url: string, init: RequestInit) => Promise<Response>;
let fetchMock: ReturnType<typeof vi.fn>;
const showToast = vi.fn(), recordEdit = vi.fn(async () => {}), setRefreshKey = vi.fn();
function Harness({ projectId }: { projectId: string }) {
  manager = useFileManager({ projectId, showToast, recordEdit, setRefreshKey });
  return <FileManagerProvider value={manager}><AssetsTab projectId={projectId} assets={manager.assets} onImport={async selected => { await manager.handleImportFiles(selected, 'assets'); }} /></FileManagerProvider>;
}
async function render(projectId = 'a') { await act(async () => root.render(<Harness projectId={projectId} />)); }
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label)!;
async function click(label: string) { await act(async () => button(label).click()); }
async function importFiles(selected: File[], entryPoint?: 'assets_button' | 'assets_drop' | 'timeline_button') { await act(async () => { await manager.handleImportFiles(selected, 'assets', entryPoint); }); }
function selectReplacement(name: string, file: File) {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="Choose replacement for ${name}"]`)!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}
const uploadCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
const namesInUpload = (index: number) => [...(uploadCalls()[index][1].body as FormData).values()].map(value => (value as File).name);
beforeEach(() => {
  vi.clearAllMocks(); ioOperations.length = 0; files = { a: [], b: ['assets/project-b.png'] }; treeFailed = false;
  upload = async () => Response.json({ files: [], invalid: [], skipped: [] }, { status: 201 });
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return upload(url, init);
    if (url.endsWith('manifest.jsonl')) return new Response('', { status: 404 });
    if (treeFailed) throw new TypeError('listing offline');
    const project = decodeURIComponent(url.split('/')[3]);
    return Response.json({ files: files[project], compositions: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('retains two successes and explicitly uploads only the reselected failed file, then reveals an imported asset', async () => {
  let attempt = 0;
  upload = async () => {
    attempt++;
    if (attempt === 1) {
      files.a = ['assets/good.png', 'assets/song.mp3'];
      return Response.json({ files: files.a, invalid: [{ name: 'broken.mp4', reason: 'ffprobe failed to read the media file' }], skipped: [] });
    }
    files.a.push('assets/fixed.mp4');
    return Response.json({ files: ['assets/fixed.mp4'], invalid: [], skipped: [] });
  };
  await render();
  await importFiles([new File(['x'], 'good.png'), new File(['x'], 'song.mp3'), new File(['bad'], 'broken.mp4')], 'assets_button');
  expect(host.textContent).toContain('Imported 2/3 files');
  expect(host.textContent).toContain('Not added to the timeline.');
  expect(host.textContent).toContain('Cannot read this media file.');
  expect(uploadCalls()).toHaveLength(1);
  expect(showToast).not.toHaveBeenCalled();
  selectReplacement('broken.mp4', new File(['fixed'], 'fixed.mp4'));
  expect(uploadCalls()).toHaveLength(1);
  await click('Import selected replacements');
  expect(namesInUpload(1)).toEqual(['fixed.mp4']);
  expect(files.a).toEqual(['assets/good.png', 'assets/song.mp3', 'assets/fixed.mp4']);
  expect(ioOperations.map(operation => operation.action)).toEqual(['import_files', 'replace_failed_import']);
  expect(ioOperations[0].properties).toEqual({ requested_count: 3 });
  expect(ioOperations[0].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'partial', requested_count: 3, added_count: 2, failed_count: 1, unknown_count: 0, pending_count: 0, listing_status: 'ready' });
  expect(ioOperations[1].properties).toEqual({ requested_count: 1 });
  expect(assetImportResults.mock.calls.map(([event]) => event)).toEqual([
    { projectId: 'a', entryPoint: 'assets_button', requested: 3, added: 2, failed: 1, unknown: 0, pending: 0, category: 'unreadable' },
    { projectId: 'a', entryPoint: 'assets_button', requested: 1, added: 1, failed: 0, unknown: 0, pending: 0 },
  ]);
  expect(ioOperations[1].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', requested_count: 1, added_count: 1, failed_count: 0, unknown_count: 0, pending_count: 0, listing_status: 'ready' });
  expect(host.textContent).toContain('Imported 3/3 files');
  expect(showToast).not.toHaveBeenCalled();
  await click('View imported assets');
  expect(host.querySelector('[data-assets-list]')?.textContent).toContain('good.png');
});

it('keeps a lost upload response unknown after checking the listing and never offers a file retry', async () => {
  upload = async () => { files.a = ['assets/clip.mp4']; throw new TypeError('response lost'); };
  await render(); await importFiles([new File(['x'], 'clip.mp4')], 'assets_drop');
  expect(assetImportResults).toHaveBeenCalledExactlyOnceWith({ projectId: 'a', entryPoint: 'assets_drop', requested: 1, added: 0, failed: 0, unknown: 1, pending: 0 });
  expect(host.textContent).toContain('Result unknown');
  expect(host.querySelector('input[aria-label^="Choose replacement"]')).toBeNull();
  await click('Check project assets');
  expect(uploadCalls()).toHaveLength(1);
  expect(host.textContent).toContain('Result unknown');
  expect(host.querySelector('[data-assets-list]')?.textContent).toContain('clip.mp4');
  expect(ioOperations[0].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'unknown', requested_count: 1, added_count: 0, failed_count: 0, unknown_count: 1, pending_count: 0, listing_status: 'ready' });
  expect(ioOperations[1].action).toBe('refresh_import_list');
  expect(ioOperations[1].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', listing_status: 'ready' });
  expect(JSON.stringify(ioOperations.map(({ action, properties, finish }) => ({ action, properties, results: finish.mock.calls })))).not.toContain('clip.mp4');
});

it('retains upload success when listing refresh fails and reloads without another upload', async () => {
  upload = async () => { files.a = ['assets/good.png']; treeFailed = true; return Response.json({ files: files.a }); };
  await render(); await importFiles([new File(['x'], 'good.png')]);
  expect(host.textContent).toContain('Imported 1/1 files');
  expect(host.textContent).toContain('Files were imported, but the asset list could not reload.');
  treeFailed = false;
  await click('Reload assets');
  expect(uploadCalls()).toHaveLength(1);
  expect(host.querySelector('[data-assets-list]')?.textContent).toContain('good.png');
  expect(host.textContent).not.toContain('Files were imported, but the asset list could not reload.');
  expect(ioOperations[0].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', requested_count: 1, added_count: 1, failed_count: 0, unknown_count: 0, pending_count: 0, listing_status: 'failed' });
  expect(assetImportResults).toHaveBeenCalledExactlyOnceWith({ projectId: 'a', entryPoint: undefined, requested: 1, added: 1, failed: 0, unknown: 0, pending: 0 });
  expect(ioOperations[1].action).toBe('refresh_import_list');
  expect(ioOperations[1].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', listing_status: 'ready' });
});

it('does not move a delayed import result or recovery action to another project', async () => {
  let resolve!: (response: Response) => void;
  upload = () => new Promise<Response>(done => { resolve = done; });
  await render();
  let pending!: Promise<string[]>;
  await act(async () => { pending = manager.handleImportFiles([new File(['x'], 'good.png')], 'assets'); });
  await render('b');
  await act(async () => { resolve(Response.json({ files: ['assets/good.png'] })); await pending; });
  expect(host.querySelector('[aria-label="This upload"]')).toBeNull();
  expect(host.querySelector('[data-assets-list]')?.textContent).toContain('project-b.png');
  expect(fetchMock.mock.calls.filter(([url]) => url === '/api/projects/b')).toHaveLength(1);
  expect(uploadCalls()[0][0]).toContain('/projects/a/upload');
});

it('keeps a file access refusal local and requires a fresh selection before uploading it', async () => {
  await render();
  const unreadable = new File(['x'], 'detached.mp4');
  Object.defineProperty(unreadable, 'slice', { value: () => ({ arrayBuffer: async () => { throw new DOMException('Access revoked', 'NotReadableError'); } }) });
  await importFiles([unreadable]);
  expect(uploadCalls()).toHaveLength(0);
  expect(host.textContent).toContain('Cannot access this file. Choose it again.');
  expect(button('Import selected replacements')).toBeUndefined();
  selectReplacement('detached.mp4', new File(['x'], 'available.mp4'));
  upload = async () => { files.a = ['assets/available.mp4']; return Response.json({ files: files.a }); };
  await click('Import selected replacements');
  expect(namesInUpload(0)).toEqual(['available.mp4']);
  expect(host.textContent).toContain('Imported 1/1 files');
});

it('explains an empty rejected file and keeps a payload-limit rejection safe to reselect', async () => {
  await render();
  upload = async () => Response.json({ files: [], invalid: [{ name: 'empty.mp4', reason: 'ffprobe failed to read the media file' }] });
  await importFiles([new File([], 'empty.mp4')]);
  expect(host.textContent).toContain('This file is empty. Choose a file with content.');
  upload = async () => Response.json({ error: 'payload too large' }, { status: 413 });
  await importFiles([new File(['large'], 'large.mp4')]);
  expect(host.textContent).toContain('Upload rejected: payload too large. Choose smaller files.');
  expect(host.querySelector('input[aria-label="Choose replacement for large.mp4"]')).not.toBeNull();
});

it('preserves manual native-runtime preparation and only resubmits it on explicit retry', async () => {
  upload = async () => Response.json({ code: 'NATIVE_RUNTIME_NOT_READY', applied: false }, { status: 409 });
  await render(); await importFiles([new File(['x'], 'clip.mp4')], 'timeline_button');
  expect(manager.pendingImport?.files[0].name).toBe('clip.mp4');
  expect(host.querySelector('input[aria-label^="Choose replacement"]')).toBeNull();
  expect(uploadCalls()).toHaveLength(1);
  expect(assetImportResults).toHaveBeenNthCalledWith(1, { projectId: 'a', entryPoint: 'timeline_button', requested: 1, added: 0, failed: 0, unknown: 0, pending: 1, category: 'runtime_not_ready' });
  upload = async () => { files.a = ['assets/clip.mp4']; return Response.json({ files: files.a }); };
  await click('Retry import');
  expect(uploadCalls()).toHaveLength(2);
  expect(manager.pendingImport).toBeNull();
  expect(host.textContent).toContain('Imported 1/1 files');
  expect(assetImportResults).toHaveBeenNthCalledWith(2, { projectId: 'a', entryPoint: 'timeline_button', requested: 1, added: 1, failed: 0, unknown: 0, pending: 0 });
});

it('keeps an ambiguous renamed rejection unknown instead of retrying the wrong original file', async () => {
  files.a = ['assets/clip.mp4'];
  upload = async () => Response.json({ files: ['assets/clip (3).mp4'], invalid: [{ name: 'clip (2).mp4', reason: 'ffprobe failed to read the media file' }] });
  await render(); await importFiles([new File(['bad'], 'clip.mp4'), new File(['x'], 'clip (2).mp4')]);
  expect(host.textContent).toContain('Result unknown');
  expect(host.querySelector('input[aria-label^="Choose replacement"]')).toBeNull();
  await click('Check project assets');
  expect(uploadCalls()).toHaveLength(1);
});

it('keeps prior successes and the latest file name when a selected replacement fails again', async () => {
  let attempt = 0;
  upload = async () => {
    attempt++;
    if (attempt === 1) {
      files.a = ['assets/good.png', 'assets/song.mp3'];
      return Response.json({ files: files.a, invalid: [{ name: 'broken.mp4', reason: 'ffprobe failed to read the media file' }] });
    }
    return Response.json({ files: [], invalid: [{ name: 'still-broken.mp4', reason: 'no supported video stream found' }] });
  };
  await render(); await importFiles([new File(['x'], 'good.png'), new File(['x'], 'song.mp3'), new File(['x'], 'broken.mp4')]);
  selectReplacement('broken.mp4', new File(['x'], 'still-broken.mp4'));
  await click('Import selected replacements');
  expect(namesInUpload(1)).toEqual(['still-broken.mp4']);
  expect(host.textContent).toContain('Imported 2/3 files');
  expect(host.textContent).toContain('No playable video found.');
  expect(host.querySelector('input[aria-label="Choose replacement for still-broken.mp4"]')).not.toBeNull();
  expect(manager.importBatch?.paths).toEqual(['assets/good.png', 'assets/song.mp3']);
});

it('removes the native retry action if its explicit retry loses the upload response', async () => {
  upload = async () => Response.json({ code: 'NATIVE_RUNTIME_NOT_READY' }, { status: 409 });
  await render(); await importFiles([new File(['x'], 'clip.mp4')]);
  upload = async () => { files.a = ['assets/clip.mp4']; throw new TypeError('response lost'); };
  await click('Retry import');
  expect(manager.pendingImport).toBeNull();
  expect(button('Retry import')).toBeUndefined();
  expect(host.textContent).toContain('Result unknown');
  await click('Check project assets');
  expect(uploadCalls()).toHaveLength(2);
});

it('does not count an import click ignored by the in-flight guard', async () => {
  let resolve!: (response: Response) => void;
  upload = () => new Promise<Response>(done => { resolve = done; });
  await render();
  let pending!: Promise<string[]>;
  await act(async () => {
    pending = manager.handleImportFiles([new File(['x'], 'first.mp4')], 'assets');
    await manager.handleImportFiles([new File(['x'], 'duplicate.mp4')], 'assets');
  });
  expect(ioOperations).toHaveLength(1);
  expect(uploadCalls()).toHaveLength(1);
  await act(async () => { files.a = ['assets/first.mp4']; resolve(Response.json({ files: files.a })); await pending; });
  expect(ioOperations[0].finish).toHaveBeenCalledTimes(1);
});

it('does not count or request an ignored duplicate list refresh', async () => {
  upload = async () => { throw new TypeError('response lost'); };
  await render(); await importFiles([new File(['x'], 'clip.mp4')]);
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  let pending!: Promise<void>;
  await act(async () => {
    const batchId = manager.importBatch!.id;
    pending = manager.reloadImportAssets(batchId);
    await manager.reloadImportAssets(batchId);
  });
  expect(ioOperations.map(operation => operation.action)).toEqual(['import_files', 'refresh_import_list']);
  await act(async () => { resolve(Response.json({ files: [] })); await pending; });
  expect(ioOperations[1].finish).toHaveBeenCalledExactlyOnceWith({ outcome: 'success', listing_status: 'ready' });
  expect(uploadCalls()).toHaveLength(1);
});


it('keeps skipped, invalid and unchecked manual results in the batch card without duplicate generic Toasts', async () => {
  upload = async () => {
    files.a = ['assets/unchecked.mp4'];
    return Response.json({ files: files.a,
      skipped: ['skipped.mp4'], invalid: [{ name: 'broken.mp4', reason: 'no supported video stream found' }],
      unchecked: [{ name: 'unchecked.mp4', reason: 'not checked: ffprobe was not found. Install FFmpeg or set HYPERFRAMES_FFPROBE_PATH.' }],
    });
  };
  await render(); await importFiles([new File(['x'], 'unchecked.mp4'), new File(['x'], 'skipped.mp4'), new File(['x'], 'broken.mp4')]);
  expect(host.textContent).toContain('Imported 1/3 files');
  expect(host.textContent).toContain('The server did not add this file. Check its size or choose another file.');
  expect(host.textContent).toContain('No playable video found.');
  expect(host.textContent).toContain('Media checking is unavailable.');
  expect(showToast).not.toHaveBeenCalled();
});


it('preserves the entry point and unknown counts for uploads outside the manual batch card', async () => {
  upload = async () => { throw new TypeError('reply lost'); };
  await render();
  await act(async () => { await manager.uploadProjectFiles([new File(['x'], 'clip.mp4')], 'assets', 'timeline_button'); });
  expect(manager.importBatch).toBeNull();
  expect(assetImportResults).toHaveBeenCalledExactlyOnceWith({ projectId: 'a', entryPoint: 'timeline_button', requested: 1, added: 0, failed: 0, unknown: 1, pending: 0 });
  expect(uploadCalls()).toHaveLength(1);
});
