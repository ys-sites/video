// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetsPage } from './AssetsPage';
import type { AssetDraft } from './AssetComposer';
import { assetRequest, uploadLibraryAsset } from './assetClient';
import { AssetUploadError } from './assetUploadError';
import type { LibraryAsset } from '../../../shared/asset-library';
import type { GameCard } from '../../../shared/game-contract';
import { gameApi } from './game/gameCatalog';

vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string, values?: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (match, key) => String(values?.[key] ?? match)), formatDate: () => 'Nov 15' }) }));
vi.mock('./ResizablePane', () => ({ ResizablePane: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
let lastComposerOnCreated: ((job: import('../../../shared/gateway').GenerationJob) => void) | undefined;
let lastShowCurrentJob: boolean | undefined;
let lastComposerOnUploadFiles: ((files: File[]) => void) | undefined;
let lastComposerUploadingReferences: boolean | undefined;
vi.mock('./AssetComposer', () => ({ AssetComposer: ({ draft, onReference, onUploadFiles, uploadingReferences, onCreated, showCurrentJob }: { draft: AssetDraft; onReference: () => void; onUploadFiles?: (files: File[]) => void; uploadingReferences?: boolean; onCreated: (job: import('../../../shared/gateway').GenerationJob) => void; showCurrentJob?: boolean }) => { lastComposerOnCreated = onCreated; lastShowCurrentJob = showCurrentJob; lastComposerOnUploadFiles = onUploadFiles; lastComposerUploadingReferences = uploadingReferences; return <><input aria-label="Creation draft" data-reference-count={draft.references.length} /><button onClick={onReference}>References</button></>; } }));
vi.mock('./AssetTaskHistory', () => ({ AssetTaskMenu: () => null }));
vi.mock('./assetClient', () => ({ assetRequest: vi.fn(), uploadLibraryAsset: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: async () => ({ conversations: [] }) }));
vi.mock('./game/gameCatalog', async importOriginal => {
  const actual = await importOriginal<typeof import('./game/gameCatalog')>();
  return { ...actual, gameApi: { ...actual.gameApi, catalog: vi.fn(async () => ({ games: [] })) } };
});

function game(id: string, changes: Partial<GameCard> = {}): GameCard {
  return { id, title: `Game ${id}`, description: '', genre: 'shooter', style: null, setting: null, multiplayer: false, maxPlayers: 1, status: 'published', cover: null, playUrl: `/api/games/${id}/play/index.html`,
    plays: 0, likes: 0, dislikes: 0, reaction: 0, favorite: false, source: 'mine', remixOf: null, controls: '', createdAt: '2026-11-20T00:00:00.000Z', updatedAt: '2026-11-20T00:00:00.000Z', ...changes };
}

function fixture(id: string): LibraryAsset {
  return { id, name: `Picture ${id}`, modality: 'image', createdAt: 1, updatedAt: 1, currentVersionId: `${id}-v1`, versions: [{ id: `${id}-v1`, createdAt: 1, source: 'upload', filename: `${id}.png`, mimeType: 'image/png', bytes: 1024, sha256: id, references: [] }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let root: Root, container: HTMLDivElement, records: Map<string, LibraryAsset>;
let pendingWrite: ReturnType<typeof deferred<void>> | undefined;
let pendingRead: ReturnType<typeof deferred<{ asset: LibraryAsset }>> | undefined;
let pendingList: ReturnType<typeof deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>> | undefined;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); pendingWrite = undefined; pendingRead = undefined; pendingList = undefined;
  records = new Map(['A', 'B'].map(id => [id, fixture(id)]));
  vi.mocked(assetRequest).mockImplementation(async args => {
    if (args.action === 'jobs') return { jobs: [] };
    if (args.action === 'list') {
      if (pendingList) { const current = pendingList; pendingList = undefined; return current.promise; }
      const assets = [...records.values()].filter(asset => Boolean(asset.trashedAt) === Boolean(args.trash) && (!args.modality || asset.modality === args.modality));
      return { assets: structuredClone(assets), total: assets.length, nextOffset: null };
    }
    if (args.action === 'get') {
      if (pendingRead) { const current = pendingRead; pendingRead = undefined; return current.promise; }
      return { asset: structuredClone(records.get(String(args.assetId))!) };
    }
    if (args.action === 'update') {
      if (pendingWrite) { const current = pendingWrite; pendingWrite = undefined; await current.promise; }
      const asset = structuredClone(records.get(String(args.assetId))!);
      const changes = args.changes as { trashed?: boolean };
      if (changes.trashed) asset.trashedAt = 10;
      if (changes.trashed === false) delete asset.trashedAt;
      asset.updatedAt++;
      records.set(asset.id, asset);
      return { asset: structuredClone(asset) };
    }
    throw new Error(`Unexpected action ${args.action}`);
  });
  vi.mocked(gameApi.catalog).mockResolvedValue({ games: [] });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function flush() { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); }
async function render(active = true) { await act(async () => root.render(<AssetsPage active={active} />)); await flush(); }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text || node.getAttribute('aria-label') === text)!;
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
const previewName = () => container.querySelector('.om-asset-workspace-header strong')?.textContent;
const updates = () => vi.mocked(assetRequest).mock.calls.map(([args]) => args).filter(args => args.action === 'update');

async function uploadBatch(count: number) {
  const input = container.querySelector<HTMLInputElement>('input[type=file][multiple]')!;
  const files = Array.from({ length: count }, (_, i) => new File(['data'], `file-${i}.png`));
  Object.defineProperty(input, 'files', { configurable: true, value: files });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await flush();
}
it('summarizes four failures and one success once and displays the successful asset in the library', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockRejectedValue(new AssetUploadError('rejected', 'size'))
    .mockImplementationOnce(async () => { const asset = fixture('uploaded'); records.set(asset.id, asset); return asset; });
  await uploadBatch(5);
  const notices = document.querySelectorAll('[role=alert], [role=status]');
  expect(notices).toHaveLength(1);
  expect(notices[0].textContent).toBe('Uploaded 1, not uploaded 4. Known issue: files exceed the size limit. Compress or replace those files.');
  expect(container.querySelector('[aria-label="Picture uploaded"]')).not.toBeNull();
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledTimes(5);
  expect([...notices[0].querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Dismiss error']);
  await act(async () => vi.advanceTimersByTimeAsync(2999));
  expect(document.querySelector('[role=alert]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(161));
  expect(document.querySelector('[role=alert]')).toBeNull();
  expect(container.querySelector('[aria-label="Picture uploaded"]')).not.toBeNull();
});
it('combines only observed causes and keeps unknown results out of the failure count', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockRejectedValueOnce(new AssetUploadError('rejected', 'unreadable'))
    .mockRejectedValueOnce(new AssetUploadError('rejected', 'unsupported'))
    .mockRejectedValueOnce(new AssetUploadError('unknown'));
  await uploadBatch(3);
  const text = document.querySelector('[role=alert]')?.textContent;
  expect(text).toBe('Uploaded 0, not uploaded 2, awaiting confirmation 1. Known issues: unreadable files and unsupported formats. Re-export, convert or replace those files. Supported image formats: PNG, JPG/JPEG, WebP, GIF and AVIF. Check the asset library before uploading unconfirmed files again.');
  expect(text).not.toContain('oversized');
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledTimes(3);
});
it('refreshes the library after an unconfirmed response without resubmitting or inventing success', async () => {
  await render();
  vi.mocked(uploadLibraryAsset).mockImplementationOnce(async () => { records.set('uncertain', fixture('uncertain')); throw new AssetUploadError('unknown'); });
  await uploadBatch(1);
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Uploaded 0, awaiting confirmation 1. Check the asset library before uploading unconfirmed files again.');
  expect(container.querySelector('[aria-label="Picture uncertain"]')).not.toBeNull();
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledOnce();
});

it('shows supported image formats for a refused new version and preserves the original', async () => {
  await render(); await click('Picture A');
  vi.mocked(uploadLibraryAsset).mockRejectedValueOnce(new AssetUploadError('rejected', 'unsupported'));
  const input = [...container.querySelectorAll<HTMLInputElement>('input[type=file][accept="image/*"]:not([multiple])')].at(-1)!;
  // No filename or MIME hint: the selected image supplies the upload context.
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['unsupported'], 'replacement')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await flush();
  expect(vi.mocked(uploadLibraryAsset)).toHaveBeenCalledWith(expect.any(File), { assetId: 'A', parentVersionId: 'A-v1' });
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Supported image formats: PNG, JPG/JPEG, WebP, GIF and AVIF.');
  expect(records.get('A')!.versions).toHaveLength(1);
  expect(previewName()).toBe('Picture A');
});
it('shows one short success summary and no notice for an empty selection', async () => {
  await render(); vi.mocked(uploadLibraryAsset).mockResolvedValue(fixture('uploaded'));
  await uploadBatch(0); expect(document.querySelector('[role=status]')).toBeNull();
  await uploadBatch(2); expect(document.querySelector('[role=status]')?.textContent).toBe('Uploaded 2.');
  await act(async () => vi.advanceTimersByTimeAsync(3160));
  expect(document.querySelector('[role=status]')).toBeNull();
});
it('reports a definite rejection with no invented cause', async () => {
  await render(); vi.mocked(uploadLibraryAsset).mockRejectedValue(new AssetUploadError('rejected'));
  await uploadBatch(2);
  expect(document.querySelector('[role=alert]')?.textContent).toBe('Uploaded 0, not uploaded 2.');
});

it('switches between the narrow gallery and creator without remounting the draft or losing gallery state', async () => {
  await render(); await click('AI Create');
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Creation draft"]')!;
  draft.value = 'Keep this draft';
  const gallery = container.querySelector<HTMLElement>('.om-assets-main')!;
  gallery.scrollTop = 240;
  const listCount = vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list').length;
  const switcher = container.querySelector('.om-assets-view-switch')!;
  await act(async () => switcher.querySelectorAll('button')[0].click());
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-mobile-view')).toBe('library');
  await act(async () => switcher.querySelectorAll('button')[1].click());
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-mobile-view')).toBe('create');
  expect(container.querySelector('[aria-label="Creation draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this draft');
  expect(gallery.scrollTop).toBe(240);
  expect(vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list')).toHaveLength(listCount);
});

it('keeps the existing combined filters and ordering when using the gallery toolbar and returning from preview', async () => {
  await render();
  const choose = async (menu: string, label: string) => {
    await click(menu);
    const option = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(node => node.textContent === label)!;
    expect(option).toBeDefined();
    await act(async () => option.click()); await flush();
  };
  const latestList = () => vi.mocked(assetRequest).mock.calls.map(([args]) => args).filter(args => args.action === 'list').at(-1);
  await click('Images');
  await choose('Source', 'Local upload');
  await choose('Sort', 'Name');
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Picture'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); }); await flush();
  expect(latestList()).toMatchObject({ modality: 'image', source: 'upload', sort: 'name', query: 'Picture', trash: false });
  await click('Picture A'); await click('All assets');
  expect(button('Images').getAttribute('aria-current')).toBe('page');
  expect(button('Source').textContent).toBe('Local upload');
  expect(button('Sort').textContent).toBe('Name');
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Picture');
  await click('Clear filters');
  expect(latestList()).toMatchObject({ modality: 'image', sort: 'name', query: '', trash: false });
  expect(latestList()).not.toHaveProperty('source');
  await click('Trash');
  expect(latestList()).toMatchObject({ sort: 'name', trash: true });
  expect(latestList()).not.toHaveProperty('modality');
  await click('All');
  expect(latestList()).toMatchObject({ sort: 'name', trash: false });
  expect(latestList()).not.toHaveProperty('modality');
});

it('opens an audio asset as a new version without adding an image reference', async () => {
  const audio = fixture('audio');
  audio.name = 'Narration';
  audio.modality = 'audio';
  Object.assign(audio.versions[0], { filename: 'narration.wav', mimeType: 'audio/wav' });
  records.set(audio.id, audio);
  await render(); await click('Narration'); await click('Edit as new version');
  expect(container.querySelector('[aria-label="Creation draft"]')?.getAttribute('data-reference-count')).toBe('0');
});

it('extracts a gallery video cover from the current immutable version using the editor frame timing', async () => {
  const asset = fixture('video');
  asset.modality = 'video';
  Object.assign(asset.versions[0], { filename: 'clip.mov', mimeType: 'video/quicktime', duration: 24 });
  records = new Map([[asset.id, asset]]);
  const createElement = document.createElement.bind(document), videos: HTMLVideoElement[] = [];
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    const element = createElement(tag, options);
    if (tag === 'video') {
      videos.push(element as HTMLVideoElement);
      Object.defineProperties(element, { duration: { value: 24 }, videoWidth: { value: 640 }, videoHeight: { value: 360 } });
    }
    return element;
  }) as typeof document.createElement);
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,AAAA');

  await render();
  expect(videos).toHaveLength(1);
  expect(videos[0].getAttribute('src')).toBe('/motion-api/assets/video/versions/video-v1/file');
  await act(async () => videos[0].dispatchEvent(new Event('loadedmetadata')));
  expect(videos[0].currentTime).toBe(2);
  await act(async () => videos[0].dispatchEvent(new Event('seeked')));
  expect(drawImage).toHaveBeenCalledWith(videos[0], 0, 0);
  expect(container.querySelector('.om-asset-preview img')?.getAttribute('src')).toBe('data:image/jpeg;base64,AAAA');
  expect(container.querySelector('.om-asset-preview')?.textContent).toContain('00:24');
  expect(videos[0].getAttribute('src')).toBe('');
});

function prepareGalleryVideos() {
  for (const asset of records.values()) {
    asset.modality = 'video';
    Object.assign(asset.versions[0], { filename: `${asset.id}.mp4`, mimeType: 'video/mp4', duration: 10 });
  }
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
  return { pause, play };
}
async function hoverCard(name: string, pointerType = 'mouse') {
  await act(async () => button(name).dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType })));
}
const hoverVideo = () => container.querySelector<HTMLVideoElement>('.om-asset-hover-video');

it('plays one silent gallery hover preview over the retained poster and preserves click-to-open', async () => {
  const { play, pause } = prepareGalleryVideos();
  await render();
  expect(hoverVideo()).toBeNull();
  expect(play).not.toHaveBeenCalled();
  const poster = button('Picture A').querySelector('[data-thumbnail-loading]');
  await hoverCard('Picture A');
  const first = hoverVideo()!;
  expect(first.src).toContain('/motion-api/assets/A/versions/A-v1/file');
  expect(first.muted).toBe(true);
  expect(first.loop).toBe(true);
  expect(first.hasAttribute('playsinline')).toBe(true);
  expect(first.controls).toBe(false);
  expect(first.style.visibility).toBe('hidden');
  await act(async () => first.dispatchEvent(new Event('playing')));
  expect(first.style.visibility).toBe('visible');
  expect(button('Picture A').querySelector('[data-thumbnail-loading]')).toBe(poster);
  await hoverCard('Picture B');
  expect(container.querySelectorAll('.om-asset-hover-video')).toHaveLength(1);
  expect(first.getAttribute('src')).toBeNull();
  expect(pause.mock.instances).toContain(first);
  const second = hoverVideo()!;
  await act(async () => button('Picture B').dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })));
  expect(hoverVideo()).toBeNull();
  expect(second.getAttribute('src')).toBeNull();
  await hoverCard('Picture A');
  const clicked = hoverVideo()!;
  await click('Picture A');
  expect(previewName()).toBe('Picture A');
  expect(clicked.getAttribute('src')).toBeNull();
  expect(hoverVideo()).toBeNull();
  expect(container.querySelector('video[controls]')?.getAttribute('src')).toContain('/A/versions/A-v1/file');
  await hoverCard('Picture B');
  expect(hoverVideo()).toBeNull();
});

it('releases gallery hover media on scrolling, backgrounding and leaving the Assets surface', async () => {
  prepareGalleryVideos();
  await render();
  await hoverCard('Picture A');
  const scrolling = hoverVideo()!;
  await act(async () => container.querySelector('.om-assets-main')!.dispatchEvent(new Event('scroll')));
  expect(hoverVideo()).toBeNull();
  expect(scrolling.getAttribute('src')).toBeNull();
  await hoverCard('Picture A');
  const backgrounded = hoverVideo()!;
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(hoverVideo()).toBeNull();
  expect(backgrounded.getAttribute('src')).toBeNull();
  await hoverCard('Picture A');
  expect(hoverVideo()).toBeNull();
  hidden.mockReturnValue(false);
  await hoverCard('Picture A');
  const inactive = hoverVideo()!;
  await render(false);
  expect(hoverVideo()).toBeNull();
  expect(inactive.getAttribute('src')).toBeNull();
  await render(true);
  expect(hoverVideo()).toBeNull();
});

it('keeps gallery posters on touch, reduced motion and failed hover playback', async () => {
  const { play } = prepareGalleryVideos();
  await render();
  await hoverCard('Picture A', 'touch');
  expect(hoverVideo()).toBeNull();
  const preference = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
  await hoverCard('Picture A');
  expect(hoverVideo()).toBeNull();
  preference.mockRestore();
  play.mockRejectedValueOnce(new Error('Playback unavailable'));
  await hoverCard('Picture A');
  expect(hoverVideo()?.getAttribute('src')).toBeNull();
  expect(hoverVideo()?.style.visibility).toBe('hidden');
  expect(button('Picture A').querySelector('[data-thumbnail-loading]')).not.toBeNull();
  await hoverCard('Picture B');
  const failed = hoverVideo()!;
  await act(async () => failed.dispatchEvent(new Event('playing')));
  await act(async () => failed.dispatchEvent(new Event('error')));
  expect(failed.getAttribute('src')).toBeNull();
  expect(failed.style.visibility).toBe('hidden');
  await hoverCard('Picture A');
  const stalled = hoverVideo()!;
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(stalled.getAttribute('src')).toBeNull();
  expect(stalled.style.visibility).toBe('hidden');
});

it('shows the complete card title on hover only while it overflows, including after resizing', async () => {
  const observers: ResizeObserverStub[] = [];
  class ResizeObserverStub {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  const name = 'A complete asset filename that needs more room.mp4';
  records.get('A')!.name = name;
  await render();
  const title = container.querySelector<HTMLElement>('.om-asset-tile-caption strong')!;
  let width = 400;
  Object.defineProperties(title, { clientWidth: { get: () => width }, scrollWidth: { get: () => 300 } });
  const observer = observers.find(item => item.targets.has(title))!;
  const resize = () => observer.callback([], observer as unknown as ResizeObserver);
  const hover = async () => {
    await act(async () => {
      title.parentElement!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, composed: true }));
      title.parentElement!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, composed: true }));
      title.parentElement!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
      await vi.advanceTimersByTimeAsync(250);
    });
  };
  await act(async () => resize()); await hover();
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  await act(async () => { width = 120; resize(); }); await hover();
  expect(document.querySelector('[role=tooltip]')?.textContent).toBe(name);
  await act(async () => { width = 400; resize(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  expect(title.hasAttribute('aria-describedby')).toBe(false);
});

it('removes only the selected asset, exits its preview and restores the exact asset with Undo', async () => {
  await render(); await click('Picture A'); await click('Move to trash');
  expect(previewName()).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
  expect(container.textContent).toContain('1 assets');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Asset removed');
  expect(updates()).toEqual([{ action: 'update', assetId: 'A', changes: { trashed: true } }]);
  await click('Picture B'); await click('Undo');
  expect(previewName()).toBe('Picture B');
  expect(records.get('A')?.trashedAt).toBeUndefined();
  expect(records.get('B')?.trashedAt).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.textContent).toContain('2 assets');
  expect(updates()[1]).toEqual({ action: 'update', assetId: 'A', changes: { trashed: false } });
});

it('does not change a later selection when a pending trash write finishes and blocks duplicate writes', async () => {
  await render(); await click('Picture A');
  const write = deferred<void>(); pendingWrite = write;
  await click('Move to trash'); await click('Move to trash');
  expect(updates()).toHaveLength(1);
  await click('Picture B');
  expect(button('Move to trash').disabled).toBe(false);
  await act(async () => write.resolve()); await flush();
  expect(previewName()).toBe('Picture B');
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(records.get('B')?.trashedAt).toBeUndefined();
});

it('keeps the selected asset on failure and allows a failed Undo to be retried once', async () => {
  await render(); await click('Picture A');
  const failure = deferred<void>(); pendingWrite = failure;
  await click('Move to trash');
  await act(async () => failure.reject(new Error('Failed to fetch'))); await flush();
  expect(previewName()).toBe('Picture A'); expect(records.get('A')?.trashedAt).toBeUndefined();
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Connection lost');
  await click('Move to trash');
  const restore = deferred<void>(); pendingWrite = restore;
  await click('Undo'); await click('Undo');
  expect(updates()).toHaveLength(3);
  await act(async () => restore.reject(new Error('Failed to fetch'))); await flush();
  expect(records.get('A')?.trashedAt).toBeDefined(); expect(button('Undo').disabled).toBe(false);
  await click('Undo'); expect(updates()).toHaveLength(4); expect(records.get('A')?.trashedAt).toBeUndefined();
});

it('ignores stale detail and filmstrip reads after a successful trash operation', async () => {
  await render(); await click('Picture A'); await render(false);
  const read = deferred<{ asset: LibraryAsset }>(); pendingRead = read;
  const list = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = list;
  await render(); await click('Move to trash');
  await act(async () => { read.resolve({ asset: fixture('A') }); list.resolve({ assets: [fixture('A'), fixture('B')], total: 2, nextOffset: null }); }); await flush();
  expect(previewName()).toBeUndefined();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
  expect(container.textContent).toContain('1 assets');
});

it('reuses the loaded collection when entering and leaving preview, preserving filters and scroll', async () => {
  await render();
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Picture'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { await vi.advanceTimersByTimeAsync(180); }); await flush();
  const lists = () => vi.mocked(assetRequest).mock.calls.filter(([args]) => args.action === 'list');
  const before = lists().length;
  container.querySelector<HTMLElement>('.om-assets-main')!.scrollTop = 240;
  await click('Picture A');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Picture');
  await click('Picture B'); await click('All assets');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('Picture');
  expect(container.querySelector<HTMLElement>('.om-assets-main')?.scrollTop).toBe(240);
  expect(lists()).toHaveLength(before);
});

it('keeps the settled gallery visible while switching asset tabs', async () => {
  await render();
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  const list = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = list;
  await click('Images');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(true);
  await act(async () => list.resolve({ assets: [fixture('A')], total: 1, nextOffset: null })); await flush();
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
});

it('shows skeletons on the first load but retains the empty state on later tab loads', async () => {
  const initial = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = initial;
  await render();
  expect(container.querySelectorAll('.om-asset-loading-card')).toHaveLength(6);
  expect(container.querySelector('.om-asset-welcome')).toBeNull();
  await act(async () => initial.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  const next = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = next;
  await click('Videos');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  await act(async () => next.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
});

it('ignores an older tab response after a newer tab finishes loading', async () => {
  await render();
  const older = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = older;
  await click('Images');
  const newer = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = newer;
  await click('Videos');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  await act(async () => newer.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  await act(async () => older.resolve({ assets: [fixture('A')], total: 1, nextOffset: null })); await flush();
  expect(container.querySelector('[aria-label="Picture A"]')).toBeNull();
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
});

it('replaces retained results with a usable retry on failure and recovers', async () => {
  await render();
  const failure = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = failure;
  await click('Videos');
  await act(async () => failure.reject(new Error('offline'))); await flush();
  expect(container.textContent).toContain('Could not load assets');
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('false');
  const retry = deferred<{ assets: LibraryAsset[]; total: number; nextOffset: null }>(); pendingList = retry;
  await click('Retry');
  expect(container.querySelector('.om-asset-loading-card')).toBeNull();
  expect(container.querySelector('.om-asset-results')?.getAttribute('aria-busy')).toBe('true');
  await act(async () => retry.resolve({ assets: [], total: 0, nextOffset: null })); await flush();
  expect(container.textContent).not.toContain('Could not load assets');
  expect(container.querySelector('.om-asset-welcome')).not.toBeNull();
  expect(container.querySelector('.om-asset-results')?.hasAttribute('inert')).toBe(false);
});

it('restores from Trash without switching the filmstrip into the active library', async () => {
  records.get('A')!.trashedAt = 10;
  await render(); await click('Trash'); await click('Picture A'); await click('Restore asset');
  expect(previewName()).toBeUndefined();
  expect(container.textContent).toContain('Trash is empty');
  expect(document.querySelector('[role=status]')?.textContent).toContain('Asset restored');
  await click('All');
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture B"]')).not.toBeNull();
});

it('keeps Undo accessible inside the reference modal and refreshes both asset browsers', async () => {
  await render(); await click('Picture A'); await click('Move to trash');
  await click('AI Create'); await click('References');
  expect(document.querySelector('[data-feedback-layer]')?.closest('[role=dialog]')).not.toBeNull();
  await click('Undo');
  expect(document.querySelector('[role=dialog] [aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Picture A"]')).not.toBeNull();
  expect(container.querySelector('.om-assets-page')?.getAttribute('data-creating')).toBe('true');
});

it('hands the selected still version to the Cinema first-frame draft', async () => {
  const { findMediaStudio } = await import('../../../shared/studio-catalog');
  const { studioDestination } = await import('./creativeStudios');
  const asset = records.get('A')!;
  asset.versions.push({ ...asset.versions[0], id: 'A-v2' });
  asset.currentVersionId = 'A-v2';
  const useAsFirstFrame = vi.fn();
  const studio = { destination: studioDestination(findMediaStudio('design')!, 'text-to-image'),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() }, remember: vi.fn(), chooseModel: vi.fn(), useAsFirstFrame };
  await act(async () => root.render(<AssetsPage active studio={studio} />));
  await flush();
  await click('Picture A');
  const versions = container.querySelectorAll<HTMLButtonElement>('.om-asset-version-list button');
  await act(async () => versions[1].click());
  await click('Use as first frame');
  expect(useAsFirstFrame).toHaveBeenCalledWith({ reference: { assetId: 'A', versionId: 'A-v1' }, name: 'Picture A' });
  expect(vi.mocked(assetRequest).mock.calls.some(([args]) => args.action === 'generate')).toBe(false);
});

it('prepares a first-frame draft from a guide and an uploaded image without submitting it', async () => {
  const { findMediaStudio } = await import('../../../shared/studio-catalog');
  const { studioDestination } = await import('./creativeStudios');
  const { skillPreviewSnapshot } = await import('./skillCatalog');
  const fetchPreview = vi.fn(async () => new Response('sample', { headers: { 'Content-Type': 'application/octet-stream' } }));
  vi.stubGlobal('fetch', fetchPreview);
  const remember = vi.fn();
  const studio = { destination: studioDestination(findMediaStudio('cinema')!, 'image-to-video'),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() }, remember, chooseModel: vi.fn() };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();
  expect(container.querySelector('.om-scene-guide')).toBeTruthy();
  expect(fetchPreview).not.toHaveBeenCalled();
  await click('Play');
  expect(fetchPreview).toHaveBeenCalledWith(skillPreviewSnapshot + 'light-shadow-product.mp4', expect.anything());
  expect(container.querySelector('.om-scene-example-media video')?.getAttribute('src')).toMatch(/^blob:/);
  await click('Use this example');
  expect(remember.mock.lastCall?.[0].prompt).toMatch(/supplied frame/);
  const file = new File(['data'], 'still.png', { type: 'image/png' });
  const imported = fixture('new-still');
  vi.mocked(uploadLibraryAsset).mockResolvedValueOnce(imported);
  const input = container.querySelector<HTMLInputElement>('input[type=file][accept="image/*"]:not([multiple])')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true }))); await flush();
  expect(remember.mock.lastCall?.[0].references).toEqual([{ name: imported.name, reference: { assetId: imported.id, versionId: imported.currentVersionId } }]);
  const tab = container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1];
  await act(async () => tab.click());
  expect(container.querySelector('.om-scene-guide')).toBeNull();
  expect(vi.mocked(assetRequest).mock.calls.some(([args]) => args.action === 'generate')).toBe(false);
});

it('opens a pinned older version and ignores an earlier route read when search changes selection', async () => {
  const asset = records.get('B')!;
  asset.versions.push({ ...asset.versions[0], id: 'B-v2', parentVersionId: 'B-v1' });
  asset.currentVersionId = 'B-v2';
  const onAssetRoute = vi.fn(), lateRead = deferred<{ asset: LibraryAsset }>();
  pendingRead = lateRead;
  const select = async (id: string, version: string) => {
    await act(async () => root.render(<AssetsPage active routeId={id} routeVersion={version} onAssetRoute={onAssetRoute} />));
    await flush();
  };
  await select('A', 'A-v1');
  await select('B', 'B-v1');
  await act(async () => lateRead.resolve({ asset: records.get('A')! }));
  expect(previewName()).toBe('Picture B');
  expect(container.querySelector('.om-asset-version[aria-pressed=true] strong')?.textContent).toBe('V1');
  await select('B', 'B-v2');
  expect(container.querySelector('.om-asset-version[aria-pressed=true] strong')?.textContent).toBe('V2Current');
  expect(onAssetRoute).not.toHaveBeenCalled();
  await select('B', 'missing');
  expect(onAssetRoute).toHaveBeenCalledWith(null, null);
  expect(document.querySelector('[role=alert]')?.textContent).toContain('Asset version unavailable');
});

it('starts a focused image landing on its examples even when the user already has assets', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const studio = { destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-image')!),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() }, remember: vi.fn(), chooseModel: vi.fn() };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();
  expect(container.querySelector('.om-canvas-deck')).not.toBeNull();
  const library = container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1];
  await act(async () => library.click());
  expect(container.querySelector('.om-canvas-deck')).toBeNull();
  expect(container.querySelector('.om-assets-main')!.textContent).toContain(records.get('A')!.name);
});

it.each([
  {
    scene: 'remove-background', image: 'sofa-cutout.webp', title: 'Remove the background in one click',
    description: /Keep the sofa and coffee table/,
  },
  {
    scene: 'relight', image: 'sofa-relight.webp', title: 'Relight with flexible lighting controls',
    description: /Adjust light direction, color temperature, and mood/,
  },
] as const)('shows only a comparison image and its caption in the $scene guide', async ({ scene, image, title, description }) => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const studio = { destination: mediaEditorDestination(scene),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() }, remember: vi.fn(), chooseModel: vi.fn() };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();

  const guide = container.querySelector('.om-scene-comparison')!;
  expect(guide.querySelectorAll('img')).toHaveLength(1);
  expect(guide.querySelector('img')?.getAttribute('src')).toContain(image);
  expect(guide.querySelector('h2')?.textContent).toBe(title);
  expect(guide.querySelector('p')?.textContent).toMatch(description);
  expect(guide.querySelector('video, button, ol')).toBeNull();
  await click('Generations');
  expect(container.querySelector('.om-scene-comparison')).toBeNull();
});

it('hides Use as reference for video and audio assets, omits video from edit references, and limits direct reference picker to images', async () => {
  const video = fixture('video');
  video.name = 'Clip';
  video.modality = 'video';
  Object.assign(video.versions[0], { filename: 'clip.mp4', mimeType: 'video/mp4' });
  const audio = fixture('audio');
  audio.name = 'Voice';
  audio.modality = 'audio';
  Object.assign(audio.versions[0], { filename: 'voice.wav', mimeType: 'audio/wav' });
  records.set(video.id, video);
  records.set(audio.id, audio);

  await render();
  await click('Picture A');
  expect([...container.querySelectorAll('button')].some(node => node.textContent?.includes('Use as reference'))).toBe(true);
  await click('All assets');

  await click('Clip');
  expect([...container.querySelectorAll('button')].some(node => node.textContent?.includes('Use as reference'))).toBe(false);
  await click('Edit as new version');
  expect(container.querySelector('[aria-label="Creation draft"]')?.getAttribute('data-reference-count')).toBe('0');
  await click('References');
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog).toBeTruthy();
  expect(dialog.textContent).toContain('Picture A');
  expect(dialog.textContent).not.toContain('Clip');
  expect(dialog.textContent).not.toContain('Voice');
  expect(dialog.querySelector('.om-asset-tabs')).toBeNull();
});

it('hides Use as reference on video assets, edits video without self-reference, and keeps direct reference picker image-only', async () => {
  const video = fixture('clip');
  video.name = 'Sample clip';
  video.modality = 'video';
  Object.assign(video.versions[0], { filename: 'clip.mp4', mimeType: 'video/mp4', duration: 5 });
  records.set(video.id, video);

  await render();
  await click('Sample clip');
  expect(button('Use as reference')).toBeUndefined();
  expect(button('Use as first frame')).toBeUndefined();

  await click('Edit as new version');
  expect(container.querySelector('[aria-label="Creation draft"]')?.getAttribute('data-reference-count')).toBe('0');

  await click('References');
  const dialog = document.querySelector('[role=dialog]')!;
  expect(dialog).not.toBeNull();
  expect([...dialog.querySelectorAll('button')].some(node => node.textContent === 'Videos' || node.textContent === 'Audio')).toBe(false);
});

it('switches to Asset library on generate and shows blurred placeholder tiles at the front of the grid without duplicating composer progress', async () => {
  records.clear();
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const studio = {
    destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-image')!),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() },
    remember: vi.fn(),
    chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();
  expect(container.querySelector('.om-canvas-deck')).not.toBeNull();
  const makeJob = (id: string, prompt: string, createdAt: number, hasRef = false): import('../../../shared/gateway').GenerationJob => ({
    id, requestId: `req-${id}`, modality: 'image', prompt, state: 'running',
    model: { id: 'gpt-image-2', label: 'GPT Image 2', provider: 'opendesign' },
    ...(hasRef ? { library: { references: [{ assetId: 'ref-1', versionId: 'ref-v1' }] } } : {}),
    createdAt, updatedAt: createdAt,
  });
  await act(async () => {
    lastComposerOnCreated?.(makeJob('job-1', 'Amber bottle in warm sunlight', 100));
    lastComposerOnCreated?.(makeJob('job-2', 'Refined glass lighting pass', 200, true));
  });
  await flush();
  // Auto-switched to Asset library tab with live running badge and suppressed duplicate left-pane card.
  expect(container.querySelector('.om-canvas-deck')).toBeNull();
  expect(lastShowCurrentJob).toBe(false);
  const libraryTab = container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1];
  expect(libraryTab.getAttribute('aria-pressed')).toBe('true');
  expect(libraryTab.querySelector('.om-tab-count')?.textContent).toBe('2');
  const tiles = [...container.querySelectorAll('.om-gen-flow .om-gen-card-pending')];
  expect(tiles).toHaveLength(2);
  // Newest active job appears first, with blurred reference backdrop when a reference exists.
  expect(tiles[0].querySelector('img.om-placeholder-backdrop')).not.toBeNull();
  expect(tiles[1].querySelector('.om-placeholder-aura')).not.toBeNull();
});

it('transitions completed placeholders in place without duplicating assets and lets users reuse or dismiss failed placeholders', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const studio = {
    destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-image')!),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() },
    remember: vi.fn(),
    chooseModel: vi.fn(),
  };
  let polledJobs: import('../../../shared/gateway').GenerationJob[] = [];
  const baseImpl = vi.mocked(assetRequest).getMockImplementation()!;
  vi.mocked(assetRequest).mockImplementation(async args => {
    if (args.action === 'jobs') return { jobs: structuredClone(polledJobs) };
    return baseImpl(args);
  });
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();
  // Submitting a new version of existing asset A starts as running, then transitions to completed with A-v2.
  const jobRunning: import('../../../shared/gateway').GenerationJob = {
    id: 'job-v2', requestId: 'req-v2', modality: 'image', prompt: 'Upgrade asset A lighting', state: 'running',
    model: { id: 'gpt-image-2', label: 'GPT Image 2', provider: 'opendesign' },
    createdAt: 300, updatedAt: 300,
  };
  const jobFailed: import('../../../shared/gateway').GenerationJob = {
    id: 'job-fail', requestId: 'req-fail', modality: 'image', prompt: 'Neon alley rain scene', state: 'failed',
    error: 'Provider timeout',
    model: { id: 'gpt-image-2', label: 'GPT Image 2', provider: 'opendesign' },
    createdAt: 250, updatedAt: 250,
  };
  polledJobs = [jobRunning, jobFailed];
  await act(async () => {
    lastComposerOnCreated?.(jobRunning);
    lastComposerOnCreated?.(jobFailed);
  });
  await flush();
  expect(container.querySelectorAll('.om-placeholder-stage')).toHaveLength(2);
  // Once job-v2 finishes with version A-v2 and the library refreshes, it unblurs in place and deduplicates A from the rest of the stream.
  records.get('A')!.versions.push({ ...records.get('A')!.versions[0], id: 'A-v2', parentVersionId: 'A-v1' });
  records.get('A')!.currentVersionId = 'A-v2';
  polledJobs = [{ ...jobRunning, state: 'completed', libraryAssets: [{ assetId: 'A', versionId: 'A-v2' }], updatedAt: 301 }, jobFailed];
  await act(async () => { vi.advanceTimersByTime(2600); }); await flush();
  await act(async () => { vi.advanceTimersByTime(10); }); await flush();
  expect(container.querySelectorAll('.om-placeholder-stage')).toHaveLength(1);
  expect(container.querySelectorAll('[aria-label="Picture A"]')).toHaveLength(1);
  // Reuse prompt refills the left composer draft; Dismiss removes the failed placeholder tile.
  await act(async () => { button('Reuse prompt')!.click(); }); await flush();
  expect(studio.remember.mock.lastCall?.[0].prompt).toBe('Neon alley rain scene');
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Dismiss"]')!.click(); }); await flush();
  expect(container.querySelectorAll('.om-placeholder-stage')).toHaveLength(0);
});

it('renders justified equal-height Generations flows for both Image and Video with human model names and unclipped Cinema Lightbox', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const imageStudio = {
    destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-image')!),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() },
    remember: vi.fn(),
    chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={imageStudio} />)); await flush();
  const generationsTab = container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1];
  expect(generationsTab.textContent).toBe('Generations');
  // Generations belongs to generated outputs only — Upload stays in the top-right global Asset Library.
  expect(button('Upload')).toBeUndefined();
  await act(async () => generationsTab.click()); await flush();
  const history = container.querySelector('.om-gen-history')!;
  expect(history.getAttribute('data-density')).toBe('comfortable');
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Large preview"]')!.click(); });
  expect(history.getAttribute('data-density')).toBe('large');
  // Clicking an image card opens the zoomable lightbox right inside the Image tab.
  await act(async () => { container.querySelector<HTMLButtonElement>('.om-gen-open')!.click(); });
  const lightbox = container.querySelector('[role="dialog"].om-gen-lightbox')!;
  expect(lightbox).not.toBeNull();
  expect(lightbox.textContent).toContain('Zoom 100%');
  await act(async () => { lightbox.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click(); });
  expect(container.querySelector('.om-gen-lightbox')).toBeNull();

  // Video tab renders justified equal-height cards with human model labels, ratio/duration/resolution tags, and Cinema Lightbox.
  const clipA = fixture('vid-1');
  clipA.name = 'Portrait dance';
  clipA.modality = 'video';
  Object.assign(clipA.versions[0], {
    filename: 'shot1.mp4', mimeType: 'video/mp4', duration: 5.1, width: 720, height: 1280,
    model: 'account:doubao-seedance-2-5-260628', prompt: 'Slow dolly across studio table',
  });
  const clipB = fixture('vid-2');
  clipB.name = 'Closing shot';
  clipB.modality = 'video';
  Object.assign(clipB.versions[0], {
    filename: 'shot2.mp4', mimeType: 'video/mp4', duration: 4, width: 1920, height: 1080,
    model: 'opendesign:wan-2.7', prompt: 'Wide pull-back at dusk',
  });
  records.set(clipA.id, clipA);
  records.set(clipB.id, clipB);
  const videoStudio = {
    destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-video')!),
    catalog: { catalog: undefined, failed: false, retry: vi.fn() },
    remember: vi.fn(),
    chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage key="video" active studio={videoStudio} />)); await flush();
  const videoTab = container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1];
  expect(videoTab.textContent).toBe('Generations');
  await act(async () => videoTab.click()); await flush();
  const videoCards = [...container.querySelectorAll<HTMLElement>('.om-gen-flow .om-gen-card')];
  expect(videoCards).toHaveLength(2);
  expect(videoCards[0].style.getPropertyValue('--ar')).toBe(String(720 / 1280));
  expect(videoCards[0].textContent).toContain('Seedance 2.5');
  expect(videoCards[0].textContent).toContain('9:16');
  expect(videoCards[0].textContent).toContain('5s');
  expect(videoCards[0].textContent).toContain('720p');
  expect(videoCards[0].textContent).not.toContain('account:doubao-seedance-2-5-260628');
  // Clicking the vertical video opens the Cinema Lightbox with controls intact.
  await act(async () => { videoCards[0].querySelector<HTMLButtonElement>('.om-gen-open')!.click(); });
  const videoLightbox = container.querySelector('[role="dialog"].om-gen-lightbox')!;
  expect(videoLightbox).not.toBeNull();
  expect(videoLightbox.querySelector('video.om-gen-lightbox-video')).not.toBeNull();
  expect(videoLightbox.textContent).toContain('Slow dolly across studio table');
});

it('shows games made in Game Studio above the library and in their own category', async () => {
  vi.mocked(gameApi.catalog).mockResolvedValue({ games: [
    game('draft', { status: 'draft', title: 'Pixel art style, Shooter, Cyberpunk setting', style: 'pixel', setting: 'cyberpunk' }),
    game('bundled', { source: 'template', title: 'Bundled game' }),
    game('done', { title: 'Station Defense', updatedAt: '2026-11-19T00:00:00.000Z' }),
  ] });
  window.history.replaceState(null, '', '/?page=assets');
  // Four 200px columns fit; the row shows one line only.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
  await render();
  const section = container.querySelector('.om-asset-games')!;
  expect(section.querySelector('h2')?.textContent).toBe('Games');
  // Only the user's own games, newest first; a composed draft brief is shown as its chosen options.
  expect([...section.querySelectorAll('.om-asset-tile strong')].map(node => node.textContent)).toEqual(['Cyberpunk · Pixel art · Shooter', 'Station Defense']);
  expect([...section.querySelectorAll('.om-asset-game-status')].map(node => node.textContent)).toEqual(['Waiting for your Agent', 'Published']);
  expect(container.textContent).toContain('Picture A');

  await click('View all');
  expect(container.querySelector('.om-asset-games')).toBeNull();
  expect(button('Games').getAttribute('aria-current')).toBe('page');
  expect(button('All').getAttribute('aria-current')).toBeNull();
  expect(container.textContent).not.toContain('Picture A');
  expect(container.querySelectorAll('.om-asset-tile')).toHaveLength(2);

  await click('Open Station Defense in Game Studio');
  expect(new URL(location.href).pathname).toBe('/studios/game');
  expect(new URL(location.href).searchParams.get('game')).toBe('done');
});

it('hides the games row without games and offers Game Studio from the empty category', async () => {
  window.history.replaceState(null, '', '/?page=assets');
  await render();
  expect(container.querySelector('.om-asset-games')).toBeNull();
  await click('Games');
  expect(container.textContent).toContain('No games yet');
  await click('Go to Game Studio');
  const url = new URL(location.href);
  expect(url.pathname).toBe('/studios/game');
  expect(url.searchParams.has('game')).toBe(false);
});

it('keeps the empty studio canvas model aligned with composer selection on Codex-only text-to-image and multi-ref drafts', async () => {
  const { sceneDestination, studioScenes } = await import('./creativeStudios');
  const { creationModels } = await import('./creationModels');
  records.clear();
  const codex = { id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', modality: 'image' as const, mode: 'text-to-image', source: 'builtin' as const, supportsImageReference: true, maxInputImages: 1 };
  const textToImageStudio = {
    destination: sceneDestination(studioScenes.find(scene => scene.id === 'text-to-image')!),
    catalog: {
      catalog: { models: [codex], status: { routes: {}, providers: [{ id: 'codex', label: 'Codex', available: true }] } },
      failed: false, retry: vi.fn(),
    },
    remember: vi.fn(), chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={textToImageStudio} />)); await flush();
  await act(async () => container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1].click());
  expect(container.textContent).toContain('Codex Image');

  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const seedream = { id: 'opendesign:seedream-5.5', provider: 'opendesign', modelId: 'seedream-5.5', label: 'seedream-5.5', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 1 };
  const multiRefResult = creationModels(
    { models: [seedream, sunburst], status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] } } as never,
    'image',
    seedream.id,
    studioScenes.find(scene => scene.id === 'character')!,
    false,
    2,
  );
  expect(multiRefResult.selected?.id).toBe(sunburst.id);
  expect(multiRefResult.available.map(model => model.id)).toEqual([sunburst.id]);
  expect(multiRefResult.compatible.some(model => model.modelId === 'seedream-5.5')).toBe(false);
});

it('supports multi-file reference upload up to 5 images on Character reference while keeping single-file upload on Remove background', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const seedream = { id: 'opendesign:seedream-5.5', provider: 'opendesign', modelId: 'seedream-5.5', label: 'seedream-5.5', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 1 };
  const catalog = {
    models: [seedream, sunburst],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  const remember = vi.fn();
  const characterStudio = {
    destination: mediaEditorDestination('character'),
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember, chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={characterStudio} />)); await flush();

  const refInput = container.querySelector<HTMLInputElement>('input[data-reference-upload="true"]')!;
  expect(refInput.multiple).toBe(true);

  const imported = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map(id => fixture(id));
  vi.mocked(uploadLibraryAsset).mockClear();
  for (const item of imported.slice(0, 5)) vi.mocked(uploadLibraryAsset).mockResolvedValueOnce(item);
  const files = imported.map(item => new File(['data'], `${item.id}.png`, { type: 'image/png' }));
  Object.defineProperty(refInput, 'files', { configurable: true, value: files });
  await act(async () => refInput.dispatchEvent(new Event('change', { bubbles: true }))); await flush();

  // Caps imported references at the Character reference limit (5) without uploading the excess 6th file.
  expect(uploadLibraryAsset).toHaveBeenCalledTimes(5);
  expect(remember.mock.lastCall?.[0].references).toHaveLength(5);
  expect(remember.mock.lastCall?.[0].references.map((item: { reference: { assetId: string } }) => item.reference.assetId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  expect(container.querySelector('.om-source-actions')).toBeNull();
  expect(document.body.textContent).toContain('Reference limit reached.');

  // Nearly-full case (4 of 5 attached) with mixed non-image + 2 images: keeps 1 image and shows both notices.
  await act(async () => root.unmount()); root = createRoot(container);
  const rememberPartial = vi.fn();
  const fourRefs = ['c1', 'c2', 'c3', 'c4'].map(id => ({ reference: { assetId: id, versionId: `${id}-v1` }, name: `Picture ${id}` }));
  const partialStudio = {
    destination: mediaEditorDestination('character'),
    initialDraft: { modality: 'image' as const, prompt: '', references: fourRefs },
    draftKey: 'character:partial',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: rememberPartial, chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={partialStudio} />)); await flush();
  const partialInput = container.querySelector<HTMLInputElement>('input[data-reference-upload="true"]')!;
  const extraFive = fixture('c5');
  vi.mocked(uploadLibraryAsset).mockResolvedValueOnce(extraFive);
  Object.defineProperty(partialInput, 'files', {
    configurable: true,
    value: [
      new File(['bad'], 'notes.txt', { type: 'text/plain' }),
      new File(['data'], 'c5.png', { type: 'image/png' }),
      new File(['data'], 'c6.png', { type: 'image/png' }),
    ],
  });
  await act(async () => partialInput.dispatchEvent(new Event('change', { bubbles: true }))); await flush();
  expect(rememberPartial.mock.lastCall?.[0].references.map((item: { reference: { assetId: string } }) => item.reference.assetId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  expect(document.body.textContent).toContain('Choose an image file.');
  expect(document.body.textContent).toContain('Reference limit reached.');

  await act(async () => root.unmount()); root = createRoot(container);
  const removeBgStudio = {
    destination: mediaEditorDestination('remove-background'),
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: vi.fn(), chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={removeBgStudio} />)); await flush();
  const singleRefInput = container.querySelector<HTMLInputElement>('input[data-reference-upload="true"]')!;
  expect(singleRefInput.multiple).toBe(false);
});

it('shows Reference limit reached when another reference fills the last slot while an upload is in flight', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const catalog = {
    models: [sunburst],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  const fourRefs = ['c1', 'c2', 'c3', 'c4'].map(id => ({ reference: { assetId: id, versionId: `${id}-v1` }, name: `Picture ${id}` }));
  const remember = vi.fn();
  const studio = {
    destination: mediaEditorDestination('character'),
    initialDraft: { modality: 'image' as const, prompt: '', references: fourRefs },
    draftKey: 'character:race',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember, chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();

  const inflight = deferred<LibraryAsset>();
  vi.mocked(uploadLibraryAsset).mockReturnValueOnce(inflight.promise);
  const refInput = container.querySelector<HTMLInputElement>('input[data-reference-upload="true"]')!;
  Object.defineProperty(refInput, 'files', { configurable: true, value: [new File(['data'], 'late.png', { type: 'image/png' })] });
  await act(async () => refInput.dispatchEvent(new Event('change', { bubbles: true })));

  // Fill the 5th slot via the reference picker while the upload is still in flight.
  await click('References'); await flush();
  const pickBtn = document.querySelector<HTMLButtonElement>('[role=dialog] [aria-label="Picture A"]')!;
  await act(async () => pickBtn.click()); await flush();
  await click('Use selected version');
  expect(remember.mock.lastCall?.[0].references).toHaveLength(5);

  // Resolve the in-flight upload; it should not exceed 5 and must surface Reference limit reached.
  await act(async () => { inflight.resolve(fixture('late-upload')); await inflight.promise; }); await flush();
  expect(remember.mock.lastCall?.[0].references).toHaveLength(5);
  expect(remember.mock.lastCall?.[0].references.some((item: { reference: { assetId: string } }) => item.reference.assetId === 'late-upload')).toBe(false);
  expect(document.body.textContent).toContain('Reference limit reached.');
});

it('supports multi-select in AssetPicker capped to remaining reference slots and rejects uncompressible >2 MiB drops early', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const catalog = {
    models: [sunburst],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  records.set('C', fixture('C'));
  const remember = vi.fn();
  const threeRefs = ['r1', 'r2', 'r3'].map(id => ({ reference: { assetId: id, versionId: `${id}-v1` }, name: `Picture ${id}` }));
  const studio = {
    destination: mediaEditorDestination('character'),
    initialDraft: { modality: 'image' as const, prompt: '', references: threeRefs },
    draftKey: 'character:multipick',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember, chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();

  // 3 of 5 slots used -> picker opens in multi-select mode with maxSelect = 2 and hides Import all.
  await click('References'); await flush();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain('Select up to 2 images.');
  expect([...dialog.querySelectorAll('button')].some(b => b.textContent?.includes('Import all'))).toBe(false);

  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Picture A"]')!.click());
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Picture B"]')!.click());
  expect(dialog.textContent).toContain('2 / 2 selected');

  // Clicking a 3rd item is blocked by maxSelect = 2 and shows Reference limit reached.
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Picture C"]')!.click());
  expect(dialog.textContent).toContain('2 / 2 selected');
  expect(dialog.textContent).toContain('Reference limit reached.');

  await click('Use selected (2)');
  expect(remember.mock.lastCall?.[0].references.map((item: { reference: { assetId: string } }) => item.reference.assetId)).toEqual(['r1', 'r2', 'r3', 'A', 'B']);

  // Dropping an uncompressible > 2 MiB image on a fresh Character reference draft surfaces the 2 MiB error early without calling uploadLibraryAsset.
  await act(async () => root.unmount()); root = createRoot(container);
  vi.mocked(uploadLibraryAsset).mockClear();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('cannot decode'); }));
  vi.stubGlobal('Image', undefined);
  const freshStudio = {
    destination: mediaEditorDestination('character'),
    draftKey: 'character:oversized',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: vi.fn(), chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={freshStudio} />)); await flush();
  const huge = new File([new Uint8Array(2 * 1024 * 1024 + 512)], 'huge.png', { type: 'image/png' });
  await act(async () => { lastComposerOnUploadFiles?.([huge]); }); await flush();
  expect(uploadLibraryAsset).not.toHaveBeenCalled();
  expect(lastComposerUploadingReferences).toBe(false);
  expect(document.body.textContent).toContain('The reference image is larger than the 2 MiB OpenDesign upload limit.');

  // Sub-2 MiB undecodable HEIC is rejected early without consuming slots from a following valid PNG.
  const validPng = new File(['ok'], 'valid.png', { type: 'image/png' });
  const heic = new File([new Uint8Array(1024)], 'iphone.heic', { type: 'image/heic' });
  vi.mocked(uploadLibraryAsset).mockResolvedValueOnce(fixture('valid-after-heic'));
  await act(async () => { lastComposerOnUploadFiles?.([heic, validPng]); }); await flush();
  expect(uploadLibraryAsset).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain('OpenDesign does not accept this reference image format.');
});

it('keeps AssetPicker multi-select stable across in-flight uploads, ignores already-attached assets for quota, validates picked size, and stops batch on unmount', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const catalog = {
    models: [sunburst],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  records.set('C', fixture('C'));
  const bigLibraryAsset = fixture('BIG');
  bigLibraryAsset.versions[0].bytes = 3 * 1024 * 1024;
  records.set('BIG', bigLibraryAsset);
  const remember = vi.fn();
  // Asset A is already attached (plus 2 more -> 3 / 5 attached, 2 remaining).
  const initialRefs = [
    { reference: { assetId: 'A', versionId: 'A-v1' }, name: 'Picture A' },
    { reference: { assetId: 'r2', versionId: 'r2-v1' }, name: 'Picture r2' },
    { reference: { assetId: 'r3', versionId: 'r3-v1' }, name: 'Picture r3' },
  ];
  const studio = {
    destination: mediaEditorDestination('character'),
    initialDraft: { modality: 'image' as const, prompt: '', references: initialRefs },
    draftKey: 'character:picker-stability',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember, chooseModel: vi.fn(),
  };
  await act(async () => root.render(<AssetsPage active studio={studio} />)); await flush();

  // Start an in-flight upload (1 file), then open the picker while 2 slots remain.
  const inflight = deferred<LibraryAsset>();
  vi.mocked(uploadLibraryAsset).mockReturnValueOnce(inflight.promise);
  await act(async () => { lastComposerOnUploadFiles?.([new File(['data'], 'u1.png', { type: 'image/png' })]); });

  await click('References'); await flush();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  // Already-attached Asset A shows Already attached and does not consume a slot.
  expect(dialog.textContent).toContain('Already attached');
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Picture A"]')!.click());
  expect(dialog.textContent).not.toContain('1 / 2 selected');

  // Select Picture B while upload is in flight, then complete the upload (draft moves 3 -> 4, remaining 2 -> 1).
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="Picture B"]')!.click());
  expect(dialog.textContent).toContain('1 / 2 selected');
  await act(async () => { inflight.resolve(fixture('uploaded-4')); await inflight.promise; }); await flush();
  // Picker stays in multi-select mode with Picture B still selected (1 / 1 selected) and confirm button intact!
  expect(dialog.textContent).toContain('1 / 1 selected');
  expect(dialog.textContent).toContain('Use selected (1)');
  await click('Use selected (1)');
  expect(remember.mock.lastCall?.[0].references).toHaveLength(5);

  // Oversized 3 MiB library asset is rejected immediately at pick time.
  await act(async () => root.unmount()); root = createRoot(container);
  const rememberBig = vi.fn();
  await act(async () => root.render(<AssetsPage active studio={{
    destination: mediaEditorDestination('character'),
    draftKey: 'character:big-pick',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: rememberBig, chooseModel: vi.fn(),
  }} />)); await flush();
  await click('References'); await flush();
  const bigDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => bigDialog.querySelector<HTMLButtonElement>('[aria-label="Picture BIG"]')!.click());
  await click('Use selected (1)');
  expect(document.body.textContent).toContain('The reference image is larger than the 2 MiB OpenDesign upload limit.');
  expect(rememberBig.mock.lastCall?.[0].references ?? []).toHaveLength(0);

  // Unmounting mid-batch stops subsequent uploads in the batch.
  vi.mocked(uploadLibraryAsset).mockClear();
  const firstUpload = deferred<LibraryAsset>();
  vi.mocked(uploadLibraryAsset).mockReturnValueOnce(firstUpload.promise);
  await act(async () => {
    lastComposerOnUploadFiles?.([
      new File(['1'], 'one.png', { type: 'image/png' }),
      new File(['2'], 'two.png', { type: 'image/png' }),
    ]);
  });
  await act(async () => root.unmount());
  await act(async () => { firstUpload.resolve(fixture('one')); await firstUpload.promise; });
  expect(uploadLibraryAsset).toHaveBeenCalledTimes(1);
  root = createRoot(container);

  // A backend-rejected file (e.g. empty PNG) does not consume the remaining slot from a following valid PNG.
  const fourRefs = ['r1', 'r2', 'r3', 'r4'].map(id => ({ reference: { assetId: id, versionId: `${id}-v1` }, name: `Picture ${id}` }));
  const rememberFallback = vi.fn();
  await act(async () => root.render(<AssetsPage active studio={{
    destination: mediaEditorDestination('character'),
    initialDraft: { modality: 'image' as const, prompt: '', references: fourRefs },
    draftKey: 'character:rejected-first',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: rememberFallback, chooseModel: vi.fn(),
  }} />)); await flush();
  vi.mocked(uploadLibraryAsset).mockClear();
  vi.mocked(uploadLibraryAsset)
    .mockRejectedValueOnce(new AssetUploadError('rejected', 'empty'))
    .mockResolvedValueOnce(fixture('valid-5th'));
  await act(async () => {
    lastComposerOnUploadFiles?.([
      new File([], 'empty.png', { type: 'image/png' }),
      new File(['ok'], 'valid.png', { type: 'image/png' }),
    ]);
  }); await flush();
  expect(uploadLibraryAsset).toHaveBeenCalledTimes(2);
  expect(rememberFallback.mock.lastCall?.[0].references).toHaveLength(5);
  expect(rememberFallback.mock.lastCall?.[0].references[4].reference.assetId).toBe('valid-5th');

  // Codex-only edit-image does NOT enforce OpenDesign's 2 MiB limit on a valid 3 MiB PNG library asset.
  await act(async () => root.unmount()); root = createRoot(container);
  const codexOnlyCatalog = {
    models: [
      { id: 'codex:image-generation', provider: 'codex', modelId: 'image-generation', label: 'Codex Image', modality: 'image' as const, mode: 'text-to-image', source: 'builtin' as const, supportsImageReference: true, maxInputImages: 1 },
      { ...sunburst },
    ],
    status: {
      routes: {},
      providers: [
        { id: 'codex', label: 'Codex', available: true },
        { id: 'opendesign', label: 'OpenDesign Cloud', available: false },
      ],
    },
  };
  const rememberCodex = vi.fn();
  await act(async () => root.render(<AssetsPage active studio={{
    destination: mediaEditorDestination('image-edit'),
    draftKey: 'image-edit:codex-only',
    catalog: { catalog: codexOnlyCatalog, failed: false, retry: vi.fn() },
    remember: rememberCodex, chooseModel: vi.fn(),
  }} />)); await flush();
  await click('References'); await flush();
  const codexDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () => codexDialog.querySelector<HTMLButtonElement>('[aria-label="Picture BIG"]')!.click());
  await click('Use selected version');
  expect(rememberCodex.mock.lastCall?.[0].references.map((item: { reference: { assetId: string } }) => item.reference.assetId)).toEqual(['BIG']);
});

it('rejects oversized generated assets when attaching from the Generations lightbox', async () => {
  const { mediaEditorDestination } = await import('./creativeStudios');
  const sunburst = { id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', modality: 'image' as const, mode: 'text-to-image', source: 'live' as const, supportsImageReference: true, maxInputImages: 16 };
  const catalog = {
    models: [sunburst],
    status: { routes: {}, providers: [{ id: 'opendesign', label: 'OpenDesign Cloud', available: true }] },
  };
  records.clear();
  const generatedBig = fixture('GENBIG');
  generatedBig.versions[0].source = 'generation';
  generatedBig.versions[0].bytes = 3 * 1024 * 1024;
  records.set('GENBIG', generatedBig);
  const rememberGen = vi.fn();
  await act(async () => root.render(<AssetsPage active studio={{
    destination: mediaEditorDestination('character'),
    draftKey: 'character:gen-history-big',
    catalog: { catalog, failed: false, retry: vi.fn() },
    remember: rememberGen, chooseModel: vi.fn(),
  }} />)); await flush();

  expect(document.body.textContent).not.toContain('The reference image is larger than the 2 MiB OpenDesign upload limit.');
  expect(rememberGen).toHaveBeenCalled();

  await act(async () => container.querySelectorAll<HTMLButtonElement>('.om-assets-heading .om-choice-tabs button')[1].click()); await flush();
  await act(async () => { container.querySelector<HTMLButtonElement>('.om-gen-open')!.click(); }); await flush();
  const lightbox = container.querySelector<HTMLElement>('[role="dialog"].om-gen-lightbox')!;
  expect(lightbox).not.toBeNull();
  const useRefBtn = [...lightbox.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes('Use as reference'));
  expect(useRefBtn).toBeDefined();
  await act(async () => { useRefBtn!.click(); }); await flush();
  expect(document.body.textContent).toContain('The reference image is larger than the 2 MiB OpenDesign upload limit.');
  expect(rememberGen.mock.lastCall?.[0].references).toEqual([]);
});
