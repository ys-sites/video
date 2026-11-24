import { onboardingTemplateIds } from '../shared/onboarding-templates.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises, { mkdtemp, writeFile, readFile, rm, copyFile, symlink, realpath, mkdir, chmod } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareCodexHostHandoff } from '../scripts/codex-host-handoff.mjs';

const threadId = 'current-chat';
const dataDirectory = '/workspace/openmotion-data';
function host({ tools = true, directory = dataDirectory, loaded = true, denied = false, acceptedIds = undefined as string[] | undefined } = {}) {
  const calls: any[] = [];
  const request = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'thread/loaded/list') return { data: loaded ? [threadId] : [], nextCursor: null };
    if (method === 'config/mcpServer/reload') return {};
    if (method === 'mcpServerStatus/list') return { data: [{ name: 'openmotion',
      tools: tools ? { openmotion_get_project: {}, openmotion_show_template_recommendations: { inputSchema: { properties: { templateIds: { items: { enum: acceptedIds } } } } } } : {},
      serverInfo: { name: 'openmotion', version: '0.0.1' } }], nextCursor: null };
    if (method === 'mcpServer/tool/call') {
      if (denied) throw Object.assign(new Error('Host denied the read'), { code: -32000 });
      return { content: [], structuredContent: { dataDirectory: directory } };
    }
    throw new Error('Unexpected method: ' + method);
  };
  return { calls, request };
}

test('a healthy calling chat is verified without an unnecessary reload', async () => {
  const { request, calls } = host();
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, expectedVersion: '0.0.1', request, language: 'zh', templateIds: onboardingTemplateIds.slice(-3) });
  assert.equal(result.status, 'ready_for_presentation');
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.presentationVerified, false);
  assert.deepEqual(calls.map(call => call.method), ['thread/loaded/list',
    'mcpServerStatus/list', 'mcpServer/tool/call']);
  assert.equal(calls[1].params.threadId, threadId);
  assert.equal(calls[2].params.threadId, threadId);
  assert.equal(calls[2].params.tool, 'openmotion_get_project');
  assert.deepEqual(result.presentation.arguments, { templateIds: onboardingTemplateIds.slice(-3),
    onboarding: true, language: 'zh' });
  assert.match(result.welcomeMarkdown, /我是你的开源视频创作搭档/);
});

test('builtin-only stale native discovery cannot accept curated reference cards', async () => {
  const { request, calls } = host({ acceptedIds: ['product-promo', 'nyt-graph', 'decision-tree'] });
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, request, templateIds: onboardingTemplateIds.slice(0, 3) });
  assert.equal(result.status, 'refresh_requested');
  assert.equal(result.reason, 'NATIVE_PRESENTATION_SELECTION_UNSUPPORTED');
  assert.deepEqual(result.presentation.arguments.templateIds, onboardingTemplateIds.slice(0, 3));
  assert.equal(calls.some(call => call.method === 'mcpServer/tool/call'), false);
});

test('the same package version with an outdated card resource queues activation', async () => {
  const { request, calls } = host();
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, request,
    expectedResourceUri: 'ui://openmotion/template-recommendations/current/index.html' });
  assert.equal(result.status, 'refresh_requested');
  assert.equal(result.reason, 'NATIVE_PRESENTATION_RESOURCE_MISMATCH');
  assert.equal(result.hostSessionVerified, false);
  assert.deepEqual(calls.map(call => call.method), ['thread/loaded/list', 'mcpServerStatus/list', 'config/mcpServer/reload']);
});

test('an explicit builtin document can verify domain MCP without requiring the native card extension', async () => {
  const fixture = host();
  const request = async (method: string, params: any) => {
    const result = await fixture.request(method, params);
    if (method === 'mcpServerStatus/list') delete result.data[0].tools.openmotion_show_template_recommendations;
    return result;
  };
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, requirePresentation: false, request });
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.automaticActivation, 'verified');
  assert.match(result.nextAction, /prepared HTML/);
  assert.doesNotMatch(result.nextAction, /invoke.*(?:presentation tool|native Tool)/);
  assert.equal(fixture.calls.some(call => call.method === 'config/mcpServer/reload'), false);
});

test('queued refresh is incomplete; a later verification never reloads or presents again', async () => {
  const first = host({ tools: false });
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, request: first.request });
  assert.equal(result.status, 'refresh_requested');
  assert.equal(result.hostSessionVerified, false);
  assert.equal(first.calls.some(call => call.method === 'mcpServer/tool/call'), false);
  const second = host();
  const verified = await prepareCodexHostHandoff({ threadId, dataDirectory, verifyOnly: true, request: second.request });
  assert.equal(verified.status, 'ready_for_presentation');
  assert.equal(second.calls.some(call => call.method === 'config/mcpServer/reload'), false);
});

test('an unrelated daemon must not be refreshed or receive project calls', async () => {
  const { request, calls } = host({ loaded: false });
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory, request });
  assert.equal(result.status, 'host_action_required');
  assert.equal(result.reason, 'CURRENT_CHAT_NOT_LOADED');
  assert.deepEqual(calls.map(call => call.method), ['thread/loaded/list']);
});

test('missing native host access remains explicit and never starts another app-server', async () => {
  const result = await prepareCodexHostHandoff({ threadId, dataDirectory,
    socketPath: '/nonexistent/openmotion-host.sock', env: {} });
  assert.equal(result.status, 'host_action_required');
  assert.equal(result.reason, 'HOST_CONTROL_UNAVAILABLE');
  assert.equal(result.hostSessionVerified, false);
  assert.equal(result.presentationVerified, false);
  assert.equal(result.hostRequests[0].method, 'config/mcpServer/reload');
  assert.equal(result.hostRequests[1].params.threadId, threadId);
});

test('workspace mismatch and host policy rejection cannot become onboarding success', async () => {
  for (const fixture of [host({ directory: '/other-workspace' }), host({ denied: true })]) {
    const result = await prepareCodexHostHandoff({ threadId, dataDirectory, request: fixture.request });
    assert.equal(result.status, 'host_action_required');
    assert.equal(result.hostSessionVerified, false);
    assert.equal(result.presentationVerified, false);
    assert.equal(fixture.calls.filter(call => call.method === 'mcpServer/tool/call').length, 1);
  }
});

test('without a current chat, no host is mutated and the welcome language follows the request', async () => {
  const { request, calls } = host();
  const result = await prepareCodexHostHandoff({ env: {}, dataDirectory, request, language: 'ja' });
  assert.equal(result.status, 'host_action_required');
  assert.equal(result.reason, 'CURRENT_CHAT_UNKNOWN');
  assert.equal(calls.length, 0);
  assert.equal(result.presentation.arguments.language, 'ja');
});

test('the CLI proxy transport initializes the existing host and closes without starting another server', async t => {
  if (process.platform === 'win32') { t.skip('Unix control socket adapter'); return; }
  const directory = await mkdtemp(path.join(tmpdir(), 'om-host-'));
  const socketPath = path.join(directory, 'control.sock');
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once('error', reject); socket.listen(socketPath, resolve); });
  const resolvedSocketPath = await realpath(socketPath);
  const controlDirectory = path.join(directory, 'app-server-control');
  await mkdir(controlDirectory, { mode: 0o700 });
  const linkedSocketPath = path.join(controlDirectory, 'app-server-control.sock');
  await symlink('../control.sock', linkedSocketPath);
  const chainedSocketPath = path.join(directory, 'chained.sock');
  await symlink('app-server-control/app-server-control.sock', chainedSocketPath);
  const log = path.join(directory, 'calls.jsonl');
  const codex = path.join(directory, 'codex');
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
import readline from 'node:readline';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({argv:process.argv.slice(2)})+'\\n');
for await (const line of readline.createInterface({input:process.stdin})) {
  const call=JSON.parse(line);
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({method:call.method})+'\\n');
  if(call.id===undefined) continue;
  let result={};
  if(call.method==='thread/loaded/list') result={data:[${JSON.stringify(threadId)}]};
  if(call.method==='mcpServerStatus/list') result={data:[{name:'openmotion',serverInfo:{version:'0.0.1'},tools:{openmotion_get_project:{},openmotion_show_template_recommendations:{}}}]};
  if(call.method==='mcpServer/tool/call') result={content:[],structuredContent:{dataDirectory:${JSON.stringify(dataDirectory)}}};
  process.stdout.write(JSON.stringify({id:call.id,result})+'\\n');
}
`, { mode: 0o755 });
  try {
    const javascriptCli = path.join(directory, 'codex.mjs');
    await copyFile(codex, javascriptCli);
    for (const executable of [codex, javascriptCli]) {
      for (const entry of [linkedSocketPath, socketPath, chainedSocketPath]) {
        await writeFile(log, '');
        const result = await prepareCodexHostHandoff({ threadId, dataDirectory, codex: executable, socketPath: entry,
          expectedVersion: '0.0.1', language: 'zh', timeoutMs: 5000 });
        assert.equal(result.status, 'ready_for_presentation', JSON.stringify({ result, log: await readFile(log, 'utf8').catch(() => '') }));
        const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
        assert.deepEqual(calls[0].argv, ['app-server', 'proxy', '--sock', resolvedSocketPath]);
        assert.deepEqual(calls.slice(1).map(call => call.method), ['initialize', 'initialized', 'thread/loaded/list',
          'mcpServerStatus/list', 'mcpServer/tool/call']);
        assert.equal(calls.some(call => call.method === 'openmotion_show_template_recommendations'), false);
      }
    }
    await t.test('the profile default resolves its existing socket symlink', async () => {
      await writeFile(log, '');
      const result = await prepareCodexHostHandoff({ threadId, dataDirectory, codex,
        env: { ...process.env, CODEX_HOME: directory, OPENMOTION_CODEX_SOCKET: undefined } });
      assert.equal(result.status, 'ready_for_presentation');
      assert.deepEqual(JSON.parse((await readFile(log, 'utf8')).split('\n')[0]).argv,
        ['app-server', 'proxy', '--sock', resolvedSocketPath]);
    });
    const dangling = path.join(directory, 'dangling.sock'), loop = path.join(directory, 'loop.sock');
    await symlink('missing.sock', dangling);
    await symlink('loop.sock', loop);
    for (const [name, target] of [['file', codex], ['directory', controlDirectory], ['dangling', dangling], ['loop', loop]]) {
      await t.test('rejects a ' + name + ' target without launching the proxy', async () => {
        const entry = path.join(directory, name + '-link.sock');
        await symlink(target, entry);
        await writeFile(log, '');
        const result = await prepareCodexHostHandoff({ threadId, dataDirectory, codex, socketPath: entry });
        assert.equal(result.reason, 'HOST_CONTROL_UNAVAILABLE');
        assert.equal(await readFile(log, 'utf8'), '');
      });
    }
    for (const mode of [0o720, 0o702]) await t.test('rejects a writable socket directory: ' + mode.toString(8), async () => {
      await writeFile(log, '');
      await chmod(directory, mode);
      try {
        const result = await prepareCodexHostHandoff({ threadId, dataDirectory, codex, socketPath: linkedSocketPath });
        assert.equal(result.reason, 'HOST_CONTROL_UNAVAILABLE');
        assert.equal(await readFile(log, 'utf8'), '');
      } finally { await chmod(directory, 0o700); }
    });
    for (const [name, target] of [['entry', linkedSocketPath], ['socket', resolvedSocketPath], ['directory', path.dirname(resolvedSocketPath)]]) {
      await t.test('rejects foreign ownership: ' + name, async t => {
        await writeFile(log, '');
        const original = fsPromises.lstat;
        const mocked = t.mock.method(fsPromises, 'lstat', async file => {
          const info = await original(file);
          return file === target ? Object.assign(Object.create(info), { uid: info.uid + 1 }) : info;
        });
        syncBuiltinESMExports();
        try {
          const result = await prepareCodexHostHandoff({ threadId, dataDirectory, codex, socketPath: linkedSocketPath });
          assert.equal(result.reason, 'HOST_CONTROL_UNAVAILABLE');
          assert.equal(await readFile(log, 'utf8'), '');
        } finally { mocked.mock.restore(); syncBuiltinESMExports(); }
      });
    }
  } finally {
    await new Promise<void>(resolve => socket.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
