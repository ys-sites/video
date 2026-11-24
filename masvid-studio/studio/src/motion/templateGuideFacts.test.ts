// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { templateGuideFacts } from './templateGuideFacts';
import { templateSubmissionPrompt } from './templateContribution';

it('uses only authored palette entries, ignoring unrelated presets and invalid colors', () => {
  const facts = templateGuideFacts(`<div data-color="#999999"></div><div class="palette">
    <button data-color="#ff6b4c"></button><button data-color="#151616"></button>
    <button data-color="#ff6b4c"></button><button data-color="url(https://example.com)"></button></div>
    <figure data-demo='{"params":[{"type":"color"}]}'></figure>`);
  expect(facts).toEqual({ palette: ['#ff6b4c', '#151616'], editableDemo: true });
});
it('does not promise an editable demonstration from an absent or malformed guide', () => {
  expect(templateGuideFacts('<figure data-demo="broken"></figure>')).toEqual({ palette: [], editableDemo: false });
});
it('retains the selected brief and explains additional contribution work in both primary languages', () => {
  const zh = templateSubmissionPrompt('指定模板：exact-id', 'zh-CN');
  expect(zh).toContain('指定模板：exact-id'); expect(zh).toContain('可复用'); expect(zh).toContain('不要合并');
  const en = templateSubmissionPrompt('Selected template: exact-id', 'en');
  expect(en).toContain('Selected template: exact-id'); expect(en).toContain('reusable'); expect(en).toContain('Do not merge');
});
