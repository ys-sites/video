import { gameHttp, attachGameRooms } from './game-projects.ts';
import type { ExportFailure } from './tracking/tool-fields.ts';
import { toolFailureFields } from './tracking/tool-fields.ts';
import { transcriptsFor, closeTranscripts } from './gateway/transcription.ts';
import { projectArchiveHttp } from './gateway/project-archive-http.ts';
import { modelMetadata } from './gateway/model-metadata.ts';
import { assetConversations } from './gateway/asset-chat.ts';
import { claudeChatHttp } from './gateway/claude-chat.ts';
import { assetHttp } from './gateway/asset-http.ts';
import { getWorkflow } from './shared/workflow.ts';
import { attachmentDisposition } from './shared/http-header.ts';
import { isMain } from './shared/entry.ts';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WorkspaceStore, Conflict, createBlankProject, validateProjectTitle, interruptedExport, trackExportResult } from './workspace.ts';
import type { ExportJob } from './workspace.ts';
import { cliPath, ensureRuntime, execute, HYPERFRAMES_VERSION, inspectProject, pluginRoot, runHyperframes, startStudio, stopCommands } from './hyperframes.ts';
import type { Studio } from './hyperframes.ts';
import { VERSION } from './preview.ts';
import { templates } from './template-library.ts';
import { templateRecipe } from './template-catalog.ts';
import { templateCatalogFor } from './prism-templates.ts';
import { upgradeTemplateGuidePage, compactNativeGuideStage, authoredTemplateGuide } from './shared/template-guide.ts';
import { isEditableTemplate } from './shared/catalog.ts';
import { proxyStudio, renderDownloadDisposition, serveEditorFile } from './editor-server.ts';
import { publicTools as mcpTools } from './mcp.ts';
import { startOwnedStudio } from './shared/owned-studio.mjs';
import { sharedEditorEnabled, ensureEditor, editorRequest } from './editor-runtime.ts';
import { agentGuide, containerIntegration, integrationConfig, integrationHost, type IntegrationInfo } from './shared/integration.ts';
import { validateInstruction } from './shared/conversation.ts';
import { creationMode, creationModes, artifactViewers, availableSession, type CreativeSession, type CreationMode } from './shared/session.ts';
import { gatewayFor } from './gateway/service.ts';
import { providerDirectory, setDefaultModel, syncProvider } from './gateway/settings.ts';
import { isMediaProvider, registeredProvider } from './shared/provider-registry.ts';
import { localAgentsFor } from './gateway/local-agents.ts';
import { WorkspaceBrowser } from './browser.ts';
import { Phase1Service } from './phase1.ts';
import { phase1McpCapabilities } from './shared/phase1-tools.ts';
import { recoverProjectTransactions } from './phase1-versions.ts';
import { verifyExport } from './scripts/verify-export.ts';
import { createAppTracking, closeTracking, saveTrackingPreference, trackingPreference, trackingLockReason, type OmTracking } from './shared/tracking.ts';
import { studioEvents } from './tracking/events.ts';
import { configureNativeEnvironment, nativeRuntimeStatus, startNativePreparation, requireNativeRuntime } from './scripts/npm-runtime.mjs';
import { nativeRouteCapability } from './shared/native-runtime.ts';
import { validPending, uuid } from './tracking/core.ts';
import { validHostContext, unknownHost, previewTrackingContext } from './tracking/host.ts';
import type { HostContext } from './tracking/host.ts';
import { collectDiagnostics, diagnosticLimits, recordDiagnostic } from './scripts/diagnostics.mjs';
import { editorProjectIdFromPath, isSpaRoutePath, isStandaloneSpaPath } from './shared/spa-routes.ts';
import { TaskLedger } from './tracking/task-ledger.ts';
import { WorkRounds, workRoundMode } from './inline-video.ts';
import { brandKitHttp } from './gateway/brand-http.ts';
import { brandKitsFor } from './gateway/brand-kits.ts';
import { AssetLibrary } from './gateway/asset-library.ts';
import { scenarioHttp } from './gateway/scenario-http.ts';
import { designHttp } from './design-projects.ts';

const sharedStore = new WorkspaceStore();
export type Service = { trackingHosts?: Map<string, { host: HostContext; createdAt: number }>; diagnostics?: { running: boolean; lastExport: number; events: number; window: number }; studio?: Studio; runtimeRoot?: string; nativeRoot?: string; ffmpeg?: boolean; switching?: boolean; studioPort?: number; browser?: WorkspaceBrowser; editorToken?: string; ensureStudio?: (projectId?: string) => Promise<Studio>; launchStudio?: (directory: string, port: number) => Promise<Studio>; phase1?: Phase1Service; phase1Mutation?: Promise<void>; tracking?: OmTracking };
const service: Service = {};
const working = new Set<string>();
const runningExports = new Map<string, AbortController>();
const workerInstanceId = crypto.randomUUID();
const collectorId = crypto.randomUUID();
let lastQueueTelemetry = 0;

async function emitQueueTelemetry(store: WorkspaceStore, tracking?: OmTracking) {
  if (!tracking) return;
  if (Date.now() - lastQueueTelemetry < 60_000) return;
  lastQueueTelemetry = Date.now();
  const job = await store.job().catch(() => null);
  const queued = job?.state === 'pending' ? 1 : 0, running = job && ['running', 'cancelling'].includes(job.state) ? 1 : 0;
  tracking.track('queue_snapshot', { instance_id: workerInstanceId, task_type: 'export', queued_count: queued, running_count: running, available_slots: running ? 0 : 1, counts_complete: true }, undefined, 'worker');
  tracking.track('worker_heartbeat', { collector_id: collectorId, instance_id: workerInstanceId, active: true, queue_count: queued + running }, undefined, 'worker');
}

export async function cancelExport(store: WorkspaceStore, projectId: string, jobId: string, tracking = store.tracking) {
  return store.lock(async () => {
    const job = await store.job(jobId);
    if (!job || job.projectId !== projectId) throw new Error('EXPORT_NOT_FOUND: 任务不属于该项目');
    if (job.state === 'pending') {
      job.state = 'cancelled'; job.stage = 'cancelled'; job.terminalAt = Date.now(); job.observedOutcome = 'cancelled';
      await store.saveJob(job);
      trackExportResult(tracking, job);
      await trackExportTerminal(store, job, tracking);
    } else if (job.state === 'running') {
      job.state = 'cancelling';
      await store.saveJob(job);
    }
    if (job.state === 'cancelled') await rm(store.snapshotDirectory(job.id), { recursive: true, force: true });
    if (job.state === 'cancelling') runningExports.get(job.id)?.abort();
    const { token, workerPid, trackingHost, ...safe } = job; return safe;
  });
}

/** A cancellation or unfinished job is not a technical-check error; only a completed job without a report is. */
export function technicalCheckResult(job: Pick<ExportJob, 'state' | 'verification'>) {
  const status = (job.verification as { status?: string } | undefined)?.status;
  return status === 'passed' ? 'pass' as const : status === 'failed' ? 'fail' as const : job.state === 'completed' ? 'error' as const : 'unreviewed' as const;
}

// The reconciling owner states the terminal evidence of an export no worker claimed or finished.
async function trackInterruptedExport(store: WorkspaceStore, seen: ExportJob, tracking?: OmTracking) {
  const { job, reconciled } = await store.reconcileInterruptedExport(seen, tracking);
  if (!reconciled || !job) return;
  // Nothing else may keep rendering a job this tick just closed.
  runningExports.get(job.id)?.abort();
}

// The worker that claimed a job states its terminal result once; a reconciled job was already closed by its tick.
export async function trackExportTerminal(store: WorkspaceStore, final: ExportJob, tracking?: OmTracking) {
  if (final.observedOutcome === 'unknown') return;
  const outcome = final.state === 'completed' ? 'success' : final.state === 'cancelled' ? 'cancelled' : 'failure';
  const applied = outcome === 'success' ? 'true' : 'unknown';
  const errorCode = outcome === 'failure' ? final.failureCode ?? 'EXPORT_FAILED' : undefined;
  await new TaskLedger(store.directory).terminal(final.id, outcome, applied, errorCode).catch(() => {});
  const host = validHostContext(final.trackingHost) ? final.trackingHost : undefined;
  tracking?.track('task_terminal', { task_id: final.id, task_type: 'export', ...(final.projectId ? { project_id: final.projectId } : {}),
    ...(final.workId ? { run_id: final.workId } : {}), outcome, applied,
    terminal_at: new Date(final.terminalAt ?? Date.now()).toISOString(), ...(errorCode ? { error_code: errorCode } : {}) }, undefined, 'worker', host);
  if (tracking && outcome === 'cancelled' && final.workId && final.projectId) {
    const taskType = await workRoundMode(store, final.projectId, final.workId) ?? 'modify';
    tracking.track('host_run_cancelled', { run_id: final.workId, task_type: taskType, reason_code: 'EXPORT_CANCELLED' }, undefined, 'worker', host);
  }
}

export async function renderNext(store: WorkspaceStore, runtimeRoot: string, tracking?: OmTracking) {
  await emitQueueTelemetry(store, tracking);
  const pending = await store.job();
  const key = store.directory;
  // The tick that renders a job also owns its record, so no tick reconciles work still running in this process.
  if (working.has(key)) return;
  working.add(key);
  let job;
  let control: AbortController | undefined;
  let failure: ExportFailure = { failureStage: 'lint', failureCode: 'EXPORT_LINT_FAILED' };
  try {
    // A queued job whose deadline passed, or a claimed job whose worker vanished, is closed before claiming.
    if (pending && interruptedExport(pending)) await trackInterruptedExport(store, pending, tracking);
    else if (pending?.state === 'pending' && pending.projectId) {
      // Cancel queued exports whose project was trashed or deleted so they cannot block other active projects.
      const project = store.projectCatalog().projects.find(item => item.id === pending.projectId);
      if (!project || project.trashedAt) {
        await cancelExport(store, pending.projectId, pending.id, tracking);
        return;
      }
    }
    job = await store.claimExport();
    if (!job) return;
    control = new AbortController(); runningExports.set(job.id, control);
    const stage = async (value: string, verification?: unknown) => store.lock(async () => {
      const current = await store.job(job!.id);
      if (!current || current.state !== 'running') throw new Error('COMMAND_CANCELLED');
      current.stage = value; if (verification) current.verification = verification;
      await store.saveJob(current);
    });
    const directory = store.snapshotDirectory(job.id);
    await stage('checking');
    const lint = await inspectProject(runtimeRoot, directory, 'lint', control.signal);
    if (lint.exitCode) throw new Error('Hyperframes lint 失败：' + JSON.stringify(lint.result));
    failure = { failureStage: 'output', failureCode: 'EXPORT_OUTPUT_INVALID' };
    const output = store.exportPath(job);
    await mkdir(path.dirname(output), { recursive: true });
    // The service owns this job; a short-lived Agent client must not cancel it.
    failure = { failureStage: 'render', failureCode: 'EXPORT_RENDER_FAILED' };
    await stage('rendering');
    // Let the engine read the snapshot's exact data-fps (including rational rates).
    const result = await runHyperframes(runtimeRoot, directory, ['render', '.', ...(job.compositionPath ? ['--composition', job.compositionPath] : []), '--output', output, '--format', 'mp4', '--json'], 25 * 60_000, { HYPERFRAMES_RENDER_DETACHED: '1' }, control.signal);
    await writeFile(path.join(store.directory, 'jobs', job.id, 'render.log'), result.stdout + '\n' + result.stderr, { mode: 0o600 });
    if (result.code) throw new Error('Hyperframes render 失败：' + (result.stderr || result.stdout).slice(-1800));
    // Never label an absent or non-MP4 output as completed, even after exit code 0.
    failure = { failureStage: 'output', failureCode: 'EXPORT_OUTPUT_INVALID' };
    const file = await (await import('node:fs/promises')).open(output, 'r');
    try {
      const header = Buffer.alloc(12); await file.read(header, 0, 12, 0);
      if (header.subarray(4, 8).toString() !== 'ftyp') throw new Error('Hyperframes 未生成有效的 MP4');
    } finally { await file.close(); }
    if (job.phase1) {
      failure = { failureStage: 'verification', failureCode: 'EXPORT_VERIFICATION_FAILED' };
      await stage('verifying');
      const report = await verifyExport(output, job.expected!, undefined, control.signal);
      await stage('verified', report);
      if (report.status !== 'passed') {
        if (report.status === 'blocked') failure.failureCode = 'EXPORT_VERIFICATION_BLOCKED';
        throw new Error('EXPORT_VERIFICATION_FAILED: ' + JSON.stringify(report.checks));
      }
    }
    failure = { failureStage: 'finalize', failureCode: 'EXPORT_FINALIZE_FAILED' };
    const finished = await store.finishExport(job.id, job.token!);
    if (finished.state === 'cancelled') await rm(output, { force: true });
  } catch (error) {
    if (!job) throw error;
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (failure.failureStage === 'render' && code === 'COMMAND_TIMEOUT') failure.failureCode = 'EXPORT_RENDER_TIMEOUT';
    if (failure.failureStage === 'output' && code === 'ENOENT') failure.failureCode = 'EXPORT_OUTPUT_MISSING';
    await recordDiagnostic(store.directory, { kind: 'export_failed', jobId: job.id, projectId: job.projectId,
      message: error instanceof Error ? error.message : 'Render failed' });
    await rm(store.exportPath(job), { force: true });
    const current = await store.job(job.id);
    if (current && ['running', 'cancelling'].includes(current.state)) {
      try { await store.finishExport(job.id, job.token!, error instanceof Error ? error.message : '渲染失败', failure); }
      catch {
        tracking?.track('incident_confirmed', { incident_id: job.id, incident_type: 'other', severity: 'sev1', subject_id: job.id, evidence_ref: 'terminal_persist_failed' }, undefined, 'worker', validHostContext(job.trackingHost) ? job.trackingHost : undefined);
      }
    }
  } finally {
    if (job && tracking) {
      const final = await store.job(job.id).catch(() => null);
      if (final && final.observedOutcome !== 'unknown' && ['completed', 'failed', 'cancelled'].includes(final.state)) {
        trackExportResult(tracking, final);
        await trackExportTerminal(store, final, tracking);
        if (final.state === 'completed' && final.projectId && final.workId)
          await new WorkRounds(store, tracking).exported(final.projectId, final.workId, 'mcp').catch(() => {});
        const host = validHostContext(final.trackingHost) ? final.trackingHost : undefined;
        if (final.projectId && final.versionId) tracking.track('check_completed', { check_id: final.id, check_type: 'technical_export', project_id: final.projectId,
          version_id: final.versionId, subject_id: final.id, checklist_version: 'export-v1', checker_type: 'automated',
          result: technicalCheckResult(final), evidence_ref: final.id }, undefined, 'worker', host);
        if (final.workId && final.projectId) {
          if (final.state === 'completed' && final.verification && (final.verification as any).status === 'passed') tracking.track('host_run_delivered', {
            run_id: final.workId, delivery_mode: 'technical_export', project_id: final.projectId, revision: final.revision, delivery_evidence_ref: final.id }, undefined, 'worker', host);
          else if (final.state !== 'cancelled') {
            const taskType = await workRoundMode(store, final.projectId, final.workId) ?? 'modify';
            tracking.track('host_run_failed', { run_id: final.workId, task_type: taskType, error_code: final.failureCode ?? 'EXPORT_FAILED', stage: final.failureStage ?? 'unknown' }, undefined, 'worker', host);
          }
          tracking.track('host_state_changed', { run_id: final.workId, sequence: 2,
            state: final.state === 'completed' && final.verification && (final.verification as any).status === 'passed' ? 'delivered' : final.state === 'cancelled' ? 'cancelled' : 'failed',
            phase: 'technical_export', state_reason: final.state === 'completed' ? 'EXPORT_VERIFIED' : final.state === 'cancelled' ? 'EXPORT_CANCELLED' : 'EXPORT_FAILED' }, undefined, 'worker', host);
        }
      }
    }
    if (job) runningExports.delete(job.id);
    if (job) await rm(store.snapshotDirectory(job.id), { recursive: true, force: true });
    working.delete(key);
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
}
async function input(req: IncomingMessage, maxBytes = 9 * 1024 * 1024) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 application/json');
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('提交内容超过大小限制');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function revision(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('需要 openmotion_get_project 返回的 expectedRevision');
}

async function openProject(store: WorkspaceStore, context: Service, origin: string, expectedRevision: string, target: { templateId: string } | { projectId: string } | { title: string; instruction?: string }, expectedProjectId?: string, sessionTarget?: { sessionId?: string; title?: string; templateId?: string; instruction?: string }) {
  if (!context.runtimeRoot) throw new Error('Hyperframes 服务尚未就绪');
  if (context.switching) throw new Error('正在打开工程，请稍候');
  context.switching = true;
  const runtimeRoot = context.runtimeRoot;
  try {
    return await store.lock(async () => {
      if (expectedProjectId && store.projectId !== expectedProjectId) throw new Conflict();
      if ((await store.get()).revision !== expectedRevision) throw new Conflict();
      const template = 'templateId' in target ? await templateCatalogFor(store.directory).get(target.templateId) : undefined;
      const creating = Boolean(template) || 'title' in target;
      const id = creating ? crypto.randomUUID() : (target as { projectId: string }).projectId;
      const entry = creating ? { id, title: template?.title ?? (target as { title: string }).title, templateId: template?.id, createdAt: Date.now() } : undefined;
      const savedProject = !entry ? store.projectCatalog().projects.find(item => item.id === id) : undefined;
      if (!entry && !savedProject) throw new Error('工程不存在');
      if (!entry && savedProject?.trashedAt) throw new Error('PROJECT_TRASHED: 工程已在回收站');
      if (sessionTarget?.sessionId && !store.projectCatalog().sessions!.some(item => item.id === sessionTarget.sessionId)) throw new Error('会话不存在');
      if (!entry && id === 'project') await store.forProject(id).initializeLocked(runtimeRoot);
      if (!entry && store.projectCatalog().activeId === id) {
        if (!context.studio?.alive()) context.studio = context.launchStudio ? await context.launchStudio(store.projectDirectoryFor(id), context.studioPort || 4174) : await startStudio(runtimeRoot, store.projectDirectoryFor(id), path.join(store.directory, 'studio.log'), context.studioPort || 4174);
        await context.studio.openProject?.(id);
        await store.selectProject(id);
        return { ...(await store.status()), studioUrl: `${origin}/#project/${id}` };
      }
      const directory = store.projectDirectoryFor(id);
      let candidate: Studio | undefined;
      let committed = false;
      try {
        if (template) await templateCatalogFor(store.directory).copy(template, directory, runtimeRoot);
        else if ('title' in target) await createBlankProject(directory, runtimeRoot, target.title);
        await store.safePath('index.html', directory);
        const oldStudio = context.studio;
        const oldPort = oldStudio ? Number(new URL(oldStudio.url).port) : undefined;
        const candidatePort = oldPort === undefined ? context.studioPort || 4174 : oldPort === 65535 ? 4174 : oldPort + 1;
        candidate = oldStudio?.alive() && oldStudio.openProject ? oldStudio : context.launchStudio ? await context.launchStudio(directory, candidatePort) : await startStudio(runtimeRoot, directory, path.join(store.directory, 'studio.log'), candidatePort);
        // Native Studio writes are independent of our lock. Recheck before switching.
        if ((await store.get()).revision !== expectedRevision) throw new Conflict();
        await store.selectProject(id, entry, sessionTarget?.instruction ?? ('instruction' in target ? target.instruction : undefined), sessionTarget);
        context.studio = candidate; committed = true;
        await candidate.openProject?.(id);
        if (oldStudio !== candidate) await oldStudio?.close();
        return { ...(await store.status()), studioUrl: `${origin}/#project/${id}` };
      } finally {
        if (!committed) {
          if (candidate !== context.studio) await candidate?.close();
          if (creating) await rm(directory, { recursive: true, force: true });
        }
      }
    });
  } finally { context.switching = false; }
}

async function openEditor(store: WorkspaceStore, context: Service) {
  if (context.ensureStudio) { await context.ensureStudio(store.projectId); return; }
  if (!context.runtimeRoot) throw new Error('Hyperframes 服务尚未就绪');
  if (context.switching) throw new Error('正在打开工程，请稍候');
  if (context.studio?.alive()) return;
  context.switching = true;
  try {
    await store.initialize(context.runtimeRoot);
    context.studio = await startStudio(context.runtimeRoot, store.projectDirectory, path.join(store.directory, 'studio.log'), context.studioPort || 4174);
  } finally { context.switching = false; }
}

async function createSession(store: WorkspaceStore, data: Record<string, any>) {
  const mode = creationMode(data.mode ?? 'motion');
  if (data.id !== undefined && typeof data.id !== 'string') throw new Error('会话编号无效');
  const template = data.templateId ? await templateCatalogFor(store.directory).get(data.templateId) : undefined;
  const instruction = data.instruction === undefined ? template ? `使用模板 ${template.title}（${template.id}）继续创作。` : undefined : validateInstruction(data.instruction);
  const catalog = store.projectCatalog(), existing = catalog.sessions!.find(item => item.id === data.id);
  const title = validateProjectTitle(data.title ?? (data.instruction ? instruction!.replace(/\s+/g, ' ').slice(0, 40) : template?.title || existing?.title || `新会话 ${catalog.sessions!.length + 1}`));
  return store.createSession({ id: data.id, mode: mode.id, title, templateId: template?.id, instruction });
}

// The HTTP, MCP and embedded clients share this mode factory; viewers do not create sessions.
const artifactFactories: Record<CreationMode, (store: WorkspaceStore, context: Service, origin: string, session: CreativeSession, data: Record<string, any>) => Promise<unknown>> = {
  motion: async (store, context, origin, session, data) => {
    const templateId = data.templateId ?? (session.artifacts.length === 0 ? session.templateId : undefined);
    const template = templateId ? await templateCatalogFor(store.directory).get(templateId) : undefined;
    const title = validateProjectTitle(data.title ?? (session.artifacts.length ? `Motion ${session.artifacts.length + 1}` : session.title));
    return openProject(store, context, origin, data.expectedRevision, template && isEditableTemplate(template) ? { templateId: template.id } : { title }, data.expectedProjectId, { sessionId: session.id, templateId: template?.id });
  },
};
async function createArtifact(store: WorkspaceStore, context: Service, origin: string, session: CreativeSession, data: Record<string, any>) {
  revision(data.expectedRevision);
  return artifactFactories[creationMode(session.mode).id](store, context, origin, session, data);
}
async function legacyCreation(store: WorkspaceStore, context: Service, origin: string, data: Record<string, any>) {
  revision(data.expectedRevision);
  if ((await store.get()).revision !== data.expectedRevision || (data.expectedProjectId && store.projectCatalog().activeId !== data.expectedProjectId)) throw new Conflict();
  const session = await createSession(store, data);
  return createArtifact(store, context, origin, session, data);
}

// These GET routes start server-side work (CLI refresh, catalogue refresh, export recovery,
// captured brand covers), so they follow the same caller rule as the mutating verbs below.
// /api/models forwards refresh=true into provider discovery, which reads stored keys and rewrites caches.
const sideEffectingGet = [/^\/api\/settings\/account$/, /^\/api\/models$/, /^\/api\/models\/capabilities$/, /^\/api\/project\/status$/,
  /^\/api\/brand-kits\/(?:catalog\/)?[^/]+\/(?:cover|favicon)$/];

export async function handler(req: IncomingMessage, res: ServerResponse, store = sharedStore, context = service) {
  res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
  try {
    const host = req.headers.host;
    if (host && !['localhost', '127.0.0.1', '[::1]'].includes(new URL('http://' + host).hostname)) return json(res, 403, { error: '只允许本地访问' });
    // Masvid Studio: masvid.vercel.app asks (after a click) whether the studio runs on this PC. No data is returned.
    if ((req.url || '').split('?')[0] === '/api/ping' && (req.method === 'GET' || req.method === 'OPTIONS')) {
      const origin = req.headers.origin;
      if (origin && ['https://masvid.vercel.app', 'http://localhost:5173'].includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET'); res.setHeader('Access-Control-Allow-Private-Network', 'true');
      }
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      return json(res, 200, { ok: true, app: 'masvid-studio', url: `http://localhost:${process.env.PORT || 4180}/` });
    }
    if (!['GET', 'HEAD'].includes(req.method || '') && (!req.headers.origin || new URL(req.headers.origin).host !== host)) return json(res, 403, { error: '仅允许当前预览页面发起修改' });
    const projectHeader = req.headers['x-opendesign-project-id'];
    if (projectHeader !== undefined) {
      if (!context.editorToken || req.headers.authorization !== `Bearer ${context.editorToken}` || typeof projectHeader !== 'string') return json(res, 403, { error: '工程范围需要私有编辑器凭据' });
      store = store.forProject(projectHeader);
    }
    const originalUrl = new URL(req.url || '/', 'http://localhost');
    const motionRequest = /^\/(?:motion|design)-api\//.test(originalUrl.pathname);
    const url = new URL(originalUrl);
    if (motionRequest && url.searchParams.has('projectId')) {
      const id = url.searchParams.get('projectId')!;
      if (projectHeader !== undefined && projectHeader !== id) return json(res, 400, { error: 'PROJECT_SCOPE_MISMATCH' });
      store = store.forProject(id);
    }
    if (context.ensureStudio && !isStandaloneSpaPath(url.pathname, url.search) && (isSpaRoutePath(url.pathname) || url.pathname.startsWith('/sessions/'))) {
      const projectId = editorProjectIdFromPath(url.pathname) ?? url.searchParams.get('project');
      const sessionId = url.searchParams.get('session');
      if (projectId !== null) {
        if (store.projectCatalog().projects.some(project => project.id === projectId && !project.trashedAt)) await context.ensureStudio(projectId);
      } else if (sessionId) {
        const catalog = store.projectCatalog();
        const saved = catalog.sessions!.find(session => session.id === sessionId);
        const session = saved && availableSession(saved, new Set(catalog.projects.filter(project => project.trashedAt).map(project => project.id)));
        const artifact = session?.artifacts.find(artifact => artifact.id === session.activeArtifactId) ?? session?.artifacts.at(-1);
        if (artifact) await context.ensureStudio(artifact.projectId);
      }
    }
    if (motionRequest) url.pathname = url.pathname.replace(/^\/(?:motion|design)-api\//, '/api/');
    const fetchSite = req.headers['sec-fetch-site'];
    if ((req.method === 'GET' || req.method === 'HEAD') && fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none'
      && sideEffectingGet.some(pattern => pattern.test(url.pathname))) return json(res, 403, { error: '仅允许当前预览页面读取' });
    if (motionRequest && url.pathname.startsWith('/api/claude/') && await claudeChatHttp(req, res, url, (store.workspaceStore ?? store).directory, input)) return;
    if (motionRequest && url.pathname.startsWith('/api/assets/conversations')) {
      const chats = assetConversations(store);
      if (url.pathname === '/api/assets/conversations') {
        if (req.method === 'GET') return json(res, 200, { conversations: await chats.list() });
        if (req.method === 'POST') return json(res, 200, { conversation: await chats.create() });
      }
      const chatRoute = url.pathname.match(/^\/api\/assets\/conversations\/([^/]+)(?:\/(turn|stop|approve))?$/);
      if (chatRoute) {
        const [, id, action] = chatRoute;
        if (!action && req.method === 'GET') return json(res, 200, { conversation: await chats.get(id) });
        if (req.method === 'POST') {
          const data = await input(req, 128 * 1024);
          if (action === 'turn') return json(res, 200, { conversation: await chats.start(id, data) });
          if (action === 'stop') return json(res, 200, { conversation: await chats.stop(id) });
          if (action === 'approve') return json(res, 200, { conversation: await chats.answer(id, data.approvalId, data.accepted) });
        }
      }
      return json(res, 405, { error: 'Unsupported conversation request' });
    }
    if (motionRequest && url.pathname.startsWith('/api/project-archives/') && await projectArchiveHttp(req, res, url, store.workspaceStore ?? store, context.runtimeRoot)) return;
    if (motionRequest && url.pathname.startsWith('/api/scenarios/') && await scenarioHttp(req, res, url, store.workspaceStore ?? store)) return;
    if (motionRequest && url.pathname.startsWith('/api/assets/') && await assetHttp(req, res, url, store)) return;
    if (motionRequest && await brandKitHttp(req, res, url, store.directory, input)) return;
    const editorUrl = `http://${host || 'localhost'}/#project/${store.projectId}`;
    if ((url.pathname === '/api/games' || url.pathname.startsWith('/api/games/')) && await gameHttp(req, res, url, (store.workspaceStore ?? store).directory, input, context.runtimeRoot)) return;
    if (motionRequest && url.pathname.startsWith('/api/design/') && await designHttp(req, res, url, (store.workspaceStore ?? store).directory, new URL(editorUrl).origin, input, ref => new AssetLibrary(store.workspaceStore ?? store).resolve(ref))) return;
    if (motionRequest && ['/api/diagnostics', '/api/diagnostics/events'].includes(url.pathname)) {
      // Downloads are POST-only: cross-origin links must not trigger a collection.
      if (req.method !== 'POST') return json(res, 405, { error: 'POST_REQUIRED' });
      if (req.headers['sec-fetch-site'] === 'cross-site' || url.search) return json(res, 403, { error: 'DIAGNOSTIC_SCOPE_REJECTED' });
      const data = await input(req, 32 * 1024);
      if (!data || Object.keys(data).some(key => key !== 'errors') || !Array.isArray(data.errors) || data.errors.length > (url.pathname.endsWith('/events') ? 20 : 60)
        || !data.errors.every((entry: any) => entry && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).every(key => ['time', 'kind', 'message', 'stack'].includes(key))
          && Object.values(entry).every(value => typeof value === 'string' && value.length <= 4096))) return json(res, 400, { error: 'INVALID_DIAGNOSTIC_INPUT' });
      const state = context.diagnostics ??= { running: false, lastExport: 0, events: 0, window: Date.now() };
      const directory = (store.workspaceStore ?? store).directory;
      if (url.pathname.endsWith('/events')) {
        if (Date.now() - state.window > 60_000) { state.events = 0; state.window = Date.now(); }
        if (state.events + data.errors.length > 60) return json(res, 429, { error: 'DIAGNOSTIC_RATE_LIMITED' });
        state.events += data.errors.length;
        await recordDiagnostic(directory, data.errors);
        return json(res, 200, { accepted: data.errors.length });
      }
      if (state.running || Date.now() - state.lastExport < diagnosticLimits.cooldownMs) {
        res.setHeader('Retry-After', '30');
        return json(res, 429, { error: 'DIAGNOSTIC_RATE_LIMITED' });
      }
      state.running = true; state.lastExport = Date.now();
      try {
        const result = await collectDiagnostics({ appRoot: context.nativeRoot ?? pluginRoot, dataDirectory: directory, browserErrors: data.errors });
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': attachmentDisposition(result.filename),
          'Content-Length': result.data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(result.data); return;
      } finally { state.running = false; }
    }
    if (motionRequest && url.pathname === '/api/runtime' && ['GET', 'POST'].includes(req.method!)) {
      const root = context.nativeRoot ?? pluginRoot;
      if (req.method === 'POST') {
        const data = await input(req, 1024);
        if (!data || Object.keys(data).length !== 1 || data.retry !== true) return json(res, 400, { error: 'INVALID_RUNTIME_RETRY' });
        await startNativePreparation(root, true);
      }
      return json(res, 200, await nativeRuntimeStatus(root));
    }
    if (motionRequest && url.pathname === '/api/tracking/preferences' && ['GET', 'PUT'].includes(req.method!)) {
      const directory = (store.workspaceStore ?? store).directory;
      if (req.method === 'PUT') {
        const reason = trackingLockReason();
        if (reason) return json(res, 403, { error: 'TRACKING_DISABLED_BY_ENVIRONMENT' });
        const data = await input(req, 1024);
        if (!data || Object.keys(data).length !== 1 || typeof data.enabled !== 'boolean') return json(res, 400, { error: 'INVALID_TRACKING_PREFERENCE' });
        await saveTrackingPreference(directory, data.enabled);
      }
      const reason = trackingLockReason();
      return json(res, 200, { enabled: context.tracking?.enabled() ?? false, preference: trackingPreference(directory), locked: reason !== null, reason });
    }
    if (motionRequest && url.pathname === '/api/tracking' && req.method === 'GET') return json(res, 200, { enabled: context.tracking?.enabled() ?? false });
    if (motionRequest && url.pathname === '/api/tracking' && req.method === 'POST') {
      if (!context.tracking?.enabled()) return json(res, 200, { accepted: 0, enabled: false });
      const data = await input(req, 64 * 1024);
      if (!data || Object.keys(data).length !== 1 || !Array.isArray(data.events) || data.events.length > 16
        || !data.events.every((event: unknown) => validPending(studioEvents, event) && event.entrypoint === 'studio' && !Object.hasOwn(event, 'host_context'))) return json(res, 400, { error: 'INVALID_TRACKING_BATCH' });
      const page = context.trackingHosts?.get(url.searchParams.get('context') ?? '');
      const host = page && Date.now() - page.createdAt <= 86_400_000 ? page.host : unknownHost;
      const statuses = data.events.map((event: object) => context.tracking!.ingest({ ...event, host_context: host }));
      const workRounds = new WorkRounds(store.workspaceStore ?? store, context.tracking);
      await Promise.allSettled(data.events.map((event: any, i: number) =>
        ['queued', 'duplicate'].includes(statuses[i]) ? workRounds.studioEdited(event) : undefined));
      return json(res, statuses.includes('full') ? 429 : 200, { accepted: statuses.filter((status: string) => status === 'queued').length });
    }
    if (motionRequest && url.pathname === '/api/phase1/call' && req.method === 'POST') {
      if (!context.runtimeRoot) throw new Error('RUNTIME_NOT_READY');
      const authority = store.workspaceStore ?? store;
      context.phase1 ??= new Phase1Service(authority, context.runtimeRoot, {
        origin: () => new URL(editorUrl).origin,
        nativeUrl: () => context.studio?.alive() ? context.studio.url : undefined,
        openProject: async projectId => { await openProject(authority, context, new URL(editorUrl).origin, (await authority.get()).revision, { projectId }, authority.projectId); },
        mutation: async task => {
          let release!: () => void;
          context.phase1Mutation = new Promise<void>(resolve => { release = resolve; });
          try { return await task(); } finally { release(); context.phase1Mutation = undefined; }
        },
        cancel: (projectId, jobId) => cancelExport(authority, projectId, jobId, context.tracking),
        tracking: context.tracking,
      });
      const data = await input(req);
      try {
        const host = validHostContext(data.trackingHost) ? data.trackingHost : unknownHost;
        let result = await context.phase1.call(data.name, data.arguments ?? {}, host, {
          attributeEntry: Object.hasOwn(data, 'trackingHost'),
        });
        if (host.host_agent !== 'unknown' && context.tracking?.enabled() && (result.previewUrl || result.previewHandoff)) {
          const hosts = context.trackingHosts ??= new Map();
          for (const [key, value] of hosts) if (Date.now() - value.createdAt > 86_400_000) hosts.delete(key);
          let token = uuid.test(data.trackingContext) ? data.trackingContext : crypto.randomUUID();
          const existing = hosts.get(token);
          if (existing && (['host_agent', 'host_agent_source', 'mcp_client_name', 'mcp_client_version'] as const)
            .some(key => existing.host[key] !== host[key])) token = crypto.randomUUID();
          if (!hosts.has(token) && hosts.size >= 256) hosts.delete(hosts.keys().next().value!);
          hosts.set(token, { host, createdAt: Date.now() });
          result = previewTrackingContext(result, new URL(editorUrl).origin, token);
        }
        return json(res, 200, result);
      }
      catch (error) {
        const message = error instanceof Error ? error.message : 'Tool failed';
        const { error_code, invalid_field, validation_rule } = toolFailureFields(error);
        return json(res, 400, { error: message, ...(error_code !== 'TOOL_FAILED' ? { code: error_code } : {}),
          ...(invalid_field ? { invalid_field, validation_rule } : {}),
          applied: (error as any)?.applied === false || message.startsWith('VERSION_NOT_RESTORABLE:') ? false : 'unknown' });
      }
    }
    if (req.method === 'GET' && ['/api/integration', '/connect/guide', '/connect/config'].includes(url.pathname)) {
      const address = new URL(editorUrl);
      const info: IntegrationInfo = containerIntegration({
        templateSource: templateCatalogFor(store.directory).source,
        templateEnvironment: templateCatalogFor(store.directory).environment as 'dev' | 'prod',
        name: 'OpenMotion', version: VERSION, previewUrl: address.origin, dataDirectory: store.directory,
        transport: { type: 'stdio', command: process.execPath, args: ['--experimental-strip-types', path.join(pluginRoot, 'mcp.ts')], cwd: pluginRoot,
          env: { MOTION_DATA_DIR: store.directory, PORT: address.port || '80', MOTION_TEMPLATE_SOURCE: templateCatalogFor(store.directory).source, ...Object.fromEntries(['MOTION_TEMPLATE_ENV', 'MOTION_TEMPLATE_RESOURCE_ID', 'MOTION_TEMPLATE_LOCALE', 'MOTION_BROWSER_PATH', 'HYPERFRAMES_BROWSER_PATH', 'HYPERFRAMES_FFMPEG_PATH', 'HYPERFRAMES_FFPROBE_PATH', 'FFMPEG_PATH', 'FFPROBE_PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]!])) } },
        tools: mcpTools.map(({ name, description }) => ({ name, description })),
      }, process.env.MOTION_CONTAINER_NAME);
      if (url.pathname === '/api/integration') return json(res, 200, info);
      const selected = integrationHost(url.searchParams.get('host'));
      if (url.pathname === '/connect/guide') {
        const id = url.searchParams.get('template');
        const recipe = id ? '\n\n' + templateRecipe(await templateCatalogFor(store.directory).get(id)) : '';
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(agentGuide(info, selected) + recipe);
      }
      const config = integrationConfig(info, selected);
      res.writeHead(200, { 'Content-Type': config.contentType, 'Content-Disposition': attachmentDisposition(config.filename) });
      return res.end(config.text);
    }
    if (req.method === 'GET' && /^\/connect\/?$/.test(url.pathname)) {
      res.writeHead(302, { Location: '/?panel=connections&host=' + integrationHost(url.searchParams.get('host')) }); return res.end();
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      const nativeRuntime = await nativeRuntimeStatus(context.nativeRoot ?? pluginRoot);
      return json(res, 200, {
        service: 'motion-preview', protocol: 2, version: VERSION, dataDirectory: store.directory, mcp: phase1McpCapabilities,
        engine: 'hyperframes', engineVersion: HYPERFRAMES_VERSION, editor: 'opendesign-motion', nativeRuntime, ffmpeg: nativeRuntime.managed ? nativeRuntime.capabilities.media : Boolean(context.ffmpeg),
        ready: Boolean(context.runtimeRoot && (!context.studio || context.studio.alive())), editorReady: Boolean(context.studio?.alive()), studioUrl: context.studio?.alive() ? editorUrl : undefined, nativeStudioUrl: context.studio?.url,
        ...(context.runtimeRoot ? { hyperframesCli: cliPath(context.runtimeRoot), authoringGuide: path.join(context.runtimeRoot, 'node_modules/hyperframes/dist/skills/hyperframes/SKILL.md') } : {}),
      });
    }
    if (motionRequest && url.pathname === '/api/preview/open' && req.method === 'POST') {
      await openEditor(store, context);
      return json(res, 200, { studioUrl: editorUrl, ...(await store.status()) });
    }
    if (url.pathname === '/api/studio' && req.method === 'GET') {
      if (!context.studio?.alive()) return json(res, 503, { error: 'Hyperframes Studio 尚未就绪，请重新打开预览并检查 studio.log' });
      return json(res, 200, { url: editorUrl, projectDirectory: store.projectDirectory, projectId: store.projectCatalog().activeId });
    }
    if (motionRequest && url.pathname.startsWith('/api/settings/')) {
      const gateway = gatewayFor(store, context.tracking);
      const agents = localAgentsFor(store.directory);
      if (url.pathname === '/api/settings/agents' && req.method === 'GET') return json(res, 200, await agents.list());
      if (url.pathname === '/api/settings/default-agent' && req.method === 'PUT') { const body = await input(req); await agents.choose(body.choice); return json(res, 200, { ok: true }); }
      const agentAction = url.pathname.match(/^\/api\/settings\/agents\/([a-z0-9-]+)\/(inspect|models|prepare|open)$/);
      if (agentAction && req.method === 'POST') {
        const [, id, action] = agentAction;
        if (action === 'inspect') return json(res, 200, await agents.inspect(id));
        const body = await input(req);
        if (action === 'models') { await agents.addModel(id, body.model); return json(res, 200, { ok: true }); }
        if (!['login', 'launch'].includes(body.action)) throw new Error('Invalid Agent action');
        const choice = { agent: id, model: body.model ?? 'default', ...(body.reasoning ? { reasoning: body.reasoning } : {}) };
        const plan = await agents[action === 'open' ? 'open' : 'prepare'](choice, store.projectDirectory, new URL(editorUrl).origin, body.action);
        return json(res, 200, plan);
      }
      if (url.pathname === '/api/settings/providers' && req.method === 'GET') return json(res, 200, await providerDirectory(gateway));
      if (url.pathname === '/api/settings/providers' && req.method === 'POST') return json(res, 200, { id: await gateway.connections.configure(null, await input(req)) });
      const provider = url.pathname.match(/^\/api\/settings\/providers\/([a-z0-9-]+)(\/sync|\/models)?$/);
      if (provider) {
        const id = provider[1];
        if (!provider[2] && req.method === 'PUT') return json(res, 200, await gateway.configureProvider(id, await input(req)));
        if (!provider[2] && req.method === 'DELETE') { await gateway.connections.remove(id); return json(res, 200, { ok: true }); }
        if (provider[2] === '/sync' && req.method === 'POST') { await syncProvider(gateway, id); return json(res, 200, { ok: true }); }
        if (provider[2] === '/models' && req.method === 'POST') {
          const body = await input(req);
          if (isMediaProvider(id)) {
            modelMetadata(body);
            const model = await gateway.registerModel({ ...body, provider: id, modality: body.kind, mode: body.kind === 'audio' ? 'text-to-speech' : `text-to-${body.kind}` });
            await gateway.connections.updateMetadata(model.model.id, body);
            return json(res, 200, model);
          }
          return json(res, 200, await gateway.connections.saveModel(id, body));
        }
      }
      if (url.pathname === '/api/settings/models' && req.method === 'PUT') {
        const body = await input(req);
        if (typeof body.id !== 'string' || body.enabled !== null && typeof body.enabled !== 'boolean') throw new Error('Invalid model update');
        await gateway.connections.updateModel(body.id, body.enabled); return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/settings/models' && req.method === 'PATCH') {
        const body = await input(req), directory = await providerDirectory(gateway);
        if (typeof body.id !== 'string' || !directory.models.some(model => model.id === body.id)) throw new Error('Model not found');
        await gateway.connections.updateMetadata(body.id, body); return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/settings/default-model' && req.method === 'PUT') {
        const body = await input(req); await setDefaultModel(gateway, body.kind, body.model); return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/settings/account' && req.method === 'GET') return json(res, 200, await gateway.account.summary(url.searchParams.get('refresh') === 'true'));
      if (url.pathname === '/api/settings/account/login' && req.method === 'POST') return json(res, 200, await gateway.account.login());
      if (url.pathname === '/api/settings/account/cancel' && req.method === 'POST') return json(res, 200, await gateway.account.cancel());
      if (url.pathname === '/api/settings/account/logout' && req.method === 'POST') return json(res, 200, await gateway.account.logout());
      if (url.pathname === '/api/settings/account/subscription' && req.method === 'POST') return json(res, 200, await gateway.account.openSubscription());
      return json(res, 404, { error: 'Settings endpoint not found' });
    }
    if (motionRequest && (url.pathname.startsWith('/api/models') || url.pathname.startsWith('/api/generations'))) {
      const gateway = gatewayFor(store, context.tracking);
      if (url.pathname === '/api/models/capabilities' && req.method === 'GET') return json(res, 200, await gateway.status(url.searchParams.get('refresh') === 'true'));
      if (url.pathname === '/api/models' && req.method === 'GET') return json(res, 200, await gateway.listModels({
        provider: url.searchParams.get('provider') ?? undefined, modality: url.searchParams.get('modality') ?? undefined,
        query: url.searchParams.get('query') ?? '', refresh: url.searchParams.get('refresh') === 'true',
        offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 100),
      }));
      const reference = url.pathname.match(/^\/api\/models\/providers\/([a-z0-9-]+)\/reference$/);
      if (reference && req.method === 'GET' && (isMediaProvider(reference[1]) || reference[1] === 'account' || reference[1] === 'compatible')) {
        const guide = await getWorkflow(registeredProvider(reference[1])?.reference ?? 'compatible', 'media');
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(guide.content);
      }
      const provider = url.pathname.match(/^\/api\/models\/providers\/([a-z0-9-]+)$/);
      if (provider && req.method === 'PUT') return json(res, 200, await gateway.configureProvider(provider[1], await input(req)));
      const route = url.pathname.match(/^\/api\/models\/routes\/([a-z]+)$/);
      if (route && req.method === 'PUT') return json(res, 200, await gateway.setRoute(route[1], (await input(req)).model));
      if (url.pathname === '/api/models/custom' && req.method === 'POST') return json(res, 200, await gateway.registerModel(await input(req)));
      if (url.pathname === '/api/generations' && req.method === 'POST') {
        if (!context.studio?.alive()) return json(res, 503, { error: 'Open the Studio before generating media' });
        return json(res, 202, { job: await gateway.submit(await input(req)) });
      }
      if (url.pathname === '/api/generations' && req.method === 'GET') return json(res, 200, { jobs: (await gateway.listJobs(url.searchParams.get('projectId') ?? undefined)).slice(0, 50) });
      const generation = url.pathname.match(/^\/api\/generations\/([a-f0-9-]+)(\/cancel)?$/);
      if (generation && req.method === 'GET' && !generation[2]) return json(res, 200, { job: await gateway.getJob(generation[1]) });
      if (generation && req.method === 'POST' && generation[2]) return json(res, 200, { job: await gateway.cancel(generation[1]) });
      return json(res, 404, { error: 'Unknown model gateway operation' });
    }
    if (url.pathname === '/api/templates' && req.method === 'GET') return json(res, 200, { templates });
    const templateSource = url.pathname.match(/^\/api\/template-source\/([a-z][a-z0-9-]+)\/(.+)$/);
    if (templateSource && req.method === 'GET') {
      const name = decodeURIComponent(templateSource[2]);
      const mime: Record<string, string> = { '.html': 'text/html', '.md': 'text/plain', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac' };
      const type = mime[path.extname(name).toLowerCase()] || 'application/octet-stream';
      try {
        const catalog = templateCatalogFor(store.directory);
        let bytes = await catalog.sourceFile(templateSource[1], name);
        if (name === 'viewer/guide.js') {
          bytes = Buffer.from(bytes.toString().replaceAll("location.protocol==='file:'?'*':location.origin", "(location.protocol==='file:' || location.origin === 'null') ? '*' : location.origin"));
        }
        if (name === 'preview.html' && url.searchParams.get('raw') !== '1') {
          const template = await catalog.get(templateSource[1]);
          bytes = Buffer.from(upgradeTemplateGuidePage(bytes.toString(), { id: template.id, title: template.title, brand: template.brand,
            sourceUrl: template.sourceUrl, previewUrl: template.previewUrl, posterUrl: template.posterUrl, hasHtmlProject: template.hasHtmlProject,
            ...(!authoredTemplateGuide(bytes.toString()) ? { motionDocument: (await catalog.sourceFile(template.id, 'motion.md')).toString() } : {}) }));
        }
        else if (name === 'preview.html' && url.searchParams.get('stage') === '1') bytes = Buffer.from(compactNativeGuideStage(bytes.toString()));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length,
          ...(name === 'motion.md' && url.searchParams.get('download') === '1' ? { 'Content-Disposition': 'attachment; filename="motion.md"' } : {}) }); res.end(bytes); return;
      } catch (error) {
        if ((error as { code?: string }).code === 'TEMPLATE_LFS_NOT_FETCHED')
          return json(res, 409, { code: 'TEMPLATE_LFS_NOT_FETCHED', error: (error as Error).message });
        return json(res, 404, { error: 'Template source file not found' });
      }
    }
    if (url.pathname === '/api/template-catalog' && req.method === 'GET') return json(res, 200, await templateCatalogFor(store.directory).page({
      locale: url.searchParams.get('locale') || undefined,
      category: url.searchParams.get('category') || 'featured', query: url.searchParams.get('query') || '',
      offset: Number(url.searchParams.get('offset') || 0), limit: Number(url.searchParams.get('limit') || 6), grouped: url.searchParams.get('grouped') === 'true',
      covered: url.searchParams.get('covered') === 'true',
    }));
    if (motionRequest && url.pathname === '/api/projects' && req.method === 'GET') return json(res, 200, store.projectCatalog());
    if (motionRequest && url.pathname === '/api/modes' && req.method === 'GET') return json(res, 200, { modes: creationModes, viewers: artifactViewers });
    if (motionRequest && url.pathname === '/api/sessions' && req.method === 'GET') {
      const { sessions, activeSessionId } = store.projectCatalog(); return json(res, 200, { sessions, activeSessionId });
    }
    if (motionRequest && url.pathname === '/api/sessions' && req.method === 'POST') {
      const session = await createSession(store, await input(req));
      return json(res, 201, { sessionId: session.id, session });
    }
    const browserRoute = motionRequest ? url.pathname.match(/^\/api\/sessions\/([a-z0-9-]+)\/browser\/([a-z0-9-]{1,80})(?:\/(events|command|resize|input))?$/) : null;
    if (browserRoute) {
      const [, sessionId, tabId, action] = browserRoute;
      await store.session(sessionId);
      if (!context.runtimeRoot) throw new Error('浏览器服务尚未就绪');
      const browser = context.browser ??= new WorkspaceBrowser(context.runtimeRoot);
      if (!action && req.method === 'POST') return json(res, 200, (await browser.open(sessionId, tabId, (await input(req)).url)).state);
      if (!action && req.method === 'DELETE') { await browser.remove(sessionId, tabId); return json(res, 200, { closed: true }); }
      const tab = await browser.get(sessionId, tabId);
      if (action === 'events' && req.method === 'GET') { await tab.watch(res); return; }
      if (req.method === 'POST') {
        const data = await input(req);
        if (action === 'command') await tab.command(data.action, data.url);
        else if (action === 'resize') await tab.resize(data.width, data.height);
        else if (action === 'input') await tab.input(data);
        else throw new Error('未知浏览器操作');
        return json(res, 200, tab.state);
      }
      return json(res, 405, { error: '浏览器操作不支持此请求方式' });
    }
    const sessionRoute = motionRequest ? url.pathname.match(/^\/api\/sessions\/([a-z0-9-]+)(?:\/(messages|artifacts|open))?$/) : null;
    if (sessionRoute) {
      const [, id, action] = sessionRoute;
      if (req.method === 'GET' && !action) return json(res, 200, await store.session(id));
      if (req.method === 'PATCH' && !action) return json(res, 200, await store.renameSession(id, (await input(req)).title));
      if (req.method === 'POST' && action === 'messages') { const data = await input(req); return json(res, 201, await store.addSessionMessage(id, data.id, data.content, data.role)); }
      if (req.method === 'POST' && (action === 'open' || action === 'artifacts')) {
        const data = await input(req); revision(data.expectedRevision);
        const session = await store.session(id);
        if (action === 'open') {
          if (!session.artifacts.length && !data.projectId) return json(res, 200, await store.selectSession(id));
          const selectable = data.projectId ? session : availableSession(session, new Set(store.projectCatalog().projects.filter(project => project.trashedAt).map(project => project.id)));
          if (!selectable) throw new Error('PROJECT_TRASHED: 工程已在回收站');
          const artifact = data.projectId ? selectable.artifacts.find(item => item.projectId === data.projectId) : selectable.artifacts.find(item => item.id === selectable.activeArtifactId) ?? selectable.artifacts[0];
          if (!artifact) throw new Error('该产物不属于此会话');
          return json(res, 200, await openProject(store, context, new URL(editorUrl).origin, data.expectedRevision, { projectId: artifact.projectId }, data.expectedProjectId));
        }
        return json(res, 201, await createArtifact(store, context, new URL(editorUrl).origin, session, data));
      }
    }
    if (motionRequest && url.pathname === '/api/projects' && req.method === 'POST') {
      const data = await input(req); revision(data.expectedRevision);
      const title = validateProjectTitle(data.title ?? `未命名项目 ${store.projectCatalog().projects.length + 1}`);
      const instruction = data.instruction === undefined ? undefined : validateInstruction(data.instruction);
      return json(res, 201, await legacyCreation(store, context, new URL(editorUrl).origin, { ...data, title, instruction }));
    }
    const conversation = motionRequest ? url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/conversation$/) : null;
    if (conversation && req.method === 'GET') return json(res, 200, await store.conversation(conversation[1]));
    if (conversation && req.method === 'POST') {
      const data = await input(req);
      return json(res, 201, await store.addProjectMessage(conversation[1], data.id, data.content));
    }
    const renameProject = motionRequest ? url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)$/) : null;
    if (renameProject && req.method === 'PATCH') {
      const data = await input(req);
      return json(res, 200, await store.renameProject(renameProject[1], data.title));
    }
    const poster = url.pathname.match(/^\/api\/templates\/([a-z-]+)\/poster$/);
    if (poster && req.method === 'GET') {
      if (!templates.some(item => item.id === poster[1])) return json(res, 404, { error: '模板不存在' });
      const image = await readFile(path.join(pluginRoot, 'template-library', poster[1], 'poster.jpg'));
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': image.length }); res.end(image); return;
    }
    const openTemplate = url.pathname.match(/^\/api\/templates\/([A-Za-z0-9_-]+)\/open$/);
    const openSaved = motionRequest ? url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/open$/) : null;
    if ((openTemplate || openSaved) && req.method === 'POST') {
      const data = await input(req); revision(data.expectedRevision);
      return json(res, 200, openTemplate ? await legacyCreation(store, context, new URL(editorUrl).origin, { ...data, templateId: openTemplate[1] }) : await openProject(store, context, new URL(editorUrl).origin, data.expectedRevision, { projectId: openSaved![1] }, data.expectedProjectId));
    }
    if (url.pathname === '/api/project/status' && req.method === 'GET') return json(res, 200, {
      ...await store.status(), historyRestoreError: context.phase1?.restoreErrors.get(store.projectId) ?? null,
    });
    if (url.pathname === '/api/project' && req.method === 'GET') return json(res, 200, await store.get());
    if (url.pathname === '/api/project' && req.method === 'PUT') {
      const data = await input(req); revision(data.expectedRevision);
      return json(res, 200, await store.writeFiles(data.expectedRevision, data.files));
    }
    if (url.pathname === '/api/export' && req.method === 'POST') {
      if (!context.runtimeRoot) return json(res, 503, { error: 'Hyperframes 服务尚未就绪' });
      await requireNativeRuntime(context.nativeRoot ?? pluginRoot, 'export');
      const data = await input(req); revision(data.expectedRevision);
      const job = await store.requestExport(data.expectedRevision);
      context.tracking?.track('task_accepted', { task_id: job.id, task_type: 'export', ...(job.projectId ? { project_id: job.projectId } : {}),
        accepted_at: new Date(job.acceptedAt ?? job.createdAt).toISOString(), deadline_at: new Date(job.deadlineAt ?? job.expiresAt).toISOString() });
      return json(res, 202, { job });
    }
    const download = url.pathname.match(/^\/api\/exports\/([a-f0-9-]{36})\/file$/);
    if (download && req.method === 'GET') {
      const job = await store.job(download[1]);
      if (!job || job.id !== download[1] || job.state !== 'completed') return json(res, 404, { error: '视频尚未完成或任务不存在' });
      const filename = store.exportPath(job);
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': (await stat(filename)).size, 'Content-Disposition': renderDownloadDisposition(store.projectCatalog().projects.find(p => p.id === (job.projectId ?? store.projectId))?.title, '.mp4') });
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(filename);
        stream.on('error', reject); res.on('finish', resolve); res.on('close', () => { stream.destroy(); resolve(); }); stream.pipe(res);
      });
      return;
    }
    if (!motionRequest && (url.pathname.startsWith('/api/') || url.pathname === '/__hyperframes_config')) {
      if (context.phase1Mutation) await context.phase1Mutation;
      const scopedProject = url.pathname.match(/^\/api\/projects\/([^/]+)/);
      if (scopedProject) store.forProject(decodeURIComponent(scopedProject[1]));
      if (!context.studio?.alive()) return json(res, 503, { error: '编辑服务尚未就绪' });
      const capability = nativeRouteCapability(req.method!, url.pathname);
      if (capability) await requireNativeRuntime(context.nativeRoot ?? pluginRoot, capability);
      const renderFile = url.searchParams.get('download') === '1'
        && url.pathname.match(/^\/api\/projects\/([^/]+)\/renders\/file\/[^/]+(\.(?:mp4|mov|webm|gif))$/i);
      const disposition = renderFile ? renderDownloadDisposition(
        store.projectCatalog().projects.find(p => p.id === decodeURIComponent(renderFile[1]))?.title, renderFile[2],
      ) : undefined;
      return await proxyStudio(req, res, url, context.studio.url, disposition);
    }
    if (req.method !== 'GET') return json(res, 405, { error: '不支持此操作' });
    if (await serveEditorFile(url, res)) return;
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    if (res.headersSent) res.destroy();
    else json(res, error instanceof Conflict || (error as any).code === 'NATIVE_RUNTIME_NOT_READY' ? 409 : 400, { error: error instanceof Error ? error.message : '操作失败', ...((error as any).code === 'NATIVE_RUNTIME_NOT_READY' ? { code: (error as any).code, applied: false, runtime: (error as any).details } : {}) });
  }
}

// The server listens on loopback unless MOTION_BIND_HOST selects a wildcard address. A container sets
// 0.0.0.0 so its port can be published. Specific addresses are rejected: the readiness probe and the
// URLs handed to Agents use 127.0.0.1, which only loopback and wildcard listeners answer.
const bindHosts = ['127.0.0.1', '0.0.0.0', '::'];
export function bindHost(environment: NodeJS.ProcessEnv = process.env) {
  const value = environment.MOTION_BIND_HOST?.trim();
  if (!value) {
    return '127.0.0.1';
  }
  if (!bindHosts.includes(value)) {
    throw new Error('MOTION_BIND_HOST 只支持 127.0.0.1、0.0.0.0 或 ::');
  }
  return value;
}

export async function startServer(store = sharedStore, port = Number(process.env.PORT || 4180), options: { editor?: boolean; fallbackIfPortBusy?: boolean; editorToken?: string; privateHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean> } = { editor: process.env.MOTION_HEADLESS !== '1' }) {
  // Resolve the address before any child process starts, so an invalid value leaves no editor running.
  const host = bindHost();
  await access(path.join(pluginRoot, 'studio/build/index.html')).catch(() => { throw new Error('编辑器尚未构建，请先运行 npm run build:studio。'); });
  const runtimeRoot = await ensureRuntime(store.directory, false);
  await configureNativeEnvironment(pluginRoot);
  void startNativePreparation(pluginRoot).catch(error => console.error('Native preparation could not start: ' + error.message));
  await recoverProjectTransactions(store, runtimeRoot);
  const ffmpeg = await execute(process.env.HYPERFRAMES_FFMPEG_PATH || process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], pluginRoot, 5000).then(r => r.code === 0, () => false);
  const context: Service = { runtimeRoot, nativeRoot: pluginRoot, ffmpeg, studioPort: !port || port === 65535 ? 4174 : port + 1, editorToken: options.editorToken,
    tracking: await createAppTracking(store.directory, 'mcp') };
  store.tracking = context.tracking;
  context.launchStudio = async (directory, chosenPort) => {
    if (!process.env.OPENMOTION_EDITOR_LOCK_FD) return startStudio(runtimeRoot, directory, path.join(store.directory, 'studio.log'), chosenPort, store.directory);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const available = (probe.address() as any).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    return startOwnedStudio(store.directory, runtimeRoot, directory, path.join(store.directory, 'studio.log'), available);
  };
  let opening: Promise<Studio> | undefined;
  context.ensureStudio = async (projectId = store.projectId) => {
    const scoped = store.forProject(projectId);
    if (projectId === 'project') await scoped.initialize(runtimeRoot);
    if (context.studio?.alive()) { await context.studio.openProject?.(projectId); return context.studio; }
    if (!opening && context.switching) throw new Error('正在打开工程，请稍候');
    if (!opening) opening = (async () => {
      context.switching = true;
      await context.studio?.close();
      await scoped.initialize(runtimeRoot);
      context.studio = await context.launchStudio!(scoped.projectDirectory, !port || port === 65535 ? 4174 : port + 1);
      return context.studio;
    })().finally(() => { opening = undefined; context.switching = false; });
    const studio = await opening;
    await studio.openProject?.(projectId);
    return studio;
  };
  if (options.editor !== false) await context.ensureStudio();
  const server = createServer((req, res) => { void (async () => { if (!options.privateHandler || !await options.privateHandler(req, res)) await handler(req, res, store, context); })().catch(error => { if (!res.headersSent) json(res, 500, { error: (error as Error).message }); else res.destroy(); }); });
  attachGameRooms(server, (store.workspaceStore ?? store).directory);
  try {
    const listen = (target: number) => new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(target, host, () => { server.off('error', reject); resolve(); });
    });
    try { await listen(port); }
    catch (error) {
      if (!options.fallbackIfPortBusy || !port || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      await listen(0);
    }
  } catch (error) { context.tracking?.close(); await context.studio?.close(); throw error; }
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const gateway = gatewayFor(store, context.tracking);
  gateway.account.options.track = record => context.tracking?.track('account_sign_in_result', record);
  // `node --test` runs use synthetic connectors; skip the real installation there. Closing the service stops an unfinished one.
  if (!process.env.NODE_TEST_CONTEXT) gateway.account.prefetch();
  const tick = () => {
    void renderNext(store, runtimeRoot, context.tracking).catch(error => console.error(error.message));
    void gateway.tick().catch(() => console.error('Model gateway queue could not be processed'));
    void transcriptsFor(store).tick().catch(() => console.error('Transcription queue could not be processed'));
  };
  const timer = setInterval(tick, 500); tick();
  return { server, get activeToolCalls() { return (context.phase1?.pending ?? 0) + assetConversations(store).pending; }, openProject: async (projectId: string) => openProject(store, context, origin, (await store.get()).revision, { projectId }, store.projectId), get studio() { return context.studio!; }, ensureStudio: context.ensureStudio,
    info: async () => ({ previewUrl: origin, studioUrl: context.studio?.alive() ? `${origin}/#project/${store.projectId}` : undefined, engine: 'hyperframes', ready: true, editorReady: Boolean(context.studio?.alive()), ffmpeg, revision: (await store.get()).revision, dataDirectory: store.directory, browserOpened: false, nativeRuntime: await nativeRuntimeStatus(pluginRoot), authoringGuide: path.join(runtimeRoot, 'node_modules/hyperframes/dist/skills/hyperframes/SKILL.md'), hyperframesCli: cliPath(runtimeRoot) }),
    close: async () => { clearInterval(timer); await closeTranscripts(store); await context.browser?.close(); await brandKitsFor(store.directory).close(); await gateway.close(); await assetConversations(store).close(); server.closeAllConnections(); server.close(); await context.studio?.close(); await closeTracking(context.tracking); } };
}
if (isMain(import.meta.url)) {
  try {
    if (sharedEditorEnabled) {
      const editor = await ensureEditor(sharedStore.directory);
      console.log(JSON.stringify(await editorRequest(editor, '/editor-api/preview', {}), null, 2));
    } else {
      const running = await startServer();
      console.log(`Motion + Hyperframes Studio: http://localhost:${process.env.PORT || 4180}`);
      const stop = async () => { stopCommands(); await running.close(); process.exit(0); };
      process.once('SIGTERM', stop); process.once('SIGINT', stop);
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
}
