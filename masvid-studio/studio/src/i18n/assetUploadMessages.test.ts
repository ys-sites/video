import { expect, it } from 'vitest';
import { assetUploadMessage, parseAssetUploadMessage } from './assetUploadMessages';
import { languages, translate } from './messages';
import { systemMessage } from './systemMessages';
import { toastErrorMessage } from '../components/ui/toastErrorMessage';
import type { AssetUploadReason } from '../motion/assetUploadError';

it('preserves the full batch and the actual reasons through filtering and localization', () => {
  const message = assetUploadMessage({ uploaded: 1, failed: 4, unknown: 0, reasons: new Set(['size']) });
  expect(systemMessage(toastErrorMessage(message), (key, values) => translate('zh-CN', key, values)))
    .toBe('已上传 1 个，4 个未上传。 已知原因：文件过大，请压缩或更换相应文件。');
});
it('localizes every count shape and combination of known reasons in every supported locale', () => {
  const reasons: AssetUploadReason[] = ['size', 'unreadable', 'unsupported'];
  for (let mask = 0; mask < 8; mask++) for (const counts of [
    { uploaded: 5, failed: 0, unknown: 0 }, { uploaded: 1, failed: 4, unknown: 0 },
    { uploaded: 0, failed: 4, unknown: 1 }, { uploaded: 0, failed: 0, unknown: 5 },
  ]) {
    const summary = { ...counts, reasons: new Set(counts.failed ? reasons.filter((_, i) => mask & 1 << i) : []) };
    const message = assetUploadMessage(summary);
    expect(parseAssetUploadMessage(message)).toEqual(summary);
    expect(toastErrorMessage(message)).toBe(message);
    for (const { locale } of languages) {
      const localized = systemMessage(message, (key, values) => translate(locale, key, values));
      expect(localized).not.toMatch(/\{\w+\}/);
      if (locale !== 'en') expect(localized).not.toMatch(/Uploaded|Known issue|Check the asset library/);
    }
  }
});
it('does not accept filenames, arbitrary errors or diagnostic suffixes as authored summaries', () => {
  for (const message of ['Uploaded NaN.', 'Uploaded -1.', 'Uploaded 1. /private/path', 'Uploaded 1, not uploaded 4. network error', 'Uploaded 1, not uploaded 4. Known issue: Unsupported filename.mp4']) {
    expect(parseAssetUploadMessage(message)).toBeUndefined();
    expect(toastErrorMessage(message)).not.toBe(message);
  }
});

it('keeps image format guidance through Toast sanitization and localization', () => {
  const summary = { uploaded: 0, failed: 1, unknown: 1, reasons: new Set(['unsupported'] as const), imageFormatHelp: true };
  const message = assetUploadMessage(summary);
  expect(parseAssetUploadMessage(message)).toEqual(summary);
  expect(toastErrorMessage(message)).toBe(message);
  for (const { locale } of languages) {
    const localized = systemMessage(message, (key, values) => translate(locale, key, values));
    expect(localized).toContain('PNG');
    expect(localized).toContain('AVIF');
    if (locale !== 'en') expect(localized).not.toContain('Supported image formats:');
  }
  expect(systemMessage(message, (key, values) => translate('zh-CN', key, values))).toContain('支持的图片格式：PNG、JPG/JPEG、WebP、GIF、AVIF。');
});
