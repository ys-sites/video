import { brandCoverPng } from './media-fixtures.ts';
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { BrandKitLibrary, brandKitsFor } from "../gateway/brand-kits.ts";
import { brandKitHttp } from "../gateway/brand-http.ts";
import { brandWebsite, publicBrandAddress, resolveBrandAddresses } from "../gateway/brand-network.ts";
import { brandShowcase } from "../gateway/brand-showcase.ts";
import {
  brandKitInstruction,
  validateBrandStyle,
} from "../shared/brand-kit.ts";
import { inspectPackage } from "../packages/motion-package/index.mjs";
import type { BrandCapture } from "../gateway/brand-extract.ts";
import { browserAutomation } from "../browser.ts";
import { BrandCoverCache } from '../gateway/brand-cover.ts';
import { Phase1Service } from '../phase1.ts';
import { WorkspaceStore } from '../workspace.ts';
import { pluginRoot } from '../hyperframes.ts';

test("browser dependencies resolve from the supplied managed runtime", async t => {
  const runtime = await mkdtemp(path.join(tmpdir(), "brand-runtime-test-"));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  const dependency = path.join(runtime, "node_modules", "puppeteer-core");
  await mkdir(dependency, { recursive: true });
  await writeFile(path.join(dependency, "package.json"), JSON.stringify({ main: "index.cjs" }));
  await writeFile(path.join(dependency, "index.cjs"), "module.exports = { launch: async () => 'managed-runtime' };");
  assert.equal(await (await browserAutomation(runtime)).launch(), "managed-runtime");
});

const fixture: BrandCapture = {
  sample: {
    name: "Sample <brand>",
    title: "Sample",
    colors: ["#12604a"],
    typography: [],
    components: [],
    spacing: ["24px"],
    gradients: [],
    style: {
      background: "#f6f2e9",
      foreground: "#142a24",
      primary: "#12604a",
      onPrimary: "#ffffff",
      surface: "#e1e8dc",
      headingFont: "Arial, sans-serif",
      bodyFont: "Arial, sans-serif",
      radius: "24px",
      gradient: "none",
    },
  },
  url: "https://brand.example/",
  logo: false,
  fonts: [],
  warnings: [],
};
const clone = () => structuredClone(fixture);
async function setup(t: any, overrides = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "brand-kit-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const library = new BrandKitLibrary(root, {
    runtime: async () => path.resolve("."),
    extract: async (_url, folder, signal, onExtract) => {
      calls++;
      signal.throwIfAborted();
      await onExtract();
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, "website.png"), "screenshot");
      return clone();
    },
    render: async (folder) => {
      await writeFile(
        path.join(folder, "preview.mp4"),
        Buffer.from("0000ftyp" + "x".repeat(100)),
      );
      await writeFile(path.join(folder, "poster.png"), "poster");
    },
    ...overrides,
  });
  t.after(() => library.close());
  return { root, library, calls: () => calls };
}

test('website creation replays the original request and rejects the same key for another URL', async t => {
  const { library, calls } = await setup(t);
  const initial = await library.create('brand.example', 'capture-brand');
  await library.idle();
  const replay = await library.create('https://brand.example/', 'capture-brand');
  assert.equal(replay.id, initial.id);
  assert.equal(replay.state, 'ready');
  assert.equal(calls(), 1);
  await assert.rejects(library.create('other.example', 'capture-brand'), /REQUEST_ID_CONFLICT/);
});

test('MCP Brand Kits share HTTP records, style handoff and stale revision protection', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-kit-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const server = createServer(async (req, res) => {
    const input = async () => { let raw = ''; for await (const chunk of req) raw += chunk; return JSON.parse(raw); };
    if (!await brandKitHttp(req, res, new URL(req.url || '/', 'http://localhost'), directory, input)) res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  const api = new Phase1Service(new WorkspaceStore(directory), pluginRoot, {
    origin: () => base, nativeUrl: () => undefined, openProject: async () => {},
    mutation: async task => task(), cancel: async () => {},
  });
  const call = (operation: string, fields = {}) => api.call('openmotion_assets_use', { action: 'brand_kit', brandKit: { operation, ...fields } });
  await assert.rejects(call('create', { url: 'https://example.com/' }), /INVALID_ARGUMENT/);
  assert.ok((await call('catalog', { query: 'agentic' })).entries.some(entry => entry.id === 'agentic'));
  const { kit } = await call('import', { catalogId: 'agentic' });
  assert.equal((await call('list')).kits[0].id, kit.id);
  const kitUrl = base + '/api/brand-kits/' + kit.id;
  assert.equal((await (await fetch(kitUrl)).json()).kit.updatedAt, kit.updatedAt);
  const fields = { kitId: kit.id, expectedUpdatedAt: kit.updatedAt };
  const output = await call('package', fields);
  assert.match(output.instruction, /STYLE-ONLY/);
  const savedZip = await readFile(output.packageZipPath);
  assert.deepEqual(savedZip, Buffer.from(await (await fetch(kitUrl + '/files/package.zip?v=' + encodeURIComponent(kit.updatedAt))).arrayBuffer()));
  assert.match((await call('preview', { kitId: kit.id })).mediaUrl, /catalog\/agentic\/showcase/);
  const changed = await call('context', { ...fields, rules: ['Use the supplied accents.'] });
  assert.notEqual(changed.kit.updatedAt, kit.updatedAt);
  assert.deepEqual((await (await fetch(kitUrl)).json()).kit.context.rules, ['Use the supplied accents.']);
  assert.deepEqual(await readFile(output.packageZipPath), savedZip);
  await assert.rejects(call('package', fields), /BRAND_KIT_CHANGED/);
  await assert.rejects(call('remove', fields), /BRAND_KIT_CHANGED/);
  const stale = await fetch(kitUrl + '/context', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: [], expectedUpdatedAt: kit.updatedAt }) });
  assert.equal(stale.status, 409);
});
test("public website validation rejects local networks, credentials and alternate schemes", () => {
  assert.equal(brandWebsite("brand.example"), "https://brand.example/");
  for (const url of [
    "http://brand.example",
    "file:///etc/passwd",
    "https://user:secret@brand.example",
    "https://localhost",
    "https://a.local",
    "https://127.1",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://[::1]",
    "https://[::ffff:127.0.0.1]",
    "https://brand.example:444",
  ])
    assert.throws(() => brandWebsite(url), undefined, url);
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "192.168.1.1",
    "172.20.0.1",
    "169.254.0.1",
    "198.18.0.1",
    "100.64.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:8.8.8.8",
    "2002:7f00:1::",
    "2001:db8::1",
  ])
    assert.equal(publicBrandAddress(ip), false, ip);
  assert.equal(publicBrandAddress("8.8.8.8"), true);
});
test("untrusted styles cannot become executable CSS or HTML", () => {
  for (const style of [
    { ...fixture.sample.style, primary: "url(https://evil.example)" },
    {
      ...fixture.sample.style,
      headingFont: "Arial;}</style><script>alert(1)</script>",
    },
    {
      ...fixture.sample.style,
      gradient: "linear-gradient(red, url(https://evil.example))",
    },
  ])
    assert.throws(() => validateBrandStyle(style));
  const html = brandShowcase(fixture);
  assert.match(html, /Sample &lt;brand&gt;/);
  assert.doesNotMatch(html, /<brand>/);
  const other = clone();
  other.sample.style.primary = "#2222ff";
  other.sample.name = "Other brand";
  const script = (source: string) =>
    source.slice(source.lastIndexOf("<script>"));
  assert.equal(
    script(html),
    script(brandShowcase(other)),
    "showcase choreography must not depend on brand styles",
  );
  assert.deepEqual(
    [...html.matchAll(/data-start="(\d+)" data-duration="(\d+)"/g)].map((x) =>
      x.slice(1),
    ),
    [
      ...brandShowcase(other).matchAll(
        /data-start="(\d+)" data-duration="(\d+)"/g,
      ),
    ].map((x) => x.slice(1)),
  );
});
test("extract, package, reopen and edit preserve the style-only contract and verified inventory", async (t) => {
  const { root, library, calls } = await setup(t),
    kit = await library.create("https://brand.example");
  await library.idle();
  const ready = await library.get(kit.id);
  assert.equal(ready.state, "ready");
  assert.equal(ready.preview, true);
  assert.equal(calls(), 1);
  const result = await inspectPackage(ready.packagePath);
  assert.deepEqual(result.manifest.tags, ["brand-kit", "style-only"]);
  assert.equal(
    result.manifest.extensions["openmotion.brand-kit"].referenceScope,
    "style-only",
  );
  assert(result.entries.has("index.html"));
  assert(result.entries.has("preview.mp4"));
  assert(result.entries.has("assets/gsap-LICENSE.txt"));
  const prompt = brandKitInstruction(ready);
  assert.match(prompt, /STYLE-ONLY/);
  assert.match(prompt, /Do not copy.*timing/);
  assert.match(prompt, /untrusted reference data/);
  assert.equal((await new BrandKitLibrary(root).list())[0].id, kit.id);
  await writeFile(
    path.join(ready.packagePath!, "private.env"),
    "secret-excluded",
  );
  await library.retry(kit.id, {
    name: "Renamed",
    style: { ...fixture.sample.style, primary: "#882244" },
  });
  await library.idle();
  const edited = await library.get(kit.id);
  assert.equal(edited.name, "Renamed");
  assert.equal(calls(), 1);
  assert.equal(edited.sample?.style.primary, "#882244");
  assert(
    !(await inspectPackage(edited.packagePath)).entries.has("private.env"),
  );
  assert.equal(
    (await readFile(await library.file(kit.id, "package.zip"))).readUInt32LE(0),
    0x04034b50,
  );
  await assert.rejects(library.file(kit.id, "../record.json"));
  await library.remove(kit.id);
  assert.equal((await library.list()).length, 0);
});
test("render failure preserves an inspectable kit and retries without rescanning", async (t) => {
  let renders = 0;
  const { library, calls } = await setup(t, {
    render: async (folder: string) => {
      if (++renders === 1) throw new Error("renderer unavailable");
      await writeFile(path.join(folder, "preview.mp4"), "video");
    },
  });
  const kit = await library.create("brand.example");
  await library.idle();
  let saved = await library.get(kit.id);
  assert.equal(saved.state, "ready");
  assert.equal(saved.preview, false);
  assert(saved.previewError);
  await inspectPackage(saved.packagePath);
  await library.retry(kit.id);
  await library.idle();
  saved = await library.get(kit.id);
  assert.equal(saved.preview, true);
  assert.equal(saved.previewError, undefined);
  assert.equal(calls(), 1);
});
test("cancellation stops active work, releases queued slots and never publishes a late package", async (t) => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => (entered = resolve));
  const { library } = await setup(t, {
    extract: async (_url: string, _dir: string, signal: AbortSignal) => {
      entered();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
      return clone();
    },
  });
  const active = await library.create("brand.example");
  await started;
  const queued = await library.create("other.example");
  await library.cancel(queued.id);
  await library.cancel(active.id);
  await library.idle();
  assert.equal((await library.get(active.id)).state, "cancelled");
  assert.equal((await library.get(queued.id)).state, "cancelled");
  await assert.rejects(library.file(active.id, "package.zip"));
  await library.remove(queued.id);
  await library.remove(active.id);
});
test("interrupted records recover explicitly without repeating network work", async (t) => {
  const { root, library } = await setup(t);
  const kit = await library.create("brand.example");
  await library.idle();
  const saved = await library.get(kit.id);
  saved.state = "rendering";
  await writeFile(
    path.join(library.folder(kit.id), "record.json"),
    JSON.stringify(saved),
  );
  const reopened = new BrandKitLibrary(root);
  const record = await reopened.get(kit.id);
  assert.equal(record.state, "failed");
  assert.match(record.error!, /interrupted/);
});
test("HTTP files support video seeking and reject unavailable or arbitrary paths", async (t) => {
  const { root, library } = await setup(t);
  const kit = await library.create("brand.example");
  await library.idle();
  const server = createServer((req, res) => {
    void brandKitHttp(
      req,
      res,
      new URL(req.url!, "http://localhost"),
      root,
      async () => ({}),
    ).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await brandKitsFor(root).close();
  });
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  const status = await fetch(origin + '/api/brand-kits');
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await status.json()).kits[0].state, 'ready');
  const catalog = await (await fetch(origin + '/api/brand-kits/catalog')).json();
  assert.equal(catalog.entries.length, 152);
  const artwork = brandCoverPng;
  const coverCache = new BrandCoverCache(path.join(root, 'brand-cover-cache'), async url => ({ status: 200, headers: { 'content-type': url.endsWith('.png') ? 'image/png' : 'text/html' }, body: url.endsWith('.png') ? artwork : Buffer.from('<meta property="og:image" content="/social.png"><link rel="icon" href="/icon.png">') }));
  await coverCache.get('https://brand.example/');
  const agentic = catalog.entries.find((item: { id: string }) => item.id === 'agentic');
  await coverCache.get(agentic.websiteUrl, agentic.coverImage);
  await coverCache.favicon(agentic.websiteUrl);
  const neutral = catalog.entries.find((item: { id: string }) => item.id === 'default');
  await new BrandCoverCache(path.join(root, 'brand-cover-cache'), async () => ({ status: 404, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(0) })).get(neutral.sourceUrl);
  const cover = await fetch(origin + `/api/brand-kits/${kit.id}/cover`);
  assert.equal(cover.headers.get('content-type'), 'image/png');
  assert.equal(cover.headers.get('x-content-type-options'), 'nosniff');
  assert(Buffer.from(await cover.arrayBuffer()).equals(artwork));
  const agenticCover = await fetch(origin + '/api/brand-kits/catalog/agentic/cover');
  assert.equal(agenticCover.headers.get('content-type'), 'image/png');
  assert(Buffer.from(await agenticCover.arrayBuffer()).equals(artwork));
  const agenticFavicon = await fetch(origin + '/api/brand-kits/catalog/agentic/favicon');
  assert.equal(agenticFavicon.headers.get('content-type'), 'image/png');
  const abstractCover = await fetch(origin + '/api/brand-kits/catalog/default/cover');
  assert.equal(abstractCover.headers.get('content-type'), 'image/svg+xml');
  const fallback = await abstractCover.text();
  assert.match(fallback, /Neutral Modern/);
  assert.doesNotMatch(fallback, /One identity/);
  assert.equal(await (await fetch(origin + '/api/brand-kits/catalog/default/style-cover.svg')).text(), fallback);
  const showcase = await fetch(origin + `/api/brand-kits/catalog/${catalog.entries[0].id}/showcase`);
  assert.equal(showcase.status, 200);
  assert.match(showcase.headers.get('content-security-policy')!, /sandbox allow-scripts/);
  assert(!showcase.headers.get('content-security-policy')!.includes('allow-same-origin'));
  assert.equal((await fetch(origin + '/api/brand-kits/catalog/missing/poster.svg')).status, 404);
  assert.equal((await fetch(origin + '/api/brand-kits/catalog/../catalog.json')).status, 404);
  const partial = await fetch(
    origin + `/api/brand-kits/${kit.id}/files/preview.mp4`,
    { headers: { range: "bytes=4-7" } },
  );
  assert.equal(partial.status, 206);
  assert.equal(await partial.text(), "ftyp");
  assert.equal(
    (
      await fetch(origin + `/api/brand-kits/${kit.id}/files/preview.mp4`, {
        headers: { range: "bytes=9999-" },
      })
    ).status,
    416,
  );
  assert.equal(
    (await fetch(origin + `/api/brand-kits/${kit.id}/files/record.json`))
      .status,
    404,
  );
});

test('context files and rules round-trip through packages and survive website rescans without rerendering context edits', async t => {
  const { library, calls } = await setup(t);
  const initial = await library.create('brand.example');
  await library.idle();
  const bytes = Buffer.from('# Brand guide\nKeep the wordmark intact.');
  let kit = await library.updateContext(initial.id, { rules: ['Keep the wordmark intact.'], file: { name:'guides/BRAND.md', data:bytes.toString('base64') } });
  assert.equal(calls(), 1);
  const file = kit.context!.files[0];
  assert.equal(file.name,'guides/BRAND.md');
  assert.deepEqual(await readFile(await library.file(kit.id,file.path)), bytes);
  const pkg = await inspectPackage(kit.packagePath);
  assert(pkg.entries.has(file.path));
  const data = JSON.parse(await readFile(path.join(kit.packagePath!,'brand-kit.json'),'utf8'));
  assert.deepEqual(data.context,kit.context);
  await library.retry(kit.id,{style:{...kit.sample!.style,primary:'#445566'},name:'My brand'});
  await library.idle();
  await library.retry(kit.id,{rescan:true});
  await library.idle();
  kit = await library.get(kit.id);
  assert.equal(calls(), 2);
  assert.equal(kit.name,'My brand');
  assert.equal(kit.sample!.style.primary,'#445566');
  assert.equal(kit.context?.rules[0],'Keep the wordmark intact.');
  assert.deepEqual(await readFile(await library.file(kit.id,file.path)),bytes);
  assert((await inspectPackage(kit.packagePath)).entries.has(file.path));
  await assert.rejects(library.updateContext(kit.id,{file:{name:'../credentials.txt',data:bytes.toString('base64')}}));
  await assert.rejects(library.updateContext(kit.id,{file:{name:'script.html',data:bytes.toString('base64')}}));
  await assert.rejects(library.updateContext(kit.id,{rules:['x'.repeat(2001)]}));
  kit = await library.updateContext(kit.id,{remove:file.id,rules:[]});
  assert(!(await inspectPackage(kit.packagePath)).entries.has(file.path));
  await assert.rejects(library.file(kit.id,file.path));
});

test('proxy Fake-IP resolution pins a verified public answer without allowing private DNS fallback', async () => {
  const signal = new AbortController().signal;
  let queried = 0;
  const dependencies = { lookup: async () => [{ address: '198.18.1.42', family: 4 }], publicDns: async () => { queried++; return [{ address: '104.18.9.242', family: 4 }]; } };
  assert.equal((await resolveBrandAddresses('brand.example', signal, dependencies))[0].address, '104.18.9.242');
  assert.equal(queried, 1);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254']) {
    await assert.rejects(resolveBrandAddresses('brand.example',signal,{...dependencies,lookup:async()=>[{address,family:4}]}));
  }
  assert.equal(queried,1,'private addresses never get a resolver override');
  await assert.rejects(resolveBrandAddresses('brand.example',signal,{...dependencies,publicDns:async()=>[{address:'127.0.0.1',family:4}]}));
  await assert.rejects(resolveBrandAddresses('brand.example',signal,{...dependencies,lookup:async()=>[{address:'198.18.1.42',family:4},{address:'10.0.0.1',family:4}]}));
});

test('captured reference assets are readable during rendering while incomplete packages stay unavailable', async t => {
  let entered!: () => void, finish!: () => void;
  const rendering = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const { library } = await setup(t, { render: async () => { entered(); await pending; throw new Error('Preview unavailable'); } });
  const kit = await library.create('brand.example');
  await rendering;
  try {
    assert.equal((await library.get(kit.id)).state, 'rendering');
    assert.equal(await readFile(await library.file(kit.id, 'website.png'), 'utf8'), 'screenshot');
    await assert.rejects(library.file(kit.id, 'package.zip'), /not ready/);
    await assert.rejects(library.file(kit.id, 'preview.mp4'), /not ready/);
    await assert.rejects(library.file(kit.id, '../record.json'), /not ready/);
  } finally { finish(); }
  await library.idle();
  assert.equal((await library.get(kit.id)).state, 'ready');
  assert(await library.file(kit.id, 'package.zip'));
});
