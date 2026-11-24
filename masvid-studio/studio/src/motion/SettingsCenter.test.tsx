// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import readme from '../../../README.md?raw';
import chineseReadme from '../../../README.zh-CN.md?raw';
import { I18nProvider } from '../i18n/I18n';
import { SettingsCenter } from './SettingsCenter';

it.each([
  { locale: 'zh-CN', heading: '社群', labels: ['飞书群', 'Discord'], document: chineseReadme, platforms: ['飞书群', 'Discord'] },
  { locale: 'en', heading: 'Community', labels: ['Discord', 'Feishu group'], document: readme, platforms: ['Discord', 'Feishu'] },
] as const)('offers both README invitations in locale order from Help in $locale', ({ locale, heading, labels, document, platforms }) => {
  const html = renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SettingsCenter section="help" onSection={() => {}} openConnections={() => {}} />
    </I18nProvider>,
  );
  const page = new DOMParser().parseFromString(html, 'text/html');
  const section = page.querySelector('section[aria-labelledby="om-community-heading"]');
  expect(section?.querySelector('h2')?.textContent).toBe(heading);
  const links = Array.from(section!.querySelectorAll('a'));
  expect(links.map(link => link.textContent)).toEqual(labels);
  for (const [index, link] of links.entries()) {
    expect(document).toContain(`[${platforms[index]}](${link.href})`);
    expect(link.target).toBe('_blank');
    expect(link.relList.contains('noopener')).toBe(true);
  }
});
