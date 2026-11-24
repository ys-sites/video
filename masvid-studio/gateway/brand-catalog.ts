import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginRoot } from '../hyperframes.ts';
import type { BrandCatalog, BrandCatalogEntry } from '../shared/brand-catalog.ts';
import { validateBrandStyle } from '../shared/brand-kit.ts';
import type { BrandCapture } from './brand-extract.ts';
import { brandShowcase } from './brand-showcase.ts';

export const brandCatalogRoot = path.join(pluginRoot, 'library/brand-kits');
let cached: Promise<BrandCatalog> | undefined;
export function readBrandCatalog() {
  return cached ??= readFile(path.join(brandCatalogRoot, 'catalog.json'), 'utf8').then(raw => {
    const catalog = JSON.parse(raw) as BrandCatalog;
    if (catalog.schemaVersion !== 1 || !/^[a-f0-9]{40}$/.test(catalog.revision)) throw new Error('Invalid Brand Kit catalogue');
    const ids = new Set<string>();
    for (const entry of catalog.entries) {
      if (!/^[a-z][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error('Invalid catalogue identity');
      ids.add(entry.id); validateBrandStyle(entry.sample.style);
    }
    return catalog;
  }).catch(error => { cached = undefined; throw error; });
}
export async function catalogEntry(id: string) {
  const entry = (await readBrandCatalog()).entries.find(item => item.id === id);
  if (!entry) throw Object.assign(new Error('Brand Kit not found'), { code: 'ENOENT' });
  return entry;
}
export function catalogCapture(entry: BrandCatalogEntry): BrandCapture {
  return { sample: structuredClone(entry.sample), url: entry.sourceUrl, logo: false, fonts: [], warnings: ['The preview uses representative tokens and available system fonts. Read the original design system for the full style vocabulary.'], sourceKind: 'catalog' };
}
export async function copyCatalogSource(entry: BrandCatalogEntry, destination: string) {
  await mkdir(path.join(destination, 'source'), { recursive: true });
  for (const filename of ['DESIGN.md', 'tokens.css', 'manifest.json']) {
    const record = entry.files.find(file => file.path === filename);
    const bytes = await readFile(path.join(brandCatalogRoot, 'sources', entry.id, filename));
    if (!record || createHash('sha256').update(bytes).digest('hex') !== record.sha256) throw new Error('Brand Kit source integrity check failed');
    await writeFile(path.join(destination, 'source', filename), bytes);
  }
  for (const name of ['OPENDESIGN-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'NOTICE.md']) await copyFile(path.join(brandCatalogRoot, name), path.join(destination, 'source', name));
}
const xml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
/** Discovery artwork for design systems without usable website imagery. */
export function catalogStyleCover(entry: BrandCatalogEntry) {
  const style = entry.sample.style;
  const colors = [...new Set([style.primary, style.foreground, ...entry.sample.colors])]
    .filter(color => /^#[\da-f]{6}$/i.test(color) && color !== style.background).slice(0, 5);
  const words = entry.name.trim().split(/\s+/);
  const lines = [''];
  for (const word of words) {
    if (lines.length === 1 && lines[0] && (lines[0] + ' ' + word).length > 16) lines.push(word);
    else lines[lines.length - 1] += (lines[lines.length - 1] ? ' ' : '') + word;
  }
  const size = Math.min(112, 830 / Math.max(1, ...lines.map(line => [...line].length)));
  const radius = style.radius === '50%' ? 162 : Math.min(162, parseFloat(style.radius) * 3);
  const angle = /^(?:Bold|Creative|Retro)/.test(entry.category) ? -14 : 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <rect width="1280" height="720" fill="${style.background}"/>
  <path d="M72 150H1208 M72 550H1208" stroke="${style.foreground}" stroke-opacity=".18"/>
  <text x="72" y="109" font-family="${xml(style.bodyFont)}" font-size="26" font-weight="600" fill="${style.foreground}">${xml(entry.category)}</text>
  <g transform="rotate(${angle} 993 350)">
    <rect x="868" y="206" width="324" height="294" rx="${radius}" fill="${style.foreground}" opacity=".12"/>
    <rect x="832" y="176" width="324" height="294" rx="${radius}" fill="${style.primary}"/>
    <text x="994" y="365" text-anchor="middle" font-family="${xml(style.headingFont)}" font-size="130" font-weight="700" fill="${style.onPrimary}">${xml([...entry.name][0]?.toUpperCase() || 'A')}</text>
  </g>
  <g font-family="${xml(style.headingFont)}" font-size="${size}" font-weight="700" fill="${style.foreground}">
    ${lines.map((line, i) => `<text x="72" y="${390 + (i - (lines.length - 1) / 2) * size * 1.1}">${xml(line)}</text>`).join('')}
  </g>
  ${colors.map((color, i) => `<rect x="${72 + i * 92}" y="594" width="76" height="51" rx="${Math.min(radius, 25)}" fill="${color}" stroke="${style.foreground}" stroke-opacity=".18"/>`).join('')}
  </svg>`;
}
export function catalogPoster(entry: BrandCatalogEntry) {
  const s = entry.sample.style;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${s.background}"/><g fill="${s.foreground}" font-family="${xml(s.bodyFont)}"><text x="64" y="95" font-size="22" font-weight="600">${xml(entry.name)}</text><text x="1216" y="94" text-anchor="end" font-size="16">01 / 04</text><text x="640" y="258" text-anchor="middle" font-size="15" letter-spacing="3">A BRAND IN MOTION</text><g font-family="${xml(s.headingFont)}" font-size="90" font-weight="700" letter-spacing="-3" text-anchor="middle"><text x="640" y="365">One identity.</text><text x="640" y="462">Every expression.</text></g></g><rect x="64" y="654" width="1152" height="2" fill="${s.foreground}" opacity=".2"/><rect x="1085" y="525" width="260" height="260" rx="${s.radius === '50%' ? 130 : parseFloat(s.radius)}" fill="${s.primary}" transform="rotate(-18 1215 655)"/></svg>`;
}
/** Only OpenMotion-authored HTML/JS executes; upstream files are inert package references. */
export function catalogShowcase(entry: BrandCatalogEntry, controlled = false, scriptNonce?: string) {
  const html = brandShowcase(catalogCapture(entry))
    .replace('src="assets/gsap.min.js"', 'src="/motion-api/brand-kits/catalog/assets/gsap.min.js"')
    .replace('</body>', `<script>
const composition=document.getElementById('main');composition.style.transformOrigin='top left';
document.body.style.overflow='hidden';
const fit=()=>{const scale=Math.min(innerWidth/1280,innerHeight/720);composition.style.transform='translate('+((innerWidth-1280*scale)/2)+'px,'+((innerHeight-720*scale)/2)+'px) scale('+scale+')'};
addEventListener('resize',fit);fit();
const preference=matchMedia('(prefers-reduced-motion: reduce)');
let playing=${!controlled};
const playback=()=>{if(!playing||document.hidden||(!${controlled}&&preference.matches))tl.pause();else tl.repeat(-1).play()};
${controlled ? `addEventListener('message',event=>{
  if(event.source===parent&&event.data?.type==='openmotion:brand-playback'&&typeof event.data.playing==='boolean'){
    playing=event.data.playing;playback();
  }
});
parent.postMessage({type:'openmotion:brand-preview-ready'},'*');` : "if(preference.matches)tl.pause(1.5);"}
preference.addEventListener('change',playback);document.addEventListener('visibilitychange',playback);playback();
</script></body>`);
  return scriptNonce ? html.replace(/<script(?=[\s>])/g, `<script nonce="${xml(scriptNonce)}"`) : html;
}
