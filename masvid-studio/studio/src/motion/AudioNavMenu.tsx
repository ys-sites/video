import { Button } from 'open-design-ui/button';
import type { CSSProperties } from 'react';
import type { Model } from '../../../shared/gateway';
import { findMediaStudio } from '../../../shared/studio-catalog';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { studioScenes, supportsScene, type StudioDestination } from './creativeStudios';
import voiceSourceAvatar from './scene-art/voice-source-avatar.webp';
import voiceTargetAvatar from './scene-art/voice-target-avatar.webp';
import { ModelAvatar } from './settingsPrimitives';
import { findSoundTab, isSfxModel, type SoundLiveTabId, type SoundTabId } from './soundTabs';
import type { useMediaCatalog } from './useMediaCatalog';
import './audioNavMenu.css';

const MAX_AUDIO_MENU_MODELS = 8;
const MAX_NEW_BADGES = 2;

const MUSIC_BARS = [24, 42, 66, 52, 84, 72, 94, 62, 48, 78, 90, 56, 40, 68, 82, 54, 46, 74, 58, 36, 44, 28] as const;
const TTS_BARS = [26, 46, 38, 62, 82, 54, 74, 92, 64, 42, 78, 86, 52, 34, 64, 72, 48, 38, 56, 30] as const;
const VOICE_BARS = [30, 54, 38, 68, 46, 92, 64, 84, 52, 70, 36] as const;
const DUB_BARS = [26, 48, 62, 44, 76, 88, 54, 68, 94, 58, 72, 46, 82, 60, 40, 74, 86, 50, 64, 44, 70, 52, 38, 28] as const;
const DUB_LANGS = ['EN', 'ZH', 'FR', 'JA', 'ES'] as const;

export interface AudioNavFeatureCard {
  id: Extract<SoundTabId, 'music' | 'speech' | 'voice-changer' | 'dubbing'>;
  label: string;
  soon: boolean;
}

export const AUDIO_MENU_CARDS: readonly AudioNavFeatureCard[] = [
  { id: 'music', label: 'Music', soon: false },
  { id: 'speech', label: 'Text to speech', soon: false },
  { id: 'voice-changer', label: 'Voice changer', soon: true },
  { id: 'dubbing', label: 'Dubbing', soon: true },
];

export interface AudioNavMenuProps {
  destination: StudioDestination | null;
  activeSoundTab?: SoundTabId | null;
  catalog: ReturnType<typeof useMediaCatalog>['catalog'];
  failed?: boolean;
  onSelect: (
    next: StudioDestination,
    soundTab: SoundTabId | null,
    source: 'scene' | 'model',
  ) => void;
}

export function audioModelTab(model: Pick<Model, 'id' | 'modelId' | 'label' | 'mode'>): SoundLiveTabId {
  if (model.mode === 'text-to-speech') return 'speech';
  if (isSfxModel(model)) return 'sfx';
  return 'music';
}

function audioModelPriority(model: Pick<Model, 'id' | 'modelId' | 'label' | 'mode'>): number {
  const key = `${model.modelId} ${model.label}`.toLowerCase();
  if (/elevenlabs[-_/]?v3|elevenlabs\s+voice/.test(key)) return 0;
  if (/elevenlabs[-_/]?music/.test(key)) return 1;
  if (/suno|chirp/.test(key)) return 2;
  if (/sound[-_ ]?effects?|\bsfx\b/.test(key)) return 3;
  if (/byteplus|seed[-_ ]?(?:speech|audio)/.test(key)) return 4;
  if (/kokoro/.test(key)) return 5;
  if (/minimax/.test(key)) return 6;
  if (/qwen/.test(key)) return 7;
  return model.mode === 'text-to-speech' ? 10 : 11;
}

export function isNewAudioModel(model: Pick<Model, 'id' | 'modelId' | 'label'>): boolean {
  const key = `${model.modelId} ${model.label}`.toLowerCase();
  return /elevenlabs[-_/]?v3|elevenlabs\s+voice|elevenlabs[-_/]?music|suno\/chirp-v4|suno v4/.test(key);
}

export function curateAudioMenuModels(
  catalog: ReturnType<typeof useMediaCatalog>['catalog'],
  limit = MAX_AUDIO_MENU_MODELS,
): Model[] {
  if (!catalog) return [];
  const audioScenes = studioScenes.filter(scene => scene.modality === 'audio');
  const availableProviders = new Set(
    catalog.status.providers.filter(provider => provider.available).map(provider => provider.id),
  );
  const compatible = catalog.models.filter(
    model => model.modality === 'audio' && audioScenes.some(scene => supportsScene(model, scene)),
  );
  const sorted = [...compatible].sort((a, b) => {
    const aAvail = availableProviders.has(a.provider) ? 0 : 1;
    const bAvail = availableProviders.has(b.provider) ? 0 : 1;
    if (aAvail !== bAvail) return aAvail - bAvail;
    const rankDiff = audioModelPriority(a) - audioModelPriority(b);
    if (rankDiff !== 0) return rankDiff;
    return a.label.localeCompare(b.label);
  });
  const byLabel = new Map<string, Model>();
  for (const model of sorted) {
    if (!byLabel.has(model.label)) byLabel.set(model.label, model);
  }
  return [...byLabel.values()].slice(0, limit);
}

export interface AudioSpotlight {
  model: Model;
  description: string;
}

export function pickAudioSpotlight(models: readonly Model[]): AudioSpotlight | null {
  if (!models.length) return null;
  const ranked = [...models].sort((a, b) => audioModelPriority(a) - audioModelPriority(b));
  const model = ranked[0];
  const key = `${model.modelId} ${model.label}`.toLowerCase();
  if (/elevenlabs[-_/]?v3|elevenlabs\s+voice/.test(key)) {
    return { model, description: 'Expressive narration with natural pacing and voice control' };
  }
  if (/elevenlabs[-_/]?music/.test(key)) {
    return { model, description: 'Studio-grade background scores and instrumentals' };
  }
  if (/suno|chirp/.test(key)) {
    return { model, description: 'Full-arrangement music from mood and genre prompts' };
  }
  if (isSfxModel(model)) {
    return { model, description: 'Crisp foley, transitions and sound cues on demand' };
  }
  return { model, description: 'Open in Audio workspace with this model selected' };
}

function Waveform({
  bars,
  litBefore,
  litFrom,
  playheadPercent,
  className = '',
}: {
  bars: readonly number[];
  litBefore?: number;
  litFrom?: number;
  playheadPercent?: number;
  className?: string;
}) {
  return (
    <span className={`om-audio-demo-wave ${className}`.trim()}>
      {bars.map((height, index) => {
        const lit =
          (litBefore !== undefined && index < litBefore) ||
          (litFrom !== undefined && index >= litFrom);
        const softLit =
          litFrom !== undefined && index >= Math.max(0, litFrom - 2) && index < litFrom;
        return (
          <span
            key={index}
            className="om-audio-demo-bar"
            data-lit={lit || undefined}
            data-soft-lit={softLit || undefined}
            style={{ height: `${height}%`, '--bar-i': index } as CSSProperties}
          />
        );
      })}
      {playheadPercent !== undefined && (
        <span className="om-audio-demo-playhead" style={{ left: `${playheadPercent}%` }} />
      )}
    </span>
  );
}

function AudioFeaturePreview({ id }: { id: AudioNavFeatureCard['id'] }) {
  if (id === 'music') {
    return (
      <span className="om-audio-demo-stage" aria-hidden="true">
        <span className="om-audio-demo-music-head">
          <span className="om-audio-demo-chip">
            <span className="om-audio-demo-chip-dot" />
            <span>118 BPM</span>
          </span>
          <span className="om-audio-demo-music-time">0:18</span>
        </span>
        <Waveform bars={MUSIC_BARS} litBefore={13} playheadPercent={59} className="om-audio-demo-music-wave" />
        <span className="om-audio-demo-music-foot">
          <span className="om-audio-demo-music-tags">
            <span data-active="true">Piano</span>
            <span>·</span>
            <span>Synth</span>
            <span>·</span>
            <span>SFX</span>
          </span>
        </span>
      </span>
    );
  }

  if (id === 'speech') {
    return (
      <span className="om-audio-demo-stage" aria-hidden="true">
        <span className="om-audio-demo-tts-copy">
          <span>Every idea deserves</span>
          <em>to be seen and heard,</em>
          <span>where our story begins.</span>
        </span>
        <span className="om-audio-demo-tts-bar">
          <span className="om-audio-demo-play-orb">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <polygon points="7,4 20,12 7,20" />
            </svg>
          </span>
          <Waveform bars={TTS_BARS} litBefore={12} playheadPercent={60} />
        </span>
      </span>
    );
  }

  if (id === 'voice-changer') {
    return (
      <span className="om-audio-demo-stage om-audio-demo-voice-stage" aria-hidden="true">
        <span className="om-audio-demo-voice-row">
          <span className="om-audio-demo-avatar">
            <img src={voiceSourceAvatar} alt="" draggable={false} />
          </span>
          <Waveform bars={VOICE_BARS} litFrom={5} className="om-audio-demo-voice-wave" />
          <span className="om-audio-demo-avatar" data-target="true">
            <img src={voiceTargetAvatar} alt="" draggable={false} />
          </span>
        </span>
      </span>
    );
  }

  return (
    <span className="om-audio-demo-stage" aria-hidden="true">
      <span className="om-audio-demo-dub-phrase">Bonjour à tous !</span>
      <Waveform bars={DUB_BARS} litBefore={11} playheadPercent={46} className="om-audio-demo-dub-wave" />
      <span className="om-audio-demo-langs">
        {DUB_LANGS.map(code => (
          <span key={code} className="om-audio-demo-lang" data-active={code === 'FR' || undefined}>
            {code}
          </span>
        ))}
      </span>
    </span>
  );
}

export function AudioNavMenu({ destination, activeSoundTab, catalog, failed, onSelect }: AudioNavMenuProps) {
  const { t } = useI18n();
  const soundStudio = findMediaStudio('sound')!;
  const musicScene = studioScenes.find(scene => scene.id === 'music')!;
  const speechScene = studioScenes.find(scene => scene.id === 'speech')!;

  const currentTab: SoundTabId | null =
    destination?.scene.modality === 'audio'
      ? (activeSoundTab ?? (destination.scene.id === 'speech' ? 'speech' : 'music'))
      : null;

  const pinned = catalog?.models.find(model => model.id === destination?.model);
  const models = curateAudioMenuModels(catalog);
  const spotlight = pickAudioSpotlight(models);
  const loading = !catalog && !failed;

  let newBadgeCount = 0;
  const newModelIds = new Set<string>();
  for (const model of models) {
    if (newBadgeCount < MAX_NEW_BADGES && isNewAudioModel(model)) {
      newModelIds.add(model.id);
      newBadgeCount++;
    }
  }

  const openCard = (card: AudioNavFeatureCard) => {
    const tabDef = findSoundTab(card.id);
    const targetScene = tabDef?.backingScene === 'speech' ? speechScene : musicScene;
    const keepPinned =
      !card.soon &&
      pinned &&
      supportsScene(pinned, targetScene) &&
      (card.id === 'music' ? !isSfxModel(pinned) : true)
        ? pinned.id
        : null;
    const nextDestination: StudioDestination = {
      studio: soundStudio,
      scene: targetScene,
      model: keepPinned,
      mediaTab: true,
    };
    const nextSoundTab: SoundTabId | null =
      card.id === 'music' || card.id === 'speech' ? null : card.id;
    onSelect(nextDestination, nextSoundTab, 'scene');
  };

  const openModel = (model: Model) => {
    const tabId = audioModelTab(model);
    const targetScene = tabId === 'speech' ? speechScene : musicScene;
    const nextDestination: StudioDestination = {
      studio: soundStudio,
      scene: targetScene,
      model: model.id,
      mediaTab: true,
    };
    onSelect(nextDestination, tabId === 'sfx' ? 'sfx' : null, 'model');
  };

  return (
    <div className="om-audio-menu">
      <div className="om-audio-menu-cards">
        {AUDIO_MENU_CARDS.map(card => {
          const isActive = currentTab === card.id;
          return (
            <Button
              key={card.id}
              type="button"
              variant="plain"
              className="om-scene-tile om-audio-menu-card"
              data-audio-card={card.id}
              aria-current={isActive ? 'page' : undefined}
              aria-label={card.soon ? `${t(card.label)} · ${t('Coming soon')}` : t(card.label)}
              onClick={() => openCard(card)}
            >
              <AudioFeaturePreview id={card.id} />
              <span className="om-audio-menu-card-caption">
                <strong>{t(card.label)}</strong>
                {card.soon && <span className="om-audio-menu-soon">{t('Soon')}</span>}
              </span>
            </Button>
          );
        })}
      </div>

      {(loading || models.length > 0) && (
        <section className="om-audio-menu-models" aria-label={t('Audio models')}>
          <span className="om-audio-menu-section-label">{t('Models')}</span>
          {loading ? (
            <div className="om-audio-menu-models-grid" role="status" aria-label={t('Loading audio models…')}>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="om-audio-menu-model-skeleton" />
              ))}
            </div>
          ) : (
            <div className="om-audio-menu-models-grid">
              {models.map(model => (
                <Button
                  key={model.id}
                  type="button"
                  variant="plain"
                  className="om-audio-menu-model-item"
                  data-audio-model={model.id}
                  onClick={() => openModel(model)}
                >
                  <span className="om-audio-menu-model-icon" role="img" aria-label={model.label}>
                    <ModelAvatar
                      name={model.label}
                      modelId={model.modelId}
                      provider={{ id: model.provider, custom: model.source === 'custom' }}
                    />
                  </span>
                  <span className="om-audio-menu-model-name">{model.label}</span>
                  {newModelIds.has(model.id) && (
                    <span className="om-audio-menu-new-pill">{t('NEW')}</span>
                  )}
                </Button>
              ))}
            </div>
          )}
        </section>
      )}

      {spotlight && (
        <Button
          type="button"
          variant="plain"
          className="om-audio-menu-spotlight"
          data-audio-spotlight={spotlight.model.id}
          onClick={() => openModel(spotlight.model)}
        >
          <span className="om-audio-menu-spotlight-copy">
            <span className="om-audio-menu-new-pill">{t('NEW')}</span>
            <strong className="om-audio-menu-spotlight-title">{spotlight.model.label}</strong>
            <span className="om-audio-menu-spotlight-desc">{t(spotlight.description)}</span>
          </span>
          <span className="om-audio-menu-spotlight-cta">
            <span>{t('Try now')}</span>
            <RemixIcon name="arrow-right-s-line" size={16} />
          </span>
        </Button>
      )}
    </div>
  );
}
