import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareInstallationFlow } from '../scripts/install-onboarding.mjs';

test('plugin preparation uses its declared MCP workspace instead of silently selecting the host default', async t => {
  const appRoot = await mkdtemp(path.join(tmpdir(), 'motion-plugin-workspace-'));
  t.after(() => rm(appRoot, { recursive: true, force: true }));
  const dataDirectory = path.join(appRoot, 'selected-data');
  await mkdir(path.join(appRoot, 'docs')); await mkdir(path.join(appRoot, 'scripts'));
  await writeFile(path.join(appRoot, 'docs/install.md'), '<!-- installation-onboarding:start -->Reuse the connection workspace.<!-- installation-onboarding:end -->');
  await writeFile(path.join(appRoot, '.mcp.json'), JSON.stringify({ mcpServers: { openmotion: { cwd: '.', env: { MOTION_DATA_DIR: dataDirectory } } } }));
  await writeFile(path.join(appRoot, 'scripts/open-template-library.ts'), `if(process.env.MOTION_DATA_DIR!==${JSON.stringify(dataDirectory)}) throw new Error('Wrong workspace'); console.log(JSON.stringify({target:'templates',projectCreated:false,previewUrl:'http://127.0.0.1:4173/?templates=1'}));`);
  // This seam tests the workspace/preview protocol without contacting a native
  // host or enqueueing messages in the developer's current chat.
  const result = await prepareInstallationFlow({ appRoot, host: 'workbuddy', templateEnvironment: 'prod', language: 'zh' });
  assert.equal(result.dataDirectory, dataDirectory);
  assert.equal(result.preview.status, 'ready');
  assert.equal(result.onboardingComplete, false);
  assert.equal(result.welcomeMarkdown, [
    '🎉 OpenMotion 安装好啦，右侧就是模板库！',
    '我是你的开源视频创作搭档，我有丰富的高水准视频模板，也支持从参考视频或一个灵感出发，和你一起创作精彩的视频。',
    '模板库支持搜索，也可以随意浏览，找到喜欢的点击「复刻模板」就能开始你的创作！',
  ].join('\n\n'), 'Card delivery failure must leave only the three requested welcome paragraphs');
});
