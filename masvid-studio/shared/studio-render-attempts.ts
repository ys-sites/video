import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderFilenameStem } from './render-name.ts';

export type StudioRenderStatus = 'rendering' | 'cancelling' | 'complete' | 'failed' | 'cancelled' | 'unknown';
export type StudioRenderAttempt = {
  id: string;
  nativeJobId?: string;
  requestId?: string;
  workId?: string;
  filename: string;
  createdAt: number;
  status: StudioRenderStatus;
  progress: number;
  stage?: string;
  error?: string;
  durationMs?: number;
  audioLoweredDb?: number;
  lastCheckedAt?: number;
  settings?: Record<string, unknown>;
  /** Current host activity, independent of whether the result is known. */
  workerActive?: boolean;
  fileAvailable: boolean;
  size?: number;
};
type FileIdentity = { dev: number; ino: number; birthtimeMs: number; size: number; mtimeMs: number };
type SavedAttempt = Omit<StudioRenderAttempt, 'fileAvailable' | 'size' | 'workerActive'> & { fileIdentity?: FileIdentity | null };
type NativeState = { status: string; progress: number; stage?: string; error?: string; durationMs?: number; audioLoweredDb?: number; cancel?: () => void };
type RenderOptions = { jobId: string; outputPath: string; [key: string]: any };
const extensions = ['.mp4', '.mov', '.webm', '.gif'];
const terminal = new Set(['complete', 'failed', 'cancelled']);
const statuses = new Set(['rendering', 'cancelling', 'complete', 'failed', 'cancelled', 'unknown']);
const safeId = (value: unknown): value is string => typeof value === 'string' && !!value && !/[\/\\\x00]/.test(value) && value !== '.' && value !== '..';
const safeFilename = (value: unknown): value is string => safeId(value) && extensions.includes(path.extname(value).toLowerCase());
const fileStat = (filename: string) => lstatSync(filename, { throwIfNoEntry: false });

export class StudioRenderBusy extends Error {
  readonly code = 'EXPORT_BUSY';
  constructor() { super('An export is already in progress. Check the original task.'); this.name = 'StudioRenderBusy'; }
}

/** Reconcile native worker facts without creating or restarting render work. */
export class StudioRenderAttempts {
  readonly directory: string;
  private readonly snapshot: string;
  private readonly saved = new Map<string, SavedAttempt>();
  private readonly live = new Map<string, NativeState>();
  // Native jobs outlive deletion in the pinned host's private Map.
  private readonly deleted = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  private needsSave = false;
  private readonly notifying = new Map<string, Promise<void>>();
  private readonly notified = new Set<string>();
  private readonly onComplete?: (attempt: StudioRenderAttempt) => Promise<void>;

  constructor(projectDirectory: string, onComplete?: (attempt: StudioRenderAttempt) => Promise<void>) {
    this.onComplete = onComplete;
    this.directory = path.join(projectDirectory, 'renders');
    this.snapshot = path.join(this.directory, '.openmotion-render-attempts.json');
    this.checkDirectory();
    const stat = fileStat(this.snapshot);
    if (!stat) return;
    if (!stat.isFile()) throw new Error('Invalid Studio render attempts file');
    const snapshot = JSON.parse(readFileSync(this.snapshot, 'utf8'));
    if (snapshot.version !== 1 || !Array.isArray(snapshot.attempts)) throw new Error('Invalid Studio render attempts file');
    for (const attempt of snapshot.attempts) {
      if (!safeId(attempt.id) || attempt.nativeJobId !== attempt.id || !safeFilename(attempt.filename)
        || !Number.isFinite(attempt.createdAt) || !statuses.has(attempt.status)
        || !Number.isFinite(attempt.progress) || this.saved.has(attempt.id)) throw new Error('Invalid Studio render attempt');
      this.saved.set(attempt.id, attempt);
    }
  }

  private checkDirectory() {
    const directory = fileStat(this.directory);
    if (directory && !directory.isDirectory()) throw new Error('Invalid Studio renders directory');
  }

  private persist() {
    this.needsSave = true;
    this.checkDirectory();
    mkdirSync(this.directory, { recursive: true });
    const current = fileStat(this.snapshot);
    if (current && !current.isFile()) throw new Error('Invalid Studio render attempts file');
    const temporary = path.join(this.directory, '.openmotion-render-attempts-' + randomUUID() + '.tmp');
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, attempts: [...this.saved.values()] }), { flag: 'wx', mode: 0o600 });
      renameSync(temporary, this.snapshot);
      this.needsSave = false;
    } finally { if (fileStat(temporary)) unlinkSync(temporary); }
  }

  hasActiveWorker(): boolean {
    this.reconcile();
    return [...this.live.values()].some(state => !terminal.has(state.status));
  }

  start<T extends NativeState>(options: RenderOptions, title: string | undefined, startRender: (options: RenderOptions) => T, requestId?: string, workId?: string): { state: T; attempt: StudioRenderAttempt } {
    if (this.hasActiveWorker()) throw new StudioRenderBusy();
    if (!safeId(options.jobId) || this.saved.has(options.jobId) || this.deleted.has(options.jobId)) throw new Error('Render attempt identity already exists or is invalid');
    this.checkDirectory();
    mkdirSync(this.directory, { recursive: true });
    const extension = path.extname(options.outputPath);
    if (!extensions.includes(extension)) throw new Error('Invalid render output format');
    const base = renderFilenameStem(title);
    const occupied = new Set([...this.saved.values()].map(attempt => path.parse(attempt.filename).name));
    for (let n = 0; ; n++) {
      const stem = n ? base + ' (' + n + ')' : base;
      if (occupied.has(stem) || extensions.some(ext => fileStat(path.join(this.directory, stem + ext)))) continue;
      const metadata = path.join(this.directory, stem + '.meta.json');
      try { writeFileSync(metadata, '{}', { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
      const filename = stem + extension;
      const settings = Object.fromEntries(['format', 'fps', 'quality', 'composition', 'gifLoop', 'videoCodec', 'pixelFormat', 'crf', 'videoBitrate', 'audioBitrate', 'pageMotionBlur']
        .filter(key => options[key] !== undefined).map(key => [key, options[key]]));
      if (options.outputResolution !== undefined) settings.resolution = options.outputResolution;
      settings.gpu = options.useGpu === true;
      const attempt: SavedAttempt = { id: options.jobId, nativeJobId: options.jobId, ...(requestId ? { requestId } : {}), ...(workId ? { workId } : {}), filename, createdAt: Date.now(), status: 'rendering', progress: 0, settings };
      this.saved.set(attempt.id, attempt);
      let started = false;
      try {
        // Persist acceptance before the native worker can change its mutable state.
        this.persist();
        const state = startRender({ ...options, outputPath: path.join(this.directory, filename) });
        started = true;
        this.live.set(attempt.id, state);
        this.refresh(attempt);
        this.persist();
        this.notifyComplete(attempt);
        if (!this.timer) {
          this.timer = setInterval(() => {
            try { this.reconcile(); } catch { /* A later explicit read surfaces storage errors without changing the worker outcome. */ }
          }, 500);
          this.timer.unref();
        }
        return { state, attempt: this.present(attempt) };
      } catch (error) {
        // A worker that already started must remain discoverable even if a later save fails.
        if (!started) {
          this.saved.delete(attempt.id);
          try { this.persist(); } finally { if (fileStat(metadata)) unlinkSync(metadata); }
        }
        throw error;
      }
    }
  }

  private refresh(attempt: SavedAttempt) {
    const state = this.live.get(attempt.id);
    if (!state) {
      if (attempt.status === 'rendering' || attempt.status === 'cancelling') attempt.status = 'unknown';
      return;
    }
    if (terminal.has(state.status)) attempt.status = state.status as StudioRenderStatus;
    else if (state.status === 'rendering' && attempt.status !== 'cancelling') attempt.status = 'rendering';
    if (Number.isFinite(state.progress)) attempt.progress = state.progress;
    if (state.stage !== undefined) attempt.stage = state.stage;
    if (state.error !== undefined) attempt.error = state.error;
    if (state.durationMs !== undefined) attempt.durationMs = state.durationMs;
    if (state.audioLoweredDb !== undefined) attempt.audioLoweredDb = state.audioLoweredDb;
    attempt.lastCheckedAt = Date.now();
    if (attempt.status === 'complete') {
      const file = fileStat(path.join(this.directory, attempt.filename));
      if (attempt.fileIdentity === undefined) attempt.fileIdentity = file?.isFile()
        ? { dev: file.dev, ino: file.ino, birthtimeMs: file.birthtimeMs, size: file.size, mtimeMs: file.mtimeMs } : null;
      const metadata = path.join(this.directory, path.parse(attempt.filename).name + '.meta.json');
      if (fileStat(metadata)?.isFile()) {
        try {
          const meta = JSON.parse(readFileSync(metadata, 'utf8'));
          if (Number.isFinite(meta.durationMs)) attempt.durationMs = meta.durationMs;
          if (Number.isFinite(meta.audioLoweredDb)) attempt.audioLoweredDb = meta.audioLoweredDb;
        } catch { /* Missing or unfinished native metadata does not override the worker's terminal fact. */ }
      }
    }
    if (terminal.has(state.status)) this.live.delete(attempt.id);
  }

  private notifyComplete(attempt: SavedAttempt) {
    if (!this.onComplete || !attempt.workId || attempt.status !== 'complete'
        || this.notifying.has(attempt.id) || this.notified.has(attempt.id)) return;
    const result = this.present(attempt);
    if (!result.fileAvailable || !result.size) return;
    const notification = Promise.resolve().then(() => this.onComplete!(result)).then(() => {
      this.notified.add(attempt.id);
    }).catch(() => {
      // Reporting can retry from this durable render receipt without restarting rendering.
    }).finally(() => { this.notifying.delete(attempt.id); });
    this.notifying.set(attempt.id, notification);
  }

  private reconcile() {
    this.checkDirectory();
    let changed = false;
    for (const attempt of this.saved.values()) {
      const previous = JSON.stringify(attempt);
      this.refresh(attempt);
      changed ||= previous !== JSON.stringify(attempt);
    }
    if (changed || this.needsSave) this.persist();
    for (const attempt of this.saved.values()) this.notifyComplete(attempt);
    if (this.timer && ![...this.live.values()].some(state => !terminal.has(state.status))) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private present(attempt: SavedAttempt): StudioRenderAttempt {
    const { fileIdentity, ...record } = attempt;
    const stat = fileStat(path.join(this.directory, attempt.filename));
    const fileAvailable = attempt.status === 'complete' && !!stat?.isFile() && !!fileIdentity
      && stat.dev === fileIdentity.dev && stat.ino === fileIdentity.ino && stat.birthtimeMs === fileIdentity.birthtimeMs
      && stat.size === fileIdentity.size && stat.mtimeMs === fileIdentity.mtimeMs;
    const state = this.live.get(attempt.id);
    const workerActive = !!state && !terminal.has(state.status);
    return { ...record, workerActive, fileAvailable, ...(fileAvailable ? { size: stat!.size } : {}) };
  }

  get(id: string): StudioRenderAttempt | undefined {
    this.reconcile();
    const attempt = this.saved.get(id);
    return attempt && this.present(attempt);
  }

  wasDeleted(id: string): boolean {
    return this.deleted.has(id);
  }

  list(): StudioRenderAttempt[] {
    this.reconcile();
    const managed = [...this.saved.values()].map(attempt => this.present(attempt));
    const filenames = new Set(managed.map(attempt => attempt.filename));
    const legacy: StudioRenderAttempt[] = [];
    if (fileStat(this.directory)) for (const filename of readdirSync(this.directory)) {
      if (!safeFilename(filename) || filenames.has(filename)) continue;
      const stat = fileStat(path.join(this.directory, filename));
      if (!stat?.isFile()) continue;
      const id = path.parse(filename).name;
      let status: StudioRenderStatus = 'complete', durationMs: number | undefined, audioLoweredDb: number | undefined;
      const metadata = path.join(this.directory, id + '.meta.json');
      if (fileStat(metadata)?.isFile()) {
        try {
          const meta = JSON.parse(readFileSync(metadata, 'utf8'));
          // An empty reservation or failed legacy render is not a finished video.
          status = meta.status === 'complete' ? 'complete' : meta.status === 'failed' ? 'failed' : 'unknown';
          if (Number.isFinite(meta.durationMs)) durationMs = meta.durationMs;
          if (Number.isFinite(meta.audioLoweredDb)) audioLoweredDb = meta.audioLoweredDb;
        } catch { status = 'unknown'; }
      }
      legacy.push({ id, filename, workerActive: false, createdAt: stat.mtimeMs, status, progress: status === 'complete' ? 100 : 0,
        fileAvailable: status === 'complete', size: stat.size, durationMs, ...(audioLoweredDb === undefined ? {} : { audioLoweredDb }) });
    }
    return [...managed, ...legacy].sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(id: string): StudioRenderAttempt | undefined {
    const attempt = this.get(id);
    if (!attempt || terminal.has(attempt.status) || attempt.status === 'unknown') return attempt;
    if (attempt.status !== 'cancelling') {
      const state = this.live.get(id);
      if (!state?.cancel) throw new Error('Render cancellation is unavailable');
      const saved = this.saved.get(id)!;
      const previousStatus = saved.status;
      saved.status = 'cancelling';
      try {
        this.persist();
        // Native state remains rendering until the renderer has actually stopped.
        state.cancel();
      }
      catch (error) {
        saved.status = previousStatus;
        try { this.persist(); }
        catch { /* The dirty snapshot is retried when storage becomes writable again. */ }
        throw error;
      }
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    if (this.deleted.has(id)) return true;
    const attempt = this.get(id) ?? this.list().find(attempt => attempt.id === id);
    if (!attempt) return false;
    if (!terminal.has(attempt.status)) throw new Error('Render has no confirmed terminal state');
    // Legacy rows retain native deletion only after their terminal fact is checked.
    if (!this.saved.has(id)) return false;
    const stem = path.parse(attempt.filename).name;
    for (const filename of [attempt.filename, stem + '.meta.json']) {
      if (filename === attempt.filename && attempt.status === 'complete' && !attempt.fileAvailable) continue;
      const target = path.join(this.directory, filename);
      const stat = fileStat(target);
      if (stat && !stat.isFile()) throw new Error('Invalid render artifact');
      if (stat) unlinkSync(target);
    }
    this.deleted.add(id);
    this.saved.delete(id);
    this.live.delete(id);
    this.persist();
    return true;
  }

  async flushNotifications() { await Promise.all(this.notifying.values()); }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.reconcile();
  }
}
