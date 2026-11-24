import { assetImportError, toolFailureFields } from '../tracking/tool-fields.ts';
export { trackingError } from '../tracking/tool-fields.ts';
import path from 'node:path';
import { readFileSync, watch } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { createTracker, uuid } from '../tracking/core.ts';
import type { Entry } from '../tracking/core.ts';
import { createNodeTracking, loadIdentity } from '../tracking/node.ts';
import { loadDeviceIdentity } from '../tracking/device.ts';
import { omEvents } from '../tracking/events.ts';
import { VERSION } from '../preview.ts';
import type { HostContext } from '../tracking/host.ts';

export type OmTracking = ReturnType<typeof createTracker<typeof omEvents>>;
export function trackingLockReason() {
  // Masvid Studio: telemetry is always off; nothing is reported to the upstream project.
  return 'environment' as const;
  return ['0', 'false', 'off'].includes(process.env.OPENMOTION_TELEMETRY?.toLowerCase() ?? '') || process.env.DO_NOT_TRACK === '1'
    ? 'environment' as const : null;
}
export function trackingLocked() { return trackingLockReason() !== null; }
export function trackingPreference(directory: string): boolean {
  try { return JSON.parse(readFileSync(path.join(directory, 'tracking/preferences.json'), 'utf8')).enabled === true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ENOENT'; }
}
export async function saveTrackingPreference(directory: string, enabled: boolean) {
  const folder = path.join(directory, 'tracking'); await mkdir(folder, { recursive: true, mode: 0o700 });
  const temporary = path.join(folder, 'preferences.' + crypto.randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify({ enabled }), { mode: 0o600, flag: 'wx' });
    await rename(temporary, path.join(folder, 'preferences.json'));
  } finally { await rm(temporary, { force: true }); }
}

export async function createAppTracking(directory: string, entrypoint: Entry): Promise<OmTracking> {
  const disabled = () => createTracker({ registry: omEvents, entrypoint, enabled: false, isEnabled: () => false, send: async () => 'drop' });
  if (trackingLocked()) return disabled();
  try {
    const testing = Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test';
    if (testing && !process.env.OPENMOTION_TRACKING_TEST_RUN_ID) return disabled();
    const env = process.env.OPENMOTION_TRACKING_ENV ?? (testing ? 'test' : 'production');
    if (!['development', 'test', 'production'].includes(env)) return disabled();
    const custom = process.env.OPENMOTION_POSTHOG_HOST !== undefined || process.env.OPENMOTION_POSTHOG_KEY !== undefined;
    // Public write-only configuration only; malformed/missing configuration disables telemetry, not the application.
    const config = custom ? { host: process.env.OPENMOTION_POSTHOG_HOST, token: process.env.OPENMOTION_POSTHOG_KEY,
      geoip: process.env.OPENMOTION_GEOIP === '1' } : JSON.parse(readFileSync(new URL('./tracking-config.json', import.meta.url), 'utf8'));
    if (!config.host || !config.token) return disabled();
    const tracking = createNodeTracking({ registry: omEvents, entrypoint, enabled: true,
      identity: await loadIdentity(path.join(directory, 'tracking')), appVersion: VERSION,
      source: () => {
        try { return JSON.parse(readFileSync(path.join(directory, 'tracking/identity.json'), 'utf8')).utm_source; }
        catch { return null; }
      }, device: loadDeviceIdentity,
      host: config.host, token: config.token, geoip: config.geoip,
      isEnabled: () => !trackingLocked() && trackingPreference(directory),
      env: env as 'development' | 'test' | 'production', testRunId: process.env.OPENMOTION_TRACKING_TEST_RUN_ID });
    const changes = watch(path.join(directory, 'tracking'), { persistent: false }, () => { tracking.enabled(); });
    changes.on('error', () => tracking.setEnabled(false));
    const close = tracking.close;
    tracking.close = () => { changes.close(); close(); };
    return tracking;
  } catch { return disabled(); }
}

export async function closeTracking(tracking?: OmTracking) {
  if (!tracking) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => { while (tracking.pending()) { if (await tracking.flush() !== 'accepted') break; } })(),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 2000); }),
    ]);
  } finally { if (timer) clearTimeout(timer); tracking.close(); }
}

/** Business results follow committed domain operations, separately from transport results. */
export function trackPhase1Result(tracking: OmTracking | undefined, name: string, args: any, result: any, error?: unknown, host?: HostContext) {
  if (!tracking || args?.action === 'record_review' || result?.replayed) return;
  const outcome = error ? 'failure' : result?.status === 'partial' ? 'partial' : result?.status === 'failed' ? 'failure' : 'success';
  const fields = { outcome, ...(uuid.test(result?.projectId) ? { project_id: result.projectId } : {}),
    ...(uuid.test(args?.requestId) ? { operation_id: args.requestId } : {}), ...(error ? toolFailureFields(error) : {}) } as const;
  if (name === 'motion_create_project') {
    const creation_route = (['natural_language', 'template', 'reference_video'] as const).find(route => route === args?.projectType);
    tracking.track('project_create_result', { ...fields, effect_status: error ? 'unknown' : 'applied',
      ...(creation_route ? { creation_route } : {}) }, undefined, undefined, host);
  }
  if (name === 'motion_open_preview' && args?.target !== 'templates' && args?.target !== 'providers') tracking.track('project_open_result', { ...fields, opened_by_host_status: 'unknown' }, undefined, undefined, host);
  if (name === 'motion_edit_project') tracking.track('project_edit_result', { ...fields,
    ...(!error && Array.isArray(result?.changedFiles) ? { changed_file_count: result.changedFiles.length } : {}) }, undefined, undefined, host);
  if (name === 'motion_restore_version') tracking.track('version_restore_result', fields, undefined, undefined, host);
  if (name === 'motion_import_assets' || name === 'motion_assets' && args?.action === 'import_to_project') {
    const requested = Array.isArray(args?.items) ? args.items.length : name === 'motion_assets' ? 1 : undefined;
    const items: { status: string; reused?: boolean; error_code?: string }[] | undefined = Array.isArray(result?.items) ? result.items : undefined;
    const completed = items?.filter(item => item.status === 'completed') ?? [];
    const failed = items?.filter(item => item.status === 'failed') ?? [];
    const reused = completed.filter(item => item.reused).length;
    tracking.track('asset_import_result', { ...fields, ...(requested !== undefined ? { requested_count: requested } : {}),
      ...(items ? { added_count: completed.length - reused, reused_count: reused, failed_count: failed.length } : {}),
      ...(failed.length ? { error_code: 'ASSET_IMPORT_FAILED' as const } : {}) }, undefined, undefined, host);
    const failures = new Map<ReturnType<typeof assetImportError>, number>();
    for (const item of failed) {
      const code = assetImportError({ code: item.error_code });
      failures.set(code, (failures.get(code) ?? 0) + 1);
    }
    const { project_id, operation_id } = fields;
    for (const [error_code, failed_count] of failures) {
      tracking.track('asset_import_item_failure', {
        ...(project_id ? { project_id } : {}), ...(operation_id ? { operation_id } : {}), error_code, failed_count,
      }, undefined, undefined, host);
    }
  }
  if (name === 'motion_export_request') tracking.track('export_request_result', { ...fields,
    ...(uuid.test(result?.job?.id) ? { job_id: result.job.id, queue_state: result.job.state } : {}) }, undefined, undefined, host);
  if (name === 'motion_export_cancel') tracking.track('export_cancel_result', { ...fields,
    ...(uuid.test(result?.job?.id) ? { job_id: result.job.id, state_after: result.job.state } : {}) }, undefined, undefined, host);
}
