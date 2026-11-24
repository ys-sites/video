import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { runFile } from '../scripts/runtime-assets.mjs';
import { resolveHostCommand, hostPlan } from '../scripts/npm-hosts.mjs';
import { recoverWorkspaceLock } from '../scripts/recover-workspace-lock.ts';

async function fixture(t: any) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'motion-win-recovery-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('missing commands exit promptly without keeping the five-minute deadline alive', { timeout: 5000 }, async () => {
  const module = new URL('../scripts/runtime-assets.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import {runFile} from ${JSON.stringify(module)};
    try { await runFile('openmotion-missing-cli-' + process.pid, []); process.exitCode=2; }
    catch(e) { if(e.code !== 'ENOENT' || !e.message.includes('Install this CLI')) process.exitCode=3; }
  `], { stdio: 'ignore' });
  try { assert.equal((await once(child, 'exit'))[0], 0); }
  finally { if (child.exitCode === null) child.kill(); }
});

test('command deadlines terminate stalled children', async () => {
  await assert.rejects(runFile(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeout: 80 }), { code: 'ETIMEDOUT' });
});

for (const extension of ['cmd', 'ps1']) {
  test(`Windows ${extension} npm shims resolve without shell argument expansion`, async t => {
    const root = await fixture(t), entry = path.join(root, 'node_modules', 'host', 'cli.js');
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, 'console.log(JSON.stringify(process.argv.slice(2)))');
    const shim = path.join(root, 'dsh.' + extension);
    await writeFile(shim, extension === 'cmd' ? '@"%dp0%\\node_modules\\host\\cli.js" %*' : '& "$basedir/node_modules/host/cli.js" $args');
    const resolved = await resolveHostCommand(shim, 'win32');
    const previousPath = process.env.PATH;
    process.env.PATH = root;
    try { assert.deepEqual(await resolveHostCommand('dsh', 'win32'), resolved); }
    finally { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; }
    const args = ['space value', 'a&b', '%PATH%', '中文', '"quoted"'];
    assert.deepEqual(JSON.parse(await runFile(resolved.command, [...resolved.args, ...args])), args);
    await assert.rejects(resolveHostCommand(path.join(root, 'missing'), 'win32'), /HOST_CLI_NOT_FOUND/);
    await writeFile(shim, 'echo unknown wrapper');
    await assert.rejects(resolveHostCommand(shim, 'win32'), /HOST_CLI_UNSUPPORTED_SHIM/);
  });
}

test('DeepSeek upgrade targets a fresh bundle while accepting an owned legacy dependency', async t => {
  const root = await fixture(t), dshHome = path.join(root, 'dsh'), home = path.join(root, 'motion');
  const priorEnv = process.env.DSH_HOME; process.env.DSH_HOME = dshHome;
  t.after(() => { if (priorEnv === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = priorEnv; });
  const configFile = path.join(dshHome, 'profiles', 'desktop', 'package.json');
  await mkdir(path.dirname(configFile), { recursive: true });
  const legacy = path.join(home, 'hosts', 'deepseek');
  await writeFile(configFile, JSON.stringify({ dependencies: { 'dsh-plugin-openmotion-local': 'file:' + legacy } }));
  const saved = { hosts: { deepseek: { configFile, bundleDirectory: legacy } } };
  const plan = await hostPlan({ host: 'deepseek', profile: 'desktop', dsh: process.execPath }, home, path.join(home, 'run-mcp.mjs'), saved, '12345678-1234-1234-1234-123456789012');
  assert.notEqual(plan.metadata.bundleDirectory, legacy);
  assert.equal(path.dirname(plan.metadata.bundleDirectory), path.dirname(legacy));
  await writeFile(configFile, JSON.stringify({ dependencies: { 'dsh-plugin-openmotion-local': 'file:' + path.join(root, 'foreign') } }));
  await assert.rejects(hostPlan({ host: 'deepseek', profile: 'desktop' }, home, 'launcher', saved), /not owned/);
});

test('offline legacy recovery requires confirmation, preserves evidence and refuses modern locks', async t => {
  const root = await fixture(t), lock = path.join(root, 'workspace.lock');
  await writeFile(lock, ''); await writeFile(path.join(root, 'project-data'), 'keep');
  assert.equal((await recoverWorkspaceLock(root)).status, 'confirmation_required');
  assert.equal(await readFile(lock, 'utf8'), '');
  const recovered = await recoverWorkspaceLock(root, true);
  assert.equal(recovered.status, 'recovered');
  assert.equal(await readFile(recovered.backup!, 'utf8'), '');
  assert.equal(await readFile(path.join(root, 'project-data'), 'utf8'), 'keep');
  await writeFile(lock, JSON.stringify({ pid: process.pid, token: 'live-owner' }));
  await assert.rejects(recoverWorkspaceLock(root, true), /only an empty regular/);
  await rm(lock);
  if (process.platform !== 'win32') {
    await symlink(path.join(root, 'project-data'), lock);
    await assert.rejects(recoverWorkspaceLock(root, true), /only an empty regular/);
  }
});

test('configured SIGKILL terminates a child that handles SIGTERM and releases parent pipes', { skip: process.platform === 'win32', timeout: 5000 }, async t => {
  const root = await fixture(t), ready = path.join(root, 'ready'), signal = path.join(root, 'term');
  const module = new URL('../scripts/runtime-assets.mjs', import.meta.url).href;
  const code = `import fs from 'node:fs';process.on('SIGTERM',()=>fs.writeFileSync(${JSON.stringify(signal)},'received'));fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);`;
  const proc = spawn(process.execPath, ['--input-type=module', '-e', `import {runFile} from ${JSON.stringify(module)};
    try { await runFile(process.execPath,['--input-type=module','-e',${JSON.stringify(code)}],{timeout:600,killSignal:'SIGKILL'});process.exitCode=2; }
    catch(e) { if(e.code!=='ETIMEDOUT')process.exitCode=3; }`], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (proc.exitCode === null) proc.kill('SIGKILL');
    const pid = Number(await readFile(ready, 'utf8').catch(() => '0'));
    if (pid > 0) try { process.kill(pid, 'SIGKILL'); } catch {}
  });
  assert.equal((await once(proc, 'exit'))[0], 0);
  assert(Number(await readFile(ready, 'utf8')) > 0);
  await assert.rejects(readFile(signal), { code: 'ENOENT' });
});
