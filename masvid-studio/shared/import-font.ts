import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadFontParser, prepareFont, readFontFile } from './studio-fonts.ts';

export const isFontFilePath = (filename: string) => /\.(?:ttf|otf|ttc|woff2?)$/i.test(filename);

/** Prepare font bytes and optional license in staging; the caller owns the project transaction. */
export async function prepareImportedFont(staged: string, licensePath: string | undefined, assetId: string, staging: string, runtimeRoot: string, fontPath: string) {
  const { data, format, ...font } = prepareFont(await readFontFile(staged), loadFontParser(runtimeRoot));
  await writeFile(staged, data);
  const relative = `assets/fonts/${assetId}.${format}`;
  const changes: Array<{ path: string; source: string }> = [{ path: relative, source: staged }];
  let license: { path: string; sha256: string } | undefined;
  if (licensePath) {
    if (!path.isAbsolute(licensePath)) throw new Error('FONT_LICENSE_NOT_READABLE: absolute path required');
    // A licence belongs to the font file the user selected. Requiring the same directory stops this
    // argument from copying an unrelated readable file (keys, .env) into the project.
    if (path.dirname(path.resolve(licensePath)) !== path.dirname(path.resolve(fontPath)))
      throw new Error('FONT_LICENSE_NOT_BESIDE_FONT: place the licence next to the font file');
    const handle = await open(licensePath, constants.O_RDONLY | constants.O_NOFOLLOW | (constants.O_NONBLOCK ?? 0));
    let bytes: Buffer;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 131072) throw new Error('INVALID_FONT_LICENSE: expected text at most 128 KiB');
      bytes = await handle.readFile();
      if (bytes.length > 131072 || !new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()) throw new Error('INVALID_FONT_LICENSE');
    } finally { await handle.close(); }
    const source = path.join(staging, assetId + '.license.txt');
    await writeFile(source, bytes);
    license = { path: `assets/fonts/${assetId}.license.txt`, sha256: createHash('sha256').update(bytes).digest('hex') };
    changes.push({ path: license.path, source });
  }
  const cssString = (value: string) => JSON.stringify(value).replace(/</g, '\\3c ');
  const fontFaceCss = `@font-face { font-family: ${cssString(font.family)}; src: url(${cssString(relative)}); font-weight: ${font.weight}; font-style: ${font.style}; }`;
  return { changes, path: relative, mimeType: `font/${format}`, font, fontFaceCss, ...(license ? { license } : {}) };
}
