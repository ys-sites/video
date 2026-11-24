import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectPackage, lockPackage, manifestName, packPackage } from '../packages/motion-package/index.mjs';
import { distributionDocuments } from '../scripts/distribution.ts';

const source = path.resolve('packages/motion-package/examples/product-story');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const invoke = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-package-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'product-story');
  await cp(source, root, { recursive: true });
  return { directory, root };
}

async function editManifest(root, edit) {
  const manifest = await json(path.join(root, manifestName));
  edit(manifest);
  await writeFile(path.join(root, manifestName), JSON.stringify(manifest));
}

test('a portable sample preserves bytes, local document links and both independent briefs', async t => {
  const { directory, root } = await fixture(t);
  const before = await inspectPackage(root);
  // Unlisted files and scripts must never become part of a handoff.
  await writeFile(path.join(root, '.env'), 'UNLISTED_SENTINEL=private');
  await writeFile(path.join(root, 'unlisted.mjs'), 'throw new Error("must not run")');
  const target = path.join(directory, 'delivery');
  await packPackage(root, target);
  await rm(root, { recursive: true });
  const after = await inspectPackage(target);
  assert.deepEqual(after.manifest, before.manifest);
  for (const [name, item] of before.entries) assert.deepEqual(after.entries.get(name).bytes, item.bytes);
  await assert.rejects(readFile(path.join(target, '.env')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(target, 'unlisted.mjs')), { code: 'ENOENT' });
  for (const [name, file] of after.entries) {
    if (!name.endsWith('.md')) continue;
    for (const match of file.bytes.toString().matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(match[1])) continue;
      const linked = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1].split('#')[0]));
      assert(after.entries.has(linked) || linked === manifestName, `${name} has an unavailable reference: ${linked}`);
    }
  }
  const plans = ['product', 'lesson'].map(preset => {
    const result = invoke('scripts/plan.mjs', [`presets/${preset}.json`], target);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.notEqual(plans[0].subject, plans[1].subject);
  assert.notDeepEqual(plans[0].scenes.map(scene => scene.text), plans[1].scenes.map(scene => scene.text));
  assert.deepEqual(plans[0].scenes.map(({ text, ...timing }) => timing), plans[1].scenes.map(({ text, ...timing }) => timing));
  assert.equal(plans[0].status, 'plan-only');
});

test('checking detects changed bytes; explicit lock refreshes only listed files', async t => {
  const { root } = await fixture(t);
  const file = path.join(root, 'MOTION.md');
  await writeFile(file, (await readFile(file, 'utf8')) + '\nAn intentional revision.\n');
  await assert.rejects(inspectPackage(root), /Hash mismatch/);
  await writeFile(path.join(root, 'extra.txt'), 'not automatically adopted');
  await lockPackage(root);
  const result = await inspectPackage(root);
  assert(!result.entries.has('extra.txt'));
  await rm(path.join(root, 'DESIGN.md'));
  await assert.rejects(lockPackage(root), { code: 'ENOENT' });
});

test('legacy motion names, prose-only design and a package without a Skill are accepted explicitly', async t => {
  const { root } = await fixture(t);
  await cp(path.join(root, 'MOTION.md'), path.join(root, 'MOTION_DESIGN.md'));
  await editManifest(root, manifest => {
    manifest.motion = 'MOTION_DESIGN.md';
    manifest.files.find(file => file.path === 'MOTION.md').path = manifest.motion;
    manifest.design.format = 'markdown';
    delete manifest.design.specVersion;
    delete manifest.skill;
    manifest.files = manifest.files.filter(file => file.role !== 'skill');
    manifest.extensions['org.example'] = { industry: 'education' };
  });
  const result = await inspectPackage(root);
  assert.equal(result.manifest.motion, 'MOTION_DESIGN.md');
  assert.deepEqual(result.manifest.extensions['org.example'], { industry: 'education' });
});

test('invalid manifests, entry roles, dependency declarations and path escapes are rejected', async t => {
  const cases = [
    [m => { m.specVersion = '99'; }, /expected 0.2/],
    [m => { m.motin = m.motion; }, /unknown field/],
    [m => { m.version = '^1.0.0'; }, /invalid format/],
    [m => { m.motion = 'missing.md'; }, /Unlisted reference/],
    [m => { m.motion = 'LICENSE'; }, /Expected motion role/],
    [m => { delete m.design.specVersion; }, /requires an upstream specVersion/],
    [m => { m.dependencies[0].version = 'latest'; }, /invalid format/],
    [m => { m.dependencies.push(m.dependencies[0]); }, /Duplicate dependency/],
    [m => { m.dependencies[0].kind = 'motion-package'; }, /needs a local entry/],
    [m => { m.extends = ['MOTION.md']; }, /Expected reference role/],
    [m => { m.files.push(m.files[0]); }, /colliding path/],
    [m => { m.files[0].path = manifestName; }, /colliding path/],
    ...['../outside', '/tmp/file', 'C:/file', 'a\\b', 'a//b', 'a/../b', 'a/%2e%2e/b', 'a?b', 'a#b', 'CON.txt', 'foo.'].map(name =>
      [m => { m.files[0].path = name; }, /invalid format|Non-portable/]),
  ];
  for (const [edit, expected] of cases) {
    const { root } = await fixture(t);
    await editManifest(root, edit);
    await assert.rejects(inspectPackage(root), expected);
  }
});

test('case-colliding directories and file or directory symlinks cannot enter the inventory', async t => {
  const { root, directory } = await fixture(t);
  await editManifest(root, manifest => {
    manifest.files.find(file => file.path === 'presets/product.json').path = 'Presets/product.json';
  });
  await assert.rejects(inspectPackage(root), /colliding path/);
  await cp(source, root, { recursive: true });
  await rm(path.join(root, 'DESIGN.md'));
  await symlink(path.join(source, 'DESIGN.md'), path.join(root, 'DESIGN.md'));
  await assert.rejects(inspectPackage(root), /ordinary package file/);
  await rm(path.join(root, 'DESIGN.md'));
  await cp(path.join(source, 'DESIGN.md'), path.join(root, 'DESIGN.md'));
  await cp(path.join(root, 'presets'), path.join(directory, 'presets'), { recursive: true });
  await rm(path.join(root, 'presets'), { recursive: true });
  await symlink(path.join(directory, 'presets'), path.join(root, 'presets'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(inspectPackage(root), /ordinary package file/);
});

test('packing never overwrites an existing destination or writes into the source', async t => {
  const { root, directory } = await fixture(t);
  const destination = path.join(directory, 'owned');
  await mkdir(destination);
  await writeFile(path.join(destination, 'keep.txt'), 'keep');
  await assert.rejects(packPackage(root, destination), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(packPackage(root, path.join(root, 'nested')), /outside the source/);
  await assert.rejects(packPackage(root, root), /outside the source/);
  const normalized = path.join(directory, 'normalized');
  const normalizedResult = await packPackage(root, normalized + '/.');
  assert.equal(normalizedResult.destination, await realpath(normalized));
  const link = path.join(directory, 'linked');
  await symlink(destination, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(packPackage(root, link), { code: 'EEXIST' });
  await editManifest(root, manifest => { manifest.files[0].sha256 = '0'.repeat(64); });
  await assert.rejects(packPackage(root, path.join(directory, 'bad')), /Hash mismatch/);
  assert(!(await readdir(directory)).includes('bad'));
});

test('plan helper rejects missing, unknown, blank and overflowing inputs without creating output', async t => {
  const { root } = await fixture(t);
  const preset = await json(path.join(root, 'presets/product.json'));
  for (const value of [null, { ...preset, headline: '' }, { ...preset, headline: ' ' }, { ...preset, headline: 'x'.repeat(49) }, { ...preset, unknown: 'x' }]) {
    await writeFile(path.join(root, 'input.json'), JSON.stringify(value));
    const result = invoke('scripts/plan.mjs', ['input.json'], root);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
  await writeFile(path.join(root, 'input.json'), JSON.stringify({ ...preset, headline: '😀'.repeat(48) }));
  assert.equal(invoke('scripts/plan.mjs', ['input.json'], root).status, 0);
});

test('the distribution allowlist contains a relocatable toolkit and complete sample', async t => {
  const { directory } = await fixture(t);
  const install = path.join(directory, 'installed');
  const selected = distributionDocuments.filter(file => file.startsWith('packages/motion-package/') || file === 'docs/motion-package-spec.md');
  for (const file of selected) {
    const target = path.join(install, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(file, target);
  }
  const sample = 'packages/motion-package/examples/product-story';
  const cli = 'packages/motion-package/cli.mjs';
  const check = invoke(cli, ['check', sample], install);
  assert.equal(check.status, 0, check.stderr);
  const output = path.join(directory, 'handoff');
  const pack = invoke(cli, ['pack', sample, output], install);
  assert.equal(pack.status, 0, pack.stderr);
  assert.equal(invoke(cli, ['check', output], install).status, 0);
  assert.equal(invoke('scripts/plan.mjs', ['presets/lesson.json'], output).status, 0);
  assert.equal(invoke(cli, ['run', sample], install).status, 1);
  assert.equal(invoke(cli, ['check', sample, 'unexpected'], install).status, 1);
});
