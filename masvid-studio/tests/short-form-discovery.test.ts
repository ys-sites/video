import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { TemplateCatalog } from '../prism-templates.ts';
import { templatePage, type GalleryTemplate } from '../shared/catalog.ts';
import { exploreCommunities } from '../shared/studio-catalog.ts';

test('short-form discovery uses portrait works and original short video posts before paginating', () => {
  const community = exploreCommunities.find(entry => entry.id === 'short-form');
  assert(community?.source === 'templates');
  const entry = (id: string, fields: Partial<GalleryTemplate>): GalleryTemplate => ({
    id, title: id, description: '', subtitle: '', collection: 'reference', kind: 'reference', author: '', tags: [], ...fields,
  });
  const works = [
    entry('portrait', { width: 720, height: 1280 }),
    entry('square', { width: 720, height: 720, ratio: '9:16' }),
    entry('legacy', { ratio: '3/4' }),
    entry('invalid', { ratio: '-1:9' }),
    entry('reel', { sourceUrl: 'https://www.instagram.com/reel/abc/' }),
    entry('short', { sourceUrl: 'https://www.youtube.com/shorts/abc' }),
    entry('long', { sourceUrl: 'https://youtube.com/watch?v=abc&ref=/shorts/abc' }),
    entry('video', { sourceUrl: 'https://www.tiktok.com/@creator/video/123' }),
    entry('other', { sourceUrl: 'https://example.com/shorts/abc' }),
    entry('talk', { role: 'a-roll', width: 1920, height: 1080 }),
  ];
  const page = templatePage(works, { category: community.category, limit: 3 });
  assert.equal(page.total, 5);
  assert.deepEqual(page.items.map(item => item.id), ['portrait', 'legacy', 'reel']);
  assert.deepEqual(templatePage(works, { category: community.category, offset: page.next! }).items.map(item => item.id), ['short', 'video']);
  assert.deepEqual(templatePage(works, { category: 'script' }).items.map(item => item.id), ['talk']);
});

test('the installed collection and the Agent index identify the same short-form works', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-short-form-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const catalog = new TemplateCatalog(directory, { source: 'repository' });
  const index = await catalog.index();
  const rows = (await readFile(index.indexPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const ids = new Set<string>();
  let offset: number | null = 0;
  do {
    const page = await catalog.page({ category: 'short-form', offset });
    for (const work of page.items) ids.add(work.id);
    offset = page.next;
  } while (offset !== null);
  assert(ids.size > 0);
  assert.deepEqual(new Set(rows.filter(row => row.shortForm).map(row => row.templateId)), ids);
});
