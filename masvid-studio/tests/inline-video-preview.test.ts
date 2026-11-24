import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import { inlinePlaybackBytes } from '../inline-video.ts';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function film(directory: string) {
  const source = path.join(directory, 'film.mp4');
  const made = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '4', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source], directory, 60_000);
  assert.equal(made.code, 0, made.stderr);
  const bytes = await readFile(source);
  return { source, bytes, hash: sha(bytes) };
}

test('small verified films embed their own bytes; large ones play a validated, cached preview', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inline-preview-'));
  try {
    const { source, bytes, hash } = await film(directory), cache = path.join(directory, 'cache', 'preview.mp4');
    assert.deepEqual(await inlinePlaybackBytes(source, hash, cache, directory, bytes.length), bytes);
    const limit = Math.floor(bytes.length / 4);
    const [preview, concurrent] = await Promise.all([inlinePlaybackBytes(source, hash, cache, directory, limit), inlinePlaybackBytes(source, hash, cache, directory, limit)]);
    assert.ok(preview.length > 0 && preview.length <= limit, `${preview.length} > ${limit}`);
    assert.deepEqual(concurrent, preview);
    assert.deepEqual(await inlinePlaybackBytes(source, hash, cache, directory, limit), preview);
    const probe = await execute(verificationBinaries().ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', cache], directory, 30_000);
    assert.match(probe.stdout, /video/); assert.match(probe.stdout, /audio/);
    assert.equal(sha(await readFile(source)), hash, 'the verified export is never modified');
    assert.deepEqual((await readFile(path.dirname(cache) + '/preview.mp4.json', 'utf8')).includes(hash), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a corrupt or mismatched cache is rebuilt, and a changed source is never sent', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'inline-preview-'));
  try {
    const { source, bytes, hash } = await film(directory), cache = path.join(directory, 'cache', 'preview.mp4');
    const limit = Math.floor(bytes.length / 4);
    const good = await inlinePlaybackBytes(source, hash, cache, directory, limit);
    await writeFile(cache, '{"not":"a video"}');
    const rebuilt = await inlinePlaybackBytes(source, hash, cache, directory, limit);
    assert.ok(rebuilt.length > 1000 && !rebuilt.toString('utf8', 0, 20).includes('not'));
    assert.equal((await stat(cache)).size, rebuilt.length);
    await rm(cache); await rm(cache + '.json');
    await assert.rejects(inlinePlaybackBytes(source, 'f'.repeat(64), cache, directory, bytes.length), /INLINE_MEDIA_CHANGED/);
    await assert.rejects(inlinePlaybackBytes(source, 'f'.repeat(64), cache, directory, limit), /INLINE_MEDIA_CHANGED/);
    await appendFile(source, Buffer.from('changed'));
    await assert.rejects(inlinePlaybackBytes(source, hash, cache, directory, limit), /INLINE_MEDIA_CHANGED/);
    await assert.rejects(inlinePlaybackBytes(source, hash, cache, directory, 100), /INLINE_MEDIA_(UNAVAILABLE|CHANGED)/);
    assert.ok(good.length > 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
