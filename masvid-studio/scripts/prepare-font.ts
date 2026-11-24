import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { isMain } from '../shared/entry.ts';
import { loadFontCatalog } from '../shared/font-catalog.ts';

type Download = { name: string; url: string; size: number; sha256: string };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Only immutable catalog URLs can be fetched; the writable cache is separate from project source. */
export async function prepareCatalogFont(id: string, options: { cacheRoot?: string; fetcher?: typeof fetch; weight?: number } = {}) {
  const { version, fonts } = await loadFontCatalog();
  const font = fonts.find(font => font.id === id);
  if (!font) throw new Error('UNKNOWN_FONT_ID');
  const upright = font.files.filter(file => file.style === 'normal');
  const hasRegular = upright.some(file => { const [min, max = min] = file.weight.split(' ').map(Number); return min <= 400 && 400 <= max; });
  const weight = options.weight ?? (hasRegular ? 400 : Number(upright[0]?.weight.split(' ')[0]));
  if (!Number.isInteger(weight) || weight < 1 || weight > 1000) throw new Error('INVALID_FONT_WEIGHT');
  const selected = font.files.filter(file => { const [min, max = min] = file.weight.split(' ').map(Number); return file.style === 'normal' && min <= weight && weight <= max; });
  if (!selected.length) throw new Error('FONT_WEIGHT_UNAVAILABLE: choose an actual catalog weight');
  const directory = path.resolve(options.cacheRoot ?? path.join(homedir(), '.cache', 'openmotion', 'fonts'), font.source.commit, id);
  await mkdir(directory, { recursive: true });
  const fetcher = options.fetcher ?? fetch;
  async function acquire(asset: Download) {
    const url = new URL(asset.url);
    if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || !/\/[a-f0-9]{40}\//.test(url.pathname) || path.basename(asset.name) !== asset.name || !/^[a-f0-9]{64}$/.test(asset.sha256) || asset.size <= 0 || asset.size > 64 * 1024 * 1024) throw new Error('INVALID_FONT_ASSET');
    const destination = path.join(directory, asset.name);
    const cached = await readFile(destination).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    if (cached?.length === asset.size && hash(cached) === asset.sha256) return destination;
    const response = await fetcher(asset.url, { signal: AbortSignal.timeout(90_000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error(`FONT_DOWNLOAD_FAILED: ${response.status} ${id}`);
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > asset.size) throw new Error('FONT_SIZE_MISMATCH');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== asset.size || hash(bytes) !== asset.sha256) throw new Error('FONT_INTEGRITY_MISMATCH');
    const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
    try { await writeFile(temporary, bytes, { flag: 'wx' }); await rename(temporary, destination); }
    finally { await rm(temporary, { force: true }); }
    return destination;
  }
  const licensePath = await acquire({ name: 'OFL.txt', ...font.license });
  const files = await Promise.all(selected.map(async file => ({ ...file, sourcePath: await acquire(file) })));
  return { fontId: id, family: font.family, catalogVersion: version, requestedWeight: weight, licensePath,
    files, importItems: files.map(file => ({ itemId: `font-${id}-${file.sha256.slice(0, 16)}`, sourcePath: file.sourcePath, licensePath })) };
}
if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 1 || args.length === 3 && args[1] === '--weight')) throw new Error('Usage: node --experimental-strip-types scripts/prepare-font.ts <font-id> [--weight 400]');
  console.log(JSON.stringify(await prepareCatalogFont(args[0], { weight: args.length === 3 ? Number(args[2]) : undefined }), null, 2));
}
