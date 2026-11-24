import { classifyAudioKind, isAudioKind, isSfxModelText, type AudioKind } from '../../../shared/audio-kind';
import type { Model } from '../../../shared/gateway';

export type SoundLiveTabId = 'music' | 'sfx' | 'speech';
export type SoundSoonTabId = 'voice-clone' | 'voice-changer' | 'dubbing' | 'stems';
export type SoundTabId = SoundLiveTabId | SoundSoonTabId;
export type SoundTabGroupId = 'create' | 'voice' | 'post';

export interface SoundPipelineNode {
  icon: string;
  label: string;
  spec: string;
}

export interface SoundTabDefinition {
  id: SoundTabId;
  group: SoundTabGroupId;
  label: string;
  icon: string;
  status: 'live' | 'soon';
  backingScene: 'music' | 'speech';
  /** Closest active tab for one-click navigation from a Coming Soon preview. */
  pivotTab?: SoundLiveTabId;
  /** Visual 3-node Input -> Engine -> Output blueprint for Coming Soon previews. */
  pipeline?: readonly [SoundPipelineNode, SoundPipelineNode, SoundPipelineNode];
}

export const SOUND_TABS: readonly SoundTabDefinition[] = [
  {
    id: 'music',
    group: 'create',
    label: 'Music',
    icon: 'music-2-line',
    status: 'live',
    backingScene: 'music',
  },
  {
    id: 'sfx',
    group: 'create',
    label: 'Sound effects',
    icon: 'flashlight-line',
    status: 'live',
    backingScene: 'music',
  },
  {
    id: 'speech',
    group: 'voice',
    label: 'Text to speech',
    icon: 'voiceprint-line',
    status: 'live',
    backingScene: 'speech',
  },
  {
    id: 'voice-clone',
    group: 'voice',
    label: 'Voice cloning',
    icon: 'mic-line',
    status: 'soon',
    backingScene: 'speech',
    pivotTab: 'speech',
    pipeline: [
      { icon: 'mic-line', label: 'Voice sample', spec: '10–30s audio' },
      { icon: 'voiceprint-line', label: 'Voice profile', spec: 'Reusable ID' },
      { icon: 'volume-up-line', label: 'New speech', spec: 'Your voice' },
    ],
  },
  {
    id: 'voice-changer',
    group: 'voice',
    label: 'Voice changer',
    icon: 'exchange-2-line',
    status: 'soon',
    backingScene: 'speech',
    pivotTab: 'speech',
    pipeline: [
      { icon: 'mic-line', label: 'Source vocal', spec: 'Timing & tone' },
      { icon: 'exchange-2-line', label: 'Speech to speech', spec: 'Target voice' },
      { icon: 'voiceprint-line', label: 'Restyled take', spec: 'Synced pacing' },
    ],
  },
  {
    id: 'dubbing',
    group: 'voice',
    label: 'Dubbing',
    icon: 'global-line',
    status: 'soon',
    backingScene: 'speech',
    pivotTab: 'speech',
    pipeline: [
      { icon: 'file-video-line', label: 'Video or audio', spec: 'Original voice' },
      { icon: 'global-line', label: 'Translation', spec: 'EN · ZH · JA · ES' },
      { icon: 'closed-captioning-line', label: 'Dubbed track', spec: 'Voice preserved' },
    ],
  },
  {
    id: 'stems',
    group: 'post',
    label: 'Isolate & stems',
    icon: 'stack-line',
    status: 'soon',
    backingScene: 'music',
    pivotTab: 'music',
    pipeline: [
      { icon: 'music-2-line', label: 'Full mix', spec: 'Noisy or layered' },
      { icon: 'scissors-cut-line', label: 'Stem split', spec: 'Denoise & split' },
      { icon: 'stack-line', label: 'Clean stems', spec: 'Voice · Music · SFX' },
    ],
  },
];

export const SOUND_TAB_GROUPS: readonly { id: SoundTabGroupId; tabs: readonly SoundTabDefinition[] }[] = [
  { id: 'create', tabs: SOUND_TABS.filter(tab => tab.group === 'create') },
  { id: 'voice', tabs: SOUND_TABS.filter(tab => tab.group === 'voice') },
  { id: 'post', tabs: SOUND_TABS.filter(tab => tab.group === 'post') },
];

export function findSoundTab(id: string | null | undefined): SoundTabDefinition | undefined {
  return id ? SOUND_TABS.find(tab => tab.id === id) : undefined;
}

export function isExtendedSoundTab(id: string | null | undefined): id is Exclude<SoundTabId, 'music' | 'speech'> {
  const tab = findSoundTab(id);
  return Boolean(tab && tab.id !== 'music' && tab.id !== 'speech');
}

/** Identify dedicated sound-effects / foley endpoints without misclassifying music generators. */
export function isSfxModel(model: Pick<Model, 'id' | 'modelId' | 'label'>): boolean {
  return isSfxModelText(`${model.id} ${model.modelId} ${model.label}`);
}

/** Infer which live Sound Studio domain produced a saved audio asset version. */
export function classifyAudioTrackTab(
  modelId: string | undefined,
  models: readonly Model[] | undefined,
  source?: string,
  savedAudioKind?: AudioKind,
): AudioKind {
  if (source === 'upload') return 'upload';
  if (isAudioKind(savedAudioKind)) return savedAudioKind;
  if (!modelId) return 'upload';
  const matched = models?.find(model => model.id === modelId);
  if (matched) {
    return classifyAudioKind(matched.id, matched.mode, source, `${matched.modelId} ${matched.label}`);
  }
  return classifyAudioKind(modelId, undefined, source);
}
