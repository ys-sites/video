import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pageMetadata, renderPageMetadata, socialImage } from '../packages/design-system/metadata.js';
import { designTokens } from '../scripts/design-tokens.ts';

test('generated entry heads contain one complete metadata set before JavaScript runs', async () => {
  await designTokens(true);
  for (const [file, surface] of [['studio/index.html', 'studio'], ['packages/design-system/index.html', 'design-system']]) {
    const html = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    assert.ok(html.includes(renderPageMetadata('zh-CN', surface)));
    const head = html.split('</head>')[0];
    for (const key of ['description', 'og:title', 'og:description', 'og:image', 'og:locale', 'twitter:card', 'twitter:title', 'twitter:image']) {
      assert.equal([...head.matchAll(new RegExp(`(?:name|property)="${key}"`, 'g'))].length, 1, `${file}: ${key}`);
    }
    assert.equal([...head.matchAll(/<title>/g)].length, 1);
    assert.match(head, /name="robots" content="noindex, nofollow"/);
    assert.doesNotMatch(head, /rel="canonical"|property="og:url"/);
  }
});

test('sharing copy stays public, localized and HTML-safe', () => {
  for (const locale of ['en', 'zh-CN', 'ja', 'ko', 'de', 'fr', 'ru', 'es', 'pt-BR', 'it', 'tr']) {
    const meta = pageMetadata(locale);
    assert.equal(meta.title, 'OpenDesign Motion — AI Video & Motion Design');
    assert.equal(meta.property['og:site_name'], 'OpenDesign Motion');
    assert.equal(meta.name['application-name'], 'OpenDesign Motion');
    assert.equal(meta.property['og:title'], meta.name['twitter:title']);
    assert.equal(meta.property['og:title'], 'OpenDesign Motion — Create with your AI agent');
    assert.equal(meta.property['og:description'], meta.name.description);
    assert.match(meta.property['og:locale'], /^[a-z]{2}_[A-Z]{2}$/);
    assert.doesNotMatch(JSON.stringify(meta), /localhost|127\.0\.0\.1|session=|project=/);
  }
  assert.match(renderPageMetadata('en'), /AI Video &amp; Motion Design/);
  assert.equal(pageMetadata('unsupported').title, pageMetadata('en').title);
  assert.match(socialImage.url, /^https:\/\/releases\.open-design\.ai\//);
  assert.equal(pageMetadata().property['og:image:secure_url'], socialImage.url);
});

test('social previews reuse the registered README hero and matching card fields', async () => {
  const manifest = JSON.parse(await readFile(new URL('../repository-media.json', import.meta.url), 'utf8'));
  const hero = manifest.files.find((file: { path: string }) => file.path === 'docs/readme/brand-hero.jpg');
  assert.ok(hero, 'The README hero must retain its public media record.');
  assert.equal(socialImage.url, hero.url);
  assert.ok(socialImage.url.includes(hero.sha256), 'The share URL must identify immutable original bytes.');
  assert.ok(hero.bytes < 5 * 1024 * 1024, 'Keep the image within the large social card size limit.');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.ok(readme.includes(socialImage.url), 'The website and README must use the same hero.');
  const meta = pageMetadata();
  assert.equal(meta.name['twitter:image'], meta.property['og:image']);
  assert.equal(meta.name['twitter:image:alt'], meta.property['og:image:alt']);
  assert.equal(meta.property['og:image:secure_url'], meta.property['og:image']);
  assert.equal(meta.property['og:image:type'], 'image/jpeg');
});

test('bookmark assets retain the product symbol and correctly sized PNG fallbacks', async () => {
  const directory = new URL('../packages/design-system/brand/', import.meta.url);
  const mark = await readFile(new URL('loading-mark.svg', directory), 'utf8');
  const icon = await readFile(new URL('favicon.svg', directory), 'utf8');
  assert.deepEqual([...icon.matchAll(/ d="([^"]+)"/g)].map(m => m[1]), [...mark.matchAll(/ d="([^"]+)"/g)].map(m => m[1]));
  assert.match(icon, /prefers-color-scheme:dark/);
  for (const [file, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180]] as const) {
    const png = await readFile(new URL(file, directory));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
