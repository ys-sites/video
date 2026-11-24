import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../shared/entry.ts';
import { loadFontCatalog } from '../shared/font-catalog.ts';
import { loadFontParser } from '../shared/studio-fonts.ts';

type Face = { id: string; sourcePath: string; licensePath: string };
type Candidate = { label: string; faces: Face[] };
type Role = { name: string; text: string; fontSize: number; weight: number; width: number; lineHeight?: number; letterSpacing?: number; lang?: string; direction?: 'ltr' | 'rtl' | 'auto'; candidates: Candidate[] };
export type SpecimenRequest = { title: string; sourceWidth: number; displayWidth: number; roles: Role[] };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
function number(value: number, min: number, max: number, field: string) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error('INVALID_SPECIMEN_' + field);
  return value;
}
function text(value: string, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('INVALID_SPECIMEN_' + field);
  return value;
}

/** Explicit, offline comparison. Only supplied, catalog-verified resources enter a new output folder. */
export async function buildFontSpecimen(request: SpecimenRequest, outputDirectory: string, runtimeRoot = fileURLToPath(new URL('../', import.meta.url))) {
  text(request.title, 'TITLE');
  number(request.sourceWidth, 1, 16384, 'SOURCE_WIDTH');
  number(request.displayWidth, 1, 16384, 'DISPLAY_WIDTH');
  if (!Array.isArray(request.roles) || !request.roles.length) throw new Error('INVALID_SPECIMEN_ROLES');
  const { version, fonts } = await loadFontCatalog();
  const parseFont = loadFontParser(runtimeRoot);
  const scale = request.displayWidth / request.sourceWidth;
  const assets = new Map<string, Buffer>();
  const styles: string[] = [];
  const sections: string[] = [];
  const roles = [];
  for (const [roleIndex, role] of request.roles.entries()) {
    text(role.name, 'ROLE_NAME'); text(role.text, 'COPY');
    number(role.fontSize, 1, 4096, 'FONT_SIZE'); number(role.width, 1, request.sourceWidth, 'ROLE_WIDTH');
    if (!Number.isInteger(role.weight)) throw new Error('INVALID_SPECIMEN_WEIGHT');
    number(role.weight, 1, 1000, 'WEIGHT');
    const lineHeight = number(role.lineHeight ?? 1.2, 0.5, 5, 'LINE_HEIGHT');
    const letterSpacing = number(role.letterSpacing ?? 0, -100, 1000, 'LETTER_SPACING');
    if (role.lang !== undefined && (typeof role.lang !== 'string' || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(role.lang))) throw new Error('INVALID_SPECIMEN_LANG');
    if (role.direction !== undefined && !['ltr', 'rtl', 'auto'].includes(role.direction)) throw new Error('INVALID_SPECIMEN_DIRECTION');
    if (!Array.isArray(role.candidates) || !role.candidates.length) throw new Error('INVALID_SPECIMEN_CANDIDATES');
    const candidates = [];
    const cards: string[] = [];
    for (const [candidateIndex, candidate] of role.candidates.entries()) {
      text(candidate.label, 'LABEL');
      if (!Array.isArray(candidate.faces) || !candidate.faces.length) throw new Error('INVALID_SPECIMEN_FACES');
      const families: string[] = [];
      const resources = [];
      const coverage = new Set<number>();
      for (const [faceIndex, face] of candidate.faces.entries()) {
        const font = fonts.find(font => font.id === face.id);
        if (!font) throw new Error('UNKNOWN_FONT_ID: ' + face.id);
        if (!path.isAbsolute(face.sourcePath) || !path.isAbsolute(face.licensePath)) throw new Error('SPECIMEN_REQUIRES_ABSOLUTE_RESOURCE_PATHS');
        const [bytes, license] = await Promise.all([readFile(face.sourcePath), readFile(face.licensePath)]);
        const sha256 = hash(bytes);
        const file = font.files.find(file => file.sha256 === sha256 && file.size === bytes.length);
        if (!file || license.length !== font.license.size || hash(license) !== font.license.sha256) throw new Error('SPECIMEN_RESOURCE_INTEGRITY_MISMATCH: ' + face.id);
        const [min, max = min] = file.weight.split(' ').map(Number);
        if (file.style !== 'normal' || min > role.weight || role.weight > max) throw new Error('FONT_WEIGHT_UNAVAILABLE: ' + face.id);
        const parsed = parseFont(bytes);
        for (const point of parsed.characterSet) coverage.add(point);
        const relative = `assets/${sha256}${path.extname(file.name)}`;
        const licenseRelative = `assets/${font.license.sha256}.license.txt`;
        assets.set(relative, bytes); assets.set(licenseRelative, license);
        const alias = `specimen-${roleIndex}-${candidateIndex}-${faceIndex}`;
        families.push(`"${alias}"`);
        styles.push(`@font-face{font-family:"${alias}";src:url("${relative}");font-weight:${file.weight};font-style:normal;font-display:block}`);
        resources.push({ id: face.id, family: file.family, weight: file.weight, sha256, path: relative, license: licenseRelative, source: font.source });
      }
      const missingGlyphs = [...new Set([...role.text].filter(char => !/\s/u.test(char) && !coverage.has(char.codePointAt(0)!)))];
      const warning = missingGlyphs.length ? `Missing from supplied faces: ${missingGlyphs.join(' ')}` : 'Copy codepoints covered; inspect shaping and rendered faces.';
      const css = `font-family:${families.join(',')};font-size:${role.fontSize * scale}px;font-weight:${role.weight};line-height:${lineHeight};letter-spacing:${letterSpacing * scale}px;width:${role.width * scale}px`;
      const language = role.lang ? ` lang="${escape(role.lang)}"` : '';
      const direction = role.direction ? ` dir="${role.direction}"` : '';
      cards.push(`<article><h3>${escape(candidate.label)}</h3><p class="status">${escape(warning)}</p><div class="sample"${language}${direction} style='${css}'>${escape(role.text)}</div></article>`);
      candidates.push({ label: candidate.label, resources, missingGlyphs });
    }
    roles.push({ name: role.name, text: role.text, fontSize: role.fontSize, displayedFontSize: role.fontSize * scale, weight: role.weight, width: role.width, lineHeight, letterSpacing, ...(role.lang ? { lang: role.lang } : {}), ...(role.direction ? { direction: role.direction } : {}), candidates });
    sections.push(`<section><h2>${escape(role.name)}</h2><p>${role.fontSize}px authored → ${role.fontSize * scale}px displayed · weight ${role.weight} · width ${role.width * scale}px</p><div class="candidates">${cards.join('')}</div></section>`);
  }
  const record = { catalogVersion: version, title: request.title, sourceWidth: request.sourceWidth, displayWidth: request.displayWidth, roles,
    evidence: 'Comparison input and pinned resource identities only. Missing-glyph checks do not prove shaping, rendered-face choice, reading time or aesthetic quality.' };
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(request.title)}</title><style>
*{box-sizing:border-box}body{margin:24px;color:#202020;background:#eee;font:14px/1.5 system-ui,sans-serif}h1{font-size:24px}h2{font-size:18px}h3{font-size:14px;margin:0}.candidates{display:flex;align-items:flex-start;flex-wrap:wrap;gap:16px}article{background:white;padding:16px;max-width:100%;overflow:auto;border:1px solid #ccc}.status{font:12px/1.4 system-ui,sans-serif;max-width:320px;color:#555}.sample{white-space:pre-wrap;overflow-wrap:normal;font-synthesis:none}section{margin-block:32px}${styles.join('\n')}
</style><h1>${escape(request.title)}</h1><p>Actual copy at ${request.displayWidth}px display width / ${request.sourceWidth}px source width. Each role uses identical size, width, weight and spacing across candidates. Compare letter construction and tone, then tune the chosen face in the real composition.</p><p id="font-status">Loading supplied fonts…</p>${sections.join('')}<script>Promise.all(Array.from(document.fonts,f=>f.load())).then(()=>{document.getElementById('font-status').textContent='Supplied fonts loaded. Inspect required glyphs and intended language; this page does not establish reading or aesthetic acceptance.';document.documentElement.dataset.fontsReady='true'}).catch(()=>{document.getElementById('font-status').textContent='Font load failed: comparison is unverified.';document.documentElement.dataset.fontsReady='false'})</script></html>`;
  // Validate and read every input before reserving output; never overwrite an existing comparison.
  await mkdir(outputDirectory);
  try {
    await mkdir(path.join(outputDirectory, 'assets'));
    for (const [relative, bytes] of assets) await writeFile(path.join(outputDirectory, relative), bytes, { flag: 'wx' });
    await writeFile(path.join(outputDirectory, 'index.html'), html, { flag: 'wx' });
    await writeFile(path.join(outputDirectory, 'specimen.json'), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  } catch (error) { await rm(outputDirectory, { recursive: true, force: true }); throw error; }
  return { htmlPath: path.resolve(outputDirectory, 'index.html'), recordPath: path.resolve(outputDirectory, 'specimen.json'), roles: roles.length };
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  if (!(args.length === 2 || args.length === 4 && args[2] === '--runtime-root')) throw new Error('Usage: node --experimental-strip-types scripts/font-specimen.ts <request.json> <new-output-directory> [--runtime-root <existing-locked-runtime>]');
  console.log(JSON.stringify(await buildFontSpecimen(JSON.parse(await readFile(args[0], 'utf8')), path.resolve(args[1]), args[3]), null, 2));
}
