import { expect, it } from 'vitest';
import recoveryUi from './import-recovery-ui.json';
import { languages, translate } from './messages';

it('localizes manual-import recovery in every supported language with intact file identities and counts', () => {
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
  expect(translate('zh-CN', 'Imported {added}/{total} files', { added: 2, total: 3 })).toBe('已导入 2/3 项');
  expect(translate('zh-CN', 'Choose replacement for {name}', { name: '坏片段.mp4' })).toBe('为 坏片段.mp4 重新选择文件');
});
