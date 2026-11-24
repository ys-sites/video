// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';

const sent: { event: string; properties: Record<string, unknown> }[] = [];
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async (event: string, properties: Record<string, unknown>) => { sent.push({ event, properties }); return 'queued'; }) }));
vi.mock('./AccountSettings', () => ({ useAccountSummary: () => ({ account: { state: 'signed-out' }, error: false }) }));
vi.mock('./useMediaCatalog', () => ({ useMediaCatalog: () => ({ catalog: { models: [], status: { providers: [{ id: 'gemini', label: 'Gemini', available: false }] } }, failed: false, retry: () => {} }) }));
const { ModelHub } = await import('./ModelHub');
const { I18nProvider } = await import('../i18n/I18n');
const { findModelHub } = await import('./modelHubs');
await (await import('./reporting')).loadReportingTransport();

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
const of = (event: string) => sent.filter(row => row.event === event);
const clicks = () => of('ui_click').map(row => row.properties);
const button = (label: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')]
  .find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)!;
beforeEach(() => {
  sent.length = 0;
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => {}) } });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); });

it('reports one hub view and its hero, filter, video and detail actions by id only', async () => {
  const hub = findModelHub('gemini-4')!;
  await act(async () => root.render(<I18nProvider initialLocale="en"><ModelHub id="gemini-4" hasProject onExplore={() => {}} onProvider={() => {}} onModel={() => {}} onUse={() => {}} onSettings={() => {}} /></I18nProvider>));
  expect(of('page_view').map(row => row.properties)).toEqual([expect.objectContaining({ page_name: 'model_hub', hub_id: 'gemini-4', signed_in: false, has_project: true })]);

  await act(async () => button('Connect your own API key', container.querySelector('.om-model-hub-hero')!).click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'model_hub', area: 'hub_hero', element: 'connect_key', hub_id: 'gemini-4', signed_in: false });

  const filters = container.querySelectorAll<HTMLButtonElement>('.om-hub-video-filters button');
  await act(async () => filters[1].click());
  expect(clicks().at(-1)).toMatchObject({ area: 'hub_videos', element: 'filter_option', filter_value: expect.stringMatching(/^[a-z0-9-]+$/) });

  const cover = container.querySelector<HTMLButtonElement>('.om-hub-video .om-gallery-cover')!;
  await act(async () => cover.click());
  expect(clicks().at(-1)).toMatchObject({ area: 'hub_videos', element: 'open_detail', hub_video_id: expect.stringMatching(/^[a-z0-9-]+$/i), position: 0, signed_in: false });
  const dialog = document.querySelector<HTMLElement>('.om-hub-video-detail')!;
  await act(async () => button('Recreate this template', dialog).click());
  expect(clicks().at(-1)).toMatchObject({ area: 'hub_video_detail', element: 'start_use', template_action: 'recreate' });
  await act(async () => button('Next template', dialog).click());
  expect(clicks().at(-1)).toMatchObject({ area: 'hub_video_detail', element: 'detail_next' });
  await act(async () => button('Close template preview', dialog).click());
  expect(clicks().at(-1)).toMatchObject({ area: 'hub_video_detail', element: 'close_detail' });

  for (const row of sent) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
  // Video titles, creators and post links never leave the browser.
  const text = JSON.stringify(sent);
  for (const video of hub.videos.slice(0, 5)) {
    expect(text).not.toContain(video.title);
    expect(text).not.toContain(video.post);
  }
});
