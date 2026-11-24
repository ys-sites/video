import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFontSpecimen, type SpecimenRequest } from '../scripts/font-specimen.ts';

const face = { id: 'orbitron', sourcePath: fileURLToPath(new URL('./fixtures/fonts/orbitron.ttf', import.meta.url)), licensePath: fileURLToPath(new URL('./fixtures/fonts/OFL.txt', import.meta.url)) };
function request(): SpecimenRequest {
  return { title: 'Actual <copy>', sourceWidth: 1080, displayWidth: 360, roles: [{ name: 'Main claim', text: 'OPEN 2026\n汉字 <script>', fontSize: 90, weight: 700, width: 900, lineHeight: 1.1, letterSpacing: 3,
    candidates: [{ label: 'A', faces: [face] }, { label: 'B', faces: [face] }] }] };
}

test('an extracted specimen command uses the existing dependency runtime without plugin node_modules', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-specimen-package-'));
  const source = fileURLToPath(new URL('../', import.meta.url));
  try {
    const plugin = path.join(directory, 'plugin');
    for (const name of ['scripts/font-specimen.ts', 'shared/font-catalog.ts', 'shared/studio-fonts.ts', 'shared/asset-limits.ts', 'shared/entry.ts', 'skills/openmotion-production/fonts/catalog.json']) {
      const target = path.join(plugin, name); await mkdir(path.dirname(target), { recursive: true }); await cp(path.join(source, name), target);
    }
    await writeFile(path.join(plugin, 'package.json'), '{"type":"module"}');
    const input = path.join(directory, 'request.json'), output = path.join(directory, 'comparison');
    await writeFile(input, JSON.stringify(request()));
    const result = spawnSync(process.execPath, ['--experimental-strip-types', path.join(plugin, 'scripts/font-specimen.ts'), input, output, '--runtime-root', source], {
      cwd: directory, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(await readFile(JSON.parse(result.stdout).recordPath, 'utf8'));
    assert.equal(record.roles[0].candidates[0].resources[0].family, 'Orbitron');
    assert.deepEqual(record.roles[0].candidates[0].missingGlyphs, ['汉', '字']);
    await assert.rejects(stat(path.join(plugin, 'node_modules')), { code: 'ENOENT' });
    assert.deepEqual((await readdir(directory)).sort(), ['comparison', 'plugin', 'request.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('offline specimen preserves actual copy, equal role conditions, portable pinned resources and explicit coverage gaps', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-specimen-'));
  try {
    const output = path.join(root, 'comparison');
    const result = await buildFontSpecimen(request(), output);
    const record = JSON.parse(await readFile(result.recordPath, 'utf8'));
    const html = await readFile(result.htmlPath, 'utf8');
    assert.equal(record.roles[0].text, request().roles[0].text);
    assert.equal(record.roles[0].displayedFontSize, 30);
    assert.deepEqual(record.roles[0].candidates[0].missingGlyphs, ['汉', '字']);
    assert.equal((html.match(/font-size:30px;font-weight:700;line-height:1.1;letter-spacing:1px;width:300px/g) ?? []).length, 2);
    assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>\n'));
    assert.ok(!html.includes(face.sourcePath));
    assert.equal((await readdir(path.join(output, 'assets'))).length, 2);
    for (const resource of record.roles[0].candidates[0].resources) {
      assert.deepEqual(await readFile(path.join(output, resource.path)), await readFile(face.sourcePath));
      assert.deepEqual(await readFile(path.join(output, resource.license)), await readFile(face.licensePath));
    }
    await assert.rejects(buildFontSpecimen(request(), output), /EEXIST/);
    assert.equal(await readFile(result.htmlPath, 'utf8'), html);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unprepared, altered or unsupported font inputs fail before creating a comparison', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-specimen-invalid-'));
  try {
    const output = path.join(root, 'comparison');
    const missing = request(); missing.roles[0].candidates[0].faces = [{ ...face, sourcePath: path.join(root, 'not-prepared.ttf') }];
    await assert.rejects(buildFontSpecimen(missing, output), /ENOENT/);
    const changed = path.join(root, 'changed.ttf'); await writeFile(changed, 'corrupt');
    const corrupt = request(); corrupt.roles[0].candidates[0].faces = [{ ...face, sourcePath: changed }];
    await assert.rejects(buildFontSpecimen(corrupt, output), /SPECIMEN_RESOURCE_INTEGRITY_MISMATCH/);
    const unsupported = request(); unsupported.roles[0].weight = 300;
    await assert.rejects(buildFontSpecimen(unsupported, output), /FONT_WEIGHT_UNAVAILABLE/);
    const invalid = request(); invalid.roles[0].fontSize = NaN;
    await assert.rejects(buildFontSpecimen(invalid, output), /INVALID_SPECIMEN_FONT_SIZE/);
    assert.deepEqual((await readdir(root)).sort(), ['changed.ttf']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('script-sensitive specimens retain explicit language and text direction without changing the copy', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'motion-specimen-rtl-'));
  try {
    const rtl = request(); rtl.roles[0].text = 'العربية 123'; rtl.roles[0].lang = 'ar'; rtl.roles[0].direction = 'rtl';
    const result = await buildFontSpecimen(rtl, path.join(root, 'rtl'));
    const html = await readFile(result.htmlPath, 'utf8');
    const record = JSON.parse(await readFile(result.recordPath, 'utf8'));
    assert.match(html, /class="sample" lang="ar" dir="rtl"/);
    assert.equal(record.roles[0].text, rtl.roles[0].text);
    assert.equal(record.roles[0].lang, 'ar'); assert.equal(record.roles[0].direction, 'rtl');
    assert.ok(record.roles[0].candidates[0].missingGlyphs.length > 0);
    const invalid = request(); invalid.roles[0].lang = 'ar" onclick="bad';
    await assert.rejects(buildFontSpecimen(invalid, path.join(root, 'invalid-lang')), /INVALID_SPECIMEN_LANG/);
    const wrongDirection = request(); wrongDirection.roles[0].direction = 'sideways' as 'rtl';
    await assert.rejects(buildFontSpecimen(wrongDirection, path.join(root, 'invalid-direction')), /INVALID_SPECIMEN_DIRECTION/);
    assert.deepEqual(await readdir(root), ['rtl']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
