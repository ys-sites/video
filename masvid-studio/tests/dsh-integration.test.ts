import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { integrationConfig, integrationPatch, studioOrigin } from '../integrations/dsh/config.ts';
import { configureStudio, studioAssetUrl } from '../integrations/dsh/plugin/src/studio.ts';

test('template posters resolve against Studio while retaining hosted asset URLs', () => {
  configureStudio('http://127.0.0.1:53801');
  assert.equal(studioAssetUrl('/api/templates/example/poster'), 'http://127.0.0.1:53801/api/templates/example/poster');
  assert.equal(studioAssetUrl('api/template-source/example/poster.png'), 'http://127.0.0.1:53801/api/template-source/example/poster.png');
  assert.equal(studioAssetUrl('https://releases.open-design.ai/poster.png'), 'https://releases.open-design.ai/poster.png');
  assert.equal(studioAssetUrl(undefined), undefined);
});

test('DSH launch configuration isolates state and quotes machine-specific values', () => {
  const root = path.resolve('checkout with spaces');
  const config = integrationConfig(root, { OPENMOTION_DSH_HOME: path.resolve('host state'), OPENMOTION_DSH_PORT: '3088', MOTION_DATA_DIR: path.resolve('existing data') });
  assert.equal(config.port, 3088);
  assert.equal(config.data, path.resolve('existing data'));
  assert.equal(config.dshHome, path.join(config.home, 'dsh'));
  const executable = '/node path/with "quotes"/node';
  const patch = integrationPatch(config, executable, { MOTION_TEMPLATE_SOURCE: 'hosted' });
  const scalar = (key: string) => JSON.parse(patch.match(new RegExp(`^ +${key}: (.*)$`, 'm'))![1]);
  assert.equal(scalar('root'), root);
  assert.equal(scalar('dataDirectory'), config.data);
  assert.equal(scalar('node'), executable);
  assert.equal(scalar('templateSource'), 'hosted');
  assert.ok(!patch.includes('providers:'));
  for (const port of ['0', '65536', 'abc', '1.5']) assert.throws(() => integrationConfig(root, { OPENMOTION_DSH_PORT: port }));
});

test('DSH rejects remote, credential-bearing and non-origin Studio addresses', () => {
  assert.equal(studioOrigin('http://127.0.0.1:4173/'), 'http://127.0.0.1:4173');
  for (const url of ['https://example.com', 'http://example.com', 'file:///tmp/studio', 'http://user:secret@localhost:4173', 'http://localhost/path', 'http://localhost/?token=secret']) assert.throws(() => studioOrigin(url));
});

test('packaged DSH host shares MCP data and bounds its read-only proxy', async () => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'openmotion-dsh-test-')));
  const data = path.join(temporary, 'data');
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const version = JSON.parse(manifest).version;
  const projects = [{ id: 'example' }, { id: 'removed', trashedAt: 123 }];
  const requests: string[] = [];
  const upstream = createServer((req, res) => {
    requests.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/health') {
      res.end(JSON.stringify({ service: 'motion-preview', protocol: 2, version, ready: true, dataDirectory: data, studioUrl: origin }));
    } else if (req.url!.startsWith('/motion-api/projects')) {
      res.end(JSON.stringify({ projects }));
    } else {
      res.end(JSON.stringify({ items: [], total: 0 }));
    }
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`;
  const routes = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const host = createServer((req, res) => {
    const route = routes.get(req.url!.split('?')[0]) || routes.get(req.url!.startsWith('/openmotion-dsh/design-system/') ? '/openmotion-dsh/design-system' : '/openmotion-dsh/data');
    if (route) void route(req, res); else { res.writeHead(404); res.end(); }
  });
  try {
    // Run the maintained preview CLI and its real health/registry reuse path.
    // Keep its runtime imports external so their source-relative assets resolve normally.
    await build({
      entryPoints: [fileURLToPath(new URL('../preview.ts', import.meta.url))],
      outfile: path.join(temporary, 'preview.ts'), bundle: true, format: 'esm', platform: 'node',
      plugins: [{ name: 'runtime-imports', setup(builder) {
        builder.onResolve({ filter: /^\.\// }, args => ({ path: path.resolve(path.dirname(args.importer), args.path), external: true }));
      } }],
    });
    await mkdir(data);
    await writeFile(path.join(data, 'preview.json'), JSON.stringify({ port: Number(new URL(origin).port) }));
    await writeFile(path.join(temporary, 'server.ts'), 'throw new Error("The registered service must be reused, not started again.");');
    const module = path.join(temporary, 'plugin.js');
    await writeFile(path.join(temporary, 'package.json'), manifest);
    await mkdir(path.join(temporary, 'packages/design-system'), { recursive: true });
    for (const name of ['index.js', 'provider-icons.js', 'platform-icons.js']) await copyFile(new URL('../packages/design-system/' + name, import.meta.url), path.join(temporary, 'packages/design-system', name));
    // Only the native MCP bridge is replaced. Exercise the actual compiled host,
    // preview entrypoint, HTTP routes and network requests without model calls.
    await build({
      entryPoints: [fileURLToPath(new URL('../integrations/dsh/plugin/src/index.ts', import.meta.url))],
      outfile: module, bundle: true, format: 'esm', platform: 'node',
      plugins: [{ name: 'mcp-fixture', setup(builder) {
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-mcp-client$/ }, () => ({ path: 'bridge', namespace: 'fixture' }));
        builder.onLoad({ filter: /^bridge$/, namespace: 'fixture' }, () => ({ contents: 'export async function apply(ctx, config) { ctx.bridge = config; }', loader: 'js' }));
        builder.onResolve({ filter: /^@deepseek-ai\/dsh-llm$/ }, () => ({ path: 'llm', namespace: 'fixture' }));
        builder.onLoad({ filter: /^llm$/, namespace: 'fixture' }, () => ({ contents: 'export function createUserMessage(input) { return { id: \"fixture-message\", ...input }; }', loader: 'js' }));
      } }],
    });
    await copyFile(new URL('../integrations/dsh/plugin/src/style.css', import.meta.url), path.join(temporary, 'style.css'));
    const optionalCards: Array<(context: any) => unknown> = [];
    const ctx = {
      bridge: null as any,
      get: () => undefined,
      inject: (keys: string[], register: (context: any) => unknown) => { assert.deepEqual(keys, ["skills", "actionCards"]); optionalCards.push(register); },
      effect: (register: () => unknown) => register(),
      webServer: { register: (route: { path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
      tools: { definitions: () => [{ name: 'mcp__openmotion__openmotion_get_project' }, { name: 'unrelated' }] },
    };
    const plugin = await import(pathToFileURL(module).href);
    await plugin.apply(ctx, { root: temporary, dataDirectory: data, templateSource: 'hosted' });
    assert.equal(optionalCards.length, 1, 'Card registration must wait for optional services without blocking MCP');
    const kinds: any[] = [];
    optionalCards[0]({ effect: (run: () => unknown) => run(),
      skills: { registerProvider: () => () => {} },
      actionCards: { register: (kind: unknown) => { kinds.push(kind); return () => {}; } },
    });
    assert.equal(kinds[0].action, 'openmotion_template_recommendation', 'Services loaded after startup still enable cards');
    assert.equal(ctx.bridge.env.MOTION_DATA_DIR, data);
    assert.equal(ctx.bridge.env.MOTION_TEMPLATE_SOURCE, 'hosted');
    assert.equal(ctx.bridge.cwd, temporary);
    assert.equal(ctx.bridge.command, process.execPath);
    assert.deepEqual(ctx.bridge.args, ['--experimental-strip-types', path.join(temporary, 'mcp.ts')]);
    assert.equal(ctx.bridge.failOnStartupError, true);
    await new Promise<void>(resolve => host.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(host.address() as { port: number }).port}/openmotion-dsh`;
    const status = await (await fetch(base + '/status')).json();
    assert.equal(status.studioUrl, origin.replace('127.0.0.1', 'localhost'));
    assert.deepEqual(status.tools, ['mcp__openmotion__openmotion_get_project']);
    assert.ok((await (await fetch(base + '/style.css')).text()).includes('.omd-studio-seat'));
    assert.deepEqual(await (await fetch(base + '/data/motion-api/projects')).json(), { projects });
    assert.equal((await fetch(base + '/data/api/template-catalog?limit=6')).status, 200);
    for (const [endpoint, method] of [['/motion-api/projects', 'POST'], ['/api/projects', 'GET'], ['/motion-api/projects/example', 'GET'], ['/api/assets', 'GET'], ['/motion-api/projects/../settings', 'GET']]) {
      assert.equal((await fetch(base + '/data' + endpoint, { method })).status, 404);
    }
    assert.equal((await fetch(base + '/design-system/fonts/AlbertSans-VariableFont_wght.ttf')).status, 200);
    assert.equal((await fetch(base + '/design-system/private.txt')).status, 404);
    assert.ok(requests.includes('/api/health'), 'activation must probe the existing service');
    assert.deepEqual(requests.filter(url => url !== '/api/health'), ['/motion-api/projects', '/api/template-catalog?limit=6', '/design-system/fonts/AlbertSans-VariableFont_wght.ttf']);
    upstream.closeAllConnections();
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    assert.equal((await fetch(base + '/data/motion-api/projects')).status, 503);
  } finally {
    host.closeAllConnections(); upstream.closeAllConnections();
    await Promise.all([new Promise<void>(resolve => host.close(() => resolve())), new Promise<void>(resolve => upstream.close(() => resolve()))]);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('DSH installation selects only an explicit profile and preserves unrelated YAML and installations', async () => {
  const { installationPaths, workspacePatch, installationActive } = await import('../integrations/dsh/install.ts');
  const root = path.resolve('checkout with spaces'), data = path.resolve('workspace data');
  assert.throws(() => installationPaths({ profile: '', dataDirectory: data }), /profile/);
  assert.throws(() => installationPaths({ profile: '../web', dataDirectory: data }), /profile/);
  assert.throws(() => installationPaths({ profile: 'web', dataDirectory: 'relative' }), /absolute/);
  const paths = installationPaths({ profile: 'trial', dataDirectory: data }, { DSH_HOME: path.resolve('isolated host') });
  assert.equal(paths.patch, path.resolve('isolated host/profiles/trial/cordis.patch.yml'));
  const before = '# Keep model configuration\n- id: agent-default-model\n  config:\n    provider: my-provider\n    model: my-model\n';
  const patch = await workspacePatch(before, root, data, process.execPath);
  assert(patch.startsWith(before));
  assert(patch.includes('dist/plugin/lib/index.js'));
  assert(patch.includes('@deepseek-ai/dsh-action-cards'));
  assert(patch.includes('@deepseek-ai/dsh-client-ui-action-cards'));
  const inherited = await workspacePatch(before, root, data, process.execPath, ['@deepseek-ai/dsh-action-cards', '@deepseek-ai/dsh-client-ui-action-cards']);
  assert(!inherited.includes('id: action-cards'), 'Reuse inherited native card capabilities without duplicate services');
  assert.equal(await workspacePatch(patch, root, data, process.execPath), patch, 'Repeated installation is idempotent');
  await assert.rejects(workspacePatch(patch, path.resolve('another checkout'), data, process.execPath), /another OpenMotion/);
  await assert.rejects(workspacePatch('- insert:\n    - id: mcp-openmotion\n      name: bridge\n', root, data, process.execPath), /existing mcp-openmotion/);
  await assert.rejects(workspacePatch('invalid: [', root, data, process.execPath), /Invalid existing/);
  const status = { applicationRoot: root, dataDirectory: data, tools: ['mcp__openmotion__openmotion_get_project', 'mcp__openmotion__openmotion_list_templates'] };
  assert(installationActive(status, root, data));
  assert(!installationActive(status, root, path.resolve('another workspace')));
  assert(!installationActive({ ...status, tools: [] }, root, data));
});
