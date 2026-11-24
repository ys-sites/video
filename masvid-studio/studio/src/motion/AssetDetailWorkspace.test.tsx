// @vitest-environment happy-dom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AssetDetailWorkspace } from './AssetDetailWorkspace';
import type { LibraryAsset } from '../../../shared/asset-library';
vi.mock('../i18n/I18n', () => ({ useI18n: () => ({ t: (text: string) => translations[text] ?? text, formatDate: (date: number) => `Date ${date}` }) }));
vi.mock('./ResizablePane', () => ({ ResizablePane: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('./assetClient', () => ({ assetRequest: async () => ({ assets: [], total: 0, nextOffset: null }) }));
const asset: LibraryAsset = { id: 'asset-1', name: 'Landscape', modality: 'image', createdAt: 1, updatedAt: 2, currentVersionId: 'v2', versions: [
  { id: 'v1', createdAt: 1, source: 'upload', filename: 'first.png', mimeType: 'image/png', bytes: 1024, sha256: 'one', references: [] },
  { id: 'v2', createdAt: 2, source: 'generated', filename: 'second.png', mimeType: 'image/png', bytes: 2048, sha256: 'two', prompt: 'Add clouds', model: 'codex:image-generation', references: [{ assetId: 'asset-1', versionId: 'v1' }], parentVersionId: 'v1' },
] };
let root: Root, container: HTMLDivElement;
const translations: Record<string, string> = {};
const update = vi.fn<(changes: Record<string, unknown>) => Promise<boolean | void>>(async () => true), version = vi.fn(), edit = vi.fn(), back = vi.fn(), reference = vi.fn();
beforeEach(() => { vi.clearAllMocks(); update.mockReset().mockResolvedValue(true); for (const key of Object.keys(translations)) delete translations[key]; container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function render(versionId = 'v2', editor?: ReactNode, selected = asset) { await act(async () => root.render(<AssetDetailWorkspace asset={selected} versionId={versionId} navigation={<div>Asset navigation</div>} active uploading={false} editor={editor} onBack={back} onVersion={version} onUpdate={update} onEdit={edit} onReference={vi.fn()} onOpenReference={reference} onUpload={vi.fn()} onDownload={vi.fn()} />)); }
const button = (text: string) => [...container.querySelectorAll('button')].find(node => node.textContent?.includes(text))!;
it.each([
  [0, '0 B'], [174, '174 B'], [1023, '1023 B'], [1024, '1 KB'],
  [1536, '1.5 KB'], [1048575, '1 MB'], [1048576, '1 MB'],
  [2569011, '2.45 MB'], [1073741824, '1 GB'],
])('shows %i bytes in a readable unit as %s', async (bytes, label) => {
  const selected = { ...asset, versions: asset.versions.map(item => ({ ...item, bytes })) };
  await render('v1', undefined, selected);
  expect(container.querySelector('.om-asset-viewer-caption')?.textContent).toContain(label);
  expect(container.querySelector('.om-asset-viewer-caption')?.textContent).not.toContain('0.00 MB');
});
it('pauses media when the responsive layout hides the preview', async () => {
  let notify!: ResizeObserverCallback;
  const observer = vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback) {
    notify = callback;
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
  });
  try {
    await render();
    const viewer = container.querySelector<HTMLElement>('.om-asset-viewer')!;
    const video = document.createElement('video'), pause = vi.spyOn(video, 'pause');
    viewer.append(video);
    const rects = vi.spyOn(viewer, 'getClientRects').mockReturnValue([] as unknown as DOMRectList);
    notify([], {} as ResizeObserver);
    expect(pause).toHaveBeenCalledOnce();
    rects.mockReturnValue([{}] as DOMRectList);
    notify([], {} as ResizeObserver);
    expect(pause).toHaveBeenCalledOnce();
  } finally { observer.mockRestore(); }
});
it('shows an inline preview, pins download and restoration to the selected immutable version', async () => {
  await render('v1');
  expect(container.querySelector('dialog, [role="dialog"]')).toBeNull();
  expect(container.querySelector('.om-asset-viewer img')?.getAttribute('src')).toContain('/versions/v1/file');
  expect(container.querySelector('a[download]')?.getAttribute('href')).toContain('/versions/v1/file?download=1');
  await act(async () => button('Make current version').click());
  expect(update).toHaveBeenCalledWith({ currentVersionId: 'v1' });
  await act(async () => container.querySelector<HTMLButtonElement>('.om-asset-version')!.click());
  expect(version).toHaveBeenCalledWith('v2');
});
it('keeps editing beside the preview and exposes provenance and exact reference navigation', async () => {
  await render();
  expect(container.textContent).toContain('Add clouds'); expect(container.textContent).toContain('codex:image-generation');
  await act(async () => button('View reference').click());
  expect(reference).toHaveBeenCalledWith({ assetId: 'asset-1', versionId: 'v1' });
  await act(async () => button('Edit as new version').click()); expect(edit).toHaveBeenCalledOnce();
  await render('v2', <div>Version editor</div>);
  expect(container.textContent).toContain('Version editor');
  expect(container.querySelector('.om-asset-viewer img')?.getAttribute('src')).toContain('/versions/v2/file');
  await act(async () => button('All assets').click()); expect(back).toHaveBeenCalledOnce();
});

const nameInput = () => container.querySelector<HTMLInputElement>('input[aria-label="Asset name"]');
async function startRename() { await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Rename"]')!.click()); return nameInput()!; }
async function typeName(name: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput(), name);
    nameInput()!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function nameKey(key: string, isComposing = false) { await act(async () => nameInput()!.dispatchEvent(new KeyboardEvent('keydown', { key, isComposing, bubbles: true }))); }

it('shows the asset name as text and only opens a focused, selected input on edit', async () => {
  await render();
  expect(nameInput()).toBeNull();
  expect(container.querySelector('.om-asset-name-display')?.textContent).toBe('Landscape');
  const input = await startRename();
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Landscape'.length]);
  await typeName('  Renamed landscape  ');
  await nameKey('Enter');
  expect(update).toHaveBeenCalledExactlyOnceWith({ name: 'Renamed landscape' });
  expect(nameInput()).toBeNull();
  expect(document.activeElement).toBe(container.querySelector('button[aria-label="Rename"]'));
});

it('cancels on Escape and restores empty or unchanged drafts without saving', async () => {
  await render();
  await startRename(); await typeName('Discard this'); await nameKey('Escape');
  expect(nameInput()).toBeNull();
  await startRename();
  expect(nameInput()?.value).toBe('Landscape');
  await typeName('   '); await act(async () => nameInput()!.blur());
  await startRename(); await nameKey('Enter');
  expect(nameInput()).toBeNull();
  expect(update).not.toHaveBeenCalled();
});

it('ignores IME confirmation and does not submit twice when Enter is followed by blur', async () => {
  let resolve!: (saved: boolean) => void;
  update.mockImplementationOnce(() => new Promise<boolean>(done => { resolve = done; }));
  await render();
  const input = await startRename();
  await typeName('新的素材名称'); await nameKey('Enter', true);
  expect(update).not.toHaveBeenCalled();
  await nameKey('Enter');
  await act(async () => input.blur());
  expect(update).toHaveBeenCalledExactlyOnceWith({ name: '新的素材名称' });
  expect(input.readOnly).toBe(true);
  await act(async () => resolve(true));
  expect(nameInput()).toBeNull();
});

it('saves on blur and keeps a failed draft available for retry', async () => {
  update.mockResolvedValueOnce(false);
  await render();
  await startRename(); await typeName('Retry this name');
  await act(async () => nameInput()!.blur());
  expect(update).toHaveBeenCalledExactlyOnceWith({ name: 'Retry this name' });
  expect(nameInput()?.value).toBe('Retry this name');
  await nameKey('Enter');
  expect(update).toHaveBeenCalledTimes(2);
  expect(nameInput()).toBeNull();
});

it('discards a draft when the selected asset changes', async () => {
  await render();
  await startRename(); await typeName('Old asset draft');
  await render('v2', undefined, { ...asset, id: 'asset-2', name: 'Second asset' });
  expect(nameInput()).toBeNull();
  expect(container.querySelector('.om-asset-name-display')?.textContent).toBe('Second asset');
  await startRename(); expect(nameInput()?.value).toBe('Second asset');
  expect(update).not.toHaveBeenCalled();
});

it('reveals a clipped action label only on overflow and rechecks resized or translated text without changing the action', async () => {
  vi.useFakeTimers();
  const observers: ResizeObserverStub[] = [];
  class ResizeObserverStub {
    target?: Element;
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.target = target; }
    disconnect() { this.target = undefined; }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  const fullLabel = 'Edit this asset as a completely new version while keeping the original';
  translations['Edit as new version'] = fullLabel;
  await render();
  const action = button(fullLabel);
  const label = action.querySelector<HTMLElement>('.om-asset-version-action-label')!;
  let width = 500;
  Object.defineProperties(label, { clientWidth: { get: () => width }, scrollWidth: { get: () => 400 } });
  const resize = () => {
    const observer = observers.find(item => item.target === label)!;
    observer.callback([], observer as unknown as ResizeObserver);
  };
  const hover = async () => {
    await act(async () => {
      action.parentElement!.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, composed: true }));
      action.parentElement!.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, composed: true }));
      action.parentElement!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
      await vi.advanceTimersByTimeAsync(250);
    });
  };
  await act(async () => resize()); await hover();
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  await act(async () => { width = 120; resize(); }); await hover();
  expect(document.querySelector('[role=tooltip]')?.textContent).toBe(fullLabel);
  translations['Edit as new version'] = 'Edit as another version';
  await render(); await hover();
  expect(document.querySelector('[role=tooltip]')?.textContent).toBe('Edit as another version');
  await act(async () => { width = 500; resize(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(document.querySelector('[role=tooltip]')).toBeNull();
  expect(action.hasAttribute('aria-describedby')).toBe(false);
  await act(async () => action.click());
  expect(edit).toHaveBeenCalledOnce();
});
