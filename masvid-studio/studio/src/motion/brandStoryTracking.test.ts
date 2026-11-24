// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';
import { groupBrandSeries } from './brandStoryData';
import { seriesId, seriesContext, openSeriesView, reportSeriesCard, reportSeriesShown, reportSeriesWork, reportSeriesClick } from './brandStoryTracking';
import { reportUseClicked, reportCopyResult, reportDownloadClicked, reportDownloadResult } from './templateLibraryTracking';
import { loadReportingTransport } from './reporting';
import type { GalleryTemplate } from '../../../shared/catalog';

const rows = vi.hoisted(() => [] as { event: string; properties: Record<string, unknown> }[]);
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async (event, properties) => { rows.push({ event, properties }); return 'queued'; }) }));
await loadReportingTransport();
const work = { id: 'work-one', brand: 'Private Brand', title: 'PRIVATE_TITLE', description: 'PRIVATE_COPY', tags: [], uses: [], kind: 'reference' } as GalleryTemplate;
const group = groupBrandSeries([work])[0];
const context = () => seriesContext(group, 'discovery', 8, 1, crypto.randomUUID(), { sort: 'recommended', filterCount: 0 });
beforeEach(() => { rows.length = 0; });
it('uses stable opaque group ids without conflating punctuation or Unicode labels', () => {
  const names = ['A-B', 'A B', 'AB', '品牌', '品牌二', 'Private Brand'];
  expect(new Set(names.map(seriesId)).size).toBe(names.length);
  expect(seriesId('品牌')).toBe(seriesId('品牌'));
  expect(seriesId('Private Brand')).not.toMatch(/private|brand/i);
});
it('admits the whole story path with the same view and attempt ids, without private copy or URLs', () => {
  const entry = context(); reportSeriesCard(entry);
  const view = openSeriesView(entry); reportSeriesShown(view); reportSeriesWork(view, work, 1);
  reportSeriesClick(view, 'select_work', work, { series_work_position: 1 });
  const actionView = { series: { ...view, series_surface: 'timeline' as const } };
  const copy = crypto.randomUUID(), download = crypto.randomUUID();
  reportUseClicked(work, 'recreate_submit', actionView, copy);
  reportCopyResult(work, 'clipboard_written', copy, true, actionView);
  reportDownloadClicked(work, 'download_guide', download, actionView);
  reportDownloadResult(work, download, 'browser_save_requested', undefined, actionView);
  for (const row of rows) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
  expect(rows.slice(1).every(row => row.properties.series_view_id === view.series_view_id)).toBe(true);
  expect(rows.find(row => row.event === 'template_instruction_copy_result')?.properties).toMatchObject({ copy_attempt_id: copy, instruction_kind: 'recreate_submit', series_surface: 'timeline' });
  expect(rows.every(row => row.properties.detail_view_id === undefined)).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(/PRIVATE|Private Brand|http/);
  expect(validProperties(studioEvents, 'ui_click', { ...rows[1].properties, brand_name: 'Private Brand' })).toBe(false);
  expect(validProperties(studioEvents, 'ui_click', { ...rows[1].properties, ranking_policy: 'arbitrary' })).toBe(false);
  expect(validProperties(studioEvents, 'ui_click', { ...rows[1].properties, series_view_id: 'wrong' })).toBe(false);
});
it('keeps ordinary template actions free of series attribution and skips authoring-only actions', () => {
  reportSeriesClick(undefined, 'select_work', work);
  expect(rows).toHaveLength(0);
  reportUseClicked(work, 'recreate', { id: crypto.randomUUID(), placement: 'catalog' });
  expect(rows[0].properties.area).toBe('template_detail');
  expect(rows[0].properties.series_id).toBeUndefined();
});
