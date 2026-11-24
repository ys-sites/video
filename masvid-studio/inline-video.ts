import path from 'node:path';
import { lstat, readFile, readdir, mkdir, rename, rm } from 'node:fs/promises';
import { atomicJson, jsonFile, fileHash } from './phase1-versions.ts';
import { createHash } from 'node:crypto';
import type { WorkspaceStore } from './workspace.ts';
import { execute } from './hyperframes.ts';
import { withProcessLock } from './shared/process-lock.ts';
import { deviceContext } from './tracking/core.ts';
import type { OmTracking } from './shared/tracking.ts';
import { verificationBinaries } from './scripts/verify-export.ts';

/**
 * Codex's MCP stdio transport discards any message line above 16 MiB (rmcp max_line_length=16777216),
 * so the call never completes and the host waits indefinitely. Base64 grows bytes by 4/3, so films above
 * 8 MiB play a re-encoded preview (at most ~10.7 MiB on the wire); the verified export is unchanged.
 */
export const inlineEmbedBytes = 8 * 1024 * 1024;
const previewVersion = 'h264-aac-v1';
const previewBudgetMs = 45_000;
const pending = new Map<string, Promise<Buffer>>();
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Bytes for the chat player: the verified file when small enough, otherwise a cached, validated H.264/AAC preview bound to that file. */
export async function inlinePlaybackBytes(source: string, sourceSha256: string, cacheFile: string, cwd: string, limit = inlineEmbedBytes): Promise<Buffer> {
  const info = await lstat(source);
  if (!info.isFile() || info.isSymbolicLink() || !info.size) throw new Error('INLINE_MEDIA_UNAVAILABLE');
  if (info.size <= limit) {
    const bytes = await readFile(source);
    if (sha(bytes) !== sourceSha256) throw new Error('INLINE_MEDIA_CHANGED');
    return bytes;
  }
  const key = `${cacheFile}|${sourceSha256}|${limit}`;
  let task = pending.get(key);
  if (!task) { task = preparePreview(source, sourceSha256, cacheFile, cwd, limit).finally(() => pending.delete(key)); pending.set(key, task); }
  return task;
}

async function cachedPreview(cacheFile: string, sourceSha256: string, limit: number) {
  const meta = await jsonFile<{ version?: string; source?: string; limit?: number; preview?: string } | null>(cacheFile + '.json', null).catch(() => null);
  if (!meta || meta.version !== previewVersion || meta.source !== sourceSha256 || meta.limit !== limit) return null;
  const info = await lstat(cacheFile).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || !info.size || info.size > limit) return null;
  const bytes = await readFile(cacheFile);
  return sha(bytes) === meta.preview ? bytes : null;
}

async function decodable(file: string, cwd: string) {
  const probe = await execute(verificationBinaries().ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], cwd, 15_000).catch(() => null);
  if (!probe || probe.code) return false;
  try {
    const data = JSON.parse(probe.stdout);
    return data.streams?.some((stream: any) => stream.codec_type === 'video') && Number(data.format?.duration) > 0;
  } catch { return false; }
}

async function preparePreview(source: string, sourceSha256: string, cacheFile: string, cwd: string, limit: number) {
  const cached = await cachedPreview(cacheFile, sourceSha256, limit);
  if (cached) return cached;
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const deadline = Date.now() + previewBudgetMs;
  for (const [height, crf] of [[720, 28], [540, 33], [360, 38]]) {
    const remaining = deadline - Date.now();
    if (remaining < 2_000) break;
    const temp = `${cacheFile}.${crypto.randomUUID()}.mp4`;
    try {
      const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?',
        '-vf', `scale=-2:'min(${height},ih)'`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', temp], cwd, remaining).catch(() => ({ code: 1 }));
      if (result.code) continue;
      const made = await lstat(temp).catch(() => null);
      if (!made?.isFile() || !made.size || made.size > limit || !(await decodable(temp, cwd))) continue;
      // The preview must come from the verified bytes, not a file replaced while encoding.
      if (await fileHash(source) !== sourceSha256) throw new Error('INLINE_MEDIA_CHANGED');
      const bytes = await readFile(temp);
      await rename(temp, cacheFile);
      await atomicJson(cacheFile + '.json', { version: previewVersion, source: sourceSha256, limit, preview: sha(bytes) });
      return bytes;
    } finally { await rm(temp, { force: true }); }
  }
  throw new Error('INLINE_MEDIA_UNAVAILABLE: a chat playback preview could not be prepared; give the user the verified MP4 file instead');
}
function verified(value: unknown): { sha256: string } | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Record<string, unknown>;
  return report.status === 'passed' && typeof report.sha256 === 'string' && /^[a-f0-9]{64}$/.test(report.sha256)
    ? { sha256: report.sha256 } : null;
}
export type WorkRound = {
  id: string; projectId: string; title: string; mode: 'create' | 'modify';
  createdAt: number; updatedAt: number; versionId: string; versionNumber: number; revision: string;
  generation?: { initialVersionId: string; startedAt: number; telemetryEligible: boolean; completionRequestId?: string; completedAt?: number;
    versionId?: string; revision?: string; editedAt?: number; exportedAt?: number; exportRoute?: 'mcp' | 'studio' };
  state: 'authoring' | 'saved' | 'failed'; error?: string; jobId?: string; previousJobId?: string;
};

/** The recorded mode of a work round, or undefined when no readable round is recorded. */
export async function workRoundMode(store: WorkspaceStore, projectId: string | undefined, id: string | undefined): Promise<WorkRound['mode'] | undefined> {
  if (!projectId || !id) return undefined;
  try { return (await new WorkRounds(store).get(projectId, id)).mode; } catch { return undefined; }
}

/** Work identity is separate from the native content version and export identity. */
export class WorkRounds {
  readonly store: WorkspaceStore;
  readonly tracking?: OmTracking;
  constructor(store: WorkspaceStore, tracking?: OmTracking) { this.store = store; this.tracking = tracking; }
  emitGeneration(work: WorkRound) {
    const generation = work.generation;
    if (!generation?.telemetryEligible || !this.tracking?.enabled()) return;
    for (const [stage, stamp] of [['started', generation.startedAt], ['generated', generation.completedAt], ['edited', generation.editedAt], ['exported', generation.exportedAt]] as const) {
      if (stamp === undefined) continue;
      // A retry retains both the occurrence time and the receiver's deduplication key.
      const hex = createHash('sha256').update(work.id + '/' + stage).digest('hex');
      const eventId = [hex.slice(0, 8), hex.slice(8, 12), '4' + hex.slice(13, 16),
        '8' + hex.slice(17, 20), hex.slice(20, 32)].join('-');
      this.tracking.ingest({ event: 'work_generation_stage', event_id: eventId, occurred_at: new Date(stamp).toISOString(),
        entrypoint: stage === 'exported' || stage === 'edited' ? 'worker' : 'mcp', ...deviceContext(),
        properties: { work_id: work.id, project_id: work.projectId, stage, task_type: work.mode,
          ...(stage !== 'started' ? { version_id: generation.versionId!, revision: generation.revision! } : {}),
          ...(stage === 'exported' ? { export_route: generation.exportRoute! } : {}) } });
    }
  }
  async generated(projectId: string, id: string, versionId: string, versionNumber: number, revision: string, requestId: string) {
    return withProcessLock(this.file(id) + '.lock', async () => {
      const work = await this.get(projectId, id);
      if (!work.generation) throw new Error('WORK_GENERATION_UNTRACKED: begin a new work round');
      if (!work.generation.completedAt) {
        if (work.state === 'failed' || work.jobId) throw new Error('WORK_CLOSED');
        Object.assign(work, { versionId, versionNumber, revision, state: 'saved' });
        Object.assign(work.generation, { completedAt: Date.now(), versionId, revision, completionRequestId: requestId,
          telemetryEligible: work.generation.telemetryEligible && this.tracking?.enabled() === true });
        await atomicJson(this.file(id), work);
      }
      this.emitGeneration(work);
      return work.generation;
    });
  }
  async exported(projectId: string, id: string, route: 'mcp' | 'studio') {
    return withProcessLock(this.file(id) + '.lock', async () => {
      const work = await this.get(projectId, id);
      if (!work.generation?.completedAt) return;
      if (!work.generation.exportedAt) {
        Object.assign(work.generation, { exportedAt: Date.now(), exportRoute: route,
          telemetryEligible: work.generation.telemetryEligible && this.tracking?.enabled() === true });
        await atomicJson(this.file(id), work);
      }
      this.emitGeneration(work);
    });
  }
  async studioEdited(event: { event: string; occurred_at: string; properties: Record<string, unknown> }) {
    const p = event.properties;
    if (!['studio_edit_result', 'studio_history_step_result'].includes(event.event) || p.outcome !== 'success') return;
    if (event.event === 'studio_edit_result' && ['project_rename', 'asset_rename', 'asset_delete'].includes(String(p.edit_kind))) return;
    if (typeof p.project_id !== 'string') return;
    const at = Date.parse(event.occurred_at);
    const work = await this.latestGenerated(p.project_id, at);
    if (!work) return;
    return withProcessLock(this.file(work.id) + '.lock', async () => {
      const current = await this.get(work.projectId, work.id);
      if (!current.generation!.editedAt) {
        current.generation!.editedAt = at;
        current.generation!.telemetryEligible &&= this.tracking?.enabled() === true;
        await atomicJson(this.file(work.id), current);
      }
      this.emitGeneration(current);
    });
  }
  async latestGenerated(projectId: string, at = Date.now()) {
    const files = await readdir(path.join(this.store.directory, 'phase1', 'work')).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
    const rounds: WorkRound[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const round = await jsonFile<WorkRound | null>(path.join(this.store.directory, 'phase1', 'work', file), null);
      if (round?.projectId === projectId && round.generation && round.createdAt <= at) rounds.push(round);
    }
    rounds.sort((a,b) => b.createdAt - a.createdAt);
    const latest = rounds[0];
    return latest?.generation?.completedAt && latest.generation.completedAt <= at ? latest : undefined;
  }
  file(id: string) {
    if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('INVALID_WORK_ID');
    return path.join(this.store.directory, 'phase1', 'work', id + '.json');
  }
  async create(project: any, mode: WorkRound['mode'], id = crypto.randomUUID(), generation = true) {
    const existing = await jsonFile<WorkRound | null>(this.file(id), null);
    if (existing) {
      if (existing.projectId !== project.projectId || existing.mode !== mode) throw new Error('WORK_ID_CONFLICT');
      this.emitGeneration(existing);
      return this.read(project.projectId, id);
    }
    const round: WorkRound = { id, projectId: project.projectId,
      title: this.store.projectCatalog().projects.find(item => item.id === project.projectId)!.title,
      mode, createdAt: Date.now(), updatedAt: Date.now(), versionId: project.currentVersionId,
      versionNumber: project.currentVersionNumber, revision: project.revision, state: 'authoring',
      previousJobId: project.exports.find((job: any) => job.state === 'completed' && verified(job.verification))?.id };
    if (generation) round.generation = { initialVersionId: project.currentVersionId, startedAt: round.createdAt, telemetryEligible: this.tracking?.enabled() === true };
    await atomicJson(this.file(round.id), round);
    this.emitGeneration(round);
    return this.read(project.projectId, round.id);
  }
  async get(projectId: string, id: string) {
    const work = await jsonFile<WorkRound | null>(this.file(id), null);
    if (!work || work.projectId !== projectId) throw new Error('WORK_NOT_FOUND: 本轮工作不属于该工程');
    return work;
  }
  async writable(name: string, args: any) {
    const work = await this.get(args.projectId, args.workId);
    if (work.jobId || work.state === 'failed') throw new Error('WORK_CLOSED: 请为新一轮制作建立新的视频框');
    if (name === 'motion_export_request' && (args.action === 'record_review' || args.versionId !== work.versionId || args.expectedRevision !== work.revision))
      throw new Error('WORK_VERSION_MISMATCH: 只可播放本轮实际保存的版本');
  }
  async observed(name: string, args: any, result: any) {
    return withProcessLock(this.file(args.workId) + '.lock', async () => {
      const work = await this.get(args.projectId, args.workId);
      if (name === 'motion_edit_project') {
        if (result.version.versionNumber < work.versionNumber) return;
        if (work.jobId) {
          if (work.versionId === result.version.versionId && work.revision === result.revision) return;
          throw new Error('WORK_CLOSED: 已提交轮次不能重新绑定内容');
        }
        if (work.state !== 'failed') work.state = 'saved';
        work.versionId = result.version.versionId;
        work.versionNumber = result.version.versionNumber; work.revision = result.revision;
      } else if (name === 'motion_export_request') {
        if (result.job.versionId !== work.versionId || result.job.revision !== work.revision || work.jobId && work.jobId !== result.job.id)
          throw new Error('WORK_VERSION_MISMATCH: 渲染记录不属于本轮固定版本');
        if (work.jobId === result.job.id) return;
        work.jobId = result.job.id;
      }
      work.updatedAt = Date.now(); await atomicJson(this.file(work.id), work);
    });
  }
  async failed(projectId: string, id: string, error: string) {
    return withProcessLock(this.file(id) + '.lock', async () => {
      const work = await this.get(projectId, id);
      if (work.jobId) return; // A lost reply does not undo an actually queued render.
      work.state = 'failed'; work.error = error; work.updatedAt = Date.now();
      await atomicJson(this.file(id), work);
    });
  }
  async read(projectId: string, id: string) {
    const work = await this.get(projectId, id);
    let state: string = work.state, error = work.error, updatedAt = work.updatedAt, playable = false, videoBytes: number | undefined, sha256: string | undefined;
    if (work.jobId) {
      const job = (await this.store.forProject(projectId).status(work.jobId)).exportJob;
      if (!job || job.versionId !== work.versionId || job.revision !== work.revision) { state = 'failed'; error = '本轮关联的渲染任务不可用'; }
      else {
        state = job.state === 'pending' ? 'queued' : job.state === 'running' ? job.stage ?? 'rendering' : job.state;
        error = job.error;
        updatedAt = (await lstat(path.join(this.store.directory, 'jobs', job.id, 'job.json'))).mtimeMs;
        if (job.state === 'completed') {
          try {
            const file = await lstat(await this.videoFile(job.id)); videoBytes = file.size;
            if (!file.isFile() || file.isSymbolicLink() || !file.size) throw new Error('视频文件不可用');
            const verification = verified(job.verification);
            if (!verification) throw new Error('视频尚无通过的技术校验');
            sha256 = verification.sha256;
            if (!sha256 || await fileHash(await this.videoFile(job.id)) !== sha256) throw new Error('视频文件与已校验版本不一致');
            playable = true;
          } catch (reason) { state = 'unavailable'; error = (reason as Error).message; }
        }
      }
    } else if (state !== 'failed' && Date.now() - work.updatedAt > 120_000) state = 'unconfirmed';
    return { ...work, state, error, updatedAt, playable, videoBytes, sha256 };
  }
  async videoFile(jobId: string) {
    if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('INVALID_JOB_ID');
    const job = await this.store.job(jobId);
    if (!job) throw new Error('EXPORT_NOT_FOUND');
    const file = this.store.exportPath(job);
    const relative = path.relative(path.join(this.store.directory, 'exports'), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('INVALID_EXPORT_PATH');
    return file;
  }
  async media(projectId: string, id: string) {
    const view = await this.read(projectId, id), media: { video?: string; poster?: string } = {};
    const posterId = view.playable ? view.jobId : view.previousJobId;
    if (posterId) {
      const job = (await this.store.forProject(projectId).status(posterId)).exportJob;
      if (job?.projectId === projectId && job.state === 'completed' && verified(job.verification)) {
        try {
          const source = await lstat(await this.videoFile(posterId));
          if (!source.isFile() || source.isSymbolicLink()) throw new Error('媒体不可用');
          if (await fileHash(await this.videoFile(posterId)) !== verified(job.verification)!.sha256) throw new Error('封面来源已变化');
          const file = path.join(this.store.directory, 'phase1', 'inline-posters', posterId + '.jpg');
          if (!(await lstat(file).catch(() => null))) {
            await mkdir(path.dirname(file), { recursive: true });
            const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-y', '-i', await this.videoFile(posterId), '-frames:v', '1', '-vf', 'scale=min(960\\,iw):-2', file], this.store.directory, 10_000);
            if (result.code) throw new Error('封面不可用');
          }
          const poster = await lstat(file);
          if (poster.isFile() && !poster.isSymbolicLink() && poster.size <= 2 * 1024 * 1024)
            media.poster = 'data:image/jpeg;base64,' + (await readFile(file)).toString('base64');
        } catch { /* A missing optional cover never reports the film as ready. */ }
      }
    }
    if (view.playable) {
      const source = await this.videoFile(view.jobId!);
      const cache = path.join(this.store.directory, 'phase1', 'inline-previews', `${view.jobId}-${view.sha256}.mp4`);
      media.video = 'data:video/mp4;base64,' + (await inlinePlaybackBytes(source, view.sha256!, cache, this.store.directory)).toString('base64');
    }
    return media;
  }
}
