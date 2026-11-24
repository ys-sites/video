import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderInlineStoryboard } from '../scripts/inline-storyboard.mjs';

const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');

async function storyboard(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'openmotion-storyboard-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifestPath = path.join(directory, 'storyboard.json');
  const output = path.join(directory, 'storyboard.html');
  const frames = Array.from({ length: 6 }, (_, index) => ({
    image: 'still.png', title: 'Scene ' + (index + 1), time: '00:0' + index, alt: 'Prototype <preview>',
  }));
  const writeManifest = preview => writeFile(manifestPath, JSON.stringify({
    title: 'Design <script>alert(1)</script>', openLabel: 'Enlarge', backLabel: 'Back to preview', ...preview,
  }));
  const write = frames => writeManifest({ frames });
  await writeFile(path.join(directory, 'still.png'), pixel);
  await write(frames);
  return { directory, manifestPath, output, frames, write, writeManifest };
}

test('renders the six supplied stills in playback order as a self-contained inline view', async t => {
  const { manifestPath, output } = await storyboard(t);
  const result = await renderInlineStoryboard({ manifestPath, output });
  const html = await readFile(output, 'utf8');
  assert.equal(result.bytes, Buffer.byteLength(html));
  assert.equal(result.frameCount, 6);
  assert.equal(result.contentReference, 'visualize' + JSON.stringify({ path: output }) + '');
  assert.deepEqual([...html.matchAll(/<h3 class="om-storyboard-title" id="[^"]+">(Scene \d)<\/h3>/g)].map(match => match[1]),
    ['Scene 1', 'Scene 2', 'Scene 3', 'Scene 4', 'Scene 5', 'Scene 6']);
  assert.equal(html.match(/<img src="data:image\/png;base64,/g).length, 6);
  assert.match(html, /Prototype &lt;preview&gt;/);
  assert.doesNotMatch(html, /<script>alert|file:\/\/|<!doctype|fetch\(/i);
});

test('creates the requested chat visualization directory on first render', async t => {
  const { directory, manifestPath } = await storyboard(t);
  const output = path.join(directory, 'chat', 'visualizations', 'preview-v1.html');
  const result = await renderInlineStoryboard({ manifestPath, output });
  assert.equal(result.path, output);
  assert.match(await readFile(output, 'utf8'), /Scene 1/);
});

test('rerendering a direction preview preserves the previous file and returns the new path', async t => {
  const { directory, manifestPath, output, frames, writeManifest } = await storyboard(t);
  const directions = [
    { ...frames[0], id: 'walkthrough', note: 'Lead with the product.' },
    { ...frames[1], id: 'editorial', note: 'Lead with typography.' },
  ];
  await writeManifest({ previewType: 'creative_directions', directions });
  const first = await renderInlineStoryboard({ manifestPath, output });
  const original = await readFile(first.path, 'utf8');
  directions[1].title = 'Updated editorial';
  await writeManifest({ previewType: 'creative_directions', directions });

  const revised = await renderInlineStoryboard({ manifestPath, output });
  assert.equal(first.path, output);
  assert.notEqual(revised.path, first.path);
  assert.equal(path.dirname(revised.path), directory);
  assert.equal(await readFile(first.path, 'utf8'), original);
  assert.match(await readFile(revised.path, 'utf8'), /Updated editorial/);
  assert.equal(revised.contentReference, 'visualize' + JSON.stringify({ path: revised.path }) + '');
  assert.deepEqual(revised.candidates?.[1].evidence, [{ path: path.join(directory, 'still.png') }, { path: revised.path }]);
});

test('direction letters match the returned candidate order for the chat reply', async t => {
  const { directory, manifestPath, frames, writeManifest } = await storyboard(t);
  const directions = [
    { ...frames[0], id: 'product-demo', title: 'Product walkthrough', note: 'Follow one brief through the workspace.' },
    { ...frames[1], id: 'editorial', title: 'Editorial motion', note: 'Lead with typography and visual metaphors.' },
    { ...frames[2], id: 'team-loop', title: 'Team handoff', note: 'Follow feedback from one teammate to the next.' },
  ].map(({ time, ...direction }) => direction);
  for (const count of [2, 3]) {
    const output = path.join(directory, 'directions-' + count + '.html');
    await writeManifest({ previewType: 'creative_directions', directions: directions.slice(0, count) });
    const { candidates } = await renderInlineStoryboard({ manifestPath, output });
    const html = await readFile(output, 'utf8');
    assert.match(html, new RegExp('data-count="' + count + '"'));
    assert.deepEqual([...html.matchAll(/class="om-storyboard-meta" id="[^"]+">([A-C])<\/p>/g)].map(match => match[1]),
      [...'ABC'.slice(0, count)]);
    assert.deepEqual(candidates.map(candidate => candidate.id), directions.slice(0, count).map(direction => direction.id));
    assert.deepEqual(candidates[1].evidence, [{ path: path.join(directory, 'still.png') }, { path: output }]);
  }
});

test('direction previews reject an invalid candidate count or duplicated IDs', async t => {
  const { manifestPath, output, frames, writeManifest } = await storyboard(t);
  const render = () => renderInlineStoryboard({ manifestPath, output });
  const first = { ...frames[0], id: 'demo', note: 'Show a product walkthrough.' };
  for (const [directions, error] of [
    [[first], /two or three/],
    [Array(4).fill(first), /two or three/],
    [[first, { ...first, title: 'Different title' }], /distinct candidate IDs/],
  ]) {
    await writeManifest({ previewType: 'creative_directions', directions });
    await assert.rejects(render(), error);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});

test('rejects escaped paths, symlinks, non-images and oversized card payloads before writing output', async t => {
  const { directory, manifestPath, output, frames, write } = await storyboard(t);
  const render = () => renderInlineStoryboard({ manifestPath, output });
  await symlink('still.png', path.join(directory, 'linked.png'));
  await writeFile(path.join(directory, 'fake.png'), '<svg></svg>');
  await writeFile(path.join(directory, 'large.png'), Buffer.concat([pixel, Buffer.alloc(150_000)]));
  for (const [image, error] of [
    ['../still.png', /filename beside/],
    ['linked.png', /regular file/],
    ['fake.png', /PNG, JPEG or WebP/],
    ['large.png', /inline document budget/],
  ]) {
    await write(frames.map(frame => ({ ...frame, image })));
    await assert.rejects(render(), error);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
});
