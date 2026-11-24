import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { designTokens } from './design-tokens.ts';
import { checkComponentUsage } from './check-component-imports.ts';
import { providerIcons, providerIconFiles } from '../packages/design-system/provider-icons.js';
import { platformIconFiles } from '../packages/design-system/platform-icons.js';
import { publicDesignFiles, designSystemRuntimeFiles } from '../packages/design-system/index.js';
import { providerRegistry } from '../shared/provider-registry.ts';

const root = new URL('../', import.meta.url);
const luminance = (hex: string) => {
  const values = hex.slice(1).match(/../g)!.map(value => Number.parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
};
export async function checkDesign() {
  await checkComponentUsage();
  const tokens = await designTokens(true);
  for (const { id } of providerRegistry) {
    assert.ok(Object.hasOwn(providerIcons, id), `Built-in provider ${id} needs an explicit brand or generic icon.`);
  }
  for (const file of [...providerIconFiles, ...platformIconFiles]) {
    assert.ok(publicDesignFiles.includes(file) && designSystemRuntimeFiles.includes(file), `${file} must be served and distributed.`);
    const svg = await readFile(new URL('packages/design-system/' + file, root), 'utf8');
    assert.match(svg, /^<svg\b/);
    assert.doesNotMatch(svg, /<script|<foreignObject|\son[a-z]+\s*=|(?:href|xlink:href)=["'](?:https?:|\/\/)/i, `${file} must remain self-contained static artwork.`);
  }
  for (const license of ['providers/lobe-icons-LICENSE.txt', 'providers/cherry-ui-LICENSE.txt']) {
    assert.ok(designSystemRuntimeFiles.includes(license));
    assert.match(await readFile(new URL('packages/design-system/' + license, root), 'utf8'), /MIT License/);
  }
  assert.deepEqual(Object.keys(tokens.themes.light).sort(), Object.keys(tokens.themes.dark).sort(), 'Both themes need the same semantic colors.');
  const coreAliases = { 'color-surface': 'panel', 'color-text-body': 'text', 'font-sans': 'font-sans', 'radius-button': 'radius-sm', 'color-template-controls-bg': 'gallery-control', 'color-template-text': 'strong' };
  for (const [alias, role] of Object.entries(coreAliases)) assert.equal(tokens.studio[alias], `var(--motion-${role})`, `${alias} must inherit the shared theme`);
  const material = await readFile(new URL('packages/design-system/material.css', root), 'utf8');
  const materialNames = [...material.matchAll(/(--motion-[\w-]+)\s*:/g)].map(match => match[1]);
  const names = new Set([...Object.keys(tokens.shared), ...Object.keys(tokens.themes.light)].map(name => '--motion-' + name).concat(materialNames));
  const consumerFiles = (await Promise.all(['studio/src/', 'web/'].map(async directory =>
    (await readdir(new URL(directory, root), { recursive: true }))
      .filter(file => file.endsWith('.css')).map(file => directory + file)
  ))).flat();
  const sharedNames = new Set([...names, ...Object.keys(tokens.studio).map(name => '--' + name)]);
  for (const file of [...consumerFiles, 'packages/design-system/base.css', 'packages/design-system/material.css', 'packages/design-system/controls.css', 'packages/design-system/catalog.css', 'packages/design-system/loading.css', 'packages/design-system/studio/application.css', 'packages/design-system/studio/adapter.css', 'packages/design-system/studio/control-recipes.css', 'packages/design-system/studio/control-states.css', 'packages/design-system/studio/feedback.css', 'packages/design-system/studio/mcp.css', 'packages/design-system/studio/template-cards.css']) {
    const css = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, `${file}: UI colors belong in tokens.json.`);
    for (const match of css.matchAll(/var\((--motion-[\w-]+)/g)) assert.ok(names.has(match[1]), `${file}: undefined ${match[1]}`);
    if (consumerFiles.includes(file)) {
      for (const match of css.matchAll(/(--[\w-]+)\s*:/g)) {
        assert.ok(!sharedNames.has(match[1]), `${file}: shared role ${match[1]} must be defined in packages/design-system, not overridden by a feature.`);
      }
    }
  }
  for (const [name, value] of Object.entries(tokens.studio) as [string, string][]) {
    for (const match of value.matchAll(/var\((--motion-[\w-]+)/g)) assert.ok(names.has(match[1]), `Studio token ${name}: undefined ${match[1]}`);
  }
  for (const [ink, surface] of [
    ['on-signature-band', 'signature-band'], ['on-signature-band', 'signature-band-hover'],
    ['signature-band-muted', 'signature-band'], ['signature-band-muted', 'signature-band-hover'],
  ]) {
    const a = luminance(tokens.shared[ink]), b = luminance(tokens.shared[surface]);
    assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `shared: ${ink} on ${surface} needs 4.5:1 contrast.`);
  }
  for (const [theme, values] of Object.entries(tokens.themes) as [string, Record<string, string>][]) {
    const textPairs = [
      ['text', 'shell'], ['text', 'workspace'], ['text', 'panel'], ['text', 'inset'],
      ['muted', 'panel'], ['muted', 'workspace'], ['dim', 'panel'], ['dim', 'bg'], ['dim', 'raised'],
      ['attribution-link', 'panel'], ['attribution-link', 'workspace'],
      ['accent', 'accent-soft'], ['on-action', 'action'], ['on-action', 'action-hover'], ['text', 'accent-soft'],
      ['danger', 'danger-soft'], ['on-danger', 'danger'], ['warning', 'warning-soft'], ['strong', 'highlight'],
      ['creative-image', 'raised'], ['creative-video', 'raised'], ['creative-audio', 'raised'], ['creative-agent', 'raised'],
    ];
    if (theme === 'dark') textPairs.push(['accent', 'chrome-active'], ['video-ink', 'accent'], ['placeholder', 'panel']);
    if (theme === 'light') textPairs.push(['accent', 'hover']);
    for (const [ink, surface] of textPairs) {
      const a = luminance(values[ink]), b = luminance(values[surface]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 4.5, `${theme}: ${ink} on ${surface} needs 4.5:1 contrast.`);
    }
    for (const [mark, surface] of [
      ['status-on', 'bg'], ['status-on', 'panel'], ['status-on', 'nav-hover'], ['status-on', 'hover'],
      ['selected', 'workspace'], ['selected', 'raised'], ['selected', 'chrome-active'],
    ]) {
      const a = luminance(values[mark]), b = luminance(values[surface]);
      assert.ok((Math.max(a, b) + .05) / (Math.min(a, b) + .05) >= 3, `${theme}: ${mark} on ${surface} needs 3:1 non-text contrast.`);
    }
  }
  for (const file of ['theme.js', 'catalog.js', 'catalog-view.js', 'token-model.js', 'generate.js']) execFileSync(process.execPath, ['--check', fileURLToPath(new URL('packages/design-system/' + file, root))]);
  console.log('Design token freshness, theme parity, UI color references, contrast, component usage and browser scripts passed.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await checkDesign();
