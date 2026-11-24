// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider, useI18n, type Locale } from '../i18n/I18n';
import { translate } from '../i18n/messages';
import { TemplateLibraryDialog } from './TemplateLibraryDialog';
import { MAX_TEMPLATE_PLAYERS } from './useTemplatePlayback';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';
import { TemplatePreparationBlockedError, pendingTemplateProjects } from './templateHandoff';

const tracked = vi.hoisted(() => [] as { event: string; properties: Record<string, unknown> }[]);
vi.mock('./tracking', () => ({ trackMotion: async (event: string, properties: Record<string, unknown>) => { tracked.push({ event, properties }); return 'queued'; } }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const items = [
  { id: 'one', title: 'First', author: 'Author', authorName: 'Ada Designer', authorAvatarUrl: '/ada.jpg', brand: 'Figma', uses: ['Product launch', 'Product demo'], styles: ['UI'], tags: ['clean'], kind: 'prism', hasHtmlProject: true, sortOrder: 2, featuredOrder: 0, duration: 12, width: 1920, height: 1080, motionDocumentUrl: 'https://example.com/motion.zip', motionGuideUrl: 'https://example.com/guide', styleDescription: 'Visual rules', reviewFocus: 'Production rules', posterUrl: '/one.jpg', previewUrl: '/one.mp4' },
  { id: 'two', title: 'Second', author: 'Author', brand: 'Other', uses: ['Product launch'], styles: ['UI'], tags: ['clean'], kind: 'prism', hasHtmlProject: false, sortOrder: 1, duration: 30, posterUrl: '/two.jpg', previewUrl: '/two.mp4' },
  { id: 'three', title: 'Third', author: 'Elsewhere', brand: 'Other', uses: ['Brand promotion'], styles: ['3D'], tags: [], kind: 'prism', hasHtmlProject: false, sortOrder: 3, posterUrl: '/three.jpg' },
];
class Observer {
  static instances: Observer[] = [];
  elements: Element[] = [];
  disconnected = false;
  constructor(public callback: IntersectionObserverCallback, public options?: IntersectionObserverInit) { Observer.instances.push(this); }
  observe(element: Element) { this.elements.push(element); }
  disconnect() { this.disconnected = true; }
  emit(ratio = 1, subset = this.elements) { this.callback(subset.map(target => ({ target, isIntersecting: ratio > 0, intersectionRatio: ratio }) as IntersectionObserverEntry), this as unknown as IntersectionObserver); }
}
let motionPreference: EventTarget & { matches: boolean };
function fetchItems(data = items, templateSource?: 'repository' | 'cms') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/integration') ? { templateSource, templateEnvironment: 'dev', transport: { env: {} } } : url.endsWith('/projects') ? { projects: [], sessions: [] } : { items: data, catalogVersion: 'v1', next: null, total: data.length })));
}
beforeEach(() => {
  sessionStorage.setItem('motion.template-handoff.preview', '0');
  window.happyDOM.settings.enableIframePageLoading = false;
  Observer.instances = []; tracked.length = 0;
  vi.stubGlobal('IntersectionObserver', Observer);
  motionPreference = Object.assign(new EventTarget(), { matches: false });
  vi.stubGlobal('matchMedia', vi.fn(() => motionPreference));
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async function () { this.dispatchEvent(new Event('playing')); });
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  fetchItems();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const button = (label: string, scope: ParentNode = host) => [...scope.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!;
const cards = () => [...host.querySelectorAll('[data-template-id]')].map(el => el.getAttribute('data-template-id'));
const current = () => host.querySelector('dialog[aria-label="Template preview"] h2')?.textContent;
const preview = (title: string) => button(`Preview template ${title}`, host.querySelector('main')!).click();
const observer = () => Observer.instances.filter(item => !item.disconnected).at(-1)!;
const loadedVideos = () => host.querySelectorAll('main video[src]');
async function mount(locale: Locale = 'en', onOpen = vi.fn()) {
  await act(async () => root.render(<I18nProvider initialLocale={locale}><TemplateLibraryDialog open busy={false} error="" onClose={() => {}} onOpen={onOpen} /></I18nProvider>));
  return onOpen;
}
async function search(value: string) {
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const recovery = () => host.querySelector<HTMLElement>('section[aria-label="Find another starting point"]')!;
async function fill(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const searchInput = () => host.querySelector<HTMLInputElement>('input[type=search]')!;
const confirmSearch = () => act(async () => searchInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
const clearKeyword = () => act(async () => button(`Remove filter ${searchInput().value}`).click());
it('shows all Black Friday templates in one masonry gallery and previews them in order', async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog collection="black-friday" open busy={false} error="" onClose={onClose} onOpen={vi.fn()} /></I18nProvider>));
  expect(host.querySelector('[aria-label="Video purpose"]')).toBeNull();
  const banner = host.querySelector('[data-black-friday] header')!;
  expect(banner.querySelector('h1')?.textContent).toBe('Black Friday');
  expect(button('Back to Explore', banner)).toBeTruthy();
  expect(banner.querySelectorAll('button')).toHaveLength(1);
  expect(cards()).toHaveLength(59);
  const galleries = host.querySelectorAll('[data-black-friday] .om-gallery-masonry');
  expect(galleries).toHaveLength(1);
  expect(galleries[0].querySelectorAll(':scope > .om-gallery-card')).toHaveLength(59);
  expect(galleries[0].querySelector('.om-gallery-avatar')).toBeNull();
  expect(galleries[0].querySelector('.om-gallery-card-caption small')?.textContent).toBe('Zzz_Futurist');
  expect([...host.querySelectorAll('[data-black-friday] h2')].map(heading => heading.textContent)).toEqual(['Black Friday templates']);
  expect(host.querySelector('[data-black-friday] .ui-text-link')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[data-black-friday] h1'));
  const filters = host.querySelector('nav[aria-label="Black Friday collection"]')!;
  expect(filters.previousElementSibling?.textContent).toBe('Black Friday templates');
  expect(filters.nextElementSibling?.querySelector('input[type=search]')).toBe(searchInput());
  expect(host.querySelector('header .om-gallery-page-label, header .om-gallery-header-actions')).toBeNull();
  const all = button('All', filters);
  expect(filters.querySelector('button[aria-pressed="true"]')).toBe(all);
  for (const [label, count] of [['Before the sale', 5], ['Sale launch', 48], ['Cyber Monday and last call', 6]] as const) {
    const stage = button(label, filters);
    await act(async () => stage.click());
    expect([...filters.querySelectorAll('button[aria-pressed="true"]')]).toEqual([stage]);
    expect(cards()).toHaveLength(count);
  }
  await act(async () => all.click());
  expect(cards()).toHaveLength(59);
  const playback = observer();
  const visibleCards = playback.elements.slice(0, 2);
  act(() => playback.emit(1, visibleCards));
  expect(loadedVideos()).toHaveLength(2);
  act(() => playback.emit(0, visibleCards));
  expect(loadedVideos()).toHaveLength(0);
  await act(async () => preview('Black Friday | 3D Type and Product Reveal'));
  expect(current()).toBe('Black Friday | 3D Type and Product Reveal');
  expect(events('ui_click', { area: 'template_card', element: 'open_detail' }).at(-1)).toMatchObject({ placement: 'black_friday' });
  const detail = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
  await act(async () => button('Next template', detail).click());
  expect(current()).toBe('Agentcard | Black-and-Gold Type and Card Launch');
  await act(async () => button('Next template', detail).click());
  expect(current()).toBe('Black Friday | Adobe — Illustrated A Monogram');
  await act(async () => button('Close template preview', detail).click());
  await act(async () => button('Back to Explore').click());
  expect(onClose).toHaveBeenCalledOnce();
});

it('omits the project return in both the template library and Black Friday details', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const template = { ...items[1], id: 'black-friday-a5238e113514', title: 'Black Friday | 3D Type and Product Reveal' };
  fetchItems([template]);

  for (const blackFriday of [true, false]) {
    await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog key={String(blackFriday)} collection={blackFriday ? 'black-friday' : null} open inWorkspace busy={false} error="" onClose={vi.fn()} onOpen={vi.fn()} /></I18nProvider>));
    await act(async () => preview(template.title));
    const detail = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
    expect(detail.open).toBe(true);
    expect(current()).toBe(template.title);
    expect(button('Back to current project', detail)).toBeUndefined();
    await act(async () => button('Close template preview', detail).click());
  }
});

it('keeps the search in the header and preserves filters when clearing the keyword', async () => {
  await mount();
  expect(host.querySelectorAll('input[type=search]')).toHaveLength(1);
  expect(searchInput().closest('header')?.querySelector('a[href*="github.com"]')).toBeNull();
  await act(async () => button('Brand & company films').click());
  await search('not-here');
  await confirmSearch();
  await clearKeyword();
  expect(cards()).toEqual(['three']);
  expect(button('Remove filter Brand & company films')).toBeDefined();
  await act(async () => button('Clear filters').click());
  await search('Figma');
  await confirmSearch();
  expect(cards()).toEqual(['one']);
  expect(events('template_search_result').at(-1)).toMatchObject({ search_keyword: 'Figma', result_count: 1 });
});
it('opens the reference-link form from each category without changing browsing or creating a search', async () => {
  await mount();
  const actionLabel = 'Paste a video link to make your own';
  for (const category of ['All', 'TOP 100 brands', 'Product demos & explainers', 'Brand & company films']) {
    await act(async () => button(category).click());
    expect(button(actionLabel)).toBeDefined();
  }
  const intro = host.querySelector('.om-gallery-intro')!;
  const trigger = button(actionLabel, intro);
  const actions = intro.querySelector('.om-gallery-intro-actions')!;
  expect(actions.querySelector('a')?.textContent).toBe('Submit template');
  expect(actions.querySelector('a')?.classList.contains('om-gallery-submit')).toBe(true);
  expect(button('Surprise me', actions).classList.contains('om-gallery-surprise')).toBe(true);
  expect(actions.nextElementSibling?.contains(trigger)).toBe(true);
  expect(trigger.hasAttribute('data-primary')).toBe(false);
  expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
  const initialCards = cards();
  expect(events('surface_view', { element: 'reference' })).toHaveLength(0);
  await act(async () => trigger.click());
  const [referenceImpression] = events('surface_view', { element: 'reference' });
  expect(referenceImpression).toMatchObject({ reference_entry: 'library_home', result_set_id: expect.any(String) });
  const popup = host.querySelector<HTMLDialogElement>('dialog[data-search-recovery][open]')!;
  const input = popup.querySelector<HTMLInputElement>('input[type=url]')!;
  expect(document.activeElement).toBe(input);
  expect(button('Copy request', popup).disabled).toBe(true);
  const link = 'https://example.com/reference.mp4';
  await fill(input, link);
  await act(async () => button('Copy request', popup).click());
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining(link));
  expect(events('ui_click', { element: 'reference', reference_entry: 'library_home' })).toHaveLength(1);
  expect(events('template_search_handoff_result').at(-1)).toMatchObject({
    reference_entry: 'library_home', source_kind: 'link', handoff_status: 'clipboard_written',
  });
  expect(events('template_search_result')).toHaveLength(0);
  expect(JSON.stringify(tracked)).not.toContain(link);
  for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
  await act(async () => button('Local video', popup).click());
  const picker = popup.querySelector('input[type=file]')!;
  await act(async () => button('Choose local video', popup).click());
  await act(async () => picker.dispatchEvent(new Event('cancel', { bubbles: true })));
  expect(events('ui_click', { element: 'choose_local_video' })).toEqual([expect.objectContaining({
    reference_entry: 'library_home', source_kind: 'local', result_set_id: referenceImpression.result_set_id,
  })]);
  expect(events('studio_asset_import_result')).toHaveLength(0);
  expect(popup.open).toBe(true);
  expect(button('Copy request', popup).disabled).toBe(true);
  await act(async () => popup.dispatchEvent(new Event('cancel', { cancelable: true, bubbles: true })));
  expect(host.querySelector('dialog[data-search-recovery]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(cards()).toEqual(initialCards);
  expect(button('Brand & company films').getAttribute('aria-pressed')).toBe('true');
  expect(searchInput().value).toBe('');
  await act(async () => trigger.click());
  expect(events('surface_view', { element: 'reference' })).toHaveLength(1);
});
it('counts the home reference entry after visible dwell once per result set', async () => {
  vi.useFakeTimers();
  try {
    await mount();
    const impressions = () => events('surface_view', { element: 'reference', reference_entry: 'library_home' });
    const currentObserver = () => Observer.instances.findLast(instance => !instance.disconnected &&
      instance.elements.some(element => element.hasAttribute('data-reference-entry')))!;
    const initial = currentObserver();
    initial.emit(0.49);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(impressions()).toHaveLength(0);
    initial.emit(0.5);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(impressions()).toHaveLength(1);
    initial.emit();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(impressions()).toHaveLength(1);
    await act(async () => button('Brand & company films').click());
    currentObserver().emit();
    await act(async () => vi.advanceTimersByTime(1000));
    expect(impressions()).toHaveLength(2);
    expect(impressions()[0].result_set_id).not.toBe(impressions()[1].result_set_id);
  } finally { vi.useRealTimers(); }
});
it('commits Enter and debounce once, never commits IME text, and counts A to B to A as three searches', async () => {
  vi.useFakeTimers();
  try {
    await mount();
    const input = host.querySelector<HTMLInputElement>('input[type=search]')!;
    await act(async () => input.dispatchEvent(new Event('compositionstart', { bubbles: true })));
    await search('产品');
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(events('template_search_result')).toHaveLength(0);
    await confirmSearch();
    expect(events('template_search_result')).toHaveLength(0);
    expect(recovery()).toBeNull();
    await act(async () => input.dispatchEvent(new Event('compositionend', { bubbles: true })));
    await search('Ada');
    await confirmSearch();
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(events('template_search_result')).toHaveLength(1);
    await search('Other');
    await act(async () => { vi.advanceTimersByTime(500); });
    await search('Ada');
    await confirmSearch();
    const results = events('template_search_result');
    expect(results.map(result => result.search_keyword)).toEqual(['Ada', 'Other', 'Ada']);
    expect(new Set(results.map(result => result.search_id)).size).toBe(3);
    expect(new Set(results.map(result => result.discovery_id)).size).toBe(1);
    expect(new Set(results.map(result => result.result_set_id)).size).toBe(3);
    await act(async () => preview('First'));
    expect(events('surface_view', { area: 'template_detail' }).at(-1)).toMatchObject({ search_id: results[2].search_id, discovery_id: results[2].discovery_id, result_set_id: results[2].result_set_id });
  } finally { vi.useRealTimers(); }
});
it('prepares link and local-video instructions, retains drafts and distinguishes copy failure from sending', async () => {
  await mount(); await search('missing');
  await confirmSearch();
  await act(async () => button('Make a video from a reference', recovery()).click());
  expect(button('Copy request', recovery()).disabled).toBe(true);
  await fill(recovery().querySelector<HTMLInputElement>('input[type=url]')!, 'javascript:alert(1)');
  expect(button('Copy request', recovery()).disabled).toBe(true);
  const reference = 'https://example.com/private-reference';
  await fill(recovery().querySelector<HTMLInputElement>('input[type=url]')!, reference);
  await fill(recovery().querySelector('textarea')!, 'Private creative notes');
  await act(async () => button('Copy request', recovery()).click());
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining(reference));
  expect(events('template_search_handoff_result').at(-1)).toMatchObject({ source_kind: 'link', handoff_status: 'clipboard_written' });
  expect(document.querySelector('[data-feedback-layer]')?.textContent).toContain('Paste the request in your chat and send it.');
  await act(async () => button('Back', recovery()).click());
  await act(async () => button('Make a video from a reference', recovery()).click());
  expect(recovery().querySelector<HTMLInputElement>('input[type=url]')!.value).toBe(reference);
  await act(async () => button('Local video', recovery()).click());
  await act(async () => button('Local video', recovery()).click());
  const searchContext = events('template_search_result').at(-1)!;
  expect(events('ui_click', { element: 'reference_source_select' })).toEqual([expect.objectContaining({
    source_kind: 'local', result_set_id: searchContext.result_set_id, search_id: searchContext.search_id,
  })]);
  expect(button('Copy request', recovery()).disabled).toBe(true);
  const picker = recovery().querySelector<HTMLInputElement>('input[type=file]')!;
  expect(picker.accept).toBe('video/*');
  const file = new File(['video'], 'private-reference.mp4', { type: 'video/mp4' });
  const asset = { id: 'pinned-asset', modality: 'video', currentVersionId: 'pinned-version', versions: [{ id: 'pinned-version' }] };
  Object.defineProperty(picker, 'files', { value: [file] });
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Unsupported media type' }, { status: 400 }));
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  expect(button('Copy request', recovery()).disabled).toBe(true);
  expect(document.querySelector('[data-feedback-layer]')?.textContent).toContain('Choose a readable video file.');
  vi.mocked(fetch).mockRejectedValueOnce(new Error('private network error'));
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  expect(button('Copy request', recovery()).disabled).toBe(true);
  const upload = Promise.withResolvers<Response>();
  vi.mocked(fetch).mockReturnValueOnce(upload.promise);
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));
  expect(button('Copy request', recovery()).disabled).toBe(true);
  expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('modality=video'), expect.objectContaining({ body: file }));
  await act(async () => upload.resolve(Response.json({ asset })));
  expect(button('Copy request', recovery()).disabled).toBe(false);
  expect(button('Replace video', recovery())).toBeDefined();
  expect(recovery().textContent).toContain(file.name);
  expect(events('studio_asset_import_result')).toEqual([
    expect.objectContaining({ entry_point: 'template_reference', outcome: 'failure', failed_count: 1, error_category: 'unsupported_format' }),
    expect.objectContaining({ entry_point: 'template_reference', outcome: 'unknown', failed_count: 0, unknown_count: 1 }),
    expect.objectContaining({ entry_point: 'template_reference', outcome: 'success', added_count: 1 }),
  ]);
  expect(events('studio_asset_import_result').every(event => event.result_set_id === searchContext.result_set_id &&
    event.search_id === searchContext.search_id && event.reference_entry === undefined)).toBe(true);
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
  await act(async () => button('Copy request', recovery()).click());
  expect(events('template_search_handoff_result').at(-1)).toMatchObject({ source_kind: 'local', handoff_status: 'manual_fallback' });
  const manual = recovery().querySelector<HTMLTextAreaElement>('textarea[readonly]')!;
  expect(manual.value).toContain('openmotion_assets_use {"action":"read","assetId":"pinned-asset","versionId":"pinned-version"}');
  expect(manual.value).toContain('/motion-api/assets/pinned-asset/versions/pinned-version/file');
  expect(JSON.stringify(tracked)).not.toContain(file.name);
  expect(JSON.stringify(tracked)).not.toContain(asset.id);
  expect(JSON.stringify(tracked)).not.toContain('private network error');
  expect(manual.value).not.toContain(reference);
  expect(JSON.stringify(tracked)).not.toContain(reference);
  expect(JSON.stringify(tracked)).not.toContain('Private creative notes');
  for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
});
it('retains the selected video and notes while changing the search or a category', async () => {
  await mount();
  await search('missing');
  await confirmSearch();
  const initialResult = events('template_search_result').at(-1)!;
  await act(async () => button('Make a video from a reference', recovery()).click());
  await act(async () => button('Local video', recovery()).click());
  const notes = 'Keep the opening transition';
  await fill(recovery().querySelector('textarea')!, notes);
  const video = new File(['video'], 'sample.mp4', { type: 'video/mp4' });
  const picker = recovery().querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(picker, 'files', { value: [video] });
  const upload = Promise.withResolvers<Response>();
  vi.mocked(fetch).mockReturnValueOnce(upload.promise);
  await act(async () => picker.dispatchEvent(new Event('change', { bubbles: true })));

  searchInput().focus();
  await search('still missing');
  expect(recovery()).toBeNull();
  const asset = { id: 'reference-asset', modality: 'video', currentVersionId: 'original', versions: [{ id: 'original' }] };
  await act(async () => upload.resolve(Response.json({ asset })));
  expect(events('studio_asset_import_result').at(-1)).toMatchObject({
    outcome: 'success', result_set_id: initialResult.result_set_id,
  });
  await confirmSearch();
  expect(document.activeElement).toBe(searchInput());
  expect(recovery().querySelector('textarea')?.value).toBe(notes);

  await act(async () => button('Brand & company films').click());
  expect(recovery().textContent).toContain(video.name);
  expect(recovery().querySelector('textarea')?.value).toBe(notes);
  await act(async () => button('Copy request', recovery()).click());
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('"assetId":"reference-asset","versionId":"original"'));
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining(notes));
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.body === video)).toHaveLength(1);

  await act(async () => button('Video link', recovery()).click());
  const link = 'https://example.com/video.mp4';
  await fill(recovery().querySelector<HTMLInputElement>('input[type=url]')!, link);
  searchInput().focus();
  await search('another missing result');
  await confirmSearch();
  expect(document.activeElement).toBe(searchInput());
  expect(recovery().querySelector<HTMLInputElement>('input[type=url]')?.value).toBe(link);
});
it('keeps description inside the creation path and hides unavailable request intake', async () => {
  await mount();
  await act(async () => button('Nothing suitable?').click());
  expect(button('Describe your video', recovery())).toBeUndefined();
  await act(async () => button('Make a video from a reference', recovery()).click());
  await act(async () => button('Describe your video', recovery()).click());
  const copyRequest = button('Copy request', recovery());
  expect(copyRequest.disabled).toBe(true);
  expect(copyRequest.parentElement?.nextElementSibling?.textContent).toContain('Connect an Agent');
  await fill(recovery().querySelector('textarea')!, 'An original launch film');
  await act(async () => copyRequest.click());
  expect(events('template_search_handoff_result').at(-1)).toMatchObject({ source_kind: 'description', handoff_status: 'clipboard_written' });
  expect(button('Request a template', recovery())).toBeUndefined();
  expect(JSON.stringify(tracked)).not.toContain('An original launch film');
});
it('offers a verified single-filter recovery without clearing the keyword or unrelated conditions', async () => {
  await mount();
  await act(async () => button('Brand & company films').click());
  await search('Figma');
  await confirmSearch();
  expect(cards()).toHaveLength(0);
  await act(async () => button('Remove Brand & company films · Show 1 template', recovery()).click());
  expect(cards()).toEqual(['one']);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('Figma');
  expect(events('template_filter_result').at(-1)).toMatchObject({ result_count: 1 });
});
it('uses one ordered gallery without a duplicate featured section and combines category, search and facets', async () => {
  await mount();
  expect(host.textContent).not.toContain('Popular templates');
  expect(cards()).toEqual(['two', 'one', 'three']);
  await act(async () => button('Product launch films').click());
  expect(cards()).toEqual(['two', 'one']);
  const gallery = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template library"]')!;
  gallery.scrollTop = 900;
  await search('Ada clean');
  expect(gallery.scrollTop).toBe(0);
  expect(cards()).toEqual(['one']);
  await act(async () => button('Clear filters').click());
  expect(cards()).toEqual(['one']);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('Ada clean');
  await clearKeyword();
  expect(cards()).toHaveLength(3);
  await act(async () => button('Filters').click());
  await act(async () => button('Reference brands').click());
  await act(async () => button('Figma', host.querySelector('[role=dialog][aria-label=Filters]')!).click());
  expect(cards()).toHaveLength(3);
  expect(events('ui_click', { element: 'filter_option' })).toHaveLength(0);
  expect(host.querySelector('[role=dialog][aria-label=Filters]')).not.toBeNull();
  expect(host.querySelectorAll('dialog[open]')).toHaveLength(1);
  await act(async () => button('Apply filters').click());
  expect(cards()).toEqual(['one']);
  expect(events('template_filter_result').at(-1)).toMatchObject({ action: 'filter_apply', result_count: 1 });
  await act(async () => button('Remove filter Figma').click());
  expect(cards()).toHaveLength(3);
});
it.each(['en', 'zh-CN'] as const)('merges launch aliases in quick and grouped filters without losing templates in %s', async locale => {
  fetchItems([
    ...items,
    { ...items[0], id: 'plural', uses: ['Product launches'], sortOrder: 4 },
    { ...items[0], id: 'localized', uses: ['产品发布', 'Product launch films'], sortOrder: 5 },
  ]);
  await mount(locale);
  const t = (message: string) => translate(locale, message);
  const categories = host.querySelector(`[role=group][aria-label="${t('Video purpose')}"]`)!;
  expect([...categories.querySelectorAll('button')].map(node => node.textContent).filter(label => label === t('Product launch films'))).toHaveLength(1);
  expect(categories.textContent).not.toContain('Product launches');
  await act(async () => button(t('Product launch films'), categories).click());
  expect(cards()).toEqual(['two', 'one', 'plural', 'localized']);

  await act(async () => button(t('Clear filters')).click());
  expect(cards()).toHaveLength(5);
  await act(async () => button(t('Filters')).click());
  const filters = host.querySelector(`[role=dialog][aria-label="${t('Filters')}"]`)!;
  expect(filters.querySelectorAll(`[role=checkbox][aria-label="${t('Product launch films')}"]`)).toHaveLength(1);
  expect(filters.textContent).not.toContain('Product launches');
  await act(async () => button(t('Product launch films'), filters).click());
  expect(filters.querySelector('[role=status]')?.textContent).toBe(translate(locale, '{count} templates', { count: 4 }));
  await act(async () => button(t('Apply filters'), filters).click());
  expect(cards()).toEqual(['two', 'one', 'plural', 'localized']);
});
it('shows author avatars and falls back to initials for unavailable images', async () => {
  await mount();
  const card = host.querySelector('[data-template-id="one"]')!;
  const avatar = card.querySelector('img[src="/ada.jpg"]')!;
  await act(async () => avatar.dispatchEvent(new Event('error')));
  expect(card.querySelector('img[src="/ada.jpg"]')).toBeNull();
  expect(card.textContent).toContain('AFirst');
});
it('filters brand templates directly and preserves category, search and reset behavior', async () => {
  fetchItems([
    ...items,
    { ...items[0], id: 'unbranded', brand: '', sortOrder: 4 },
    { ...items[0], id: 'blank-brand', brand: '  ', sortOrder: 5 },
  ]);
  await mount();
  const categories = host.querySelector('[role=group][aria-label="Video purpose"]')!;
  expect(categories.querySelectorAll('button')[1]).toBe(button('TOP 100 brands'));
  expect(cards()).toHaveLength(5);

  await act(async () => button('TOP 100 brands').click());
  expect(cards()).toEqual(['two', 'one', 'three']);
  expect(button('TOP 100 brands').getAttribute('aria-pressed')).toBe('true');
  expect(button('All').getAttribute('aria-pressed')).toBe('false');
  expect(host.querySelector('[role=menu]')).toBeNull();
  expect(events('ui_click', { element: 'category_select', filter_value: 'top-100-brands' })).toEqual([
    expect.objectContaining({ filter_group: 'brand', selected: true, applied_filter_count: 0 }),
  ]);
  expect(events('template_filter_result').at(-1)).toMatchObject({ action: 'category_select', result_count: 3, applied_filter_count: 1 });

  await act(async () => button('Product launch films').click());
  expect(cards()).toEqual(['two', 'one', 'unbranded', 'blank-brand']);
  expect(button('TOP 100 brands').getAttribute('aria-pressed')).toBe('false');
  await act(async () => button('TOP 100 brands').click());
  expect(cards()).toEqual(['two', 'one', 'three']);
  expect(button('Product launch films').getAttribute('aria-pressed')).toBe('false');

  await search('Ada');
  expect(cards()).toEqual(['one']);
  await act(async () => button('Remove filter TOP 100 brands').click());
  expect(cards()).toEqual(['one', 'unbranded', 'blank-brand']);
  expect(events('ui_click', { element: 'filter_option', filter_value: 'top-100-brands' }).at(-1)).toMatchObject({ selected: false, applied_filter_count: 1 });
  expect(events('template_filter_result').at(-1)).toMatchObject({ action: 'filter_apply', result_count: 3, applied_filter_count: 0 });
  await act(async () => button('TOP 100 brands').click());
  await act(async () => button('Clear filters').click());
  expect(cards()).toHaveLength(3);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('Ada');
  await clearKeyword();
  expect(cards()).toHaveLength(5);
  expect(button('All').getAttribute('aria-pressed')).toBe('true');

  await act(async () => button('TOP 100 brands').click());
  await act(async () => button('All').click());
  expect(cards()).toHaveLength(5);
  expect(button('Remove filter TOP 100 brands')).toBeUndefined();
  expect(events('template_filter_result').at(-1)).toMatchObject({ action: 'category_select', result_count: 5, applied_filter_count: 0 });
  for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
});
it('tries the bundled brand logo after a published logo fails, then falls back to initials', async () => {
  fetchItems([{ ...items[0], brand: 'Notion', brandLogoUrl: 'https://example.com/notion.svg' } as typeof items[0]]);
  await mount();
  await act(async () => button('Filters').click());
  await act(async () => button('Reference brands').click());
  const label = button('Notion');
  const image = label.querySelector('img')!;
  expect(image.getAttribute('src')).toBe('https://example.com/notion.svg');
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(image.getAttribute('src')).toMatch(/notion\.png$/);
  await act(async () => image.dispatchEvent(new Event('error')));
  expect(label.querySelector('img')).toBeNull();
  expect(label.textContent).toBe('NNotion');
});
it('copies the shared brief, retains guides and gates editable-project opening', async () => {
  const onOpen = await mount('zh-CN');
  await act(async () => button('预览模板 First', host.querySelector('main')!).click());
  expect(host.querySelector('iframe[title=动效说明]')).toBeNull();
  expect(host.querySelector('a[href="https://example.com/guide"]')).not.toBeNull();
  expect(button('下载 motion.md').disabled).toBe(false);
  await act(async () => button('复刻模板').click());
  expect(host.querySelector('dialog[aria-label=复刻模板]')).toBeNull();
  expect(document.querySelector('[data-feedback-layer]')?.textContent).toContain('已复制，发给 Agent 即可。');
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('使用说明：请使用 OpenMotion 插件。如未安装，请按 `https://github.com/nexu-io/openmotion` 安装并接入后继续。\n指定模板：First（one）\n创作要求：基于模板，结合我的要求和附件创作。保留原模板的场景、界面和动画结构（可编辑模板直接原地替换文字与素材），不另写简陋文字卡页面；需要舍弃内容时先说明取舍，并交付 HTML 和 MP4。\n我的要求：\n');
  await act(async () => button('打开并编辑').click());
  expect(onOpen).toHaveBeenCalledWith('one');
  await act(async () => button('预览模板 Second', host.querySelector('main')!).click());
  expect(button('打开并编辑')).toBeUndefined();
});
it.each(['repository', 'cms'] as const)('updates the displayed and copied title and ID when navigating %s templates', async templateSource => {
  fetchItems(items.slice(0, 2), templateSource);
  await mount('zh-CN');
  await act(async () => button('预览模板 First', host.querySelector('main')!).click());
  for (const [title, id] of [['First', 'one'], ['Second', 'two']]) {
    const expected = [
      '使用说明：请使用 OpenMotion 插件。如未安装，请按 `https://github.com/nexu-io/openmotion` 安装并接入后继续。',
      `指定模板：${title}（${id}）`,
      '创作要求：基于模板，结合我的要求和附件创作。保留原模板的场景、界面和动画结构（可编辑模板直接原地替换文字与素材），不另写简陋文字卡页面；需要舍弃内容时先说明取舍，并交付 HTML 和 MP4。',
      '我的要求：\n',
    ].join('\n');
    expect(host.querySelector('section[aria-label="模板复刻指令"] p')?.textContent).toBe(expected);
    await act(async () => button('复刻模板').click());
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expected);
    if (id === 'one') await act(async () => button('下一个').click());
  }
});
it('random discovery honors filters, avoids consecutive repeats and handles a singleton', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  await mount();
  await act(async () => button('Product launch films').click());
  await act(async () => button('Surprise me').click());
  expect(current()).toBe('Second');
  await act(async () => button('Close template preview').click());
  await act(async () => button('Surprise me').click());
  expect(current()).toBe('First');
  await act(async () => button('Close template preview').click());
  await search('Ada');
  await act(async () => button('Surprise me').click());
  expect(current()).toBe('First');
});
it('navigates the filtered order with wraparound and keyboard, then follows related metadata', async () => {
  await mount();
  await act(async () => button('Product launch films').click());
  await act(async () => preview('First'));
  await act(async () => button('Next template').click());
  expect(current()).toBe('Second');
  await act(async () => button('Close template preview').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(current()).toBe('First');
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  await act(async () => button('Preview template Second', detail).click());
  expect(current()).toBe('Second');
  await act(async () => button('Other', detail).click());
  expect(detail.hasAttribute('open')).toBe(false);
  expect(cards()).toEqual(['two', 'three']);
});
it('gives recovery priority when nothing matches and restores the gallery after clearing', async () => {
  await mount(); await search('nothing-matches');
  expect(cards()).toHaveLength(0);
  expect(button('Surprise me')).toBeUndefined();
  await confirmSearch();
  expect(host.textContent).toContain('No templates match the current conditions.');
  expect(button('Make a video from a reference')).toBeDefined();
  expect(button('Clear filters')).toBeUndefined();
  await clearKeyword();
  expect(cards()).toHaveLength(3);
  expect(button('Surprise me').disabled).toBe(false);
});
it('reveals metadata labels only while truncated and hides the tooltip when space becomes available', async () => {
  const observers: ResizeObserverStub[] = [];
  class ResizeObserverStub {
    targets = new Set<Element>();
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  await mount();
  await act(async () => preview('First'));
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  const tag = button('Figma', detail);
  let availableWidth = 100;
  Object.defineProperties(tag, {
    clientWidth: { get: () => availableWidth },
    scrollWidth: { get: () => 80 },
  });
  const observer = observers.find(item => item.targets.has(tag))!;
  const resize = () => observer.callback([], observer as unknown as ResizeObserver);
  const settleTooltip = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
  act(resize);
  act(() => tag.focus());
  await settleTooltip();
  expect(detail.querySelector('[role="tooltip"]')).toBeNull();

  act(() => tag.blur());
  act(() => { availableWidth = 40; resize(); });
  act(() => tag.focus());
  await settleTooltip();
  expect(detail.querySelector('[role="tooltip"]')?.textContent).toBe('Figma');

  act(() => { availableWidth = 100; resize(); });
  await settleTooltip();
  expect(detail.querySelector('[role="tooltip"]')).toBeNull();
  expect(tag.getAttribute('aria-describedby')).toBeNull();
});
it('reloads localized catalog content and clears language-specific filters', async () => {
  function App() {
    const { setLocale } = useI18n();
    return <><button onClick={() => setLocale('ja')}>Japanese</button><TemplateLibraryDialog open busy={false} error="" onClose={() => {}} onOpen={() => {}} /></>;
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/integration') ? {} : { items: items.map(item => ({ ...item, title: url.includes('locale=ja') ? '日本語テンプレート' : item.title })), catalogVersion: 'v1', next: null, total: 3 })));
  await act(async () => root.render(<I18nProvider initialLocale="en"><App /></I18nProvider>));
  await act(async () => button('Product launch films').click());
  await act(async () => button('Japanese').click());
  expect(fetch).toHaveBeenCalledWith(expect.stringContaining('locale=ja'), expect.anything());
  expect(host.textContent).toContain('日本語テンプレート');
  expect(host.textContent).not.toContain('First');
  expect(cards()).toHaveLength(3);
});
it('bounds autoplay decoders, prioritizes hover without rebuilding observers, and releases offscreen sources', async () => {
  fetchItems(Array.from({ length: 14 }, (_, index) => ({ ...items[0], id: String(index), title: `Video ${index}` })));
  await mount();
  expect(loadedVideos()).toHaveLength(0);
  const pool = observer();
  await act(async () => pool.emit());
  expect(loadedVideos()).toHaveLength(MAX_TEMPLATE_PLAYERS);
  const last = host.querySelector<HTMLButtonElement>('[data-template-id="13"] button')!;
  await act(async () => last.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(observer()).toBe(pool);
  expect(last.querySelector('video')?.hasAttribute('src')).toBe(true);
  expect(loadedVideos()).toHaveLength(MAX_TEMPLATE_PLAYERS);
  await act(async () => pool.emit(0));
  expect(loadedVideos()).toHaveLength(0);
  expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
});
it('keeps autoplay automatic and releases players for detail, background tabs and reduced motion', async () => {
  await mount();
  await act(async () => observer().emit());
  expect(loadedVideos()).toHaveLength(2);
  expect(button('Autoplay previews')).toBeUndefined();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(loadedVideos()).toHaveLength(0);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(loadedVideos()).toHaveLength(2);
  await act(async () => { motionPreference.matches = true; motionPreference.dispatchEvent(new Event('change')); });
  expect(loadedVideos()).toHaveLength(0);
  await act(async () => { motionPreference.matches = false; motionPreference.dispatchEvent(new Event('change')); });
  await act(async () => preview('First'));
  expect(loadedVideos()).toHaveLength(0);
});
it('uses posters on autoplay rejection or failed media without dropping the template', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockRejectedValue(new Error('Autoplay blocked'));
  await mount();
  await act(async () => observer().emit());
  const video = host.querySelector<HTMLVideoElement>('main video')!;
  expect(video.style.opacity).toBe('0');
  await act(async () => video.dispatchEvent(new Event('error')));
  expect(video.hasAttribute('src')).toBe(false);
  expect(cards()).toHaveLength(3);
});

it('keeps data-saving connections poster-only until a visible card is focused', async () => {
  const connection = Object.assign(new EventTarget(), { saveData: true });
  Object.defineProperty(navigator, 'connection', { configurable: true, value: connection });
  try {
    await mount();
    await act(async () => observer().emit());
    expect(loadedVideos()).toHaveLength(0);
    await act(async () => button('Preview template First', host.querySelector('main')!).focus());
    expect(loadedVideos()).toHaveLength(1);
    await act(async () => { connection.saveData = false; connection.dispatchEvent(new Event('change')); });
    expect(loadedVideos()).toHaveLength(2);
  } finally { delete (navigator as Navigator & { connection?: EventTarget }).connection; }
});

it('does not duplicate a brand when the catalog has no author identity', async () => {
  fetchItems([{ ...items[0], author: '', authorName: undefined }]);
  await mount();
  await act(async () => preview('First'));
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  expect(detail.querySelector('strong')?.textContent).toBe('Figma');
  expect(detail.querySelector('strong + small')).toBeNull();
});


it('copies contribution instructions with the selected template without opening another dialog', async () => {
  await mount();
  expect(host.querySelector('a[href="https://github.com/nexu-io/openmotion/blob/main/CONTRIBUTING.md"]')?.textContent).toContain('Submit template');
  await act(async () => preview('First'));
  await act(async () => button('Recreate and submit').click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('First (one)'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('CONTRIBUTING.md'));
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('pull request'));
  expect(host.querySelectorAll('dialog[open]')).toHaveLength(2);
  expect(document.querySelector('[data-feedback-layer]')?.textContent).toContain('Copied. Paste into your Agent.');
});

it('keeps failed clipboard content selectable inline, including the contribution instruction', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Clipboard denied'));
  await mount();
  await act(async () => preview('First'));
  await act(async () => button('Recreate and submit').click());
  expect(host.querySelector<HTMLTextAreaElement>('textarea')?.value).toContain('pull request');
  expect(host.querySelectorAll('dialog[open]')).toHaveLength(2);
  expect(document.querySelector('[data-feedback-layer]')?.textContent).toContain('Copy failed. Select and copy the instruction below.');
});

it('uses the shared radio menu for sorting and industry filters inside the native dialog', async () => {
  await mount();
  expect(host.querySelector('select')).toBeNull();
  await act(async () => { button('Sort').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const menu = host.querySelector('[role=menu][aria-label="Sort"]')!;
  expect(menu.closest('dialog')?.getAttribute('aria-label')).toBe('Template library');
  await act(async () => (menu.querySelector('[role=menuitemradio][data-unchecked]') as HTMLElement).click());
  expect(cards()).toEqual(['one', 'two', 'three']);
  await act(async () => { button('By industry').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const industry = [...host.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(el => el.textContent === 'Design & creative tools')!;
  await act(async () => industry.click());
  expect(cards()).toEqual(['one']);
});

it('keeps a loading layout until the catalog arrives, without a false empty result', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/integration') ? Promise.resolve(Response.json({})) : new Promise<Response>(resolve => { finish = resolve; })));
  await mount();
  expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
  expect(host.textContent).not.toContain('No matching templates');
  await act(async () => finish(Response.json({ items, next: null, catalogVersion: 'v1' })));
  expect(cards()).toHaveLength(3);
  expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('false');
});

it('retains a usable poster and supports retry after detail video failure', async () => {
  await mount();
  await act(async () => preview('First'));
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  expect(detail.querySelector('[aria-busy=true]')).not.toBeNull();
  expect(detail.textContent).toContain('Loading preview…');
  const video = detail.querySelector('video')!;
  await act(async () => video.dispatchEvent(new Event('error')));
  expect(detail.querySelector('video')).toBeNull();
  expect(detail.querySelector('img[src="/one.jpg"]')).not.toBeNull();
  expect(detail.textContent).toContain('Preview unavailable. Try again.');
  await act(async () => button('Retry', detail).click());
  const retryVideo = detail.querySelector('video')!;
  expect(retryVideo.getAttribute('src')).toBe('/one.mp4');
  await act(async () => retryVideo.dispatchEvent(new Event('loadeddata')));
  expect(detail.querySelector('[aria-busy=true]')).toBeNull();
  expect(detail.textContent).not.toContain('Loading preview…');
});

it('shows a recoverable instruction error and copies only after a successful retry', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { if (url.endsWith('/integration')) throw new Error('Offline'); return Response.json({ items, next: null, catalogVersion: 'v1' }); }));
  await mount();
  await act(async () => preview('First'));
  expect(host.textContent).toContain('Could not load the instruction.');
  expect(button('Recreate template').disabled).toBe(true);
  expect(host.querySelector('[aria-label="Loading instruction…"]')).toBeNull();
  fetchItems();
  await act(async () => button('Retry').click());
  expect(button('Recreate template').disabled).toBe(false);
  await act(async () => button('Recreate template').click());
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('First (one)'));
});

it('keeps discovery available while project status prevents editable opening', async () => {
  const onOpen = vi.fn(), onClose = vi.fn();
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} openingDisabled error="" onClose={onClose} onOpen={onOpen} /></I18nProvider>));
  await act(async () => preview('First'));
  expect(button('Open and edit').disabled).toBe(true);
  expect(button('Recreate template').disabled).toBe(false);
  expect(document.querySelector('[data-feedback-layer]')?.textContent ?? '').not.toContain('Preparing editable project');
  await act(async () => button('Open and edit').click());
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => button('Close template preview').click());
  await act(async () => button('Close template library').click());
  expect(onClose).toHaveBeenCalledOnce();
});

const events = (event: string, match: Record<string, unknown> = {}) => tracked.filter(item => item.event === event && Object.entries(match).every(([key, value]) => item.properties[key] === value)).map(item => item.properties);
const impressions = () => Observer.instances.filter(item => !item.disconnected && item.options?.threshold === 0.5).at(-1)!;
const uuid = /^[0-9a-f-]{36}$/;
it('distinguishes brand-filtered impressions even when all templates have a brand', async () => {
  vi.useFakeTimers();
  try {
    await mount();
    const card = [host.querySelector('[data-template-id="two"]')!];
    await act(async () => impressions().emit(1, card));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(events('surface_view', { area: 'template_card' })).toHaveLength(1);

    await act(async () => button('TOP 100 brands').click());
    expect(cards()).toEqual(['two', 'one', 'three']);
    await act(async () => impressions().emit(1, card));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(events('surface_view', { area: 'template_card' })).toEqual([
      expect.objectContaining({ template_id: 'two', applied_filter_count: 0 }),
      expect.objectContaining({ template_id: 'two', applied_filter_count: 1 }),
    ]);
    for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
  } finally { vi.useRealTimers(); }
});
it('reports the library funnel with registered fields: library, card open, detail, instruction, copy and download', async () => {
  await mount();
  expect(events('surface_view', { area: 'template_library' })).toEqual([{ page_name: 'studio', area: 'template_library', element: 'library', library_view_id: expect.any(String) }]);
  await act(async () => preview('First'));
  expect(events('ui_click', { element: 'open_detail' })).toEqual([{ page_name: 'studio', area: 'template_card', element: 'open_detail', template_id: 'one', resource_kind: 'editable_project', placement: 'catalog', position: 2, sort: 'recommended', applied_filter_count: 0, library_view_id: expect.any(String), result_set_id: expect.any(String) }]);
  const [shown] = events('surface_view', { area: 'template_detail' });
  expect(shown).toMatchObject({ template_id: 'one', placement: 'catalog', position: 2, detail_mode: 'modal' });
  expect(shown.detail_view_id).toMatch(uuid);
  await act(async () => Observer.instances.find(item => item.elements.some(element => element.matches('section[aria-label="Template instruction"] p')))!.emit());
  expect(events('surface_view', { area: 'template_instruction' })).toEqual([expect.objectContaining({ template_id: 'one', instruction_kind: 'template_use', detail_view_id: shown.detail_view_id })]);
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  await act(async () => button('Recreate template', detail).click());
  expect(events('ui_click', { element: 'start_use' })).toEqual([expect.objectContaining({ template_action: 'recreate', template_id: 'one', detail_view_id: shown.detail_view_id })]);
  expect(events('ui_click', { element: 'select_template' })).toHaveLength(0);
  expect(events('ui_click', { element: 'copy_template' })).toHaveLength(0);
  expect(events('template_instruction_copy_result')).toEqual([expect.objectContaining({ copy_status: 'clipboard_written', host_product: 'codex', instruction_kind: 'template_use', template_id: 'one' })]);
  await act(async () => button('Recreate and submit', detail).click());
  expect(events('ui_click', { element: 'start_use', template_action: 'recreate_submit' })).toHaveLength(1);
  expect(events('template_instruction_copy_result', { instruction_kind: 'recreate_submit' })).toHaveLength(1);
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
  await act(async () => button('Recreate template', detail).click());
  const click = events('ui_click', { element: 'start_use', template_action: 'recreate' }).at(-1)!;
  expect(events('template_instruction_copy_result', { copy_status: 'manual_fallback_shown' })).toEqual([expect.objectContaining({ copy_attempt_id: click.copy_attempt_id })]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  await act(async () => button('Download motion.md', detail).click());
  const [download] = events('ui_click', { element: 'download_guide' });
  expect(events('resource_download_result')).toEqual([expect.objectContaining({ delivery_status: 'fetch_failed', error_code: 'HTTP_404', download_attempt_id: download.download_attempt_id, template_id: 'one' })]);
  for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
});
it('reports discovery choices with the list they produced, and one search per settled keyword', async () => {
  vi.useFakeTimers();
  try {
    await mount();
    await act(async () => button('Product launch films').click());
    expect(events('ui_click', { element: 'category_select' })).toEqual([{ page_name: 'studio', area: 'template_discovery', element: 'category_select', filter_group: 'uses', filter_value: 'product-launch-films', selected: true, sort: 'recommended', applied_filter_count: 0, library_view_id: expect.any(String), result_set_id: expect.any(String) }]);
    expect(events('template_filter_result')).toEqual([{ page_name: 'studio', area: 'template_discovery', action: 'category_select', result_count: 2, outcome: 'success', sort: 'recommended', applied_filter_count: 1, library_view_id: expect.any(String), discovery_id: expect.any(String), result_set_id: expect.any(String) }]);
    await search('Ad'); await search('Ada');
    expect(events('template_search_result')).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(500); });
    const [found] = events('template_search_result');
    expect(found).toMatchObject({ search_keyword: 'Ada', query_length: 3, result_count: 1, applied_filter_count: 1 });
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(events('template_search_result')).toHaveLength(1);
    await act(async () => preview('First'));
    expect(events('ui_click', { element: 'open_detail' })[0]).toMatchObject({ search_id: found.search_id, position: 1 });
    await act(async () => host.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!.close());
    await act(async () => button('Clear filters').click());
    expect(events('ui_click', { element: 'filter_clear' })).toHaveLength(1);
    expect(events('template_filter_result', { action: 'filter_clear' })).toEqual([expect.objectContaining({ result_count: 1, applied_filter_count: 0 })]);
    await clearKeyword();
    await act(async () => button('Sort').click());
    await act(async () => [...host.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(el => el.textContent === 'Duration')!.click());
    expect(events('ui_click', { element: 'sort_option' })).toEqual([expect.objectContaining({ sort: 'duration', previous_sort: 'recommended', changed: true })]);
    expect(events('template_filter_result', { action: 'sort_change' })).toHaveLength(1);
    await act(async () => button('Surprise me').click());
    expect(events('ui_click', { element: 'surprise_me' })).toEqual([expect.objectContaining({ result_count: 3, sort: 'duration' })]);
    expect(events('surface_view', { area: 'template_detail', placement: 'random' })).toHaveLength(1);
    await act(async () => button('Next template').click());
    expect(events('ui_click', { element: 'detail_next' })).toHaveLength(1);
    expect(events('surface_view', { area: 'template_detail', placement: 'navigation' })).toHaveLength(1);
    for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
  } finally { vi.useRealTimers(); }
});
it('counts a card impression after an unbroken visible second, once per result set and never under the detail', async () => {
  vi.useFakeTimers();
  try {
    await mount();
    const seen = () => events('surface_view', { area: 'template_card' });
    const card = (id: string) => [host.querySelector(`[data-template-id="${id}"]`)!];
    await act(async () => impressions().emit(1, card('two')));
    await act(async () => { vi.advanceTimersByTime(900); });
    await act(async () => impressions().emit(0.3, card('two')));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(seen()).toHaveLength(0);
    await act(async () => impressions().emit(1, card('two')));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(seen()).toEqual([{ page_name: 'studio', area: 'template_card', element: 'card', template_id: 'two', resource_kind: 'reference', placement: 'catalog', position: 1, sort: 'recommended', applied_filter_count: 0, library_view_id: expect.any(String), result_set_id: expect.any(String) }]);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(seen()).toHaveLength(1);
    await act(async () => button('Sort').click());
    await act(async () => [...host.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(el => el.textContent === 'Name Z–A')!.click());
    await act(async () => impressions().emit(1, card('two')));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(seen()).toHaveLength(2);
    expect(seen()[1]).toMatchObject({ template_id: 'two', sort: 'reverse', position: 2 });
    await act(async () => preview('Third'));
    expect(Observer.instances.filter(item => !item.disconnected && item.options?.threshold === 0.5)).toHaveLength(0);
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(seen()).toHaveLength(2);
    for (const item of tracked) expect(validProperties(studioEvents, item.event, item.properties), JSON.stringify(item)).toBe(true);
  } finally { vi.useRealTimers(); }
});

it('counts each library opening while catalog loading is pending or failed, without repeating on retry', async () => {
  let fail!: (reason: Error) => void;
  vi.stubGlobal('fetch', vi.fn((url: string) => url.endsWith('/integration') ? Promise.resolve(Response.json({}))
    : new Promise<Response>((_resolve, reject) => { fail = reject; })));
  await mount();
  expect(events('surface_view', { area: 'template_library' })).toEqual([
    { page_name: 'studio', area: 'template_library', element: 'library', library_view_id: expect.any(String) },
  ]);
  await act(async () => fail(new Error('CATALOG_OFFLINE')));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('CATALOG_OFFLINE');
  fetchItems();
  await act(async () => button('Retry').click());
  expect(cards()).toHaveLength(3);
  expect(events('surface_view', { area: 'template_library' })).toHaveLength(1);
  const render = (open: boolean) => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open={open} busy={false} error="" onClose={() => {}} onOpen={() => {}} /></I18nProvider>);
  await act(async () => render(false));
  await act(async () => render(true));
  expect(events('surface_view', { area: 'template_library' })).toHaveLength(2);
});

it('counts instruction text only when visible, once per detail, and ignores callbacks from an old detail', async () => {
  await mount();
  await act(async () => preview('First'));
  const exposures = () => events('surface_view', { area: 'template_instruction' });
  const textObserver = () => Observer.instances.find(item => !item.disconnected
    && item.elements.some(element => element.matches('section[aria-label="Template instruction"] p, section[aria-label="Template instruction"] textarea')))!;
  expect(exposures()).toHaveLength(0);
  const first = textObserver();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => first.emit());
  expect(exposures()).toHaveLength(0);
  hidden.mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(exposures()).toHaveLength(1);
  await act(async () => first.emit());
  expect(exposures()).toHaveLength(1);
  await act(async () => button('Close template preview').click());
  await act(async () => preview('First'));
  await act(async () => first.emit());
  expect(exposures()).toHaveLength(1);
  await act(async () => textObserver().emit());
  expect(exposures()).toHaveLength(2);
  expect(exposures()[0].detail_view_id).not.toBe(exposures()[1].detail_view_id);
});

it('joins repeated recreate and submit attempts to their own copy results', async () => {
  await mount();
  await act(async () => preview('First'));
  await act(async () => button('Recreate template').click());
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Clipboard denied'));
  await act(async () => button('Recreate and submit').click());
  const intents = events('ui_click', { element: 'start_use' });
  const results = events('template_instruction_copy_result');
  expect(intents.map(item => item.copy_attempt_id)).toEqual(results.map(item => item.copy_attempt_id));
  expect(new Set(results.map(item => item.copy_attempt_id)).size).toBe(2);
  expect(results.map(item => item.copy_status)).toEqual(['clipboard_written', 'manual_fallback_shown']);
  await act(async () => button('Open and edit').click());
  expect(events('ui_click', { template_action: 'open_edit' })[0]).not.toHaveProperty('copy_attempt_id');
});

it('observes a positive instruction threshold so zero-area edge contact can progress to visible text', async () => {
  await mount();
  await act(async () => preview('First'));
  const text = Observer.instances.find(item => !item.disconnected
    && item.elements.some(element => element.matches('section[aria-label="Template instruction"] p')))!;
  expect(text.options?.threshold).toBe(0.01);
  const emit = async (intersectionRatio: number) => act(async () => text.callback([
    { target: text.elements[0], isIntersecting: true, intersectionRatio } as IntersectionObserverEntry,
  ], text as unknown as IntersectionObserver));
  await emit(0);
  await emit(0.005);
  expect(events('surface_view', { area: 'template_instruction' })).toHaveLength(0);
  await emit(0.01);
  await emit(1);
  expect(events('surface_view', { area: 'template_instruction' })).toHaveLength(1);
});

it('retains draft choices across groups, applies their intersection and clears one group or all choices', async () => {
  await mount();
  await search('clean');
  await act(async () => button('Filters').click());
  const popup = () => host.querySelector('[role=dialog][aria-label=Filters]')!;
  await act(async () => button('Product launch films', popup()).click());
  await act(async () => button('Motion style', popup()).click());
  await act(async () => button('UI', popup()).click());
  await act(async () => button('Reference brands', popup()).click());
  await act(async () => button('Figma', popup()).click());
  expect(popup().querySelector('[role=status]')?.textContent).toBe('1 templates');
  expect(cards()).toEqual(['two', 'one']);
  await act(async () => button('Other', popup()).click());
  expect(popup().querySelector('[role=status]')?.textContent).toBe('2 templates');
  await act(async () => button('Other', popup()).click());
  expect(popup().querySelector('[role=status]')?.textContent).toBe('1 templates');
  await act(async () => button('Clear selection', popup()).click());
  expect(button('Figma', popup()).getAttribute('aria-checked')).toBe('false');
  expect(popup().querySelector('[role=status]')?.textContent).toBe('2 templates');
  await act(async () => button('Video purpose', popup()).click());
  expect(button('Product launch films', popup()).getAttribute('aria-checked')).toBe('true');
  await act(async () => button('Ready to edit', popup()).click());
  await act(async () => button('Apply filters', popup()).click());
  expect(cards()).toEqual(['one']);
  await act(async () => button('Filters').click());
  await act(async () => button('Clear filters', popup()).click());
  expect(button('Ready to edit', popup()).getAttribute('aria-checked')).toBe('false');
  expect(popup().querySelector('[role=status]')?.textContent).toBe('2 templates');
  expect(cards()).toEqual(['one']);
  await act(async () => button('Apply filters', popup()).click());
  expect(cards()).toEqual(['two', 'one']);
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('clean');
});
it('discards unapplied changes on dismissal and starts from the committed filters when reopened', async () => {
  await mount();
  await act(async () => button('Product launch films').click());
  await act(async () => button('Filters').click());
  await act(async () => button('Reference brands').click());
  await act(async () => button('Figma', host.querySelector('[role=dialog][aria-label=Filters]')!).click());
  await act(async () => button('Close filters').click());
  expect(cards()).toEqual(['two', 'one']);
  await act(async () => button('Filters').click());
  expect(button('Figma', host.querySelector('[role=dialog][aria-label=Filters]')!).getAttribute('aria-checked')).toBe('false');
  await act(async () => button('Video purpose').click());
  const popup = host.querySelector('[role=dialog][aria-label=Filters]')!;
  expect(button('Product launch films', popup).getAttribute('aria-checked')).toBe('true');
});
it('searches a long option group without losing selections hidden by the option search', async () => {
  fetchItems(Array.from({ length: 14 }, (_, index) => ({ ...items[0], id: `brand-${index}`, brand: `Brand ${index}` })));
  await mount();
  await act(async () => button('Filters').click());
  await act(async () => button('Reference brands').click());
  await act(async () => button('Brand 0').click());
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search options…"]')!;
  const find = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await find('Brand 13');
  expect(button('Brand 0')).toBeUndefined();
  await act(async () => button('Brand 13').click());
  await find('No such brand');
  expect(host.textContent).toContain('No matching options.');
  expect(cards()).toHaveLength(14);
  await act(async () => button('Apply filters').click());
  expect(cards()).toEqual(['brand-0', 'brand-13']);
});

it('opens the template requested by the MCP page without selecting a different card', async () => {
  function RoutedLibrary() {
    const [templateId, setTemplateId] = React.useState<string | null>('two');
    return <TemplateLibraryDialog open templateId={templateId} onTemplateChange={setTemplateId} busy={false} error="" onClose={() => {}} onOpen={() => {}} />;
  }
  await act(async () => root.render(<I18nProvider initialLocale="en"><RoutedLibrary /></I18nProvider>));
  expect(current()).toBe('Second');
  await act(async () => button('Close template preview').click());
  expect(current()).toBeUndefined();
  await act(async () => preview('First'));
  expect(current()).toBe('First');
});

it.each(['en', 'zh-CN'] as const)('keeps reference and contribution copying distinct in local review (%s)', async locale => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  await mount(locale);
  await act(async () => button(translate(locale, 'Preview template {title}', { title: 'Second' })).click());
  const detail = host.querySelector('dialog[aria-label="' + translate(locale, 'Template preview') + '"]')!;
  const copy = button(translate(locale, 'Recreate this template'), detail);
  expect(detail.textContent).not.toContain('Local review');
  expect(detail.textContent).not.toContain('本地评审');
  expect(copy).toBeDefined();
  const browse = detail.querySelector('nav[aria-label="' + translate(locale, 'Browse videos') + '"]')!;
  expect([...browse.querySelectorAll('button')].map(item => item.textContent)).toEqual([translate(locale, 'Previous template'), translate(locale, 'Next template')]);
  expect(button(translate(locale, 'Open and edit'), detail)).toBeUndefined();
  await act(async () => copy.click());
  const regular = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0];
  expect(regular).toContain('two');
  expect(regular).not.toContain('contribution guide');
  await act(async () => button(translate(locale, 'Copy contribution brief'), detail).click());
  const contribution = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0];
  expect(contribution).toContain('two');
  expect(contribution).toContain(locale === 'en' ? 'contribution' : '准备贡献');
  const intents = events('ui_click', { element: 'start_use' });
  const results = events('template_instruction_copy_result');
  expect(intents.map(item => item.template_action)).toEqual(['recreate', 'recreate_submit']);
  expect(intents.map(item => item.copy_attempt_id)).toEqual(results.map(item => item.copy_attempt_id));
  expect(results.map(item => item.copy_status)).toEqual(['clipboard_written', 'clipboard_written']);
  await act(async () => button(translate(locale, 'Next steps'), detail).click());
  expect(detail.textContent).toContain(translate(locale, 'Add content and send'));
  expect(detail.textContent).not.toContain('Visual rules');
  expect(detail.textContent).not.toContain('Production rules');
  const shelf = detail.querySelector('section[aria-label="' + translate(locale, 'Similar templates') + '"]');
  expect(shelf).not.toBeNull();
  expect(shelf!.parentElement?.parentElement).toBe(detail);
});

it('keeps a text download beside GitHub, contribution beside pinned copying, and help by the instruction heading', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  await mount(); await act(async () => preview('First'));
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  expect(document.activeElement).toBe(detail.querySelector('h2'));
  expect(detail.querySelector('[role="tooltip"]')).toBeNull();
  act(() => button('Close template preview', detail).focus());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(detail.querySelector('[role="tooltip"]')?.textContent).toBe('Close template preview');
  act(() => (detail.querySelector('h2') as HTMLElement).focus());
  const github = [...detail.querySelectorAll('a')].find(node => node.textContent?.includes('View on GitHub'))!;
  const materials = detail.querySelector('[aria-label="About this starting point"]')!;
  expect(github.compareDocumentPosition(materials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const resources = detail.querySelector('section[aria-label="Template resources"]')!;
  const specs = detail.querySelector('[aria-label="Video specifications"]')!;
  expect(specs.nextElementSibling?.textContent).toContain('Ada Designer');
  expect(specs.nextElementSibling?.nextElementSibling).toBe(resources);
  expect(resources.contains(github)).toBe(true);
  expect(resources.querySelector('details')).toBeNull();
  expect(resources.contains(button('Download motion.md', detail))).toBe(true);
  expect(github.querySelectorAll('svg')).toHaveLength(1);
  expect(resources.contains(button('Copy contribution brief', detail))).toBe(false);
  expect(button('Download motion.md', detail).textContent).toBe('Download motion.md');
  const actions = detail.querySelector('[aria-label="Template actions"]')!;
  expect(actions.contains(button('Copy contribution brief', detail))).toBe(true);
  expect(actions.contains(button('Recreate this template', detail))).toBe(true);
  expect(button('Copy contribution brief', detail).textContent).toBe('');
  expect([...detail.querySelectorAll('details summary')].map(item => item.textContent)).not.toContain('Create and contribute a template');
  const production = detail.querySelector('[aria-label="Production references"]')!;
  expect(production.contains(button('View motion.md guide', detail))).toBe(true);
  expect(production.parentElement?.lastElementChild).toBe(production);
  expect(production.contains(button('Download motion.md', detail))).toBe(false);
  const creation = detail.querySelector('section[aria-label="Template recreation instruction"]')!;
  expect(creation.querySelector('header h3')?.textContent).toBe('Template recreation instruction');
  expect(creation.querySelector(':scope > p')?.textContent).toContain('one');
  expect(creation.querySelector('header')?.contains(button('Next steps', detail))).toBe(true);
  expect(detail.querySelector('section[aria-label="After copying"]')).toBeNull();
  await act(async () => button('Next steps', detail).click());
  const steps = detail.querySelector('section[aria-label="After copying"]')!;
  expect(steps.querySelectorAll('li')).toHaveLength(3);
  expect(steps.textContent).toContain('Your copy; screenshots or recordings if needed.');
  expect(detail.querySelectorAll('dialog')).toHaveLength(0);
  expect(detail.textContent).not.toContain('Your Agent will make a new video from this reference and your materials.');
  expect(detail.querySelector('video[controls]')).not.toBeNull();
  await act(async () => button('View motion.md guide', detail).click());
  const guide = detail.querySelector('section[aria-label="Interactive walkthrough"]')!;
  expect(guide).not.toBeNull();
  expect(detail.querySelector('dialog')).toBeNull();
  expect(detail.querySelector('video[controls]')).toBeNull();
  expect(guide.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
  await act(async () => button('Back to template', guide).click());
  expect(detail.querySelector('section[aria-label="Interactive walkthrough"]')).toBeNull();
  expect(current()).toBe('First');
});

it('replaces related details in place and retains the original search on dismissal', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  await mount(); await search('First'); await act(async () => preview('First'));
  const detail = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
  const shelf = detail.querySelector('section[aria-label="Similar templates"]')!;
  const next = shelf.querySelector<HTMLButtonElement>('button[aria-label="Preview template Second"]')!;
  expect(next).not.toBeNull();
  await act(async () => next.click());
  expect(host.querySelector('dialog[aria-label="Template preview"]')).toBe(detail);
  expect(current()).toBe('Second');
  expect(detail.querySelectorAll('dialog')).toHaveLength(0);
  await act(async () => button('Recreate this template', detail).click());
  expect(vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0]).toContain('two');
  await act(async () => button('Close template preview', detail).click());
  expect(host.querySelector<HTMLInputElement>('input[type=search]')?.value).toBe('First');
  expect(cards()).toEqual(['one']);
});

it.each(['en', 'zh-CN'] as const)('retains motion metadata while removing only the requested fields and restores optional after-copy help (%s)', async locale => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  await mount(locale);
  await act(async () => button(translate(locale, 'Preview template {title}', { title: 'First' })).click());
  const detail = host.querySelector('dialog[aria-label="' + translate(locale, 'Template preview') + '"]')!;
  const info = detail.querySelector('section[aria-label="' + translate(locale, 'Video information') + '"]')!;
  expect(info).not.toBeNull();
  const specs = detail.querySelector('[aria-label="' + translate(locale, 'Video specifications') + '"]')!;
  expect(specs.textContent).toContain(translate(locale, 'Editable project'));
  expect(info.textContent).not.toContain(translate(locale, 'Editable project'));
  expect(specs.compareDocumentPosition(info) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(info.querySelectorAll('dt')).toHaveLength(2);
  expect(info.textContent).toContain(translate(locale, 'Motion style'));
  expect(info.textContent).toContain('UI');
  expect(info.textContent).toContain(translate(locale, 'Video purpose'));
  for (const removed of ['Good for', 'Industry', 'Reference brands']) expect(info.textContent).not.toContain(translate(locale, removed));
  expect(info.textContent).not.toContain('Figma');
  expect(info.querySelector('details')).toBeNull();
  expect(detail.querySelector('section[aria-label="' + translate(locale, 'What to bring') + '"]')).toBeNull();
  expect(button(translate(locale, 'View motion.md guide'), detail)).toBeDefined();
  expect(detail.textContent).not.toContain(translate(locale, 'Copying does not send a message or create a project.'));
  const creation = detail.querySelector('section[aria-label="' + translate(locale, 'Template recreation instruction') + '"]')!;
  const actions = detail.querySelector('[aria-label="' + translate(locale, 'Template actions') + '"]')!;
  expect(actions.contains(button(translate(locale, 'Recreate this template'), detail))).toBe(true);
  expect(creation.contains(actions)).toBe(false);
  expect(detail.querySelector('section[aria-label="' + translate(locale, 'After copying') + '"]')).toBeNull();
  const previewText = creation.querySelector(':scope > p')!;
  expect(previewText.textContent).toContain('one');
  expect(button(translate(locale, 'Show instruction'), creation).getAttribute('aria-expanded')).toBe('false');
  await act(async () => Observer.instances.filter(item => !item.disconnected).forEach(item => item.emit()));
  expect(events('surface_view', { area: 'template_instruction' })).toHaveLength(1);
  const helpTrigger = button(translate(locale, 'Next steps'), creation);
  await act(async () => {
    helpTrigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false, composed: true }));
    helpTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, composed: true }));
    helpTrigger.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, composed: true }));
    await new Promise(resolve => setTimeout(resolve, 350));
  });
  const help = detail.querySelector('section[aria-label="' + translate(locale, 'After copying') + '"]')!;
  const stepTwo = help.querySelector('ol > li:nth-child(2)')!;
  expect(stepTwo.textContent).toContain(translate(locale, 'Your copy; screenshots or recordings if needed.'));
  await act(async () => button(translate(locale, 'Show instruction'), creation).click());
  expect(button(translate(locale, 'Show less'), creation).getAttribute('aria-expanded')).toBe('true');
  expect(actions.contains(button(translate(locale, 'Recreate this template'), detail))).toBe(true);
  const instruction = creation.querySelector(':scope > p')!;
  expect(instruction).not.toBeNull();
  await act(async () => Observer.instances.filter(item => !item.disconnected).forEach(item => item.emit()));
  expect(events('surface_view', { area: 'template_instruction' })).toHaveLength(1);
});

it('shows the original description below the title, renders original production notes as bottom text and keeps material guidance', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  fetchItems([{ ...items[0], id: 'motion-be2a4af0-0183-4979-ab05-2a68413c0890', description: 'Original authored description' }]);
  await mount(); await act(async () => preview('First'));
  const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
  expect(detail.querySelector('section[aria-label="Why this video works"]')).toBeNull();
  expect(detail.querySelector('section[aria-label="About this video"]')).toBeNull();
  const description = [...detail.querySelectorAll('p')].find(item => item.textContent === 'Original authored description')!;
  expect(description).toBeDefined();
  expect(description.closest('details')).toBeNull();
  expect(description.previousElementSibling?.tagName).toBe('H2');
  expect(description.nextElementSibling?.getAttribute('aria-label')).toBe('Video specifications');
  expect([...detail.querySelectorAll('summary')].some(item => item.textContent === 'Video notes')).toBe(false);
  expect(detail.textContent?.match(/Original authored description/g)).toHaveLength(1);
  const notes = detail.querySelector('section[aria-label="Production details"]')!;
  expect(notes.textContent).toContain('Visual style');
  expect(notes.textContent).toContain('Visual rules');
  expect(notes.textContent).toContain('Production notes');
  expect(notes.textContent).toContain('Production rules');
  expect(notes.querySelectorAll('details')).toHaveLength(0);
  expect([...notes.querySelectorAll('h4')].map(item => item.textContent)).toEqual(['Visual style', 'Production notes']);
  expect([...notes.querySelectorAll('p')].map(item => item.textContent)).toEqual(['Visual rules', 'Production rules']);
  expect(notes.contains(button('View motion.md guide', detail))).toBe(true);
  expect(notes.parentElement?.lastElementChild).toBe(notes);
  await act(async () => button('Next steps', detail).click());
  const secondStep = detail.querySelector('section[aria-label="After copying"] ol > li:nth-child(2)')!;
  expect(secondStep.textContent).toContain('Your headline.');
  expect(secondStep.textContent).not.toContain('Your screenshots or recording');
  expect(secondStep.textContent).toContain('Optional: logo, colors and audio.');
});

it('brings the manual instruction into view when the pinned copy action fails', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
  await mount(); await act(async () => preview('Second'));
  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('Denied'));
  await act(async () => button('Recreate this template').click());
  const field = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Content to copy"]')!;
  expect(field.readOnly).toBe(true);
  expect(field.value).toContain('two');
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(field.value.length);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  expect(events('template_instruction_copy_result').map(item => item.copy_status)).toEqual(['manual_fallback_shown']);
});


it('retries opening the exact prepared project without creating another one after a real callback failure', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const prepare = vi.fn(async (template, requestId: string) => ({ projectId: 'bd951eb6-bbbc-4942-9507-8f2856ec7d3b', sessionId: requestId,
    title: 'My new project', templateId: template.id, originalProjectId: 'original-A', requestId }));
  const open = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} error="" projectId="original-A"
    onClose={() => {}} onOpen={() => {}} onPrepareTemplate={prepare} onOpenProject={open} /></I18nProvider>));
  await act(async () => preview('First'));
  await act(async () => button('Open and edit').click());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(open).toHaveBeenLastCalledWith('bd951eb6-bbbc-4942-9507-8f2856ec7d3b');
  expect(host.textContent).toContain('Project created, preview not opened');
  await act(async () => button('Retry opening this project').click());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(open.mock.calls).toEqual([['bd951eb6-bbbc-4942-9507-8f2856ec7d3b'], ['bd951eb6-bbbc-4942-9507-8f2856ec7d3b']]);
  expect(host.textContent).toContain('This project is ready');
  expect(events('ui_click', { template_action: 'open_edit' })).toHaveLength(1);
  const results = events('template_project_result');
  expect(results.map(item => [item.stage, item.outcome])).toEqual([['create', 'success'], ['open', 'failure'], ['open', 'success']]);
  expect(new Set(results.map(item => item.operation_id)).size).toBe(1);
  expect(events('ui_click', { template_action: 'open_edit' })[0].operation_id).toBe(results[0].operation_id);
  expect(new Set(results.map(item => item.handoff_attempt_id)).size).toBe(3);
  expect(results.every(item => item.project_id === 'bd951eb6-bbbc-4942-9507-8f2856ec7d3b')).toBe(true);
});

it('keeps an uncertain real creation result separate from failure and prevents a second creation', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const prepare = vi.fn().mockRejectedValue(new Error('Connection interrupted'));
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} error="" projectId="original-A"
    onClose={() => {}} onOpen={() => {}} onPrepareTemplate={prepare} onOpenProject={async () => true} /></I18nProvider>));
  await act(async () => preview('First'));
  await act(async () => button('Open and edit').click());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Creation result needs checking');
  expect(host.textContent).not.toContain('Project not created');
  expect(button('Open and edit').disabled).toBe(true);
  await act(async () => button('Check creation result').click());
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain('Project not created');
  expect(button('Open and edit').disabled).toBe(false);
  expect(events('template_project_result').map(item => [item.stage, item.outcome])).toEqual([['create', 'unknown'], ['reconcile', 'not_found']]);
  await act(async () => button('Retry creation').click());
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare.mock.calls[1][1]).toBe(prepare.mock.calls[0][1]);
  expect(host.textContent).toContain('Creation result needs checking');
});

it('allows a preflight-blocked creation to retry without treating it as an ambiguous server result', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const prepare = vi.fn().mockRejectedValue(new TemplatePreparationBlockedError('Save your changes first.'));
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} error="" projectId="original-A"
    onClose={() => {}} onOpen={() => {}} onPrepareTemplate={prepare} /></I18nProvider>));
  await act(async () => preview('First'));
  await act(async () => button('Open and edit').click());
  expect(host.textContent).toContain('Save your changes first.');
  expect(host.textContent).toContain('Project not created');
  expect(host.textContent).not.toContain('Creation result needs checking');
  expect(pendingTemplateProjects()).toEqual([]);
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/projects'))).toBe(false);
  await act(async () => button('Retry creation').click());
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare.mock.calls[1][1]).toBe(prepare.mock.calls[0][1]);
  expect(events('template_project_result').map(item => item.outcome)).toEqual(['failure', 'failure']);
});

it('reconciles a retained request after remount without minting a new creation identity', async () => {
  sessionStorage.setItem('motion.template-handoff.preview', '1');
  const prepare = vi.fn().mockRejectedValue(new Error('Connection interrupted'));
  const render = () => <I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} error="" projectId="original-A"
    onClose={() => {}} onOpen={() => {}} onPrepareTemplate={prepare} /></I18nProvider>;
  await act(async () => root.render(render()));
  await act(async () => preview('First'));
  await act(async () => button('Open and edit').click());
  const requestId = prepare.mock.calls[0][1];
  expect(pendingTemplateProjects()).toMatchObject([{ requestId, templateId: 'one', originalProjectId: 'original-A' }]);
  act(() => root.unmount()); root = createRoot(host);
  await act(async () => root.render(render()));
  await act(async () => preview('First'));
  expect(button('Open and edit').disabled).toBe(true);
  expect(host.textContent).toContain('Creation result needs checking');
  expect(prepare).toHaveBeenCalledTimes(1);
  await act(async () => button('Check creation result').click());
  await act(async () => button('Retry creation').click());
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(prepare.mock.calls[1][1]).toBe(requestId);
});

it('keeps a delayed handoff result tied to its initiating detail and does not switch a later selection', async () => {
  sessionStorage.removeItem('motion.template-handoff.preview');
  let finish!: (value: any) => void;
  const prepare = vi.fn((_template, _requestId) => new Promise<any>(resolve => { finish = resolve; }));
  const open = vi.fn().mockResolvedValue(true);
  await act(async () => root.render(<I18nProvider initialLocale="en"><TemplateLibraryDialog open busy={false} error="" projectId="project"
    onClose={() => {}} onOpen={() => {}} onPrepareTemplate={prepare} onOpenProject={open} /></I18nProvider>));
  await act(async () => preview('First'));
  const sourceView = events('surface_view', { area: 'template_detail' }).at(-1)!.detail_view_id;
  await act(async () => button('Open and edit').click());
  const detail = host.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
  await act(async () => detail.querySelector<HTMLButtonElement>('section[aria-label="Similar templates"] button[aria-label="Preview template Second"]')!.click());
  const requestId = prepare.mock.calls[0][1];
  await act(async () => finish({ projectId: 'bd951eb6-bbbc-4942-9507-8f2856ec7d3b', sessionId: requestId, title: 'Independent project', templateId: 'one', originalProjectId: 'project', requestId }));
  expect(current()).toBe('Second');
  expect(open).not.toHaveBeenCalled();
  expect(events('template_project_result')).toMatchObject([{ template_id: 'one', detail_view_id: sourceView, operation_id: requestId, stage: 'create', outcome: 'success' }]);
});

it('preserves the TOP100 detail and return path alongside the regular template handoff', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  sessionStorage.removeItem('motion.template-handoff.preview');
  try {
    await mount();
    await act(async () => button('TOP 100 brands').click());
    expect(button('Surprise me')).toBeDefined();
    expect(host.querySelector('a[href]')?.getAttribute('href')).toBeTruthy();
    await act(async () => button('View Figma brand series').click());
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    expect(brand.querySelector('[aria-label="Release history"]')).not.toBeNull();
    expect(brand.querySelector('[role="tablist"]')).toBeNull();
    expect(brand.querySelector('[aria-label="Select work First"][aria-current="true"]')).not.toBeNull();
    await act(async () => button('View full details', brand).click());
    const detail = host.querySelector('dialog[aria-label="Template preview"]')!;
    expect(detail.textContent).not.toMatch(/What to bring|After copying|Interactive walkthrough/);
    expect(detail.querySelector('[aria-label="Template instruction"]')).not.toBeNull();
    expect(button('Recreate template', detail)).toBeDefined();
    expect(button('Recreate and submit', detail)).toBeDefined();
    expect(detail.querySelector('video')).not.toBeNull();
    await act(async () => button('Close template preview', detail).click());
    expect(host.querySelector('dialog[aria-label="Figma brand story"][open]')).not.toBeNull();
    await act(async () => button('Close brand story', brand).click());
    await act(async () => button('Remove filter TOP 100 brands').click());
    await act(async () => preview('Second'));
    expect(button('Recreate this template', detail)).toBeDefined();
    expect(detail.querySelector('section[aria-label="Template recreation instruction"]')).not.toBeNull();
    expect(host.querySelector('dialog[aria-label="Figma brand story"][open]')).toBeNull();
  } finally { history.replaceState({}, '', previous); }
});


it('copies the selected brand instruction directly and offers manual fallback without opening details', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    await mount();
    await act(async () => button('TOP 100 brands').click());
    await act(async () => button('View Figma brand series').click());
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    await act(async () => button('Recreate template', brand).click());
    expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('one'));
    expect(host.querySelector('dialog[aria-label="Template preview"][open]')).toBeNull();
    await act(async () => button('Recreate and submit', brand).click());
    const contribution = vi.mocked(navigator.clipboard.writeText).mock.calls.at(-1)![0];
    expect(contribution).toContain('one');
    expect(contribution).toContain('Create a reusable, editable template');
    expect(contribution).toContain('Do not merge or publish');
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('NotAllowedError'));
    await act(async () => button('Recreate template', brand).click());
    expect(brand.querySelector('textarea')?.value).toContain('one');
    expect(host.querySelector('dialog[aria-label="Template preview"][open]')).toBeNull();
    vi.useFakeTimers();
    try {
      vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise(() => {}));
      await act(async () => button('Recreate template', brand).click());
      expect(button('Loading instruction…', brand).disabled).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
      expect(button('Recreate template', brand).disabled).toBe(false);
      expect(brand.querySelector('textarea')?.value).toContain('one');
    } finally { vi.useRealTimers(); }

  } finally { history.replaceState({}, '', previous); }
});

it('attributes the brand timeline, work changes and nested detail actions without inventing template card clicks', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    await mount();
    await act(async () => button('TOP 100 brands').click());
    await act(async () => button('View Other brand series').click());
    const brand = host.querySelector('dialog[aria-label="Other brand story"]')!;
    const [opened] = events('ui_click', { area: 'template_series_card', element: 'open_detail' });
    expect(opened).toMatchObject({ series_placement: 'top100', ranking_policy: 'catalog-v1', series_work_count: 2 });
    expect(events('surface_view', { area: 'template_series_detail' })).toHaveLength(1);
    expect(events('surface_view', { area: 'template_series_work' })).toHaveLength(1);
    await act(async () => button('Select work Third', brand).click());
    expect(events('ui_click', { element: 'select_work' })).toEqual([expect.objectContaining({ template_id: 'three', series_view_id: opened.series_view_id })]);
    expect(events('surface_view', { area: 'template_series_work' })).toHaveLength(2);
    await act(async () => button('View full details', brand).click());
    expect(events('ui_click', { area: 'template_card', element: 'open_detail' })).toHaveLength(0);
    const [detail] = events('surface_view', { area: 'template_detail' });
    expect(detail).toMatchObject({ template_id: 'three', series_view_id: opened.series_view_id, series_surface: 'template_detail' });
    await act(async () => button('Recreate template', host.querySelector('dialog[aria-label="Template preview"]')!).click());
    const [copy] = events('template_instruction_copy_result');
    expect(copy).toMatchObject({ copy_status: 'clipboard_written', series_view_id: opened.series_view_id, detail_view_id: detail.detail_view_id });
    await act(async () => button('Close template preview').click());
    expect(events('surface_view', { area: 'template_series_detail' })).toHaveLength(1);
    expect(events('surface_view', { area: 'template_series_work' })).toHaveLength(2);
    await act(async () => button('Close brand story', brand).click());
    expect(events('ui_click', { area: 'template_detail', element: 'close_detail', series_view_id: opened.series_view_id })).toEqual([expect.objectContaining({ detail_view_id: detail.detail_view_id })]);
    expect(events('ui_click', { area: 'template_series_detail', element: 'close_detail', series_view_id: opened.series_view_id })).toHaveLength(1);
    for (const row of tracked) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
  } finally { history.replaceState({}, '', previous); }
});

it('counts only qualified series impressions, retains their source on direct copy/download and deduplicates on return', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  vi.useFakeTimers();
  try {
    await mount();
    await act(async () => button('TOP 100 brands').click());
    const card = host.querySelector('[data-brand-series="Figma"]')!;
    await act(async () => impressions().emit(1, [card]));
    await act(async () => { vi.advanceTimersByTime(700); });
    await act(async () => impressions().emit(.4, [card]));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(events('surface_view', { area: 'template_series_card' })).toHaveLength(0);
    await act(async () => impressions().emit(1, [card]));
    await act(async () => { vi.advanceTimersByTime(1000); });
    const [seen] = events('surface_view', { area: 'template_series_card' });
    expect(seen).toMatchObject({ series_placement: 'top100', series_rank: 1, series_position: 1 });
    await act(async () => button('View Figma brand series').click());
    expect(Observer.instances.filter(item => !item.disconnected && item.options?.threshold === .5)).toHaveLength(0);
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    await act(async () => button('Recreate template', brand).click());
    const [intent] = events('ui_click', { element: 'start_use' });
    const [result] = events('template_instruction_copy_result');
    expect(result).toMatchObject({ series_id: seen.series_id, series_list_id: seen.series_list_id, series_surface: 'timeline', copy_attempt_id: intent.copy_attempt_id, copy_status: 'clipboard_written' });
    expect(result.detail_view_id).toBeUndefined();
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('PRIVATE_ERROR'));
    await act(async () => button('Recreate template', brand).click());
    expect(events('template_instruction_copy_result').at(-1)).toMatchObject({ copy_status: 'manual_fallback_shown', series_view_id: result.series_view_id });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await act(async () => button('Download motion.md', brand).click());
    const [download] = events('ui_click', { element: 'download_guide' });
    expect(events('resource_download_result')[0]).toMatchObject({ download_attempt_id: download.download_attempt_id, series_view_id: result.series_view_id, delivery_status: 'fetch_failed' });
    await act(async () => button('Close brand story', brand).click());
    await act(async () => impressions().emit(1, [card]));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(events('surface_view', { area: 'template_series_card' })).toHaveLength(1);
    for (const row of tracked) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
    expect(JSON.stringify(tracked)).not.toContain('PRIVATE_ERROR');
  } finally { vi.useRealTimers(); history.replaceState({}, '', previous); }
});

it('records direct instruction preparation failure and successful download as separate observed results', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    const catalogueFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => url.endsWith('/integration') ? new Response('', { status: 503 }) : catalogueFetch(url, init)));
    await mount();
    await act(async () => button('TOP 100 brands').click());
    await act(async () => button('View Figma brand series').click());
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await act(async () => button('Recreate template', brand).click());
    const [intent] = events('ui_click', { element: 'start_use' });
    expect(events('template_instruction_copy_result')).toEqual([expect.objectContaining({ copy_status: 'failed', copy_attempt_id: intent.copy_attempt_id, series_view_id: intent.series_view_id })]);
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => new Response('# motion')));
    await act(async () => button('Download motion.md', brand).click());
    const [download] = events('ui_click', { element: 'download_guide' });
    expect(events('resource_download_result')).toEqual([expect.objectContaining({ delivery_status: 'browser_save_requested', download_attempt_id: download.download_attempt_id, series_view_id: intent.series_view_id })]);
    for (const row of tracked) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
  } finally { history.replaceState({}, '', previous); }
});

it('sends discovery ranking and actual interleaved card position on exposure and opening', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  vi.useFakeTimers();
  try {
    fetchItems(Array.from({ length: 36 }, (_, i) => ({ ...items[i % 3], id: 'rank-' + i, brand: 'Brand ' + Math.floor(i / 3), title: 'Work ' + i, sortOrder: i })));
    await mount();
    const all = [...host.querySelectorAll('main [data-template-id], main [data-series-id]')];
    const card = host.querySelector('[data-series-id]')!;
    const position = all.indexOf(card) + 1;
    expect(position).toBeGreaterThanOrEqual(7); expect(position).toBeLessThanOrEqual(9);
    await act(async () => impressions().emit(1, [card]));
    await act(async () => { vi.advanceTimersByTime(1000); });
    const [seen] = events('surface_view', { area: 'template_series_card' });
    expect(seen).toMatchObject({ series_placement: 'discovery', series_rank: 1, series_position: position, ranking_policy: 'works59-ctr41-v1', ranking_snapshot: 'ctr-20261118-v2' });
    await act(async () => card.querySelector('button')!.click());
    const [opened] = events('ui_click', { area: 'template_series_card' });
    const { element: _element, ...source } = seen;
    expect(opened).toMatchObject(source);
    expect(opened.series_view_id).toMatch(uuid);
    expect(events('ui_click', { area: 'template_card' })).toHaveLength(0);
  } finally { vi.useRealTimers(); history.replaceState({}, '', previous); }
});

it('opens the same filtered brand collection shown on its TOP 100 card', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    await mount();
    await act(async () => button('TOP 100 brands').click());
    await search('Second');
    const card = host.querySelector('[data-brand-series="Other"]')!;
    expect(card.textContent).toContain('1 work');
    await act(async () => button('View Other brand series', card).click());
    const brand = host.querySelector('dialog[aria-label="Other brand story"]')!;
    expect(brand.querySelectorAll('[data-film-id]')).toHaveLength(1);
    expect(button('Select work Second', brand)).toBeDefined();
    expect(button('Select work Third', brand)).toBeUndefined();
    expect(events('surface_view', { area: 'template_series_detail' })).toEqual([expect.objectContaining({ series_work_count: 1 })]);
  } finally { history.replaceState({}, '', previous); }
});

it('reports a one-based series position when a learning example clears the purpose filter', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    const first = { ...items[0], uses: ['Product launch'], postedAt: '2025-01-01' };
    const example = { ...first, id: 'motion-dfb1a35a-a70e-489f-8e02-b74068fc0b8c', title: 'Design feature example', uses: ['Product demo'], sortOrder: 3, postedAt: '2025-02-01' };
    fetchItems([first, example]);
    await mount();
    await act(async () => button('TOP 100 brands').click());
    await act(async () => button('View Figma brand series').click());
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    await act(async () => button('Product launch films', brand).click());
    expect(brand.querySelectorAll('[data-film-id]')).toHaveLength(1);
    await act(async () => {
      const learning = brand.querySelector<HTMLDetailsElement>('details:has(button)')!;
      learning.open = true;
      button('Design feature example', learning).click();
    });
    expect(button('All purposes', brand).getAttribute('aria-pressed')).toBe('true');
    expect(brand.querySelector('[aria-label="Select work Design feature example"][aria-current="true"]')).not.toBeNull();
    const position = { template_id: example.id, series_work_position: 2 };
    expect(events('ui_click', { element: 'select_work' })).toEqual([expect.objectContaining(position)]);
    expect(events('surface_view', { area: 'template_series_work' }).at(-1)).toMatchObject(position);
  } finally { history.replaceState({}, '', previous); }
});

it('does not keep the compare exclusion when reopening the library', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    let setOpen!: React.Dispatch<React.SetStateAction<boolean>>;
    function ReopenLibrary() {
      const [open, updateOpen] = React.useState(true);
      setOpen = updateOpen;
      return <TemplateLibraryDialog open={open} busy={false} error="" onClose={() => updateOpen(false)} onOpen={() => {}} />;
    }
    await act(async () => root.render(<I18nProvider initialLocale="en"><ReopenLibrary /></I18nProvider>));
    await act(async () => button('TOP 100 brands').click());
    await act(async () => button('View Figma brand series').click());
    const brand = host.querySelector('dialog[aria-label="Figma brand story"]')!;
    await act(async () => button('Compare Product launch films from other brands', brand).click());
    expect(button('Excluding Figma')).toBeDefined();
    expect(cards()).toEqual(['two']);
    await act(async () => setOpen(false));
    await act(async () => setOpen(true));
    expect(button('Excluding Figma')).toBeUndefined();
    expect(cards()).toEqual(['two', 'one', 'three']);
  } finally { history.replaceState({}, '', previous); }
});

it('localizes the brand intro, series controls, and filmstrip accessibility labels', async () => {
  const previous = location.href;
  history.replaceState({}, '', '/?brandStoriesPreview=1');
  try {
    await mount('ja');
    await act(async () => button(translate('ja', 'TOP 100 brands')).click());
    expect(host.textContent).toContain('次の発表のヒントを探そう。');
    await act(async () => button('Figma のブランドシリーズを見る').click());
    const brand = host.querySelector('dialog[aria-label="Figma のブランドストーリー"]')!;
    expect(brand.querySelector('[aria-label="ブランド作品のフィルムストリップ"]')).not.toBeNull();
    expect(button('作品「First」を選択', brand)).toBeDefined();
    expect(button('詳細をすべて見る', brand)).toBeDefined();
  } finally { history.replaceState({}, '', previous); }
});
