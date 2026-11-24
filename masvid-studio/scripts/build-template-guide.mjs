import { build } from 'esbuild';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
// Inline the maintained symbol paths so the same icons work inside opaque-origin guide sandboxes.
const sprite = await readFile(new URL('packages/design-system/icons.svg', root), 'utf8');
const icons = Object.fromEntries(['arrow-left-line', 'arrow-right-line', 'refresh-line', 'file-copy-line', 'file-text-line', 'download-2-line', 'external-link-line'].map(name => {
  const symbol = sprite.match(new RegExp('<symbol id="ri-' + name + '"[^>]*>([\\s\\S]*?)</symbol>'));
  if (!symbol) throw new Error('Missing shared guide icon: ' + name);
  return [name, symbol[1]];
}));
await mkdir(new URL('studio/build/guide-assets/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('studio/src/template-guide/page.ts', root))], outfile: fileURLToPath(new URL('studio/build/guide-assets/viewer.js', root)),
  bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true, define: { __OPENMOTION_GUIDE_ICONS__: JSON.stringify(icons) } });
await copyFile(new URL('studio/src/template-guide/page.css', root), new URL('studio/build/guide-assets/viewer.css', root));
