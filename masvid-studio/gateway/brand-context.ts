import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { BrandContext, BrandContextFile } from '../shared/brand-kit.ts';

export type ContextUpdate = { rules?: unknown; file?: unknown; remove?: unknown };
export function brandRules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 40 || value.some(rule => typeof rule !== 'string' || !rule.trim() || rule.length > 2000))
    throw new Error('Use up to 40 brand rules, each under 2,000 characters');
  return value.map(rule => rule.trim());
}
export function brandContextUpload(raw: unknown, context: BrandContext) {
  const value = raw as { name?: unknown; data?: unknown };
  if (!value || typeof value.name !== 'string' || value.name.length > 240 || /[\x00-\x1f\\]/.test(value.name) || value.name.split('/').some(p => !p || p === '..' || p === '.'))
    throw new Error('Invalid brand file name');
  const extension = path.extname(value.name).toLowerCase();
  if (!/^\.(?:md|txt|json|pdf|png|jpe?g|webp|avif|gif|ico|svg|mp3|m4a|aac|ogg|wav|woff2?|ttf|otf)$/.test(extension))
    throw new Error('Unsupported brand file type');
  if (typeof value.data !== 'string' || value.data.length > 11_184_812 || value.data.length % 4 !== 0 || /[^a-zA-Z0-9+/=]/.test(value.data) || !/^[^=]*={0,2}$/.test(value.data))
    throw new Error('Brand files must be under 8 MB');
  const data = Buffer.from(value.data, 'base64');
  if (!data.length || data.length > 8 * 1024 * 1024) throw new Error('Brand files must be under 8 MB');
  if (context.files.length >= 32 || context.files.reduce((sum, f) => sum + f.size, 0) + data.length > 32 * 1024 * 1024)
    throw new Error('A Brand Kit supports 32 files and 32 MB of context');
  const id = randomUUID();
  const file: BrandContextFile = { id, name: value.name, path: `context/${id}${extension}`, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  return { file, data };
}
export async function storeContextFile(folder: string, file: BrandContextFile, data: Buffer) {
  await mkdir(path.join(folder, 'context'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(folder, file.path), data, { flag: 'wx', mode: 0o600 });
}
export async function copyBrandContext(folder: string, context: BrandContext | undefined) {
  const directory = path.join(folder, 'package/context');
  await mkdir(directory, { recursive: true });
  const files = context?.files || [];
  for (const name of await readdir(directory)) {
    if (!files.some(file => file.path === `context/${name}`)) await rm(path.join(directory, name), { force: true });
  }
  for (const file of files) await copyFile(path.join(folder, file.path), path.join(folder, 'package', file.path));
}
