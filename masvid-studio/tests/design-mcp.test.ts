import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { editorBuild, editorDirectory, sharedEditorEnabled } from '../editor-runtime.ts';
import { Phase1Service } from '../phase1.ts';
import { startServer } from '../server.ts';
import { WorkspaceStore } from '../workspace.ts';
import { phase1McpCapabilities, phase1Tools } from '../shared/phase1-tools.ts';
import { createToolRegistry } from '../shared/mcp-registry.ts';
import { DESIGN_TOOL_NAMES, designBriefPrompt, designCommentsPrompt, designProjectPrompt } from '../shared/design-project.ts';
import { setupReadmeUrl, setupSkillUrl } from '../shared/integration.ts';
import { readWorkflowResource, workflowResources } from '../shared/workflow.ts';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

test('MCP registry exposes 34 phase-1 tools including the 12 game and 4 design tools and design workflow resources', async () => {
  assert.equal(phase1Tools.length, 34);
  const registry = createToolRegistry(phase1Tools, 'phase1');
  assert.equal(registry.tools.length, 34);
  for (const name of DESIGN_TOOL_NAMES) {
    assert(registry.tools.some(t => t.name === name), `missing tool ${name}`);
  }
  const resources = workflowResources();
  assert(resources.some(r => r.uri === 'openmotion://workflow/design/start'));
  assert(resources.some(r => r.uri === 'openmotion://workflow/design/iterate'));
  const start = await readWorkflowResource('openmotion://workflow/design/start', os.tmpdir());
  assert(start.text.includes('openmotion_design_project'));
});

test('Phase1Service dispatches all 4 openmotion_design_* tools end-to-end', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'om-design-mcp-'));
  try {
    const store = new WorkspaceStore(dir);
    const service = new Phase1Service(store, dir, {
      origin: () => 'http://127.0.0.1:4321',
      nativeUrl: () => undefined,
      openProject: async () => ({ studioUrl: 'http://127.0.0.1:4321' }),
      exportProject: async () => ({}),
      cancelExport: async () => ({}),
    });

    const cat = await service.call('openmotion_design_catalog', { action: 'list_scenarios' });
    assert.equal(cat.scenarios.length, 7);

    const created = await service.call('openmotion_design_project', {
      action: 'create', requestId: 'mcp-1', scenario: 'prototype', title: 'MCP Prototype', designSystemId: 'apple',
    });
    const pid = created.project.id;
    assert.equal(created.project.title, 'MCP Prototype');

    const edited = await service.call('openmotion_design_edit', {
      action: 'write', projectId: pid, requestId: 'mcp-w1', expectedRevision: created.project.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>From MCP</h1></body></html>' }],
      summary: 'MCP edit',
    });
    assert.equal(edited.version.label, 'v2');

    const comment = await service.call('openmotion_design_comments', {
      action: 'create', projectId: pid, requestId: 'mcp-c1', expectedRevision: edited.project.revision,
      text: 'Make title larger',
      anchor: { filePath: 'index.html', viewport: { id: 'mobile', width: 390, height: 844 } },
    });
    assert.equal(comment.comment.status, 'open');

    const resolved = await service.call('openmotion_design_comments', {
      action: 'update', projectId: pid, commentId: comment.comment.id, status: 'resolved', expectedCommentRevision: 1,
    });
    assert.equal(resolved.comment.status, 'resolved');

    const opened = await service.call('openmotion_design_project', { action: 'open', projectId: pid });
    assert.equal(opened.editorUrl, `http://127.0.0.1:4321/design/projects/${pid}`);
    assert.equal(opened.openComments, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('stdio MCP subprocess runs all 4 openmotion_design_* tools and openmotion-design resources against live server', async t => {
  const studioBuilt = await access(path.join(repoRoot, 'studio/build/index.html')).then(() => true, () => false);
  if (!studioBuilt) { t.skip('studio/build/index.html is not built yet'); return; }

  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'om-design-stdio-mcp-')));
  const store = new WorkspaceStore(dir);
  const token = randomBytes(32).toString('hex');
  const pkgVersion: string = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')).version;
  let running: Awaited<ReturnType<typeof startServer>> | null = null;
  let child: ReturnType<typeof spawn> | null = null;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  try {
    running = await startServer(store, 0, {
      editor: false,
      editorToken: token,
      privateHandler: async (req, res) => {
        if (!req.url?.startsWith('/editor-api/')) return false;
        const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
        if (req.headers.authorization !== `Bearer ${token}`) { json(401, { error: 'Unauthorized' }); return true; }
        if (req.method === 'GET' && req.url === '/editor-api/health') {
          json(200, { service: 'opendesign-editor', protocol: 1, version: pkgVersion, build: editorBuild, instanceId: 'test-stdio', pid: process.pid, dataDirectory: dir, mcp: phase1McpCapabilities });
          return true;
        }
        if (req.method === 'POST' && req.url === '/editor-api/preview') {
          json(200, await running!.info());
          return true;
        }
        return false;
      },
    });
    const port = (running.server.address() as any).port as number;
    const origin = `http://127.0.0.1:${port}/`;
    if (sharedEditorEnabled) {
      const { runtime } = await editorDirectory(dir);
      await writeFile(path.join(runtime, 'runtime.json'), JSON.stringify({
        service: 'opendesign-editor', protocol: 1, version: pkgVersion, build: editorBuild,
        instanceId: 'test-stdio', pid: process.pid, dataDirectory: dir, endpoint: origin, token, mcp: phase1McpCapabilities,
      }), { mode: 0o600 });
    }
    await writeFile(path.join(dir, 'preview.json'), JSON.stringify({ port, pid: process.pid }), { mode: 0o600 });

    child = spawn(process.execPath, ['--experimental-strip-types', path.join(repoRoot, 'mcp.ts')], {
      cwd: repoRoot,
      env: { ...process.env, MOTION_DATA_DIR: dir, PORT: String(port), OPENMOTION_TELEMETRY: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', d => { stderr += d.toString(); });
    let seq = 0;
    createInterface({ input: child.stdout! }).on('line', line => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      const slot = pending.get(msg.id);
      if (slot) {
        clearTimeout(slot.timer);
        pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(JSON.stringify(msg.error)));
        else slot.resolve(msg.result);
      }
    });
    const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => reject(new Error(`MCP timeout for ${method}: ${stderr}`)), 30_000);
      pending.set(id, { resolve, reject, timer });
      child!.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await send('tools/call', { name, arguments: args });
      assert.ok(!res.isError, `Tool ${name} failed: ${JSON.stringify(res)}`);
      return res.structuredContent;
    };

    const init = await send('initialize', { protocolVersion: '2025-11-25', clientInfo: { name: 'codex-test', version: '1.0' } });
    assert.equal(init.serverInfo.version, pkgVersion);

    const listed = await send('tools/list');
    assert.equal(listed.tools.length, 34);
    for (const name of DESIGN_TOOL_NAMES) assert.ok(listed.tools.some((tool: any) => tool.name === name), `missing ${name}`);

    const guide = await send('resources/read', { uri: 'openmotion://workflow/design/start' });
    assert.ok(guide.contents[0].text.includes('openmotion_design_project'));

    const catalog = await call('openmotion_design_catalog', { action: 'list_templates', scenario: 'prototype', limit: 5 });
    assert.ok(catalog.items.length > 0);

    const created = await call('openmotion_design_project', {
      action: 'create', requestId: 'stdio-1', scenario: 'prototype', title: 'Stdio MCP Prototype', designSystemId: 'stripe',
    });
    const pid = created.project.id as string;

    const readRes = await call('openmotion_design_edit', { action: 'read_file', projectId: pid, path: 'index.html' });
    assert.ok(readRes.content.includes('Stdio MCP Prototype'));

    const written = await call('openmotion_design_edit', {
      action: 'write', projectId: pid, requestId: 'stdio-w1', expectedRevision: created.project.revision,
      files: [{ path: 'index.html', content: '<!doctype html><html><body><h1>Stdio Agent Update</h1></body></html>' }],
      summary: 'Agent hero update',
    });
    assert.equal(written.version.label, 'v2');

    const comment = await call('openmotion_design_comments', {
      action: 'create', projectId: pid, requestId: 'stdio-c1', expectedRevision: written.project.revision,
      text: 'Refine CTA spacing',
      anchor: { filePath: 'index.html', viewport: { id: 'desktop', width: 1440, height: 900 } },
    });
    assert.equal(comment.comment.status, 'open');

    const listedComments = await call('openmotion_design_comments', { action: 'list', projectId: pid, status: 'open' });
    assert.equal(listedComments.comments.length, 1);

    const resolved = await call('openmotion_design_comments', {
      action: 'update', projectId: pid, commentId: comment.comment.id, status: 'resolved', expectedCommentRevision: 1,
    });
    assert.equal(resolved.comment.status, 'resolved');

    const versions = await call('openmotion_design_edit', { action: 'list_versions', projectId: pid });
    assert.equal(versions.versions.length, 2);
    const v1 = versions.versions.find((v: any) => v.label === 'v1');
    const restored = await call('openmotion_design_edit', {
      action: 'restore_version', projectId: pid, requestId: 'stdio-r1', versionId: v1.id, expectedRevision: written.project.revision,
    });
    assert.equal(restored.version.label, 'v3');

    const exported = await call('openmotion_design_project', { action: 'export', projectId: pid, format: 'open-design' });
    assert.ok(exported.outputPath.endsWith('.zip'));
    const reimported = await call('openmotion_design_project', { action: 'import', sourcePath: exported.outputPath });
    assert.equal(reimported.projects.length, 1);
    assert.notEqual(reimported.projects[0].id, pid);
  } finally {
    for (const slot of pending.values()) clearTimeout(slot.timer);
    if (child && !child.killed) {
      child.stdin?.end();
      await new Promise<void>(resolve => {
        const t = setTimeout(() => { child?.kill('SIGTERM'); resolve(); }, 1500);
        child!.once('exit', () => { clearTimeout(t); resolve(); });
      });
    }
    if (running) await running.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('Design Studio hand-off prompts include self-contained MCP setup and live workspace guidance', () => {
  const integration = {
    previewUrl: 'http://127.0.0.1:4197',
    dataDirectory: '/tmp/openmotion-data',
  };
  const briefEn = designBriefPrompt({
    scenario: 'prototype',
    brief: 'Build a landing page',
    templateIds: ['saas-landing'],
    skillIds: ['frontend-design'],
    integration,
  });
  for (const needle of [setupSkillUrl, setupReadmeUrl, 'docs/install.md', 'http://127.0.0.1:4197/connect/guide?host=mcp', '/tmp/openmotion-data', 'openmotion_design_catalog', 'openmotion_design_project', 'openmotion_design_edit']) {
    assert.ok(briefEn.includes(needle), `briefEn missing ${needle}`);
  }

  const briefZh = designBriefPrompt({
    scenario: 'document',
    brief: '制作一页产品简历',
    language: 'zh-CN',
    integration,
  });
  assert.ok(briefZh.includes('MCP 安装与接入'));
  assert.ok(briefZh.includes(setupSkillUrl));
  assert.ok(briefZh.includes('http://127.0.0.1:4197/connect/guide?host=mcp'));

  const projectPrompt = designProjectPrompt({ id: 'dp-1', title: 'Pitch', revision: 3, scenario: 'deck' }, 'Refine slide 2', { integration });
  assert.ok(projectPrompt.includes(setupSkillUrl));
  assert.ok(projectPrompt.includes('http://127.0.0.1:4197/connect/guide?host=mcp'));
  assert.ok(projectPrompt.includes('Current revision: 3'));

  const commentsPrompt = designCommentsPrompt(
    { id: 'dp-1', title: 'Pitch', revision: 3 },
    [{ id: 'c-1', projectId: 'dp-1', status: 'open', text: 'Tighten hero spacing', createdAt: 1, updatedAt: 1, commentRevision: 1, anchor: { filePath: 'index.html', viewport: { id: 'desktop', width: 1440, height: 900 } } }],
    undefined,
    { integration },
  );
  assert.ok(commentsPrompt.includes(setupSkillUrl));
  assert.ok(commentsPrompt.includes('openmotion_design_comments'));
});
