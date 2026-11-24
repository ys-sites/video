import type { Modality } from './gateway.ts';

/**
 * Models served by an OpenDesign API key, in menu order. Source: the "OpenDesign API multimodal model list"
 * (2026-11-17). The live Cloud catalogue still decides capabilities once a key is configured.
 */
export const openDesignModels: readonly { modelId: string; label: string; modality: Modality; mode: string }[] = [
  { modelId: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', modality: 'image', mode: 'text-to-image' },
  { modelId: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', modality: 'image', mode: 'text-to-image' },
  { modelId: 'seedream-5.5', label: 'Seedream 5.5', modality: 'image', mode: 'text-to-image' },
  { modelId: 'seedream-5.0-flash', label: 'Seedream 5.0 Flash', modality: 'image', mode: 'text-to-image' },
  { modelId: 'doubao-seedance-2-5-260628', label: 'Seedance 2.5', modality: 'video', mode: 'text-to-video' },
  { modelId: 'doubao-seedance-2-5-flash-261115', label: 'Seedance 2.5 Flash', modality: 'video', mode: 'text-to-video' },
  { modelId: 'wan-2.7', label: 'Wan 2.7', modality: 'video', mode: 'text-to-video' },
  { modelId: 'elevenlabs-v3', label: 'Eleven v3', modality: 'audio', mode: 'text-to-speech' },
  { modelId: 'byteplus-tts-2', label: 'BytePlus TTS 2.0', modality: 'audio', mode: 'text-to-speech' },
  // The Cloud catalogue does not list its music model yet, so discovery would otherwise show no music.
  { modelId: 'elevenlabs-music-v2', label: 'Eleven Music v2', modality: 'audio', mode: 'text-to-audio' },
];

export const openDesignModelLabel = (modelId: string) => openDesignModels.find(model => model.modelId === modelId)?.label;

/** Most reference images each OpenDesign image model accepts on /images/edits, measured 2026-11-20
 * ("OpenDesign API image model capabilities, tested"). Seedream 5.5 rejects two or more with HTTP 400. */
const openDesignImageReferenceCaps: Record<string, number> = {
  'gpt-image-2.6-sunburst': 16, 'gpt-image-2.6-flare': 16, 'seedream-5.0-flash': 10, 'seedream-5.5': 1,
};
export const openDesignImageReferenceCap = (modelId: string) => Object.hasOwn(openDesignImageReferenceCaps, modelId) ? openDesignImageReferenceCaps[modelId] : undefined;
