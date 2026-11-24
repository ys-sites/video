import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { execute } from '../hyperframes.ts';

async function processState(pid: number) {
  try { process.kill(pid, 0); } catch (error) { assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH'); return 'X'; }
  if (process.platform === 'linux') return readFile(`/proc/${pid}/stat`, 'utf8').then(text => text.match(/\) ([A-Z]) /)?.[1], error => { if (error.code === 'ENOENT') return 'X'; throw error; });
  // macOS can also expose an exited grandchild until its new parent reaps it.
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.ok(result.status === 0 || result.status === 1 && !result.stdout.trim() && !result.stderr.trim(), result.stderr);
  return result.status === 1 ? 'X' : result.stdout.trim()[0];
}

test('detached render environment reaches the child while execution timeout still cancels it', async () => {
  await assert.rejects(execute(process.execPath, ['-e', 'process.stderr.write("detached="+process.env.HYPERFRAMES_RENDER_DETACHED);setInterval(()=>{},1000)'], tmpdir(), 500,
    { HYPERFRAMES_RENDER_DETACHED: '1' }), /Hyperframes 执行超时：detached=1/);
});


test('explicit cancellation waits for the owned process group to stop', { skip: process.platform === 'win32', timeout: 10_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-cancel-process-'));
  const controller = new AbortController();
  const source = `const {spawn}=require('node:child_process'); const fs=require('node:fs'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'}); fs.writeFileSync('owned.tmp',JSON.stringify([process.pid,child.pid]));fs.renameSync('owned.tmp','owned.json');setInterval(()=>{},1000);`;
  const result = execute(process.execPath, ['-e', source], directory, 10_000, {}, controller.signal);
  const stopped = assert.rejects(result, /COMMAND_CANCELLED/);
  try {
    let pids: number[] = [];
    for (let i = 0; i < 100; i++) {
      pids = await readFile(path.join(directory, 'owned.json'), 'utf8').then(JSON.parse, () => []);
      if (pids.length) break; await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(pids.length, 2);
    for (const pid of pids) assert.ok(!['Z', 'X'].includes((await processState(pid))!), 'The probe must recognize the live fixture before cancellation');
    controller.abort(); await stopped;
    for (const pid of pids) {
      const state = await processState(pid);
      assert.ok(state === 'Z' || state === 'X', `owned process ${pid} is still executing (state=${state})`);
    }
  } finally { controller.abort(); await stopped; await rm(directory, { recursive: true, force: true }); }
});
