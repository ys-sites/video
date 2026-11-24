import { randomUUID } from 'node:crypto';
import { link, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Owner = { pid: number; token: string };
const busyCodes = new Set(['EPERM', 'EACCES', 'EBUSY']);
const pause = () => new Promise(resolve => setTimeout(resolve, 25));
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}
async function retryBusy<T>(work: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try { return await work(); }
    catch (error) {
      if (process.platform !== 'win32' || !busyCodes.has((error as NodeJS.ErrnoException).code!) || Date.now() >= deadline) throw error;
      await pause();
    }
  }
}
async function ownerOf(filename: string): Promise<Owner | null | undefined> {
  try {
    const owner = JSON.parse(await retryBusy(() => readFile(filename, 'utf8')));
    return Number.isSafeInteger(owner?.pid) && owner.pid > 0 && typeof owner.token === 'string' && /^[0-9a-f-]{36}$/.test(owner.token) ? owner : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export async function withProcessLock<T>(filename: string, work: () => Promise<T>, timeoutMs = 30_000): Promise<T> {
  await mkdir(path.dirname(filename), { recursive: true });
  const token = randomUUID(), candidate = filename + '.' + token;
  await writeFile(candidate, JSON.stringify({ pid: process.pid, token }), { mode: 0o600, flag: 'wx' });
  const deadline = Date.now() + timeoutMs;
  try {
    for (;;) {
      // A hard link publishes a complete owner record atomically and never replaces a legacy/live lock.
      try { await link(candidate, filename); break; }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code!;
        if (code !== 'EEXIST' && !(process.platform === 'win32' && busyCodes.has(code))) throw error;
        const owner = await ownerOf(filename);
        if (owner === null) throw new Error(`Lock has no verifiable owner: ${filename}. Close all OpenMotion processes before removing this legacy lock. For an empty workspace.lock, run scripts/recover-workspace-lock.ts --data-dir with this workspace directory to inspect offline recovery.`);
        if (owner && !alive(owner.pid)) {
          await withProcessLock(filename + '.reclaim', async () => {
            if ((await ownerOf(filename))?.token === owner.token) await retryBusy(() => unlink(filename));
          }, Math.max(1, deadline - Date.now()));
        }
        if (Date.now() >= deadline) throw new Error('Timed out waiting for OpenMotion lock: ' + filename);
        await pause();
      }
    }
    try { return await work(); }
    finally { if ((await ownerOf(filename))?.token === token) await retryBusy(() => unlink(filename)); }
  } finally { await rm(candidate, { force: true }); }
}
