import type { Model } from './gateway.ts';
import { isOpenDesignProvider, modelCapabilities, type MediaCapabilities } from './model-capabilities.ts';

/**
 * Image features composed from one edit request. Each feature declares the model capabilities it requires
 * (rather than a static model ID allowlist) so newly published models automatically participate once capable.
 */
export type ImageFeatureId = 'remove-background' | 'relight' | 'character';
export type ImageFeature = {
  requires: (capabilities: MediaCapabilities) => boolean;
  recommended: string;
  maxReferences: number;
  parameters?: Record<string, unknown>;
  promptOptional: boolean;
  actionLabel?: string;
};

export const imageFeatures: Record<ImageFeatureId, ImageFeature> = {
  'remove-background': {
    requires: capabilities => capabilities.image.edit && capabilities.image.maxReferences >= 1 && capabilities.image.transparentBackground,
    recommended: 'gpt-image-2.6-sunburst',
    maxReferences: 1,
    parameters: { background: 'transparent' },
    promptOptional: true,
    actionLabel: 'Remove background',
  },
  relight: {
    requires: capabilities => capabilities.image.edit && capabilities.image.maxReferences >= 1,
    recommended: 'seedream-5.5',
    maxReferences: 1,
    promptOptional: true,
    actionLabel: 'Relight',
  },
  // Seedream 5.5 stays eligible for 1 reference; creationModels drops models whose reference limit is below the attached count.
  character: {
    requires: capabilities => capabilities.image.edit && capabilities.image.maxReferences >= 1,
    recommended: 'gpt-image-2.6-sunburst',
    maxReferences: 5,
    promptOptional: false,
  },
};

/** Pure capability check (provider-agnostic): whether a model can run this image feature. */
export function imageFeatureCapable(feature: ImageFeatureId, model: Model): boolean {
  return model.modality === 'image' && imageFeatures[feature].requires(modelCapabilities(model));
}

/** Studio feature eligibility: OpenDesign route plus the required model capabilities. */
export function imageFeatureSupported(feature: ImageFeatureId, model: Model): boolean {
  return isOpenDesignProvider(model.provider) && imageFeatureCapable(feature, model);
}

type LightChoice = { value: string; label: string; prompt: string };
export const relightControls: readonly { key: 'direction' | 'temperature' | 'mood'; label: string; choices: readonly [LightChoice, ...LightChoice[]] }[] = [
  { key: 'direction', label: 'Light direction', choices: [
    { value: 'left', label: 'Left side light', prompt: 'key light from the left side' },
    { value: 'right', label: 'Right side light', prompt: 'key light from the right side' },
    { value: 'front', label: 'Front light', prompt: 'soft frontal key light' },
    { value: 'top', label: 'Top light', prompt: 'overhead top light' },
    { value: 'back', label: 'Backlight', prompt: 'backlight with a rim of light around the subject' },
  ] },
  { key: 'temperature', label: 'Color temperature', choices: [
    { value: 'warm', label: 'Warm light', prompt: 'warm color temperature around 3200K' },
    { value: 'neutral', label: 'Neutral daylight', prompt: 'neutral daylight around 5600K' },
    { value: 'cool', label: 'Cool light', prompt: 'cool color temperature around 7500K' },
  ] },
  { key: 'mood', label: 'Lighting mood', choices: [
    { value: 'studio', label: 'Soft studio', prompt: 'soft, even studio lighting with gentle shadows' },
    { value: 'golden-hour', label: 'Golden hour', prompt: 'low golden-hour sunlight with long soft shadows' },
    { value: 'dramatic', label: 'Dramatic contrast', prompt: 'dramatic high-contrast lighting with deep shadows' },
    { value: 'neon', label: 'Neon night', prompt: 'colorful neon night lighting with glowing reflections' },
    { value: 'moonlight', label: 'Moonlight', prompt: 'dim blue moonlight' },
  ] },
];
export type RelightChoices = Partial<Record<typeof relightControls[number]['key'], string>>;

/** The prompt sent to the model: the feature's fixed instruction, then what the user wrote. */
export function imageFeaturePrompt(feature: ImageFeatureId, prompt: string, relight: RelightChoices = {}): string {
  const note = prompt.trim();
  if (feature === 'remove-background') return 'Remove the entire background and isolate only the main subject cleanly on a transparent background. '
    + 'Keep the subject identical in shape, texture, and lighting.' + (note ? ' ' + note : '');
  if (feature === 'relight') {
    const light = relightControls.map(control => (control.choices.find(choice => choice.value === relight[control.key]) ?? control.choices[0]).prompt).join(', ');
    return 'Relight this image. Keep the subject, composition, pose and every detail unchanged; change only the lighting, shadows and reflections. '
      + `Lighting: ${light}.` + (note ? ' ' + note : '');
  }
  return 'Keep the character from the reference images consistent: the same face, hairstyle, body shape, skin tone, outfit and distinguishing features. '
    + note;
}
