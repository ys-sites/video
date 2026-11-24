// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Model } from '../../../shared/gateway';
import { I18nProvider, translate } from '../i18n/I18n';
import audioNavMenuUi from '../i18n/audio-nav-menu-ui.json';
import { languages } from '../i18n/messages';
import {
  AUDIO_MENU_CARDS,
  AudioNavMenu,
  audioModelTab,
  curateAudioMenuModels,
  pickAudioSpotlight,
} from './AudioNavMenu';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const elevenVoice: Model = {
  id: 'opendesign:elevenlabs-v3',
  provider: 'opendesign',
  modelId: 'elevenlabs-v3',
  label: 'ElevenLabs Voice',
  modality: 'audio',
  mode: 'text-to-speech',
  source: 'builtin',
};

const elevenMusic: Model = {
  id: 'opendesign:elevenlabs-music-v2',
  provider: 'opendesign',
  modelId: 'elevenlabs-music-v2',
  label: 'ElevenLabs Music',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'builtin',
};

const sunoMusic: Model = {
  id: 'atlascloud:suno/chirp-v4',
  provider: 'atlascloud',
  modelId: 'suno/chirp-v4',
  label: 'Suno v4',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'builtin',
};

const falSfx: Model = {
  id: 'fal:fal-ai/elevenlabs/sound-effects/v2',
  provider: 'fal',
  modelId: 'fal-ai/elevenlabs/sound-effects/v2',
  label: 'ElevenLabs Sound Effects v2',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'builtin',
};

const byteplusVoice: Model = {
  id: 'opendesign:byteplus-tts-2',
  provider: 'opendesign',
  modelId: 'byteplus-tts-2',
  label: 'BytePlus Voice',
  modality: 'audio',
  mode: 'text-to-speech',
  source: 'builtin',
};

const kokoroVoice: Model = {
  id: 'fal:fal-ai/kokoro/american-english',
  provider: 'fal',
  modelId: 'fal-ai/kokoro/american-english',
  label: 'Kokoro',
  modality: 'audio',
  mode: 'text-to-speech',
  source: 'builtin',
};

const sampleCatalog = {
  models: [kokoroVoice, falSfx, sunoMusic, byteplusVoice, elevenMusic, elevenVoice],
  status: {
    providers: [
      { id: 'opendesign', label: 'OpenDesign', available: true, configured: true, source: 'account' as const, mode: 'account' as const },
      { id: 'atlascloud', label: 'AtlasCloud', available: true, configured: true, source: 'env' as const, mode: 'api-key' as const },
      { id: 'fal', label: 'fal', available: true, configured: true, source: 'env' as const, mode: 'api-key' as const },
    ],
    routes: {},
  },
};

describe('AudioNavMenu', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('curates, orders, and picks spotlight models accurately from the audio catalog', () => {
    expect(audioModelTab(elevenVoice)).toBe('speech');
    expect(audioModelTab(falSfx)).toBe('sfx');
    expect(audioModelTab(sunoMusic)).toBe('music');

    const curated = curateAudioMenuModels(sampleCatalog);
    expect(curated.map(model => model.label)).toEqual([
      'ElevenLabs Voice',
      'ElevenLabs Music',
      'Suno v4',
      'ElevenLabs Sound Effects v2',
      'BytePlus Voice',
      'Kokoro',
    ]);

    const spotlight = pickAudioSpotlight(curated);
    expect(spotlight?.model.id).toBe(elevenVoice.id);
    expect(spotlight?.description).toBe('Expressive narration with natural pacing and voice control');
  });

  it('renders 4 visual feature cards, 2-column models, and spotlight banner and routes clicks accurately', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <AudioNavMenu destination={null} catalog={sampleCatalog} onSelect={onSelect} />
        </I18nProvider>,
      );
    });

    const cards = [...host.querySelectorAll<HTMLButtonElement>('[data-audio-card]')];
    expect(cards.map(card => card.dataset.audioCard)).toEqual(AUDIO_MENU_CARDS.map(card => card.id));
    expect(cards.map(card => card.querySelector('strong')?.textContent)).toEqual([
      'Music',
      'Text to speech',
      'Voice changer',
      'Dubbing',
    ]);

    // Voice changer renders two original circular avatars flanking a waveform.
    const voiceCard = host.querySelector<HTMLButtonElement>('[data-audio-card="voice-changer"]')!;
    expect(voiceCard.querySelectorAll('.om-audio-demo-avatar img')).toHaveLength(2);
    expect(voiceCard.querySelector('.om-audio-menu-soon')?.textContent).toBe('Soon');

    await act(async () => voiceCard.click());
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ studio: expect.objectContaining({ id: 'sound' }), scene: expect.objectContaining({ id: 'speech' }), mediaTab: true }),
      'voice-changer',
      'scene',
    );

    // Clicking an SFX model routes directly to the sfx soundTab with that model pinned.
    const sfxBtn = host.querySelector<HTMLButtonElement>(`[data-audio-model="${falSfx.id}"]`)!;
    await act(async () => sfxBtn.click());
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ scene: expect.objectContaining({ id: 'music' }), model: falSfx.id, mediaTab: true }),
      'sfx',
      'model',
    );

    // Clicking the spotlight banner opens the spotlight model directly in speech.
    const spotlightBtn = host.querySelector<HTMLButtonElement>(`[data-audio-spotlight="${elevenVoice.id}"]`)!;
    expect(spotlightBtn.textContent).toContain('ElevenLabs Voice');
    expect(spotlightBtn.textContent).toContain('Try now');
    await act(async () => spotlightBtn.click());
    expect(onSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ scene: expect.objectContaining({ id: 'speech' }), model: elevenVoice.id, mediaTab: true }),
      null,
      'model',
    );
  });

  it('shows reserved loading skeletons while catalog is pending and localizes cleanly in zh-CN', async () => {
    const onSelect = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <AudioNavMenu destination={null} catalog={undefined} onSelect={onSelect} />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('正在加载音频模型…');
    expect(host.querySelectorAll('.om-audio-menu-model-skeleton')).toHaveLength(6);
    expect(host.querySelector('[data-audio-spotlight]')).toBeNull();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <AudioNavMenu destination={null} catalog={sampleCatalog} onSelect={onSelect} />
        </I18nProvider>,
      );
    });

    expect(host.querySelector('[data-audio-card="speech"] strong')?.textContent).toBe('语音合成');
    expect(host.querySelector('[data-audio-card="voice-changer"] strong')?.textContent).toBe('变声');
    expect(host.querySelector('[data-audio-card="dubbing"] strong')?.textContent).toBe('翻译配音');
    expect(host.querySelector('.om-audio-menu-spotlight')?.textContent).toContain('立即体验');
    expect(host.querySelector('.om-audio-menu-spotlight .om-audio-menu-new-pill')?.textContent).toBe('新');
  });

  it('keeps audio-nav-menu-ui.json complete across all supported non-English locales', () => {
    const baseKeys = Object.keys(audioNavMenuUi['zh-CN']).sort();
    for (const { locale } of languages) {
      if (locale === 'en') continue;
      const entries = audioNavMenuUi[locale as keyof typeof audioNavMenuUi];
      expect(Object.keys(entries).sort(), locale).toEqual(baseKeys);
      for (const [source, text] of Object.entries(entries)) {
        expect(text.trim(), `${locale}: ${source}`).not.toBe('');
        expect(translate(locale, source), `${locale}: ${source}`).toBe(text);
        if (locale === 'zh-CN') expect(text, source).not.toContain('工程');
      }
    }
  });
});
