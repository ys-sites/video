import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewFontPreparation } from '../shared/preview-fonts.ts';

const family = 'https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;1,700';
const css = '@font-face { font-family: Inter; src: url(https://fonts.gstatic.com/inter.woff2); unicode-range: U+0000-00FF; }';
const headers = { 'User-Agent': 'preview-woff2' };

test('new caption characters share a full font stylesheet without sharing response bodies', async () => {
  const requests: string[] = [];
  const prepare = createPreviewFontPreparation(async (html, options) => {
    const response = await options!.fetchImpl!(`${family}&text=${encodeURIComponent(html)}`, { headers });
    return response.text();
  }, async (input) => {
    requests.push(String(input));
    return new Response(css, { headers: { 'content-length': '10', 'content-encoding': 'gzip' } });
  });
  assert.deepEqual(await Promise.all([prepare('Hello'), prepare('新的字幕'), prepare('Bonjour')]), [css, css, css]);
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).searchParams.get('family'), new URL(family).searchParams.get('family'));
  assert.equal(new URL(requests[0]).searchParams.has('text'), false);
  assert.equal(await prepare('More text'), css);
  assert.equal(requests.length, 1);
});

test('explicit authored subsets and font assets retain their exact URLs', async () => {
  const requests: string[] = [];
  const prepare = createPreviewFontPreparation(async (html, options) => {
    await options!.fetchImpl!(`${family}&text=Authored`);
    await options!.fetchImpl!('https://fonts.gstatic.com/inter.woff2');
    return html;
  }, async input => { requests.push(String(input)); return new Response(css); });
  await prepare(`<link href="${family}&amp;text=Authored">`);
  assert.deepEqual(requests, [`${family}&text=Authored`, 'https://fonts.gstatic.com/inter.woff2']);
});

test('large custom font families retain character subsetting', async () => {
  const url = 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP&text=%E5%AD%97%E5%B9%95';
  const requests: string[] = [];
  const prepare = createPreviewFontPreparation(async (_html, options) => {
    return (await options!.fetchImpl!(url)).text();
  }, async input => { requests.push(String(input)); return new Response(css); });
  await prepare('字幕');
  assert.deepEqual(requests, [url]);
});

test('failed font downloads are retried and HTTP status semantics survive', async () => {
  let requests = 0;
  const prepare = createPreviewFontPreparation(async (_html, options) => {
    const response = await options!.fetchImpl!(`${family}&text=Caption`);
    return `${response.status}:${await response.text()}`;
  }, async () => {
    requests++;
    if (requests === 1) throw new Error('offline');
    return requests === 2 ? new Response('unavailable', { status: 503 }) : new Response(css);
  });
  await assert.rejects(prepare(''), /offline/);
  assert.equal(await prepare(''), '503:unavailable');
  assert.equal(await prepare(''), `200:${css}`);
  assert.equal(await prepare(''), `200:${css}`);
  assert.equal(requests, 3);
});

test('font family, weight and user agent changes invalidate the cached representation', async () => {
  const requests: string[] = [];
  const prepare = createPreviewFontPreparation(async (input, options) => {
    const [familyName, agent] = input.split('|');
    return (await options!.fetchImpl!(`https://fonts.googleapis.com/css2?family=${familyName}&text=test`, { headers: { 'User-Agent': agent } })).text();
  }, async input => { requests.push(String(input)); return new Response(css); });
  await prepare('Inter:wght@400|woff2');
  await prepare('Inter:wght@700|woff2');
  await prepare('Inter:wght@400|woff');
  await prepare('Roboto:wght@400|woff2');
  assert.equal(requests.length, 4);
});

test('cold variable-font weights share one download and independent binary bodies', async () => {
  let requests = 0;
  const bytes = new Uint8Array([119, 79, 70, 50, 1, 2, 3]);
  const prepare = createPreviewFontPreparation(async (_html, options) => {
    const responses = await Promise.all(Array.from({ length: 9 }, () => options!.fetchImpl!('https://fonts.gstatic.com/inter-variable.woff2')));
    for (const response of responses) assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    return 'ready';
  }, async () => { requests++; return new Response(bytes); });
  assert.equal(await prepare('First caption'), 'ready');
  assert.equal(await prepare('Next caption'), 'ready');
  assert.equal(requests, 1);
});

test('font asset failures and oversized files are not retained', async () => {
  let requests = 0;
  const prepare = createPreviewFontPreparation(async (_html, options) => {
    const response = await options!.fetchImpl!('https://fonts.gstatic.com/inter-variable.woff2');
    return `${response.status}:${(await response.arrayBuffer()).byteLength}`;
  }, async () => {
    requests++;
    if (requests === 1) throw new Error('offline');
    if (requests === 2) return new Response('unavailable', { status: 503 });
    return new Response(new Uint8Array(1024 * 1024 + 1));
  });
  await assert.rejects(prepare(''), /offline/);
  assert.equal(await prepare(''), '503:11');
  assert.equal(await prepare(''), '200:1048577');
  assert.equal(await prepare(''), '200:1048577');
  assert.equal(requests, 4);
});
