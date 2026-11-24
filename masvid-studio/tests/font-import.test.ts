import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { Phase1Service } from '../phase1.ts';
import { pluginRoot } from '../hyperframes.ts';

// Uses the actual phase-one version/history boundary, not a mock of the import implementation.
test('font import retains the actual face and license, rejects corrupt fonts, deduplicates and restores resources', () => fixture(async store => {
  const service = new Phase1Service(store, pluginRoot, { origin: () => 'http://127.0.0.1:4173', nativeUrl: () => undefined,
    openProject: async () => {}, mutation: async task => task(), cancel: async () => ({}) });
  const original = await service.call('openmotion_create_project', { requestId: 'font-project', projectType: 'natural_language', title: 'Font regression', requirements: 'Editable text' });
  const sourcePath = fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url));
  const licensePath = fileURLToPath(new URL('./fixtures/fonts/OFL.txt', import.meta.url));
  const bad = path.join(store.directory, 'bad.ttf'); await writeFile(bad, 'not a font');
  const args = { projectId: original.projectId, requestId: 'fonts', items: [{ itemId: 'orbitron', sourcePath, licensePath }, { itemId: 'bad', sourcePath: bad }] };
  const imported = await service.call('openmotion_import_assets', args);
  assert.equal(imported.status, 'partial');
  const font = imported.items[0]; assert.equal(font.status, 'completed');
  assert.equal(font.font.family, 'Orbitron'); assert.equal(font.font.weight, '400 900');
  assert.match(font.fontFaceCss, /font-weight: 400 900/); assert.equal(imported.items[1].status, 'failed');
  const directory = store.projectDirectoryFor(original.projectId);
  assert.deepEqual(await readFile(path.join(directory, font.path)), await readFile(sourcePath));
  assert.equal(await readFile(path.join(directory, font.license.path), 'utf8'), await readFile(licensePath, 'utf8'));
  // A licence from outside the font's directory would make the argument a bounded file copy.
  const strayLicense = path.join(store.directory, 'OFL.txt');
  await writeFile(strayLicense, await readFile(licensePath));
  const stray = await service.call('openmotion_import_assets', { projectId: original.projectId, requestId: 'stray-license',
    items: [{ itemId: 'orbitron-stray', sourcePath, licensePath: strayLicense }] });
  assert.equal(stray.items[0].status, 'failed');
  assert.match(stray.items[0].error, /FONT_LICENSE_NOT_BESIDE_FONT/);
  const dedupe = await service.call('openmotion_import_assets', { ...args, requestId: 'font-again', items: [args.items[0]] });
  assert.equal(dedupe.items[0].assetId, font.assetId); assert.equal(dedupe.items[0].reused, true);
  const before = await service.call('openmotion_get_project', { projectId: original.projectId });
  const removed = await service.call('openmotion_restore_version', { projectId: original.projectId, requestId: 'before-font', versionId: original.version.versionId, expectedRevision: before.revision, expectedVersionId: before.version.versionId });
  await assert.rejects(readFile(path.join(directory, font.path)), { code: 'ENOENT' });
  await service.call('openmotion_restore_version', { projectId: original.projectId, requestId: 'after-font', versionId: imported.version.versionId, expectedRevision: removed.revision, expectedVersionId: removed.version.versionId });
  assert.deepEqual(await readFile(path.join(directory, font.path)), await readFile(sourcePath));
  assert.equal(await readFile(path.join(directory, font.license.path), 'utf8'), await readFile(licensePath, 'utf8'));
}, false));
