/** Import a reviewed, local OpenDesign snapshot. Never execute its scripts or HTML. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { browserAutomation, browserExecutable } from '../browser.ts';
import { validateBrandStyle, type BrandSample } from '../shared/brand-kit.ts';
import type { BrandCatalog, BrandCatalogEntry } from '../shared/brand-catalog.ts';

const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/sync-brand-catalog.ts /path/to/reviewed/open-design-checkout');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'library/brand-kits');
const { websites, coverPages = {}, coverImages = {} } = JSON.parse(await readFile(path.join(output, 'websites.json'), 'utf8')) as { websites: Record<string, string>; coverPages?: Record<string, string>; coverImages?: Record<string, string> };
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('A pinned Git snapshot is required');
const puppeteer = await browserAutomation(root);
const browser = await puppeteer.launch({ executablePath: await browserExecutable(), headless: true });
const entries: BrandCatalogEntry[] = [];
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', request => void request.abort());
  await page.setJavaScriptEnabled(false);
  for (const id of (await readdir(path.join(source, 'design-systems'))).sort()) {
    if (!/^[a-z][a-z0-9-]*$/.test(id)) continue;
    const folder = path.join(source, 'design-systems', id);
    const manifest = JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'));
    if (manifest.id !== id || manifest.schemaVersion !== 'od-design-system-project/v1') throw new Error(`Invalid source manifest: ${id}`);
    const css = await readFile(path.join(folder, 'tokens.css'), 'utf8');
    // Setting textContent prevents HTML/script interpretation. Requests are blocked.
    await page.setContent('<!doctype html><html><head></head><body></body></html>');
    const sample = await page.evaluate((css) => {
      const sheet = document.createElement('style'); sheet.textContent = css; document.head.append(sheet);
      const computed = getComputedStyle(document.documentElement);
      const token = (name: string) => computed.getPropertyValue(name).trim();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
      const ctx = canvas.getContext('2d')!;
      const color = (name: string) => {
        const value = token(name);
        if (!value || !CSS.supports('color', value)) throw new Error(`Missing color ${name}`);
        ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1);
        return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
      };
      const font = (name: string) => token(name).replace(/\s+/g, ' ').slice(0, 160);
      const radiusNode = document.createElement('div'); radiusNode.style.borderRadius = token('--radius-md'); document.body.append(radiusNode);
      const radius = getComputedStyle(radiusNode).borderTopLeftRadius;
      const style = { background: color('--bg'), foreground: color('--fg'), primary: color('--accent'), onPrimary: color('--accent-on'), surface: color('--surface'), headingFont: font('--font-display'), bodyFont: font('--font-body'), radius: parseFloat(radius) > 999 ? '50%' : radius, gradient: 'none' };
      return {
        name: '', title: '', style,
        colors: [...new Set(['--bg', '--fg', '--accent', '--accent-on', '--surface', '--muted', '--success', '--warn', '--danger'].filter(key => token(key)).map(color))],
        typography: [{ role: 'Heading', fontFamily: style.headingFont, fontSize: token('--text-4xl'), fontWeight: '700', lineHeight: token('--leading-tight'), letterSpacing: token('--tracking-display') }, { role: 'Body', fontFamily: style.bodyFont, fontSize: token('--text-base'), fontWeight: '400', lineHeight: token('--leading-body'), letterSpacing: 'normal' }],
        spacing: ['--space-1', '--space-2', '--space-3', '--space-4', '--space-6', '--space-8', '--space-12'].map(token).filter(Boolean),
        gradients: [],
        components: [{ role: 'Card', background: style.surface, color: style.foreground, borderRadius: style.radius, padding: token('--space-6'), border: token('--border'), boxShadow: token('--elev-raised') }],
      };
    }, css) as BrandSample;
    sample.name = manifest.name; sample.title = manifest.name;
    sample.style = validateBrandStyle(sample.style);
    const sourceUrl = `https://github.com/nexu-io/open-design/tree/${revision}/design-systems/${id}`;
    const bytes = sample.style.background.slice(1).match(/../g)!.map(x => parseInt(x, 16));
    const rgb = sample.style.primary.slice(1).match(/../g)!.map(x => parseInt(x, 16) / 255);
    const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
    let hue = delta ? max === rgb[0] ? ((rgb[1] - rgb[2]) / delta) % 6 : max === rgb[1] ? (rgb[2] - rgb[0]) / delta + 2 : (rgb[0] - rgb[1]) / delta + 4 : 0;
    hue = (hue * 60 + 360) % 360;
    const colorFamily = delta < 0.12 ? 'Neutral' : hue < 20 || hue >= 345 ? 'Red' : hue < 50 ? 'Orange' : hue < 75 ? 'Yellow' : hue < 165 ? 'Green' : hue < 200 ? 'Cyan' : hue < 260 ? 'Blue' : hue < 300 ? 'Purple' : 'Pink';
    const files: BrandCatalogEntry['files'] = [];
    for (const filename of ['manifest.json', 'DESIGN.md', 'tokens.css']) {
      const data = await readFile(path.join(folder, filename));
      const destination = path.join(output, 'sources', id, filename);
      await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, data);
      files.push({ path: filename, sha256: createHash('sha256').update(data).digest('hex') });
    }
    entries.push({ id, name: manifest.name, category: manifest.category, description: manifest.description, appearance: bytes[0] * .2126 + bytes[1] * .7152 + bytes[2] * .0722 < 128 ? 'Dark' : 'Light', colors: [colorFamily], tags: ['brand-kit', 'style-only', 'OpenDesign', manifest.category], sourceUrl, websiteUrl: websites[id], coverPage: coverPages[id], coverImage: coverImages[id], sample, files });
  }
} finally { await browser.close(); }
await mkdir(path.join(output, 'assets'), { recursive: true });
await copyFile(path.join(root, 'node_modules/gsap/dist/gsap.min.js'), path.join(output, 'assets/gsap.min.js'));
await copyFile(path.join(source, 'LICENSE'), path.join(output, 'OPENDESIGN-LICENSE.txt'));
const catalog: BrandCatalog = { schemaVersion: 1, repository: 'https://github.com/nexu-io/open-design', revision, entries };
await writeFile(path.join(output, 'catalog.json'), JSON.stringify(catalog) + '\n');
console.log(`Imported ${entries.length} design systems at ${revision}`);
