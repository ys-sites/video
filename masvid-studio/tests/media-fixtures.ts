import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';

/** Real decodable outputs exercise the same import boundary as provider downloads. */
export async function mediaBytes(kind: 'video' | 'audio') {
  const directory = await mkdtemp(path.join(tmpdir(), 'motion-media-fixture-'));
  try {
    const file = path.join(directory, kind === 'video' ? 'clip.mp4' : 'voice.mp3');
    const input = kind === 'video' ? ['-f', 'lavfi', '-i', 'color=c=red:s=32x24:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'] : ['-f', 'lavfi', '-i', 'sine=frequency=440', '-c:a', 'libmp3lame'];
    const result = await execute(verificationBinaries().ffmpeg, ['-v', 'error', ...input, '-t', '0.2', '-y', file], directory, 20_000);
    assert.equal(result.code, 0, result.stderr);
    return await readFile(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** A valid 640 × 360 grayscale PNG for cover selection tests. */
export const brandCoverPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAoAAAAFoCAAAAADiWRWNAAAA9klEQVR4nO3BMQEAAADCoPVPbQsvoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgZ4WVAAGyfPfPAAAAAElFTkSuQmCC', 'base64');
