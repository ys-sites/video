import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationHosts, templatePrompt, type IntegrationInfo } from '../shared/integration.ts';
import { templatePrompts } from '../shared/template-prompts.ts';

test('every catalog source and host copies the same brief with the selected title and ID', () => {
  const templates = [
    { title: 'Magic Share', id: 'motion-1e48dea5-903d-48f6-b10e-99a70f1c183d' },
    { title: 'Literal $& {name}', id: 'another-template' },
  ];
  for (const templateSource of [undefined, 'repository', 'cms'] as const) {
    for (const templateEnvironment of ['dev', 'prod'] as const) {
      const info = { templateSource, templateEnvironment, transport: { env: { MOTION_TEMPLATE_ENV: templateEnvironment } } } as IntegrationInfo;
      for (const host of integrationHosts) {
        for (const template of templates) {
          assert.equal(templatePrompt(info, host, template, 'zh-CN'), [
            '使用说明：请使用 OpenMotion 插件。如未安装，请按 `https://github.com/nexu-io/openmotion` 安装并接入后继续。',
            `指定模板：${template.title}（${template.id}）`,
            '创作要求：基于模板，结合我的要求和附件创作。保留原模板的场景、界面和动画结构（可编辑模板直接原地替换文字与素材），不另写简陋文字卡页面；需要舍弃内容时先说明取舍，并交付 HTML 和 MP4。',
            '我的要求：\n',
          ].join('\n'));
        }
      }
    }
  }
});

test('all localized briefs share the GitHub URL and preserve literal template values across sources', () => {
  const template = { title: 'Literal $& {name}', id: 'literal-$&-{id}' };
  const info = { templateEnvironment: 'prod', transport: { env: {} } } as IntegrationInfo;
  for (const locale of Object.keys(templatePrompts)) {
    const prompt = templatePrompt({ ...info, templateSource: 'repository' }, 'codex', template, locale);
    assert.equal(prompt, templatePrompt({ ...info, templateSource: 'cms' }, 'claude', template, locale));
    assert.ok(prompt.includes('https://github.com/nexu-io/openmotion'));
    assert.ok(prompt.includes(template.title));
    assert.ok(prompt.includes(template.id));
    assert.match(prompt, /HTML.*MP4/);
    assert.doesNotMatch(prompt, /openmotion_get_template|localSource|releases\.open-design\.ai|\{installUrl\}/);
  }
});
