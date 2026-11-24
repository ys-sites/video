export const studioScenes = [
  { id: 'text-to-image', entry: 'landing', modality: 'image', label: 'Create image', icon: 'image-line', hint: 'Describe a subject, a mood, a world.' },
  { id: 'image-edit', entry: 'landing', modality: 'image', requiresImage: true, label: 'Edit image', icon: 'edit-line', hint: 'Choose an image and describe your changes.' },
  { id: 'remove-background', entry: 'landing', modality: 'image', requiresImage: true, feature: 'remove-background', label: 'Remove background', icon: 'scissors-cut-line', hint: 'Choose an image. The subject is kept on a transparent background.' },
  { id: 'relight', entry: 'landing', modality: 'image', requiresImage: true, feature: 'relight', label: 'Relight', icon: 'sun-line', hint: 'Choose an image, then set the light direction, color and mood.' },
  { id: 'character', entry: 'landing', modality: 'image', requiresImage: true, feature: 'character', label: 'Character reference', icon: 'user-3-line', hint: 'Add 1 to 5 images of your character, then describe the new scene.' },
  { id: 'text-to-video', entry: 'landing', modality: 'video', label: 'Create video', icon: 'film-line', hint: 'Describe the scene, movement and atmosphere.' },
  { id: 'image-to-video', entry: 'landing', modality: 'video', requiresImage: true, label: 'Image to video', icon: 'movie-line', hint: 'Choose a first frame and describe the motion.' },
  { id: 'video-camera-control', entry: 'landing', modality: 'video', videoFeature: 'camera-control', label: 'Camera control', icon: 'camera-line', hint: 'Choose a camera movement, add an optional first frame, and describe your scene.' },
  { id: 'video-multi-shot', entry: 'landing', modality: 'video', videoFeature: 'multi-shot', label: 'Multi-shot', icon: 'clapperboard-line', hint: 'Direct a connected multi-shot sequence in a single clip.' },
  { id: 'music', entry: 'landing', modality: 'audio', modelMode: 'text-to-audio', label: 'Music & sound', icon: 'music-2-line', hint: 'Describe the mood, instruments and tempo.' },
  { id: 'speech', entry: 'landing', modality: 'audio', modelMode: 'text-to-speech', label: 'Text to speech', icon: 'voiceprint-line', hint: 'Write the words you want spoken.' },
] as const;

export type StudioScene = typeof studioScenes[number];

const legacySceneAliases: Record<string, StudioScene['id']> = {
  'video-native-audio': 'text-to-video',
  'shot-image': 'text-to-image',
};

/** Only independently addressable scenes can mount the focused generator. */
export function findLandingScene(id: string | null) {
  const resolved = id && Object.hasOwn(legacySceneAliases, id) ? legacySceneAliases[id] : id;
  return studioScenes.find(scene => scene.id === resolved && scene.entry === 'landing');
}

type StudioEntry = {
  id: string; title: string; icon: string; navBadge?: 'Top' | 'New' | 'Hot' | 'Coming soon';
} & (
  | { surface: 'media'; primaryModality: StudioScene['modality']; scenes: readonly [StudioScene['id'], ...StudioScene['id'][]] }
  | { surface: 'editor'; modalities: readonly StudioScene['modality'][]; scenes: readonly [] }
  | { surface: 'techniques'; modalities: readonly StudioScene['modality'][]; scenes: readonly [StudioScene['id'], ...StudioScene['id'][]]; createLabel: string; techniques: readonly [string, ...string[]]; briefHint: string }
);

// Media studios open their first listed scene. The editor surface retains the current project.
export const creativeStudios = [
  { id: 'design', surface: 'media', primaryModality: 'image', title: 'Design Studio', navBadge: 'New', icon: 'palette-line', scenes: ['text-to-image', 'image-edit', 'remove-background', 'relight', 'character'] },
  { id: 'motion', surface: 'editor', modalities: ['video'], title: 'Motion Studio', navBadge: 'Top', icon: 'movie-line', scenes: [] },
  { id: 'cinema', surface: 'media', primaryModality: 'video', title: 'Cinema Studio', navBadge: 'Hot', icon: 'clapperboard-line', scenes: ['text-to-video', 'image-to-video', 'video-camera-control', 'video-multi-shot'] },
  { id: 'sound', surface: 'media', primaryModality: 'audio', title: 'Sound Studio', icon: 'music-2-line', scenes: ['music', 'speech'] },
  { id: 'shorts', surface: 'techniques', title: 'Shorts Studio', briefHint: 'Cut a recording into vertical shorts or assemble several clips into one reel.', icon: 'movie-line', modalities: ['video'], scenes: ['text-to-video', 'image-to-video'], createLabel: 'Create a short clip', techniques: ['openmotion-shortlist-shorts', 'openmotion-multi-clips-to-reels', 'openmotion-caption-styling', 'openmotion-bilingual-captions', 'openmotion-livestream-clips', 'openmotion-edit-to-script', 'openmotion-multicam-edit', 'openmotion-talking-head-recreation', 'openmotion-electric-impact-type', 'openmotion-flat-beat'] },
  { id: 'marketing', surface: 'techniques', title: 'Marketing Studio', briefHint: 'Start with a product shot, a launch film or an ad script and adapt it to your brand.', icon: 'clapperboard-line', modalities: ['video', 'image'], scenes: ['text-to-image', 'text-to-video', 'image-edit', 'image-to-video'], createLabel: 'Create a product image', techniques: ['openmotion-flat-lay-product', 'openmotion-in-hand-product', 'openmotion-website-launch', 'openmotion-before-after', 'openmotion-ad-script', 'openmotion-splash-float-product', 'openmotion-light-shadow-product', 'openmotion-hidden-feature-demo', 'openmotion-spec-sheet', 'openmotion-growth-teardown'] },
  { id: 'explainer', surface: 'techniques', title: 'Explainer Studio', briefHint: 'Turn a topic, a tutorial or a set of figures into an editable visual explanation.', icon: 'film-line', modalities: ['video'], scenes: ['text-to-video', 'image-to-video'], createLabel: 'Create an explainer clip', techniques: ['openmotion-editorial-explainer', 'openmotion-paper-stop-motion', 'openmotion-step-by-step-tutorial', 'openmotion-clay-explainer', 'openmotion-editorial-webinar', 'openmotion-paper-collage-explainer', 'openmotion-whiteboard-doodle', 'openmotion-pixel-art-explainer', 'openmotion-paper-map-journey', 'openmotion-hand-drawn-explainer'] },
  { id: '3d', surface: 'techniques', title: '3D Studio', navBadge: 'Coming soon', briefHint: 'Choose a 3D technique, describe your shot and send the brief to your Agent.', icon: 'box-3-line', modalities: ['video'], scenes: ['text-to-video', 'image-to-video'], createLabel: 'Create a 3D-style clip', techniques: ['three-js', 'babylon-js', 'lume', 'blender', 'openmotion-isometric-card-flight', 'openmotion-surreal-3d-poster'] },
  { id: 'game', surface: 'techniques', title: 'Game Studio', navBadge: 'New', briefHint: 'Pick a genre, style and setting, describe your game in one line and your Agent builds a playable web game.', icon: 'gamepad-line', modalities: ['video'], scenes: ['text-to-video', 'image-to-video'], createLabel: 'Create a game', techniques: ['three-js'] },
] as const satisfies readonly StudioEntry[];

export type CreativeStudio = typeof creativeStudios[number];
export type MediaStudio = Extract<CreativeStudio, { surface: 'media' }>;

export function findMediaStudio(id: string | null): MediaStudio | undefined {
  return creativeStudios.find((studio): studio is MediaStudio => studio.id === id && studio.surface === 'media');
}

export type TechniqueStudio = Extract<CreativeStudio, { surface: 'techniques' }>;
export function findTechniqueStudio(id: string | null) {
  return creativeStudios.find((studio): studio is TechniqueStudio => studio.id === id && studio.surface === 'techniques');
}

export function studiosForModality(modality: StudioScene['modality']) {
  return creativeStudios.filter(studio => studio.surface === 'media'
    ? studio.scenes.some(id => studioScenes.some(scene => scene.id === id && scene.modality === modality))
    : studio.modalities.some(value => value === modality));
}

type Community = { id: string; label: string; description: string; studios: readonly CreativeStudio['id'][] } & (
  { source: 'templates'; category: 'motion' | 'ads' | 'clone' | 'short-form'; scenes: readonly StudioScene['id'][]; skills: readonly string[] } | { source: 'techniques'; studio: TechniqueStudio['id'] }
);
export const exploreCommunities = [
  { id: 'motion-design', label: 'Motion design', description: 'Explore editable motion, storyboards and cuts from the template library.', source: 'templates', category: 'motion', scenes: ['text-to-image', 'image-to-video'], skills: ['openmotion-storyboard-to-motion', 'openmotion-liquid-glass-logo', 'openmotion-neon-outline-type', 'openmotion-edit-to-script', 'openmotion-shutter-bands', 'openmotion-ring-mask-reveal', 'openmotion-smooth-wipes', 'openmotion-bubble-field'], studios: ['motion', 'cinema', 'design'] },
  { id: 'product-films', label: 'Product films', description: 'Stage a product photo, animate a reveal or adapt a launch film.', source: 'templates', category: 'ads', scenes: ['text-to-image', 'image-edit', 'text-to-video'], skills: ['openmotion-flat-lay-product', 'openmotion-in-hand-product'], studios: ['marketing', 'design', 'cinema', 'motion'] },
  { id: 'short-form', label: 'Short-form video', description: 'Browse vertical videos and turn longer footage into captioned clips.', source: 'templates', category: 'short-form', scenes: ['speech', 'text-to-video'], skills: ['openmotion-shortlist-shorts', 'openmotion-multi-clips-to-reels'], studios: ['shorts', 'sound'] },
  { id: 'explainers', label: 'Explainers', description: 'See how an idea becomes a visual story through data, paper animation or a narrated tutorial.', source: 'techniques', studio: 'explainer', studios: ['explainer', 'motion'] },
  { id: '3d-motion', label: '3D motion', description: 'Build a spatial scene, light a product turntable or animate a character with your Agent.', source: 'techniques', studio: '3d', studios: ['3d', 'motion'] },
] as const satisfies readonly Community[];
export type ExploreCommunity = typeof exploreCommunities[number];
