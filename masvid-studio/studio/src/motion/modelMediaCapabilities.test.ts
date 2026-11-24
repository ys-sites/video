import { describe, expect, it } from 'vitest';
import type { DirectoryModel } from '../../../shared/provider-directory';
import { translate } from '../i18n/messages';
import { modelDisplayLabel, modelMediaCapabilities, shouldShowInlineModelId } from './modelMediaCapabilities';

const en = (message: string, values?: Record<string, string | number>) => translate('en', message, values);
const zh = (message: string, values?: Record<string, string | number>) => translate('zh-CN', message, values);

describe('modelMediaCapabilities', () => {
  it('derives verified image capabilities from published profiles, reference limits and transparent background support', () => {
    const sunburst: DirectoryModel = {
      id: 'account:gpt-image-2.6-sunburst',
      provider: 'account',
      modelId: 'gpt-image-2.6-sunburst',
      label: 'gpt-image-2.6-sunburst',
      kind: 'image',
      mode: 'text-to-image',
      enabled: true,
      source: 'live',
      supportsImageReference: true,
      maxInputImages: 16,
      nativeOptions: { edits: true, max_input_images: 16, quality: ['low', 'medium', 'high'] },
    };
    expect(modelMediaCapabilities(sunburst, en)).toEqual(['Image editing (up to 16)', 'Transparent background']);
    expect(modelMediaCapabilities(sunburst, zh)).toEqual(['支持最多 16 张参考图', '透明背景']);

    const futureImage: DirectoryModel = {
      id: 'account:future-image-v9',
      provider: 'account',
      modelId: 'future-image-v9',
      label: 'future-image-v9',
      kind: 'image',
      mode: 'text-to-image',
      enabled: true,
      source: 'live',
      supportsImageReference: true,
      maxInputImages: 6,
      nativeOptions: {
        edits: true,
        max_input_images: 6,
        profiles: {
          generations: {
            profiles: [
              { aspect_ratio: '16:9', resolution: '1K' },
              { aspect_ratio: '16:9', resolution: '4K' },
            ],
          },
        },
      },
    };
    expect(modelMediaCapabilities(futureImage, en)).toEqual(['Image editing (up to 6)', 'Up to 4K']);
    expect(modelMediaCapabilities(futureImage, zh)).toEqual(['支持最多 6 张参考图', '最高 4K']);
  });

  it('derives verified video capabilities including legacy cached first-frame metadata, native audio, duration and resolution', () => {
    const video: DirectoryModel = {
      id: 'account:future-video-v3',
      provider: 'account',
      modelId: 'future-video-v3',
      label: 'future-video-v3',
      kind: 'video',
      mode: 'text-to-video',
      enabled: true,
      source: 'live',
      // Legacy cached models may omit maxInputImages while preserving nativeOptions.max_input_images.
      nativeOptions: {
        max_input_images: 1,
        audio: ['with_audio', 'without_audio'],
        durations: [4, 6, 8, 10],
        resolutions: ['480p', '720p', '1080p'],
      },
    };
    expect(modelMediaCapabilities(video, en)).toEqual(['Image to video', 'Native audio', '4–10s', 'Up to 1080p']);
    expect(modelMediaCapabilities(video, zh)).toEqual(['图生视频', '原生音频', '4–10s', '最高 1080p']);
  });

  it('distinguishes speech vs music audio models and includes duration ranges when published', () => {
    const speech: DirectoryModel = {
      id: 'account:byteplus-tts-2',
      provider: 'account',
      modelId: 'byteplus-tts-2',
      label: 'BytePlus Voice',
      kind: 'audio',
      mode: 'text-to-speech',
      enabled: true,
      source: 'builtin',
    };
    const music: DirectoryModel = {
      id: 'account:elevenlabs-music-v2',
      provider: 'account',
      modelId: 'elevenlabs-music-v2',
      label: 'ElevenLabs Music',
      kind: 'audio',
      mode: 'text-to-audio',
      enabled: true,
      source: 'builtin',
    };
    const sfx: DirectoryModel = {
      id: 'fal:fal-ai/elevenlabs/sound-effects/v2',
      provider: 'fal',
      modelId: 'fal-ai/elevenlabs/sound-effects/v2',
      label: 'ElevenLabs Sound Effects v2',
      kind: 'audio',
      mode: 'text-to-audio',
      enabled: true,
      source: 'builtin',
    };
    expect(modelMediaCapabilities(speech, zh)).toEqual(['语音']);
    expect(modelMediaCapabilities(music, zh)).toEqual(['音乐与音效']);
    expect(modelMediaCapabilities(sfx, en)).toEqual(['Music & sound', '0.5–22s']);
  });

  it('gracefully returns empty hints for new models without capability metadata, malformed nativeOptions, or text models', () => {
    const minimalNewImage: DirectoryModel = {
      id: 'account:brand-new-image',
      provider: 'account',
      modelId: 'brand-new-image',
      label: 'brand-new-image',
      kind: 'image',
      enabled: true,
      source: 'live',
      // Stale legacy descriptive fields must never leak into rendered hints.
      capabilities: ['reasoning', 'tools'],
      inputs: ['vision', 'audio'],
      contextWindow: 1_000_000,
    };
    const malformedNative: DirectoryModel = {
      id: 'opendesign:weird-video',
      provider: 'opendesign',
      modelId: 'weird-video',
      label: 'weird-video',
      kind: 'video',
      enabled: true,
      source: 'live',
      nativeOptions: {
        durations: 'unknown',
        resolutions: [null, 123, 'custom'],
        max_input_images: -5,
        audio: null,
      },
    };
    const textModel: DirectoryModel = {
      id: 'account:claude-fable-5',
      provider: 'account',
      modelId: 'claude-fable-5',
      label: 'claude-fable-5',
      kind: 'text',
      enabled: true,
      source: 'live',
      capabilities: ['reasoning', 'tools'],
      contextWindow: 200_000,
    };
    expect(modelMediaCapabilities(minimalNewImage, zh)).toEqual([]);
    expect(modelMediaCapabilities(malformedNative, en)).toEqual([]);
    expect(modelMediaCapabilities(textModel, zh)).toEqual([]);
  });

  it('resolves friendly OpenDesign display labels without overriding explicit custom aliases or unknown models', () => {
    expect(modelDisplayLabel({ id: 'account:doubao-seedance-2-5-260628', provider: 'account', modelId: 'doubao-seedance-2-5-260628', label: 'doubao-seedance-2-5-260628', kind: 'video', enabled: true, source: 'live' })).toBe('Seedance 2.5');
    expect(modelDisplayLabel({ id: 'account:gpt-image-2', provider: 'account', modelId: 'gpt-image-2', label: 'gpt-image-2', kind: 'image', enabled: true, source: 'live' })).toBe('GPT Image 2');
    expect(modelDisplayLabel({ id: 'account:gpt-image-2.6-sunburst', provider: 'account', modelId: 'gpt-image-2.6-sunburst', label: 'gpt-image-2.6-sunburst', kind: 'image', enabled: true, source: 'live' })).toBe('GPT Image 2.6 Sunburst');
    // Explicit user/builtin labels and unknown future models remain untouched.
    expect(modelDisplayLabel({ id: 'opendesign:gpt-image-2.6-sunburst', provider: 'opendesign', modelId: 'gpt-image-2.6-sunburst', label: 'My Poster Model', kind: 'image', enabled: true, source: 'live' })).toBe('My Poster Model');
    expect(modelDisplayLabel({ id: 'account:brand-new-image', provider: 'account', modelId: 'brand-new-image', label: 'brand-new-image', kind: 'image', enabled: true, source: 'live' })).toBe('brand-new-image');
  });

  it('shows inline model IDs only on BYOK/API providers when the ID adds non-redundant endpoint info', () => {
    expect(shouldShowInlineModelId('Seedance 2.5', 'doubao-seedance-2-5-260628', 'account')).toBe(false);
    expect(shouldShowInlineModelId('Codex Image', 'image-generation', 'agent')).toBe(false);
    expect(shouldShowInlineModelId('GPT Image 2.6 Sunburst', 'gpt-image-2.6-sunburst', 'media')).toBe(false);
    expect(shouldShowInlineModelId('FLUX Schnell', 'fal-ai/flux/schnell', 'media')).toBe(true);
    expect(shouldShowInlineModelId('Seedance 2.5', 'doubao-seedance-2-5-260628', 'media')).toBe(true);
    expect(shouldShowInlineModelId('My Poster Model', 'gpt-image-1', 'openai')).toBe(true);
  });
});
