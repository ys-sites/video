import { installationSummary } from '../scripts/install-onboarding.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { persistInstallationOnboarding, resumeInstallationOnboarding } from '../scripts/install-onboarding.mjs';
import { loadTemplatePresentation } from '../shared/mcp-template-recommendations.ts';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const templateIds = ['motion-a28f0e5d-aa8b-45a7-87f9-9afcac65a09b',
  'motion-f6f244d1-c549-4081-8a5d-f0e1e3660044', 'motion-0ad92fd0-b2fb-4885-957c-b71152df15fd'];
const threadId = 'installing-chat', dataDirectory = '/workspace/existing-motion-data';
const presentation = loadTemplatePresentation();
function receipt() {
  return { installationStatus: 'installed', applicationRoot: appRoot, dataDirectory,
    onboardingComplete: false, hostSessionVerified: false, onboardingStatus: 'refresh_requested',
    inlinePresentation: { status: 'native_required', resourceVersion: presentation.resourceVersion,
      resourceUri: presentation.uri, templateIds, language: 'zh' },
    hostHandoff: { threadId, presentation: { tool: 'openmotion_show_template_recommendations',
      arguments: { templateIds, language: 'zh', onboarding: true } } },
    preview: { status: 'ready', previewUrl: 'http://127.0.0.1:4173/?templates=1&embed=1', projectCreated: false } };
}
function connectedHost(directory = dataDirectory, withPresentation = true) {
  const calls: string[] = [];
  const request = async (method: string, params: any) => {
    calls.push(method);
    if (method === 'thread/loaded/list') return { data: [threadId] };
    if (method === 'mcpServerStatus/list') {
      assert.equal(params.threadId, threadId);
      return { data: [{ name: 'openmotion', serverInfo: { version: '0.0.1' },
        tools: { openmotion_get_project: {}, ...(withPresentation ? { openmotion_show_template_recommendations: presentation.tool } : {}) } }] };
    }
    if (method === 'mcpServer/tool/call') {
      assert.equal(params.threadId, threadId);
      return { structuredContent: { dataDirectory: directory } };
    }
    throw new Error('Recovery must not reload or prepare anything: ' + method);
  };
  return { calls, request };
}

test('refresh recovery uses the exact installation selections and workspace without setup or another reload', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-install-receipt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const saved = await persistInstallationOnboarding(receipt(), directory);
  const original = await readFile(saved.detailsFile, 'utf8');
  if (process.platform !== 'win32') assert.equal((await stat(saved.detailsFile)).mode & 0o777, 0o600);
  assert(saved.recovery.args.includes(saved.detailsFile));
  assert(saved.recovery.args.includes('--verify-only'));
  const host = connectedHost();
  const result = await resumeInstallationOnboarding(JSON.parse(original), { appRoot, threadId, request: host.request });
  assert.equal(result.welcomeMarkdown, [
    '🎉 OpenMotion 安装好啦，右侧就是模板库！',
    '我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。',
    '模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！',
  ].join('\n\n'));
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.onboardingStatus, 'awaiting_host_delivery', 'MCP verification does not complete presentation acceptance');
  assert.equal(result.onboardingComplete, false, 'Connection verification is not visible welcome/card delivery');
  assert.deepEqual(result.hostHandoff.presentation.arguments, { templateIds, language: 'zh', onboarding: true });
  assert.deepEqual(result.preview, saved.preview);
  assert.deepEqual(host.calls, ['thread/loaded/list', 'mcpServerStatus/list', 'mcpServer/tool/call']);
  assert.equal(await readFile(saved.detailsFile, 'utf8'), original, 'Recovery must preserve original installation evidence');
});

test('recovery rejects a different chat, changed card bytes and an unsupported selection before contacting a host', async () => {
  const host = connectedHost();
  await assert.rejects(resumeInstallationOnboarding(receipt(), { appRoot, threadId: 'another-chat', request: host.request }), /original chat/);
  const changed = receipt(); changed.inlinePresentation.resourceVersion = '0'.repeat(64);
  await assert.rejects(resumeInstallationOnboarding(changed, { appRoot, threadId, request: host.request }), /card resource changed/);
  const replaced = receipt(); replaced.hostHandoff.presentation.arguments.templateIds = ['product-promo', ...templateIds.slice(1)];
  await assert.rejects(resumeInstallationOnboarding(replaced, { appRoot, threadId, request: host.request }), /curated template/);
  assert.deepEqual(host.calls, []);
});

test('a different connected workspace cannot finish installation recovery', async () => {
  const host = connectedHost('/workspace/another-data');
  const result = await resumeInstallationOnboarding(receipt(), { appRoot, threadId, request: host.request });
  assert.equal(result.hostHandoff.reason, 'HOST_WORKSPACE_MISMATCH');
  assert.equal(result.hostHandoff.automaticActivation, 'blocked');
  assert.equal(result.onboardingStatus, 'awaiting_host_delivery', 'Presentation and automatic activation have independent acceptance states');
  assert.equal(result.onboardingComplete, false);
});

test('activation-only recovery works when card preparation was unavailable', async () => {
  const saved: any = receipt();
  saved.inlinePresentation = { status: 'unavailable', warning: 'Preview assets unavailable' };
  const host = connectedHost(dataDirectory, false);
  const result = await resumeInstallationOnboarding(saved, { appRoot, threadId, request: host.request });
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.onboardingComplete, false);
  assert.equal(result.inlinePresentation.status, 'unavailable');
  assert.equal(result.onboardingStatus, 'awaiting_host_delivery');
});

test('recovery keeps a welcome already delivered and shows only the same three video cards', async () => {
  const host = connectedHost();
  const result = await resumeInstallationOnboarding(receipt(), { appRoot, threadId, request: host.request, welcomeDelivered: true });
  assert.equal(result.hostHandoff.presentation.arguments.onboarding, false);
  assert.equal(result.hostHandoff.welcomeMarkdown, '');
  assert.deepEqual(result.hostHandoff.presentation.arguments.templateIds, templateIds);
});

test('an earlier source-install receipt retains its original chat from the recorded host request', async () => {
  const legacy: any = receipt();
  delete legacy.hostHandoff.threadId;
  legacy.hostHandoff.hostRequests = [{ method: 'mcpServerStatus/list', params: { threadId } }];
  const host = connectedHost();
  const result = await resumeInstallationOnboarding(legacy, { appRoot, threadId, request: host.request });
  assert.equal(result.hostSessionVerified, true);
  assert.deepEqual(result.hostHandoff.presentation.arguments.templateIds, templateIds);
});

// A saved receipt may contain obsolete instructions; recovery must use the current route.
test('installation summary keeps failed library opening truthful and ignores obsolete receipt choreography', () => {
  const saved: any = receipt();
  saved.inlinePresentation = { status: 'prepared', instructions: 'load a hidden tab and call a native tool' };
  saved.preview = { status: 'unavailable', warning: 'Local library startup failed' };
  saved.onboardingStatus = 'preview_unavailable';
  const summary = installationSummary(saved);
  assert.match(summary, /LIBRARY_UNAVAILABLE: Local library startup failed/);
  assert.match(summary, /Installation remains installed/);
  assert.match(summary, /replace the library-visible heading with the actual result/);
  assert.doesNotMatch(summary, /load a hidden tab|entire final reply must be|invoke.*native/);
});

test('only a queued refresh requests one verification command in the summary', () => {
  const saved: any = receipt();
  saved.hostHandoff.status = 'refresh_requested';
  assert.match(installationSummary(saved), /run recovery.command\/recovery.args once/);
  saved.hostHandoff.status = 'ready_for_presentation';
  assert.doesNotMatch(installationSummary(saved), /run recovery.command\/recovery.args once/);
});

test('installation recovery recognizes an aliased workspace directory', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-recovery-alias-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const physical = path.join(directory, 'physical'), alias = path.join(directory, 'alias');
  await mkdir(physical); await symlink(physical, alias, 'junction');
  const saved = { ...receipt(), dataDirectory: alias };
  const host = connectedHost(await realpath(physical));
  const result = await resumeInstallationOnboarding(saved, { appRoot, threadId, request: host.request });
  assert.equal(result.hostSessionVerified, true);
  assert.equal(result.onboardingComplete, false, 'A matching workspace does not prove visible onboarding');
  assert.deepEqual(host.calls, ['thread/loaded/list', 'mcpServerStatus/list', 'mcpServer/tool/call']);
});
