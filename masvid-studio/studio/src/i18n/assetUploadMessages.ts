import { assetUploadFormats } from '../../../shared/asset-library';
import type { Modality } from '../../../shared/gateway';
import type { Translate } from './messages';
import { AssetUploadError, type AssetUploadReason } from '../motion/assetUploadError';

export interface AssetUploadSummary {
  uploaded: number;
  failed: number;
  unknown: number;
  reasons: Set<AssetUploadReason>;
  imageFormatHelp?: boolean;
}
const guidance: Record<string, string> = {
  size: 'Known issue: files exceed the size limit. Compress or replace those files.',
  unreadable: 'Known issue: files cannot be read. Re-export or replace those files.',
  unsupported: 'Known issue: unsupported file formats. Convert or replace those files.',
  'size,unreadable': 'Known issues: oversized and unreadable files. Compress, re-export or replace those files.',
  'size,unsupported': 'Known issues: oversized files and unsupported formats. Compress, convert or replace those files.',
  'unreadable,unsupported': 'Known issues: unreadable files and unsupported formats. Re-export, convert or replace those files.',
  'size,unreadable,unsupported': 'Known issues: oversized files, unreadable files and unsupported formats. Compress, re-export, convert or replace those files.',
};
const confirm = 'Check the asset library before uploading unconfirmed files again.';
const imageFormats = 'Supported image formats: PNG, JPG/JPEG, WebP, GIF and AVIF.';

export function assetUploadFormatsHint(t: Translate, modality?: Modality): string {
  const formats = modality ? assetUploadFormats[modality].join(', ') : t(
    'Images ({images}) · Video ({video}) · Audio ({audio})',
    { images: assetUploadFormats.image.join(', '), video: assetUploadFormats.video.join(', '), audio: assetUploadFormats.audio.join(', ') },
  );
  return t('Supported formats · {formats}', { formats });
}

export function recordAssetUploadFailure(summary: AssetUploadSummary, file: File, error: unknown) {
  if (!(error instanceof AssetUploadError) || error.outcome !== 'rejected') {
    summary.unknown++;
    return;
  }
  summary.failed++;
  if (error.reason) summary.reasons.add(error.reason);
  if ((error.reason === 'unsupported' || error.reason === 'unreadable')
    && (file.type.startsWith('image/') || /\.svgz?$/i.test(file.name))) {
    summary.imageFormatHelp = true;
  }
}

export function assetUploadMessage(summary: AssetUploadSummary, t: Translate = (key, values = {}) => key.replace(/\{(\w+)\}/g, (_, name) => String(values[name]))) {
  const { uploaded, failed, unknown } = summary;
  const key = failed && unknown ? 'Uploaded {uploaded}, not uploaded {failed}, awaiting confirmation {unknown}.'
    : failed ? 'Uploaded {uploaded}, not uploaded {failed}.'
      : unknown ? 'Uploaded {uploaded}, awaiting confirmation {unknown}.' : 'Uploaded {uploaded}.';
  const reason = guidance[[...summary.reasons].sort().join(',')];
  return [t(key, { uploaded, failed, unknown }), failed && reason ? t(reason) : '', failed && summary.imageFormatHelp ? t(imageFormats) : '', unknown ? t(confirm) : ''].filter(Boolean).join(' ');
}

/** Accept only our count grammar and exact authored guidance, never diagnostics. */
export function parseAssetUploadMessage(message: string): AssetUploadSummary | undefined {
  const match = /^Uploaded (\d+)(?:, not uploaded (\d+))?(?:, awaiting confirmation (\d+))?\.(.*)$/.exec(message);
  if (!match) return;
  const uploaded = Number(match[1]), failed = Number(match[2] ?? 0), unknown = Number(match[3] ?? 0);
  if (![uploaded, failed, unknown].every(Number.isSafeInteger)) return;
  for (const reasons of ['', ...Object.keys(guidance)]) for (const imageFormatHelp of [false, true]) {
    const summary: AssetUploadSummary = { uploaded, failed, unknown, reasons: new Set(reasons ? reasons.split(',') as AssetUploadReason[] : []), ...(imageFormatHelp ? { imageFormatHelp: true } : {}) };
    if (assetUploadMessage(summary) === message) return summary;
  }
}
