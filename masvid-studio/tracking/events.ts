import { assetImportErrorCodes, exportFailureCodes, exportFailureStages, toolDimensions, toolFailureDimensions } from './tool-fields.ts';
import type { Entry, Registry } from './core.ts';
import { studioUsageEvents } from './studio-events.ts';
import { providerSetupEntries, type ProviderSetupEntry } from '../shared/workspace-url.ts';
export { providerSetupEntries, type ProviderSetupEntry };

export const toolNames = ['motion_assets', 'motion_media_use', 'motion_list_templates', 'motion_get_template', 'motion_list_skills', 'motion_get_skill', 'motion_create_project', 'motion_open_preview',
  'motion_import_assets', 'motion_get_project', 'motion_edit_project', 'motion_export_request', 'motion_list_versions',
  'motion_restore_version', 'motion_export_cancel', 'motion_project_archive', 'motion_manage_project',
  'motion_design_catalog', 'motion_design_project', 'motion_design_edit', 'motion_design_comments',
  'motion_game_create', 'motion_game_get', 'motion_game_read_file', 'motion_game_write_files', 'motion_game_update_meta', 'motion_game_capture_cover', 'motion_game_playtest', 'motion_game_simulate', 'motion_game_trailer', 'motion_game_validate', 'motion_game_set_status', 'motion_game_publish'] as const;
const outcome = ['success', 'failure', 'partial', 'cancelled', 'unknown'] as const;
export const mcpToolNames = [...toolNames, 'motion_show_video', 'motion_show_template_recommendations'] as const;
const tool = { tool_name: mcpToolNames, ...toolDimensions, call_id: 'uuid', operation_id: 'uuid', accepted: 'boolean' } as const;
export const webMcpToolNames = ['openmotion_assets_use', 'openmotion_assets', 'openmotion_media_use', 'openmotion_list_templates', 'openmotion_get_template', 'openmotion_list_skills', 'openmotion_get_skill',
  'openmotion_create_project', 'openmotion_open_preview', 'openmotion_import_assets', 'openmotion_get_project',
  'openmotion_edit_project', 'openmotion_export_request', 'openmotion_list_versions', 'openmotion_restore_version',
  'openmotion_export_cancel', 'openmotion_project_archive', 'openmotion_manage_project',
  'openmotion_design_catalog', 'openmotion_design_project', 'openmotion_design_edit', 'openmotion_design_comments',
  'openmotion_studio_look', 'openmotion_studio_select', 'openmotion_studio_seek',
  'openmotion_studio_frame', 'openmotion_studio_inspect'] as const;
const webMcp = { tool_name: webMcpToolNames, transport: ['webmcp'] } as const;
const generation = { modality: ['image', 'video', 'audio'] } as const;
// Studio project ids are UUIDs except the built-in local project, whose id is the literal `project`.
const project = { project_id: 'project_id', project_scope: ['default', 'managed', 'other'] } as const;
const exportSettings = { origin: ['header', 'export_panel', 'composition_card'], format: ['mp4', 'webm', 'mov', 'gif'],
  quality: ['draft', 'standard', 'high'], resolution: ['auto', '1080p', '4k'], fps: ['24', '30', '60', 'other'] } as const;
const countBucket = ['0', '1_5', '6_20', '21_50', 'gt_50', 'unknown'] as const;
const projectScale = { clip_count_bucket: countBucket, asset_count_bucket: countBucket,
  composition_count_bucket: ['1', '2_5', '6_20', 'gt_20', 'unknown'] } as const;
const videoDuration = { video_duration_bucket: ['lt_15s', '15_60s', '1_3min', '3_10min', 'gt_10min', 'unknown'] } as const;
const business = { outcome, project_id: 'uuid', operation_id: 'uuid', replayed: 'boolean', ...toolFailureDimensions } as const;
// A template is identified by its catalogue id only; titles, authors and URLs are never fields.
const template = { template_id: 'slug' } as const;
// Template library browsing. Names follow the shared OpenMotion tracking sheet so website and editor funnels line up.
const hosts = ['codex', 'claude', 'deepseek', 'chatgpt', 'mcp'] as const;
const sortOrder = ['recommended', 'name', 'reverse', 'duration'] as const;
// Where a card or detail came from: the gallery, the related strip, random discovery or previous/next in the detail.
const placement = ['popular', 'catalog', 'related', 'random', 'navigation', 'black_friday'] as const;
// Curated template brand series, distinct from the Brand Kit catalogue. No brand names, copy or URLs.
const templateSeries = { search_id: 'uuid', sort: sortOrder, applied_filter_count: 'integer', series_id: 'slug', series_list_id: 'uuid', series_view_id: 'uuid',
  series_placement: ['top100', 'discovery'], series_surface: ['timeline', 'template_detail'],
  series_position: 'integer', series_rank: 'integer', series_work_count: 'integer', series_work_position: 'integer',
  ranking_policy: ['works59-ctr41-v1', 'catalog-v1'], ranking_snapshot: ['ctr-20261118-v2'] } as const;
const templateDetail = { detail_view_id: 'uuid', detail_mode: ['modal'], resource_kind: ['reference', 'editable_project', 'motion_guide'],
  instruction_kind: ['template_use', 'reference_recreate', 'recreate_submit'] } as const;
const templateSearchContext = { library_view_id: 'uuid', discovery_id: 'uuid', result_set_id: 'uuid' } as const;
const templateList = { ...templateSearchContext, result_count: 'integer', search_id: 'uuid', sort: sortOrder, applied_filter_count: 'integer' } as const;
// Application pages that report their own views and clicks. The template library keeps page_name=studio.
const pages = ['home', 'studio', 'skills', 'brand_kit', 'mcp', 'assets', 'settings', 'projects', 'explore', 'creative_studio', 'api', 'model_overview', 'model_hub'] as const;
// Explore, the top navigation and the creative Studios. Destinations are catalogue ids only: Studio, scene, community, carousel slide or model.
// A model id that is not a bounded slug is left out. Prompts, example text and model labels never become fields.
// A catalogue model key `provider:modelId` is sent as model_provider + model_id; custom providers send neither.
const creative = { studio_id: 'slug', scene_id: 'slug', model_provider: 'slug', model_id: 'code', explore_community: 'slug', medium: ['all', 'image', 'video', 'audio'],
  nav_target: 'slug', slide_id: 'slug', collection_id: 'slug', in_overflow: 'boolean', landing: 'boolean' } as const;
// A model hub (page=model-hub) and one of its community videos, by catalogue id; whether the viewer is signed in to OpenDesign.
const modelHub = { hub_id: 'slug', hub_video_id: 'slug', signed_in: 'boolean' } as const;
// A site campaign shown in the application chrome. entry_id is the od_entry_id placed on the Pricing link of that click,
// so the click joins the Pricing visit and payment the website attributes to it.
const campaign = { campaign_id: ['black_friday_2026'], entry_id: 'uuid' } as const;
// Workspace assets: which shelf the library shows and what kind of media an action is about.
const assetKind = ['all', 'image', 'video', 'audio', 'trash'] as const;
const modality = ['image', 'video', 'audio'] as const;
// Settings sections as routed in the workspace; providers and Agents are named by their built-in ids only.
const settingsSection = ['account', 'subscription', 'providers', 'models', 'local', 'general', 'appearance', 'privacy', 'about', 'help', 'mcp', 'brand-kit'] as const;
const provider = { provider_id: 'slug', provider_kind: ['builtin', 'custom', 'account', 'agent'] } as const;
const workspacePages = { asset_kind: assetKind, modality, task_mode: ['direct', 'agent'], settings_section: settingsSection, ...provider, agent_id: 'slug',
  manager_tab: ['projects', 'trash'], selection_count: 'integer' } as const;
// MCP connection page: which Agent client tab is shown, how the user reached the page and how they set it up.
const mcpClient = ['codex', 'claude', 'cursor', 'deepseek', 'desktop', 'chatgpt', 'mcp'] as const;
const mcpEntry = ['app_header', 'app_rail', 'settings_general', 'settings_resources', 'home_composer', 'project_composer', 'project_agent', 'platform_export', 'asset_chat', 'direct_link'] as const;
const entryFrom = [...mcpEntry, ...providerSetupEntries] as const;
const referenceEntry = { reference_entry: ['library_home'] } as const;
const referenceSource = { source_kind: ['link', 'local', 'description'] } as const;
const mcp = { mcp_client: mcpClient, setup_method: ['agent', 'manual'], capability_id: 'slug' } as const;
// A Skill is identified by its catalogue id and group only; the brief text never leaves the browser.
const skill = { skill_id: 'slug', skill_category: ['talking_head', 'product_promos', 'explainers', 'product_ads', 'brand_covers', 'motion_techniques'] } as const;
const skillBrief = { duration_seconds: 'integer', aspect_ratio: ['16:9', '9:16', '1:1'], has_subject: 'boolean', has_style: 'boolean', media_required: 'boolean' } as const;
// A Brand Kit is identified only by its official catalogue id; a user's own kit, website, name and context never become fields.
const brand = { brand_source: ['official', 'mine'], catalog_id: 'slug' } as const;
const brandCollection = ['official', 'mine'] as const;
const brandState = ['queued', 'scanning', 'extracting', 'packaging', 'rendering', 'ready', 'failed', 'cancelled'] as const;
/** Stage names and error kinds of the OpenDesign account connector's `jsonl-v1` sign-in progress lines. */
export const accountStages = ['attempt_started', 'device_auth_create_result', 'activation_ready', 'browser_open_result', 'device_authorization_result', 'token_exchange_result', 'credential_persist_result'] as const;
export const accountErrorKinds = ['network_error', 'browser_open_error', 'oauth_timeout', 'oauth_denied', 'invalid_state', 'credential_persist_error', 'internal_error', 'unknown'] as const;
const task = { task_id: 'uuid', task_type: ['asset_import', 'edit', 'export'], project_id: 'code', run_id: 'uuid', operation_id: 'uuid' } as const;
const check = { check_id: 'uuid', check_type: ['technical_export', 'preview_observed', 'content_review', 'local_modification_preservation', 'preview_export_consistency', 'required_content'],
  project_id: 'code', version_id: 'code', subject_id: 'code', checklist_version: 'code', checker_type: ['automated', 'agent', 'user', 'host'] } as const;

export const omEvents = {
  installation_started: { producers: ['installer'], fields: { host_product: ['codex', 'claude', 'deepseek', 'workbuddy', 'other'] }, required: ['host_product'] },
  installation_result: { producers: ['installer'], fields: { outcome: ['success'], host_product: ['codex', 'claude', 'deepseek', 'workbuddy', 'other'] }, required: ['outcome', 'host_product'] },
  ...studioUsageEvents,
  webmcp_tool_started: { producers: ['studio'], fields: { ...webMcp, ...toolDimensions, call_id: 'uuid' },
    required: ['tool_name', 'transport', 'call_id'] },
  webmcp_tool_finished: { producers: ['studio'], fields: { ...webMcp, ...toolDimensions, call_id: 'uuid', outcome, duration_ms: 'integer', ...toolFailureDimensions },
    required: ['tool_name', 'transport', 'call_id', 'outcome', 'duration_ms'] },
  webmcp_registration_result: { producers: ['studio'], fields: { ...webMcp, outcome: ['success', 'failure', 'cancelled'], duration_ms: 'integer' },
    required: ['tool_name', 'transport', 'outcome', 'duration_ms'] },
  mcp_tool_started: { producers: ['mcp'], fields: tool, required: ['tool_name', 'call_id', 'accepted'] },
  mcp_tool_finished: { producers: ['mcp'], fields: { ...tool, outcome, duration_ms: 'integer', ...toolFailureDimensions, replayed: 'boolean' },
    required: ['tool_name', 'call_id', 'accepted', 'outcome', 'duration_ms'] },
  project_create_result: { producers: ['mcp'], fields: { ...business, creation_route: ['natural_language', 'template', 'reference_video', 'existing_project'], effect_status: ['applied', 'not_applied', 'unknown'] }, required: ['outcome'] },
  project_open_result: { producers: ['mcp'], fields: { ...business, opened_by_host_status: ['unknown', 'opened', 'not_opened'] }, required: ['outcome'] },
  project_edit_result: { producers: ['mcp'], fields: { ...business, changed_file_count: 'integer' }, required: ['outcome'] },
  version_restore_result: { producers: ['mcp'], fields: business, required: ['outcome'] },
  asset_import_result: { producers: ['mcp'], fields: { ...business, requested_count: 'integer', added_count: 'integer', reused_count: 'integer', failed_count: 'integer' }, required: ['outcome'] },
  asset_import_item_failure: { producers: ['mcp'], fields: { project_id: 'uuid', operation_id: 'uuid', failed_count: 'integer',
    error_code: [...toolFailureDimensions.error_code, ...assetImportErrorCodes] }, required: ['failed_count', 'error_code'] },
  export_request_result: { producers: ['mcp'], fields: { ...business, job_id: 'uuid', queue_state: ['pending', 'running', 'cancelling', 'cancelled', 'completed', 'failed'] }, required: ['outcome'] },
  export_cancel_result: { producers: ['mcp'], fields: { ...business, job_id: 'uuid', state_after: ['pending', 'running', 'cancelling', 'cancelled', 'completed', 'failed'] }, required: ['outcome'] },
  media_generation_requested: { producers: ['worker'], fields: generation, required: ['modality'] },
  media_generation_submitted: { producers: ['worker'], fields: { ...generation, job_id: 'uuid' }, required: ['modality', 'job_id'] },
  media_generation_result: { producers: ['worker'], fields: { ...generation, job_id: 'uuid',
    job_state: ['completed', 'failed', 'cancelled'], asset_count: 'integer' }, required: ['modality', 'job_id', 'job_state', 'asset_count'] },
  export_result: { producers: ['worker'], fields: { job_id: 'uuid', job_state: ['completed', 'failed', 'cancelled'], duration_ms: 'integer', technical_check: ['passed', 'failed', 'unknown'], failure_stage: exportFailureStages, error_code: exportFailureCodes }, required: ['job_id', 'job_state', 'duration_ms', 'technical_check'] },
  // One per finished OpenDesign sign-in attempt. `replaced` is an interrupted attempt the service refused; the same
  // sign-in continues with a new attempt. Times are milliseconds since the click. Stage values come from the connector
  // protocol; only confirmed account IDs are allowed, never links, authorization codes or credentials.
  account_sign_in_result: { producers: ['mcp'], fields: { attempt_id: 'uuid', outcome: ['success', 'failure', 'cancelled', 'replaced'],
    source_product: ['openmotion'], source_detail: ['openmotion_editor_login'], entry_id: 'uuid', entry_occurred_at: 'timestamp', amr_user_id: 'code',
    error_code: ['connector_unavailable', 'setup_failed', 'authorization_expired', 'credentials_rejected'],
    connector_problem: ['npm_missing', 'install_failed', 'start_failed'], connector_version: 'code', resumed: 'boolean',
    last_stage: accountStages, last_result: ['started', 'success', 'failed'], error_kind: accountErrorKinds, browser_opened: 'boolean',
    receipt: ['accepted', 'rejected'], exit_code: 'integer', duration_ms: 'integer', prepare_ms: 'integer', link_ms: 'integer', approved_ms: 'integer' },
    required: ['attempt_id', 'outcome', 'connector_version', 'resumed', 'duration_ms'] },
  work_generation_stage: { producers: ['mcp', 'worker'], fields: {
    work_id: 'uuid', project_id: 'code', stage: ['started', 'generated', 'edited', 'exported'],
    task_type: ['create', 'modify'], version_id: 'code', revision: 'code',
    export_route: ['mcp', 'studio'],
  }, required: ['work_id', 'project_id', 'stage', 'task_type'] },
  host_run_started: { producers: ['mcp'], fields: { run_id: 'uuid', entry_type: ['mcp'], task_type: ['create', 'modify'], delivery_mode: ['preview', 'technical_export'] }, required: ['run_id', 'entry_type', 'task_type'] },
  host_run_delivered: { producers: ['mcp', 'worker'], fields: { run_id: 'uuid', delivery_mode: ['preview', 'technical_export'], project_id: 'code', revision: 'code', delivery_evidence_ref: 'code' }, required: ['run_id', 'delivery_mode', 'project_id', 'revision'] },
  host_run_failed: { producers: ['mcp', 'worker'], fields: { run_id: 'uuid', task_type: ['create', 'modify'], error_code: 'code', stage: 'code' }, required: ['run_id', 'task_type', 'error_code'] },
  host_run_cancelled: { producers: ['mcp', 'worker'], fields: { run_id: 'uuid', task_type: ['create', 'modify'], reason_code: 'code' }, required: ['run_id', 'task_type', 'reason_code'] },
  host_state_changed: { producers: ['mcp', 'worker'], fields: { run_id: 'uuid', sequence: 'integer', state: ['active', 'waiting_tools', 'waiting_user', 'delivered', 'failed', 'cancelled', 'unknown'], phase: 'code', state_reason: 'code' }, required: ['run_id', 'sequence', 'state', 'phase'] },
  host_preview_observed: { producers: ['mcp'], fields: { run_id: 'uuid', project_id: 'code', revision: 'code', version_id: 'code', visibility: ['visible', 'queued', 'hidden', 'unavailable'], content_verified: 'boolean', observation_source: ['host_reported'] }, required: ['run_id', 'project_id', 'revision', 'version_id', 'visibility', 'content_verified', 'observation_source'] },
  task_accepted: { producers: ['mcp', 'worker'], fields: { ...task, accepted_at: 'timestamp', deadline_at: 'timestamp' }, required: ['task_id', 'task_type', 'accepted_at', 'deadline_at'] },
  task_terminal: { producers: ['mcp', 'worker'], fields: { ...task, outcome: ['success', 'failure', 'unknown', 'cancelled'], applied: ['true', 'false', 'unknown'], terminal_at: 'timestamp', error_code: 'code' }, required: ['task_id', 'task_type', 'outcome', 'applied', 'terminal_at'] },
  task_status_reconciled: { producers: ['mcp', 'worker'], fields: { ...task, previous_outcome: ['success', 'failure', 'unknown', 'cancelled'], new_outcome: ['success', 'failure', 'unknown', 'cancelled'], reason_code: 'code', reconciled_at: 'timestamp' }, required: ['task_id', 'task_type', 'previous_outcome', 'new_outcome', 'reason_code', 'reconciled_at'] },
  check_required: { producers: ['mcp', 'worker'], fields: { ...check, required: 'boolean' }, required: ['check_id', 'check_type', 'project_id', 'version_id', 'subject_id', 'checklist_version', 'checker_type', 'required'] },
  check_completed: { producers: ['mcp', 'worker'], fields: { ...check, result: ['pass', 'fail', 'unreviewed', 'error'], evidence_ref: 'code', duration_ms: 'integer' }, required: ['check_id', 'check_type', 'project_id', 'version_id', 'subject_id', 'checklist_version', 'checker_type', 'result'] },
  queue_snapshot: { producers: ['worker'], fields: { instance_id: 'uuid', task_type: ['asset_import', 'export', 'all'], queued_count: 'integer', running_count: 'integer', available_slots: 'integer', counts_complete: 'boolean' }, required: ['instance_id', 'task_type', 'queued_count', 'running_count', 'available_slots', 'counts_complete'] },
  worker_heartbeat: { producers: ['worker'], fields: { collector_id: 'uuid', instance_id: 'uuid', active: 'boolean', queue_count: 'integer' }, required: ['collector_id', 'instance_id', 'active', 'queue_count'] },
  incident_confirmed: { producers: ['mcp', 'worker'], fields: { incident_id: 'uuid', incident_type: ['false_success', 'duplicate_charge', 'content_loss', 'cross_project_write', 'wrong_version_delivery', 'other'], severity: ['sev1', 'sev2', 'sev3'], subject_id: 'code', evidence_ref: 'code' }, required: ['incident_id', 'incident_type', 'severity', 'subject_id'] },
  recovery_recorded: { producers: ['mcp', 'worker'], fields: { incident_id: 'uuid', test_case_id: 'code', fault_type: 'code', data_integrity: ['preserved', 'lost', 'unknown'], duplicate_charge_check: ['clear', 'found', 'unknown'], recovery_result: ['success', 'failure', 'unknown'] }, required: ['incident_id', 'test_case_id', 'fault_type', 'data_integrity', 'duplicate_charge_check', 'recovery_result'] },
  page_view: { producers: ['studio'], fields: { page_name: pages, view_id: 'uuid', embedded: 'boolean', has_project: 'boolean', brand_collection: brandCollection, entry_from: entryFrom, mcp_client: mcpClient, settings_section: settingsSection,
    studio_id: creative.studio_id, scene_id: creative.scene_id, model_provider: creative.model_provider, model_id: creative.model_id, explore_community: creative.explore_community, medium: creative.medium, landing: creative.landing, hub_id: modelHub.hub_id, signed_in: modelHub.signed_in }, required: ['page_name', 'view_id', 'embedded', 'has_project'] },
  provider_setup_opened: { producers: ['mcp'], fields: { entry_from: providerSetupEntries, presentation: ['foreground', 'background', 'now'], embedded: 'boolean' },
    required: ['entry_from', 'presentation', 'embedded'] },
  studio_load_result: { producers: ['studio'], fields: { load_id: 'uuid', outcome, duration_ms: 'integer', embedded: 'boolean', ...project, ...projectScale, ...template }, required: ['load_id', 'outcome', 'duration_ms', 'embedded'] },
  ui_click: { producers: ['studio'], fields: { page_name: pages,
    area: ['workspace', 'templates', 'template_card', 'template_detail', 'template_instruction', 'template_discovery', 'template_series_card', 'template_series_detail',
      'skill_intro', 'skill_discovery', 'skill_card', 'skill_detail', 'skill_command',
      'brand_collection', 'brand_library', 'brand_card', 'brand_detail',
      'header', 'project_drawer', 'left_panel', 'right_panel', 'clips', 'assets', 'catalog',
      'preview', 'properties', 'layers', 'timeline', 'export_panel', 'settings',
      'mcp_client', 'mcp_setup', 'mcp_start', 'mcp_templates', 'mcp_capabilities', 'mcp_resources', 'mcp_faq', 'mcp_footer',
      'assets_library', 'asset_detail', 'asset_create', 'asset_tasks',
      'settings_nav', 'provider_list', 'provider_detail', 'default_agent', 'local_agents', 'account', 'diagnostics', 'help_resources',
      'project_manager', 'version_history',
      'creative_nav', 'explore_tabs', 'explore_spotlight', 'explore_featured', 'explore_feed', 'explore_collection', 'capability_index', 'studio_bar', 'model_overview',
      'hub_header', 'hub_hero', 'hub_videos', 'hub_video_detail', 'hub_availability', 'campaign_banner'],
    element: ['new_creation', 'recent_session', 'open_project', 'select_template', 'copy_template',
      'select_work', 'select_chapter', 'browse_timeline', 'expand_learning', 'compare_brands',
      'open_detail', 'start_use', 'expand_instruction', 'open_collection', 'category_select', 'filter_open', 'filter_clear',
      'search_focus', 'clear_search', 'reference', 'describe', 'reference_source_select', 'choose_local_video', 'copy_brief', 'filter_option', 'sort_option', 'surprise_me', 'submit_video', 'detail_previous', 'detail_next',
      'download_guide', 'download_project', 'view_full_page', 'view_repository', 'view_source',
      'view_guide', 'back_to_template', 'handoff_help', 'copy_color', 'back_to_project', 'retry_template_project', 'check_template_project', 'open_prepared_project',
      'submit_skill', 'copy_instruction', 'open_command', 'copy_command', 'close_detail',
      'collection_tab', 'new_brand_kit', 'download_package',
      'export', 'template_library', 'open_project_drawer', 'new_project', 'switch_project', 'project_search', 'theme_toggle',
      'language_change', 'privacy_settings', 'usage_data_toggle',
      'tab_clips', 'tab_assets', 'tab_catalog', 'tab_properties', 'tab_layers', 'tab_export',
      'select_clip', 'asset_search', 'asset_filter', 'catalog_search', 'catalog_filter',
      'select_element', 'play', 'pause', 'seek', 'speed_change', 'loop_toggle', 'expand_preview', 'restore_preview', 'locate_layer',
      'tool_select', 'tool_split', 'copy', 'snap_toggle', 'zoom_in', 'zoom_out', 'zoom_fit', 'zoom_selection', 'ruler_seek', 'fx_badge',
      'start_export', 'cancel_render', 'download_render', 'delete_render', 'ffmpeg_recheck', 'copy_install_command',
      'ask_agent_element', 'ask_agent_clip', 'ask_agent_time_range', 'ask_agent_playhead', 'ask_agent_catalog_item',
      'preview_template', 'use_template', 'template_category', 'template_search',
      'client_tab', 'setup_method', 'connection_guide', 'download_config', 'use_local_agent', 'open_library', 'manage_providers',
      'view_documentation', 'community', 'report_issue', 'faq_open', 'tool_list_open', 'scroll_to_section',
      'kind_filter', 'trash_view', 'upload', 'open_asset', 'create_asset', 'mode_switch', 'add_reference', 'edit_version', 'use_as_reference',
      'download_asset', 'switch_version', 'select_task', 'cancel_task', 'retry_save', 'resume_task',
      'section_select', 'select_provider', 'add_provider', 'provider_filter', 'select_agent', 'rescan_agents', 'open_terminal',
      'sign_in', 'sign_out', 'cancel_sign_in', 'refresh_billing', 'manage_subscription', 'export_diagnostics', 'open_resource',
      'import_projects', 'export_projects', 'manager_tab', 'rename_project', 'duplicate_project', 'trash_project', 'restore_project',
      'delete_project', 'copy_path', 'reveal_project', 'open_history', 'history_filter', 'select_version', 'keep_current', 'pin_version', 'restore_version',
      'nav_explore', 'nav_media', 'nav_mcp', 'nav_api', 'nav_studio', 'nav_more', 'nav_menu', 'select_scene', 'select_model', 'select_skill', 'select_client', 'filter_scene_models',
      'community_tab', 'creators', 'media_filter', 'open_scene', 'open_skill', 'open_template', 'try_prompt', 'open_studio', 'slide_select', 'slide_toggle', 'slide_action',
      'load_more', 'view_all_templates', 'models_toggle', 'skill_category', 'open_brand_kit', 'open_assets', 'open_providers', 'open_mcp', 'open_skills',
      'back_to_explore', 'open_editor', 'scene_tab', 'open_in_studio', 'connect_key', 'manage_connection', 'view_plans',
      'claim_offer', 'close_banner', 'open_pricing'],
    // The chosen value of a control with a small fixed set of choices; never free text.
    option: ['on', 'off', 'light', 'dark', 'en', 'zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr',
      'all', 'images', 'video', 'audio', 'fonts',
      'captions', 'code-animation', 'vfx', 'transitions', 'effects', 'text-effects', 'social', 'data', 'scenes',
      '0.25', '0.5', '1', '1.5', '2', 'featured', 'ads', 'clone', 'motion', 'script', 'pinned', 'other'],
    interaction_method: ['pointer', 'keyboard'], ...project, ...template, ...templateSeries,
    chapter_index: 'integer', browse_method: ['arrow', 'drag'], direction: ['previous', 'next'],
    placement, position: 'integer', template_action: ['recreate', 'recreate_submit', 'open_edit'], target_agent: hosts,
    copy_attempt_id: 'uuid', download_attempt_id: 'uuid', source_template_id: 'slug', operation_id: 'uuid',
    filter_group: ['brand', 'uses', 'styles', 'industries', 'creationModels', 'colors', 'ratio', 'duration', 'editable'], filter_value: 'slug',
    selected: 'boolean', expanded: 'boolean', previous_sort: sortOrder, changed: 'boolean', ...templateDetail, ...templateList,
    ...skill, ...brand, brand_collection: brandCollection, ...mcp, entry_from: entryFrom, ...referenceEntry, ...referenceSource,
    doc_id: ['mcp_tools', 'skills', 'agent_adapters', 'docs_home', 'repository'], section_id: 'slug', faq_index: 'integer', ...workspacePages, ...creative, ...modelHub, ...campaign },
    required: ['page_name', 'area', 'element'] },
  // Studio UI exports run in the editor's own render pipeline, not the worker that owns export_result.
  studio_export_request_result: { producers: ['studio'], fields: { export_id: 'uuid', outcome: ['accepted', 'rejected', 'unknown'], ...exportSettings,
    error_code: ['FFMPEG_MISSING', 'SERVER_UNREACHABLE', 'SERVICE_UNAVAILABLE', 'REQUEST_REJECTED', 'SERVER_ERROR', 'INVALID_RESPONSE', 'RUNTIME_NOT_READY'], ...videoDuration, ...projectScale, ...project, ...template },
    required: ['export_id', 'outcome', 'origin', 'format', 'quality', 'resolution', 'fps'] },
  studio_export_result: { producers: ['studio'], fields: { export_id: 'uuid', job_state: ['completed', 'failed', 'cancelled'], duration_ms: 'integer',
    ...exportSettings, error_code: ['RENDER_FAILED', 'CONNECTION_LOST'], ...videoDuration, ...project, ...template },
    required: ['export_id', 'job_state', 'duration_ms', 'origin', 'format', 'quality', 'resolution', 'fps'] },
  studio_notice_shown: { producers: ['studio'], fields: { notice: ['ffmpeg_missing', 'external_file_conflict', 'project_unreachable'], ...project }, required: ['notice'] },
  // One per committed manual change; failures come from Studio's save-failure reporter.
  studio_edit_result: { producers: ['studio'], fields: { outcome: ['success', 'failure'],
    edit_kind: ['move', 'resize', 'rotate', 'crop', 'text', 'font_family', 'font_size', 'text_color', 'text_align', 'fill', 'opacity', 'style',
      'timing', 'layer_order', 'visibility', 'group', 'delete', 'duplicate', 'paste',
      'timeline_move', 'timeline_trim', 'timeline_split', 'add_asset', 'add_catalog_item', 'add_composition', 'keyframe', 'animation',
      'project_rename', 'asset_rename', 'asset_delete', 'other'],
    surface: ['header', 'canvas', 'properties', 'layers', 'timeline', 'assets', 'catalog', 'other'],
    error_code: ['CONFLICT', 'REQUEST_REJECTED', 'SERVER_ERROR', 'UNKNOWN'], ...project },
    required: ['outcome', 'edit_kind', 'surface'] },
  studio_history_step_result: { producers: ['studio'], fields: { action: ['undo', 'redo'], outcome: ['success', 'unavailable', 'failure'],
    interaction_method: ['pointer', 'keyboard'], ...project }, required: ['action', 'outcome'] },
  studio_asset_import_result: { producers: ['studio'], fields: { outcome: ['success', 'partial', 'failure', 'unknown'],
    entry_point: ['assets_button', 'assets_drop', 'timeline_button', 'timeline_drop', 'properties', 'library_button', 'library_drop', 'library_new_version', 'template_reference', 'other'],
    requested_count: 'integer', added_count: 'integer', failed_count: 'integer', unknown_count: 'integer', pending_count: 'integer',
    error_category: ['too_large', 'unsupported_format', 'unreadable', 'runtime_not_ready', 'other'], ...project, ...templateList, ...referenceEntry },
    required: ['outcome', 'entry_point', 'requested_count', 'added_count', 'failed_count'] },
  // A surface that became visible: the library, a template card, one template's detail, or the instruction to copy.
  // A card counts once it is at least half visible for a second, once per result set.
  surface_view: { producers: ['studio'], fields: { page_name: pages, area: ['template_library', 'template_card', 'template_detail', 'template_instruction', 'template_discovery', 'template_related', 'template_guide', 'skill_detail', 'brand_detail', 'template_series_card', 'template_series_detail', 'template_series_work', 'campaign_banner'],
    element: ['library', 'card', 'detail', 'instruction', 'search_recovery', 'reference', 'related', 'guide', 'banner'], ...campaign, placement, position: 'integer', source_template_id: 'slug', ...templateList, ...templateDetail, ...template, ...templateSeries,
    ...skill, ...brand, ...referenceEntry, brand_state: brandState, recovery_reason: ['no_results', 'unsuitable', 'catalog_empty'] },
    required: ['page_name', 'area', 'element'] },
  // One per settled query, never per keystroke. `search_keyword` is the only free-text field in this registry.
  template_search_result: { producers: ['studio'], fields: { page_name: ['home', 'studio'], area: ['template_discovery'],
    search_keyword: 'text', query_length: 'integer', outcome: ['success', 'failure'], ...templateList },
    required: ['search_id', 'query_length', 'result_count', 'outcome'] },
  template_search_handoff_result: { producers: ['studio'], fields: { page_name: ['studio'], area: ['template_discovery'],
    handoff_attempt_id: 'uuid', ...referenceSource, handoff_status: ['clipboard_written', 'manual_fallback', 'draft_added', 'failure'], ...templateList, ...referenceEntry },
    required: ['handoff_attempt_id', 'source_kind', 'handoff_status'] },
  template_filter_result: { producers: ['studio'], fields: { page_name: ['home', 'studio'], area: ['template_discovery'],
    action: ['category_select', 'filter_apply', 'filter_clear', 'sort_change'], outcome: ['success', 'failure'], ...templateList },
    required: ['action', 'result_count', 'outcome'] },
  // `browser_save_requested` means the save was handed to the browser; nothing confirms the file reached disk.
  resource_download_result: { producers: ['studio'], fields: { page_name: pages, resource_kind: ['motion_guide', 'brand_kit_package'], download_attempt_id: 'uuid',
    delivery_status: ['browser_save_requested', 'fetch_failed', 'unknown'], error_code: 'code', ...templateList, detail_view_id: 'uuid', detail_mode: ['modal'], ...template, ...brand, ...templateSeries },
    required: ['resource_kind', 'download_attempt_id', 'delivery_status'] },
  template_guide_interaction: { producers: ['studio'], fields: { page_name: ['studio'], template_id: 'code', view_id: 'uuid', project_id: 'uuid',
    action: ['shown', 'edit', 'chapter', 'reference', 'reset', 'copy', 'open_editor', 'download', 'document', 'source'],
    expanded: 'boolean', delivery_status: ['browser_save_requested', 'fetch_failed'],
    field: ['title', 'accent'], outcome: ['success', 'failure', 'manual_fallback'] }, required: ['page_name', 'template_id', 'view_id', 'action'] },
  template_instruction_copy_result: { producers: ['studio'], fields: { host_product: hosts, copy_status: ['clipboard_written', 'manual_fallback_shown', 'failed'],
    page_name: ['home', 'studio'], copy_attempt_id: 'uuid', ...templateList, ...templateDetail, ...project, ...template, ...templateSeries }, required: ['host_product', 'copy_status'] },
  // One observed Studio handoff operation result, not an Agent receipt or a completed film.
  template_project_result: { producers: ['studio'], fields: { page_name: ['studio'], ...template, ...project, ...templateDetail,
    operation_id: 'uuid', handoff_attempt_id: 'uuid', stage: ['create', 'reconcile', 'open'], outcome: ['success', 'failure', 'unknown', 'not_found'] },
    required: ['template_id', 'operation_id', 'handoff_attempt_id', 'stage', 'outcome'] },
  // Skills page. One search result per settled query; the brief itself is reduced to its choices and two yes/no flags.
  skill_search_result: { producers: ['studio'], fields: { page_name: ['skills'], area: ['skill_discovery'], search_id: 'uuid', search_keyword: 'text',
    query_length: 'integer', result_count: 'integer', outcome: ['success'], skill_category: skill.skill_category },
    required: ['search_id', 'query_length', 'result_count', 'outcome'] },
  // `instruction` is the full Agent instruction; `command` is the short command in the Connect Agent popover.
  skill_instruction_copy_result: { producers: ['studio'], fields: { page_name: ['skills'], ...skill, ...skillBrief, copy_surface: ['instruction', 'command'],
    copy_status: ['clipboard_written', 'manual_fallback_shown'], copy_attempt_id: 'uuid', detail_view_id: 'uuid' },
    required: ['skill_id', 'copy_surface', 'copy_status', 'copy_attempt_id'] },
  // MCP connection page. One result per copy attempt; `includes_setup` says whether the connection instruction was prepended.
  mcp_copy_result: { producers: ['studio'], fields: { page_name: ['mcp'], ...mcp, ...template, copy_kind: ['connection_instruction', 'manual_config', 'starter', 'capability_example', 'template'],
    copy_status: ['clipboard_written', 'failed'], includes_setup: 'boolean' }, required: ['copy_kind', 'copy_status', 'mcp_client'] },
  // Workspace assets. A submitted generation is accepted work, not a finished asset; the worker reports the media result.
  asset_generation_submit_result: { producers: ['studio'], fields: { page_name: ['assets', 'creative_studio'], modality, outcome: ['success', 'failure'],
    reference_count: 'integer', new_version: 'boolean', studio_id: creative.studio_id, scene_id: creative.scene_id, model_provider: creative.model_provider, model_id: creative.model_id }, required: ['modality', 'outcome', 'reference_count', 'new_version'] },
  asset_update_result: { producers: ['studio'], fields: { page_name: ['assets'], modality, action: ['rename', 'trash', 'restore', 'switch_version', 'other'],
    outcome: ['success', 'failure'] }, required: ['action', 'outcome'] },
  // Settings. One result per saved change; credentials, names, URLs and model ids never become fields.
  provider_setting_result: { producers: ['studio'], fields: { page_name: ['settings'], ...provider, action: ['save_provider', 'remove_key', 'toggle_provider',
    'sync_models', 'refresh_agent', 'delete_provider', 'add_provider', 'add_model', 'update_model', 'remove_model', 'set_default_model'],
    outcome: ['success', 'failure'] }, required: ['provider_kind', 'action', 'outcome'] },
  agent_setting_result: { producers: ['studio'], fields: { page_name: ['settings'], agent_id: 'slug', action: ['inspect', 'refresh_status', 'refresh_models',
    'add_model', 'set_default_agent', 'open_terminal'], outcome: ['success', 'failure'] }, required: ['action', 'outcome'] },
  diagnostic_export_result: { producers: ['studio'], fields: { page_name: ['settings'], outcome: ['success', 'rate_limited', 'failure'], duration_ms: 'integer' },
    required: ['outcome', 'duration_ms'] },
  // Project manager and version history. Project names and paths are never fields.
  project_manage_result: { producers: ['studio'], fields: { page_name: ['projects'], action: ['import', 'export', 'rename', 'duplicate', 'trash', 'restore',
    'delete', 'copy_path', 'reveal'], outcome: ['success', 'partial', 'failure'], project_count: 'integer', failed_count: 'integer' },
    required: ['action', 'outcome', 'project_count'] },
  version_history_result: { producers: ['studio'], fields: { page_name: ['studio'], action: ['keep_current', 'pin', 'unpin', 'restore'],
    outcome: ['success', 'failure'], ...project }, required: ['action', 'outcome'] },
  // Brand Kit page. `success` on create means the extraction was accepted and started, not that the kit is ready.
  brand_kit_create_result: { producers: ['studio'], fields: { page_name: ['brand_kit'], outcome: ['success', 'failure'], create_attempt_id: 'uuid' },
    required: ['outcome', 'create_attempt_id'] },
  brand_kit_import_result: { producers: ['studio'], fields: { page_name: ['brand_kit'], catalog_id: 'slug', outcome: ['success', 'failure'], already_in_library: 'boolean',
    position: 'integer' }, required: ['catalog_id', 'outcome', 'already_in_library'] },
  brand_kit_instruction_copy_result: { producers: ['studio'], fields: { page_name: ['brand_kit'], ...brand, copy_status: ['clipboard_written', 'failed'],
    copy_attempt_id: 'uuid', detail_view_id: 'uuid' }, required: ['brand_source', 'copy_status', 'copy_attempt_id'] },
  brand_kit_action_result: { producers: ['studio'], fields: { page_name: ['brand_kit'], ...brand,
    action: ['edit', 'context', 'rescan', 'retry', 'cancel', 'delete'], outcome: ['success', 'failure'], detail_view_id: 'uuid' },
    required: ['brand_source', 'action', 'outcome'] },
} as const satisfies Registry & Record<string, { producers: readonly Entry[] }>;

export type StudioEvent = { [E in keyof typeof omEvents]:
  'studio' extends typeof omEvents[E]['producers'][number] ? E : never
}[keyof typeof omEvents];
export const studioEvents = Object.fromEntries(Object.entries(omEvents)
  .filter(([, spec]) => (spec.producers as readonly Entry[]).includes('studio'))) as Pick<typeof omEvents, StudioEvent>;
