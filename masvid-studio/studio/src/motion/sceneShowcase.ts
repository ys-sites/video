import type { StudioDestination, StudioScene } from './creativeStudios';
import { archivedSkillPoster, motionSkills } from './skillCatalog';
import lunar from './scene-art/apollo-11.jpg';
import speakerRoom from './scene-art/speaker-room.webp';
import speakerStudio from './scene-art/speaker-studio.webp';
import soundtrackCover from './scene-art/ambient-piano.webp';
import welcomeMusic from '../../../template-library/openmotion-welcome/assets/soundtrack.m4a?url';
import studiesScore from '../../../examples/motion-studies/assets/score.m4a?url';
import studiesCover from './scene-art/studies-score.webp';
import wingScore from '../../../examples/wing-construction/assets/score.m4a?url';
import wingCover from './scene-art/wing-score.webp';
import revealCues from './scene-art/reveal-cues.m4a?url';
import revealCover from './scene-art/reveal-cues.webp';
import flightEffects from './scene-art/flight-effects.m4a?url';
import flightCover from './scene-art/flight-effects.webp';
import padAudio from './scene-art/sfx-pad.m4a?url';
import padCover from './scene-art/sfx-pad.webp';
import chimeAudio from './scene-art/sfx-chime.m4a?url';
import chimeCover from './scene-art/sfx-chime.webp';
import successAudio from './scene-art/sfx-success.m4a?url';
import successCover from './scene-art/sfx-success.webp';
import clickAudio from './scene-art/sfx-click.m4a?url';
import clickCover from './scene-art/sfx-click.webp';
import whooshAudio from './scene-art/sfx-whoosh.m4a?url';
import whooshCover from './scene-art/sfx-whoosh.webp';
import impactAudio from './scene-art/sfx-impact.m4a?url';
import impactCover from './scene-art/sfx-impact.webp';
import riserAudio from './scene-art/sfx-riser.m4a?url';
import riserCover from './scene-art/sfx-riser.webp';
import typingAudio from './scene-art/sfx-typing.m4a?url';
import typingCover from './scene-art/sfx-typing.webp';

const product = archivedSkillPoster('light-shadow-product');
const splash = archivedSkillPoster('splash-float-product');
const narration = archivedSkillPoster('talking-head-recreation');
const camera = archivedSkillPoster('babylon-js');

/** Audio templates name the model to reproduce them with; the bundled files are the repository's own scores and effects, not output from that model. */
export interface SceneExample { title: string; prompt: string; poster: string; posterAspect?: number; posterPosition?: string; credit?: string; creditUrl?: string; clip?: string; audio?: string; waveform?: readonly number[]; seconds?: number; model?: string; kind?: 'Music' | 'Sound effect' }

// Normalized RMS amplitudes sampled across the bundled welcome soundtrack.
const welcomeWaveform = [
  2, 29, 39, 37, 45, 37, 40, 47, 39, 50, 51, 24, 84, 88, 58, 82, 81, 87, 47, 80, 90, 85, 53, 91,
  82, 88, 51, 84, 88, 83, 53, 94, 81, 72, 58, 82, 92, 77, 59, 83, 86, 89, 68, 84, 92, 73, 63, 94,
  85, 40, 13, 14, 9, 10, 15, 84, 85, 67, 73, 83, 87, 61, 77, 88, 86, 63, 81, 80, 89, 57, 80, 87,
  84, 59, 86, 83, 85, 56, 86, 92, 85, 23, 93, 82, 88, 55, 87, 87, 77, 66, 92, 83, 52, 36, 2, 2,
];

// Normalized RMS amplitudes of the other bundled audio templates, 96 samples each.
// Previews in scene-art are compressed copies of the repository's own example scores, cues and effects;
// the sfx-* clips are synthesized for these templates and owned by the project.
const studiesWaveform = [64, 89, 87, 78, 69, 61, 53, 46, 41, 36, 60, 70, 53, 70, 94, 93, 86, 78, 70, 63, 56, 51, 45, 40, 36, 33, 81, 92, 90, 82, 73, 65, 59, 52, 47, 42, 37, 34, 74, 75, 64, 51, 41, 86, 91, 87, 79, 70, 62, 55, 48, 43, 38, 34, 77, 81, 73, 62, 52, 44, 44, 87, 86, 80, 70, 60, 51, 45, 38, 51, 82, 71, 58, 47, 55, 87, 81, 72, 62, 52, 43, 38, 72, 69, 57, 45, 81, 71, 59, 47, 60, 81, 73, 61, 50, 23];
const wingWaveform = [36, 68, 75, 67, 59, 53, 49, 79, 89, 83, 76, 72, 67, 62, 57, 51, 47, 43, 58, 78, 84, 71, 65, 60, 54, 48, 51, 79, 77, 61, 54, 72, 90, 82, 75, 71, 65, 61, 55, 50, 46, 44, 74, 83, 78, 67, 62, 55, 51, 48, 73, 84, 77, 65, 59, 53, 49, 64, 74, 72, 54, 81, 94, 90, 87, 85, 81, 78, 73, 69, 64, 61, 56, 52, 49, 46, 42, 40, 38, 63, 80, 91, 82, 79, 75, 72, 66, 61, 56, 53, 47, 44, 40, 46, 40, 12];
const cueWaveform = [2, 94, 66, 35, 46, 44, 14, 4, 2, 33, 24, 9, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 47, 77, 48, 30, 18, 43, 19, 7, 3, 43, 20, 7, 2, 2, 2, 2, 94, 87, 62, 43, 31, 22, 15, 11, 8, 5, 4, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 50, 56, 29, 15, 8, 4, 2, 2, 2, 2, 43, 81, 54, 36, 23, 15, 63, 46, 28, 17, 44, 74, 42, 24, 14, 8, 4, 2];
const flightWaveform = [2, 2, 30, 58, 74, 76, 74, 72, 69, 63, 56, 51, 39, 28, 48, 10, 3, 2, 2, 7, 13, 23, 27, 32, 38, 43, 46, 48, 49, 48, 49, 49, 51, 49, 50, 51, 52, 50, 51, 50, 51, 51, 51, 53, 51, 51, 51, 52, 52, 50, 51, 52, 51, 50, 51, 50, 49, 49, 49, 46, 42, 39, 35, 31, 26, 22, 21, 45, 44, 52, 46, 43, 47, 43, 43, 34, 2, 2, 2, 94, 79, 47, 29, 19, 12, 8, 6, 4, 47, 45, 33, 2, 2, 2, 2, 2];

const splashClip = motionSkills.find(skill => skill.id === 'openmotion-splash-float-product')?.cover?.video;
const productClip = motionSkills.find(skill => skill.id === 'openmotion-light-shadow-product')?.cover?.video;

const portrait = { title: 'Product portrait', prompt: 'Photograph an amber glass bottle in warm sidelight, with soft leaf shadows on stone.', poster: product, posterAspect: 16 / 9, clip: productClip };
const cameraStudy = { title: 'Vintage camera study', prompt: 'Frame a vintage camera in soft sidelight. Let the background fall into shadow.', poster: camera, posterAspect: 16 / 9 };
const moon = { title: 'Lunar portrait', prompt: 'Frame a lone astronaut on a silver lunar plain. Use a low horizon, deep shadows and light reflected in the visor.', poster: lunar, posterAspect: 1024 / 999, posterPosition: 'center top', credit: 'NASA · AS11-40-5903' };
const orange = { title: 'Slow motion detail', prompt: 'Film a slow-motion close-up of an orange soda bottle with citrus slices, mint and splashing water.', poster: splash, posterAspect: 16 / 9, clip: splashClip };

export const sceneExamples: Record<StudioScene['id'], readonly [SceneExample, ...SceneExample[]]> = {
  'text-to-image': [portrait, moon, cameraStudy],
  'image-edit': [{ title: 'From studio to living room', prompt: 'Keep the speaker in place. Put it on a wooden side table in a sunlit living room.', poster: speakerRoom, posterAspect: 800 / 500 }],
  'remove-background': [{ title: 'A clean product cutout', prompt: 'Keep only the speaker.', poster: speakerStudio, posterAspect: 800 / 500 }],
  relight: [{ title: 'Late afternoon light', prompt: 'Let the light fall across the table and leave soft shadows behind the speaker.', poster: speakerRoom, posterAspect: 800 / 500 }],
  character: [{ title: 'The same astronaut, a new place', prompt: 'Show the same astronaut walking through a neon-lit city street at night.', poster: lunar, posterAspect: 1024 / 999, posterPosition: 'center top', credit: 'NASA · AS11-40-5903' }],
  'text-to-video': [orange],
  'image-to-video': [{ title: 'A cinematic opening', prompt: 'Start on the supplied frame. Push in slowly as a band of sunlight moves across the product.', poster: product, posterAspect: 16 / 9, clip: productClip }],
  'video-camera-control': [{ title: 'Orbital hero shot', prompt: 'Slow cinematic 360-degree camera orbit around a vintage camera on dark stone with dramatic rim lighting.', poster: camera, posterAspect: 16 / 9 }],
  'video-multi-shot': [{ title: 'Three-shot lunar story', prompt: 'Wide establishing shot of an astronaut on a silver lunar ridge, cutting to a medium tracking shot of boots in dust, ending on a close-up of Earth reflected in the visor.', poster: lunar, posterAspect: 1024 / 999, posterPosition: 'center top', credit: 'NASA · AS11-40-5903' }],
  music: [
    { title: 'Ambient soundtrack', kind: 'Music', prompt: 'Compose a quiet instrumental with soft piano and airy synths for a sunrise scene.', poster: soundtrackCover, audio: welcomeMusic, waveform: welcomeWaveform, seconds: 37, model: 'ElevenLabs Music' },
    { title: 'Minimal product score', kind: 'Music', prompt: 'Compose a calm, minimal instrumental at about 60 BPM. Let single bell-like notes ring out and fade, with space between phrases for a product film.', poster: studiesCover, audio: studiesScore, waveform: studiesWaveform, seconds: 32, model: 'ElevenLabs Music' },
    { title: 'Bright launch score', kind: 'Music', prompt: 'Compose a bright, light instrumental of plucked notes at about 66 BPM that builds to a short lift before the logo appears.', poster: wingCover, audio: wingScore, waveform: wingWaveform, seconds: 12, model: 'Suno v4' },
    { title: 'Ambient pad', kind: 'Music', prompt: 'Compose a slow, warm synth pad in A major that swells gently for twelve seconds, for a calm background.', poster: padCover, audio: padAudio, seconds: 12, model: 'ElevenLabs Music' },
    { title: 'Interface cues', kind: 'Sound effect', prompt: 'Create a set of short, low pitched interface cues with soft attacks and quick decays, one for each step of a reveal.', poster: revealCover, audio: revealCues, waveform: cueWaveform, seconds: 5, model: 'ElevenLabs Sound Effects' },
    { title: 'Flight transition', kind: 'Sound effect', prompt: 'Create a jet take-off whoosh that settles into a steady cabin hum, then ends with a landing thud and two light clicks.', poster: flightCover, audio: flightEffects, waveform: flightWaveform, seconds: 6, model: 'ElevenLabs Sound Effects' },
    { title: 'Notification chime', kind: 'Sound effect', prompt: 'Create a soft two-note notification chime that rises in pitch, with a short airy tail.', poster: chimeCover, audio: chimeAudio, seconds: 2, model: 'ElevenLabs Sound Effects' },
    { title: 'Success sound', kind: 'Sound effect', prompt: 'Create a bright four-note rising arpeggio with a light bell tone that confirms a completed action.', poster: successCover, audio: successAudio, seconds: 2, model: 'ElevenLabs Sound Effects' },
    { title: 'Interface tap', kind: 'Sound effect', prompt: 'Create three short, soft interface taps with a gentle bell tone.', poster: clickCover, audio: clickAudio, seconds: 1, model: 'ElevenLabs Sound Effects' },
    { title: 'Transition whoosh', kind: 'Sound effect', prompt: 'Create a smooth air whoosh that swells and fades over about one and a half seconds for a scene transition.', poster: whooshCover, audio: whooshAudio, seconds: 2, model: 'ElevenLabs Sound Effects' },
    { title: 'Title impact', kind: 'Sound effect', prompt: 'Create a deep cinematic impact with a low boom and a short hit that rings out under a title reveal.', poster: impactCover, audio: impactAudio, seconds: 3, model: 'ElevenLabs Sound Effects' },
    { title: 'Tension riser', kind: 'Sound effect', prompt: 'Create a four-second riser that climbs in pitch and brightness and cuts off at its peak.', poster: riserCover, audio: riserAudio, seconds: 4, model: 'ElevenLabs Sound Effects' },
    { title: 'Keyboard typing', kind: 'Sound effect', prompt: 'Create a few seconds of soft, irregular keyboard typing, close and dry.', poster: typingCover, audio: typingAudio, seconds: 4, model: 'ElevenLabs Sound Effects' },
  ],
  speech: [{ title: 'Warm narration', prompt: 'Every idea deserves to be seen. This is where our story begins.', poster: narration }],
};

export function studioExamples({ studio, scene }: StudioDestination): readonly SceneExample[] {
  if (studio.surface === 'techniques' && scene.id === 'text-to-video') {
    const skill = motionSkills.find(item => item.id === studio.techniques[0]);
    if (skill?.cover?.poster) return [{
      title: skill.title, poster: skill.cover.poster, posterAspect: skill.cover.aspect ?? 16 / 9, clip: skill.cover.video, credit: skill.repository ? skill.name : undefined,
      prompt: studio.id === 'shorts' ? 'Frame a podcast host vertically as she leans into the microphone to deliver her opening line.' : skill.example,
    }];
  }
  return sceneExamples[scene.id];
}

export function sceneLayout(scene: StudioScene) {
  return scene.modality === 'image' && !('requiresImage' in scene) ? 'canvas' : 'workbench';
}
