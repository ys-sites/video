// Brand stories share the template transport, but never masquerade as template cards or Brand Kits.
import type { GalleryTemplate } from '../../../shared/catalog';
import type { BrandSeries } from './brandStoryData';
import { newTrackingId, optionId, send, slugField, type Fields } from './reporting';
import type { ListContext } from './templateLibraryTracking';

type Click = Fields<'ui_click'>;
export type SeriesContext = Required<Pick<Click, 'series_id' | 'series_list_id' | 'series_placement' | 'series_position' | 'series_rank' | 'series_work_count' | 'ranking_policy'>> & Pick<Click, 'ranking_snapshot' | 'search_id' | 'sort' | 'applied_filter_count'>;
export type SeriesView = SeriesContext & { series_view_id: string };
export type SeriesAttribution = SeriesView & { series_surface: 'timeline' | 'template_detail' };
export type SeriesElement = 'select_work' | 'select_chapter' | 'filter_option' | 'browse_timeline' | 'expand_learning' | 'compare_brands' | 'open_detail' | 'view_repository' | 'close_detail';

/** Stable opaque catalogue grouping identity, including punctuation and Unicode; no display name is transmitted. */
export function seriesId(name: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(name)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return 'series-' + hash.toString(16).padStart(16, '0');
}
export function seriesContext(series: BrandSeries, placement: 'top100' | 'discovery', position: number, rank: number, listId: string, list: ListContext): SeriesContext {
  return { series_id: seriesId(series.name), series_placement: placement, series_position: position, series_rank: rank,
    series_work_count: series.items.length, series_list_id: listId,
    ranking_policy: placement === 'discovery' ? 'works59-ctr41-v1' : 'catalog-v1',
    ...(placement === 'discovery' ? { ranking_snapshot: 'ctr-20261118-v2' } : {}),
    sort: list.sort, applied_filter_count: list.filterCount, ...(list.searchId ? { search_id: list.searchId } : {}) };
}
export function reportSeriesCard(context: SeriesContext) {
  send('surface_view', { page_name: 'studio', area: 'template_series_card', element: 'card', ...context });
}
export function openSeriesView(context: SeriesContext): SeriesView {
  const view = { ...context, series_view_id: newTrackingId() };
  send('ui_click', { page_name: 'studio', area: 'template_series_card', element: 'open_detail', ...view });
  return view;
}
export function reportSeriesShown(view: SeriesView) {
  send('surface_view', { page_name: 'studio', area: 'template_series_detail', element: 'detail', ...view });
}
export function reportSeriesWork(view: SeriesView, template: GalleryTemplate, position: number) {
  send('surface_view', { page_name: 'studio', area: 'template_series_work', element: 'detail', ...view,
    ...slugField('template_id', template.id), series_work_position: position });
}
export function reportSeriesClick(view: SeriesView | undefined, element: SeriesElement, template?: GalleryTemplate,
  extra: Pick<Click, 'series_work_position' | 'chapter_index' | 'browse_method' | 'direction' | 'section_id' | 'selected'> & { purpose?: string } = {}) {
  if (!view) return; // Authoring-only scenes have no analytics context.
  const { purpose, ...fields } = extra;
  send('ui_click', { page_name: 'studio', area: 'template_series_detail', element, ...view,
    ...(template ? slugField('template_id', template.id) : {}), ...fields, ...(purpose === undefined ? {} : optionId(purpose)) });
}
