import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkBundledDependencyTarget, verifyBundledDependencies } from '../scripts/npm-installer.mjs';
import { sha256, writeJSON } from '../scripts/runtime-assets.mjs';

test('prebuilt dependency verification rejects incompatible machines, modified locks and incomplete bundles', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-prebuilt-deps-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'package-lock.json'), '{"lockfileVersion":3}');
  await writeJSON(path.join(directory, 'package.json'), { dependencies: { fixture: '1.2.3' } });
  const info = { platform: process.platform, arch: process.arch, lockSHA256: await sha256(path.join(directory, 'package-lock.json')) };
  await writeJSON(path.join(directory, '.bundled-dependencies.json'), info);
  assert.throws(() => checkBundledDependencyTarget({ ...info, arch: 'incompatible' }), /select the package/);
  await assert.rejects(verifyBundledDependencies(directory, info), /incomplete or stale/);
  await mkdir(path.join(directory, 'node_modules/fixture'), { recursive: true });
  await writeJSON(path.join(directory, 'node_modules/fixture/package.json'), { version: '1.2.3' });
  await verifyBundledDependencies(directory, info);
  await writeFile(path.join(directory, 'package-lock.json'), 'modified');
  await assert.rejects(verifyBundledDependencies(directory, info), /dependency lock mismatch/);
});
