import { lstat, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** Offline operator recovery only. An empty legacy lock cannot prove its owner exited. */
export async function recoverWorkspaceLock(directory: string, confirmedStopped = false) {
  const filename = path.join(path.resolve(directory), 'workspace.lock');
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.size !== 0 || (await readFile(filename)).length !== 0) {
    throw new Error('Refusing recovery: only an empty regular legacy workspace.lock can be quarantined. Owner-bearing locks use automatic runtime recovery.');
  }
  if (!confirmedStopped) return { status: 'confirmation_required', filename,
    nextAction: 'Stop every OpenMotion Studio/backend and connected Agent using this data directory, including exports. Then rerun with --confirm-all-processes-stopped. No files were changed.' };
  // Keep the original for diagnosis. Never apply this offline operation automatically at startup.
  const current = await lstat(filename);
  if (current.dev !== info.dev || current.ino !== info.ino || current.mtimeMs !== info.mtimeMs || current.size !== 0) {
    throw new Error('Lock changed during recovery; no files were changed. Stop all workspace processes and retry.');
  }
  const backup = filename + '.legacy-' + randomUUID();
  await rename(filename, backup);
  return { status: 'recovered', filename, backup, nextAction: 'Restart the connected Agent/Studio with the same data directory. Project data was preserved.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { 'data-dir': { type: 'string' }, 'confirm-all-processes-stopped': { type: 'boolean' } } });
    if (!values['data-dir']) throw new Error('Usage: node --experimental-strip-types scripts/recover-workspace-lock.ts --data-dir DIR [--confirm-all-processes-stopped]');
    console.log(JSON.stringify(await recoverWorkspaceLock(values['data-dir'], values['confirm-all-processes-stopped']), null, 2));
  } catch (error) { console.error((error as Error).message); process.exitCode = 1; }
}
