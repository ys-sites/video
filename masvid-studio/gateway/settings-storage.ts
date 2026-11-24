import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function readSettings<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('Settings could not be read'); }
}
export async function writeSettings(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
