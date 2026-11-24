import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { WorkspaceStore } from '../workspace.ts';
import type { TranscriptDocument, TranscriptSegment, TranscriptSource, TranscriptionJob } from '../shared/transcript.ts';
import { validateSegments } from '../shared/transcript.ts';
import { ProviderConnections } from './connections.ts';
import { AssetLibrary } from './asset-library.ts';
import { requireLibraryMediaRuntime } from './asset-probe.ts';
import { readSettings, writeSettings } from './settings-storage.ts';
import { TRANSCRIPTION_CHUNK_SECONDS, transcribeAudio, transcriptionParameters } from './transcription-provider.ts';
import type { Fetcher } from './network.ts';
import { execute } from '../hyperframes.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id = (value: unknown): string => { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new Error('Invalid transcript identity'); return value; };
const requestId = (value: unknown): string => { if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(value)) throw new Error('A stable requestId is required'); return value; };
const alive = (pid?: number) => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };
type Options = { fetcher?: Fetcher };

export class TranscriptionService {
  readonly store: WorkspaceStore;
  readonly connections: ProviderConnections;
  readonly root: string;
  private running = new Map<string, AbortController>();
  private ticking = false;
  private closed = false;
  private pending?: Promise<void>;
  private options: Options;
  constructor(store: WorkspaceStore, options: Options = {}) {
    this.options = options;
    this.store = store.workspaceStore ?? store; this.connections = new ProviderConnections(this.store, options.fetcher);
    this.root = path.join(store.directory, 'transcripts');
  }
  private jobFile(jobId: string) { return path.join(this.root, 'jobs', id(jobId), 'job.json'); }
  private async cleanScratch(jobId: string) {
    const folder = path.dirname(this.jobFile(jobId));
    await Promise.all(['source', 'audio.wav'].map(file => rm(path.join(folder, file), { force: true })));
  }
  private docFile(docId: string, revision?: number) { return path.join(this.root, 'documents', id(docId), revision === undefined ? 'current.json' : `${revision}.json`); }
  private async ids(folder: string) { return (await readdir(path.join(this.root, folder)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })).filter(value => /^[a-f0-9-]{36}$/.test(value)); }
  async models() {
    const [providers, models, defaults, overrides] = await Promise.all([this.connections.list(), this.connections.models(), this.connections.defaults(), this.connections.modelOverrides()]);
    return { models: models.filter(model => model.kind === 'transcription' && model.enabled && providers.some(provider => provider.id === model.provider && provider.protocol === 'openai' && provider.available))
      .map(model => ({ ...model, ...overrides[model.id] })), defaultModel: defaults.transcription ?? null };
  }
  async sources(projectId: string) {
    const scoped = this.store.forProject(projectId);
    return { sources: (await scoped.files()).filter(file => /\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac|mpeg)$/i.test(file.path)).map(file => ({ path: file.path, bytes: file.size, sha256: file.hash })) };
  }
  async document(projectId: string, docId: string, revision?: number) {
    this.store.forProject(projectId);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('Invalid transcript revision');
    const doc = await readSettings<TranscriptDocument | null>(this.docFile(docId, revision), null);
    if (!doc || doc.source.projectId !== projectId) throw new Error('TRANSCRIPT_NOT_FOUND');
    return doc;
  }
  async job(projectId: string, jobId: string) {
    this.store.forProject(projectId);
    const job = await readSettings<TranscriptionJob | null>(this.jobFile(jobId), null);
    if (!job || job.projectId !== projectId) throw new Error('TRANSCRIPTION_JOB_NOT_FOUND');
    return job;
  }
  async list(projectId: string) {
    this.store.forProject(projectId);
    const [documents, jobs] = await Promise.all([
      Promise.all((await this.ids('documents')).map(docId => readSettings<TranscriptDocument | null>(this.docFile(docId), null))),
      Promise.all((await this.ids('jobs')).map(jobId => readSettings<TranscriptionJob | null>(this.jobFile(jobId), null))),
    ]);
    return { documents: documents.filter((doc): doc is TranscriptDocument => doc?.source.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt).map(({ original, segments, ...doc }) => ({ ...doc, segmentCount: segments.length })),
      jobs: jobs.filter((job): job is TranscriptionJob => job?.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100) };
  }
  async assertSource(source: TranscriptSource) {
    const scoped = this.store.forProject(source.projectId), filename = await scoped.safePath(source.path);
    const info = await scoped.fileInfo(filename);
    if (info.hash !== source.sha256 || info.size !== source.bytes) throw new Error('TRANSCRIPT_SOURCE_CHANGED: transcribe the current media before using its timings');
    return filename;
  }
  private async snapshot(projectId: string, sourcePath: string) {
    const scoped = this.store.forProject(projectId);
    const prepared = await new AssetLibrary(this.store).prepare(await scoped.safePath(sourcePath));
    // Browser MediaRecorder WebM streams often omit container duration. Decode
    // their first audio track to measure it; never invent duration from bytes.
    if (['audio', 'video'].includes(prepared.media.modality) && !prepared.media.duration) {
      try {
        const { ffmpeg } = await requireLibraryMediaRuntime();
        const result = await execute(ffmpeg, ['-v', 'error', '-nostdin', '-i', prepared.file, '-map', '0:a:0', '-t', '21601', '-vn', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], scoped.projectDirectory, 240_000);
        const elapsed = [...result.stdout.matchAll(/^out_time_us=(\d+)$/gm)].at(-1)?.[1];
        if (result.code || !elapsed) throw new Error('Transcription source has no readable audio track');
        prepared.media.duration = Number(elapsed) / 1_000_000;
      } catch (error) { await rm(prepared.file, { force: true }); throw error; }
    }
    if (!['audio', 'video'].includes(prepared.media.modality) || !prepared.media.duration || prepared.media.duration > 21600) {
      await rm(prepared.file, { force: true }); throw new Error('Choose audio or video with a duration of up to six hours');
    }
    return { prepared, source: { projectId, path: sourcePath, sha256: prepared.sha256, bytes: prepared.bytes, duration: prepared.media.duration } };
  }
  async submit(input: { projectId: string; sourcePath: string; requestId: string; model?: string; language?: string; parameters?: Record<string, unknown> }) {
    requestId(input.requestId); this.store.forProject(input.projectId);
    const fingerprint = hash(input), receipt = path.join(this.root, 'requests', hash(input.requestId) + '.json');
    const previous = await readSettings<{ hash: string; jobId: string } | null>(receipt, null);
    if (previous) { if (previous.hash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT'); return this.job(input.projectId, previous.jobId); }
    if (input.language !== undefined && !/^(auto|[a-z]{2,3})$/.test(input.language)) throw new Error('Choose an ISO language code or auto');
    const catalog = await this.models(), model = catalog.models.find(item => item.id === (input.model ?? catalog.defaultModel));
    if (!model) throw new Error('Configure an enabled transcription model in Settings > Model providers');
    const provider = (await this.connections.list()).find(item => item.id === model.provider)!;
    const parameters = transcriptionParameters(model.modelId, model.defaults, input.parameters);
    await requireLibraryMediaRuntime();
    const { prepared, source } = await this.snapshot(input.projectId, input.sourcePath);
    try {
      return await this.store.lock(async () => {
        const existing = await readSettings<{ hash: string; jobId: string } | null>(receipt, null);
        if (existing) { if (existing.hash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT'); return this.job(input.projectId, existing.jobId); }
        // Recover an interrupted receipt write without resubmitting paid work.
        for (const jobId of await this.ids('jobs')) {
          const saved = await readSettings<TranscriptionJob | null>(this.jobFile(jobId), null);
          if (saved?.requestId !== input.requestId) continue;
          if (saved.requestHash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT');
          await writeSettings(receipt, { hash: fingerprint, jobId }); return saved;
        }
        const job: TranscriptionJob = { id: randomUUID(), requestId: input.requestId, requestHash: fingerprint, projectId: input.projectId, source,
          model: model.id, provider: model.provider, providerRevision: await this.connections.identity(model.provider), baseUrl: provider.baseUrl,
          parameters, language: input.language, state: 'queued', phase: 'Queued', createdAt: Date.now(), updatedAt: Date.now(), completedChunks: 0,
          totalChunks: Math.ceil(source.duration / TRANSCRIPTION_CHUNK_SECONDS) };
        const folder = path.dirname(this.jobFile(job.id)); await mkdir(folder, { recursive: true, mode: 0o700 });
        await copyFile(prepared.file, path.join(folder, 'source'));
        await writeSettings(this.jobFile(job.id), job);
        await writeSettings(receipt, { hash: fingerprint, jobId: job.id }); return job;
      });
    } finally { await rm(prepared.file, { force: true }); }
  }
  private async persist(doc: TranscriptDocument) { await writeSettings(this.docFile(doc.id, doc.revision), doc); await writeSettings(this.docFile(doc.id), doc); return doc; }
  async import(input: { projectId: string; sourcePath: string; requestId: string; segments: TranscriptSegment[]; language?: string }) {
    requestId(input.requestId); const segments = validateSegments(input.segments), fingerprint = hash(input);
    if (input.language !== undefined && !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(input.language)) throw new Error('Invalid transcript language');
    const receipt = path.join(this.root, 'imports', hash(input.requestId) + '.json');
    const previous = await readSettings<{ hash: string; id: string } | null>(receipt, null);
    if (previous) { if (previous.hash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT'); return this.document(input.projectId, previous.id); }
    const { prepared, source } = await this.snapshot(input.projectId, input.sourcePath);
    await rm(prepared.file, { force: true });
    if (segments.some(segment => (segment.end ?? 0) > source.duration + 0.1)) throw new Error('Subtitle timestamps exceed the source duration');
    return this.store.lock(async () => {
      const existing = await readSettings<{ hash: string; id: string } | null>(receipt, null);
      if (existing) { if (existing.hash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT'); return this.document(input.projectId, existing.id); }
      const doc = await this.persist({ id: randomUUID(), source, revision: 1, language: input.language, createdAt: Date.now(), updatedAt: Date.now(), segments, original: segments });
      await writeSettings(receipt, { hash: fingerprint, id: doc.id }); return doc;
    });
  }
  async update(input: { projectId: string; transcriptId: string; expectedRevision: number; requestId: string; segments: TranscriptSegment[] }) {
    requestId(input.requestId); const segments = validateSegments(input.segments), fingerprint = hash(input);
    return this.store.lock(async () => {
      const receipt = path.join(this.root, 'edits', hash(input.requestId) + '.json');
      const previous = await readSettings<{ hash: string; revision: number } | null>(receipt, null);
      if (previous) { if (previous.hash !== fingerprint) throw new Error('REQUEST_ID_CONFLICT'); return this.document(input.projectId, input.transcriptId, previous.revision); }
      const doc = await this.document(input.projectId, input.transcriptId);
      if (doc.revision !== input.expectedRevision) throw new Error('TRANSCRIPT_CONFLICT: reload the latest transcript before saving');
      if (segments.some(segment => (segment.end ?? 0) > doc.source.duration + 0.1)) throw new Error('Transcript timestamps exceed the source duration');
      const updated = await this.persist({ ...doc, segments, revision: doc.revision + 1, updatedAt: Date.now() });
      await writeSettings(receipt, { hash: fingerprint, revision: updated.revision }); return updated;
    });
  }
  async cancel(projectId: string, jobId: string) {
    return this.store.lock(async () => {
      const job = await this.job(projectId, jobId);
      if (['queued', 'running'].includes(job.state)) {
        job.state = 'cancelled'; job.phase = 'Cancelled locally; provider processing may continue'; job.updatedAt = Date.now();
        await writeSettings(this.jobFile(jobId), job); this.running.get(jobId)?.abort();
        if (!this.running.has(jobId)) await this.cleanScratch(jobId);
      }
      return job;
    });
  }
  async tick() {
    if (this.closed || this.ticking || this.running.size) return;
    this.ticking = true;
    try {
      const candidates = await this.ids('jobs');
      const pending = await Promise.all(candidates.map(jobId => readSettings<TranscriptionJob | null>(this.jobFile(jobId), null)));
      if (!pending.some(job => job && ['queued', 'running'].includes(job.state))) return;
      const job = await this.store.lock(async () => {
        const queued: TranscriptionJob[] = [];
        for (const jobId of candidates) {
          const current = await readSettings<TranscriptionJob | null>(this.jobFile(jobId), null);
          if (!current) continue;
          if (current.state === 'running' && !alive(current.workerPid)) {
            await this.cleanScratch(jobId);
            await writeSettings(this.jobFile(jobId), { ...current, state: 'failed', phase: 'Interrupted', error: 'The worker stopped. No provider request was retried.', updatedAt: Date.now() });
            continue;
          }
          if (current.state === 'running') return;
          if (current.state === 'queued') queued.push(current);
        }
        if (this.closed) return;
        const current = queued.sort((a, b) => a.createdAt - b.createdAt)[0]; if (!current) return;
        current.state = 'running'; current.workerPid = process.pid; current.phase = 'Preparing audio'; current.updatedAt = Date.now();
        await writeSettings(this.jobFile(current.id), current); return current;
      });
      if (job) { this.pending = this.run(job); await this.pending; }
    } finally { this.ticking = false; }
  }
  private async patch(job: TranscriptionJob, change: Partial<TranscriptionJob>) {
    return this.store.lock(async () => {
      const current = await this.job(job.projectId, job.id);
      if (current.state === 'cancelled') throw new Error('Cancelled');
      Object.assign(job, change, { updatedAt: Date.now() }); await writeSettings(this.jobFile(job.id), job);
    });
  }
  private async run(job: TranscriptionJob) {
    const controller = new AbortController(); this.running.set(job.id, controller);
    if (this.closed) controller.abort();
    const folder = path.dirname(this.jobFile(job.id));
    try {
      const provider = (await this.connections.list()).find(item => item.id === job.provider);
      if (!provider?.available || provider.baseUrl !== job.baseUrl || await this.connections.identity(job.provider) !== job.providerRevision) throw new Error('Provider settings changed; review the configuration before starting a new transcription');
      if (!(await this.models()).models.some(model => model.id === job.model)) throw new Error('Transcription model is disabled or unavailable');
      await this.assertSource(job.source);
      const key = await this.connections.credential(job.provider);
      const source = path.join(folder, 'source');
      const info = await this.store.fileInfo(source);
      if (info.hash !== job.source.sha256 || info.size !== job.source.bytes) throw new Error('Transcription source snapshot changed');
      const { ffmpeg } = await requireLibraryMediaRuntime();
      const segments: TranscriptSegment[] = [];
      for (let chunk = 0; chunk < job.totalChunks; chunk++) {
        controller.signal.throwIfAborted();
        const current = await this.job(job.projectId, job.id); if (current.state === 'cancelled') throw new Error('Cancelled');
        const offset = chunk * TRANSCRIPTION_CHUNK_SECONDS, duration = Math.min(TRANSCRIPTION_CHUNK_SECONDS, job.source.duration - offset);
        const file = path.join(folder, 'audio.wav');
        await this.patch(job, { phase: 'Preparing audio' });
        await extractAudio(ffmpeg, source, file, offset, duration, controller.signal);
        await this.patch(job, { phase: 'Transcribing' });
        const result = await transcribeAudio({ file, modelId: job.model.slice(job.provider.length + 1), baseUrl: job.baseUrl, key, parameters: job.parameters, language: job.language, offset, duration, signal: controller.signal }, this.options.fetcher);
        result.forEach(segment => segments.push({ ...segment, id: `segment-${segments.length + 1}` }));
        await writeSettings(path.join(folder, `chunk-${chunk}.json`), result);
        await this.patch(job, { completedChunks: chunk + 1 });
      }
      controller.signal.throwIfAborted();
      await this.store.lock(async () => {
        if ((await this.job(job.projectId, job.id)).state === 'cancelled') return;
        const validated = validateSegments(segments);
        const doc = await this.persist({ id: job.id, source: job.source, revision: 1, model: job.model, language: job.language, createdAt: Date.now(), updatedAt: Date.now(), segments: validated, original: validated });
        await writeSettings(this.jobFile(job.id), { ...job, state: 'completed', phase: segments.length ? 'Completed' : 'No speech detected', transcriptId: doc.id, updatedAt: Date.now() });
      });
    } catch (error) {
      await this.store.lock(async () => {
        const current = await this.job(job.projectId, job.id);
        if (current.state === 'cancelled') return;
        // Provider bodies/credentials never enter errors. Only our bounded public messages are persisted.
        const message = error instanceof Error && /^(Transcription|Provider|Choose|Configure|TRANSCRIPT_|The worker|This model|Invalid|Unsupported|Cancelled)/.test(error.message) ? error.message.slice(0, 500) : 'Transcription failed. Check the source audio, provider connection and model settings. No request was retried.';
        await writeSettings(this.jobFile(job.id), { ...current, state: 'failed', phase: 'Failed', error: message, updatedAt: Date.now() });
      });
    } finally { this.running.delete(job.id); await this.cleanScratch(job.id); }
  }
  async close() { this.closed = true; for (const controller of this.running.values()) controller.abort(); await this.pending; }
}

async function extractAudio(ffmpeg: string, source: string, file: string, start: number, duration: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(start), '-i', source, '-map', '0:a:0', '-t', String(duration), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-y', file], { stdio: 'ignore', signal, timeout: 120_000 });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error('Transcription source has no readable audio track')));
  });
  if ((await stat(file)).size <= 44) throw new Error('Transcription source has no audio samples');
}
const services = new Map<string, TranscriptionService>();
export function transcriptsFor(store: WorkspaceStore, options?: Options) { let service = services.get(store.directory); if (!service) { service = new TranscriptionService(store, options); services.set(store.directory, service); } return service; }
export async function closeTranscripts(store: WorkspaceStore) { const service = services.get(store.directory); await service?.close(); services.delete(store.directory); }
