import { expect, it } from 'vitest';
import recoveryUi from './export-recovery-ui.json';
import { languages, translate } from './messages';

it('registers all recovery controls and persistent states in every supported language with intact placeholders', () => {
  const keys = Object.keys(recoveryUi['zh-CN']);
  const placeholders = (text: string) => text.match(/\{\w+\}/g)?.sort() ?? [];
  for (const { locale } of languages) {
    if (locale === 'en') continue;
    expect(Object.keys(recoveryUi[locale]).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const value = recoveryUi[locale][key as keyof typeof recoveryUi['zh-CN']];
      expect(value.trim()).not.toBe('');
      expect(placeholders(value)).toEqual(placeholders(key));
      expect(translate(locale, key)).toBe(value);
    }
  }
  expect(translate('zh-CN', 'Result needs checking')).toBe('结果待核对');
  expect(translate('zh-CN', 'Cancelling…')).toBe('取消中…');
  expect(translate('zh-CN', 'Export current version as a new task')).toBe('将当前版本导出为新任务');
  expect(translate('zh-CN', 'Reload editor')).toBe('刷新编辑器');
});
