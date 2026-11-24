import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { create } from 'fontkit';
import { loadFontCatalog, fontCatalogResource } from '../shared/font-catalog.ts';
import { readWorkflowResource, workflowResources } from '../shared/workflow.ts';
import { prepareCatalogFont } from '../scripts/prepare-font.ts';

const bytes = await readFile(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
const license = await readFile(new URL('./fixtures/fonts/OFL.txt', import.meta.url));

test('curated catalog has 40 usable families, stable resources and resolvable editorial pairings', async () => {
  const { fonts } = await loadFontCatalog();
  assert.equal(fonts.length, 40); assert.equal(new Set(fonts.map(font => font.id)).size, 40);
  assert.equal(fonts.filter(font => font.languages.includes('zh-Hans')).length, 9);
  for (const language of ['zh-Hant', 'ja', 'ko', 'ar', 'fa', 'hi']) assert.ok(fonts.some(font => font.languages.includes(language)));
  for (const font of fonts) {
    assert.ok(font.roles.length && font.moods.length && font.bestFor.length && font.limitations.length);
    assert.ok(font.usage.spacing && font.usage.locale);
    assert.ok(font.brandFit.traits.length && font.brandFit.useWhen.length && font.brandFit.mismatchRisks.length);
    assert.ok(['reading', 'conditional', 'display'].includes(font.readability.readingUse));
    assert.ok(font.readability.risks.length && font.readability.adjustment);
    assert.match(font.source.commit, /^[a-f0-9]{40}$/);
    for (const pair of font.pairings) {
      assert.ok(fonts.some(font => font.id === pair.id));
      assert.ok(pair.when && pair.avoidWhen);
    }
    for (const file of [...font.files, font.license]) {
      assert.match(file.sha256, /^[a-f0-9]{64}$/); assert.ok(file.size > 0);
      assert.ok(file.url.includes(font.source.commit));
    }
    for (const file of font.files) { assert.equal(file.style, 'normal'); assert.deepEqual(file.coverage.missing, []); }
  }
  const orbitron = fonts.find(font => font.id === 'orbitron')!;
  assert.equal(createHash('sha256').update(bytes).digest('hex'), orbitron.files[0].sha256);
  const parsed = create(bytes);
  assert.equal(parsed.familyName, orbitron.files[0].family);
  assert.equal(`${parsed.variationAxes.wght.min} ${parsed.variationAxes.wght.max}`, orbitron.files[0].weight);
});

test('index is lightweight, per-family resources include preparation, and reads have no workspace effects', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-font-read-'));
  try {
    assert.ok(workflowResources().some(resource => resource.uri === 'openmotion://fonts/index'));
    const index = await fontCatalogResource('openmotion://fonts/index');
    assert.equal(index.total, 40); assert.ok(!('files' in index.fonts![0]));
    const result = await readWorkflowResource('motion://fonts/orbitron', directory);
    const detail = JSON.parse(result.text);
    assert.equal(detail.family, 'Orbitron'); assert.equal(detail.files.length, 1);
    assert.ok(detail.prepare.command.includes('orbitron'));
    await assert.rejects(fontCatalogResource('openmotion://fonts/../../secret'), /INVALID_FONT_RESOURCE/);
    await assert.rejects(fontCatalogResource('openmotion://fonts/not-a-font'), /UNKNOWN_FONT_ID/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('selected fonts are hash verified, reused offline, repaired on corruption and reject unavailable weights', async () => {
  const cacheRoot = await mkdtemp(path.join(tmpdir(), 'motion-font-cache-')); let calls = 0;
  const fetcher = (async (url: string | URL | Request) => { calls++; return new Response(String(url).endsWith('OFL.txt') ? license : bytes); }) as typeof fetch;
  try {
    const first = await prepareCatalogFont('orbitron', { cacheRoot, fetcher, weight: 700 });
    assert.equal(calls, 2); assert.equal(first.files.length, 1); assert.equal(first.requestedWeight, 700);
    assert.equal(await readFile(first.licensePath, 'utf8'), license.toString());
    const offline = (async () => { throw new Error('offline'); }) as typeof fetch;
    const second = await prepareCatalogFont('orbitron', { cacheRoot, fetcher: offline });
    assert.deepEqual(second.importItems, first.importItems);
    await writeFile(first.files[0].sourcePath, 'corrupt');
    await assert.rejects(prepareCatalogFont('orbitron', { cacheRoot, fetcher: offline }), /offline/);
    await prepareCatalogFont('orbitron', { cacheRoot, fetcher }); assert.equal(calls, 3);
    await assert.rejects(prepareCatalogFont('lxgwwenkai', { cacheRoot, fetcher, weight: 700 }), /FONT_WEIGHT_UNAVAILABLE/);
    await assert.rejects(prepareCatalogFont('../../secret', { cacheRoot, fetcher }), /UNKNOWN_FONT_ID/);
    const wrong = (async () => new Response('wrong bytes')) as typeof fetch;
    await writeFile(first.files[0].sourcePath, 'corrupt');
    await assert.rejects(prepareCatalogFont('orbitron', { cacheRoot, fetcher: wrong }), /FONT_INTEGRITY_MISMATCH/);
  } finally { await rm(cacheRoot, { recursive: true, force: true }); }
});

test('a bold-only family selects an available default before acquisition, while explicit unsupported weights fail', async () => {
  const cacheRoot = await mkdtemp(path.join(tmpdir(), 'motion-font-bold-default-'));
  let acquisitions = 0;
  const stopBeforeNetwork = (async () => { acquisitions++; throw new Error('ACQUISITION_REACHED'); }) as typeof fetch;
  try {
    await assert.rejects(prepareCatalogFont('unifrakturcook', { cacheRoot, fetcher: stopBeforeNetwork }), /ACQUISITION_REACHED/);
    assert.equal(acquisitions, 1);
    await assert.rejects(prepareCatalogFont('unifrakturcook', { cacheRoot, fetcher: stopBeforeNetwork, weight: 400 }), /FONT_WEIGHT_UNAVAILABLE/);
    assert.equal(acquisitions, 1);
  } finally { await rm(cacheRoot, { recursive: true, force: true }); }
});
