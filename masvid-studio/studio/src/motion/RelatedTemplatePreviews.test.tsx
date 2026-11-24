// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GalleryTemplate } from '../../../shared/catalog';
import { I18nProvider } from '../i18n/I18n';
import { RelatedTemplatePreviews } from './RelatedTemplatePreviews';

const telemetry = vi.hoisted(() => ({ section: vi.fn(), card: vi.fn() }));
vi.mock('./templateLibraryTracking', () => ({ reportRelatedShown: telemetry.section, reportRelatedCardShown: telemetry.card }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, dialog: HTMLDialogElement, host: HTMLDivElement;
let reducedMotion: EventTarget & { matches: boolean };
const templates = ['First', 'Second', 'Poster only'].map((title, index) => ({
  id: String(index), title, posterUrl: `/${index}.jpg`, previewUrl: index < 2 ? `/${index}.mp4` : undefined,
})) as GalleryTemplate[];
const select = vi.fn();
beforeEach(() => {
  telemetry.section.mockClear(); telemetry.card.mockClear();
  reducedMotion = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', (query: string) => query.includes('reduced-motion') ? reducedMotion : Object.assign(new EventTarget(), { matches: false }));
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function () { this.dispatchEvent(new Event('playing')); });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  dialog = document.createElement('dialog'); host = document.createElement('div');
  dialog.append(host); document.body.append(dialog); dialog.showModal(); root = createRoot(host); select.mockClear();
});
afterEach(() => { act(() => root.unmount()); dialog.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function mount() {
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews templates={templates} panel={{ current: host }} onSelect={select} /></I18nProvider>));
}
const card = (title: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="Preview template ${title}"]`)!;
const player = () => dialog.querySelector<HTMLVideoElement>('video[src]');
async function focus(title: string) {
  await act(async () => { card(title).focus(); await new Promise(resolve => setTimeout(resolve, 180)); });
}
it('lazily previews one focused card inside the dialog and preserves click selection', async () => {
  await mount(); expect(player()).toBeNull();
  await focus('First');
  const first = player()!;
  expect(first.getAttribute('src')).toBe('/0.mp4');
  expect(first.muted && first.loop && first.hasAttribute('playsinline')).toBe(true);
  expect(first.closest('dialog')).toBe(dialog);
  expect(select).not.toHaveBeenCalled();
  await focus('Second');
  expect(dialog.querySelectorAll('video[src]')).toHaveLength(1);
  expect(first.hasAttribute('src')).toBe(false);
  expect(first.pause).toHaveBeenCalled();
  expect(player()?.getAttribute('src')).toBe('/1.mp4');
  await act(async () => card('Second').click());
  expect(select).toHaveBeenCalledWith(templates[1], 2);
  expect(player()).toBeNull();
});
it('dismisses preview media with Escape, scrolling and page visibility changes', async () => {
  await mount(); await focus('First');
  await act(async () => card('First').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(player()).toBeNull(); expect(dialog.open).toBe(true);
  await focus('Second'); expect(player()).not.toBeNull();
  const popup = dialog.querySelector('div[aria-label="Second"]')!;
  await act(async () => popup.dispatchEvent(new Event('scroll')));
  expect(player()).not.toBeNull();
  await act(async () => host.dispatchEvent(new Event('scroll')));
  expect(player()).toBeNull();
  await focus('First'); const previous = player()!;
  await act(async () => { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
  expect(player()).toBeNull(); expect(previous.hasAttribute('src')).toBe(false);
});
it('keeps poster-only and reduced-motion previews free of video requests', async () => {
  reducedMotion.matches = true;
  await mount(); await focus('First');
  expect(player()).toBeNull(); expect(dialog.querySelector('img[src="/0.jpg"]')).not.toBeNull();
  await act(async () => { reducedMotion.matches = false; reducedMotion.dispatchEvent(new Event('change')); });
  expect(player()).not.toBeNull();
  await act(async () => { reducedMotion.matches = true; reducedMotion.dispatchEvent(new Event('change')); });
  expect(player()).toBeNull();
  await focus('Poster only');
  expect(player()).toBeNull(); expect(dialog.querySelector('[role=status]')).toBeNull();
});
it('recovers from blocked or failed playback without trapping a loading state', async () => {
  vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(new Error('Autoplay blocked'));
  await mount(); await focus('First');
  expect(player()).toBeNull();
  expect(dialog.querySelector('[role=status]')?.textContent).toContain('Preview unavailable. Try again.');
  await act(async () => [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
  expect(player()?.getAttribute('src')).toBe('/0.mp4');
  await act(async () => player()!.dispatchEvent(new Event('error')));
  expect(player()).toBeNull();
  expect(dialog.querySelector('[role=status]')?.textContent).toContain('Preview unavailable. Try again.');
});
it('ignores a late playback rejection after switching to another card', async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(HTMLMediaElement.prototype.play).mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  await mount(); await focus('First'); await focus('Second');
  await act(async () => reject(new Error('Previous player stopped')));
  expect(player()?.getAttribute('src')).toBe('/1.mp4');
  expect(dialog.querySelector('[role=status]')).toBeNull();
});

it('reuses masonry cards and their hover content with two visible players and no popup', async () => {
  let report!: (entries: { target: Element; isIntersecting: boolean; intersectionRatio: number }[]) => void;
  const observed: Element[] = [];
  const disconnect = vi.fn();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: typeof report) { report = callback; }
    observe(element: Element) { observed.push(element); }
    disconnect = disconnect;
  });
  const shelfItems = [...templates, { ...templates[0], id: 'extra', title: 'Extra' }].map(item => ({ ...item, uses: ['Product launch films'] }));
  const currentTemplate = { id: 'current', uses: ['Product launch'] } as GalleryTemplate;
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide currentTemplate={currentTemplate} templates={shelfItems} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  expect(host.querySelector('.om-gallery-masonry')).not.toBeNull();
  expect(host.querySelector('section.om-gallery-results')).not.toBeNull();
  expect(host.querySelector('.om-mcp-template-caption')).toBeNull();
  expect(host.querySelectorAll('.om-gallery-card')).toHaveLength(4);
  expect(card('First').querySelector('.om-gallery-card-top')).not.toBeNull();
  expect(card('First').querySelector('.om-gallery-card-caption strong')?.textContent).toBe('First');
  expect(host.querySelector('.om-gallery-card-footer')).toBeNull();
  expect(host.querySelector('section > header h3')?.textContent).toBe('Similar templates');
  expect(host.querySelector('section > header p')?.textContent).toBe('Product launch films');
  expect(player()).toBeNull();
  await act(async () => report(observed.map(target => ({ target, isIntersecting: true, intersectionRatio: 1 }))));
  expect(dialog.querySelectorAll('video[src]')).toHaveLength(2);
  expect(dialog.querySelector('[data-base-ui-portal]')).toBeNull();
  await act(async () => card('Extra').focus());
  expect(dialog.querySelector('[data-template-id="extra"] video[src]')).not.toBeNull();
  expect(dialog.querySelectorAll('video[src]')).toHaveLength(2);
  await act(async () => { vi.spyOn(document, 'hidden', 'get').mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
  expect(player()).toBeNull();
  await act(async () => { vi.spyOn(document, 'hidden', 'get').mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
  expect(dialog.querySelectorAll('video[src]')).toHaveLength(2);
  await act(async () => report(observed.map(target => ({ target, isIntersecting: false, intersectionRatio: 0 }))));
  expect(player()).toBeNull();
  await act(async () => card('Second').click());
  expect(select).toHaveBeenCalledWith(shelfItems[1], 2);
  expect(dialog.querySelectorAll('dialog')).toHaveLength(0);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalled();
});

it('fills two rows using the shared masonry column count and updates on resize', async () => {
  let columns = 4;
  let resize!: () => void;
  const disconnect = vi.fn();
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ columnCount: String(columns) }) as CSSStyleDeclaration);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const shelfItems = Array.from({ length: 10 }, (_, index) => ({ ...templates[0], id: `shelf-${index}`, title: `Shelf ${index}` }));
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide templates={shelfItems} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  const ids = () => [...host.querySelectorAll<HTMLElement>('.om-gallery-masonry > .om-gallery-card')].map(item => item.dataset.templateId);
  expect(ids()).toEqual(shelfItems.slice(0, 8).map(item => item.id));
  for (const count of [5, 3, 2, 4]) {
    await act(async () => { columns = count; resize(); });
    expect(ids()).toEqual(shelfItems.slice(0, count * 2).map(item => item.id));
  }
  await act(async () => card('Shelf 7').click());
  expect(select).toHaveBeenCalledWith(shelfItems[7], 8);
  await act(async () => root.render(null));
  expect(disconnect).toHaveBeenCalled();
});

it('does not stretch a short related list with placeholders or unrelated cards', async () => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ columnCount: '4' }) as CSSStyleDeclaration);
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide templates={templates.slice(0, 2)} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  const masonry = host.querySelector('.om-gallery-masonry')!;
  expect(masonry.children).toHaveLength(2);
  expect([...masonry.children].map(item => item.getAttribute('data-template-id'))).toEqual(['0', '1']);
  expect(host.querySelector('section > header p')).toBeNull();
});

it.each([
  { locale: 'en', motion: 'Interface animation', heading: 'Similar templates', context: 'Product demos & explainers · Interface animation' },
  { locale: 'zh-CN', motion: '界面动效', heading: '相似模板', context: '产品功能演示 · 界面动效' },
] as const)('shows concise shared labels in $locale', async ({ locale, motion, heading, context }) => {
  const currentTemplate = { id: 'current', uses: ['Product demo'], styles: [motion] } as GalleryTemplate;
  const shelfItems = templates.map(item => ({ ...item, uses: ['Product demo'], styles: [motion] }));
  await act(async () => root.render(<I18nProvider initialLocale={locale}><RelatedTemplatePreviews wide currentTemplate={currentTemplate} templates={shelfItems} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  expect(host.querySelector('section > header h3')?.textContent).toBe(heading);
  expect(host.querySelector('section > header p')?.textContent).toBe(context);
  expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(heading);
  expect(host.querySelector('section > header button')).toBeNull();
});

it('does not label a mixed shelf as one common purpose or motion', async () => {
  const currentTemplate = { id: 'current', uses: ['Product demo'], styles: ['Interface animation'] } as GalleryTemplate;
  const shelfItems = [
    { ...templates[0], uses: ['Product demo'] },
    { ...templates[1], styles: ['Interface animation'] },
  ];
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide currentTemplate={currentTemplate} templates={shelfItems} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  expect(host.querySelector('section > header p')?.textContent).toBe('Similar purpose or motion');
});

it('shows only the common motion when recommended purposes differ', async () => {
  const currentTemplate = { id: 'current', uses: ['Product demo'], styles: ['Interface animation'] } as GalleryTemplate;
  const shelfItems = [
    { ...templates[0], uses: ['Product demo'], styles: ['Interface animation'] },
    { ...templates[1], uses: ['Product launch'], styles: ['Interface animation'] },
  ];
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide currentTemplate={currentTemplate} templates={shelfItems} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  expect(host.querySelector('section > header p')?.textContent).toBe('Interface animation');
});

it('counts related impressions only after half-visible for one second and preserves the source detail', async () => {
  vi.useFakeTimers();
  const observers: { callback: (entries: unknown[]) => void; threshold: unknown; elements: Element[] }[] = [];
  vi.stubGlobal('IntersectionObserver', class {
    entry: typeof observers[number];
    constructor(callback: (entries: unknown[]) => void, options: IntersectionObserverInit) { this.entry = { callback, threshold: options.threshold, elements: [] }; observers.push(this.entry); }
    observe(element: Element) { this.entry.elements.push(element); }
    disconnect() {}
  });
  const currentTemplate = { id: 'current' } as GalleryTemplate;
  const view = { id: crypto.randomUUID(), placement: 'catalog' as const };
  await act(async () => root.render(<I18nProvider initialLocale="en"><RelatedTemplatePreviews wide currentTemplate={currentTemplate} detailView={view} templates={templates} panel={{ current: host }} onSelect={select} /></I18nProvider>));
  const impression = observers.find(item => item.threshold === 0.5)!;
  const emit = (ratio: number) => impression.callback(impression.elements.map(target => ({ target, intersectionRatio: ratio, isIntersecting: ratio > 0 })));
  await act(async () => { emit(0.49); await vi.advanceTimersByTimeAsync(1000); });
  expect(telemetry.card).not.toHaveBeenCalled();
  await act(async () => { emit(0.5); await vi.advanceTimersByTimeAsync(999); });
  expect(telemetry.card).not.toHaveBeenCalled();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(telemetry.section).toHaveBeenCalledExactlyOnceWith(currentTemplate, 3, view);
  expect(telemetry.card).toHaveBeenCalledTimes(3);
  expect(telemetry.card).toHaveBeenNthCalledWith(2, templates[1], 2, currentTemplate, view);
  await act(async () => { emit(1); await vi.advanceTimersByTimeAsync(2000); });
  expect(telemetry.card).toHaveBeenCalledTimes(3);
});
