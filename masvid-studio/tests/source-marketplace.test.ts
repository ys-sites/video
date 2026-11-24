import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { registerSourceMarketplace, sourceMarketplacePlan } from '../scripts/source-marketplace.mjs';

async function fixture(t: any) {
  const temporary = await mkdtemp(path.join(tmpdir(), 'om-marketplace-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const directory = await realpath(temporary), previous = path.join(directory, 'previous'), root = path.join(directory, 'new');
  for (const source of [previous, root]) {
    await mkdir(path.join(source, '.agents/plugins'), { recursive: true });
    await mkdir(path.join(source, '.codex-plugin'));
    await writeFile(path.join(source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'openmotion' }));
    await writeFile(path.join(source, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'openmotion-local',
      plugins: [{ name: 'openmotion', source: { source: 'local', path: './' } }] }));
  }
  const entry = { pluginId: 'openmotion@openmotion-local', marketplaceSource: { sourceType: 'local', source: previous } };
  return { directory, previous, root, entry };
}

test('an uninstalled, verified local source can be rebound while an installed source is preserved', async t => {
  const { previous, root, entry } = await fixture(t);
  assert.deepEqual(sourceMarketplacePlan(root, { installed: [], available: [entry] }), { action: 'replace_uninstalled_source', previous });
  assert.throws(() => sourceMarketplacePlan(root, { installed: [entry], available: [] }), /OPENMOTION_SOURCE_IN_USE/);
  assert.deepEqual(sourceMarketplacePlan(previous, { installed: [entry], available: [] }), { action: 'reuse' });
});

test('a vanished or non-directory previous source is rebound instead of aborting preflight', async t => {
  const { previous, root, entry } = await fixture(t);
  await rm(previous, { recursive: true, force: true });
  assert.deepEqual(sourceMarketplacePlan(root, { installed: [], available: [entry] }), { action: 'replace_uninstalled_source', previous });
  assert.throws(() => sourceMarketplacePlan(root, { installed: [entry], available: [] }), /OPENMOTION_SOURCE_IN_USE/,
    'installed cached plugins remain protected even after their source disappears');
  await writeFile(previous, 'moved elsewhere');
  assert.deepEqual(sourceMarketplacePlan(root, { installed: [], available: [entry] }), { action: 'replace_uninstalled_source', previous });
  assert.throws(() => sourceMarketplacePlan(root, { installed: [entry], available: [] }), /OPENMOTION_SOURCE_IN_USE/);
});

for (const failure of ['command', 'json', 'shape']) test(`unreadable ${failure} inventory stops without any host mutation and gives a recovery action`, async t => {
  const { directory, root } = await fixture(t);
  const codex = path.join(directory, 'codex'), log = path.join(directory, 'inventory-calls.jsonl');
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
if (${JSON.stringify(failure)} === 'command') process.exit(2);
console.log(${JSON.stringify(failure === 'json' ? 'not-json' : '{"installed":[]}')});
`, { mode: 0o755 });
  for (const checkOnly of [true, false]) {
    assert.throws(() => registerSourceMarketplace(root, { checkOnly, codex }), error => {
      assert.match(String(error), failure === 'command' ? /OPENMOTION_INVENTORY_UNAVAILABLE/ : /OPENMOTION_INVENTORY_INVALID/);
      assert.match(String(error), /codex plugin list/);
      assert.match(String(error), /No host configuration was changed/);
      return true;
    });
  }
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const inventoryReads = calls.filter(args => args[0] === 'plugin');
  assert.equal(inventoryReads.length, 2);
  assert(inventoryReads.every(args => args.join(' ') === 'plugin list --marketplace openmotion-local --available --json'));
  assert(calls.filter(args => args[0] !== 'plugin').every(args => args.join(' ') === 'app-server --stdio'));
});

for (const kind of ['unused', 'installed', 'disabled', 'foreign', 'present']) test(`failed inventory recovery preserves the ${kind} source boundary`, async t => {
  const { directory, previous, root } = await fixture(t);
  if (kind !== 'present') await rm(previous, { recursive: true });
  const codex = path.join(directory, 'codex'), log = path.join(directory, 'recovery.jsonl');
  const config = { marketplaces: { 'openmotion-local': { source_type: kind === 'foreign' ? 'git' : 'local', source: previous } },
    plugins: ['installed', 'disabled'].includes(kind) ? { 'openmotion@openmotion-local': { enabled: kind === 'installed' } } : {} };
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
import readline from 'node:readline';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'app-server') {
  readline.createInterface({input: process.stdin}).on('line', line => {
    const message = JSON.parse(line);
    if (!['initialize', 'config/read'].includes(message.method)) process.exit(9);
    console.log(JSON.stringify({id: message.id, result: message.method === 'config/read' ? {config: ${JSON.stringify(config)}} : {}}));
  });
} else if (args[1] === 'list') process.exit(2);
`, { mode: 0o755 });
  if (kind === 'unused') {
    assert.deepEqual(registerSourceMarketplace(root, { checkOnly: true, codex }), { action: 'replace_uninstalled_source', previous });
    let calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(!calls.some(args => ['remove', 'add'].includes(args[2])), 'recovery preflight must remain read-only');
    registerSourceMarketplace(root, { codex });
    calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.filter(args => ['remove', 'add'].includes(args[2])), [
      ['plugin', 'marketplace', 'remove', 'openmotion-local'], ['plugin', 'marketplace', 'add', root],
    ]);
  } else {
    assert.throws(() => registerSourceMarketplace(root, { codex }), /OPENMOTION_(?:SOURCE_IN_USE|INVENTORY_UNAVAILABLE)/);
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert(!calls.some(args => ['remove', 'add'].includes(args[2])));
  }
});

test('a vanished previous registration is removed and never restored', async t => {
  const { directory, previous, root, entry } = await fixture(t);
  const codex = path.join(directory, 'codex'), log = path.join(directory, 'calls.jsonl');
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[1] === 'list') console.log(${JSON.stringify(JSON.stringify({ installed: [], available: [entry] }))});
if (args[2] === 'add' && args[3] === ${JSON.stringify(root)}) process.exit(2);
`, { mode: 0o755 });
  await rm(previous, { recursive: true, force: true });
  assert.equal(registerSourceMarketplace(root, { checkOnly: true, codex }).action, 'replace_uninstalled_source');
  assert.throws(() => registerSourceMarketplace(root, { codex }));
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.filter(args => args[1] !== 'list'), [['plugin', 'marketplace', 'remove', 'openmotion-local'], ['plugin', 'marketplace', 'add', root]],
    'a source that no longer exists must not be restored after a failed add');
});

test('foreign entries, unknown sources and unrecognized catalogs are never replaced', async t => {
  const { previous, root, entry } = await fixture(t);
  for (const changed of [
    { ...entry, pluginId: 'someone-else@openmotion-local' },
    { ...entry, marketplaceSource: { sourceType: 'git', source: previous } },
  ]) assert.throws(() => sourceMarketplacePlan(root, { installed: [], available: [changed] }), /Refusing/);
  await writeFile(path.join(previous, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'other', plugins: [] }));
  assert.throws(() => sourceMarketplacePlan(root, { installed: [], available: [entry] }), /unrecognized/);
});

for (const fail of [false, true]) test(`registration ${fail ? 'restores the previous source after an add failure' : 'rebinds only the uninstalled OpenMotion source'}`, async t => {
  const { directory, previous, root, entry } = await fixture(t);
  const codex = path.join(directory, 'codex'), log = path.join(directory, 'calls.jsonl');
  await writeFile(codex, `#!${process.execPath}
import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[1] === 'list') console.log(${JSON.stringify(JSON.stringify({ installed: [], available: [entry] }))});
if (${fail} && args[2] === 'add' && args[3] === ${JSON.stringify(root)}) process.exit(2);
`, { mode: 0o755 });
  assert.equal(registerSourceMarketplace(root, { checkOnly: true, codex }).action, 'replace_uninstalled_source');
  let calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.length, 1, 'preflight must not modify host configuration');
  if (fail) assert.throws(() => registerSourceMarketplace(root, { codex }));
  else assert.equal(registerSourceMarketplace(root, { codex }).action, 'replace_uninstalled_source');
  calls = (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(calls.slice(2), [
    ['plugin', 'marketplace', 'remove', 'openmotion-local'],
    ['plugin', 'marketplace', 'add', root],
    ...(fail ? [['plugin', 'marketplace', 'add', previous]] : []),
  ]);
  assert.equal(calls.some(args => args.includes('uninstall')), false);
});
