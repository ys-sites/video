import { modelReferenceLimit, type Model } from './gateway.ts';
import { generationOptions } from './generation-options.ts';

/** Normalized media capabilities derived from adapter limits, live `nativeOptions`, and `generationOptions`. */
export type MediaCapabilities = {
  image: {
    edit: boolean;
    maxReferences: number;
    transparentBackground: boolean;
  };
  video: {
    textToVideo: boolean;
    firstFrame: boolean;
  };
};

/** OpenDesign Cloud (API key) and OpenDesign signed-in account share the same managed media API. */
export function isOpenDesignProvider(providerId: string): boolean {
  return providerId === 'opendesign' || providerId === 'account';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function stringList(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.values) ? raw.values : undefined;
  if (!values) return [];
  return values
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function hasPublishedTransparentBackground(model: Model): boolean {
  const native = model.nativeOptions;
  if (native) {
    const values = [
      ...stringList(native.background),
      ...stringList(native.backgrounds),
    ];
    if (values.includes('transparent')) return true;
    if (native.supports_transparent_background === true || native.transparent_background === true) return true;
  }
  const options = model.generationOptions ?? generationOptions(model);
  return Boolean(
    options?.fields.some(
      field => field.key === 'background' && field.choices?.some(choice => String(choice.value).toLowerCase() === 'transparent'),
    ),
  );
}

/**
 * Single capability reader for Studio feature matching.
 * - Image `maxReferences` / `edit` come from `modelReferenceLimit(model)`.
 * - Image `transparentBackground` reads `nativeOptions.background(s)` first, then `generationOptions(model)`.
 * - Video `textToVideo` / `firstFrame` derive from `model.mode` and `modelReferenceLimit(model)`.
 */
export function modelCapabilities(model: Model): MediaCapabilities {
  if (model.modality === 'image') {
    const maxReferences = modelReferenceLimit(model);
    return {
      image: {
        edit: maxReferences > 0,
        maxReferences,
        transparentBackground: hasPublishedTransparentBackground(model),
      },
      video: { textToVideo: false, firstFrame: false },
    };
  }

  if (model.modality === 'video') {
    return {
      image: { edit: false, maxReferences: 0, transparentBackground: false },
      video: {
        textToVideo: !/^(image|video)-to-/.test(model.mode),
        firstFrame: modelReferenceLimit(model) > 0 || model.mode === 'image-to-video',
      },
    };
  }

  return {
    image: { edit: false, maxReferences: 0, transparentBackground: false },
    video: { textToVideo: false, firstFrame: false },
  };
}
