import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { brandCoverPng as coverPng } from './media-fixtures.ts';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrandCoverCache, brandCoverMime, brandSocialImages, brandFavicons, brandFaviconMime } from '../gateway/brand-cover.ts';
import type { BrandResponse } from '../gateway/brand-network.ts';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPI8AAAAASUVORK5CYII=', 'base64');
const response = (body: string | Buffer, mime = 'text/html', status = 200): BrandResponse => ({ status, headers: { 'content-type': mime }, body: Buffer.from(body) });
async function folder(t: test.TestContext) {
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-cover-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('social metadata prefers OG, resolves bases/entities and excludes executable or private URLs', () => {
  const html = `<!-- <meta property="og:image" content="/comment"> -->
    <script>const fake = '<meta property="og:image" content="/script">'</script>
    <base href="/brand/">
    <meta content='twitter.png' name='twitter:image'>
    <META content="og.png?a=1&amp;b=&#50;" PROPERTY="og:image">
    <meta property="og:image:secure_url" content="https://cdn.example/secure.webp">
    <meta property="og:image" content="https://127.0.0.1/private">
    <meta property="og:image" content="data:image/svg+xml,bad">
    <meta property="og:image" content="http://brand.example/insecure">
    <meta name="twitter:image" content="twitter.png">`;
  assert.deepEqual(brandSocialImages(html, 'https://brand.example/home'), [
    'https://cdn.example/secure.webp', 'https://brand.example/brand/og.png?a=1&b=2', 'https://brand.example/brand/twitter.png',
  ]);
  assert.equal(brandCoverMime(png), 'image/png');
  assert.equal(brandCoverMime(Buffer.from('\x00\x00\x00\x1cftypmif1\x00\x00\x00\x00mif1avif')), 'image/avif');
  assert.equal(brandCoverMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), undefined);
  assert.equal(brandCoverMime(Buffer.from('<!doctype html><html>blocked</html>')), undefined);
});

test('covers follow safe redirects, fall back to Twitter and deduplicate/cache across service instances', async t => {
  const directory = await folder(t), requests: string[] = [];
  const fetch = async (url: string) => {
    requests.push(url);
    if (url === 'https://brand.example/') return { ...response('', '', 302), headers: { location: '/home/' } };
    if (url.endsWith('/home/')) return response('<meta property="og:image" content="bad.png"><meta name="twitter:image" content="../../social.png">');
    if (url.endsWith('bad.png')) return response('<html>not an image</html>', 'image/png');
    return response(coverPng, 'application/octet-stream');
  };
  const cache = new BrandCoverCache(directory, fetch);
  const [a, b] = await Promise.all([cache.get('https://brand.example/'), cache.get('https://brand.example/')]);
  assert.deepEqual(a, b);
  assert.equal(a?.source, 'https://brand.example/social.png');
  assert.equal(a?.mime, 'image/png');
  assert.equal(requests.length, 4);
  await new BrandCoverCache(directory, fetch).get('https://brand.example/');
  assert.equal(requests.length, 4, 'a reload uses the persisted cover');
  const receipt = JSON.parse(await readFile(path.join(directory, (await readdir(directory)).find(file => file.endsWith('.json'))!), 'utf8'));
  assert.equal(receipt.source, a?.source);
});

test('retries old misses and picks the first usable page image after broken social artwork', async t => {
  const directory = await folder(t), requests: string[] = [];
  const website = 'https://brand.example/';
  const oldKey = createHash('sha256').update(website + '\n').digest('hex');
  await writeFile(path.join(directory, oldKey + '.json'), JSON.stringify({ checkedAt: Date.now() }));
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (url === website) return response(`<base href="/media/"><meta property="og:image" content="broken.png">
      <img alt="Brand logo" src="logo.png">
      <img src="https://127.0.0.1/private.png"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
      <img src="pixel.png">
      <picture><source type="image/png" srcset="small.png 320w, hero.png 960w, large.png 1920w">
      <img src="backup.png"></picture><img src="later.png">`);
    if (url.endsWith('/broken.png')) return response('', '', 404);
    if (url.endsWith('/pixel.png')) return response(png, 'image/png');
    return response(coverPng, 'image/png');
  });
  assert.equal((await cache.get(website))?.source, 'https://brand.example/media/hero.png');
  assert.deepEqual(requests, [website, 'https://brand.example/media/broken.png', 'https://brand.example/media/pixel.png', 'https://brand.example/media/hero.png']);
});

test('prefers a usable OG image and recognizes an ordinary lazy image when there is no social metadata', async t => {
  const directory = await folder(t), requests: string[] = [];
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (url === 'https://social.example/') return response('<meta property="og:image" content="/og.png"><img src="/hero.png">');
    if (url === 'https://lazy.example/') return response('<img src="placeholder.png" data-src="hero.png"><img src="later.png">');
    return response(coverPng, 'image/png');
  });
  assert.equal((await cache.get('https://social.example/'))?.source, 'https://social.example/og.png');
  assert.equal((await cache.get('https://lazy.example/'))?.source, 'https://lazy.example/hero.png');
  assert(!requests.some(url => /social\.example\/hero|placeholder|later/.test(url)));
});

test('a blocked homepage can use its verified brand subpage for cover art', async t => {
  const directory = await folder(t), requests: string[] = [];
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (url.endsWith('/')) return response('', 'text/html', 403);
    if (url.endsWith('/brand')) return response('<meta property="og:image" content="/cover.png">');
    return response(coverPng, 'image/png');
  });
  assert.equal(await cache.get('https://brand.example/', undefined, 'https://other.example/brand'), undefined);
  assert.equal((await cache.get('https://brand.example/', undefined, 'https://brand.example/brand'))?.source, 'https://brand.example/cover.png');
  assert(requests.every(url => url.startsWith('https://brand.example/')));
});

test('unsafe redirects and absent metadata are negative-cached without fetching their targets', async t => {
  const directory = await folder(t), requests: string[] = [];
  let now = 100_000;
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    return { ...response('', '', 302), headers: { location: 'https://169.254.169.254/private' } };
  }, () => now);
  assert.equal(await cache.get('https://brand.example/'), undefined);
  assert.equal(await cache.get('https://brand.example/'), undefined);
  assert.deepEqual(requests, ['https://brand.example/']);
  now += 60 * 60 * 1000 + 1;
  await cache.get('https://brand.example/');
  assert.equal(requests.length, 2, 'an unavailable cover is retried after the negative cache expires');
  assert.equal(await cache.get('https://localhost/'), undefined);
  assert.equal(requests.length, 2);
});

test('a captured OG image works without rereading the site and last good artwork survives refresh failures', async t => {
  const directory = await folder(t), requests: string[] = [];
  let now = 100_000, offline = false;
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (offline) throw new Error('offline');
    return response(coverPng, 'image/png');
  }, () => now);
  assert((await cache.get('https://brand.example/', '/og.png'))?.body.equals(coverPng));
  assert.deepEqual(requests, ['https://brand.example/og.png']);
  now += 8 * 24 * 60 * 60 * 1000; offline = true;
  assert((await cache.get('https://brand.example/', '/og.png'))?.body.equals(coverPng));
});

test('different card loads share a bounded network budget', async t => {
  const directory = await folder(t);
  let active = 0, maximum = 0;
  const cache = new BrandCoverCache(directory, async () => {
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return response('<title>No social artwork</title>');
  });
  await Promise.all(Array.from({ length: 20 }, (_, index) => cache.get(`https://brand-${index}.example/`)));
  assert.equal(maximum, 6);
});

test('favicon candidates preserve website identity, resolve relative paths and exclude unrelated metadata', () => {
  assert.deepEqual(brandFavicons(`<base href="/assets/"><meta property="og:image" content="/social.png">
    <link rel="apple-touch-icon" href="touch.png"><link href="small.png" rel="shortcut icon" sizes="16x16">
    <link rel="icon" sizes="64x64" href="large.png?a=1&amp;b=2"><link rel="icon" href="https://127.0.0.1/private">
    <script>const fake='<link rel="icon" href="/fake.png">'</script>`, 'https://brand.example/about'), [
    'https://brand.example/assets/large.png?a=1&b=2', 'https://brand.example/assets/small.png', 'https://brand.example/assets/touch.png', 'https://brand.example/favicon.ico',
  ]);
});

test('favicons use their own cache, accept complete ICO payloads and recover without readable HTML', async t => {
  const directory = await folder(t), requests: string[] = [];
  const ico = Buffer.alloc(22 + png.length);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = 32; ico[7] = 32;
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18); png.copy(ico, 22);
  assert.equal(brandFaviconMime(ico), 'image/vnd.microsoft.icon');
  assert.equal(brandFaviconMime(ico.subarray(0, ico.length - 1)), undefined);
  assert.equal(brandFaviconMime(Buffer.from('<svg onload="alert(1)"></svg>')), undefined);
  assert.equal(brandFaviconMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>')), 'image/svg+xml');
  assert.equal(brandFaviconMime(Buffer.from('<svg><foreignObject><div>HTML</div></foreignObject></svg>')), undefined);
  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (url.endsWith('/favicon.ico')) return response(ico, 'application/octet-stream');
    return response('blocked', 'text/html', 403);
  });
  const [a, b] = await Promise.all([cache.favicon('https://brand.example'), cache.favicon('https://brand.example')]);
  assert.deepEqual(a, b);
  assert.equal(a?.source, 'https://brand.example/favicon.ico');
  assert.equal(a?.mime, 'image/vnd.microsoft.icon');
  await cache.favicon('https://brand.example');
  assert.equal(requests.length, 2);
  assert.equal(await cache.get('https://brand.example'), undefined, 'the OG cover must not become a favicon');
});

test('supports same-site subdomain coverPages, preload/noscript images, compact OG fallback, SVG local refs and GitHub deduplication', async t => {
  const directory = await folder(t);
  const requests: string[] = [];
  // Minimal valid 180x180 PNG header (IHDR width=180, height=180)
  const smallOg = Buffer.from(coverPng);
  smallOg.writeUInt32BE(180, 16);
  smallOg.writeUInt32BE(180, 20);
  const svgWithLocalGrad = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/><linearGradient href="#g"/></defs><rect width="16" height="16"/></svg>');
  const svgWithExternalHref = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>');
  assert.equal(brandFaviconMime(svgWithLocalGrad), 'image/svg+xml');
  assert.equal(brandFaviconMime(svgWithExternalHref), undefined);

  const cache = new BrandCoverCache(directory, async url => {
    requests.push(url);
    if (url === 'https://brand.example/') return response('blocked', 'text/html', 403);
    if (url === 'https://docs.brand.example/') return response('<meta property="og:image" content="/docs-og.png">');
    if (url === 'https://preload.example/') return response('<link rel="preload" as="image" href="/hero.png">');
    if (url === 'https://noscript.example/') return response('<noscript><img src="/fallback-hero.png"></noscript>');
    if (url === 'https://compact.example/') return response('<meta property="og:image" content="/icon-180.png">');
    if (url.endsWith('/icon-180.png')) return response(smallOg, 'image/png');
    if (url === 'https://touchonly.example/') return response('blocked', 'text/html', 403);
    if (url === 'https://touchonly.example/favicon.ico') return response('', 'text/plain', 404);
    if (url === 'https://touchonly.example/apple-touch-icon.png') return response(png, 'image/png');
    if (url === 'https://github.com/') return response('<link rel="icon" href="https://github.githubassets.com/favicons/favicon.png">');
    if (url === 'https://github.com/org/repo') return response('<meta property="og:image" content="https://repository-images.githubusercontent.com/1/og.png">');
    return response(coverPng, 'image/png');
  });

  assert.equal((await cache.get('https://brand.example/', undefined, 'https://docs.brand.example/'))?.source, 'https://docs.brand.example/docs-og.png');
  assert.equal((await cache.get('https://preload.example/'))?.source, 'https://preload.example/hero.png');
  assert.equal((await cache.get('https://noscript.example/'))?.source, 'https://noscript.example/fallback-hero.png');
  assert.equal((await cache.get('https://compact.example/'))?.source, 'https://compact.example/icon-180.png');
  assert.equal((await cache.favicon('https://touchonly.example/'))?.source, 'https://touchonly.example/apple-touch-icon.png');

  const beforeGh = requests.length;
  const [ghFav1, ghFav2] = await Promise.all([
    cache.favicon('https://github.com/org/repo/tree/abc/design-systems/a'),
    cache.favicon('https://github.com/org/repo/tree/abc/design-systems/b'),
  ]);
  assert.equal(ghFav1?.source, 'https://github.githubassets.com/favicons/favicon.png');
  assert.equal(ghFav2?.source, ghFav1?.source);
  const [ghCov1, ghCov2] = await Promise.all([
    cache.get('https://github.com/org/repo/tree/abc/design-systems/a'),
    cache.get('https://github.com/org/repo/tree/abc/design-systems/b'),
  ]);
  assert.equal(ghCov1?.source, 'https://repository-images.githubusercontent.com/1/og.png');
  assert.equal(ghCov2?.source, ghCov1?.source);
  assert.equal(requests.length - beforeGh, 4, 'GitHub tree paths deduplicate into one favicon and one repo OG fetch');
});
