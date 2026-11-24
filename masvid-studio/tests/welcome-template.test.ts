import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './fixtures.ts';
import { createBlankProject } from '../workspace.ts';
import { copyTemplate, welcomeSharedAssets, welcomeTemplateId } from '../template-library.ts';
import { pluginRoot, inspectProject } from '../hyperframes.ts';
import { distributionFiles } from '../scripts/distribution.ts';

test('first-run initialization and gallery reuse materialize the same portable welcome source', () => fixture(async store => {
  await store.initialize(pluginRoot);
  const copied = path.join(store.directory, 'template-copy');
  await copyTemplate(welcomeTemplateId, copied, pluginRoot);
  const first = await store.get();
  assert.match(first.project!.html!, /<title>OpenMotion Welcome<\/title>/);
  assert.match(first.project!.html!, /data-duration="37.3"/);
  for (const file of await store.files()) {
    assert.deepEqual(await readFile(path.join(copied, file.path)), await readFile(path.join(store.projectDirectory, file.path)), file.path);
  }
  for (const [source, target] of welcomeSharedAssets) {
    assert.deepEqual(await readFile(path.join(store.projectDirectory, target)), await readFile(path.join(pluginRoot, source)), target);
  }
  assert.equal((await inspectProject(pluginRoot, store.projectDirectory, 'lint')).exitCode, 0);
  const info = await inspectProject(pluginRoot, store.projectDirectory, 'info');
  assert.equal(info.exitCode, 0);
  assert.equal(info.result.width, 1920); assert.equal(info.result.height, 1080);
  assert.equal(info.result.duration, 37.3);

  // User-edited source survives both repeat initialization and template reuse.
  await store.writeFiles(first.revision, [{ path: 'index.html', content: first.project!.html!.replace('OpenMotion Welcome', 'My welcome edit') }]);
  const edited = (await store.get()).revision;
  await store.initialize(pluginRoot);
  assert.equal((await store.get()).revision, edited);
  assert.doesNotMatch(await readFile(path.join(copied, 'index.html'), 'utf8'), /My welcome edit/);
}, false));

test('new blank projects contain no welcome content or soundtrack', () => fixture(async store => {
  const directory = store.projectDirectoryFor(crypto.randomUUID());
  await createBlankProject(directory, pluginRoot, 'New story');
  const source = await readFile(path.join(directory, 'index.html'), 'utf8');
  assert.doesNotMatch(source, /class="clip"|welcome-|soundtrack|data-composition-src/);
  assert.deepEqual((await readdir(path.join(directory, 'assets'))).sort(), ['gsap.min.js']);
  assert.equal((await inspectProject(pluginRoot, directory, 'lint')).exitCode, 0);
}, false));

test('application packages retain welcome sources, soundtrack and canonical shared dependencies', async () => {
  const files = new Set(await distributionFiles('phase1'));
  const root = 'template-library/openmotion-welcome/';
  const manifest = JSON.parse(await readFile(path.join(pluginRoot, root, 'registry-item.json'), 'utf8'));
  for (const item of manifest.files) assert.ok(files.has(root + item.path), item.path);
  for (const [source] of welcomeSharedAssets) assert.ok(files.has(source), source);
  assert.ok(files.has(root + 'poster.jpg'));
  assert.ok(files.has(root + 'assets/soundtrack.m4a'));
  assert.ok(![...files].some(file => /welcome.*(?:reference\.mp4|comparison|sequence-)/.test(file)));
});
