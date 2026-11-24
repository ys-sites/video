import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withProcessLock } from '../shared/process-lock.ts';

export type LedgerTaskType = 'asset_import' | 'edit' | 'export';
export type LedgerOutcome = 'success' | 'failure' | 'unknown' | 'cancelled';
export type LedgerTask = {
  task_id: string;
  task_type: LedgerTaskType;
  project_id?: string;
  run_id?: string;
  operation_id?: string;
  accepted_at: string;
  deadline_at: string;
  terminal_at?: string;
  outcome?: LedgerOutcome;
  applied?: 'true' | 'false' | 'unknown';
  error_code?: string;
};

const id = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Project directories accept the built-in project and any UUID, so the ledger does too.
const projectIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const iso = (value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
function validTask(value: unknown): value is LedgerTask {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as LedgerTask;
  return id.test(task.task_id) && ['asset_import', 'edit', 'export'].includes(task.task_type)
    && iso(task.accepted_at) && iso(task.deadline_at)
    && (task.project_id === undefined || task.project_id === 'project' || projectIdPattern.test(task.project_id))
    && (task.run_id === undefined || id.test(task.run_id))
    && (task.operation_id === undefined || id.test(task.operation_id))
    && (task.terminal_at === undefined || iso(task.terminal_at))
    && (task.outcome === undefined || ['success', 'failure', 'unknown', 'cancelled'].includes(task.outcome))
    && (task.applied === undefined || ['true', 'false', 'unknown'].includes(task.applied))
    && (task.error_code === undefined || /^[A-Za-z0-9_.-]{1,128}$/.test(task.error_code));
}

export class TaskLedger {
  readonly folder: string;
  readonly file: string;
  constructor(directory: string) {
    this.folder = path.join(directory, 'tracking');
    this.file = path.join(this.folder, 'tasks.json');
  }
  private async read(): Promise<Record<string, LedgerTask>> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Object.values(value).some(task => !validTask(task))) throw new Error('TASK_LEDGER_CORRUPT');
      return value as Record<string, LedgerTask>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      if (error instanceof Error && error.message === 'TASK_LEDGER_CORRUPT') throw error;
      throw new Error('TASK_LEDGER_UNREADABLE');
    }
  }
  private async write(tasks: Record<string, LedgerTask>) {
    await mkdir(this.folder, { recursive: true, mode: 0o700 });
    const temporary = path.join(this.folder, 'tasks.' + crypto.randomUUID() + '.tmp');
    try { await writeFile(temporary, JSON.stringify(tasks), { mode: 0o600, flag: 'wx' }); await rename(temporary, this.file); }
    finally { await rm(temporary, { force: true }); }
  }
  async accept(task: LedgerTask) {
    if (!validTask(task)) throw new Error('TASK_LEDGER_INVALID');
    return withProcessLock(path.join(this.folder, 'tasks.lock'), async () => {
      const tasks = await this.read(), existing = tasks[task.task_id];
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(task)) throw new Error('TASK_LEDGER_CONFLICT');
        return existing;
      }
      tasks[task.task_id] = task; await this.write(tasks); return task;
    });
  }
  async terminal(taskId: string, outcome: LedgerOutcome, applied: LedgerTask['applied'], errorCode?: string) {
    if (!id.test(taskId)) throw new Error('TASK_LEDGER_INVALID');
    return withProcessLock(path.join(this.folder, 'tasks.lock'), async () => {
      const tasks = await this.read(), task = tasks[taskId]; if (!task) throw new Error('TASK_LEDGER_NOT_FOUND');
      if (task.outcome) {
        if (task.outcome !== outcome || task.applied !== applied) throw new Error('TASK_LEDGER_CONFLICT');
        // Repeating the same observed result never moves the recorded terminal time.
        return task;
      }
      task.outcome = outcome; task.applied = applied; task.terminal_at = new Date().toISOString();
      if (errorCode) task.error_code = errorCode; await this.write(tasks); return task;
    });
  }
  async snapshot() { return withProcessLock(path.join(this.folder, 'tasks.lock'), () => this.read()); }
}
