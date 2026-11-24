// Reports for the editor's template library. Event, area, element and field names follow the shared OpenMotion
// tracking sheet so one funnel reads the same on the website and in the editor.
// The dialog calls these and owns no tracking code of its own; nothing here may throw into it.
import type { SeriesAttribution } from './brandStoryTracking';
import { studioEvents } from '../../../tracking/events.ts';
import { uuid } from '../../../tracking/core.ts';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';
import { optionId, send, slugField, searchKeyword } from './reporting';
import type { AssetUploadReason } from './assetUploadError';

import type { Fields } from './reporting';
type Click = Fields<'ui_click'>;
export type Placement = NonNullable<Click['placement']>;
export type Sort = NonNullable<Click['sort']>;
export type FilterGroup = NonNullable<Click['filter_group']>;
export type TemplateAction = NonNullable<Click['template_action']>;
export type FilterAction = Fields<'template_filter_result'>['action'];
type Template = GalleryTemplate;
/** What the list looked like when something happened: the active search, the sort and how many filters were on. */
export type ListContext = { searchId?: string; sort: Sort; filterCount: number; libraryViewId?: string; discoveryId?: string; resultSetId?: string };
/** One opened detail: its id and how the user got there. */
export type DetailView = { id: string; placement: Placement; context?: ListContext; series?: SeriesAttribution };
/** Timeline actions have a series view, without inventing a template detail view. */
export type ActionView = DetailView | { series: SeriesAttribution };

export { newTrackingId, optionId, searchKeyword } from './reporting';
const SORTS: readonly string[] = studioEvents.ui_click.fields.sort;
export const asSort = (value: string): Sort => SORTS.includes(value) ? value as Sort : 'recommended';
const studio = { page_name: 'studio' } as const;
/** A catalogue id is sent only when it is a bounded slug; anything else is left out, never rewritten. */
const templateId = (template: Template) => slugField('template_id', template.id);
const contextIds = (context: Pick<ListContext, 'libraryViewId' | 'discoveryId' | 'resultSetId'>) => ({
  ...(context.libraryViewId ? { library_view_id: context.libraryViewId } : {}), ...(context.discoveryId ? { discovery_id: context.discoveryId } : {}),
  ...(context.resultSetId ? { result_set_id: context.resultSetId } : {}),
});
const list = (context: ListContext) => ({ ...contextIds(context), sort: context.sort, applied_filter_count: context.filterCount, ...(context.searchId ? { search_id: context.searchId } : {}) });
const detail = (view: ActionView | undefined) => view ? { ...('id' in view ? { detail_view_id: view.id, detail_mode: 'modal' as const, ...(view.context ? list(view.context) : {}) } : {}), ...view.series } : {};
const actionArea = (view: ActionView | undefined) => view?.series?.series_surface === 'timeline' ? 'template_series_detail' as const : 'template_detail' as const;
const resource = (template: Template) => ({ resource_kind: isEditableTemplate(template) ? 'editable_project' as const : 'reference' as const });
const instruction = (template: Template, submit = false) => ({
  instruction_kind: submit ? 'recreate_submit' as const : isEditableTemplate(template) ? 'template_use' as const : 'reference_recreate' as const });

export function reportLibraryShown(context: Pick<ListContext, 'libraryViewId'> = {}) {
  send('surface_view', { ...studio, area: 'template_library', element: 'library', ...contextIds(context) });
}
/** The denominator for a card's click-through rate. The caller decides when a card was really seen and reports it once per result set. */
export function reportCardShown(template: Template, position: number, context: ListContext, placement: Extract<Placement, 'catalog' | 'black_friday'> = 'catalog') {
  send('surface_view', { ...studio, area: 'template_card', element: 'card', ...templateId(template), ...resource(template), placement, position, ...list(context) });
}
/** A gallery card or a related-template thumbnail was opened. */
export function reportCardOpened(template: Template, placement: Extract<Placement, 'catalog' | 'related' | 'black_friday'>, position: number, context: ListContext, source?: Template, view?: DetailView) {
  send('ui_click', { ...studio, area: 'template_card', element: 'open_detail', ...templateId(template), ...resource(template), placement, position, ...list(context),
    ...(source ? slugField('source_template_id', source.id) : {}), ...(source ? detail(view) : {}) });
}

export type DetailAction = Extract<Click['element'], 'view_guide' | 'back_to_template' | 'handoff_help' | 'copy_color' | 'retry_template_project' | 'check_template_project' | 'open_prepared_project' | 'close_detail'>;
export function reportDetailAction(template: Template, element: DetailAction, view: DetailView | undefined) {
  send('ui_click', { ...studio, area: 'template_detail', element, ...templateId(template), ...resource(template), ...detail(view) });
}
export function reportGuideShown(template: Template, view: DetailView | undefined) {
  send('surface_view', { ...studio, area: 'template_guide', element: 'guide', ...templateId(template), ...detail(view) });
}
export function reportRelatedShown(source: Template, count: number, view: DetailView | undefined) {
  send('surface_view', { ...studio, area: 'template_related', element: 'related', ...templateId(source), result_count: count, ...detail(view) });
}
export function reportRelatedCardShown(template: Template, position: number, source: Template, view: DetailView | undefined) {
  send('surface_view', { ...studio, area: 'template_card', element: 'card', placement: 'related', position,
    ...templateId(template), ...resource(template), ...slugField('source_template_id', source.id), ...detail(view) });
}
export function reportProjectResult(template: Template, operationId: string, attemptId: string,
  stage: Fields<'template_project_result'>['stage'], outcome: Fields<'template_project_result'>['outcome'], view: DetailView | undefined, projectId?: string) {
  const identity = templateId(template);
  if (!uuid.test(operationId) || !uuid.test(attemptId) || !identity.template_id) return;
  send('template_project_result', { ...studio, template_id: identity.template_id,
    operation_id: operationId, handoff_attempt_id: attemptId, stage, outcome, ...resource(template), ...detail(view),
    ...(projectId && uuid.test(projectId) ? { project_id: projectId } : {}) });
}
export function reportSurprise(context: ListContext, resultCount: number) {
  send('ui_click', { ...studio, area: 'template_discovery', element: 'surprise_me', result_count: resultCount, ...list(context) });
}
/** Previous/next inside the detail. `template` is the one being left. */
export function reportDetailStep(template: Template | null, step: number, view: DetailView | undefined) {
  send('ui_click', { ...studio, area: 'template_detail', element: step < 0 ? 'detail_previous' : 'detail_next', ...(template ? templateId(template) : {}), ...detail(view) });
}
export function reportDetailShown(template: Template, view: DetailView, position: number | undefined) {
  send('surface_view', { ...studio, area: 'template_detail', element: 'detail', ...templateId(template), ...resource(template), ...detail(view),
    placement: view.placement, ...(position ? { position } : {}) });
}
/** Open-and-edit or a recreate button. A click is intent only; the copy result and the project result say what happened. */
export function reportUseClicked(template: Template, action: TemplateAction, view: ActionView | undefined, copyAttemptId?: string, operationId?: string) {
  send('ui_click', { ...studio, area: actionArea(view), element: 'start_use', ...templateId(template), ...resource(template), template_action: action,
    ...(copyAttemptId ? { copy_attempt_id: copyAttemptId } : {}), ...(operationId ? { operation_id: operationId } : {}), ...detail(view) });
}
export function reportInstructionShown(template: Template, view: DetailView | undefined) {
  send('surface_view', { ...studio, area: 'template_instruction', element: 'instruction', ...templateId(template), ...resource(template), ...instruction(template), ...detail(view) });
}
export function reportInstructionExpanded(template: Template, expanded: boolean, view: DetailView | undefined) {
  send('ui_click', { ...studio, area: 'template_instruction', element: 'expand_instruction', expanded, ...templateId(template), ...detail(view) });
}
/** Only `clipboard_written` is a successful copy; showing the text for a manual copy is not. */
export function reportCopyResult(template: Template, status: Fields<'template_instruction_copy_result'>['copy_status'], copyAttemptId: string, submit: boolean, view: ActionView | undefined) {
  send('template_instruction_copy_result', { ...studio, host_product: 'codex', copy_status: status, copy_attempt_id: copyAttemptId, ...templateId(template), ...resource(template), ...instruction(template, submit), ...detail(view) });
}
export function reportSearchResult(searchId: string, query: string, resultCount: number, context: Omit<ListContext, 'searchId'>) {
  const keyword = searchKeyword(query);
  if (!keyword) return;
  send('template_search_result', { ...studio, area: 'template_discovery', search_id: searchId, search_keyword: keyword, query_length: query.trim().length,
    result_count: resultCount, outcome: 'success', sort: context.sort, applied_filter_count: context.filterCount, ...contextIds(context) });
}
export function reportBlackFridayEntry() {
  send('ui_click', { ...studio, area: 'template_discovery', element: 'open_collection', placement: 'black_friday', position: 2 });
}

export function reportDiscoveryClick(element: Extract<Click['element'], 'category_select' | 'filter_open' | 'filter_clear' | 'filter_option' | 'sort_option' | 'submit_video'>,
  context: ListContext, extra: Pick<Click, 'filter_group' | 'selected' | 'previous_sort' | 'changed'> & { option?: string } = {}) {
  const { option, ...fields } = extra;
  send('ui_click', { ...studio, area: 'template_discovery', element, ...fields, ...(option === undefined ? {} : optionId(option)), ...list(context) });
}
/** Reported once the changed list is on screen, so `result_count` is what the user actually got. */
export function reportFilterResult(action: FilterAction, resultCount: number, context: ListContext) {
  send('template_filter_result', { ...studio, area: 'template_discovery', action, result_count: resultCount, outcome: 'success', ...list(context) });
}
export function reportDownloadClicked(template: Template, kind: 'download_guide' | 'download_project', downloadAttemptId: string | undefined, view: ActionView | undefined) {
  send('ui_click', { ...studio, area: actionArea(view), element: kind, ...templateId(template), resource_kind: kind === 'download_guide' ? 'motion_guide' : 'editable_project',
    ...(downloadAttemptId ? { download_attempt_id: downloadAttemptId } : {}), ...detail(view) });
}
export function reportDownloadResult(template: Template, downloadAttemptId: string, status: 'browser_save_requested' | 'fetch_failed', errorCode: string | undefined, view: ActionView | undefined) {
  send('resource_download_result', { ...studio, resource_kind: 'motion_guide', download_attempt_id: downloadAttemptId, delivery_status: status,
    ...(errorCode ? { error_code: errorCode } : {}), ...templateId(template), ...detail(view) });
}
/** Links that leave the detail: the full motion guide, the template's repository directory, or the original post. */
export function reportDetailLink(template: Template, element: 'view_full_page' | 'view_repository' | 'view_source', view: ActionView | undefined) {
  send('ui_click', { ...studio, area: actionArea(view), element, ...templateId(template), ...detail(view) });
}

export type RecoveryAction = 'search_focus' | 'clear_search' | 'reference' | 'describe' | 'reference_source_select' | 'choose_local_video' | 'copy_brief';
type ReferenceEntry = 'library_home';
type ReferenceSource = Fields<'template_search_handoff_result'>['source_kind'];
export function reportRecoveryAction(element: RecoveryAction, context: ListContext, entry?: ReferenceEntry, source?: ReferenceSource) {
  send('ui_click', { ...studio, area: 'template_discovery', element, ...(entry && { reference_entry: entry }),
    ...(source && { source_kind: source }), ...list(context) });
}
export function reportReferenceEntryShown(context: ListContext) {
  send('surface_view', { ...studio, area: 'template_discovery', element: 'reference', reference_entry: 'library_home', ...list(context) });
}

const referenceImportErrors = {
  size: 'too_large', unreadable: 'unreadable', unsupported: 'unsupported_format',
} as const satisfies Record<AssetUploadReason, Fields<'studio_asset_import_result'>['error_category']>;

export function reportReferenceImport(outcome: 'success' | 'failure' | 'unknown', context: ListContext, entry?: ReferenceEntry, reason?: AssetUploadReason) {
  send('studio_asset_import_result', {
    entry_point: 'template_reference', outcome, requested_count: 1, added_count: Number(outcome === 'success'),
    failed_count: Number(outcome === 'failure'), ...(outcome === 'unknown' && { unknown_count: 1 }),
    ...(outcome === 'failure' && { error_category: reason ? referenceImportErrors[reason] : 'other' }),
    ...(entry && { reference_entry: entry }), ...list(context),
  });
}
export function reportRecoveryShown(reason: 'no_results' | 'unsuitable' | 'catalog_empty', context: ListContext) {
  send('surface_view', { ...studio, area: 'template_discovery', element: 'search_recovery', recovery_reason: reason, ...list(context) });
}
export function reportSearchHandoff(source: ReferenceSource, attemptId: string, status: 'clipboard_written' | 'manual_fallback', context: ListContext, entry?: ReferenceEntry) {
  send('template_search_handoff_result', { ...studio, area: 'template_discovery', source_kind: source, handoff_attempt_id: attemptId, handoff_status: status, ...(entry && { reference_entry: entry }), ...list(context) });
}
