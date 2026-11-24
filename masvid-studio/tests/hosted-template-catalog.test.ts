import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hostedCatalogUrl } from '../shared/hosted-template-catalog.ts';
import { TemplateCatalog } from '../prism-templates.ts';

const commit = 'a'.repeat(40);
const id = 'motion-hosted-fixture';
const motion = Buffer.from('# Hosted motion\n');
const motionSha = createHash('sha256').update(motion).digest('hex');
const binary = Buffer.from([0, 1, 2, 255]);
const binarySha = createHash('sha256').update(binary).digest('hex');
const manifest = {
  schemaVersion: 1,
  commit,
  baseUrl: `https://releases.open-design.ai/open-motion/templates/snapshots/${commit}`,
  objectBaseUrl: 'https://releases.open-design.ai/open-motion/templates/objects',
  publication: { resourceId: 'hosted', environment: 'prod', channel: 'default', publicationId: 'hosted-main', defaultLocale: 'en', locales: ['en'] },
  templateIds: [id],
  localeContent: { en: {} },
};
const record = {
  templateId: id,
  entry: { templateId: id, sortOrder: 1, original: { templateName: 'Hosted fixture', summary: 'Latest main template' }, files: [] },
  locales: { en: {} },
};
const sourceManifest = { files: [{ path: 'motion.md', bytes: motion.length, sha256: motionSha }, { path: 'project.bin', bytes: binary.length, sha256: binarySha }] };
const hostedFiles = { files: [{ path: 'motion.md', bytes: motion.length, sha256: motionSha }, { path: 'project.bin', bytes: binary.length, sha256: binarySha }] };

function response(value: unknown, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('hosted catalog reads the moving main pointer and serves content-addressed source files', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-hosted-catalog-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const calls: string[] = [];
  let offline = false;
  const request = async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (offline) throw new Error('offline');
    if (url === hostedCatalogUrl) return response(manifest);
    if (url.endsWith(`/${id}/template.json`)) return response(record);
    if (url.endsWith(`/${id}/hosted-files.json`)) return response(hostedFiles);
    if (url.endsWith(`/${id}/source/manifest.json`)) return response(sourceManifest);
    if (url.endsWith(`/${id}/TEMPLATE.md`)) return new Response('# Hosted instructions\n');
    if (url.endsWith('/' + motionSha)) return new Response(motion);
    if (url.endsWith('/' + binarySha)) return new Response(binary);
    throw new Error('Unexpected request: ' + url);
  };
  const catalog = new TemplateCatalog(work, { source: 'hosted', locale: 'en', fetch: request });
  const page = await catalog.page({ category: 'all' });
  assert.equal(page.source, 'hosted');
  assert.equal(page.catalogVersion, 'hosted:' + commit);
  assert.equal(page.items[0].title, 'Hosted fixture');
  const detail = await catalog.detail(id);
  assert.equal(detail.instructions, '# Hosted instructions\n');
  assert.equal(detail.motionDocument.content, '# Hosted motion\n');
  assert.equal(detail.workflowGuide.workflow, 'recreate', 'a guidance package without index.html is recreated');
  assert.equal((await catalog.sourceFile(id, 'motion.md')).toString(), '# Hosted motion\n');
  assert.deepEqual(await catalog.sourceFile(id, 'project.bin'), binary);
  const afterFirstSourceRead = calls.length;
  assert.equal((await catalog.sourceFile(id, 'motion.md')).toString(), '# Hosted motion\n');
  assert.equal(calls.length, afterFirstSourceRead, 'verified hosted source files are reused from the cache');
  const cachedMotion = createHash('sha256').update(`${commit}:${id}:source/motion.md`).digest('hex');
  await writeFile(path.join(catalog.directory, 'hosted-files', cachedMotion), 'corrupt cached source');
  assert.equal((await catalog.detail(id)).motionDocument.content, motion.toString());
  assert.equal(calls.at(-1), manifest.objectBaseUrl + '/' + motionSha, 'MCP detail replaces a corrupt cached source file');
  offline = true;
  const reopened = new TemplateCatalog(work, { source: 'hosted', locale: 'en', fetch: request });
  assert.equal((await reopened.sourceFile(id, 'motion.md')).toString(), '# Hosted motion\n');
});

test('built-in template detail stays local when the hosted catalog is unreachable', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-hosted-builtin-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const request = async (input: RequestInfo | URL) => { throw new Error('Hosted catalog unavailable: ' + String(input)); };
  const catalog = new TemplateCatalog(work, { source: 'hosted', locale: 'en', fetch: request });
  const detail = await catalog.detail('product-promo');
  assert.equal(detail.id, 'product-promo');
  assert.equal(detail.kind, 'builtin');
  assert.match(detail.instructions, /product-promo/);
  assert.deepEqual(detail.workflowGuide, { workflow: 'template', section: 'start', status: 'ready' });
  const index = await catalog.index();
  assert.equal(index.source, 'hosted');
  assert(index.total > 0, 'template listing remains available through built-ins during a hosted outage');
  assert.match(index.warning, /内置模板/);
});

test('published repository files serve the HTTP gallery, public MCP and arbitrary project downloads in hosted mode', async t => {
  const { mkdir, readFile, writeFile } = await import('node:fs/promises');
  const { buildTemplatePublication } = await import('../.github/scripts/publish-template-catalog.mjs');
  const { WorkspaceStore } = await import('../workspace.ts');
  const { transport } = await import('./http.ts');
  const { rpc, mcpRegistry } = await import('../mcp.ts');
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-hosted-integration-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const root = path.join(work, 'library/templates/catalog'), folder = path.join(root, id);
  await mkdir(path.join(folder, 'source'), { recursive: true });
  const contents = { 'index.html': Buffer.from('<html>Editable hosted project</html>'), '工程.custom': Buffer.alloc(1024 * 1024 + 1, 42), 'motion.md': motion, 'preview.html': Buffer.from('<html><link rel="stylesheet" href="style.css">Hosted guide</html>'), 'style.css': Buffer.from('body { font-family: sans-serif; }') };
  const files = Object.entries(contents).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }));
  const metadata = { ...record, entry: { ...record.entry, coverUrl: 'https://example.com/cover.jpg', files: files.filter(file => ['index.html', '工程.custom'].includes(file.path)) } };
  await writeFile(path.join(root, 'catalog.json'), JSON.stringify(manifest));
  await writeFile(path.join(folder, 'template.json'), JSON.stringify(metadata));
  await writeFile(path.join(folder, 'TEMPLATE.md'), '# Hosted instructions\n');
  await writeFile(path.join(folder, 'source/manifest.json'), JSON.stringify({ files }));
  for (const [name, bytes] of Object.entries(contents)) await writeFile(path.join(folder, 'source', name), bytes);
  const built = await buildTemplatePublication(work, commit);
  t.after(() => rm(built.staging, { recursive: true, force: true }));
  const uploaded = new Map(await Promise.all(built.uploads.map(async file => [`https://releases.open-design.ai/${file.key}`, await readFile(file.body)] as const)));
  uploaded.set(hostedCatalogUrl, Buffer.from(JSON.stringify(built.catalog)));
  t.mock.method(globalThis, 'fetch', async input => {
    const bytes = uploaded.get(String(input));
    assert(bytes, 'Unexpected network access: ' + input);
    return new Response(new Uint8Array(bytes));
  });
  const previous = process.env.MOTION_TEMPLATE_SOURCE;
  process.env.MOTION_TEMPLATE_SOURCE = 'hosted';
  t.after(() => { if (previous === undefined) delete process.env.MOTION_TEMPLATE_SOURCE; else process.env.MOTION_TEMPLATE_SOURCE = previous; });
  const store = new WorkspaceStore(path.join(work, 'data')), request = transport(store);
  const page = await (await request('/motion-api/template-catalog?category=all&locale=en&covered=true')).json();
  assert.equal(page.source, 'hosted');
  const item = page.items.find(item => item.id === id);
  assert(item?.hasHtmlProject);
  assert.equal('localSource' in item, false);
  const call = async (name: string, args = {}) => {
    const result = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, store, mcpRegistry('phase1'));
    assert.equal(result.result.isError, undefined, JSON.stringify(result));
    return result.result.structuredContent;
  };
  const index = await call('openmotion_list_templates');
  assert.equal(index.catalogVersion, page.catalogVersion);
  assert.match(await readFile(index.indexPath, 'utf8'), /Hosted fixture/);
  const detail = await call('openmotion_get_template', { templateId: id });
  assert.equal(detail.motionDocument.content, motion.toString());
  assert.equal(detail.localSource, undefined);
  assert.equal(detail.workflowGuide.workflow, 'template');
  const guide = await (await request(item.motionGuideUrl)).text();
  assert(guide.includes('/guide-assets/viewer.js'));
  assert(guide.includes('"id":"' + id + '"'));
  assert.equal(await (await request(item.motionGuideUrl + '?raw=1')).text(), contents['preview.html'].toString());
  assert.equal(await (await request(`/api/template-source/${id}/style.css`)).text(), contents['style.css'].toString());
  const downloaded = await request(`/api/template-source/${id}/${encodeURIComponent('工程.custom')}`);
  assert.equal(downloaded.status, 200);
  assert.equal(downloaded.headers.get('content-type'), 'application/octet-stream');
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), contents['工程.custom']);
  const catalog = new TemplateCatalog(path.join(work, 'copy-cache'), { source: 'hosted' });
  const output = path.join(work, 'copied');
  await catalog.copy(await catalog.get(id), output, work);
  assert.deepEqual(await readFile(path.join(output, '工程.custom')), contents['工程.custom']);
});

test('hosted detail rejects corrupt content-addressed objects', async t => {
  const work = await mkdtemp(path.join(tmpdir(), 'openmotion-hosted-corrupt-'));
  t.after(() => rm(work, { recursive: true, force: true }));
  const request = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === hostedCatalogUrl) return response(manifest);
    if (url.endsWith('/template.json')) return response(record);
    if (url.endsWith('/hosted-files.json')) return response(hostedFiles);
    if (url.endsWith('/source/manifest.json')) return response(sourceManifest);
    if (url.endsWith('/TEMPLATE.md')) return new Response('# Instructions');
    return new Response('corrupted source');
  };
  await assert.rejects(new TemplateCatalog(work, { source: 'hosted', fetch: request }).detail(id), /content hash/);
});
