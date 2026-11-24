import { trackMotion } from '../studio/src/motion/tracking.ts';
import { beginStudioIo } from '../studio/src/telemetry/ioRecovery.ts';

// Compile-only calls: this function must never execute or emit events.
function studioContract() {
  const finishIo = beginStudioIo('import_files', { requested_count: 2 });
  finishIo({ outcome: 'partial', added_count: 1, failed_count: 1, listing_status: 'failed' });
  void trackMotion('studio_io_action', { action: 'recheck_render', attempt_id: '' });
  void trackMotion('studio_io_result', { action: 'download_render', attempt_id: '', outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
  // @ts-expect-error Each result needs an explicit observed outcome.
  finishIo({ added_count: 2 });
  // @ts-expect-error Automatic reads are not manual I/O actions.
  beginStudioIo('automatic_refresh');
  // @ts-expect-error Private file data is not part of the helper contract.
  beginStudioIo('import_files', { file_name: 'PRIVATE_FILE' });
  // @ts-expect-error Download handoff cannot claim an observed file save.
  finishIo({ outcome: 'success', delivery_status: 'saved' });
  // @ts-expect-error Each result retains its attempt correlation.
  void trackMotion('studio_io_result', { action: 'recheck_file', outcome: 'unknown' });
  void trackMotion('webmcp_tool_finished', { tool_name: 'openmotion_assets_use', transport: 'webmcp', call_id: '', action: 'read', outcome: 'success', duration_ms: 10 });
  // @ts-expect-error Tool actions are closed categories, never arbitrary input.
  void trackMotion('webmcp_tool_started', { tool_name: 'openmotion_assets_use', transport: 'webmcp', call_id: '', action: 'PRIVATE_ACTION' });
  void trackMotion('ui_click', { page_name: 'home', area: 'workspace', element: 'new_creation' });
  void trackMotion('playback', { action: 'speed_change', rate: 1.25 });
  void trackMotion('audio_fx_param_committed', { effect: 'compressor', param: 'threshold', value: -18.5, surface: 'details' });
  // @ts-expect-error Migrated event actions remain closed.
  void trackMotion('playback', { action: 'PRIVATE_ACTION' });
  // @ts-expect-error Measurements are numbers, not arbitrary strings.
  void trackMotion('audio_fx_param_committed', { effect: 'compressor', param: 'threshold', value: 'PRIVATE', surface: 'details' });
  // @ts-expect-error Node-only events are not part of the Studio API.
  void trackMotion('mcp_tool_started', { tool_name: 'motion_get_project', call_id: '', accepted: true });
  // @ts-expect-error Required semantic fields remain required.
  void trackMotion('ui_click', { page_name: 'home' });
  // @ts-expect-error Enums remain closed.
  void trackMotion('ui_click', { page_name: 'private', area: 'workspace', element: 'new_creation' });
  void trackMotion('ui_click', { page_name: 'studio', area: 'project_drawer', element: 'language_change', option: 'zh-CN' });
  void trackMotion('studio_edit_result', { outcome: 'success', edit_kind: 'font_size', surface: 'properties', project_scope: 'default' });
  void trackMotion('studio_export_request_result', { export_id: '', outcome: 'rejected', origin: 'header', format: 'mp4',
    quality: 'standard', resolution: 'auto', fps: '30', error_code: 'FFMPEG_MISSING' });
  void trackMotion('studio_export_request_result', { export_id: '', outcome: 'unknown', origin: 'header', format: 'mp4', quality: 'standard', resolution: 'auto', fps: '30' });
  void trackMotion('studio_asset_import_result', { outcome: 'unknown', entry_point: 'assets_drop', requested_count: 2, added_count: 0, failed_count: 0, unknown_count: 1, pending_count: 1 });
  // @ts-expect-error The worker's export terminal event is not a Studio event.
  void trackMotion('export_result', { job_id: '', job_state: 'completed', duration_ms: 1, technical_check: 'unknown' });
  // @ts-expect-error Edit kinds remain a closed set; a history label is not one.
  void trackMotion('studio_edit_result', { outcome: 'success', edit_kind: 'Edit layer style', surface: 'properties' });
  // @ts-expect-error A project is reported by id and scope, never by name.
  void trackMotion('studio_edit_result', { outcome: 'success', edit_kind: 'move', surface: 'canvas', project_name: 'x' });
  // @ts-expect-error Export settings are bucketed; a raw frame rate number is not accepted.
  void trackMotion('studio_export_result', { export_id: '', job_state: 'completed', duration_ms: 1, origin: 'header', format: 'mp4', quality: 'high', resolution: 'auto', fps: 30 });
  void trackMotion('ui_click', { page_name: 'studio', area: 'templates', element: 'preview_template', template_id: 'hf-moment-M1147' });
  void trackMotion('studio_load_result', { load_id: '', outcome: 'success', duration_ms: 1, embedded: false, clip_count_bucket: 'unknown', composition_count_bucket: '2_5' });
  // @ts-expect-error Video length is a bucket; seconds are not accepted.
  void trackMotion('studio_export_result', { export_id: '', job_state: 'completed', duration_ms: 1, origin: 'header', format: 'mp4', quality: 'high', resolution: 'auto', fps: '30', video_duration_bucket: 42 });
  // @ts-expect-error Project size is a bucket; a raw count is not accepted.
  void trackMotion('studio_load_result', { load_id: '', outcome: 'success', duration_ms: 1, embedded: false, clip_count_bucket: 12 });
  void trackMotion('ui_click', { page_name: 'settings', area: 'account', element: 'manage_subscription', entry_from: 'agent_media_upgrade_free' });
  // @ts-expect-error Arbitrary entry strings are not admitted.
  void trackMotion('ui_click', { page_name: 'settings', area: 'account', element: 'manage_subscription', entry_from: 'PRIVATE_ENTRY' });
}
void studioContract;
