import { generationOptions } from '../../../shared/generation-options';
import type { Model, ProviderState } from '../../../shared/gateway';
import { providerRegistry, registeredProvider } from '../../../shared/provider-registry';
import { openDesignImageReferenceCap, openDesignModelLabel, openDesignModels } from '../../../shared/opendesign-models';
import { videoModelBadge } from '../../../shared/video-features';
import { supportsScene, studioScenes } from './creativeStudios';

export const imageScene = studioScenes.find(scene => scene.id === 'text-to-image')!;
export const editImageScene = studioScenes.find(scene => scene.id === 'image-edit')!;

const flagshipFamilies = [
  /^gpt-image-2[.-]6(?:-|$)/,
  /^seedream-5[.-]5$/,
  /^nano-banana-2[.-]1$/,
  /^nano-banana-2(?:[.-]0)?$/,
  /^gpt-image-2(?:[.-]0)?$/,
  /^seedream-5[.-]0-pro$/,
  /^seedream-5[.-]0-flash$/,
  /^seedream-5[.-]0$/,
  /^nano-banana-2-lite$/,
];
const flagshipLabels = ['GPT Image 2.6', 'Seedream 5.5', 'Nano Banana 2.1', 'Nano Banana 2', 'GPT Image 2', 'Seedream 5.0 Pro', 'Seedream 5.0 Flash', 'Seedream 5.0', 'Nano Banana 2 Lite'];
const normalize = (name: string) => name.trim().toLowerCase().replace(/\s+/g, '-');
function modelName(model: Model) {
  const parts = model.modelId.split('/');
  return normalize(parts.find(part => flagshipFamilies.some(family => family.test(normalize(part)))) ?? model.label);
}
function familyIndex(model: Model) {
  if (model.modality !== 'image') return flagshipFamilies.length;
  const index = flagshipFamilies.findIndex(family => family.test(modelName(model)));
  return index < 0 ? flagshipFamilies.length : index;
}
export function imageModelLabel(model: Model) {
  const family = familyIndex(model);
  const label = flagshipLabels[family];
  if (!label) return model.label;
  if (family !== 0) return label;
  const variant = modelName(model).match(/(?:-|\.)6-(.+)$/)?.[1];
  return variant ? label + ' ' + variant.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : label;
}
export function imageModelBadge(model: Model) {
  if (model.modality === 'video') return videoModelBadge(model);
  return ['New', 'New', 'Popular', 'Popular', 'Popular'][familyIndex(model)];
}
export function isOpenDesignProvider(providerId: string) {
  return providerId === 'account' || providerId === 'opendesign';
}
export function providerDisplayName(providerId: string, providers: ProviderState[] = []) {
  return providers.find(provider => provider.id === providerId)?.label ?? registeredProvider(providerId)?.label ?? providerId;
}

/** OpenDesign Cloud (API key) first, then the OpenDesign account, then the settings order of built-in providers.
 * CreationModelPicker lifts a ready OpenDesign route ahead of an unready one while keeping OpenDesign first. */
const openDesignOrder = ['opendesign', 'account'];
export function providerRank(providerId: string) {
  const openDesign = openDesignOrder.indexOf(providerId);
  if (openDesign >= 0) return openDesign;
  const index = providerRegistry.findIndex(provider => provider.id === providerId);
  return openDesignOrder.length + (index < 0 ? providerRegistry.length : index);
}
export const providerReady = (providers: ProviderState[], providerId: string) => providers.some(provider => provider.id === providerId && provider.available);

/** The same model served by several providers is one choice; providers are picked after the model. */
export type ModelFamily = { key: string; label: string; variants: Model[]; representative: Model; ready: boolean };
export const modelFamilyLabel = (model: Model) => (isOpenDesignProvider(model.provider) && openDesignModelLabel(model.modelId))
  || (model.modality === 'image' ? imageModelLabel(model) : model.label);
export const modelFamilyKey = (model: Model) => model.modality + ':' + normalize(modelFamilyLabel(model));

/** Choose a provider variant: keep the current provider when it is ready, otherwise the first ready one in provider order. */
export function preferredVariant(variants: Model[], providers: ProviderState[], providerId?: string) {
  const ready = (model: Model) => providerReady(providers, model.provider);
  return variants.find(model => model.provider === providerId && ready(model)) ?? variants.find(ready)
    ?? variants.find(model => model.provider === providerId) ?? variants[0];
}

export function modelFamilies(models: Model[], providers: ProviderState[]): ModelFamily[] {
  const groups = new Map<string, Model[]>();
  for (const model of [...models].sort((a, b) => providerRank(a.provider) - providerRank(b.provider))) {
    const key = modelFamilyKey(model);
    groups.set(key, [...groups.get(key) ?? [], model]);
  }
  return [...groups].map(([key, variants]) => {
    const representative = preferredVariant(variants, providers);
    return { key, label: modelFamilyLabel(representative), variants, representative, ready: providerReady(providers, representative.provider) };
  }).sort((a, b) => Number(b.ready) - Number(a.ready)
    || familyIndex(a.representative) - familyIndex(b.representative)
    || Number(isOpenDesignProvider(b.representative.provider)) - Number(isOpenDesignProvider(a.representative.provider))
    || a.label.localeCompare(b.label));
}

/** Before the OpenDesign key or sign-in is set up its models still open and ask for setup; afterwards the live catalogue decides. */
export function withOpenDesignModels(models: Model[], providers: ProviderState[]): Model[] {
  const known = new Set(models.map(model => model.id));
  const missing = (['opendesign', 'account'] as const).filter(provider => !providerReady(providers, provider)).flatMap(provider =>
    openDesignModels.filter(model => !known.has(provider + ':' + model.modelId)).map((model): Model => {
      const placeholder: Model = { id: provider + ':' + model.modelId, provider, modelId: model.modelId, label: model.label, modality: model.modality, mode: model.mode, source: 'builtin' };
      // Image entries can edit and OpenDesign video entries accept a first frame, so reference-based scenes list them before setup too.
      const cap = model.modality === 'image' ? openDesignImageReferenceCap(model.modelId) : undefined;
      if (cap) Object.assign(placeholder, { supportsImageReference: true, maxInputImages: cap });
      else if (model.modality === 'video') Object.assign(placeholder, { maxInputImages: 1 });
      const options = generationOptions(placeholder);
      return options ? { ...placeholder, generationOptions: options } : placeholder;
    }));
  return [...models, ...missing];
}

/** Menus list a fixed set: the models an OpenDesign API key serves, in that list's order, then Codex Image. */
const menuOrder = [...openDesignModels.map(model => model.modelId), 'image-generation'];
export const menuRank = (model: Model) => menuOrder.indexOf(model.provider === 'codex' ? model.modelId : isOpenDesignProvider(model.provider) ? model.modelId : '');
export function menuFamilies(models: Model[], providers: ProviderState[]) {
  return modelFamilies(models.filter(model => menuRank(model) >= 0), providers)
    .sort((a, b) => Math.min(...a.variants.map(menuRank)) - Math.min(...b.variants.map(menuRank)));
}

export function imageMenuModels(models: Model[], providers: ProviderState[]) {
  const listed = withOpenDesignModels(models, providers);
  return menuFamilies(listed.filter(model => supportsScene(model, imageScene)), providers);
}
