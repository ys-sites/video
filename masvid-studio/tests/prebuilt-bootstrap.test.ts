import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const entry = fileURLToPath(new URL('../install.sh', import.meta.url));
async function fixture(t: any) {
  const directory = await mkdtemp(path.join(tmpdir(), 'om-prebuilt-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin'), log = path.join(directory, 'npm.json'), payload = path.join(directory, 'candidate.tgz');
  await mkdir(bin); await writeFile(payload, 'candidate fixture');
  await writeFile(path.join(bin, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  await writeFile(path.join(bin, 'npm'), `#!${process.execPath}
require('node:fs').writeFileSync(process.env.OM_TEST_LOG, JSON.stringify(process.argv.slice(2)));
`, { mode: 0o755 });
  await writeFile(path.join(bin, 'curl'), `#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
if(args.indexOf('-o')<0 || args.indexOf('-o')>args.indexOf('--')) process.exit(9);
fs.copyFileSync(process.env.OM_TEST_PAYLOAD,args[args.indexOf('-o')+1]);
`, { mode: 0o755 });
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, OM_TEST_LOG: log,
    OM_TEST_PAYLOAD: payload, OPENMOTION_INSTALLER_SHA256: createHash('sha256').update('candidate fixture').digest('hex') };
  return { directory, payload, log, env };
}

test('the prebuilt entry pins the npm version and forwards inline setup without a Git checkout', async t => {
  const { log, env } = await fixture(t);
  const result = spawnSync('bash', [entry, '--package', '@openmotion/app@1.2.3', '--onboarding-output', '/chat/welcome.html'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['exec', '--yes', '--package', '@openmotion/app@1.2.3', '--', 'openmotion', 'setup', '--host', 'codex', '--onboarding-output', '/chat/welcome.html']);
  assert.match(result.stdout, /download included/);
});

test('URL candidates are verified before execution and only the owned download is cleaned up', async t => {
  const { log, env, payload } = await fixture(t);
  const result = spawnSync('bash', [entry, '--package', 'http://127.0.0.1:1234/candidate.tgz'], { env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const args = JSON.parse(await readFile(log, 'utf8'));
  await assert.rejects(access(args[3]), { code: 'ENOENT' });
  assert.equal(await readFile(payload, 'utf8'), 'candidate fixture');
});

test('floating versions and failed candidate hashes stop before executing any package', async t => {
  const { log, env, payload } = await fixture(t);
  for (const spec of ['@openmotion/app@latest', '@openmotion/app@test', payload]) {
    const result = spawnSync('bash', [entry, '--package', spec], { env: { ...env, OPENMOTION_INSTALLER_SHA256: '0'.repeat(64) }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    await assert.rejects(access(log), { code: 'ENOENT' });
  }
});

test('unknown bootstrap arguments fail before downloads or host changes', async t => {
  const { log, env } = await fixture(t);
  for (const args of [['--unknown'], ['--package']]) {
    const result = spawnSync('bash', [entry, ...args], { env, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    await assert.rejects(access(log), { code: 'ENOENT' });
  }
});

test('one maintained guide serves source setup and npm generation while the old root URL forwards', async () => {
  const source = await readFile(new URL('../docs/install.md', import.meta.url), 'utf8');
  assert.match(source, /default repository installation route/);
  assert.match(source, /Only use npm installation when the user explicitly selects it/);
  assert.match(source, /https:\/\/releases\.open-design\.ai\/motion/);
  assert.match(source, /https:\/\/releases\.open-design\.ai\/open-motion\/dev\/install\.md/);
  assert.match(source, /Do not guess a package version/);
  assert.match(source, /install.sh --package EXACT_PACKAGE_SPEC/);
  assert.match(source, /OPENMOTION_INSTALLER_SHA256/);
  const oldOnboarding = await readFile(new URL('../docs/install-onboarding.md', import.meta.url), 'utf8');
  assert.match(oldOnboarding, /id="installation-success-reply"/);
  const forward = await readFile(new URL('../install.md', import.meta.url), 'utf8');
  assert.match(forward, /\]\(docs\/install\.md\)/);
  assert.doesNotMatch(forward, /```|npm|onboarding/i);
  for (const file of ['README.md', 'README.zh-CN.md', 'docs/README.zh-CN.md', 'docs/README.ja.md']) {
    const readme = await readFile(new URL('../' + file, import.meta.url), 'utf8');
    const sourceEntry = readme.indexOf('https://github.com/nexu-io/openmotion/blob/main/docs/install.md');
    const npmEntry = readme.indexOf('https://releases.open-design.ai/motion');
    assert(sourceEntry >= 0 && npmEntry > sourceEntry, file + ': source prompt precedes optional npm prompt');
  }
});
