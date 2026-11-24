import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const documentLimit = 1_000_000;
const imageLimit = 700_000;
const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const readSource = relative => readFile(new URL(relative, import.meta.url), 'utf8');

function label(value, field, maxLength, optional = false) {
  assert(typeof value === 'string' && value.length <= maxLength && (optional || value.trim()), 'Invalid ' + field);
  return escapeHtml(value.trim());
}

function rasterMime(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  throw new Error('Storyboard frames must be PNG, JPEG or WebP');
}

async function localImage(directory, name) {
  assert(typeof name === 'string' && !/[\\/]/.test(name) && /\.(?:png|jpe?g|webp)$/i.test(name),
    'Frame image must be a raster filename beside the manifest');
  const filename = path.join(directory, name);
  const info = await lstat(filename);
  assert(info.isFile() && info.size > 0 && info.size <= imageLimit, 'Frame image must be a regular file within the size limit');
  const bytes = await readFile(filename);
  return 'data:' + rasterMime(bytes) + ';base64,' + bytes.toString('base64');
}

export async function renderInlineStoryboard({ manifestPath, output }) {
  assert(typeof manifestPath === 'string' && path.isAbsolute(manifestPath), 'Pass an absolute storyboard manifest path');
  assert(path.isAbsolute(output) && output.endsWith('.html'), 'Pass an absolute HTML output path in the host visualization directory');
  const manifestInfo = await lstat(manifestPath);
  assert(manifestInfo.isFile() && manifestInfo.size <= 64_000, 'Storyboard manifest must be a regular file within the size limit');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const title = label(manifest.title, 'title', 120);
  const openLabel = label(manifest.openLabel, 'openLabel', 60);
  const backLabel = label(manifest.backLabel, 'backLabel', 60);
  const previewType = manifest.previewType ?? 'storyboard';
  assert(['storyboard', 'creative_directions'].includes(previewType), 'Unsupported still-image preview type');
  const isDirections = previewType === 'creative_directions';
  const entries = isDirections ? manifest.directions : manifest.frames;
  if (isDirections) {
    assert(Array.isArray(entries) && [2, 3].includes(entries.length), 'Provide two or three creative directions');
    const ids = entries.map(entry => entry?.id);
    assert(ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= 100 && id.trim() === id)
      && new Set(ids).size === ids.length, 'Creative directions require distinct candidate IDs');
  } else {
    assert(Array.isArray(entries) && entries.length >= 1 && entries.length <= 12,
      'Provide one to twelve frames in storyboard order');
  }
  const root = 'openmotion-storyboard-' + randomUUID();
  const directory = path.dirname(manifestPath);
  const cards = await Promise.all(entries.map(async (entry, index) => {
    const heading = label(entry.title, 'card title', 100);
    const meta = isDirections ? 'ABC'[index] : label(entry.time, 'frame time', 48);
    const note = label(entry.note ?? '', 'card note', 360, !isDirections);
    const alt = label(entry.alt, 'image alt text', 240);
    const src = await localImage(directory, entry.image);
    const headingId = root + '-card-' + index;
    return `<li class="om-storyboard-card">
  <button type="button" class="om-storyboard-cover cursor-interaction" aria-labelledby="${headingId}-open ${isDirections ? headingId + '-meta ' : ''}${headingId}">
    <img src="${src}" alt="${alt}" decoding="async">
    <span class="om-storyboard-open" id="${headingId}-open">${openLabel}</span>
  </button>
  <div class="om-storyboard-caption">
    <p class="om-storyboard-meta" id="${headingId}-meta">${meta}</p>
    <h3 class="om-storyboard-title" id="${headingId}">${heading}</h3>
    <p class="om-storyboard-note">${note}</p>
  </div>
</li>`;
  }));
  const [tokens, css, script] = await Promise.all([
    readSource('../packages/design-system/tokens.css'),
    readSource('../mcp-ui/storyboard/inline.css'),
    readSource('../mcp-ui/storyboard/inline.js'),
  ]);
  // Same self-contained visualization handoff as inline onboarding. The
  // storyboard has no catalog dependency, network request or composer bridge.
  const fragment = `<style>${tokens}\n${css}</style>
<section id="${root}" class="om-storyboard" data-motion-ui aria-labelledby="${root}-title">
  <h2 id="${root}-title">${title}</h2>
  <ol class="om-storyboard-grid" data-count="${cards.length}" role="list">
${cards.join('\n')}
  </ol>
  <section class="om-storyboard-detail" aria-labelledby="${root}-detail" hidden>
    <button type="button" class="om-storyboard-back cursor-interaction">${backLabel}</button>
    <p class="om-storyboard-meta"></p>
    <h3 id="${root}-detail" class="om-storyboard-title"></h3>
    <img alt="">
    <p class="om-storyboard-note"></p>
  </section>
</section>
<script>
(() => {
${script}
  mountStoryboard(document.getElementById('${root}'));
})();
</script>
`;
  const bytes = Buffer.byteLength(fragment);
  assert(bytes < documentLimit, 'Preview exceeds the inline document budget. Compress the source images and retry');
  const outputDirectory = path.dirname(output);
  await mkdir(outputDirectory, { recursive: true });
  const writeOptions = { encoding: 'utf8', flag: 'wx', mode: 0o600 };
  let previewPath = output;
  try { await writeFile(previewPath, fragment, writeOptions); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    previewPath = path.join(outputDirectory, root + '.html');
    await writeFile(previewPath, fragment, writeOptions);
  }
  const preview = isDirections
    ? { candidates: entries.map(({ id, image }) => ({ id, evidence: [{ path: path.join(directory, image) }, { path: previewPath }] })) }
    : { frameCount: cards.length };
  return { path: previewPath, bytes, ...preview,
    contentReference: 'visualize' + JSON.stringify({ path: previewPath }) + '' };
}

function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  const { values } = parseArgs({ options: { manifest: { type: 'string' }, output: { type: 'string' } } });
  console.log(JSON.stringify(await renderInlineStoryboard({ manifestPath: values.manifest, output: values.output })));
}
