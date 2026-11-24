import assert from 'node:assert/strict';
import { readdir, rmdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { canonical, readJSON, withLock, writeJSON } from './runtime-assets.mjs';
import { harnessBundleInventory, ownedHarnessBundle } from './npm-hosts.mjs';

export async function cleanupHarnessBundles(directory, confirmedStopped = false) {
  const home = await canonical(directory);
  return withLock(path.join(home, 'install.lock'), async () => {
    const filename = path.join(home, 'install.json'), state = await readJSON(filename);
    assert(state?.managedBy === '@openmotion/installer', 'Not a managed OpenMotion installation');
    const host = state.hosts?.deepseek;
    assert(host?.configFile && host.bundleDirectory, 'No managed Harness registration');
    const profile = await readJSON(host.configFile);
    const dependency = profile?.dependencies?.['dsh-plugin-openmotion-local'];
    assert(typeof dependency === 'string' && /^(file|link):/.test(dependency), 'Cannot verify the active Harness dependency; no bundles were removed');
    const active = await canonical(path.resolve(path.dirname(host.configFile), dependency.replace(/^(file|link):/, '')));
    assert(await ownedHarnessBundle(active, home, host.configFile), 'Cannot verify active bundle ownership');
    const candidates = (await harnessBundleInventory(home, host.configFile)).filter(item => item !== active && item !== host.bundleDirectory);
    if (!confirmedStopped) return { status: 'inspection', active, candidates,
      nextAction: 'Stop every Harness process using this installation, then rerun with --confirm-all-processes-stopped. No bundles were removed.' };
    const removed = [], blocked = [];
    for (const item of candidates) {
      // Recheck the profile before each removal; preserve unrelated settings and bundles.
      const current = await readJSON(host.configFile);
      assert(current?.dependencies?.['dsh-plugin-openmotion-local'] === dependency, 'Harness registration changed; stop cleanup and inspect');
      try {
        // Leave ownership evidence intact if Windows refuses any child deletion.
        const scopeFile = path.join(item, 'scope.json'), scope = await readJSON(scopeFile);
        for (const name of await readdir(item)) if (name !== 'scope.json') await rm(path.join(item, name), { recursive: true, force: true });
        await unlink(scopeFile);
        try { await rmdir(item); }
        catch (error) { await writeJSON(scopeFile, scope); throw error; }
        removed.push(item);
      }
      catch (error) { blocked.push({ directory: item, code: error.code }); }
    }
    host.retainedBundles = (await harnessBundleInventory(home, host.configFile)).filter(item => item !== host.bundleDirectory);
    await writeJSON(filename, state);
    return { status: blocked.length ? 'blocked' : 'cleaned', active, removed, blocked, retainedBundles: host.retainedBundles };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { home: { type: 'string' }, 'confirm-all-processes-stopped': { type: 'boolean' } } });
    assert(values.home, 'Usage: node scripts/cleanup-harness-bundles.mjs --home DIR [--confirm-all-processes-stopped]');
    const result = await cleanupHarnessBundles(values.home, values['confirm-all-processes-stopped']);
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'blocked') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
