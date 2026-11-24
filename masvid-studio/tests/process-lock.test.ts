import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withProcessLock } from '../shared/process-lock.ts';

const moduleUrl = new URL('../shared/process-lock.ts', import.meta.url).href;
async function child(code: string) {
  const proc = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import {withProcessLock} from ${JSON.stringify(moduleUrl)}; ${code}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; proc.stderr.on('data', chunk => { errors += chunk; });
  const exited = once(proc, 'exit').then(([code, signal]) => { assert.equal(signal, null, errors); assert.equal(code, 0, errors); });
  return { proc, exited };
}
test('dead owners are reclaimed while competing processes remain mutually exclusive', { timeout: 30_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of ['workspace.lock', 'preview-start.lock']) {
    const lock = path.join(root, name), counter = path.join(root, 'counter');
    const { proc, exited } = await child(`await withProcessLock(${JSON.stringify(lock)}, async () => { console.log('ready'); setInterval(() => {},1000); await new Promise(() => {}); });`);
    // The intentional kill is observed separately from the normal child completion assertion.
    const killed = exited.catch(() => {});
    t.after(() => { if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL'); });
    await once(proc.stdout, 'data');
    const stopped = once(proc, 'exit'); proc.kill('SIGKILL'); await stopped; await killed;
    assert.equal(JSON.parse(await readFile(lock, 'utf8')).pid, proc.pid);
    await writeFile(counter, '0');
    const workers = await Promise.all(Array.from({ length: 4 }, () => child(`
      import {readFile,writeFile} from 'node:fs/promises';
      for(let i=0;i<8;i++) await withProcessLock(${JSON.stringify(lock)},async()=>{
        const n=Number(await readFile(${JSON.stringify(counter)},'utf8'));
        await new Promise(r=>setTimeout(r,2)); await writeFile(${JSON.stringify(counter)},String(n+1));
      });`)));
    await Promise.all(workers.map(worker => worker.exited));
    assert.equal(await readFile(counter, 'utf8'), '32');
    await assert.rejects(stat(lock), { code: 'ENOENT' });
  }
});
test('live owners are never evicted, errors release ownership, and unverifiable legacy locks are preserved', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = path.join(root, 'workspace.lock');
  await assert.rejects(withProcessLock(lock, async () => {
    const before = await readFile(lock, 'utf8');
    await assert.rejects(withProcessLock(lock, async () => assert.fail('Concurrent owner'), 50), /Timed out/);
    assert.equal(await readFile(lock, 'utf8'), before);
    throw new Error('work failed');
  }), /work failed/);
  await withProcessLock(lock, async () => {});
  await writeFile(lock, '');
  await assert.rejects(withProcessLock(lock, async () => assert.fail('Legacy owner evicted'), 50), /no verifiable owner/);
  assert.equal((await stat(lock)).size, 0);
});
test('Windows sharing violations are retried during acquisition and release', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-lock-')); t.after(() => rm(root, { recursive: true, force: true }));
  const lock = path.join(root, 'workspace.lock');
  const worker = await child(`
    import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict';
    Object.defineProperty(process,'platform',{value:'win32'});
    let links=0,unlinks=0,busyReads=0; const link=fs.link,unlink=fs.unlink,readFile=fs.readFile;
    fs.link=async(...args)=>{ if(++links<=2) throw Object.assign(new Error('sharing'),{code:'EPERM'}); return link(...args); };
    fs.unlink=async(...args)=>{ if(++unlinks<=2) throw Object.assign(new Error('sharing'),{code:'EACCES'}); return unlink(...args); };
    fs.readFile=async(...args)=>{ if(busyReads>0){busyReads--;throw Object.assign(new Error('sharing'),{code:'EPERM'});} return readFile(...args); };
    syncBuiltinESMExports(); let ran=0; await withProcessLock(${JSON.stringify(lock)},async()=>{ran++;busyReads=2;});
    assert.equal(ran,1);assert.equal(links,3);assert.equal(unlinks,3);assert.equal(busyReads,0);
    const owner=JSON.stringify({pid:1234,token:crypto.randomUUID()});
    await fs.writeFile(${JSON.stringify(lock)},owner);
    process.kill=()=>{throw Object.assign(new Error('Cannot inspect process'),{code:'EPERM'});};
    await assert.rejects(withProcessLock(${JSON.stringify(lock)},async()=>assert.fail('Inaccessible owner evicted'),50),/Timed out/);
    assert.equal(await fs.readFile(${JSON.stringify(lock)},'utf8'),owner);
  `);
  await worker.exited;
});
