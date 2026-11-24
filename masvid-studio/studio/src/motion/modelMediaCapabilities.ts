import { modelReferenceLimit, type Modality, type Model } from '../../../shared/gateway';
import { generationOptions, videoAudioAlwaysOn, type GenerationOptions } from '../../../shared/generation-options';
import { openDesignModelLabel } from '../../../shared/opendesign-models';
import type { DirectoryModel, ProviderProtocol } from '../../../shared/provider-directory';
import type { Translate } from '../i18n/messages';
import { imageModelLabel } from './imageMenuModels';

const mediaKinds = new Set<string>(['image', 'video', 'audio']);
const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Show the raw model ID inline only on BYOK/API providers where the endpoint ID carries
 * information beyond casing/punctuation (for example path-prefixed fal/Atlas IDs or custom
 * aliases). Managed account and local Agent rows show one clean product name instead.
 */
export function shouldShowInlineModelId(displayLabel: string, modelId: string, protocol: ProviderProtocol): boolean {
  const id = modelId.trim();
  const label = displayLabel.trim();
  if (!id || !label || id === label) return false;
  if (protocol === 'account' || protocol === 'agent') return false;
  return normalizeName(id) !== normalizeName(label);
}

/**
 * Resolve a consistent human-readable display name for OpenDesign managed models when
 * the raw catalogue only populated `modelId`, without overriding explicit user/builtin labels.
 */
export function modelDisplayLabel(model: DirectoryModel): string {
  const label = model.label.trim();
  const modelId = model.modelId.trim();
  if (!label) return modelId;
  if (label !== modelId || !['account', 'opendesign'].includes(model.provider)) return model.label;
  const known = openDesignModelLabel(modelId);
  if (known) return known;
  const gatewayModel = toGatewayModel(model);
  if (gatewayModel?.modality === 'image') return imageModelLabel(gatewayModel);
  return model.label;
}

/**
 * Convert a settings DirectoryModel into a gateway Model so Settings can reuse the
 * shared generation schema and reference-limit contracts without duplicating logic.
 */
export function toGatewayModel(model: DirectoryModel): Model | null {
  if (!mediaKinds.has(model.kind)) return null;
  const modality = model.kind as Modality;
  const nativeMax = model.nativeOptions?.max_input_images;
  const maxInputImages = model.maxInputImages !== undefined
    ? model.maxInputImages
    : modality === 'video' && Number.isInteger(nativeMax) && (nativeMax as number) > 0 ? 1 : undefined;
  const existingOptions = (model as Partial<Model>).generationOptions;
  const gatewayModel: Model = {
    id: model.id,
    provider: model.provider,
    modelId: model.modelId,
    label: model.label,
    modality,
    source: model.source,
    mode: model.mode ?? `text-to-${modality}`,
    ...(model.defaults ? { defaults: model.defaults } : {}),
    ...(model.supportsImageReference !== undefined ? { supportsImageReference: model.supportsImageReference } : {}),
    ...(maxInputImages !== undefined ? { maxInputImages } : {}),
    ...(model.nativeOptions ? { nativeOptions: model.nativeOptions } : {}),
    ...(existingOptions ? { generationOptions: existingOptions } : {}),
  };
  return gatewayModel;
}

export function resolveModelOptions(model: DirectoryModel): GenerationOptions | undefined {
  const gatewayModel = toGatewayModel(model);
  if (!gatewayModel) return undefined;
  return gatewayModel.generationOptions ?? generationOptions(gatewayModel);
}

function parseResolutionTier(raw: string): { rank: number; label: string } | null {
  const trimmed = raw.trim();
  const kMatch = /^(\d+(?:\.\d+)?)k$/i.exec(trimmed);
  if (kMatch) {
    const value = Number(kMatch[1]);
    if (Number.isFinite(value) && value > 0) return { rank: value * 1000, label: `${kMatch[1]}K` };
  }
  const pMatch = /^(\d+)p(?:-sr)?$/i.exec(trimmed);
  if (pMatch) {
    const value = Number(pMatch[1]);
    if (Number.isFinite(value) && value > 0) return { rank: value, label: `${pMatch[1]}p` };
  }
  return null;
}

function highestResolutionTier(options?: GenerationOptions): { label: string; count: number } | null {
  const fields = options?.fields ?? [];
  const field = fields.find(item => item.key === 'resolution') ?? fields.find(item => item.key === 'size');
  if (!field?.choices?.length) return null;
  const tiers = new Map<string, { rank: number; label: string }>();
  for (const choice of field.choices) {
    const parsed = parseResolutionTier(String(choice.value)) ?? parseResolutionTier(choice.label);
    if (parsed && !tiers.has(parsed.label)) tiers.set(parsed.label, parsed);
  }
  if (!tiers.size) return null;
  const best = [...tiers.values()].sort((a, b) => b.rank - a.rank)[0];
  return { label: best.label, count: tiers.size };
}

function durationSummary(options?: GenerationOptions): string | null {
  const field = options?.fields.find(item => item.key === 'duration' || item.key === 'duration_seconds');
  if (!field) return null;
  if (field.kind === 'number') {
    if (typeof field.min === 'number' && Number.isFinite(field.min) && field.min > 0
      && typeof field.max === 'number' && Number.isFinite(field.max) && field.max >= field.min) {
      return field.min === field.max ? `${field.min}s` : `${field.min}–${field.max}s`;
    }
    return null;
  }
  if (field.kind === 'choice' && field.choices?.length) {
    const values = field.choices
      .map(choice => Number(choice.value))
      .filter(value => Number.isFinite(value) && value > 0);
    if (!values.length) return null;
    const min = Math.min(...values), max = Math.max(...values);
    return min === max ? `${min}s` : `${min}–${max}s`;
  }
  return null;
}

/**
 * Derive verified, read-only media capability hints from real provider metadata and
 * generation schemas. Models without declared metadata gracefully return an empty list.
 */
export function modelMediaCapabilities(model: DirectoryModel, t: Translate): string[] {
  const gatewayModel = toGatewayModel(model);
  if (!gatewayModel) return [];
  const options = gatewayModel.generationOptions ?? generationOptions(gatewayModel);
  const hints: string[] = [];

  if (gatewayModel.modality === 'image') {
    const refLimit = modelReferenceLimit(gatewayModel);
    if (refLimit > 1) hints.push(t('Image editing (up to {count})', { count: refLimit }));
    else if (refLimit === 1 || gatewayModel.mode === 'image-to-image') hints.push(t('Image editing'));
    if (options?.fields.some(field => field.key === 'background' && field.choices?.some(choice => choice.value === 'transparent'))) {
      hints.push(t('Transparent background'));
    }
    const tier = highestResolutionTier(options);
    if (tier) hints.push(tier.count > 1 ? t('Up to {resolution}', { resolution: tier.label }) : tier.label);
  } else if (gatewayModel.modality === 'video') {
    if (modelReferenceLimit(gatewayModel) > 0 || gatewayModel.mode === 'image-to-video') {
      hints.push(t('Image to video'));
    }
    if (videoAudioAlwaysOn(gatewayModel) || options?.fields.some(field => field.key === 'generate_audio')) {
      hints.push(t('Native audio'));
    }
    const duration = durationSummary(options);
    if (duration) hints.push(duration);
    const tier = highestResolutionTier(options);
    if (tier) hints.push(tier.count > 1 ? t('Up to {resolution}', { resolution: tier.label }) : tier.label);
  } else if (gatewayModel.modality === 'audio') {
    if (gatewayModel.mode === 'text-to-speech') hints.push(t('Speech'));
    else if (gatewayModel.mode === 'text-to-audio') hints.push(t('Music & sound'));
    const duration = durationSummary(options);
    if (duration) hints.push(duration);
  }

  return hints;
}
