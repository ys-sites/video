import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { platformExportPrompt, platformExportGoals, platformExportTargets, platformExportCanvases, platformExportDurations, platformExportCaptions } from '../shared/platform-export.ts';
import { mcpScenarios, platformExportExample } from '../studio/src/motion/mcpCapabilities.ts';
import { phase1Tools } from '../shared/phase1-tools.ts';

const context = { info: { previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/work space', secret: 'never-copy-credentials' }, project: { id: 'project-a', title: 'Launch' } };
for (const target of platformExportTargets) for (const goal of platformExportGoals) {
  test(`${target.id}/${goal.id}: handoff binds the project and preserves the execution contract`, () => {
    const text = platformExportPrompt({ target: target.id, goal: goal.id, context, notes: '  Keep the original narration.  ' });
    assert.match(text, /^Project: Launch\nProject ID: project-a/);
    for (const value of [target.label, target.aspect, `${target.width}×${target.height}`, '/fixture/work space', '/#project/project-a', 'Keep the original narration.', 'expectedRevision', 'expectedVersionId', 'versionId', 'requestId', 'exportJobId', 'required', 'silent']) assert.ok(text.includes(value), value);
    for (const tool of mcpScenarios.find(scenario => scenario.id === 'platform-export')!.tools) assert.ok(text.includes(tool), tool);
    assert.match(text, /leaving the source unchanged/);
    assert.match(text, /If unavailable.*ask for captions or timecodes/);
    assert.match(text, /never substitute an old file/);
    assert.match(text, /Do not upload or publish/);
    assert.doesNotMatch(text, /never-copy-credentials/);
    if (goal.id === 'adapt') assert.match(text, /original duration/);
    if (goal.id === 'highlights') assert.match(text, /up to three/);
  });
}
test('Chinese prompt and unbound MCP example retain safe project selection and language', () => {
  const text = platformExportPrompt({ target: 'douyin', goal: 'shorten', locale: 'zh-CN', context });
  assert.match(text, /^项目：Launch\n项目 ID：project-a/);
  assert.match(text, /保留源工程不变/);
  assert.match(text, /不自动上传或发布平台/);
  for (const locale of ['en', 'zh-CN', 'ja']) {
    const example = platformExportExample(locale);
    assert.match(example, /openmotion_get_project/);
    assert.match(example, locale === 'zh-CN' ? /让我指定源工程/ : /ask me to identify the source project/);
    assert.ok(example.includes(locale === 'zh-CN' ? 'Douyin' : 'YouTube Shorts'));
    assert.doesNotMatch(example, /Project ID:|项目 ID：/);
  }
});
test('scenario tools are public operations and platform-export guidance is translated in its own resource', () => {
  const translations = JSON.parse(readFileSync(new URL('../studio/src/i18n/platform-export-ui.json', import.meta.url), 'utf8'));
  const publicNames = new Set(phase1Tools.map(tool => tool.name));
  for (const scenario of mcpScenarios) {
    for (const tool of scenario.tools) assert.ok(publicNames.has(tool), tool);
    if (scenario.id !== 'platform-export') continue;
    for (const locale of Object.values(translations) as Record<string, string>[]) {
      assert.ok(locale[scenario.title]); assert.ok(locale[scenario.description]);
    }
  }
});
test('unknown scenarios fail instead of copying a misleading instruction', () => {
  assert.throws(() => platformExportPrompt({ target: 'unknown' as any, goal: 'adapt' }), /Unknown/);
  assert.throws(() => platformExportPrompt({ target: 'douyin', goal: 'unknown' as any }), /Unknown/);
});

for (const canvas of platformExportCanvases) for (const duration of platformExportDurations) for (const captions of platformExportCaptions) {
  test(`configured brief: ${canvas.id}/${duration}/${captions.id}`, () => {
    const options = { canvas: canvas.id, duration, captions: captions.id, clipCount: 2 as const };
    const brief = platformExportPrompt({ target: 'shorts', goal: 'highlights', options });
    assert.ok(brief.includes(`${canvas.width}×${canvas.height}`));
    assert.ok(brief.includes(`${duration} seconds each`)); assert.match(brief, /up to two/);
    assert.ok(brief.includes({ preserve: 'preserve existing captions', add: 'add editable captions', none: 'remove editable caption layers' }[captions.id]));
    const adapted = platformExportPrompt({ target: 'shorts', goal: 'adapt', options });
    assert.match(adapted, /original duration/); assert.ok(!adapted.includes(duration)); assert.doesNotMatch(adapted, /up to two/);
  });
}
test('invalid configuration cannot silently fall back to a different brief', () => {
  for (const options of [{ canvas: '2:3' }, { duration: '999' }, { clipCount: 4 }, { captions: 'invent' }]) {
    assert.throws(() => platformExportPrompt({ target: 'shorts', goal: 'shorten', options: options as any }), /Unknown platform export settings/);
  }
});

test('platform subtitle language requests use shared transcript operations and preserve timing and voice', () => {
  const text = platformExportPrompt({ target: 'shorts', goal: 'highlights', languages: 'English, French', context });
  for (const value of ['English, French', 'action=transcript', 'expectedTranscriptRevision', 'source-relative', 'original voice']) assert.ok(text.includes(value));
});

test('handoff edit and export tracking calls name all required identities', () => {
  for (const locale of ['en', 'zh-CN']) {
    const text = platformExportPrompt({ target: 'shorts', goal: 'adapt', locale, context });
    assert.match(text, /4\.[^\n]*openmotion_edit_project[^\n]*requestId[^\n]*expectedRevision[^\n]*expectedVersionId/);
    assert.match(text, /openmotion_get_project\(projectId, exportJobId\)/);
  }
});
