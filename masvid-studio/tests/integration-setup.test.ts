import test from 'node:test';
import assert from 'node:assert/strict';
import { containerIntegration, integrationConfig, isIntegrationInfo, manualConnection, setupPrompt, setupGuideUrl, templatePrompt, type IntegrationInfo } from '../shared/integration.ts';
import { validateTransport } from '../scripts/check-installed-mcp.mjs';

const info: IntegrationInfo = {
  name: 'OpenMotion', version: '1.0.0', templateSource: 'repository',
  previewUrl: 'http://127.0.0.1:49937', dataDirectory: '/private/project-data', tools: [],
  transport: { type: 'stdio', command: '/private/node', args: ['/private/mcp.ts'], cwd: '/private', env: { MOTION_DATA_DIR: '/private/project-data' } },
};

test('container setup preserves its workspace without launching container-internal paths on the host', () => {
  assert.equal(containerIntegration(info), info);
  const docker = containerIntegration(info, 'openmotion');
  assert.equal(isIntegrationInfo(info), true);
  assert.equal(isIntegrationInfo(docker), true);
  assert.equal(isIntegrationInfo({ ...docker, deployment: undefined }), false);
  assert.equal(isIntegrationInfo({ ...docker, transport: { ...docker.transport, command: 'node' } }), false);
  assert.doesNotThrow(() => validateTransport({ transport: docker.transport }));
  assert.equal(docker.transport.cwd, undefined);
  assert.equal(setupGuideUrl(docker), 'https://github.com/nexu-io/openmotion/blob/main/deploy/README.md');
  for (const host of ['codex', 'claude', 'deepseek', 'mcp'] as const) {
    assert.match(manualConnection(docker, host), /docker/);
    assert.match(integrationConfig(docker, host).text, /docker/);
    assert.doesNotMatch(integrationConfig(docker, host).text, /cwd =|cwd:|undefined/);
    for (const locale of ['en', 'zh-CN'] as const) {
      const prompt = setupPrompt(docker, host, locale);
      assert.match(prompt, /deploy\/README.md/);
      assert.match(prompt, /connect\/config/);
      assert.match(prompt, /skills\/openmotion\/SKILL.md/);
      assert.match(prompt, /openmotion#quick-start/);
      assert.doesNotMatch(prompt, /blob\/main\/install.md/);
    }
    assert.match(setupPrompt(docker, host, 'en'), /same turn.*welcome and video cards.*template library/);
    assert.match(setupPrompt(docker, host, 'en'), /as text only when card presentation is unsupported or fails/);
    assert.match(setupPrompt(docker, host, 'zh-CN'), /本轮完成引导.*欢迎语.*视频推荐卡片.*模板库/);
  }
  assert.deepEqual(docker.transport.args, ['exec', '-i', '--workdir', '/private', '--env', 'MOTION_DATA_DIR=/private/project-data', 'openmotion', '/private/node', '/private/mcp.ts']);
  assert.throws(() => containerIntegration(info, '--privileged'), /Invalid MOTION_CONTAINER_NAME/);
});

test('setup works before local discovery and never copies machine-local details', () => {
  for (const locale of ['en', 'zh-CN'] as const) {
    for (const host of ['codex', 'claude', 'deepseek', 'mcp'] as const) {
      for (const discovery of [null, info]) {
        const prompt = setupPrompt(discovery, host, locale);
        assert.match(prompt, /https:\/\/github.com\/nexu-io\/openmotion#quick-start/);
        assert.ok(prompt.includes(setupGuideUrl(discovery)));
        assert.match(prompt, /openmotion_get_project/);
        assert.doesNotMatch(prompt, /127\.0\.0\.1|localhost|\/connect\/guide|\/private|49937/);
      }
    }
  }
  const prompt = setupPrompt(null, 'codex', 'en');
  assert.match(prompt, /Reuse its workspace/);
  assert.match(prompt, /Install only if missing/);
  assert.match(prompt, /service is stopped/);
  assert.match(prompt, /Configuration alone does not prove connection/);
  assert.match(prompt, /Wait for my creative brief/);
  assert.match(prompt, /same turn/);
  assert.match(prompt, /prepare the shared welcome and video cards/);
  assert.match(setupPrompt(null, 'codex', 'zh-CN'), /在本轮完成引导/);
  for (const host of ['claude', 'deepseek', 'mcp'] as const) {
    assert.match(setupPrompt(null, host, 'en'), /welcome and video cards/);
    assert.match(setupPrompt(null, host, 'zh-CN'), /三张视频推荐卡片/);
  }
});

test('public setup retains repository and published catalog environments', () => {
  assert.equal(setupGuideUrl(null), 'https://github.com/nexu-io/openmotion/blob/main/docs/install.md');
  assert.equal(setupGuideUrl(info), setupGuideUrl(null));
  const published: IntegrationInfo = { ...info, templateSource: 'cms' };
  assert.equal(setupGuideUrl(published), 'https://releases.open-design.ai/open-motion/install.md');
  assert.equal(setupGuideUrl({ ...published, templateEnvironment: 'dev' }), 'https://releases.open-design.ai/open-motion/dev/install.md');
  assert.equal(setupGuideUrl({ ...published, transport: { ...info.transport, env: { ...info.transport.env, MOTION_TEMPLATE_ENV: 'dev' } } }), 'https://releases.open-design.ai/open-motion/dev/install.md');
  assert.equal(setupGuideUrl({ ...info, templateEnvironment: 'dev' }), setupGuideUrl(null));
  assert.match(setupPrompt(null, 'chatgpt', 'en'), /requires a public HTTPS MCP service/);
});

test('template prompt uses the public GitHub link independently of setup guide environments', () => {
  const template = { id: 'prism-a', title: 'Prism A' };
  for (const published of [
    info,
    { ...info, templateSource: 'cms' } as IntegrationInfo,
    { ...info, templateSource: 'cms', templateEnvironment: 'dev' } as IntegrationInfo,
    { ...info, templateSource: 'cms', transport: { ...info.transport, env: { ...info.transport.env, MOTION_TEMPLATE_ENV: 'dev' } } } as IntegrationInfo,
  ]) {
    for (const locale of ['en', 'zh-CN']) {
      const prompt = templatePrompt(published, 'codex', template, locale);
      assert.ok(prompt.includes('https://github.com/nexu-io/openmotion'));
      assert.ok(prompt.includes(template.title) && prompt.includes(template.id));
      assert.doesNotMatch(prompt, /releases\.open-design\.ai/);
    }
  }
});
