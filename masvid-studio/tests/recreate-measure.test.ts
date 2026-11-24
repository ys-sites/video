import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertSkillFrontmatterYaml } from '../scripts/check.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const measurer = path.join(root, 'skills/openmotion-recreate/scripts/measure_frame.mjs');
const ffmpeg = process.env.HYPERFRAMES_FFMPEG_PATH || process.env.FFMPEG_PATH || 'ffmpeg';
const hasFfmpeg = spawnSync(ffmpeg, ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

test('skill frontmatter check rejects plain values that YAML cannot parse', async () => {
  assert.throws(() => assertSkillFrontmatterYaml('name: x\ndescription: Use it, even with no other words: a bare link', 'x'), /folded block/);
  assert.throws(() => assertSkillFrontmatterYaml('name: x\ndescription: keep #1 and # this', 'x'), /folded block/);
  assertSkillFrontmatterYaml('name: x\ndescription: >-\n  Use it, even with no other words: a bare link\nmetadata:\n  status: ready', 'x');
  assertSkillFrontmatterYaml('name: x\ndescription: "quoted: value"', 'x');
  const recreate = await readFile(path.join(root, 'skills/openmotion-recreate/SKILL.md'), 'utf8');
  assertSkillFrontmatterYaml(recreate.match(/^---\n([\s\S]*?)\n---/)![1], 'openmotion-recreate');
});

test('host motion helpers pass their Python regression suite', (t) => {
  const python = process.env.PYTHON || 'python3';
  const available = spawnSync(python, ['-c', 'import numpy, cv2'], { encoding: 'utf8', timeout: 10_000 });
  if (available.status !== 0) return t.skip('Host Python with NumPy and OpenCV is unavailable');
  const result = spawnSync(python, [path.join(root, 'tests/recreate-registration.py')], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
});

test('measure_frame never reports a missing element as measured', { skip: !hasFfmpeg && 'ffmpeg/ffprobe unavailable' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'measure-frame-'));
  try {
    const make = (name: string, filter: string) => {
      const file = path.join(directory, name);
      const made = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=320x180:d=1:r=10${filter}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
      assert.equal(made.status, 0, made.stderr?.toString());
      return file;
    };
    const box = make('box.mp4', ',drawbox=x=100:y=60:w=60:h=40:color=white:t=fill');
    const blank = make('blank.mp4', '');
    const measure = (ref: string, remix: string, region: string) =>
      spawnSync(process.execPath, [measurer, ref, remix, '--t', '0.5', '--region', region], { encoding: 'utf8' });

    const same = JSON.parse(measure(box, box, '80,40,100,80').stdout);
    assert.equal(same.region_status, 'measured');
    assert.equal(same.height_ok, true);
    assert.equal(same.clipped, false);

    const missing = JSON.parse(measure(box, blank, '80,40,100,80').stdout);
    assert.equal(missing.region_status, 'failed');
    assert.equal(missing.height_ok, false);
    assert.equal(missing.clipped, null);
    assert.equal(missing.height_ratio, undefined);

    const emptyReference = JSON.parse(measure(blank, box, '80,40,100,80').stdout);
    assert.equal(emptyReference.region_status, 'blocked');
    assert.equal(emptyReference.height_ok, false);

    for (const region of ['300,40,100,80', '-1,0,10,10', '0,0,0,10', '1,2,3']) {
      const rejected = measure(box, box, region);
      assert.equal(rejected.status, 1, region);
      assert.match(rejected.stderr, /--region/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('measure_frame selects exact transient frames and independently shifted reference frames', { skip: !hasFfmpeg && 'ffmpeg/ffprobe unavailable' }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'measure-transient-'));
  try {
    const make = (frame: number) => {
      const file = path.join(directory, `flash-${frame}.mkv`);
      const filter = `color=c=black:s=160x90:d=1:r=30,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='eq(n,${frame})'`;
      const made = spawnSync(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', filter, '-c:v', 'ffv1', file]);
      assert.equal(made.status, 0, made.stderr?.toString());
      return file;
    };
    const reference = make(5), remix = make(8);
    const measure = (...args: string[]) => spawnSync(process.execPath, [measurer, reference, remix, ...args], { encoding: 'utf8' });
    const selected = measure('--frame', '8', '--ref-frame', '5');
    assert.equal(selected.status, 0, selected.stderr);
    const match = JSON.parse(selected.stdout);
    assert.equal(match.ref_frame, 5);
    assert.equal(match.remix_frame, 8);
    assert.equal(match.ref_t, null);
    assert.equal(match.remix_t, null);
    assert.ok(match.ref.mean_luma > 250);
    assert.ok(match.remix.mean_luma > 250);

    const adjacent = JSON.parse(measure('--frame', '9', '--ref-frame', '6').stdout);
    assert.ok(adjacent.ref.mean_luma < 1);
    assert.ok(adjacent.remix.mean_luma < 1);
    const zero = JSON.parse(measure('--frame', '0').stdout);
    assert.equal(zero.ref_frame, 0);
    assert.equal(zero.remix_frame, 0);
    const mixed = JSON.parse(measure('--t', '.3', '--ref-frame', '5').stdout);
    assert.equal(mixed.remix_t, .3);
    assert.ok(mixed.ref.mean_luma > 250);
    assert.ok(mixed.remix.mean_luma < 1);

    for (const args of [
      ['--frame', '-1'], ['--frame', '1.5'], ['--frame', 'NaN'], ['--frame', ''],
      ['--frame', '8', '--t', '.3'], ['--frame', '8', '--ref-frame', '5', '--ref-t', '.2'],
      ['--t', 'Infinity'], ['--t', '-.1'], ['--frame', '99'],
    ]) {
      assert.equal(measure(...args).status, 1, args.join(' '));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
