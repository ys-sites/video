import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = new URL('../packages/design-system/', import.meta.url);
export interface DesignTokens {
  shared: Record<string, string>;
  themes: { light: Record<string, string>; dark: Record<string, string> };
  studio: Record<string, string>;
}

export { renderDesignTokens } from '../packages/design-system/generate.js';
import { renderDesignTokens } from '../packages/design-system/generate.js';
import { renderPageMetadata } from '../packages/design-system/metadata.js';

export async function designTokens(checkOnly = false) {
  const tokens = JSON.parse(await readFile(new URL('tokens.json', directory), 'utf8'));
  for (const [file, css] of Object.entries(renderDesignTokens(tokens) as Record<string, string>)) {
    if (checkOnly) {
      if (await readFile(new URL(file, directory), 'utf8') !== css) throw new Error(`${file} is stale. Run npm run design:tokens.`);
    } else await writeFile(new URL(file, directory), css);
  }
  // Stable documentation/plugin paths are generated mirrors, never editable sources.
  const mirrors: [source: string, target: string][] = [
    ['brand/openmotion-logo.svg', '../../docs/readme/openmotion-logo.svg'],
    ['brand/favicon.svg', '../../studio/public/favicon.svg'],
    // The growth-teardown Skill ships these marks for standalone installs.
    ['brand/openmotion-logo.svg', '../../library/skills/openmotion-growth-teardown/assets/brand/openmotion-logo.svg'],
    ['brand/loading-mark.svg', '../../library/skills/openmotion-growth-teardown/assets/brand/loading-mark.svg'],
    // The design-styles Skill ships the same marks for its opening and end credit.
    ['brand/openmotion-logo.svg', '../../library/skills/openmotion-design-styles/assets/brand/openmotion-logo.svg'],
    ['brand/loading-mark.svg', '../../library/skills/openmotion-design-styles/assets/brand/loading-mark.svg'],
    // The sale-carousel Skill ships the same marks for its end-card sign-off.
    ['brand/openmotion-logo.svg', '../../library/skills/openmotion-sale-carousel/assets/brand/openmotion-logo.svg'],
    ['brand/loading-mark.svg', '../../library/skills/openmotion-sale-carousel/assets/brand/loading-mark.svg'],
    // The sale-countdown Skill ships the same marks for its end-card sign-off.
    ['brand/openmotion-logo.svg', '../../library/skills/openmotion-sale-countdown/assets/brand/openmotion-logo.svg'],
    ['brand/loading-mark.svg', '../../library/skills/openmotion-sale-countdown/assets/brand/loading-mark.svg'],
    // The sale-promo Skill ships the same marks for its end-card sign-off.
    ['brand/openmotion-logo.svg', '../../library/skills/openmotion-sale-promo/assets/brand/openmotion-logo.svg'],
    ['brand/loading-mark.svg', '../../library/skills/openmotion-sale-promo/assets/brand/loading-mark.svg'],
    ['fonts/NOTICES.txt', '../../web/design-system/fonts/NOTICES.txt'],
    ['fonts/Albert-Sans-OFL.txt', '../../web/design-system/fonts/Albert-Sans-OFL.txt'],
    ['fonts/IBM-Plex-Mono-OFL.txt', '../../web/design-system/fonts/IBM-Plex-Mono-OFL.txt'],
  ];
  for (const [source, target] of mirrors) {
    const data = await readFile(new URL(source, directory));
    if (checkOnly) {
      if (!data.equals(await readFile(new URL(target, directory)))) throw new Error(`${target} is stale. Run npm run design:tokens.`);
    } else await writeFile(new URL(target, directory), data);
  }
  for (const [file, surface] of [['../../studio/index.html', 'studio'], ['index.html', 'design-system']]) {
    const url = new URL(file, directory);
    const html = await readFile(url, 'utf8');
    const block = /<!-- openmotion:metadata -->[\s\S]*?<!-- \/openmotion:metadata -->/;
    if (!block.test(html)) throw new Error(`${file} is missing its generated metadata block.`);
    const theme = surface === 'studio' ? `\n<meta name="theme-color" content="${tokens.themes.dark.shell}" data-light="${tokens.themes.light.shell}" data-dark="${tokens.themes.dark.shell}" />` : '';
    const generated = html.replace(block, `<!-- openmotion:metadata -->\n${renderPageMetadata('zh-CN', surface)}${theme}\n<!-- /openmotion:metadata -->`);
    if (checkOnly) {
      if (html !== generated) throw new Error(`${file} metadata is stale. Run npm run design:tokens.`);
    } else await writeFile(url, generated);
  }
  return tokens;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await designTokens(process.argv.includes('--check'));
  console.log(process.argv.includes('--check') ? 'Design tokens are in sync.' : 'Generated shared and Studio design tokens and compatibility assets.');
}
