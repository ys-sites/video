// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"enableImageFileLoading":false}}
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { validProperties } from '../../../tracking/core.ts';
import { studioEvents } from '../../../tracking/events.ts';
import type { BrandKit } from '../../../shared/brand-kit';

const sent: { event: string; properties: Record<string, unknown> }[] = [];
vi.mock('./tracking', () => ({ trackMotion: vi.fn(async (event: string, properties: Record<string, unknown>) => { sent.push({ event, properties }); return 'queued'; }) }));
vi.mock('./useWorkspace', () => ({ motionApi: vi.fn().mockRejectedValue(new Error('Offline test')) }));

const { SkillsPage } = await import('./SkillsPage');
const { BrandKitPage } = await import('./BrandKitPage');
const { I18nProvider } = await import('../i18n/I18n');
const tracking = await import('./pageTracking');
// Load the (mocked) transport once so every report below is delivered synchronously.
await (await import('./reporting')).loadReportingTransport();

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement, copy: ReturnType<typeof vi.fn>;
const kit: BrandKit = { id: '11111111-1111-4111-8111-111111111111', kind: 'brand-kit', name: 'Private Brand Name', url: 'https://private-brand.example/',
  state: 'ready', progress: 100, createdAt: '2026-11-15', updatedAt: '2026-11-15', preview: false, packagePath: '/local/brand/package' };
beforeEach(() => {
  sent.length = 0;
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')]
  .find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label || node.textContent?.includes(label))!;
const of = (event: string) => sent.filter(row => row.event === event);
/** Every report must pass the same closed schema the server admits, and never carry brief text, names or URLs. */
function expectAdmitted() {
  for (const row of sent) expect(validProperties(studioEvents, row.event, row.properties), `${row.event} ${JSON.stringify(row.properties)}`).toBe(true);
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE_BRIEF|Private Brand|private-brand|neon green/);
}

function SkillsHost() {
  const [skill, setSkill] = useState<string | null>(null);
  return <I18nProvider initialLocale="en"><SkillsPage skillId={skill} onSkillChange={setSkill} /></I18nProvider>;
}

it('reports the Skills funnel: view, category, search, open, detail, copy result with only the brief choices', async () => {
  vi.useFakeTimers();
  act(() => root.render(<SkillsHost />));
  expect(of('page_view')).toEqual([{ event: 'page_view', properties: expect.objectContaining({ page_name: 'skills' }) }]);
  act(() => button('Explainers').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'skill_discovery', element: 'category_select', skill_category: 'explainers', selected: true });
  act(() => button('All').click());
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'stagger'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(of('skill_search_result')).toHaveLength(0);
  act(() => vi.advanceTimersByTime(500));
  expect(of('skill_search_result')[0].properties).toMatchObject({ search_keyword: 'stagger', result_count: 1, outcome: 'success' });
  act(() => button('Staggered entrance').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'skill_card', element: 'open_detail', skill_id: 'anime-js', position: 1,
    search_id: of('skill_search_result')[0].properties.search_id });
  expect(of('surface_view')[0].properties).toMatchObject({ area: 'skill_detail', element: 'detail', skill_id: 'anime-js' });
  const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'PRIVATE_BRIEF launch'); textarea.dispatchEvent(new Event('input', { bubbles: true })); });
  act(() => button('9:16').click());
  vi.useRealTimers();
  await act(async () => button('Copy for Agent').click());
  const result = of('skill_instruction_copy_result')[0].properties;
  expect(result).toMatchObject({ skill_id: 'anime-js', copy_surface: 'instruction', copy_status: 'clipboard_written', aspect_ratio: '9:16', duration_seconds: 10,
    has_subject: true, has_style: false, media_required: false, detail_view_id: of('surface_view')[0].properties.detail_view_id });
  expect(of('ui_click').find(row => row.properties.element === 'copy_instruction')?.properties.copy_attempt_id).toBe(result.copy_attempt_id);
  expectAdmitted();
});

it('keeps search, category and card reports on the same filtered list', () => {
  vi.useFakeTimers();
  act(() => root.render(<SkillsHost />));
  const input = container.querySelector<HTMLInputElement>('input[type="search"]')!;
  const type = (value: string) => act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
  type('zzzz-no-match');
  act(() => button('Explainers').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ element: 'category_select', result_count: 0 });
  act(() => button('All').click());
  type('stagger');
  act(() => vi.advanceTimersByTime(200));
  act(() => button('Explainers').click());
  act(() => vi.advanceTimersByTime(500));
  expect(of('skill_search_result').map(row => [row.properties.search_keyword, row.properties.result_count, row.properties.skill_category]))
    .toEqual([['stagger', 0, 'explainers']]);
  act(() => button('All').click());
  act(() => vi.advanceTimersByTime(500));
  type('particle');
  act(() => button('Particle effects').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ element: 'open_detail', skill_id: 'proton' });
  expect(of('ui_click').at(-1)?.properties.search_id).toBeUndefined();
  expectAdmitted();
});

it('reports a failed Skill copy as a manual fallback, not a success', async () => {
  copy.mockRejectedValueOnce(new Error('denied'));
  act(() => root.render(<SkillsHost />));
  act(() => button('Particle effects').click());
  await act(async () => button('Copy for Agent').click());
  expect(of('skill_instruction_copy_result').map(row => row.properties.copy_status)).toEqual(['manual_fallback_shown']);
  expectAdmitted();
});

function BrandHost({ selected }: { selected: string | null }) {
  const [id, setId] = useState(selected);
  return <I18nProvider initialLocale="en"><BrandKitPage selectedId={id} onSelect={setId} /></I18nProvider>;
}

it('reports the Brand Kit view, detail, copy and download for a private kit as「mine」without its name or website', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).endsWith('package.zip') ? new Response(new Blob(['zip'])) : Response.json({ kits: [kit] })));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} }));
  await act(async () => root.render(<BrandHost selected={kit.id} />));
  expect(of('page_view')[0].properties).toMatchObject({ page_name: 'brand_kit' });
  expect(of('surface_view')[0].properties).toMatchObject({ area: 'brand_detail', element: 'detail', brand_source: 'mine', brand_state: 'ready' });
  await act(async () => button('Copy for Agent').click());
  expect(of('brand_kit_instruction_copy_result')[0].properties).toMatchObject({ brand_source: 'mine', copy_status: 'clipboard_written' });
  await act(async () => button('Download package').click());
  expect(of('resource_download_result')[0].properties).toMatchObject({ resource_kind: 'brand_kit_package', delivery_status: 'browser_save_requested', brand_source: 'mine' });
  expect(of('ui_click').map(row => row.properties.element)).toEqual(['copy_instruction', 'download_package']);
  expectAdmitted();
});

it('reports a started extraction and an official import by catalogue id', () => {
  tracking.reportBrandKitCreateResult('success', tracking.newTrackingId());
  tracking.reportBrandKitImportResult('azure', 'success', false, 3);
  tracking.reportBrandKitImportResult('Not a slug/../', 'success', false, 1);
  tracking.reportBrandActionResult({ catalogId: 'azure' }, 'delete', 'failure', undefined);
  tracking.reportBrandCardOpened({ catalogId: undefined }, 2);
  expect(sent.map(row => row.event)).toEqual(['brand_kit_create_result', 'brand_kit_import_result', 'brand_kit_action_result', 'ui_click']);
  expect(of('brand_kit_import_result')[0].properties).toMatchObject({ catalog_id: 'azure', position: 3, already_in_library: false });
  expectAdmitted();
});

const { McpConnectionPage } = await import('./McpConnectionPage');
const mcpInfo = { name: 'OpenMotion', version: '1.2.3', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/PRIVATE_DATA_DIR', templateSource: 'repository',
  transport: { type: 'stdio', command: 'node', args: ['/PRIVATE_DATA_DIR/mcp.ts'], cwd: '/PRIVATE_DATA_DIR', env: { MOTION_DATA_DIR: '/PRIVATE_DATA_DIR' } }, tools: [{ name: 'openmotion_media_use', description: 'Media Use' }] };
const mcpTemplate = { id: 'fixture-film', title: 'Fixture film', description: 'Editable typography', subtitle: 'Launch', posterUrl: '/poster.png' };
const roleTab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')].find(node => node.textContent?.trim().endsWith(name))!;

it('reports the MCP page entry, client and setup choices, and each copy result without the copied text', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url).includes('template-catalog') ? { items: [mcpTemplate] } : mcpInfo)));
  const openLibrary = vi.fn(), openProviders = vi.fn();
  await act(async () => root.render(<I18nProvider initialLocale="en"><McpConnectionPage entry="home_composer" hasProject openLibrary={openLibrary} openProviders={openProviders} /></I18nProvider>));
  expect(of('page_view')[0].properties).toMatchObject({ page_name: 'mcp', entry_from: 'home_composer', mcp_client: 'codex', has_project: true, embedded: false });
  await act(async () => roleTab('Claude Code').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'mcp_client', element: 'client_tab', mcp_client: 'claude' });
  await act(async () => button('Copy connection instruction').click());
  expect(of('mcp_copy_result').at(-1)?.properties).toMatchObject({ copy_kind: 'connection_instruction', copy_status: 'clipboard_written', setup_method: 'agent' });
  await act(async () => roleTab('Manual setup').click());
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'mcp_setup', element: 'setup_method', setup_method: 'manual' });
  copy.mockRejectedValueOnce(new Error('denied'));
  await act(async () => button('Copy configuration').click());
  expect(of('mcp_copy_result').at(-1)?.properties).toMatchObject({ copy_kind: 'manual_config', copy_status: 'failed' });
  await act(async () => tracking.reportMcpClick('mcp_templates', 'category_select', { mcp_client: 'claude', option: 'Product launch films' }));
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'mcp_templates', element: 'category_select', filter_value: 'product-launch-films' });
  await act(async () => button('Explore templates').click());
  expect(openLibrary).toHaveBeenCalled();
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'mcp_start', element: 'open_library' });
  await act(async () => button('Manage providers').click());
  expect(openProviders).toHaveBeenCalled();
  expect(of('ui_click').at(-1)?.properties).toMatchObject({ area: 'mcp_resources', element: 'manage_providers' });
  expectAdmitted();
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE_DATA_DIR|mcp\.ts/);
});

it('reports the assets, settings and project manager events within the admitted schema and without names, keys or paths', async () => {
  tracking.reportAssetsPageView(true);
  tracking.reportAssetsClick('assets_library', 'kind_filter', { asset_kind: 'video' });
  tracking.reportAssetsClick('assets_library', 'open_asset', { modality: 'PRIVATE_KIND' });
  tracking.reportAssetsClick('asset_create', 'mode_switch', { task_mode: 'agent' });
  tracking.reportAssetGenerationSubmit('image', 'success', 2, true);
  tracking.reportAssetGenerationSubmit('not-a-modality', 'failure', 0, false);
  tracking.reportAssetUpdate({ name: 'PRIVATE_ASSET_NAME' }, 'success', 'audio');
  tracking.reportAssetUpdate({ trashed: true }, 'failure', 'video');
  tracking.reportLibraryImport('library_drop', 3, 2);
  tracking.reportSettingsPageView('providers', false);
  tracking.reportSettingsClick('settings_nav', 'section_select', { settings_section: 'privacy' });
  tracking.reportSettingsClick('provider_list', 'select_provider', { provider: { id: 'fal', protocol: 'media' } });
  tracking.reportProviderSetting({ id: 'custom-PRIVATE', custom: true }, 'save_provider', 'success');
  tracking.reportProviderSetting({ id: 'openai', protocol: 'openai' }, tracking.providerAction('Default model updated')!, 'failure');
  tracking.reportAgentSetting('codex', 'set_default_agent', 'success');
  tracking.reportDiagnosticExport('rate_limited', 812.6);
  tracking.reportProjectsPageView(true);
  tracking.reportProjectsClick('export_projects', { selection_count: 2 });
  tracking.reportProjectManage('trash', 'partial', 3, 1);
  expect(sent.map(row => row.event)).toEqual(['page_view', 'ui_click', 'ui_click', 'ui_click', 'asset_generation_submit_result', 'asset_update_result', 'asset_update_result',
    'studio_asset_import_result', 'page_view', 'ui_click', 'ui_click', 'provider_setting_result', 'provider_setting_result', 'agent_setting_result', 'diagnostic_export_result',
    'page_view', 'ui_click', 'project_manage_result']);
  expect(of('asset_update_result').map(row => row.properties.action)).toEqual(['rename', 'trash']);
  expect(of('studio_asset_import_result')[0].properties).toMatchObject({ entry_point: 'library_drop', outcome: 'partial', failed_count: 1 });
  expect(of('provider_setting_result')[0].properties).toEqual({ page_name: 'settings', provider_kind: 'custom', action: 'save_provider', outcome: 'success' });
  expect(of('provider_setting_result')[1].properties).toMatchObject({ provider_id: 'openai', action: 'set_default_model' });
  expect(of('ui_click')[1].properties.modality).toBeUndefined();
  expect(tracking.providerAction('Something else')).toBeUndefined();
  expectAdmitted();
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE/);
});

it('reports version history results through the editor channel only when the host installed it', async () => {
  const editor = await import('./editorTracking');
  const received: { event: string; properties: Record<string, unknown> }[] = [];
  editor.trackVersionHistoryResult('restore', 'success', '11111111-1111-4111-8111-111111111111');
  expect(received).toHaveLength(0);
  editor.installEditorTracking(((event: string, properties: Record<string, unknown>) => { received.push({ event, properties }); }) as never);
  editor.trackVersionHistoryResult('pin', 'failure', 'project');
  editor.trackStudioClick('version_history', 'history_filter', 'project', undefined, 'pinned');
  editor.installEditorTracking(undefined);
  expect(received.map(row => [row.event, row.properties.action ?? row.properties.element])).toEqual([['version_history_result', 'pin'], ['ui_click', 'history_filter']]);
  for (const row of received) expect(validProperties(studioEvents, row.event, row.properties), JSON.stringify(row)).toBe(true);
});

it('propagates validated entry_from onto settings page views and account clicks while dropping unknown values', () => {
  vi.stubGlobal('location', new URL('http://localhost/settings/providers?entry_from=agent_media_upgrade_free&embed=1'));
  tracking.reportSettingsPageView('providers', false);
  tracking.reportSettingsClick('account', 'sign_in');
  tracking.reportSettingsClick('account', 'manage_subscription');
  vi.stubGlobal('location', new URL('http://localhost/settings/providers?entry_from=PRIVATE_TEXT'));
  tracking.reportSettingsPageView('providers', false);
  tracking.reportSettingsClick('account', 'sign_in');
  expect(of('page_view')[0].properties.entry_from).toBe('agent_media_upgrade_free');
  expect(of('ui_click').slice(0, 2).map(row => row.properties.entry_from)).toEqual(['agent_media_upgrade_free', 'agent_media_upgrade_free']);
  expect(of('page_view')[1].properties.entry_from).toBeUndefined();
  expect(of('ui_click')[2].properties.entry_from).toBeUndefined();
  expectAdmitted();
  expect(JSON.stringify(sent)).not.toMatch(/PRIVATE_TEXT/);
});
