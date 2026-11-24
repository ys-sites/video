// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryAsset } from '../../../shared/asset-library';
import type { GenerationJob, Model } from '../../../shared/gateway';
import { generationOptions } from '../../../shared/generation-options';
import { findMediaStudio } from '../../../shared/studio-catalog';
import { I18nProvider, translate } from '../i18n/I18n';
import { languages } from '../i18n/messages';
import soundStudioUi from '../i18n/sound-studio-ui.json';
import type { AssetDraft } from './AssetComposer';
import type { useAssetBrowser } from './AssetBrowser';
import { studioDestination } from './creativeStudios';
import type { StudioCreation } from './CreativeWorkspace';
import { SoundSceneTabs } from './SoundSceneTabs';
import { SoundStudioWorkspace } from './SoundStudioWorkspace';
import {
  estimateSpeechSeconds,
  hasPromptTag,
  parseVoiceChoice,
  resolveSavedVoiceName,
  togglePromptTag,
} from './soundPresets';
import { resolveVoicePreview } from './voicePreviews';
import { SOUND_TABS, classifyAudioTrackTab, isSfxModel, type SoundTabId } from './soundTabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!('ResizeObserver' in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const assetRequestMock = vi.hoisted(() => vi.fn());
const chromeMocks = vi.hoisted(() => ({
  openModelSettings: vi.fn(),
  openProviderSettings: vi.fn(),
  openAccountSettings: vi.fn(),
  openSubscriptionSettings: vi.fn(),
}));

vi.mock('./assetClient', () => ({
  assetRequest: assetRequestMock,
}));

vi.mock('./WorkspaceFrame', () => ({
  useWorkspaceChrome: () => chromeMocks,
}));

function withOptions(model: Model): Model {
  return { ...model, generationOptions: generationOptions(model) };
}

const accountMusic: Model = withOptions({
  id: 'account:elevenlabs-music-v2',
  provider: 'account',
  modelId: 'elevenlabs-music-v2',
  label: 'ElevenLabs Music',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'live',
});

const sunoMusic: Model = withOptions({
  id: 'atlascloud:suno/chirp-v4',
  provider: 'atlascloud',
  modelId: 'suno/chirp-v4',
  label: 'Suno v4',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'builtin',
});

const falSfx: Model = withOptions({
  id: 'fal:fal-ai/elevenlabs/sound-effects/v2',
  provider: 'fal',
  modelId: 'fal-ai/elevenlabs/sound-effects/v2',
  label: 'ElevenLabs Sound Effects v2',
  modality: 'audio',
  mode: 'text-to-audio',
  source: 'builtin',
});

const elevenSpeech: Model = withOptions({
  id: 'account:elevenlabs-v3',
  provider: 'account',
  modelId: 'elevenlabs-v3',
  label: 'ElevenLabs Voice',
  modality: 'audio',
  mode: 'text-to-speech',
  source: 'live',
});

const kokoroSpeech: Model = withOptions({
  id: 'fal:fal-ai/kokoro/american-english',
  provider: 'fal',
  modelId: 'fal-ai/kokoro/american-english',
  label: 'Kokoro',
  modality: 'audio',
  mode: 'text-to-speech',
  source: 'builtin',
});

function makeAsset(id: string, overrides: Partial<LibraryAsset> = {}, versionOverrides: Partial<LibraryAsset['versions'][number]> = {}): LibraryAsset {
  return {
    id,
    name: `Track ${id}`,
    modality: 'audio',
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    currentVersionId: 'v1',
    versions: [
      {
        id: 'v1',
        createdAt: 1700000000000,
        source: 'generated',
        filename: `${id}.mp3`,
        mimeType: 'audio/mpeg',
        bytes: 124_000,
        sha256: `sha-${id}`,
        duration: 18,
        prompt: 'Soft piano pads for a sunrise launch film',
        model: accountMusic.id,
        parameters: { duration: 30 },
        references: [],
        ...versionOverrides,
      },
    ],
    ...overrides,
  };
}

function makeBrowser(assets: LibraryAsset[]): ReturnType<typeof useAssetBrowser> {
  return {
    kind: 'audio',
    audioKind: 'all',
    setAudioKind: undefined as unknown as ReturnType<typeof useAssetBrowser>['setAudioKind'],
    query: '',
    setQuery: vi.fn(),
    source: 'all',
    setSource: vi.fn(),
    sort: 'newest',
    setSort: vi.fn(),
    data: { key: 'audio|all|all|newest|0', assets, total: assets.length, nextOffset: null },
    stale: false,
    loading: false,
    error: false,
    page: 0,
    setPage: vi.fn(),
    retry: vi.fn(),
  };
}

function makeStudio(
  tabId: SoundTabId,
  modelId: string | null = null,
  availableProviders: string[] = ['account', 'atlascloud', 'fal'],
  models: Model[] = [accountMusic, sunoMusic, falSfx, elevenSpeech, kokoroSpeech],
): StudioCreation {
  const soundStudio = findMediaStudio('sound')!;
  const backingScene = tabId === 'speech' || tabId === 'voice-clone' || tabId === 'voice-changer' || tabId === 'dubbing' ? 'speech' : 'music';
  const destination = studioDestination(soundStudio, backingScene, modelId);
  return {
    destination,
    soundTab: tabId,
    draftKey: `sound/${tabId}`,
    selectSoundTab: vi.fn(),
    catalog: {
      catalog: {
        models,
        status: {
          providers: [
            { id: 'account', label: 'OpenDesign', available: availableProviders.includes('account'), configured: availableProviders.includes('account'), source: 'none', mode: 'account' },
            { id: 'atlascloud', label: 'AtlasCloud', available: availableProviders.includes('atlascloud'), configured: availableProviders.includes('atlascloud'), source: 'none', mode: 'api-key' },
            { id: 'fal', label: 'fal', available: availableProviders.includes('fal'), configured: availableProviders.includes('fal'), source: 'none', mode: 'api-key' },
          ],
          routes: { audio: accountMusic.id },
        },
      },
      failed: false,
      retry: vi.fn(),
    } as StudioCreation['catalog'],
    remember: vi.fn(),
    reuseInScene: vi.fn(),
    chooseModel: vi.fn(),
  };
}

describe('sound domain helpers', () => {
  it('toggles prompt tags idempotently across English and CJK', () => {
    expect(togglePromptTag('', 'soft piano')).toBe('soft piano');
    expect(togglePromptTag('warm intro', 'soft piano')).toBe('warm intro, soft piano');
    expect(hasPromptTag('warm intro, soft piano', 'soft piano')).toBe(true);
    expect(togglePromptTag('warm intro, soft piano', 'soft piano')).toBe('warm intro');
    expect(togglePromptTag('电影感', '轻柔钢琴', true)).toBe('电影感，轻柔钢琴');
    expect(togglePromptTag('电影感，轻柔钢琴', '轻柔钢琴', true)).toBe('电影感');
  });

  it('estimates speaking time for Latin and CJK text while accounting for speed', () => {
    expect(estimateSpeechSeconds('')).toBe(0);
    const normal = estimateSpeechSeconds('Build polished motion graphics quickly with OpenMotion Studio every day.');
    const fast = estimateSpeechSeconds('Build polished motion graphics quickly with OpenMotion Studio every day.', 2);
    expect(normal).toBeGreaterThan(fast);
    expect(estimateSpeechSeconds('欢迎使用开放设计工作室，现在即可快速生成专业旁白配音。')).toBeGreaterThanOrEqual(4);
  });

  it('parses gateway voices and resolves saved voice labels', () => {
    expect(parseVoiceChoice({ value: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel · Female' })).toEqual({
      value: '21m00Tcm4TlvDq8ikWAM',
      name: 'Rachel',
      detail: 'Female',
      initials: 'RA',
    });
    expect(parseVoiceChoice({ value: 'af_heart', label: 'af_heart' })).toEqual({
      value: 'af_heart',
      name: 'Heart',
      detail: 'American · Female',
      initials: 'HE',
    });
    expect(resolveSavedVoiceName('21m00Tcm4TlvDq8ikWAM', elevenSpeech.id, [elevenSpeech])).toBe('Rachel');
    expect(resolveSavedVoiceName(undefined, elevenSpeech.id, [elevenSpeech], true)).toBe('Rachel');
    expect(resolveSavedVoiceName('af_heart', kokoroSpeech.id, [kokoroSpeech])).toBe('Heart');
    expect(resolveSavedVoiceName('custom_voice_99', elevenSpeech.id, [elevenSpeech])).toBe('custom_voice_99');
  });

  it('identifies dedicated SFX models and classifies audio tracks cleanly', () => {
    expect(isSfxModel(falSfx)).toBe(true);
    expect(isSfxModel(accountMusic)).toBe(false);
    expect(isSfxModel(sunoMusic)).toBe(false);
    const catalog = [accountMusic, sunoMusic, falSfx, elevenSpeech, kokoroSpeech];
    expect(classifyAudioTrackTab(accountMusic.id, catalog)).toBe('music');
    expect(classifyAudioTrackTab(falSfx.id, catalog)).toBe('sfx');
    expect(classifyAudioTrackTab(elevenSpeech.id, catalog)).toBe('speech');
    expect(classifyAudioTrackTab(undefined, catalog)).toBe('upload');
  });
});

describe('SoundSceneTabs', () => {
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

  it('renders all 7 peer tabs in one flat row with live and clickable muted Soon states', async () => {
    const onSelectTab = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider>
          <SoundSceneTabs activeTab="music" onSelectTab={onSelectTab} />
        </I18nProvider>,
      );
    });

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button[data-sound-tab]')];
    expect(buttons.map(b => b.dataset.soundTab)).toEqual([
      'music',
      'sfx',
      'speech',
      'voice-clone',
      'voice-changer',
      'dubbing',
      'stems',
    ]);
    expect(buttons.filter(b => b.dataset.status === 'live')).toHaveLength(3);
    expect(buttons.filter(b => b.dataset.status === 'soon')).toHaveLength(4);
    expect(buttons.every(b => !b.disabled)).toBe(true);

    const dubbingBtn = host.querySelector<HTMLButtonElement>('button[data-sound-tab="dubbing"]')!;
    await act(async () => { dubbingBtn.click(); });
    expect(onSelectTab).toHaveBeenCalledWith('dubbing');
  });
});

describe('SoundStudioWorkspace', () => {
  let host: HTMLDivElement;
  let root: Root;
  let playSpy: ReturnType<typeof vi.spyOn>;
  let pauseSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    assetRequestMock.mockReset();
    assetRequestMock.mockResolvedValue({
      job: {
        id: 'job-sound-1',
        state: 'running',
        modality: 'audio',
        prompt: 'Soft piano',
        model: { id: accountMusic.id, provider: 'account', label: 'ElevenLabs Music' },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } satisfies Partial<GenerationJob>,
    });
    playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    });
    pauseSpy = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
      this.dispatchEvent(new Event('pause'));
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function renderSound(
    studio: StudioCreation,
    options: {
      active?: boolean;
      assets?: LibraryAsset[];
      jobs?: GenerationJob[];
      initialPrompt?: string;
      source?: 'all' | 'generated' | 'upload';
      query?: string;
      page?: number;
      onTrashAsset?: (id: string) => Promise<boolean>;
      onCancelJob?: (job: GenerationJob) => void;
      onNotify?: (msg: string) => void;
      onCreated?: (job: GenerationJob) => void;
    } = {},
  ) {
    let currentDraft: AssetDraft = { modality: 'audio', prompt: options.initialPrompt ?? '', references: [] };
    let currentJobs: GenerationJob[] = options.jobs ?? [];
    let currentBrowser = {
      ...makeBrowser(options.assets ?? []),
      ...(options.source !== undefined ? { source: options.source } : {}),
      ...(options.query !== undefined ? { query: options.query } : {}),
      ...(options.page !== undefined ? { page: options.page } : {}),
    };
    const setDraft = vi.fn((update: AssetDraft | ((prev: AssetDraft) => AssetDraft)) => {
      currentDraft = typeof update === 'function' ? update(currentDraft) : update;
      rerender();
    });
    const onTrashAsset = options.onTrashAsset ?? vi.fn(async () => true);
    const onCancelJob = options.onCancelJob ?? vi.fn();
    const onNotify = options.onNotify ?? vi.fn();
    const onCreated = options.onCreated ?? vi.fn();

    const renderTree = (activeFlag = options.active ?? true) => (
      <I18nProvider>
        <SoundStudioWorkspace
          active={activeFlag}
          studio={studio}
          draft={currentDraft}
          setDraft={setDraft}
          browser={currentBrowser}
          jobs={currentJobs}
          uploading={false}
          updatingAssets={new Set()}
          mobileView="create"
          setMobileView={vi.fn()}
          onUploadClick={vi.fn()}
          onDropFiles={vi.fn()}
          onOpenAsset={vi.fn()}
          onTrashAsset={onTrashAsset}
          onCancelJob={onCancelJob}
          onRetrySave={vi.fn(async () => {})}
          onResumeJob={vi.fn(async () => {})}
          onViewJob={vi.fn()}
          onCreated={onCreated}
          onError={vi.fn()}
          onNotify={onNotify}
          onDownload={vi.fn()}
        />
      </I18nProvider>
    );

    const rerender = () => {
      root.render(renderTree());
    };

    await act(async () => {
      root.render(renderTree());
    });

    return {
      getDraft: () => currentDraft,
      browser: currentBrowser,
      onTrashAsset,
      onCancelJob,
      onNotify,
      onCreated,
      updateState: async (next: { assets?: LibraryAsset[]; jobs?: GenerationJob[] }) => {
        if (next.assets !== undefined) {
          currentBrowser = {
            ...currentBrowser,
            data: { key: `audio|all|newest|${currentBrowser.page}`, assets: next.assets, total: next.assets.length, nextOffset: null },
          };
        }
        if (next.jobs !== undefined) currentJobs = next.jobs;
        await act(async () => {
          root.render(renderTree());
        });
      },
      setActive: async (next: boolean) => {
        await act(async () => {
          root.render(renderTree(next));
        });
      },
    };
  }

  it('keeps empty Music state lean with inline sample row, tags, duration presets and zero hero clutter', async () => {
    const studio = makeStudio('music');
    const { getDraft, onCreated } = await renderSound(studio, { assets: [] });

    // No noisy hero wall, no bottom billing/shortcut filler.
    expect(host.querySelector('.om-sound-hero-title')).toBeNull();
    expect(host.textContent).not.toContain('Press Ctrl+Enter');
    expect(host.textContent).not.toContain('Model usage is billed');

    // Core duration controls sit directly inside the left composer before Model picker.
    const thirtySec = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-pill')].find(btn => btn.textContent === '30s')!;
    expect(thirtySec).toBeTruthy();
    await act(async () => { thirtySec.click(); });
    expect(thirtySec.getAttribute('aria-pressed')).toBe('true');

    // Toggle a mood tag into prompt.
    const pianoTag = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-tag')].find(btn => btn.textContent?.includes('Soft piano'))!;
    await act(async () => { pianoTag.click(); });
    expect(getDraft().prompt).toBe('soft piano');

    // Submit with selected duration parameter.
    const submitBtn = host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
    expect(submitBtn.disabled).toBe(false);
    await act(async () => { submitBtn.click(); });

    expect(assetRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      modality: 'audio',
      prompt: 'soft piano',
      model: accountMusic.id,
      parameters: { duration: 30 },
    }));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('routes Sound Effects strictly to SFX models with 2s/5s/10s + Loop and never falls back to music models', async () => {
    // Only OpenDesign + AtlasCloud configured (no fal): must NOT fall back to ElevenLabs Music or Suno v4!
    const unconfiguredSfx = makeStudio('sfx', null, ['account', 'atlascloud']);
    await renderSound(unconfiguredSfx, { assets: [] });

    expect(host.textContent).toContain('fal needs setup before generating.');
    expect(host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.disabled).toBe(true);
    // SFX duration pills are visible & explorable even before configuring fal.
    const pills = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-pill')].map(b => b.textContent);
    expect(pills).toEqual(['Auto', '2s', '5s', '10s']);
    expect(host.querySelector('button[role="switch"][aria-label="Seamless loop"]')).not.toBeNull();

    // Now with fal configured: clicking an SFX starter loads cue + duration and submits cleanly.
    const configuredSfx = makeStudio('sfx', null, ['fal']);
    const { getDraft } = await renderSound(configuredSfx, { assets: [] });
    const useBtn = host.querySelector<HTMLButtonElement>('.om-sound-starter-row .om-sound-use-btn')!;
    await act(async () => { useBtn.click(); });
    expect(getDraft().prompt).toContain('Crisp glassy UI confirmation tap');

    const submitBtn = host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
    expect(submitBtn.disabled).toBe(false);
    await act(async () => { submitBtn.click(); });
    expect(assetRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      model: falSfx.id,
      parameters: expect.objectContaining({ duration_seconds: 2 }),
    }));
  });

  it('renders Text to Speech without duplicating voice cards on the right and adjusts duration by speed', async () => {
    const kokoroStudio = makeStudio('speech', kokoroSpeech.id);
    await renderSound(kokoroStudio, {
      assets: [],
      initialPrompt: 'With one workspace, your script, motion design and soundtrack stay in sync from draft to final cut.',
    });

    // Voice cards live solely in the left composer (never duplicated on the right).
    const rightStage = host.querySelector('.om-sound-stage')!;
    expect(rightStage.querySelectorAll('.om-sound-voice-card')).toHaveLength(0);
    expect(host.querySelectorAll('.om-sound-composer .om-sound-voice-card').length).toBeGreaterThanOrEqual(4);

    const estimateBefore = host.querySelector('.om-sound-estimate')!.textContent!;
    const speed12 = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-pill')].find(btn => btn.textContent === '1.2x')!;
    await act(async () => { speed12.click(); });
    const estimateAfter = host.querySelector('.om-sound-estimate')!.textContent!;
    expect(Number(estimateAfter.replace(/\D/g, ''))).toBeLessThanOrEqual(Number(estimateBefore.replace(/\D/g, '')));
  });

  it('auditions Kokoro and ElevenLabs voices inline without generated assets or changing selection', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00]), { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob | MediaSource) => `blob:test-${blob instanceof Blob ? blob.type : 'media'}`);
    URL.revokeObjectURL = vi.fn();

    try {
      const byteplusSpeech: Model = withOptions({
        id: 'account:byteplus-tts-2',
        provider: 'account',
        modelId: 'byteplus-tts-2',
        label: 'BytePlus Voice',
        modality: 'audio',
        mode: 'text-to-speech',
        source: 'live',
      });

      // 1. Kokoro voice cards balance female & male featured options without duplicating the model name badge.
      const kokoroStudio = makeStudio('speech', kokoroSpeech.id);
      await renderSound(kokoroStudio, { assets: [] });
      expect(host.querySelector('.om-sound-voice-model-badge')).toBeNull();
      const kokoroTexts = [...host.querySelectorAll('.om-sound-voice-card .om-sound-voice-select')].map(el => el.textContent ?? '');
      expect(kokoroTexts.some(text => text.includes('Female'))).toBe(true);
      expect(kokoroTexts.some(text => text.includes('Male'))).toBe(true);
      const previewAlloy = host.querySelector<HTMLButtonElement>('button[aria-label="Preview Alloy"]');
      expect(previewAlloy).not.toBeNull();
      const heartSelect = host.querySelector<HTMLButtonElement>('.om-sound-voice-card[data-selected="true"] .om-sound-voice-select')!;
      expect(heartSelect.textContent).toContain('Heart');
      await act(async () => { previewAlloy!.click(); });
      expect(host.querySelector('.om-sound-player-dock')).toBeNull();
      const kokoroAudio = host.querySelector<HTMLAudioElement>('.om-sound-voice-audio-host audio');
      expect(kokoroAudio?.getAttribute('src')).toBe('blob:test-audio/mp4');
      expect(host.querySelector('.om-sound-voice-card[data-selected="true"] .om-sound-voice-select')?.textContent).toContain('Heart');

      // 2. ElevenLabs voice cards expose all 6 official previews, cache repeat auditions, and keep the main Player Dock intact.
      const staleBackendEleven: Model = {
        ...elevenSpeech,
        generationOptions: {
          delivery: 'provider',
          fields: elevenSpeech.generationOptions!.fields.map(field => ({
            ...field,
            choices: field.choices?.map(({ value, label }) => ({ value, label })),
          })),
        },
      };
      const existingSpeechAsset = makeAsset('speech-keep-dock', { name: 'Existing VO' }, { model: staleBackendEleven.id, prompt: 'Keep dock open' });
      const elevenStudio = makeStudio('speech', staleBackendEleven.id, ['account'], [staleBackendEleven, byteplusSpeech, kokoroSpeech]);
      await renderSound(elevenStudio, { assets: [existingSpeechAsset] });
      expect(host.querySelector('.om-sound-voice-model-badge')).toBeNull();
      expect(host.querySelectorAll('.om-sound-voice-preview')).toHaveLength(6);
      // Start a library track so bottom Player Dock is visible, then audition a voice -> dock stays open!
      const rowPlay = host.querySelector<HTMLButtonElement>('.om-sound-track-row .om-sound-row-play')!;
      await act(async () => { rowPlay.click(); });
      expect(host.querySelector('.om-sound-player-dock')).not.toBeNull();
      const previewGeorge = host.querySelector<HTMLButtonElement>('button[aria-label="Preview George"]')!;
      await act(async () => { previewGeorge.click(); });
      expect(host.querySelector('.om-sound-player-dock')).not.toBeNull();
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('JBFqnCBsd6RMkjVDRZzb'), expect.anything());
      const georgeCallsBefore = fetchMock.mock.calls.filter(c => String(c[0]).includes('JBFqnCBsd6RMkjVDRZzb')).length;
      const elevenAudio = host.querySelector<HTMLAudioElement>('.om-sound-voice-audio-host audio');
      expect(elevenAudio?.getAttribute('src')).toBe('blob:test-audio/mpeg');
      // Switching to Rachel and back to George reuses the cached Blob URL without re-fetching George.
      const previewRachel = host.querySelector<HTMLButtonElement>('button[aria-label="Preview Rachel"]')!;
      await act(async () => { previewRachel.click(); });
      await act(async () => { previewGeorge.click(); });
      const georgeCallsAfter = fetchMock.mock.calls.filter(c => String(c[0]).includes('JBFqnCBsd6RMkjVDRZzb')).length;
      expect(georgeCallsAfter).toBe(georgeCallsBefore);
      // Selecting another voice never pops a redundant Reset icon in the Voice header.
      const georgeSelect = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-voice-select')].find(b => b.textContent?.includes('George'))!;
      await act(async () => { georgeSelect.click(); });
      expect(host.querySelector('button[aria-label="Reset Speech voice"]')).toBeNull();

      // 3. BytePlus Vivi uses a full-width single-column grid and exposes its bundled audition sample inline.
      expect(resolveVoicePreview(byteplusSpeech, 'zh_female_vv_uranus_bigtts')?.blobSource).toBe(true);
      expect(resolveVoicePreview(byteplusSpeech, 'zh_female_unlisted_voice')).toBeUndefined();
      const byteplusStudio = makeStudio('speech', byteplusSpeech.id, ['account'], [byteplusSpeech]);
      await renderSound(byteplusStudio, { assets: [] });
      expect(host.querySelector('.om-sound-voice-grid')?.getAttribute('data-columns')).toBe('1');
      const previewVivi = host.querySelector<HTMLButtonElement>('button[aria-label="Preview Vivi"]');
      expect(previewVivi).not.toBeNull();
      await act(async () => { previewVivi!.click(); });
      const viviAudio = host.querySelector<HTMLAudioElement>('.om-sound-voice-audio-host audio');
      expect(viviAudio?.getAttribute('src')).toBe('blob:test-audio/mp4');
    } finally {
      fetchMock.mockRestore();
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  it('filters audio tracks by domain, copies asset refs, reuses cross-tab settings, and hides empty starters when populated', async () => {
    const musicAsset = makeAsset('music-1', { name: 'Sunrise Score' }, { model: accountMusic.id, prompt: 'Warm piano sunrise' });
    const sfxAsset = makeAsset('sfx-1', { name: 'UI Click' }, { model: falSfx.id, prompt: 'Crisp glass tap', parameters: { duration_seconds: 2, loop: true } });
    const speechAsset = makeAsset('speech-1', { name: 'Launch VO' }, { model: elevenSpeech.id, prompt: 'Welcome to OpenMotion', parameters: { voice: '21m00Tcm4TlvDq8ikWAM' } });

    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    const studio = makeStudio('music');
    const { onNotify, onTrashAsset, setActive } = await renderSound(studio, {
      assets: [musicAsset, sfxAsset, speechAsset],
    });

    // Populated workspace shows zero starter/inspiration sections and hides noisy V1 on single-version tracks.
    expect(host.querySelector('.om-sound-starters')).toBeNull();
    expect(host.querySelectorAll('.om-sound-track-row')).toHaveLength(3);
    expect(host.textContent).not.toContain('V1');
    // Meaningful acoustic badges appear (Voice name, Loop).
    expect(host.textContent).toContain('Rachel');
    expect(host.textContent).toContain('Loop');

    // Filter to Speech only.
    const speechFilter = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-source-tabs button')].find(b => b.textContent === 'Speech')!;
    await act(async () => { speechFilter.click(); });
    expect(host.querySelectorAll('.om-sound-track-row')).toHaveLength(1);
    expect(host.querySelector('.om-sound-row-title')?.textContent).toBe('Launch VO');

    // Open overflow menu -> Copy pinned asset reference.
    const moreBtn = host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
    await act(async () => { moreBtn.click(); });
    const copyItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.includes('Copy asset reference'))!;
    expect(copyItem).toBeTruthy();
    await act(async () => { copyItem.click(); });
    expect(writeText).toHaveBeenCalledWith('speech-1/v1');
    expect(onNotify).toHaveBeenCalledWith('Asset reference copied');

    // Reuse Speech track while in Music tab -> switches via selectSoundTab with prompt & parameters.
    const reuseBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Recreate"]')!;
    await act(async () => { reuseBtn.click(); });
    expect(studio.selectSoundTab).toHaveBeenCalledWith(
      'speech',
      expect.objectContaining({ prompt: 'Welcome to OpenMotion', model: elevenSpeech.id, parameters: { voice: '21m00Tcm4TlvDq8ikWAM' } }),
      elevenSpeech.id,
    );

    // Play track -> lean player dock opens with playback-only controls + voice/model subtitle,
    // supports click-to-locate, auto-pauses when workspace hides, and closes when track is trashed.
    const playBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Play Launch VO"]')!;
    await act(async () => { playBtn.click(); });
    const dock = host.querySelector('.om-sound-player-dock')!;
    expect(dock).not.toBeNull();
    expect(dock.querySelector('.om-sound-dock-subtitle')?.textContent).toContain('Rachel');
    expect(dock.querySelector('button[aria-label="Copy asset reference"]')).toBeNull();
    expect(dock.querySelector('button[aria-label="Asset details"]')).toBeNull();
    expect(dock.querySelector('button[aria-label="Reuse prompt"]')).toBeNull();
    expect(dock.querySelector('a[aria-label="Download"]')).toBeNull();
    expect(dock.querySelector('button[aria-label$="loop playback"]')).toBeNull();
    expect(dock.querySelector('button[aria-label="Playback speed"]')).not.toBeNull();
    expect(dock.querySelector('button[aria-label="Close player"]')).not.toBeNull();
    expect(playSpy).toHaveBeenCalled();

    // Row duration stays fixed to total duration while playing so the waveform column never shifts.
    expect(host.querySelector('.om-sound-row-duration')?.textContent).toBe('00:18');

    const locateBtn = dock.querySelector<HTMLButtonElement>('button[aria-label="Locate Launch VO"]')!;
    expect(locateBtn).not.toBeNull();
    await act(async () => { locateBtn.click(); });
    expect(host.querySelector('.om-sound-track-row[data-located="true"]')?.textContent).toContain('Launch VO');

    pauseSpy.mockClear();
    await setActive(false);
    expect(pauseSpy).toHaveBeenCalled();
    await setActive(true);

    // Open overflow menu -> Move to trash.
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click(); });
    const trashItem = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(el => el.textContent?.includes('Move to trash'))!;
    expect(trashItem).toBeTruthy();
    await act(async () => { trashItem.click(); });
    expect(onTrashAsset).toHaveBeenCalledWith('speech-1');
    expect(host.querySelector('.om-sound-player-dock')).toBeNull();
  });

  it('promotes speech voice as a chip (even when legacy records omitted default voice) and omits raw byte noise in rows', async () => {
    const generatedSpeech = makeAsset(
      'speech-meta-1',
      { name: 'Today is a good day' },
      {
        source: 'generated',
        model: elevenSpeech.id,
        prompt: 'Today is a good day',
        bytes: 469_811,
        parameters: {},
      },
    );
    const uploadedAudio = makeAsset(
      'upload-meta-1',
      { name: 'soundtrack.m4a' },
      {
        source: 'upload',
        model: undefined,
        prompt: undefined,
        bytes: 469_811,
        parameters: undefined,
      },
    );

    const studio = makeStudio('speech', elevenSpeech.id);
    await renderSound(studio, { assets: [generatedSpeech, uploadedAudio] });

    const rows = [...host.querySelectorAll('.om-sound-track-row')];
    expect(rows).toHaveLength(2);
    const generatedRow = rows[0]!;
    const uploadedRow = rows[1]!;

    expect(generatedRow.querySelector('.om-sound-row-title')?.textContent).toBe('Today is a good day');
    // Voice chip resolves model default voice even for legacy empty-parameter records.
    expect(generatedRow.querySelector('.om-sound-voice-chip')?.textContent).toBe('Rachel');
    expect(generatedRow.querySelector('.om-sound-row-source')?.textContent).toBe('Eleven v3');
    // Raw byte counts belong in details, not cluttered into list rows; day group avoids repeating date.
    const generatedDesc = generatedRow.querySelector('.om-sound-row-desc')?.textContent ?? '';
    const uploadedDesc = uploadedRow.querySelector('.om-sound-row-desc')?.textContent ?? '';
    expect(generatedDesc).not.toContain('KB');
    expect(generatedDesc).not.toContain('Today is a good day');
    expect(generatedDesc).toBe(uploadedDesc);
    // Mixed generated + uploaded tracks expose the Source filter and Upload type option.
    expect(host.querySelector('[aria-label="Source"]')).not.toBeNull();
    expect([...host.querySelectorAll('.om-sound-source-tabs button')].some(b => b.textContent === 'Local upload')).toBe(true);
  });

  it('renders an in-place generating waveform row, morphs seamlessly to the completed track with playhead, and resets incompatible filters', async () => {
    const now = Date.now();
    const runningJob: GenerationJob = {
      id: 'job-speech-live',
      state: 'running',
      modality: 'audio',
      prompt: 'Welcome to OpenMotion Studio.',
      model: { id: elevenSpeech.id, provider: 'account', label: elevenSpeech.label },
      parameters: { voice: '21m00Tcm4TlvDq8ikWAM' },
      createdAt: now,
      updatedAt: now,
    };
    assetRequestMock.mockResolvedValueOnce({ job: runningJob });

    const studio = makeStudio('speech', elevenSpeech.id);
    const { browser, onCancelJob, getDraft, updateState } = await renderSound(studio, {
      assets: [makeAsset('older-1', { name: 'Older score', createdAt: now - 86_400_000, updatedAt: now - 86_400_000 }, { createdAt: now - 86_400_000 })],
      initialPrompt: 'Welcome to OpenMotion Studio.',
      source: 'upload',
      query: 'stale',
      page: 1,
    });

    // Activate incompatible Music filter before submitting Speech.
    const musicFilter = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-source-tabs button')].find(b => b.textContent === 'Music')!;
    await act(async () => { musicFilter.click(); });
    expect(musicFilter.getAttribute('aria-pressed')).toBe('true');

    // Submit Speech generation.
    const submitBtn = host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
    await act(async () => { submitBtn.click(); });

    // Incompatible filters/query/page auto-reset, and prompt stays intact for rapid re-rolls.
    const allFilter = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-source-tabs button')].find(b => b.textContent === 'All')!;
    expect(allFilter.getAttribute('aria-pressed')).toBe('true');
    expect(browser.setSource).toHaveBeenCalledWith('all');
    expect(browser.setQuery).toHaveBeenCalledWith('');
    expect(browser.setPage).toHaveBeenCalledWith(0);
    expect(getDraft().prompt).toBe('Welcome to OpenMotion Studio.');

    // Parent pushes the accepted running job into the unified stream.
    await updateState({ jobs: [runningJob] });
    const genRow = host.querySelector('.om-sound-generating-row')!;
    expect(genRow).not.toBeNull();
    expect(genRow.querySelector('.om-sound-row-spinner')).not.toBeNull();
    expect(genRow.querySelector('.om-sound-wave-generating')).not.toBeNull();
    expect(genRow.textContent).toContain('Rachel');
    expect(genRow.textContent).toContain('Eleven v3');
    expect(host.querySelectorAll('.om-sound-day-group').length).toBeGreaterThanOrEqual(1);

    // Cancel action calls onCancelJob.
    const cancelBtn = [...genRow.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Cancel')!;
    await act(async () => { cancelBtn.click(); });
    expect(onCancelJob).toHaveBeenCalledWith(runningJob);

    // Job finishes before library list refreshes -> row remains in place (no blank gap), Cancel hides.
    const completedJob: GenerationJob = {
      ...runningJob,
      state: 'completed',
      updatedAt: now + 2000,
      libraryAssets: [{ assetId: 'speech-new', versionId: 'v1' }],
    };
    await updateState({ jobs: [completedJob] });
    expect(host.querySelector('.om-sound-generating-row')).not.toBeNull();
    expect([...host.querySelectorAll<HTMLButtonElement>('.om-sound-generating-row button')].some(b => b.textContent === 'Cancel')).toBe(false);

    // Library refreshes with saved track -> generating row disappears cleanly (0 duplicates) and playable row shows New badge.
    const newAsset = makeAsset(
      'speech-new',
      { name: 'Welcome to OpenMotion Studio', createdAt: now + 2000, updatedAt: now + 2000 },
      {
        createdAt: now + 2000,
        model: elevenSpeech.id,
        prompt: 'Welcome to OpenMotion Studio.',
        parameters: { voice: '21m00Tcm4TlvDq8ikWAM' },
      },
    );
    await updateState({ jobs: [completedJob], assets: [newAsset] });
    expect(host.querySelector('.om-sound-generating-row')).toBeNull();
    const rows = host.querySelectorAll('.om-sound-track-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-fresh')).toBe('true');
    expect(rows[0]!.textContent).toContain('New');

    // Playing the track renders the vertical playhead line inside its waveform.
    const playBtn = host.querySelector<HTMLButtonElement>('button[aria-label="Play Welcome to OpenMotion Studio"]')!;
    await act(async () => { playBtn.click(); });
    expect(host.querySelector('.om-sound-waveform-btn[data-active="true"] rect.om-sound-playhead')).not.toBeNull();
  });

  it('transitions failed session jobs inline with guidance, expandable details, Recreate, and Delete while keeping old failed history out of the stream', async () => {
    const now = Date.now();
    const oldFailedJob: GenerationJob = {
      id: 'job-old-failed',
      state: 'failed',
      modality: 'audio',
      prompt: 'Old failed task from yesterday',
      error: 'Old timeout',
      model: { id: accountMusic.id, provider: 'account', label: accountMusic.label },
      createdAt: now - 86_400_000,
      updatedAt: now - 86_400_000,
    };
    const runningJob: GenerationJob = {
      id: 'job-live-fail',
      state: 'running',
      modality: 'audio',
      prompt: 'Dramatic thunder clap in canyon',
      model: { id: falSfx.id, provider: 'fal', label: falSfx.label },
      parameters: { duration_seconds: 5, loop: false },
      createdAt: now,
      updatedAt: now,
    };

    const studio = makeStudio('sfx', falSfx.id);
    const { updateState } = await renderSound(studio, {
      assets: [makeAsset('keep-1')],
      jobs: [oldFailedJob, runningJob],
    });

    // Old historical failure stays out of the live stream; active running job appears in-place.
    expect(host.querySelector('.om-sound-failed-row')).toBeNull();
    expect(host.querySelector('.om-sound-generating-row')).not.toBeNull();

    // Active job fails -> transitions smoothly in-place to compact failed row.
    const failedJob: GenerationJob = {
      ...runningJob,
      state: 'failed',
      error: 'Provider rate limit exceeded',
      updatedAt: now + 3000,
    };
    await updateState({ jobs: [oldFailedJob, failedJob] });

    expect(host.querySelector('.om-sound-generating-row')).toBeNull();
    const failedRow = host.querySelector('.om-sound-failed-row')!;
    expect(failedRow).not.toBeNull();
    expect(failedRow.querySelector('.om-sound-failed-pill')?.textContent).toContain('Failed');
    expect(failedRow.textContent).toContain('Try again, or adjust your prompt and settings.');
    expect(failedRow.textContent).toContain('Dramatic thunder clap in canyon');

    // Expand error details on demand.
    expect(failedRow.querySelector('.om-sound-failed-detail')).toBeNull();
    const infoBtn = failedRow.querySelector<HTMLButtonElement>('button[aria-label="Failure details"]')!;
    await act(async () => { infoBtn.click(); });
    expect(failedRow.querySelector('.om-sound-failed-detail')?.textContent).toContain('Provider rate limit exceeded');

    // Recreate reloads the failed prompt & model/params into the composer.
    const recreateBtn = failedRow.querySelector<HTMLButtonElement>('button[aria-label="Recreate"]')!;
    await act(async () => { recreateBtn.click(); });
    expect(studio.chooseModel).toHaveBeenCalledWith(falSfx.id);

    // Delete dismisses the failed row cleanly from the stream.
    const deleteBtn = [...failedRow.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Delete'))!;
    await act(async () => { deleteBtn.click(); });
    expect(host.querySelector('.om-sound-failed-row')).toBeNull();
  });

  it('renders focused Input -> Output capability schematic on Soon tabs and pivots cleanly to active tabs', async () => {
    const soonTabs = SOUND_TABS.filter(tab => tab.status === 'soon');
    expect(soonTabs.map(t => t.id)).toEqual(['voice-clone', 'voice-changer', 'dubbing', 'stems']);

    for (const tab of soonTabs) {
      const studio = makeStudio(tab.id);
      await renderSound(studio, { assets: [makeAsset('a1')] });

      // No dead/disabled left composer form.
      expect(host.querySelector('.om-sound-composer')).toBeNull();
      // 3-node visual pipeline rendered cleanly.
      expect(host.querySelectorAll('.om-sound-pipeline-node')).toHaveLength(3);
      expect(host.querySelector('.om-sound-soon-title')?.textContent).toBe(tab.label);
      expect(host.querySelector<HTMLAnchorElement>('.om-sound-soon-footer .om-coming-soon-actions a')?.href).toBe('https://github.com/nexu-io/openmotion');

      // Clicking pivot CTA routes to nearest live tab.
      const pivotBtn = host.querySelector<HTMLButtonElement>('.om-sound-soon-footer button')!;
      await act(async () => { pivotBtn.click(); });
      expect(studio.selectSoundTab).toHaveBeenCalledWith(tab.pivotTab);
    }
  });

  it('hides redundant Advanced JSON panels for built-in audio models and keeps Custom voice ID inline inside the Voice card', async () => {
    // 1. Built-in Music, SFX, and Speech models (including OpenDesign Cloud music) render zero Advanced/JSON sections.
    const cloudMusic: Model = withOptions({
      id: 'opendesign:elevenlabs-music-v2',
      provider: 'opendesign',
      modelId: 'elevenlabs-music-v2',
      label: 'ElevenLabs Music',
      modality: 'audio',
      mode: 'text-to-audio',
      source: 'builtin',
    });
    for (const [tab, modelId, extraModels] of [
      ['music', accountMusic.id, undefined],
      ['music', cloudMusic.id, [cloudMusic]],
      ['music', sunoMusic.id, undefined],
      ['sfx', falSfx.id, undefined],
      ['speech', kokoroSpeech.id, undefined],
      ['speech', elevenSpeech.id, undefined],
    ] as const) {
      const studio = makeStudio(tab, modelId, ['account', 'opendesign', 'atlascloud', 'fal'], extraModels ? [...extraModels] : undefined);
      await renderSound(studio, { assets: [] });
      expect(host.querySelector('.om-sound-advanced'), `${tab}:${modelId}`).toBeNull();
      expect(host.querySelector('textarea[aria-label="Model parameters"]'), `${tab}:${modelId}`).toBeNull();
    }

    // 2. OpenDesign Speech exposes Custom voice ID inline inside the Voice section (collapsed until expanded).
    const elevenStudio = makeStudio('speech', elevenSpeech.id);
    await renderSound(elevenStudio, { assets: [], initialPrompt: 'Custom voice check.' });
    expect(host.querySelector('input[aria-label="Custom voice ID"]')).toBeNull();
    const toggleCustom = host.querySelector<HTMLButtonElement>('.om-sound-custom-voice-toggle')!;
    expect(toggleCustom).not.toBeNull();
    await act(async () => { toggleCustom.click(); });

    const customInput = host.querySelector<HTMLInputElement>('input[aria-label="Custom voice ID"]')!;
    expect(customInput).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(customInput, 'custom_speaker_42');
      customInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('Custom voice');

    const submitBtn = host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!;
    await act(async () => { submitBtn.click(); });
    expect(assetRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      model: elevenSpeech.id,
      parameters: expect.objectContaining({ voice: 'custom_speaker_42' }),
    }));

    // Selecting a preset voice card collapses the custom voice box cleanly.
    const rachelCard = host.querySelector<HTMLButtonElement>('.om-sound-voice-select')!;
    await act(async () => { rachelCard.click(); });
    expect(host.querySelector('input[aria-label="Custom voice ID"]')).toBeNull();

    // 3. Unknown third-party BYOK model without structured fields retains the raw JSON fallback,
    // and editing or clearing raw JSON never leaves sticky values behind.
    const customByokSpeech: Model = {
      id: 'fal:custom/tts-v1',
      provider: 'fal',
      modelId: 'custom/tts-v1',
      label: 'Custom TTS',
      modality: 'audio',
      mode: 'text-to-speech',
      source: 'manual',
    };
    const byokStudio = makeStudio('speech', customByokSpeech.id, ['fal'], [customByokSpeech]);
    await renderSound(byokStudio, { assets: [], initialPrompt: 'Raw JSON test.' });
    expect(host.querySelector('.om-sound-advanced')).not.toBeNull();
    const jsonBox = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Model parameters"]')!;
    expect(jsonBox).not.toBeNull();

    const setTextarea = async (value: string) => {
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(jsonBox, value);
        jsonBox.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };

    await setTextarea('{"speed": 1.2}');
    await setTextarea('{"speed": 1.5}');
    assetRequestMock.mockClear();
    await act(async () => { host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click(); });
    expect(assetRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      model: customByokSpeech.id,
      parameters: { speed: 1.5 },
    }));

    await setTextarea('{}');
    assetRequestMock.mockClear();
    await act(async () => { host.querySelector<HTMLButtonElement>('.om-creation-submit-button')!.click(); });
    expect(assetRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'generate',
      model: customByokSpeech.id,
      parameters: {},
    }));
  });

  it('keeps Sound Studio translations complete across all supported locales without invalid terminology', () => {
    const baseKeys = Object.keys(soundStudioUi['zh-CN']).sort();
    for (const { locale } of languages) {
      if (locale === 'en') continue;
      const entries = soundStudioUi[locale as keyof typeof soundStudioUi];
      expect(Object.keys(entries).sort(), locale).toEqual(baseKeys);
      for (const [source, value] of Object.entries(entries)) {
        const samples = typeof value === 'string' ? [value] : Object.values(value);
        const expectedPlaceholders = [...source.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
        for (const text of samples) {
          expect(text.trim(), `${locale}: ${source}`).not.toBe('');
          const actualPlaceholders = [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
          expect(actualPlaceholders, `${locale}: ${source}`).toEqual(expectedPlaceholders);
          if (locale === 'zh-CN') expect(text, source).not.toContain('工程');
        }
      }
    }
    expect(translate('en', '{count} tracks', { count: 1 })).toBe('1 track');
    expect(translate('en', '{count} tracks', { count: 3 })).toBe('3 tracks');
    expect(translate('zh-CN', 'Sound effects')).toBe('音效与拟音');
    expect(translate('zh-CN', 'Voice cloning')).toBe('声音克隆');
    expect(translate('zh-CN', 'Voice changer')).toBe('变声');
    expect(translate('zh-CN', 'Dubbing')).toBe('翻译配音');
    expect(translate('zh-CN', 'Isolate & stems')).toBe('分离与降噪');
    expect(translate('zh-CN', 'New')).toBe('新');
    expect(translate('zh-CN', 'More actions')).toBe('更多操作');
  });

  it('hides redundant Source filter when only AI tracks exist, opens details from row info, and shows per-type starters on empty category tabs', async () => {
    const speechAsset = makeAsset('speech-only-1', { name: 'Launch VO' }, { model: elevenSpeech.id, prompt: 'Welcome to OpenMotion', parameters: {} });
    const studio = makeStudio('speech', elevenSpeech.id);
    const onOpenAsset = vi.fn();

    // Render directly with onOpenAsset spy to verify row-info click opens details cleanly.
    const browser = makeBrowser([speechAsset]);
    await act(async () => {
      root.render(
        <I18nProvider>
          <SoundStudioWorkspace
            active
            studio={studio}
            draft={{ modality: 'audio', prompt: '', references: [] }}
            setDraft={vi.fn()}
            browser={browser}
            jobs={[]}
            uploading={false}
            updatingAssets={new Set()}
            mobileView="library"
            setMobileView={vi.fn()}
            onUploadClick={vi.fn()}
            onDropFiles={vi.fn()}
            onOpenAsset={onOpenAsset}
            onTrashAsset={vi.fn(async () => true)}
            onCancelJob={vi.fn()}
            onRetrySave={vi.fn(async () => {})}
            onResumeJob={vi.fn(async () => {})}
            onViewJob={vi.fn()}
            onCreated={vi.fn()}
            onError={vi.fn()}
            onNotify={vi.fn()}
            onDownload={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    // Zero uploaded tracks -> hide redundant Source filter dropdown.
    expect(host.querySelector('[aria-label="Source"]')).toBeNull();

    // Clicking the track info block opens asset details directly.
    const infoBtn = host.querySelector<HTMLButtonElement>('.om-sound-row-info-btn')!;
    expect(infoBtn).not.toBeNull();
    await act(async () => { infoBtn.click(); });
    expect(onOpenAsset).toHaveBeenCalledWith(speechAsset);

    // Switching to an empty Music filter surfaces Music starters rather than a dead empty state,
    // and clicking Use forwards the prompt through selectSoundTab so draftKey switches preserve it.
    const musicFilter = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-source-tabs button')].find(b => b.textContent === 'Music')!;
    await act(async () => { musicFilter.click(); });
    expect(host.querySelector('.om-sound-starters')).not.toBeNull();
    expect(host.querySelector('.om-sound-sample-row')).not.toBeNull();
    const musicUseBtn = host.querySelector<HTMLButtonElement>('.om-sound-sample-row .om-sound-use-btn')!;
    await act(async () => { musicUseBtn.click(); });
    expect(studio.selectSoundTab).toHaveBeenCalledWith(
      'music',
      expect.objectContaining({ modality: 'audio', prompt: expect.stringContaining('soft piano') }),
    );

    // Switching to an empty SFX filter from the Speech tab forwards both cue and SFX parameters to the SFX model.
    const sfxFilter = [...host.querySelectorAll<HTMLButtonElement>('.om-sound-source-tabs button')].find(b => b.textContent === 'Sound effects')!;
    await act(async () => { sfxFilter.click(); });
    const sfxUseBtn = host.querySelector<HTMLButtonElement>('.om-sound-starter-row .om-sound-use-btn')!;
    await act(async () => { sfxUseBtn.click(); });
    expect(studio.selectSoundTab).toHaveBeenCalledWith(
      'sfx',
      expect.objectContaining({
        modality: 'audio',
        prompt: expect.stringContaining('Crisp glassy UI confirmation tap'),
        model: falSfx.id,
        parameters: expect.objectContaining({ duration_seconds: 2 }),
      }),
      falSfx.id,
    );

    // Persisted audioKind overrides ID-only fallback even for opaque model IDs without catalog entries.
    expect(classifyAudioTrackTab('opendesign:acme/narrator-v2', undefined, 'generated', 'speech')).toBe('speech');
    expect(classifyAudioTrackTab('opendesign:acme/impact-v1', undefined, 'generated', 'sfx')).toBe('sfx');
  });
});
