import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { difference, scan, summarize } from '../scripts/ui-metrics.ts';
import { classifyStyle } from '../scripts/ui-style-metrics.ts';

test('CSS literals, token fallbacks, mixed values and runtime references', () => {
  const tokens = new Set(['--motion-fg', '--motion-space-4']);
  for (const [key, value, expected] of [
    ['padding', '0 auto', 'standard'], ['padding', 'calc(var(--motion-space-4) * 2)', 'standard'],
    ['font-size', 'var(--local)', 'unknown'], ['left', '9px', undefined], ['border', '1px solid', undefined],
    ['border', '1px solid var(--motion-fg)', 'standard'], ['color', 'var(--motion-fg, salmon)', 'detached'],
    ['background', 'var(--motion-fg, #fff)', 'detached'], ['padding', 'var(--motion-space-4) 7px', 'detached'],
  ]) assert.equal(classifyStyle(key!, value!, tokens), expected, key + ' ' + value);
});

test('adoption follows import identity; deltas preserve duplicates and ignore line shifts', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-metrics-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const write = (file: string, content: string) => {
    const absolute = path.join(dir, file);
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  };
  const tokens = 'packages/design-system/';
  for (const file of ['tokens.css', 'studio/tokens.css', 'material.css', 'tailwind.css', 'studio/palette-reset.css', 'studio/theme.css']) {
    mkdirSync(path.dirname(path.join(dir, tokens, file)), { recursive: true });
    cpSync(new URL('../' + tokens + file, import.meta.url), path.join(dir, tokens, file));
  }
  const source = 'packages/open-design-ui/button.tsx';
  write(source, 'export function Button() { return <button/> }');
  write('packages/open-design-ui/registry.json', JSON.stringify({ items: [{ source, export: 'Button' }] }));
  write('studio/src/ui.ts', "export {Button as Action} from 'open-design-ui/button'");
  write('studio/src/demo.test.tsx', 'export const fixture = <button/>');
  write('studio/src/components/ComponentInspector.tsx', 'export const inspector = <button/>');
  write('web/demo.css', '.card { color:var(--motion-surface); border-radius:9px }');
  write('mcp-ui/cards/build/bundle.css', '.compiled { color: #abc }');
  write('mcp-ui/cards/app.css', '.card { padding: var(--motion-space-4) }');
  const demo = [
    "import * as UI from './ui'; import {Action as A} from './ui';",
    'function Button() {return null;}',
    'export function Demo(){return <><UI.Action/><A/><Button/>',
    '<button role="tab"/><input type={"range"}/>',
    '<div className="text-[11px] gap-2 text-[11px]" style={{color:customColor,padding:7,left:11}}/>',
    '<svg><path className="text-[72px]" /></svg></>}',
  ].join('\n');
  write('studio/src/demo.tsx', demo);
  const before = await scan(dir);
  assert.deepEqual(summarize(before).coverage, { hits: 2, total: 4, percent: 50 });
  assert.equal(before.filter(site => site.value === 'text-[11px]' && site.status === 'detached' && site.line === 5).length, 2);
  assert.ok(before.some(site => site.value === 'gap-2' && site.status === 'standard'));
  assert.ok(before.some(site => site.value === 'padding: 7' && site.status === 'detached'));
  assert.ok(before.some(site => site.value === 'color: customColor' && site.status === 'unknown'));
  assert.ok(!before.some(site => site.value.includes('72px')));
  assert.ok(before.some(site => site.status === 'specialized native'));
  assert.ok(!before.some(site => site.file.includes('/build/')));
  write('studio/src/demo.tsx', '\n' + demo.replace('text-[11px] gap-2', 'gap-2').replace('<button role="tab"/>', '<A/>'));
  const after = await scan(dir);
  assert.deepEqual(difference(before, after).map(site => site.value).sort(), ['button role=tab', 'text-[11px]']);
  assert.deepEqual(difference(after, before).map(site => site.value), ['Button']);
  assert.equal(summarize(after).coverage.percent, 75);
  write('studio/src/demo.tsx', '<><button onClick={() => save()} /><button onClick={event => sample(event.clientX)} /></>');
  assert.deepEqual((await scan(dir)).filter(site => site.kind === 'control').map(site => site.status),
    ['native migration candidate', 'native to review']);
});
