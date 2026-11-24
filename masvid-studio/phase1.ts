import { dispatchGameTool } from './game-projects.ts';
import { ToolInputError } from './shared/tool-input-error.ts';
import { assetImportError, toolFailureFields } from './tracking/tool-fields.ts';
import { readProjectAssetNames } from './project-asset-names.ts';
import { namingLanguage, projectAssetKind, validateAssetDisplayName } from './shared/asset-names.ts';
import { projectArchive } from './project-archive.ts';
import { manageProject } from './project-management.ts';
import { probeLibraryMedia } from './gateway/asset-probe.ts';
import { isFontFilePath, prepareImportedFont } from './shared/import-font.ts';
import { publicToolName, legacyToolName, publicToolResult } from './shared/public-names.mjs';
import { requireNativeRuntime } from './scripts/npm-runtime.mjs';
import { recordDiagnostic } from './scripts/diagnostics.mjs';
import { mediaUse } from './gateway/media-use.ts';
import { assetOperation } from './gateway/asset-operations.ts';
import { transcriptOperation } from './gateway/transcript-operations.ts';
import { transcriptsFor } from './gateway/transcription.ts';
import { compositionCanvasSource } from './shared/composition-canvas.ts';
import { loadCanvasSourceOperations } from './shared/composition-canvas-source.ts';
import { loadCaptionSourceOperations } from './shared/transcript-captions.ts';
import { brandKitOperation } from './gateway/brand-kit-operation.ts';
import { brandKitsFor } from './gateway/brand-kits.ts';
import { AssetLibrary } from './gateway/asset-library.ts';
import { scenarioOperation, scenarioRunsFor } from './gateway/scenario-runs.ts';
import { designProjectsFor, dispatchDesignTool } from './design-projects.ts';
import { MAX_ASSET_BYTES, isAssetFileWithinLimit } from './shared/asset-limits.ts';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceStore, createBlankProject, projectPath, validateProjectTitle } from './workspace.ts';
import { templateCatalogFor } from './prism-templates.ts';
import { materializeTemplateGuide } from './gateway/template-guide.ts';
import { parseTemplateGuideDraft } from './shared/template-guide.ts';
import { isEditableTemplate } from './shared/catalog.ts';
import { getTemplate } from './template-catalog.ts';
import { execute, inspectProject, pluginRoot } from './hyperframes.ts';
import { verificationBinaries } from './scripts/verify-export.ts';
import { validateInstruction } from './shared/conversation.ts';
import { editorProjectIdFromPath } from './shared/spa-routes.ts';
import { sessionPath, templateLibraryPreview, providerSettingsPreview } from './shared/workspace-url.ts';
import { phase1Tools, validateInput } from './shared/phase1-tools.ts';
import { atomicJson, cloneFile, fileHash, jsonFile, ProjectVersions, recoverProjectTransactions } from './phase1-versions.ts';
import type { ContentVersion } from './phase1-versions.ts';
import { trackPhase1Result, trackingError, type OmTracking } from './shared/tracking.ts';
import type { HostContext } from './tracking/host.ts';
import { WorkRounds } from './inline-video.ts';
import { uuid } from './tracking/core.ts';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const metadataPath = 'motion-project.json', assetIndexPath = 'motion-assets.json';
const textExtensions = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.md', '.vtt', '.srt', '.glsl', '.vert', '.frag']);
const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
function canonical(value: any): any { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value; }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
/** A saved file and a live host panel are separate completion conditions. */
function previewHandoff(origin: string, target: { projectId: string; sessionId: string; revision: string; versionId: string }, presentation = 'foreground', display?: any, prepared = false, url?: string, hostTabId?: string) {
  const previewUrl = url ?? origin + sessionPath(target.sessionId, target.projectId, { embedded: true });
  const confirmed = display?.visibility === 'visible' && display.contentVerified === true;
  const background = presentation === 'background';
  const now = presentation === 'now';
  const onReturn = { tool: 'openmotion_open_preview', arguments: { projectId: target.projectId } };
  const deferred = !now && display?.visibility === 'queued';
  const recovery = now ? { when: 'hidden_after_queued_ack', tool: 'navigate_to_codex_page', scope: 'calling_chat_only',
    threadIdFrom: 'open_in_codex.response.threadId', then: 'present_same_tab_and_recheck_visibility' } :
    { when: 'calling_chat_confirmed_inactive', operation: 'wait_for_calling_chat', onReturn };
  return { ...target, previewUrl, placement: 'right', reuseExistingTab: true, presentation,
    focusPolicy: background ? 'background' : now ? 'switch_to_calling_chat' : 'preserve_current_chat',
    state: background ? 'background' : confirmed ? 'confirmed' : 'pending', openedByHost: confirmed,
    hostActionRequired: !background && !confirmed, confirmationSource: display ? 'host_reported' : null,
    nextAction: background || confirmed ? null : deferred ? { kind: 'host', operation: 'wait_for_calling_chat', onReturn } : prepared ? { kind: 'host', operation: 'present_preview',
      previewUrl, placement: 'right', reuseExistingTab: true, codex: { tool: 'open_in_codex', arguments: {
        placement: 'right', target: { type: 'browser', url: previewUrl, ...(hostTabId ? { tabId: hostTabId } : {}) } },
        tabIdentity: 'Validate any stored Tab ID against the current host inventory; reuse the actual native host Tab ID (providerTabId), never a CUA wrapper id. After presenting, rebind the matching native panel tab before observing visibility. A separate visible:false or browser-use: automation tab and markDeliverable do not satisfy presentation; if the native project tab is missing, retry the same host presentation once, then report the gap.',
        visibilitySync: { capability: 'visibility', method: 'set', value: true,
          when: 'after_binding_native_tab', scope: 'calling_chat_only', navigation: false },
        observation: { visibility: 'get', settleTimeoutMs: 6000, content: 'latest_live_preview', recheckVisibilityAfterContent: true },
        recovery } } : { kind: 'motion', tool: 'openmotion_open_preview', arguments: {
      projectId: target.projectId, expectedRevision: target.revision, expectedVersionId: target.versionId, presentation } },
    instructions: background ? 'Keep this edit in the background as explicitly requested by the user.' :
      (now ? 'The user explicitly requested immediate display for this turn; current-chat recovery may navigate to the calling chat. ' :
        'Preserve the current chat. Wait for return only when the host confirms the calling chat is inactive; queued acknowledgment or hidden panel alone does not establish inactivity. On return, prepare the latest project version rather than replaying an old version-bound action. ') +
      'For first delivery and continued edits, bind the native project tab and request Codex IAB visibility for the calling chat without navigation. Observe settled visibility and changed live content/time, recheck visibility, then record_display for the currently observed revision/version. Use visibility=queued only for confirmed inactive-chat deferral; otherwise record hidden or unavailable and report the display failure. Hidden-tab playback, markDeliverable and completed MP4 export do not complete editor delivery. Follow openmotion://workflow/production/native#continuing-edits.' };
}
function cursor(value: any) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function parseCursor(value: string | undefined, kind: string, scope: string) {
  if (!value) return null;
  try { const item = JSON.parse(Buffer.from(value, 'base64url').toString()); if (item.kind !== kind || item.scope !== scope || !Array.isArray(item.after) || item.after.length !== 2 || !Number.isSafeInteger(item.after[0]) || item.after[0] < 0 || typeof item.after[1] !== 'string' || !item.after[1]) throw 0; return item; }
  catch { throw new Error('INVALID_CURSOR: 游标不属于本次查询'); }
}
function tupleCompare(a: any[], b: any[]) { return a[0] === b[0] ? String(a[1]).localeCompare(String(b[1])) : a[0] - b[0]; }
export type Phase1Context = {
  origin: () => string; nativeUrl: (projectId: string) => string | undefined;
  openProject: (projectId: string) => Promise<void>;
  mutation: <T>(task: () => Promise<T>) => Promise<T>;
  cancel: (projectId: string, jobId: string) => Promise<unknown>;
  tracking?: OmTracking;
};

/** Thin public contract over the existing workspace, Studio history, probes and export engine. */
export class Phase1Service {
  private tail: Promise<unknown> = Promise.resolve();
  private recovered = false;
  pending = 0;
  readonly restoreErrors = new Map<string, { requestId: string; message: string }>();
  readonly store: WorkspaceStore;
  readonly runtimeRoot: string;
  readonly context: Phase1Context;
  constructor(store: WorkspaceStore, runtimeRoot: string, context: Phase1Context) { this.store = store; this.runtimeRoot = runtimeRoot; this.context = context; }
  versions(projectId: string) { return new ProjectVersions(this.store.forProject(projectId), this.runtimeRoot, this.context.nativeUrl(projectId)); }
  get workRounds() { return new WorkRounds(this.store, this.context.tracking); }
  async call(name: string, args: any, host?: HostContext, options?: { attributeEntry?: boolean }) {
    const requestedName = publicToolName(name);
    name = legacyToolName(name);
    try {
      const result = await this.invoke(name, args, host, requestedName, options);
      if (name === 'motion_restore_version') this.restoreErrors.delete(args.projectId);
      trackPhase1Result(this.context.tracking, name, args, result, undefined, host);
      return publicToolResult(result);
    } catch (error) {
      if (name === 'motion_restore_version' && errorText(error).startsWith('VERSION_NOT_RESTORABLE:')) {
        this.restoreErrors.set(args.projectId, { requestId: args.requestId, message: errorText(error) });
      }
      trackPhase1Result(this.context.tracking, name, args, undefined, error, host);
      if (this.context.tracking && args?.workId && name !== 'motion_export_cancel') {
        const work = await this.workRounds.get(args.projectId, args.workId).catch(() => null);
        this.context.tracking.track('host_run_failed', { run_id: args.workId, task_type: work?.mode ?? 'modify', error_code: trackingError(error), stage: name }, undefined, undefined, host);
        if (work?.state === 'failed') {
          this.context.tracking.track('host_state_changed', { run_id: args.workId, sequence: 2, state: 'failed', phase: name }, undefined, undefined, host);
        }
      }
      await recordDiagnostic(this.store.directory, { kind: 'mcp_failure', tool: name, requestId: args?.requestId,
        projectId: args?.projectId, message: errorText(error), stack: error instanceof Error ? error.stack : undefined });
      throw error;
    }
  }
  private async invoke(name: string, args: any, host?: HostContext, requestedName = publicToolName(name), options?: { attributeEntry?: boolean }) {
    const definition = phase1Tools.find(tool => tool.name === requestedName);
    if (!definition) throw new Error('MCP_TOOL_NOT_EXPOSED: ' + name);
    validateInput(definition.inputSchema, args);
    if (name === 'motion_open_preview' && args.entry !== undefined && args.target !== 'providers') {
      throw new ToolInputError('entry is only supported when target=providers', 'entry', 'invalid_combination');
    }
    if (name === 'motion_open_preview' && (args.target === 'templates' || args.target === 'providers')) {
      const allowed = args.target === 'providers' ? ['target', 'action', 'embedded', 'presentation', 'entry'] : ['target', 'action', 'embedded', 'presentation'];
      const unsupported = args.action && args.action !== 'open' ? 'action' : Object.keys(args).find(key => !allowed.includes(key));
      if (unsupported) throw new ToolInputError('workspace page opening does not accept project, session or version arguments', unsupported, 'invalid_combination');
      return args.target === 'providers'
        ? providerSettingsPreview(this.context.origin(), { ...args, attributeEntry: options?.attributeEntry })
        : templateLibraryPreview(this.context.origin(), args);
    }
    if (name === 'motion_list_templates') return templateCatalogFor(this.store.directory).index();
    if (name === 'motion_get_template') return templateCatalogFor(this.store.directory).detail(args.templateId);
    if (name === 'motion_list_skills') return templateCatalogFor(this.store.directory).skillIndex();
    if (name === 'motion_get_skill') return templateCatalogFor(this.store.directory).skillDetail(args.skillId);
    if (name === 'motion_get_project' && !args.projectId) return this.dispatch(name, args, host);
    const run = async () => {
      if (!this.recovered) { await recoverProjectTransactions(this.store, this.runtimeRoot); this.recovered = true; }
      const result = await this.dispatch(name, args, host);
      if (name === 'motion_edit_project' || name === 'motion_restore_version') {
        const owner = this.store.projectCatalog().sessions!.find(session => session.artifacts.some(artifact => artifact.projectId === args.projectId))!;
        result.previewHandoff = previewHandoff(this.context.origin(), { projectId: args.projectId, sessionId: owner.id,
          revision: result.revision, versionId: result.version.versionId }, args.presentation);
        if (args.workId && args.presentation !== 'now' && args.presentation !== 'background') {
          result.previewHandoff = { ...result.previewHandoff, state: 'deferred', hostActionRequired: false, nextAction: null,
            instructions: 'Production is still in progress. Keep the editor closed until the final authored video is complete and ready for preview. Then prepare and present the latest version with openmotion_open_preview; after MP4 export verification, use the host-native video preview first (Codex: one final-reply embed). Only if native preview is unavailable, use the discovered openmotion_show_video instead; never present the same export through both routes.' };
        }
      }
      return result;
    };
    this.pending++;
    const result = this.tail.then(run, run).finally(() => { this.pending--; }); this.tail = result.catch(() => {}); return result;
  }
  async writeRequest(name: string, args: any, task: (record: any) => Promise<any>) {
    if (!args.requestId) throw new ToolInputError('requestId is required', 'requestId', 'missing');
    const file = path.join(this.store.directory, 'phase1', 'requests', digest(args.requestId) + '.json');
    const inputHash = digest({ name, args });
    const previous = await jsonFile<any>(file, null);
    if (previous) {
      if (previous.inputHash !== inputHash) throw new Error('REQUEST_ID_CONFLICT: 相同 requestId 不能使用不同输入');
      if (previous.state === 'completed') return { ...previous.result, ...(previous.result.job ? { job: await this.publicJob(previous.result.job.id) } : {}), replayed: true };
      if (previous.state === 'failed') {
        const { code, invalid_field, validation_rule } = previous.failure ?? {};
        throw Object.assign(new Error(previous.error), { code, invalid_field, validation_rule, ...(previous.applied === false ? { applied: false } : {}) });
      }
      if (name === 'motion_open_preview' && args.action === 'complete_generation') {
        const work = await this.workRounds.get(args.projectId, args.workId);
        if (work.generation?.completionRequestId === args.requestId) {
          this.workRounds.emitGeneration(work);
          const result = { projectId: args.projectId, generation: work.generation };
          await atomicJson(file, { ...previous, state: 'completed', result }); return result;
        }
      }
      if (name === 'motion_open_preview' && args.action === 'begin' && previous.workId) {
        const project = await this.detail(args.projectId);
        const inlineWork = await this.workRounds.create(project, args.mode, previous.workId, args.generation !== false);
        const result = { projectId: project.projectId, sessionId: project.sessionId, authoringGuide: project.authoringGuide, inlineWork };
        await atomicJson(file, { ...previous, state: 'completed', result }); return result;
      }
      // A lost reply must not turn into a second write or render.
      if (args.projectId) {
        const index = await this.versions(args.projectId).index();
        const version = index.versions.find(item => item.requestId === args.requestId);
        if (version) {
          const versions = this.versions(args.projectId);
          const result = { projectId: args.projectId, version: await versions.withHistory(history => versions.publicVersion(version, history)), revision: version.revision, recovered: true };
          if (args.workId) await this.workRounds.observed(name, args, result);
          await atomicJson(file, { ...previous, state: 'completed', result }); return result;
        }
        for (const id of await readdir(path.join(this.store.directory, 'jobs')).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
          const job = await this.store.job(id).catch(() => null);
          if (job?.requestId === args.requestId && job.projectId === args.projectId) {
            const result = { projectId: args.projectId, job: await this.publicJob(job.id), recovered: true };
            if (args.workId) await this.workRounds.observed(name, args, result);
            await atomicJson(file, { ...previous, state: 'completed', result }); return result;
          }
        }
      }
      if (name === 'motion_create_project' && this.store.projectCatalog().projects.some(project => project.id === previous.projectId)) {
        const project = await this.detail(previous.projectId);
        const result = { ...project, recovered: true }; await atomicJson(file, { ...previous, state: 'completed', result }); return result;
      }
      throw new Error('REQUEST_STATE_UNKNOWN: 原请求未确认终态，未重复执行；请查询项目或任务状态');
    }
    if (name === 'motion_import_assets' && !args.items.every((item: any) => isFontFilePath(item.sourcePath))) await requireNativeRuntime(pluginRoot, 'media');
    if (name === 'motion_export_request' && args.action !== 'record_review') await requireNativeRuntime(pluginRoot, 'export');
    const record = { inputHash, name, state: 'pending', projectId: name === 'motion_create_project' ? crypto.randomUUID() : args.projectId,
      sessionId: args.sessionId ?? crypto.randomUUID(), createdAt: Date.now(),
      ...(name === 'motion_open_preview' && args.action === 'begin' ? { workId: crypto.randomUUID() } : {}) };
    await atomicJson(file, record);
    let result, workAccepted = false;
    try {
      if (args.workId) { await this.workRounds.writable(name, args); workAccepted = args.action !== 'complete_generation'; }
      result = await task(record);
      if (args.workId) await this.workRounds.observed(name, args, result);
    }
    catch (error) {
      if (workAccepted) await this.workRounds.failed(args.projectId, args.workId, errorText(error));
      const { error_code, ...validation } = toolFailureFields(error);
      await atomicJson(file, { ...record, state: 'failed', error: errorText(error), ...((error as any)?.applied === false ? { applied: false } : {}),
        ...(error_code !== 'TOOL_FAILED' ? { failure: { code: error_code, ...validation } } : {}) });
      throw error;
    }
    await atomicJson(file, { ...record, state: 'completed', result }); return result;
  }
  async completeGeneration(args: any) {
    const detail = await this.detail(args.projectId);
    if (detail.revision !== args.expectedRevision || detail.currentVersionId !== args.expectedVersionId)
      throw new Error('VERSION_CONFLICT');
    const work = await this.workRounds.get(args.projectId, args.workId);
    if (!work.generation) throw new Error('WORK_GENERATION_UNTRACKED: begin a new generation work round');
    if (work.generation.completedAt) {
      this.workRounds.emitGeneration(work);
      return work.generation;
    }
    const versions = await this.versions(args.projectId).index();
    const initial = versions.versions.find(v => v.versionId === work.generation?.initialVersionId);
    const current = versions.versions.find(v => v.versionId === detail.currentVersionId);
    const content = /\.(html|css|js|mjs|json|svg|mp4|webm|wav|mp3|png|jpg|jpeg)$/i;
    if (!initial || !current || !current.files.some(file => content.test(file.path) && ![metadataPath, assetIndexPath].includes(file.path)
        && initial.files.find(old => old.path === file.path)?.hash !== file.hash))
      throw new Error('GENERATION_CONTENT_UNCHANGED: complete the video artifact before reporting generation');
    const scoped = this.store.forProject(args.projectId);
    if ((await scoped.get()).revision !== detail.revision) throw new Error('VERSION_CONFLICT');
    const info = await inspectProject(this.runtimeRoot, scoped.projectDirectory, 'info');
    if (info.exitCode || !(info.result.duration > 0)) throw new Error('GENERATION_ARTIFACT_INVALID');
    const checked = await inspectProject(this.runtimeRoot, scoped.projectDirectory, 'lint');
    if (checked.exitCode) throw new Error('PROJECT_VALIDATION_FAILED: ' + JSON.stringify(checked.result));
    if ((await scoped.get()).revision !== detail.revision) throw new Error('VERSION_CONFLICT');
    return this.workRounds.generated(args.projectId, args.workId, current.versionId, current.versionNumber, detail.revision, args.requestId);
  }
  async publicJob(jobId: string) {
    const job = (await this.store.status(jobId)).exportJob;
    if (!job) throw new Error('EXPORT_NOT_FOUND');
    const { token, workerPid, trackingHost, ...safe } = job;
    return { ...safe, ...(job.state === 'completed' ? { path: path.join(this.store.directory, job.file!), downloadUrl: this.context.origin() + '/api/exports/' + job.id + '/file' } : {}) };
  }
  async detail(projectId: string, args: any = {}) {
    const versions = this.versions(projectId), scoped = versions.store;
    return versions.withHistory(async history => {
      const version = await versions.current(history), state = await scoped.get();
      if (args.expectedRevision && args.expectedRevision !== state.revision) throw new Error('VERSION_CONFLICT: 源码快照已变化');
      const meta = await jsonFile<any>(path.join(scoped.projectDirectory, metadataPath), {});
      const assets = await jsonFile<any[]>(path.join(scoped.projectDirectory, assetIndexPath), []);
      const owner = this.store.projectCatalog().sessions!.find(session => session.artifacts.some(artifact => artifact.projectId === projectId))!;
      let file;
      if (args.file) {
        const name = projectPath(args.file.path);
        if (!textExtensions.has(path.extname(name))) throw new Error('UNSUPPORTED_TEXT_TYPE');
        const handle = await open(await scoped.safePath(name), 'r');
        try {
          const size = (await handle.stat()).size, offset = args.file.offset ?? 0, length = args.file.length ?? 65536;
          if (offset > size) throw new Error('INVALID_FILE_OFFSET');
          const data = Buffer.alloc(Math.min(length + 4, size - offset));
          const { bytesRead } = await handle.read(data, 0, data.length, offset);
          if (bytesRead && (data[0] & 0xc0) === 0x80) throw new Error('INVALID_UTF8_OFFSET');
          let end = Math.min(length, bytesRead);
          while (end < bytesRead && end > 0 && (data[end] & 0xc0) === 0x80) end--;
          if (!end && bytesRead) throw new Error('READ_WINDOW_TOO_SMALL');
          file = { path: name, content: new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, end)), offset, bytes: end, totalBytes: size, nextOffset: offset + end < size ? offset + end : null };
        } finally { await handle.close(); }
      }
      const jobs = [];
      for (const id of await readdir(path.join(this.store.directory, 'jobs')).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
        const job = await this.store.job(id).catch(() => null);
        if (job?.projectId === projectId) jobs.push(job);
      }
      jobs.sort((a, b) => b.createdAt - a.createdAt);
      if (args.exportJobId && !jobs.some(job => job.id === args.exportJobId)) throw new Error('EXPORT_NOT_FOUND: 任务不属于该项目');
      const exportJob = args.exportJobId ? await this.publicJob(args.exportJobId) : jobs[0] ? await this.publicJob(jobs[0].id) : null;
      const assetNaming = await readProjectAssetNames(scoped, (state.project?.files ?? []).map(file => file.path), undefined, this.runtimeRoot);
      if ((await scoped.get()).revision !== state.revision) throw new Error('VERSION_CONFLICT: 读取期间工程已变化');
      return { projectId, sessionId: owner.id, project: state.project, revision: state.revision, version: await versions.publicVersion(version, history, true),
        currentVersionId: version.versionId, currentVersionNumber: version.versionNumber, dataDirectory: this.store.directory,
        hyperframesCli: path.join(this.runtimeRoot, 'node_modules/hyperframes/bin/hyperframes.mjs'), authoringGuide: path.join(this.runtimeRoot, 'node_modules/hyperframes/dist/skills/hyperframes/SKILL.md'),
        requirements: meta.requirements ?? (await scoped.conversation(projectId)).messages.map(message => message.content).join('\n'),
        ...assetNaming,
        projectType: meta.projectType ?? 'legacy', source: meta.source ?? null, assets, file, exportJob,
        previewDisplay: await this.previewDisplay(projectId, version),
        exports: jobs.map(({ token, workerPid, trackingHost, ...job }) => job), reviews: await jsonFile(path.join(this.store.directory, 'phase1', 'reviews', projectId + '.json'), []),
        limits: { textBatchFiles: 100, textBatchBytes: 8388608, textReadBytes: 2097152, assetBytes: MAX_ASSET_BYTES, attachmentTransport: 'local_path' } };
    }, 30_000);
  }
  async previewDisplay(projectId: string, version: ContentVersion) {
    const display = await jsonFile<any>(path.join(this.store.directory, 'phase1', 'preview-displays', projectId + '.json'), null);
    return display ? { ...display, isCurrentVersion: display.revision === version.revision && display.versionId === version.versionId,
      liveVisibilityVerified: false } : null;
  }
  async recordDisplay(args: any, detail: any) {
    const display = args.display;
    const target = new URL(this.context.origin() + sessionPath(detail.sessionId, detail.projectId, { embedded: true }));
    let observed: URL;
    try { observed = new URL(display.previewUrl); } catch { throw new Error('PREVIEW_TARGET_MISMATCH'); }
    const queryProject = observed.searchParams.get('project');
    const observedProject = editorProjectIdFromPath(observed.pathname) ?? queryProject;
    const validPath = observed.pathname === target.pathname || (observed.pathname === '/' && queryProject === detail.projectId);
    if (observed.origin !== target.origin || !validPath || observedProject !== detail.projectId ||
        (queryProject !== null && queryProject !== detail.projectId) ||
        observed.searchParams.get('session') !== detail.sessionId || observed.username || observed.password ||
        observed.hash.split('?')[0] !== target.hash) throw new Error('PREVIEW_TARGET_MISMATCH');
    const record = { ...display, projectId: detail.projectId, source: 'host_reported', requestId: args.requestId, recordedAt: Date.now() };
    await atomicJson(path.join(this.store.directory, 'phase1', 'preview-displays', detail.projectId + '.json'), record);
    const current = await this.detail(detail.projectId);
    if (current.revision !== detail.revision || current.currentVersionId !== detail.currentVersionId) throw new Error('VERSION_CONFLICT: content changed during display confirmation');
    // Evidence follows confirmation: a rejected display observed nothing, and delivery also needs the round's fixed version.
    if (args.workId && this.context.tracking) {
      const round = await this.workRounds.get(detail.projectId, args.workId).catch(() => null);
      this.context.tracking.track('host_preview_observed', { run_id: args.workId, project_id: detail.projectId, revision: detail.revision,
        version_id: detail.currentVersionId, visibility: display.visibility, content_verified: display.contentVerified, observation_source: 'host_reported' }, undefined, undefined, undefined);
      const checkId = crypto.randomUUID();
      this.context.tracking.track('check_required', { check_id: checkId, check_type: 'preview_observed', project_id: detail.projectId,
        version_id: detail.currentVersionId, subject_id: checkId.slice(0, 32), checklist_version: 'preview-v1', checker_type: 'host', required: true });
      this.context.tracking.track('check_completed', { check_id: checkId, check_type: 'preview_observed', project_id: detail.projectId,
        version_id: detail.currentVersionId, subject_id: checkId.slice(0, 32), checklist_version: 'preview-v1', checker_type: 'host',
        result: display.visibility === 'visible' && display.contentVerified ? 'pass' : 'unreviewed', evidence_ref: checkId.slice(0, 32) });
      if (display.visibility === 'visible' && display.contentVerified && display.versionId === detail.currentVersionId
        && round?.versionId === detail.currentVersionId) this.context.tracking.track('host_run_delivered', {
        run_id: args.workId, delivery_mode: 'preview', project_id: detail.projectId, revision: detail.revision, delivery_evidence_ref: checkId.slice(0, 32) });
    }
    return { projectId: detail.projectId, changed: false, previewHandoff: previewHandoff(this.context.origin(), {
      projectId: detail.projectId, sessionId: detail.sessionId, revision: detail.revision, versionId: detail.currentVersionId }, args.presentation, record, true, display.previewUrl, record.hostTabId), display: record };
  }
  async review(args: any, objectId?: string) {
    if (!args.review) throw new ToolInputError('review is required', 'review', 'missing');
    const review = args.review, index = await this.versions(args.projectId).index();
    if (!index.versions.some(version => version.versionId === review.versionId)) throw new Error('VERSION_NOT_FOUND');
    if (objectId && review.objectId !== objectId) throw new Error('REVIEW_OBJECT_MISMATCH');
    if (review.range && review.range.end < review.range.start) throw new Error('INVALID_REVIEW_RANGE');
    const file = path.join(this.store.directory, 'phase1', 'reviews', args.projectId + '.json');
    const reviews = await jsonFile<any[]>(file, []);
    const record = { ...review, projectId: args.projectId, requestId: args.requestId, createdAt: Date.now(), verifiedUserAdoption: false };
    reviews.push(record); await atomicJson(file, reviews);
    if (this.context.tracking) {
      const checkId = crypto.randomUUID(), versionId = review.versionId;
      this.context.tracking.track('check_required', { check_id: checkId, check_type: 'content_review', project_id: args.projectId,
        version_id: versionId, subject_id: digest(review.objectId).slice(0, 32), checklist_version: 'review-v1', checker_type: review.source === 'user' ? 'user' : 'agent', required: true });
      this.context.tracking.track('check_completed', { check_id: checkId, check_type: 'content_review', project_id: args.projectId,
        version_id: versionId, subject_id: digest(review.objectId).slice(0, 32), checklist_version: 'review-v1', checker_type: review.source === 'user' ? 'user' : 'agent',
        result: review.conclusion === 'passed' ? 'pass' : review.conclusion === 'failed' ? 'fail' : review.conclusion === 'unable_to_view' ? 'error' : 'unreviewed', evidence_ref: checkId.slice(0, 32) });
    }
    return { projectId: args.projectId, review: record, changed: false };
  }
  async dispatch(name: string, args: any, host?: HostContext): Promise<any> {
    if (name.startsWith('motion_game_')) return dispatchGameTool(name, args, this.store.directory, this.runtimeRoot);
    if (name === 'motion_design_catalog' || name === 'motion_design_project' || name === 'motion_design_edit' || name === 'motion_design_comments') {
      return dispatchDesignTool(name, args, this.store.directory, this.context.origin(), ref => new AssetLibrary(this.store).resolve(ref));
    }
    if (name === 'motion_manage_project') return manageProject(this.store, args, this.runtimeRoot);
    if (name === 'motion_project_archive') {
      const result = await projectArchive(this.store, args, this.runtimeRoot);
      return 'downloadUrl' in result ? { ...result, downloadUrl: new URL(result.downloadUrl, this.context.origin()).href } : result;
    }
    if (name === 'motion_assets') {
      if (args.action === 'brand_kit') return brandKitOperation(brandKitsFor(this.store.directory), args.brandKit, this.context.origin());
      if (args.action === 'scenario') {
        return scenarioOperation(scenarioRunsFor(this.store), args.scenario, {
          origin: () => this.context.origin(),
          assets: input => assetOperation(this.store, input, (i, o) => this.importAssets(i, o), this.context.tracking),
          design: designProjectsFor(this.store.directory),
          resolveAsset: ref => new AssetLibrary(this.store).resolve(ref),
          createMotionProject: input => this.dispatch('motion_create_project', input),
          exportMotionArchive: input => projectArchive(this.store, input, this.runtimeRoot),
        });
      }
      if (args.action === 'transcript') {
        const input = args.transcript;
        if (input.command === 'caption_tracks' || input.command === 'caption_export') {
          const { captionTracks, exportCaptionSource } = await loadCaptionSourceOperations(this.runtimeRoot);
          const scoped = this.versions(input.projectId).store, name = projectPath(input.compositionPath);
          if (!name.endsWith('.html')) throw new Error('Choose an HTML composition');
          const source = await readFile(await scoped.safePath(name), 'utf8');
          return input.command === 'caption_export'
            ? { projectId: input.projectId, compositionPath: name, ...exportCaptionSource(source, input.format, input.transcriptId) }
            : { tracks: captionTracks(source) };
        }
        if (!['captions', 'caption_update', 'caption_add', 'caption_toggle'].includes(input.command)) return transcriptOperation(this.store, input);
        return this.writeRequest('transcript_captions', input, () => this.context.mutation(() => this.store.lock(async () => {
          const versions = this.versions(input.projectId), scoped = versions.store;
          const name = projectPath(input.compositionPath);
          if (!name.endsWith('.html')) throw new Error('Choose an HTML composition');
          const file = await scoped.safePath(name), source = await readFile(file, 'utf8');
          const { manualCaptionSource, updateCaptionTrackSource, transcriptCaptionSource, toggleCaptionSource } = await loadCaptionSourceOperations(this.runtimeRoot);
          let captions;
          let trackId = ['caption_add', 'caption_toggle'].includes(input.command) ? crypto.randomUUID() : input.transcriptId;
          if (input.command === 'caption_toggle') {
            captions = toggleCaptionSource(source, trackId, input.visible); trackId = captions.trackId;
          } else if (input.command === 'caption_add') {
            captions = manualCaptionSource(source, trackId, input);
          } else if (input.command === 'caption_update') {
            if (!input.remove && !input.captionSettings) throw new Error('Supply caption settings or remove');
            captions = updateCaptionTrackSource(source, input.transcriptId, input.captionSettings || {}, input.remove);
          } else {
            const service = transcriptsFor(this.store), doc = await service.document(input.projectId, input.transcriptId);
            if (doc.revision !== input.expectedTranscriptRevision) throw new Error('TRANSCRIPT_CONFLICT: reload the latest transcript');
            await service.assertSource(doc.source);
            captions = transcriptCaptionSource(source, doc, input, input.captionSettings);
          }
          return versions.withHistory(async history => ({ projectId: input.projectId, trackId, captionCount: captions.count,
            ...await versions.transaction(history, input.expectedRevision, input.expectedVersionId, input.requestId,
              [{ path: name, content: captions.content }], { label: input.command === 'caption_toggle' ? (input.visible ? 'Enable captions' : 'Disable captions') : input.command === 'caption_add' ? (input.textKind === 'text' ? 'Add text' : 'Add captions') : input.command === 'caption_update' ? (input.remove ? 'Remove caption track' : 'Update caption track') : 'Apply transcript captions' }),
            changedFiles: [name], previewSync: this.context.nativeUrl(input.projectId) ? 'file_watcher_notified' : 'not_open' }));
        })));
      }
      return assetOperation(this.store, args, (input, options) => this.importAssets(input, options), this.context.tracking);
    }
    if (name === 'motion_media_use') return mediaUse(this.store, args, this.context.tracking);
    if (name === 'motion_get_project' && !args.projectId) {
      if (args.file || args.exportJobId || args.expectedRevision || args.workId || args.includeVideo) throw new ToolInputError('projectId is required for details', 'projectId', 'missing');
      const scope = (args.trashed ? 'trash:' : '') + (args.sessionId ?? 'workspace');
      const page = parseCursor(args.cursor, 'projects', scope);
      const catalog = this.store.projectCatalog();
      if (args.sessionId && !catalog.sessions!.some(session => session.id === args.sessionId)) throw new Error('SESSION_NOT_FOUND');
      const ids = args.sessionId ? new Set(catalog.sessions!.find(session => session.id === args.sessionId)!.artifacts.map(artifact => artifact.projectId)) : null;
      const all = [];
      for (const item of catalog.projects) {
        if (Boolean(item.trashedAt) !== Boolean(args.trashed)) continue;
        if (ids && !ids.has(item.id)) continue;
        if (args.trashed || await stat(path.join(this.store.projectDirectoryFor(item.id), 'index.html')).catch(() => null)) all.push(item);
      }
      all.sort((a, b) => -tupleCompare([a.createdAt ?? 0, a.id], [b.createdAt ?? 0, b.id]));
      const visible = all.filter(item => !page || tupleCompare([item.createdAt ?? 0, item.id], page.after) < 0);
      const projects = visible.slice(0, 5).map(item => ({ ...item, createdAt: item.createdAt ?? null,
        sessionId: catalog.sessions!.find(session => session.artifacts.some(artifact => artifact.projectId === item.id))!.id }));
      const last = projects.at(-1);
      return { dataDirectory: this.store.directory, projects, pageSize: 5, hasMore: visible.length > 5, nextCursor: visible.length > 5 ? cursor({ kind: 'projects', scope, after: [last!.createdAt ?? 0, last!.id] }) : null };
    }
    if (name === 'motion_get_project') {
      if (args.cursor || args.trashed !== undefined) throw new ToolInputError('cursor and trashed are for project lists', args.cursor ? 'cursor' : 'trashed', 'invalid_combination');
      if (args.sessionId && !this.store.projectCatalog().sessions!.some(session => session.id === args.sessionId && session.artifacts.some(artifact => artifact.projectId === args.projectId))) throw new Error('PROJECT_SESSION_MISMATCH');
      if (args.workId) {
        if (args.file || args.exportJobId || args.expectedRevision) throw new ToolInputError('workId cannot combine file or export queries', 'workId', 'invalid_combination');
        this.store.forProject(args.projectId);
        return { projectId: args.projectId, inlineWork: await this.workRounds.read(args.projectId, args.workId),
          ...(args.includeVideo ? { _inlineMedia: await this.workRounds.media(args.projectId, args.workId) } : {}) };
      }
      if (args.includeVideo) throw new ToolInputError('includeVideo requires workId', 'workId', 'missing');
      return this.detail(args.projectId, args);
    }
    if (name === 'motion_list_versions') {
      const versions = this.versions(args.projectId);
      return versions.withHistory(async history => {
        const index = await versions.sync(history), page = parseCursor(args.cursor, 'versions', args.projectId);
        const all = [...index.versions].reverse().filter(item => !page || item.versionNumber < page.after[0]);
        const shown = all.slice(0, 5), current = index.versions.at(-1)!;
        return { projectId: args.projectId, currentVersionId: current.versionId, currentVersionNumber: current.versionNumber,
          versions: await Promise.all(shown.map(async item => ({ ...await versions.publicVersion(item, history, true), isCurrent: item.versionId === current.versionId }))), pageSize: 5,
          hasMore: all.length > 5, nextCursor: all.length > 5 ? cursor({ kind: 'versions', scope: args.projectId, after: [shown.at(-1)!.versionNumber, shown.at(-1)!.versionId] }) : null };
      }, 30_000);
    }
    if (name === 'motion_create_project') return this.writeRequest(name, args, async record => {
      const directory = this.store.projectDirectoryFor(record.projectId);
      let registered = false;
      try {
        if (args.projectType === 'natural_language' && (args.templateId || args.referenceVideoId || args.referenceUrl) || args.projectType === 'template' && (args.referenceVideoId || args.referenceUrl) || args.projectType === 'reference_video' && (args.templateId || args.referenceVideoId && args.referenceUrl)) throw new ToolInputError('creation source must match projectType', 'projectType', 'invalid_combination');
        if (args.projectType === 'template' && !args.templateId || args.projectType === 'reference_video' && !args.referenceVideoId && !args.referenceUrl) throw new ToolInputError('creation source is required', args.projectType === 'template' ? 'templateId' : 'referenceVideoId', 'missing');
        const source = args.templateId ? await templateCatalogFor(this.store.directory).get(args.templateId) : args.referenceVideoId ? getTemplate(args.referenceVideoId) : null;
        const guideDraft = args.guideDraft === undefined ? undefined : parseTemplateGuideDraft(args.guideDraft);
        if (guideDraft && (args.projectType !== 'template' || !source)) throw new Error('INVALID_GUIDE_DRAFT: a catalog template is required');
        if (args.projectType === 'template' && (!source || !isEditableTemplate(source)) && !guideDraft) throw new Error('TEMPLATE_NOT_COPYABLE: 请在 Studio 选择可编辑原生模板；参考视频需由 Agent 重建');
        if (args.referenceUrl && !['https:', 'http:'].includes(new URL(args.referenceUrl).protocol)) throw new Error('INVALID_REFERENCE_URL');
        validateInstruction(args.requirements);
        const language = args.namingLanguage === undefined ? undefined : namingLanguage(args.namingLanguage);
        const title = validateProjectTitle(args.title);
        const appliedGuide = guideDraft ? await materializeTemplateGuide(templateCatalogFor(this.store.directory), source!.id, directory, this.runtimeRoot, guideDraft) : undefined;
        if (args.projectType === 'template' && !guideDraft) await templateCatalogFor(this.store.directory).copy(source!, directory, this.runtimeRoot);
        else if (!guideDraft) await createBlankProject(directory, this.runtimeRoot, title);
        const meta = { schemaVersion: 1, namingLanguage: language, projectType: args.projectType, requirements: args.requirements, creationRequestId: args.requestId,
          ...(appliedGuide ? { guideDraft: appliedGuide.draft } : {}),
          source: source ? { id: source.id, kind: source.kind, catalogVersion: 'catalogVersion' in source ? source.catalogVersion : undefined, previewUrl: source.previewUrl, sourceUrl: source.sourceUrl, ...appliedGuide?.source } : args.referenceUrl ? { url: args.referenceUrl, inspected: false } : null };
        await atomicJson(path.join(directory, metadataPath), meta);
        await atomicJson(path.join(directory, assetIndexPath), []);
        await this.store.lock(async () => {
          const catalog = this.store.projectCatalog();
          let session = args.sessionId ? catalog.sessions!.find(item => item.id === args.sessionId) : null;
          if (args.sessionId && !session) throw new Error('SESSION_NOT_FOUND');
          if (!session) {
            session = { id: record.sessionId, title, mode: 'motion', artifacts: [], createdAt: Date.now(), openedAt: Date.now() };
            catalog.sessions!.unshift(session);
            await atomicJson(path.join(this.store.directory, 'sessions', session.id + '.json'), { sessionId: session.id, messages: [{ id: crypto.randomUUID(), role: 'user', content: args.requirements, createdAt: Date.now() }] });
          }
          const project = { id: record.projectId, title, templateId: source?.id, createdAt: Date.now() };
          catalog.projects.unshift(project); session.artifacts.push({ id: crypto.randomUUID(), kind: 'motion-project', projectId: project.id, title, templateId: source?.id });
          session.activeArtifactId = session.artifacts.at(-1)!.id;
          const activeExists = await stat(path.join(this.store.projectDirectoryFor(catalog.activeId), 'index.html')).catch(() => null);
          if (!activeExists) { catalog.activeId = project.id; catalog.activeSessionId = session.id; }
          await atomicJson(path.join(this.store.directory, 'projects.json'), catalog); registered = true;
        });
        const detail = await this.detail(record.projectId);
        return { ...detail, created: true, previewUrl: this.context.origin() + sessionPath(detail.sessionId, detail.projectId, { embedded: true }), creationComplete: true, filmComplete: false };
      } catch (error) {
        if (!registered) {
          await rm(directory, { recursive: true, force: true });
          throw Object.assign(error instanceof Error ? error : new Error(errorText(error)), { applied: false });
        }
        throw error;
      }
    });
    if (name === 'motion_open_preview') {
      if (args.action === 'record_display') {
        if (!args.projectId || !args.display) throw new ToolInputError('projectId and display are required', !args.projectId ? 'projectId' : 'display', 'missing');
        const detail = await this.detail(args.projectId);
        if (args.display.revision !== detail.revision || args.display.versionId !== detail.currentVersionId) throw new Error('VERSION_CONFLICT: preview display refers to a different content version');
        return this.writeRequest(name, args, () => this.recordDisplay(args, detail));
      }
      if (args.action === 'begin') {
        if (!args.projectId || !args.mode) throw new ToolInputError('begin requires projectId and mode', !args.projectId ? 'projectId' : 'mode', 'missing');
        return this.writeRequest(name, args, async record => {
          const project = await this.detail(args.projectId);
          const inlineWork = await this.workRounds.create(project, args.mode, record.workId, args.generation !== false);
          if (this.context.tracking) {
            this.context.tracking.track('host_run_started', { run_id: inlineWork.id, entry_type: 'mcp', task_type: args.mode });
            this.context.tracking.track('host_state_changed', { run_id: inlineWork.id, sequence: 1, state: 'active', phase: 'authoring' });
          }
          return { projectId: project.projectId, sessionId: project.sessionId, authoringGuide: project.authoringGuide, inlineWork };
        });
      }
      if (args.action === 'complete_generation') {
        const missing = ['projectId', 'workId', 'expectedRevision', 'expectedVersionId'].find(key => !args[key]);
        if (missing) throw new ToolInputError('complete_generation requires projectId, workId and both version identities', missing, 'missing');
        return this.writeRequest(name, args, async () => ({
          projectId: args.projectId, generation: await this.completeGeneration(args),
        }));
      }
      if (args.action === 'record_review') {
        if (!args.projectId) throw new ToolInputError('projectId is required for review', 'projectId', 'missing');
        return this.writeRequest(name, args, () => this.review(args));
      }
      const catalog = this.store.projectCatalog();
      const session = args.sessionId ? catalog.sessions!.find(item => item.id === args.sessionId) : null;
      if (args.sessionId && !session) throw new Error('SESSION_NOT_FOUND');
      const projectId = args.projectId ?? session?.artifacts.find(item => item.id === session.activeArtifactId)?.projectId ?? session?.artifacts.at(-1)?.projectId;
      if (!projectId) throw new Error('PROJECT_NOT_BOUND: 请传入 projectId 或已绑定的 OpenMotion sessionId');
      const scoped = this.store.forProject(projectId);
      if (session && !session.artifacts.some(artifact => artifact.projectId === projectId)) throw new Error('PROJECT_SESSION_MISMATCH');
      const before = await this.detail(projectId);
      if (args.expectedRevision && args.expectedRevision !== before.revision || args.expectedVersionId && args.expectedVersionId !== before.currentVersionId) throw new Error('VERSION_CONFLICT');
      let stampedRevision = before.revision;
      if (args.expectedRevision || args.expectedVersionId) {
        const require = createRequire(path.join(this.runtimeRoot, 'package.json'));
        const parserManifest = require.resolve('@hyperframes/parsers/package.json');
        const parser = JSON.parse(await readFile(parserManifest, 'utf8'));
        const { stampHfIdsInPlace } = await import(pathToFileURL(path.join(path.dirname(parserManifest), parser.exports['./hf-ids'].import)).href);
        const files = await Promise.all((before.project?.files ?? []).map(async file => {
          if (!file.path.endsWith('.html')) return file;
          const source = await readFile(await scoped.safePath(file.path), 'utf8');
          if (digest(source) !== file.hash) throw new Error('VERSION_CONFLICT');
          if (!/data-composition-id\s*=/.test(source)) return file;
          const stamped = stampHfIdsInPlace(source);
          // The pinned native stamper writes only when the ID attribute count increases.
          if ((stamped.match(/\bdata-hf-id=/g) ?? []).length <= (source.match(/\bdata-hf-id=/g) ?? []).length) return file;
          return { ...file, hash: digest(stamped), size: Buffer.byteLength(stamped) };
        }));
        stampedRevision = scoped.revision(files);
      }
      const checked = await inspectProject(this.runtimeRoot, this.store.projectDirectoryFor(projectId), 'lint');
      if (checked.exitCode) throw new Error('PROJECT_VALIDATION_FAILED: ' + JSON.stringify(checked.result));
      await this.context.openProject(projectId);
      const detail = await this.detail(projectId);
      // Studio may add deterministic editor IDs; only that exact next-version change is compatible.
      const stamped = stampedRevision !== before.revision && detail.revision === stampedRevision && detail.currentVersionNumber === before.currentVersionNumber + 1;
      if (!stamped && (args.expectedRevision && args.expectedRevision !== detail.revision || args.expectedVersionId && args.expectedVersionId !== detail.currentVersionId)) throw new Error('VERSION_CONFLICT');
      return { ...detail, previewUrl: this.context.origin() + sessionPath(detail.sessionId, projectId, { embedded: args.embedded !== false }),
        sessionUrl: this.context.origin() + sessionPath(detail.sessionId, projectId), embeddedPreviewUrl: this.context.origin() + sessionPath(detail.sessionId, projectId, { embedded: true }),
        previewHandoff: previewHandoff(this.context.origin(), { projectId, sessionId: detail.sessionId, revision: detail.revision, versionId: detail.currentVersionId }, args.presentation, undefined, true,
          this.context.origin() + sessionPath(detail.sessionId, projectId, { embedded: args.embedded !== false }), detail.previewDisplay?.hostTabId),
        preflight: checked.result, openedByHost: false, selectionSource: args.projectId ? 'explicit_project' : 'bound_session' };
    }
    if (name === 'motion_edit_project') return this.writeRequest(name, args, () => this.context.mutation(() => this.store.lock(async () => {
      const versions = this.versions(args.projectId), scoped = versions.store;
      const names = new Set<string>(); let bytes = 0;
      for (const file of args.files ?? []) {
        projectPath(file.path);
        if (!textExtensions.has(path.extname(file.path)) || [metadataPath, assetIndexPath].includes(file.path)) throw new Error('INVALID_FILE_TYPE_OR_RESERVED_PATH');
        if (names.has(file.path)) throw new Error('DUPLICATE_FILE_PATH'); names.add(file.path); bytes += Buffer.byteLength(file.content);
      }
      if (bytes > 8388608) throw new Error('SOURCE_BATCH_TOO_LARGE: 8 MiB limit');
      const changes = [...(args.files ?? [])];
      let canvas;
      if (args.canvas) {
        const name = projectPath(args.canvas.compositionPath);
        if (!name.endsWith('.html') || names.has(name)) throw new Error('Supply one canvas edit per HTML composition without a competing file edit');
        const parsers = await loadCanvasSourceOperations(this.runtimeRoot);
        const result = compositionCanvasSource(await readFile(await scoped.safePath(name), 'utf8'), parsers, args.canvas);
        canvas = result.canvas; changes.push({ path: name, content: result.content });
      }
      if (args.files === undefined && !args.canvas && args.requirements === undefined && args.namingLanguage === undefined && !args.assetNames?.length) throw new Error('Supply files or canvas settings');
      if (args.requirements !== undefined || args.namingLanguage !== undefined) {
        if (args.requirements !== undefined) validateInstruction(args.requirements);
        const meta = await jsonFile<any>(path.join(scoped.projectDirectory, metadataPath), { schemaVersion: 1, projectType: 'legacy' });
        changes.push({ path: metadataPath, content: JSON.stringify({ ...meta, ...(args.requirements !== undefined ? { requirements: args.requirements } : {}), ...(args.namingLanguage !== undefined ? { namingLanguage: namingLanguage(args.namingLanguage) } : {}) }) });
      }
      if (args.assetNames?.length) {
        const records = await jsonFile<any[]>(path.join(scoped.projectDirectory, assetIndexPath), []);
        const renamed = new Set<string>();
        for (const item of args.assetNames) {
          const assetPath = projectPath(item.path);
          if (renamed.has(assetPath)) throw new Error('DUPLICATE_ASSET_PATH');
          renamed.add(assetPath);
          const displayName = validateAssetDisplayName(item.name);
          const file = await stat(await scoped.safePath(assetPath));
          if (!file.isFile() || projectAssetKind(assetPath) < 0) throw new Error('INVALID_ASSET_PATH');
          const record = records.find(asset => asset.path === assetPath);
          if (record) Object.assign(record, { originalName: record.originalName ?? record.name ?? path.basename(assetPath), name: displayName, nameSource: 'user' });
          else records.push({ path: assetPath, originalName: path.basename(assetPath), name: displayName, nameSource: 'user' });
        }
        changes.push({ path: assetIndexPath, content: JSON.stringify(records) });
      }
      return versions.withHistory(async history => ({ projectId: args.projectId,
        ...await versions.transaction(history, args.expectedRevision, args.expectedVersionId, args.requestId, changes, { label: args.summary ?? 'Agent source edit' }),
        ...(canvas ? { canvas } : {}), ...await readProjectAssetNames(scoped, undefined, undefined, this.runtimeRoot), changedFiles: changes.map(file => file.path), previewSync: this.context.nativeUrl(args.projectId) ? 'file_watcher_notified' : 'not_open' }));
    })));
    if (name === 'motion_restore_version') return this.writeRequest(name, args, () => this.context.mutation(() => this.store.lock(async () => {
      const versions = this.versions(args.projectId);
      return versions.withHistory(async history => {
        const index = await versions.sync(history), target = index.versions.find(version => version.versionId === args.versionId);
        if (!target) throw new Error('VERSION_NOT_FOUND');
        return { projectId: args.projectId, restoredFromVersionId: target.versionId,
          ...await versions.restore(history, target, args.expectedRevision, args.expectedVersionId, args.requestId),
          previewSync: this.context.nativeUrl(args.projectId) ? 'file_watcher_notified' : 'not_open' };
      });
    })));
    if (name === 'motion_import_assets') return this.importAssets(args);
    if (name === 'motion_export_cancel') return this.writeRequest(name, args, async () => ({
      projectId: args.projectId, job: await this.context.cancel(args.projectId, args.jobId),
    }));
    if (name === 'motion_export_request') return this.writeRequest(name, args, async () => {
      if (args.action === 'record_review') {
        if (!args.jobId) throw new ToolInputError('jobId is required', 'jobId', 'missing');
        const job = await this.store.job(args.jobId);
        if (!job || job.projectId !== args.projectId || job.state !== 'completed') throw new Error('EXPORT_NOT_COMPLETED');
        if (args.review?.versionId !== job.versionId) throw new Error('REVIEW_VERSION_MISMATCH');
        return this.review(args, job.id);
      }
      if (!args.versionId || !args.expectedRevision) throw new ToolInputError('versionId and expectedRevision are required', !args.versionId ? 'versionId' : 'expectedRevision', 'missing');
      const detail = await this.detail(args.projectId);
      if (detail.currentVersionId !== args.versionId || detail.revision !== args.expectedRevision) throw new Error('VERSION_CONFLICT');
      const job = await this.store.forProject(args.projectId).requestExport(args.expectedRevision, { phase1: true, versionId: args.versionId, requestId: args.requestId, workId: args.workId, audio: args.audio, compositionPath: args.compositionPath,
        trackingHost: this.context.tracking?.enabled() ? host : undefined });
      if (this.context.tracking) {
        this.context.tracking.track('task_accepted', { task_id: job.id, task_type: 'export', project_id: args.projectId,
          ...(args.workId ? { run_id: args.workId } : {}), ...(args.requestId && uuid.test(args.requestId) ? { operation_id: args.requestId } : {}),
          accepted_at: new Date(job.acceptedAt ?? job.createdAt).toISOString(), deadline_at: new Date(job.deadlineAt ?? job.expiresAt).toISOString() });
        const checkId = job.id;
        this.context.tracking.track('check_required', { check_id: checkId, check_type: 'technical_export', project_id: args.projectId,
          version_id: args.versionId, subject_id: job.id, checklist_version: 'export-v1', checker_type: 'automated', required: true });
      }
      return { projectId: args.projectId, job: { ...job, token: undefined, workerPid: undefined, trackingHost: undefined }, technicalVerification: 'automatic_after_render', contentReview: 'pending' };
    });
    throw new Error('MCP_TOOL_NOT_EXPOSED: ' + name);
  }
  async importAssets(args: any, options?: { receiptName: string; reusePinnedContent: boolean }) {
    // A library's mutable display name must not change an immutable-version
    // import's retry identity, including receipts written before display naming.
    const requestArgs = options ? { ...args, items: args.items.map((item: any) => ({ ...item, name: options.receiptName })) } : args;
    return this.writeRequest('motion_import_assets', requestArgs, async () => {
      const versions = this.versions(args.projectId), scoped = versions.store;
      const existing = await jsonFile<any[]>(path.join(scoped.projectDirectory, assetIndexPath), []);
      const items: any[] = [], changes: any[] = [], added: any[] = [];
      const staging = path.join(this.store.directory, 'phase1', 'import-' + crypto.randomUUID());
      await mkdir(staging, { recursive: true });
      try {
        const itemIds = new Set<string>();
        for (const item of args.items) {
          if (itemIds.has(item.itemId)) throw new Error('DUPLICATE_ITEM_ID'); itemIds.add(item.itemId);
          try {
            const inputHash = digest(item), prior = existing.find(asset => asset.itemId === item.itemId);
            if (prior) {
              if (prior.inputHash !== inputHash && !(options?.reusePinnedContent && item.expectedSha256 && prior.sha256 === item.expectedSha256)) throw new Error('ITEM_ID_CONFLICT');
              if (!await stat(path.join(scoped.projectDirectory, prior.path)).catch(() => null)) throw new Error('ASSET_NOT_IN_CURRENT_VERSION: 请恢复对应版本或使用新 itemId 重新导入');
              if (item.expectedSha256 && await fileHash(path.join(scoped.projectDirectory, prior.path)) !== item.expectedSha256) throw new Error('ASSET_CONTENT_CHANGED: the imported copy no longer matches the pinned library version');
              items.push({ ...prior, status: 'completed', reused: true }); continue;
            }
            if (!path.isAbsolute(item.sourcePath)) throw new Error('ATTACHMENT_NOT_READABLE: 需要本机实际绝对路径');
            const info = await stat(item.sourcePath);
            if (!isAssetFileWithinLimit(info)) throw new Error('ASSET_TOO_LARGE_OR_NOT_FILE: max 500 MB (500000000 bytes)');
            const staged = path.join(staging, crypto.randomUUID()); await cloneFile(item.sourcePath, staged);
            if (!isAssetFileWithinLimit(await stat(staged))) throw new Error('ASSET_TOO_LARGE_OR_NOT_FILE: max 500 MB (500000000 bytes)');
            const sha256 = await fileHash(staged);
            if (item.expectedSha256 && sha256 !== item.expectedSha256) throw new Error('ASSET_CONTENT_CHANGED: library bytes no longer match this version');
            if (isFontFilePath(item.sourcePath)) {
              const assetId = crypto.randomUUID();
              const prepared = await prepareImportedFont(staged, item.licensePath, assetId, staging, this.runtimeRoot, item.sourcePath);
              const { changes: fontChanges, ...metadata } = prepared;
              const asset = { itemId: item.itemId, assetId, inputHash, ...metadata, size: (await stat(staged)).size,
                sha256: await fileHash(staged), originalName: path.basename(item.sourcePath), name: item.name?.trim() ? validateAssetDisplayName(item.name) : path.basename(item.sourcePath) };
              changes.push(...fontChanges); added.push(asset); items.push({ ...asset, status: 'completed' }); continue;
            }
            if (item.licensePath) throw new Error('FONT_LICENSE_REQUIRES_FONT');
            const media = await probeLibraryMedia(staged).catch(error => { throw new Error('INVALID_MEDIA: ' + errorText(error)); });
            const assetId = crypto.randomUUID(), relative = 'assets/imported/' + assetId + '.' + media.extension;
            const asset = { itemId: item.itemId, assetId, inputHash, path: relative, mimeType: media.mimeType, size: media.bytes,
              sha256, width: media.width, height: media.height, duration: media.duration, originalName: path.basename(item.sourcePath), name: item.name?.trim() ? validateAssetDisplayName(item.name) : path.basename(item.sourcePath) };
            changes.push({ path: relative, source: staged }); added.push(asset); items.push({ ...asset, status: 'completed' });
          } catch (error) { items.push({ itemId: item.itemId, status: 'failed', error: errorText(error), error_code: assetImportError(error) }); }
        }
        let saved: any = null;
        if (added.length) saved = await this.context.mutation(() => this.store.lock(() => versions.withHistory(async history => {
          const current = await versions.current(history);
          if (digest(await jsonFile(path.join(scoped.projectDirectory, assetIndexPath), [])) !== digest(existing)) throw new Error('VERSION_CONFLICT: 素材索引在导入时变化');
          changes.push({ path: assetIndexPath, content: JSON.stringify([...existing, ...added]) });
          return versions.transaction(history, current.revision, current.versionId, args.requestId, changes, { label: 'Import ' + added.length + ' assets' });
        })));
        return { projectId: args.projectId, status: items.every(item => item.status === 'completed') ? 'completed' : items.some(item => item.status === 'completed') ? 'partial' : 'failed', items, ...saved, appliedToTimeline: false };
      } finally { await rm(staging, { recursive: true, force: true }); }
    });
  }
}
