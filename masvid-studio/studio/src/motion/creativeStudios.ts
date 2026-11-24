import { modelReferenceLimit, type Model, type Modality } from '../../../shared/gateway';
import { imageFeatureSupported, type ImageFeatureId } from '../../../shared/image-features';
import { videoFeatureCapable, type VideoFeatureId } from '../../../shared/video-features';
import { creativeStudios, findMediaStudio, studioScenes, type CreativeStudio, type MediaStudio, type TechniqueStudio, type StudioScene } from '../../../shared/studio-catalog';

export { creativeStudios, studioScenes, type StudioScene };
export const motionStudio = creativeStudios.find(studio => studio.surface === 'editor')!;
type GeneratingStudio = MediaStudio | TechniqueStudio;
/** home: the Sound Studio home (banner and templates) rather than its generation page. */
export type StudioDestination = { studio: GeneratingStudio; scene: StudioScene; model: string | null; landing?: true; home?: true; mediaTab?: true };
export const mediaLabels: Record<Modality, string> = { image: 'Image', video: 'Video', audio: 'Audio' };

export const studioComingSoon = (studio: CreativeStudio | undefined) => Boolean(studio && 'navBadge' in studio && studio.navBadge === 'Coming soon');

/** A Skill brief keeps its own draft, including in the unified editor, so briefs from different studios never share a scene draft. */
export function studioDraftKey({ studio, scene, landing }: StudioDestination, skill?: string | null) {
  return [studio.id, scene.id, ...((studio.surface === 'techniques' || landing) && skill ? [skill] : [])].join('/');
}

/** Skills whose briefs can start a shot in the unified editor. */
export const isStudioTechnique = (skill: string | null | undefined) =>
  Boolean(skill && creativeStudios.some(studio => studio.surface === 'techniques' && studio.techniques.some(id => id === skill)));

export function scenesForStudio(studio: GeneratingStudio) {
  return studio.scenes.map(id => studioScenes.find(scene => scene.id === id)!);
}

export function studioDestination(studio: GeneratingStudio, sceneId?: string | null, model: string | null = null): StudioDestination {
  const scenes = scenesForStudio(studio);
  return { studio, scene: scenes.find(scene => scene.id === sceneId) ?? scenes[0], model };
}

/** Studios with a separate home page, opened from the studio entry rather than the media menu. */
export const hasStudioHome = (studio: CreativeStudio) => studio.id === 'sound';

export function studioIconTone(studio: CreativeStudio): Modality {
  return studio.surface === 'editor' ? studio.modalities[0] : studioDestination(studio).scene.modality;
}

export function sceneDestination(scene: StudioScene, current?: StudioDestination | null, model: string | null = null): StudioDestination {
  const includes = (studio: GeneratingStudio) => studio.scenes.some(id => id === scene.id);
  const studio = current?.studio.surface === 'media' && includes(current.studio) ? current.studio
    : creativeStudios.find((item): item is MediaStudio => item.surface === 'media' && includes(item))!;
  return scene.entry === 'landing' ? { studio, scene, model, landing: true } : { studio, scene, model };
}

/** The unified top-tab editor for a scene: Image and Video open the create page, Audio opens the Audio tab. */
export function mediaEditorDestination(sceneOrId: StudioScene | StudioScene['id'], model: string | null = null): StudioDestination {
  const scene = typeof sceneOrId === 'string' ? studioScenes.find(item => item.id === sceneOrId)! : sceneOrId;
  return scene.modality === 'audio'
    ? { ...studioDestination(findMediaStudio('sound')!, scene.id, model), mediaTab: true as const }
    : sceneDestination(scene, null, model);
}

export const needsImage = (scene: StudioScene) => 'requiresImage' in scene && scene.requiresImage;
export const sceneFeature = (scene: StudioScene): ImageFeatureId | undefined => 'feature' in scene ? scene.feature : undefined;
export const sceneVideoFeature = (scene: StudioScene): VideoFeatureId | undefined => 'videoFeature' in scene ? scene.videoFeature : undefined;
export const isFeatureScene = (scene: StudioScene | undefined): boolean => Boolean(scene && (sceneFeature(scene) || sceneVideoFeature(scene)));

/**
 * Scene eligibility check: image features require OpenDesign capabilities (matching ModelOverview),
 * while video features stay provider-agnostic here so Workflows retain BYOK video models (Studio scopes via creationModels).
 */
export function supportsScene(model: Model, scene: StudioScene) {
  if (model.modality !== scene.modality) return false;
  const feature = sceneFeature(scene);
  if (feature && !imageFeatureSupported(feature, model)) return false;
  const videoFeature = sceneVideoFeature(scene);
  if (videoFeature && !videoFeatureCapable(videoFeature, model)) return false;
  if ('modelMode' in scene && model.mode !== scene.modelMode) return false;
  // Reference-only endpoints need an input that a prompt-only scene cannot supply.
  return needsImage(scene) ? modelReferenceLimit(model) > 0 : !/^(image|video)-to-/.test(model.mode);
}

export function modelsForScenes(
  catalog: { models: readonly Model[]; status: { providers: readonly { id: string; available: boolean }[] } } | undefined,
  modality: Modality,
  scenes: readonly StudioScene[] = studioScenes.filter(scene => scene.modality === modality),
): Model[] {
  if (!catalog) return [];
  const available = new Set(catalog.status.providers.filter(provider => provider.available).map(provider => provider.id));
  return catalog.models
    .filter(model => model.modality === modality && scenes.some(scene => supportsScene(model, scene)))
    .sort((a, b) => Number(available.has(b.provider)) - Number(available.has(a.provider)));
}

export function modelDestination(model: Model, current?: StudioDestination | null): StudioDestination {
  if (current && supportsScene(model, current.scene)) return { ...current, model: model.id };
  const compatible = (scene: StudioScene) => supportsScene(model, scene);
  const scene = (current && scenesForStudio(current.studio).find(compatible)) ?? studioScenes.find(compatible);
  if (!scene) throw new Error('Model has no supported scene');
  return sceneDestination(scene, current, model.id);
}
