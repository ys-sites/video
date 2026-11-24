// Reports for the Skills page and the Brand Kit page. Event, area, element and field names follow the
// same page_name + area + element convention as the template library, so the funnels read alike.
// The pages call these and own no tracking code of their own; nothing here may throw into them.
import { slug } from '../../../tracking/core.ts';
import { providerSetupEntries, type ProviderSetupEntry } from '../../../tracking/events.ts';
import type { BrandKit } from '../../../shared/brand-kit';
import type { MotionSkill, SkillParameters } from './skillCatalog';
import { embeddedView, newTrackingId, optionId, searchKeyword, send, slugField, type Fields, modelFields } from './reporting';

export { newTrackingId };
type Click = Fields<'ui_click'>;
/** The page view carries the same shell context as the studio page view, so the funnels segment alike. */
const shell = (hasProject: boolean) => ({ view_id: newTrackingId(), embedded: embeddedView(), has_project: hasProject });

// ---------- Skills ----------
const skills = { page_name: 'skills' } as const;
const CATEGORY = { 'Talking-head & editing': 'talking_head', 'Product promos': 'product_promos', Explainers: 'explainers', 'Product ads': 'product_ads', 'Brand & covers': 'brand_covers', 'Motion techniques': 'motion_techniques' } as const;
export const skillCategoryId = (category: MotionSkill['category']) => CATEGORY[category];
/** A catalogue id is sent only when it is a bounded slug; anything else is left out, never rewritten. */
const skillFields = (skill: MotionSkill) => ({ ...slugField('skill_id', skill.id), skill_category: skillCategoryId(skill.category) });

export function reportSkillsPageView(hasProject: boolean) {
  send('page_view', { ...skills, ...shell(hasProject) });
}
/** `category` null is the「All」button. */
export function reportSkillCategory(category: MotionSkill['category'] | null, resultCount: number) {
  send('ui_click', { ...skills, area: 'skill_discovery', element: 'category_select', selected: category !== null,
    ...(category ? { skill_category: skillCategoryId(category) } : {}), result_count: resultCount });
}
export function reportSkillFiltersCleared() {
  send('ui_click', { ...skills, area: 'skill_discovery', element: 'filter_clear' });
}
export function reportSkillSearch(searchId: string, query: string, resultCount: number, category: MotionSkill['category'] | null) {
  const keyword = searchKeyword(query);
  if (!keyword) return;
  send('skill_search_result', { ...skills, area: 'skill_discovery', search_id: searchId, search_keyword: keyword, query_length: query.trim().length,
    result_count: resultCount, outcome: 'success', ...(category ? { skill_category: skillCategoryId(category) } : {}) });
}
export function reportSkillCardOpened(skill: MotionSkill, position: number, searchId: string | undefined, placement?: 'black_friday') {
  send('ui_click', { ...skills, area: 'skill_card', element: 'open_detail', ...skillFields(skill), position, ...(placement ? { placement } : {}), ...(searchId ? { search_id: searchId } : {}) });
}
export function reportSkillDetailShown(skill: MotionSkill, detailViewId: string) {
  send('surface_view', { ...skills, area: 'skill_detail', element: 'detail', ...skillFields(skill), detail_view_id: detailViewId });
}
export function reportSkillDetailClick(skill: MotionSkill, element: Extract<Click['element'], 'copy_instruction' | 'open_command' | 'view_source' | 'close_detail'>,
  detailViewId: string | undefined, copyAttemptId?: string) {
  send('ui_click', { ...skills, area: 'skill_detail', element, ...skillFields(skill), ...(detailViewId ? { detail_view_id: detailViewId } : {}),
    ...(copyAttemptId ? { copy_attempt_id: copyAttemptId } : {}) });
}
export function reportSkillCommandCopyClicked(skill: MotionSkill, detailViewId: string | undefined, copyAttemptId: string) {
  send('ui_click', { ...skills, area: 'skill_command', element: 'copy_command', ...skillFields(skill), copy_attempt_id: copyAttemptId,
    ...(detailViewId ? { detail_view_id: detailViewId } : {}) });
}
/** Only `clipboard_written` is a successful copy; showing the text for a manual copy is not. The brief is reduced to its choices. */
export function reportSkillCopyResult(skill: MotionSkill, surface: 'instruction' | 'command', status: 'clipboard_written' | 'manual_fallback_shown',
  copyAttemptId: string, parameters: SkillParameters, detailViewId: string | undefined) {
  if (!slug.test(skill.id)) return;
  send('skill_instruction_copy_result', { ...skills, skill_id: skill.id, skill_category: skillCategoryId(skill.category), copy_surface: surface, copy_status: status,
    copy_attempt_id: copyAttemptId, duration_seconds: parameters.duration, aspect_ratio: parameters.aspect,
    has_subject: parameters.subject.trim().length > 0, has_style: parameters.style.trim().length > 0, media_required: Boolean(skill.media),
    ...(detailViewId ? { detail_view_id: detailViewId } : {}) });
}
export function reportSkillSubmitClicked() {
  send('ui_click', { ...skills, area: 'skill_intro', element: 'submit_skill' });
}

// ---------- Brand Kit ----------
const brandPage = { page_name: 'brand_kit' } as const;
export type BrandCollection = 'official' | 'mine';
/** An official kit is named by its catalogue id; the user's own kit is reported only as「mine」. */
export const brandFields = (kit: Pick<BrandKit, 'catalogId'>) => kit.catalogId && slug.test(kit.catalogId)
  ? { brand_source: 'official' as const, catalog_id: kit.catalogId } : { brand_source: kit.catalogId ? 'official' as const : 'mine' as const };

export function reportBrandKitPageView(collection: BrandCollection, hasProject: boolean) {
  send('page_view', { ...brandPage, ...shell(hasProject), brand_collection: collection });
}
export function reportBrandCollectionTab(collection: BrandCollection) {
  send('ui_click', { ...brandPage, area: 'brand_collection', element: 'collection_tab', brand_collection: collection });
}
export function reportNewBrandKitClicked(collection: BrandCollection) {
  send('ui_click', { ...brandPage, area: 'brand_library', element: 'new_brand_kit', brand_collection: collection });
}
export function reportBrandSurprise(collection: BrandCollection, resultCount: number) {
  send('ui_click', { ...brandPage, area: 'brand_library', element: 'surprise_me', brand_collection: collection, result_count: resultCount });
}
/** `success` means the extraction was accepted and started; whether the kit later becomes ready is a server-side result. */
export function reportBrandKitCreateResult(outcome: 'success' | 'failure', createAttemptId: string) {
  send('brand_kit_create_result', { ...brandPage, outcome, create_attempt_id: createAttemptId });
}
/** A card in「My brand kits」was opened. Official cards report through the import result. */
export function reportBrandCardOpened(kit: Pick<BrandKit, 'catalogId'>, position: number | undefined) {
  send('ui_click', { ...brandPage, area: 'brand_card', element: 'open_detail', ...brandFields(kit), ...(position ? { position } : {}) });
}
export function reportBrandKitImportResult(catalogId: string, outcome: 'success' | 'failure', alreadyInLibrary: boolean, position: number | undefined) {
  if (!slug.test(catalogId)) return;
  send('brand_kit_import_result', { ...brandPage, catalog_id: catalogId, outcome, already_in_library: alreadyInLibrary, ...(position ? { position } : {}) });
}
export function reportBrandDetailShown(kit: Pick<BrandKit, 'catalogId' | 'state'>, detailViewId: string) {
  send('surface_view', { ...brandPage, area: 'brand_detail', element: 'detail', ...brandFields(kit), brand_state: kit.state, detail_view_id: detailViewId });
}
export function reportBrandDetailClick(kit: Pick<BrandKit, 'catalogId'>, element: Extract<Click['element'], 'copy_instruction' | 'download_package' | 'detail_previous' | 'detail_next'>,
  detailViewId: string | undefined, attempt: { copy_attempt_id?: string; download_attempt_id?: string } = {}) {
  send('ui_click', { ...brandPage, area: 'brand_detail', element, ...brandFields(kit), ...attempt, ...(detailViewId ? { detail_view_id: detailViewId } : {}) });
}
export function reportBrandCopyResult(kit: Pick<BrandKit, 'catalogId'>, status: 'clipboard_written' | 'failed', copyAttemptId: string, detailViewId: string | undefined) {
  send('brand_kit_instruction_copy_result', { ...brandPage, ...brandFields(kit), copy_status: status, copy_attempt_id: copyAttemptId,
    ...(detailViewId ? { detail_view_id: detailViewId } : {}) });
}
/** `browser_save_requested` means the ZIP was handed to the browser; nothing confirms the file reached disk. */
export function reportBrandDownloadResult(kit: Pick<BrandKit, 'catalogId'>, status: 'browser_save_requested' | 'fetch_failed', downloadAttemptId: string, detailViewId: string | undefined) {
  send('resource_download_result', { ...brandPage, resource_kind: 'brand_kit_package', download_attempt_id: downloadAttemptId, delivery_status: status, ...brandFields(kit),
    ...(detailViewId ? { detail_view_id: detailViewId, detail_mode: 'modal' as const } : {}) });
}
export function reportBrandActionResult(kit: Pick<BrandKit, 'catalogId'>, action: Fields<'brand_kit_action_result'>['action'], outcome: 'success' | 'failure', detailViewId: string | undefined) {
  send('brand_kit_action_result', { ...brandPage, ...brandFields(kit), action, outcome, ...(detailViewId ? { detail_view_id: detailViewId } : {}) });
}

// ---------- MCP connection page ----------
const mcpPage = { page_name: 'mcp' } as const;
export type McpEntry = NonNullable<Fields<'page_view'>['entry_from']>;
export type McpClient = Fields<'mcp_copy_result'>['mcp_client'];
export type McpSetup = 'agent' | 'manual';
type McpCopyKind = Fields<'mcp_copy_result'>['copy_kind'];
type McpClickArea = Extract<Click['area'], `mcp_${string}`>;

/** One view per opening of the page, with the entry that opened it and the client tab it opened on. */
export function reportMcpPageView(entry: McpEntry, client: McpClient, hasProject: boolean) {
  send('page_view', { ...mcpPage, ...shell(hasProject), entry_from: entry, mcp_client: client });
}
export function reportMcpClick(area: McpClickArea, element: Click['element'], fields: Pick<Click, 'mcp_client' | 'setup_method' | 'doc_id' | 'section_id' | 'faq_index' | 'expanded' | 'position'>
  & { capability?: string; template?: string; option?: string } = {}) {
  const { capability, template, option, ...rest } = fields;
  send('ui_click', { ...mcpPage, area, element, ...rest, ...slugField('capability_id', capability), ...slugField('template_id', template), ...(option === undefined ? {} : optionId(option)) });
}
/** Only `clipboard_written` is a successful copy. Instruction text itself is never reported. */
export function reportMcpCopyResult(kind: McpCopyKind, status: 'clipboard_written' | 'failed', client: McpClient,
  extra: { setup?: McpSetup; capability?: string; template?: string; includesSetup?: boolean } = {}) {
  send('mcp_copy_result', { ...mcpPage, copy_kind: kind, copy_status: status, mcp_client: client,
    ...(extra.setup ? { setup_method: extra.setup } : {}), ...slugField('capability_id', extra.capability), ...slugField('template_id', extra.template),
    ...(extra.includesSetup === undefined ? {} : { includes_setup: extra.includesSetup }) });
}

// ---------- Workspace assets ----------
const assetsPage = { page_name: 'assets' } as const;
type AssetClickArea = Extract<Click['area'], `asset${string}`>;
export type AssetKindField = NonNullable<Click['asset_kind']>;
export type Modality = NonNullable<Click['modality']>;
const MODALITIES: readonly string[] = ['image', 'video', 'audio'];
/** A media type from the library; anything unexpected is left out. */
export const modalityField = (value: unknown) => typeof value === 'string' && MODALITIES.includes(value) ? { modality: value as Modality } : {};

export function reportAssetsPageView(hasProject: boolean) {
  send('page_view', { ...assetsPage, ...shell(hasProject) });
}
export function reportAssetsClick(area: AssetClickArea, element: Click['element'],
  fields: Pick<Click, 'asset_kind' | 'task_mode' | 'position' | 'expanded'> & { modality?: unknown } = {}) {
  const { modality, ...rest } = fields;
  send('ui_click', { ...assetsPage, area, element, ...rest, ...modalityField(modality) });
}
/** `studio` is the Design, Cinema or Sound Studio form the generation was submitted from, as catalogue ids. */
export function reportAssetGenerationSubmit(modality: unknown, outcome: 'success' | 'failure', referenceCount: number, newVersion: boolean,
  studio?: { studio: string; scene: string; model?: string }) {
  const field = modalityField(modality);
  if (!field.modality) return;
  send('asset_generation_submit_result', { ...(studio ? { page_name: 'creative_studio' as const, ...slugField('studio_id', studio.studio), ...slugField('scene_id', studio.scene),
    ...modelFields(studio.model) } : assetsPage), modality: field.modality, outcome, reference_count: referenceCount, new_version: newVersion });
}
/** Which change an asset write made: only the kind of change, never the new name. */
export function assetUpdateAction(changes: Record<string, unknown>): Fields<'asset_update_result'>['action'] {
  if (changes.trashed === true) return 'trash';
  if (changes.trashed === false) return 'restore';
  if (typeof changes.name === 'string') return 'rename';
  if (typeof changes.currentVersionId === 'string') return 'switch_version';
  return 'other';
}
export function reportAssetUpdate(changes: Record<string, unknown>, outcome: 'success' | 'failure', modality: unknown) {
  send('asset_update_result', { ...assetsPage, action: assetUpdateAction(changes), outcome, ...modalityField(modality) });
}

// ---------- Settings ----------
const settingsPage = { page_name: 'settings' } as const;
export type SettingsSectionField = NonNullable<Click['settings_section']>;
type SettingsClickArea = Extract<Click['area'], 'settings_nav' | 'provider_list' | 'provider_detail' | 'default_agent' | 'local_agents' | 'account' | 'diagnostics' | 'help_resources'>;
type ProviderAction = Fields<'provider_setting_result'>['action'];
type ProviderKind = Fields<'provider_setting_result'>['provider_kind'];
/** A provider as it may be reported: built-in ids by name, custom providers only as「custom」. */
export const providerFields = (provider: { id: string; custom?: boolean; protocol?: string }): { provider_kind: ProviderKind; provider_id?: string } => {
  const kind: ProviderKind = provider.custom ? 'custom' : provider.protocol === 'account' ? 'account' : provider.protocol === 'agent' ? 'agent' : 'builtin';
  return { provider_kind: kind, ...(kind === 'custom' ? {} : slugField('provider_id', provider.id)) };
};
// The confirmation each provider change already shows names the change; reporting reads the same key.
const PROVIDER_ACTIONS: Record<string, ProviderAction> = {
  'Provider settings saved': 'save_provider', 'Saved key removed': 'remove_key', 'Provider updated': 'toggle_provider', 'Models synced': 'sync_models',
  'Agent status refreshed': 'refresh_agent', 'Provider deleted': 'delete_provider', 'Model added': 'add_model', 'Model updated': 'update_model',
  'Model removed': 'remove_model', 'Default model updated': 'set_default_model',
};
export const providerAction = (message: string): ProviderAction | undefined => PROVIDER_ACTIONS[message];

export function settingsEntryFrom(): ProviderSetupEntry | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = new URLSearchParams(window.location.search).get('entry_from');
  return (providerSetupEntries as readonly string[]).includes(value ?? '') ? value as ProviderSetupEntry : undefined;
}

export function reportSettingsPageView(section: SettingsSectionField, hasProject: boolean) {
  const entry = settingsEntryFrom();
  send('page_view', { ...settingsPage, ...shell(hasProject), settings_section: section, ...(entry ? { entry_from: entry } : {}) });
}
export function reportSettingsClick(area: SettingsClickArea, element: Click['element'],
  fields: Pick<Click, 'settings_section' | 'expanded' | 'position'> & { provider?: { id: string; custom?: boolean; protocol?: string }; agent?: string } = {}) {
  const { provider, agent, ...rest } = fields;
  const entry = settingsEntryFrom();
  send('ui_click', { ...settingsPage, area, element, ...rest, ...(entry ? { entry_from: entry } : {}), ...(provider ? providerFields(provider) : {}), ...slugField('agent_id', agent) });
}
export function reportProviderSetting(provider: { id: string; custom?: boolean; protocol?: string }, action: ProviderAction, outcome: 'success' | 'failure') {
  send('provider_setting_result', { ...settingsPage, ...providerFields(provider), action, outcome });
}
export function reportAgentSetting(agent: string | undefined, action: Fields<'agent_setting_result'>['action'], outcome: 'success' | 'failure') {
  send('agent_setting_result', { ...settingsPage, ...slugField('agent_id', agent), action, outcome });
}
export function reportDiagnosticExport(outcome: Fields<'diagnostic_export_result'>['outcome'], durationMs: number) {
  send('diagnostic_export_result', { ...settingsPage, outcome, duration_ms: Math.max(0, Math.round(durationMs)) });
}

// ---------- Project manager ----------
const projectsPage = { page_name: 'projects' } as const;
export function reportProjectsPageView(hasProject: boolean) {
  send('page_view', { ...projectsPage, ...shell(hasProject) });
}
export function reportProjectsClick(element: Click['element'], fields: Pick<Click, 'manager_tab' | 'selection_count'> = {}) {
  send('ui_click', { ...projectsPage, area: 'project_manager', element, ...fields });
}
export function reportProjectManage(action: Fields<'project_manage_result'>['action'], outcome: 'success' | 'partial' | 'failure', projectCount: number, failedCount = 0) {
  send('project_manage_result', { ...projectsPage, action, outcome, project_count: projectCount, ...(failedCount ? { failed_count: failedCount } : {}) });
}
/** Library uploads reuse the studio import result with library entry points; file names never leave the browser. */
export function reportLibraryImport(entry: 'library_button' | 'library_drop' | 'library_new_version' | 'other', requested: number, added: number) {
  const failed = Math.max(0, requested - added);
  send('studio_asset_import_result', { entry_point: entry, outcome: added === 0 ? 'failure' : failed ? 'partial' : 'success',
    requested_count: requested, added_count: added, failed_count: failed });
}
