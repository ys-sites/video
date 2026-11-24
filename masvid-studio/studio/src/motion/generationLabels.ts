import type { Model } from '../../../shared/gateway';
import { openDesignModelLabel } from '../../../shared/opendesign-models';
import { modelFamilyLabel } from './imageMenuModels';

const MIN_LAYOUT_ASPECT = 0.42;
const MAX_LAYOUT_ASPECT = 2.4;

const STANDARD_RATIOS: readonly [string, number][] = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16],
  ['3:2', 3 / 2],
  ['2:3', 2 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['21:9', 21 / 9],
];

const FAL_IMAGE_SIZE_ASPECTS: Record<string, number> = {
  square: 1,
  square_hd: 1,
  portrait_4_3: 3 / 4,
  portrait_16_9: 9 / 16,
  landscape_4_3: 4 / 3,
  landscape_16_9: 16 / 9,
};

export function clampLayoutAspect(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.max(MIN_LAYOUT_ASPECT, Math.min(MAX_LAYOUT_ASPECT, ratio));
}

export function parseRatioString(raw: unknown): number | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /^(adaptive|auto)$/i.test(trimmed)) return undefined;
  const preset = FAL_IMAGE_SIZE_ASPECTS[trimmed.toLowerCase()];
  if (preset) return preset;
  const colon = /^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/.exec(trimmed);
  if (colon) {
    const w = Number(colon[1]), h = Number(colon[2]);
    if (w > 0 && h > 0) return w / h;
  }
  const dims = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(trimmed);
  if (dims) {
    const w = Number(dims[1]), h = Number(dims[2]);
    if (w > 0 && h > 0) return w / h;
  }
  return undefined;
}

export function resolveLayoutAspect({
  width,
  height,
  parameters,
  fallbackRatio,
  modality,
}: {
  width?: number;
  height?: number;
  parameters?: Record<string, unknown>;
  fallbackRatio?: number;
  modality: 'image' | 'video' | 'audio';
}): number {
  if (width && height && width > 0 && height > 0) return clampLayoutAspect(width / height);
  if (parameters) {
    const fromRatio = parseRatioString(parameters.ratio) ?? parseRatioString(parameters.aspect_ratio);
    if (fromRatio) return clampLayoutAspect(fromRatio);
    const fromSize = parseRatioString(parameters.size) ?? parseRatioString(parameters.image_size);
    if (fromSize) return clampLayoutAspect(fromSize);
  }
  if (fallbackRatio && Number.isFinite(fallbackRatio) && fallbackRatio > 0) {
    return clampLayoutAspect(fallbackRatio);
  }
  return modality === 'video' ? clampLayoutAspect(16 / 9) : 1;
}

export function formatAspectTag(width?: number, height?: number, parameters?: Record<string, unknown>): string | undefined {
  let ratio: number | undefined;
  if (width && height && width > 0 && height > 0) {
    ratio = width / height;
  } else if (parameters) {
    ratio = parseRatioString(parameters.ratio)
      ?? parseRatioString(parameters.aspect_ratio)
      ?? parseRatioString(parameters.size)
      ?? parseRatioString(parameters.image_size);
  }
  if (!ratio || !Number.isFinite(ratio)) return undefined;
  for (const [label, target] of STANDARD_RATIOS) {
    if (Math.abs(ratio - target) / target <= 0.045) return label;
  }
  if (width && height) {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const g = gcd(Math.round(width), Math.round(height));
    const rw = Math.round(width / g), rh = Math.round(height / g);
    if (rw <= 32 && rh <= 32) return `${rw}:${rh}`;
  }
  return `${ratio.toFixed(2)}:1`;
}

export function formatResolutionTag(width?: number, height?: number): string | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  const shortEdge = Math.min(width, height);
  if (shortEdge >= 2100) return '4K';
  if (shortEdge >= 1400) return '1440p';
  if (shortEdge >= 1040) return '1080p';
  if (shortEdge >= 700) return '720p';
  if (shortEdge >= 460) return '480p';
  return undefined;
}

export function formatDurationShort(seconds?: number): string | undefined {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const rounded = Math.round(seconds);
  return `${Math.max(1, rounded)}s`;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function formatDayHeading(key: string, t: (text: string) => string, locale = 'en'): string {
  const now = new Date();
  const today = dayKey(now.getTime());
  if (key === today) return t('Today');
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (key === dayKey(yesterday.getTime())) return t('Yesterday');
  const [y, m, d] = key.split('-').map(Number);
  if (!y || !m || !d) return key;
  const date = new Date(y, m - 1, d);
  const includeYear = y !== now.getFullYear();
  try {
    return new Intl.DateTimeFormat(locale || 'en', {
      ...(includeYear ? { year: 'numeric' } : {}),
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return key;
  }
}

function humanizeModelSlug(raw: string): string {
  const tail = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  const cleaned = tail.replace(/-\d{6}$/, '').replace(/^(doubao|bytedance|google|openai)-/i, '');
  if (!cleaned) return raw;
  return cleaned
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
    .replace(/(\d)\s+(\d)/g, '$1.$2');
}

export function modelDisplayLabel(
  models: readonly Model[] | undefined,
  modelId?: string,
  fallbackLabel?: string,
): string | undefined {
  if (!modelId) return fallbackLabel;
  const matched = models?.find(m => m.id === modelId || m.modelId === modelId);
  if (matched) return modelFamilyLabel(matched);
  const bare = modelId.includes(':') ? modelId.slice(modelId.indexOf(':') + 1) : modelId;
  const known = openDesignModelLabel(bare);
  if (known) return known;
  if (fallbackLabel && !fallbackLabel.includes(':') && !/-\d{6}$/.test(fallbackLabel)) {
    return fallbackLabel;
  }
  return humanizeModelSlug(bare);
}
