import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { execute, pluginRoot } from '../hyperframes.ts';
import { verificationBinaries } from '../scripts/verify-export.ts';
import type { AssetReadResult } from '../shared/asset-library.ts';
import type { AssetLibrary } from './asset-library.ts';
import { probeLibraryMedia } from './asset-probe.ts';

const maxPreviewBytes = 4 * 1024 * 1024, maxReadBytes = 8 * 1024 * 1024;

export async function readLibraryAsset(library: AssetLibrary, input: { assetId: string; versionId: string; timestamps?: number[]; start?: number; duration?: number }): Promise<AssetReadResult> {
  if (!input.assetId || !input.versionId) throw new Error('INVALID_ARGUMENT: read requires assetId and versionId');
  const { asset, version, filename } = await library.resolve(input, true);
  if (input.timestamps !== undefined && (asset.modality !== 'video' || !Array.isArray(input.timestamps) || !input.timestamps.length || input.timestamps.length > 4
    || input.timestamps.some(time => !Number.isFinite(time) || time < 0 || version.duration !== undefined && time >= version.duration))) throw new Error('INVALID_ARGUMENT: timestamps must select at most four available video frames');
  if ((input.start !== undefined || input.duration !== undefined) && asset.modality !== 'audio') throw new Error('INVALID_ARGUMENT: start and duration are audio-only');
  const start = input.start ?? 0, duration = input.duration ?? 10;
  if (asset.modality === 'audio' && (!Number.isFinite(start) || start < 0 || version.duration !== undefined && start >= version.duration
    || !Number.isFinite(duration) || duration < 0.1 || duration > 15)) throw new Error('INVALID_ARGUMENT: audio start must be available and duration must be 0.1–15 seconds');
  // Snapshot once so hashing and every preview decode use the same bytes even during external writes.
  const prepared = await library.prepare(filename);
  let directory: string | undefined;
  try {
    if (prepared.sha256 !== version.sha256 || prepared.bytes !== version.bytes || prepared.media.modality !== asset.modality) throw new Error('ASSET_CONTENT_CHANGED: bytes no longer match the pinned version');
    directory = await mkdtemp(path.join(path.dirname(prepared.file), 'read-'));
    const times = asset.modality === 'video' ? input.timestamps ?? [0] : [0];
    const result: AssetReadResult = { assetId: asset.id, versionId: version.id, modality: asset.modality, version, previews: [], content: [] };
    let total = 0;
    for (const [index, timestamp] of times.entries()) {
      const audio = asset.modality === 'audio', output = path.join(directory, `${index}.${audio ? 'wav' : 'png'}`);
      const command = await execute(verificationBinaries().ffmpeg, ['-v', 'error', '-nostdin', '-ss', String(audio ? start : timestamp), '-i', prepared.file,
        ...(audio ? ['-map', '0:a:0', '-t', String(duration), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le']
          : ['-map', '0:V:0', '-frames:v', '1', '-vf', "scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease"]),
        '-fs', String(maxPreviewBytes), '-y', output], pluginRoot, 30_000);
      if (command.code) throw new Error('ASSET_READ_FAILED: media preview could not be decoded');
      const info = await stat(output).catch(() => null);
      if (!info?.isFile() || !info.size || info.size > maxPreviewBytes || (total += info.size) > maxReadBytes) throw new Error('ASSET_READ_LIMIT: preview exceeds the byte limit; use fewer video frames or smaller source media');
      const media = await probeLibraryMedia(output);
      if (media.mimeType !== (audio ? 'audio/wav' : 'image/png')) throw new Error('ASSET_READ_FAILED: unexpected preview format');
      result.previews.push({ mimeType: media.mimeType, bytes: info.size, ...(audio ? { start, duration: media.duration } : { width: media.width, height: media.height }),
        ...(asset.modality === 'video' ? { timestamp } : {}) });
      result.content.push({ type: 'text', text: `${asset.id}/${version.id}: ${audio ? `audio from ${start}s (${media.duration}s); playback/listening depends on host support` : asset.modality === 'video' ? `video frame requested at ${timestamp}s (codec seeking may quantize the frame)` : 'image preview'}` },
        { type: audio ? 'audio' : 'image', mimeType: media.mimeType, data: (await readFile(output)).toString('base64') });
    }
    return result;
  } finally {
    await rm(prepared.file, { force: true });
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}
