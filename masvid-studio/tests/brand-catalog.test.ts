import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brandCatalogRoot, readBrandCatalog, catalogEntry, catalogCapture, catalogPoster, catalogShowcase, catalogStyleCover, copyCatalogSource } from '../gateway/brand-catalog.ts';
import { sameBrandSite } from '../gateway/brand-cover.ts';
import { BrandKitLibrary } from '../gateway/brand-kits.ts';
import { inspectPackage } from '../packages/motion-package/index.mjs';
import { brandKitInstruction } from '../shared/brand-kit.ts';

test('pinned catalogue preserves all canonical sources, categories and distinct styles', async () => {
  const catalog = await readBrandCatalog();
  assert.equal(catalog.entries.length, 152);
  assert.equal(new Set(catalog.entries.map(entry => entry.category)).size, 22);
  assert.equal(new Set(catalog.entries.map(entry => entry.id)).size, 152);
  assert(new Set(catalog.entries.map(entry => JSON.stringify(entry.sample.style))).size > 100);
  const { websites, coverPages = {}, coverImages = {} } = JSON.parse(await readFile(path.join(brandCatalogRoot, 'websites.json'), 'utf8'));
  assert.equal(catalog.entries.filter(entry => entry.websiteUrl).length, Object.keys(websites).length);
  assert.equal(catalog.entries.filter(entry => entry.coverImage).length, Object.keys(coverImages).length);
  await Promise.all(catalog.entries.map(async entry => {
    assert(entry.sourceUrl.includes(catalog.revision));
    assert.equal(entry.websiteUrl, websites[entry.id]);
    assert.equal(entry.coverPage, coverPages[entry.id]);
    assert.equal(entry.coverImage, coverImages[entry.id]);
    if (entry.coverPage) assert(sameBrandSite(entry.websiteUrl!, entry.coverPage), `${entry.id} coverPage must match website site`);
    if (entry.websiteUrl) assert.equal(new URL(entry.websiteUrl).protocol, 'https:');
    if (entry.coverImage) assert.equal(new URL(entry.coverImage).protocol, 'https:');
    assert.deepEqual(entry.files.map(file => file.path).sort(), ['DESIGN.md', 'manifest.json', 'tokens.css']);
    for (const file of entry.files) {
      const bytes = await readFile(path.join(brandCatalogRoot, 'sources', entry.id, file.path));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, entry.id + '/' + file.path);
    }
  }));
  await assert.rejects(catalogEntry('../assets'), /not found/);
});

test('catalogue preview changes style but keeps a fixed safe film', async () => {
  const entries = (await readBrandCatalog()).entries;
  const a = catalogShowcase(entries[0]), b = catalogShowcase(entries[1]);
  const clips = (html: string) => [...html.matchAll(/data-start="(\d+)" data-duration="(\d+)"/g)].map(match => match.slice(1));
  assert.deepEqual(clips(a), clips(b));
  assert.match(a, /prefers-reduced-motion/);
  assert.match(a, /catalog\/assets\/gsap.min.js/);
  const hostile = structuredClone(entries[0]); hostile.name = '</text><script>alert(1)</script>';
  assert(!catalogPoster(hostile).includes('<script>'));
  const capture = catalogCapture(entries[0]); capture.sample.style.primary = '#123456';
  assert.notEqual(entries[0].sample.style.primary, '#123456');
});

test('abstract catalogue artwork shows its own name and palette separately from the video poster', async () => {
  const entry = await catalogEntry('default');
  assert.equal(entry.websiteUrl, undefined);
  const cover = catalogStyleCover(entry);
  assert.match(cover, />Neutral Modern<\/text>/);
  assert(cover.includes(entry.sample.style.primary));
  assert.doesNotMatch(cover, /One identity/);
  assert.match(catalogPoster(entry), /One identity/);
  assert(!catalogStyleCover({ ...entry, name: '<script>' }).includes('<script>'));
  const mapped = await catalogEntry('creative');
  assert.match(mapped.websiteUrl || '', /^https:\/\/github\.com\/bergside\/awesome-design-skills\//);
  assert.match(mapped.coverImage || '', /creative-marketing\.png$/);
});

test('catalogue materialization verifies source, deduplicates, packages and retries without website capture', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'brand-catalog-test-'));
  let renders = 0;
  const library = new BrandKitLibrary(root, {
    runtime: async () => path.resolve('.'),
    extract: async () => { throw new Error('Catalogue must not capture a website'); },
    render: async folder => {
      renders++;
      await writeFile(path.join(folder, 'preview.mp4'), Buffer.from('0000ftyp' + 'x'.repeat(100)));
      await writeFile(path.join(folder, 'poster.png'), 'poster');
    },
  });
  t.after(async () => { await library.close(); await rm(root, { recursive: true, force: true }); });
  const entry = (await readBrandCatalog()).entries[0];
  const [kit, duplicate] = await Promise.all([library.importCatalog(entry.id), library.importCatalog(entry.id)]);
  assert.equal(kit.state, 'ready', 'the package is ready in the import response');
  assert.equal(renders, 0, 'the catalog preview needs no native renderer');
  assert.equal(duplicate.id, kit.id);
  await library.idle();
  const ready = await library.get(kit.id);
  assert.equal(ready.state, 'ready', ready.error);
  assert.equal((await library.list()).length, 1);
  const result = await inspectPackage(ready.packagePath);
  for (const name of ['DESIGN.md', 'tokens.css', 'manifest.json', 'OPENDESIGN-LICENSE.txt', 'THIRD-PARTY-NOTICES.txt', 'NOTICE.md']) assert(result.entries.has('source/' + name));
  assert(!result.entries.has('website.png'));
  assert(result.entries.has('index.html'));
  assert(!result.entries.has('preview.mp4'));
  assert.match(result.manifest.license, /Apache-2.0/);
  assert.equal(result.manifest.extensions['openmotion.brand-kit'].catalogId, entry.id);
  assert.match(brandKitInstruction(ready), /source\/tokens.css/);
  await library.retry(kit.id, { name: 'Local edit' });
  await library.idle();
  assert.equal(renders, 1, 'a customized preview still uses the native renderer');
  assert.equal((await library.get(kit.id)).name, 'Local edit');
  assert.equal((await library.importCatalog(entry.id)).name, 'Local edit');
  assert.equal((await catalogEntry(entry.id)).name, entry.name);
  const corrupt = structuredClone(entry); corrupt.files[0].sha256 = '0'.repeat(64);
  await assert.rejects(copyCatalogSource(corrupt, path.join(root, 'corrupt')), /integrity/);
});

test('existing imported kits resolve their brand website while retaining original design provenance', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'brand-source-test-'));
  const library = new BrandKitLibrary(root), id = '11111111-1111-1111-1111-111111111111';
  t.after(async () => { await library.close(); await rm(root, { recursive: true, force: true }); });
  const { mkdir } = await import('node:fs/promises');
  const entry = await catalogEntry('airtable');
  await mkdir(library.folder(id), { recursive: true });
  await writeFile(path.join(library.folder(id), 'record.json'), JSON.stringify({ id, name: entry.name, kind: 'brand-kit', catalogId: entry.id, url: entry.sourceUrl, state: 'ready', createdAt: '2026-11-16' }));
  assert.equal((await library.get(id)).websiteUrl, entry.websiteUrl);
  assert.equal((await library.list())[0].url, entry.sourceUrl);
  const original = JSON.parse(await readFile(path.join(library.folder(id), 'record.json'), 'utf8'));
  assert.equal(original.websiteUrl, undefined, 'reading old kits does not rewrite user records');
});
