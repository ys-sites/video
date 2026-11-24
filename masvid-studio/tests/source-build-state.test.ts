import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, copyFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sourceBuildCurrent, recordSourceBuild, dependenciesCurrent, recordDependencies } from '../scripts/source-build-state.mjs';

async function fixture(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'om-source-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['studio/build', 'studio/src', 'node_modules']) await mkdir(path.join(root, name), { recursive: true });
  await writeFile(path.join(root, 'studio/build/index.html'), 'original editor');
  await writeFile(path.join(root, 'studio/src/app.ts'), 'original source');
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}');
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), '{}');
  return root;
}

test('an existing index alone is not proof of a current source build', async t => {
  const root = await fixture(t);
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);
  await writeFile(path.join(root, 'studio/src/app.ts'), 'updated source');
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);
  await writeFile(path.join(root, 'studio/build/index.html'), 'altered editor');
  assert.equal(await sourceBuildCurrent(root), false);
});

test('Studio rebuilds for component library source edits and reuses the build after packing the library', async t => {
  const root = await fixture(t);
  const library = path.join(root, 'packages/open-design-ui');
  const button = path.join(library, 'button.tsx');
  await mkdir(library, { recursive: true });
  await writeFile(button, 'original button');
  await recordSourceBuild(root);
  assert.equal(await sourceBuildCurrent(root), true);

  await writeFile(button, 'updated button');
  assert.equal(await sourceBuildCurrent(root), false);
  await recordSourceBuild(root);
  await mkdir(path.join(library, 'dist'));
  await writeFile(path.join(library, 'dist/button.js'), 'packed button');
  assert.equal(await sourceBuildCurrent(root), true);
});

test('source-only rebuilds reuse dependencies; changed locks or missing installs do not', async t => {
  const root = await fixture(t);
  assert.equal(await dependenciesCurrent(root), false);
  await recordDependencies(root);
  assert.equal(await dependenciesCurrent(root), true);
  await writeFile(path.join(root, 'studio/src/app.ts'), 'changed source');
  assert.equal(await dependenciesCurrent(root), true);
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  assert.equal(await dependenciesCurrent(root), false);
  await recordDependencies(root);
  assert.equal(await dependenciesCurrent(root), true);
  await rm(path.join(root, 'node_modules'), { recursive: true });
  assert.equal(await dependenciesCurrent(root), false);
});


test('the source installer rebuilds stale sources once and reuses matching dependencies and builds', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'scripts'));
  await writeFile(path.join(root, 'marketplace.example.json'), JSON.stringify({ name: 'openmotion-local', plugins: [{ name: 'openmotion', source: { source: 'local', path: './' } }] }));
  for (const file of ['install-motion.command', 'source-build-state.mjs']) {
    await copyFile(fileURLToPath(new URL('../scripts/' + file, import.meta.url)), path.join(root, 'scripts', file));
  }
  const bin = path.join(root, 'bin'), log = path.join(root, 'npm.jsonl');
  await mkdir(bin);
  await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'node'), `#!${process.execPath}
const {spawnSync}=require('node:child_process');
const args=process.argv.slice(2);
if(args.some(arg=>/source-marketplace\\.mjs$|install-onboarding\\.mjs$|check-installed-mcp\\.mjs$/.test(arg))) process.exit(0);
const result=spawnSync(process.execPath,args,{stdio:'inherit'});process.exit(result.status??1);
`, { mode: 0o755 });
  await writeFile(path.join(bin, 'npm'), `#!${process.execPath}
const fs=require('node:fs'); const path=require('node:path');
const args=process.argv.slice(2);fs.appendFileSync(process.env.OM_TEST_NPM_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='ci'){fs.mkdirSync('node_modules',{recursive:true});fs.writeFileSync('node_modules/.package-lock.json','{}');}
if(args[0]==='run'){fs.mkdirSync('studio/build',{recursive:true});fs.writeFileSync('studio/build/index.html','rebuilt editor');}
`, { mode: 0o755 });
  const install = () => {
    const result = spawnSync('bash', [path.join(root, 'scripts/install-motion.command')], {
      cwd: root, encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, OM_TEST_NPM_LOG: log },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return result;
  };
  const calls = async () => (await readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const first = install();
  assert.match(first.stdout, /studio-build:/, first.stdout + first.stderr);
  assert.deepEqual(await calls(), [['ci', '--include=dev'], ['run', 'build:studio']]);
  install();
  assert.equal((await calls()).length, 2);
  await writeFile(path.join(root, 'studio/src/app.ts'), 'changed after first install');
  install();
  assert.deepEqual((await calls()).slice(2), [['run', 'build:studio']]);
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3,"packages":{}}');
  install();
  assert.deepEqual((await calls()).slice(3), [['ci', '--include=dev'], ['run', 'build:studio']]);
});

test('DSH can reuse an existing npm tree only when required locked identities and directories match', async t => {
  const root = await fixture(t);
  const entry = { version: '1.0.0', integrity: 'sha512-fixture' };
  await mkdir(path.join(root, 'node_modules/fixture'), { recursive: true });
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/fixture': entry, 'node_modules/platform-only': { ...entry, optional: true } } }));
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': entry } }));
  assert.equal(await dependenciesCurrent(root), false);
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), true);
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': { ...entry, version: '0.9.0' } } }));
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), false);
  await writeFile(path.join(root, 'node_modules/.package-lock.json'), JSON.stringify({ packages: { 'node_modules/fixture': entry } }));
  await rm(path.join(root, 'node_modules/fixture'), { recursive: true });
  assert.equal(await dependenciesCurrent(root, { inspectInstalledLock: true }), false);
});
