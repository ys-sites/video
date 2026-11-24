import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.ts';
import { transport } from './http.ts';
import { handler } from '../server.ts';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readdir } from 'node:fs/promises';

test('wrapper serves the locally built Motion editor and hides local source/runtime files', () => fixture(async store => {
  const request = transport(store);
  const html = await (await request('/')).text(); assert.match(html, /data-motion-studio/);
  assert.doesNotMatch(html, /<iframe/);
  const script = html.match(/src="(\/editor-assets\/[^\"]+\.js)"/)![1];
  const module = await request(script); assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type')!, /javascript/);
  for (const url of ['/workspace.ts', '/.motion-data/project/index.html', '/node_modules/hyperframes/package.json', '/web/render.ts', '/studio/src/main.tsx', '/web/app.ts']) assert.equal((await request(url)).status, 404);
  assert.equal((await request('/web/design-system/fonts.css')).status, 200);
  assert.equal((await request('/design-system')).status, 200);
  const png = (await readdir(new URL('../studio/build/editor-assets/', import.meta.url))).find(file => file.endsWith('.png'))!;
  assert(png, 'The bundle contains the Kimi brand fallback');
  const image = await request('/editor-assets/' + png);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await request('/api/studio')).status, 503);
}));
test('HTTP source writes use the same revision contract and reject stale saves', () => fixture(async store => {
  const request = transport(store), initial = await store.get();
  const payload = JSON.stringify({ expectedRevision: initial.revision, files: [{ path: 'notes.md', content: 'HTTP edit' }] });
  const init = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: payload };
  assert.equal((await request('/api/project', init)).status, 200);
  assert.equal((await request('/api/project', init)).status, 409);
  assert.equal((await store.readFile('notes.md')).content, 'HTTP edit');
  const health = await (await request('/api/health')).json();
  assert.equal(health.protocol, 2); assert.equal(health.engine, 'hyperframes'); assert.equal(health.dataDirectory, store.directory); assert.equal(health.ready, false);
}));
test('settings and MCP bookmarks load independently of an unavailable native project', () => fixture(async store => {
  let attempts = 0;
  const request = transport(store, { ensureStudio: async () => { attempts++; throw new Error('Native project unavailable'); } });
  for (const route of ['/?page=mcp&host=claude&project=project', '/?page=settings&section=appearance&session=project']) {
    const response = await request(route);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /data-motion-studio/);
  }
  assert.equal(attempts, 0);
  assert.equal((await request('/?project=project')).status, 400);
  assert.equal(attempts, 1);
}));
test('cross-origin pages cannot trigger read routes that start server-side work', () => fixture(async store => {
  const request = transport(store);
  for (const site of ['cross-site', 'same-site', 'unrecognized']) {
    for (const method of ['GET', 'HEAD']) {
      for (const route of ['/motion-api/settings/account?refresh=true', '/motion-api/models?refresh=true', '/motion-api/models/capabilities?refresh=true',
        '/motion-api/project/status', '/motion-api/brand-kits/catalog/example/cover', '/api/project/status', '/design-api/project/status']) {
        assert.equal((await request(route, { method, headers: { 'sec-fetch-site': site } })).status, 403, `${site} ${method} ${route}`);
      }
    }
  }
  // Same-origin readers, direct navigation and non-browser clients keep working.
  assert.notEqual((await request('/motion-api/project/status')).status, 403);
  for (const site of ['same-origin', 'none']) {
    assert.notEqual((await request('/motion-api/settings/account', { headers: { 'sec-fetch-site': site } })).status, 403);
  }
}));
test('wrapper rejects cross-origin mutations and DNS rebinding hosts', () => fixture(async store => {
  for (const headers of [ { host: 'localhost:4173', origin: 'https://remote.example' }, { host: 'evil.example', origin: 'http://evil.example' } ]) {
    let status = 200;
    const res = Object.assign(new Writable({ write(_chunk, _encoding, done) { done(); } }), { setHeader() {}, writeHead(value: number) { status = value; } });
    const req = Object.assign(Readable.from([]), { url: '/api/project', method: 'PUT', headers });
    await handler(req as unknown as IncomingMessage, res as unknown as ServerResponse, store); assert.equal(status, 403);
  }
}));

test('the listening address is loopback or a wildcard, never a specific interface', async () => {
  const { bindHost } = await import('../server.ts');
  assert.equal(bindHost({}), '127.0.0.1');
  assert.equal(bindHost({ MOTION_BIND_HOST: '  ' }), '127.0.0.1');
  assert.equal(bindHost({ MOTION_BIND_HOST: '127.0.0.1' }), '127.0.0.1');
  assert.equal(bindHost({ MOTION_BIND_HOST: '0.0.0.0' }), '0.0.0.0');
  assert.equal(bindHost({ MOTION_BIND_HOST: '::' }), '::');
  // The readiness probe and returned URLs use 127.0.0.1, so these would start a server nothing can reach.
  for (const value of ['192.168.1.20', '::1', 'example.com']) {
    assert.throws(() => bindHost({ MOTION_BIND_HOST: value }), /MOTION_BIND_HOST/);
  }
});

test('container connection instructions launch Docker on the host, preserving the workspace inside', () => fixture(async store => {
  const previous = process.env.MOTION_CONTAINER_NAME;
  process.env.MOTION_CONTAINER_NAME = 'openmotion';
  try {
    const request = transport(store);
    const info = await (await request('/api/integration')).json();
    assert.equal(info.transport.command, 'docker');
    assert.equal(info.transport.cwd, undefined);
    assert.deepEqual(info.transport.env, {});
    assert.deepEqual(info.transport.args.slice(0, 3), ['exec', '-i', '--workdir']);
    assert.ok(info.transport.args.includes('MOTION_DATA_DIR=' + store.directory));
    assert.ok(info.transport.args.includes('openmotion'));
    for (const host of ['codex', 'claude', 'deepseek', 'mcp']) {
      const config = await (await request('/connect/config?host=' + host)).text();
      assert.match(config, /docker/);
      const guide = await (await request('/connect/guide?host=' + host)).text();
      assert.match(guide, /container paths/);
    }
  } finally {
    if (previous === undefined) delete process.env.MOTION_CONTAINER_NAME;
    else process.env.MOTION_CONTAINER_NAME = previous;
  }
}));

test('SPA route allowlist serves Studio HTML while reserved backend and unknown paths never fall back', () => fixture(async store => {
  let ensureCalls = 0;
  const request = transport(store, {
    ensureStudio: async () => { ensureCalls++; throw new Error('Native project unavailable'); },
  });
  for (const route of ['/explore', '/cinema', '/cinema/text-to-video', '/design/prototype', '/design/projects/d-1', '/sound', '/audio/sfx', '/create/text-to-image', '/studios/3d', '/studios/game?game=done', '/settings/providers?project=project', '/mcp-setup?project=project', '/brand-kit/mine', '/model-hub/gemini-4', '/models/veo-3', '/skills/manim', '/scenarios', '/scenarios/black-friday', '/assets', '/assets/a-1']) {
    const response = await request(route);
    assert.equal(response.status, 200, `expected 200 for SPA route ${route}`);
    assert.match(await response.text(), /data-motion-studio/);
  }
  // Standalone SPA routes must not trigger native Studio startup even when ?project is attached.
  assert.equal(ensureCalls, 0);

  // Reserved backend / cloud MCP / unknown paths must never return SPA HTML.
  for (const route of ['/mcp', '/mcp/stream', '/unknown-page', '/workspace.ts']) {
    const response = await request(route);
    assert.equal(response.status, 404, `expected 404 for ${route}`);
  }
  const missingAsset = await request('/editor-assets/missing.js');
  assert.equal(missingAsset.status, 503);
  assert.doesNotMatch(await missingAsset.text(), /data-motion-studio/);
  assert.equal((await request('/api/unknown')).status, 503);

  // Explicit editor path triggers native Studio pre-launch.
  assert.equal((await request('/editor/project')).status, 400);
  assert.equal(ensureCalls, 1);
}));
test('download headers sanitise the plain name and keep the exact name encoded', async () => {
  const { attachmentDisposition, encodedFilename, plainFilename } = await import('../shared/http-header.ts');
  assert.equal(attachmentDisposition('clip.mp4'), 'attachment; filename="clip.mp4"; filename*=UTF-8\'\'clip.mp4');
  // A quote or backslash must not survive into the header value; CRLF never reaches Node.
  const hostile = attachmentDisposition('a"b\\c.mp4');
  assert.ok(!hostile.includes('"a"b'), hostile);
  assert.match(hostile, /filename="a_b_c\.mp4"/);
  // Non-ASCII collapses in the plain parameter but survives percent-encoded.
  const unicode = attachmentDisposition('\u89c6\u9891.mp4');
  assert.match(unicode, /filename="_+\.mp4"/);
  assert.match(unicode, /filename\*=UTF-8''%E8%A7%86%E9%A2%91\.mp4/);
  // RFC 5987 attr-char excludes these delimiters, so they must be percent-encoded.
  for (const character of ["'", '(', ')', '*']) {
    assert.equal(encodedFilename(character), '%' + character.charCodeAt(0).toString(16).toUpperCase());
  }
  // `!` is an allowed attr-char, but the shared encoder escapes the whole delimiter set
  // so one rule covers every caller; percent-encoding an allowed character stays valid.
  assert.equal(encodedFilename('!'), '%21');
  // An explicit plain-name override is sanitised too, so a caller cannot bypass the rule.
  const overridden = attachmentDisposition('real"name.mp4', 'generic"name.mp4');
  assert.match(overridden, /filename="generic_name\.mp4"/);
  assert.match(overridden, /filename\*=UTF-8''real%22name\.mp4/);
  assert.equal(plainFilename('a"b\\c'), 'a_b_c');
});
