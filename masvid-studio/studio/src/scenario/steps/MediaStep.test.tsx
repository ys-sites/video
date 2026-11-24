// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model } from '../../../../shared/gateway';
import type { PoolItem, StepIteration } from '../../../../shared/scenario-runs';
import { I18nProvider } from '../../i18n/I18n';
import { MediaStep } from './MediaStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

vi.mock('../../motion/ExploreTemplates', () => ({
  useExploreTemplates: () => ({ pages: [], loading: false, error: false, hasMore: false, retry: vi.fn(), loadMore: vi.fn() }),
}));

const mockUseMediaCatalog = vi.fn();
vi.mock('../../motion/useMediaCatalog', () => ({
  useMediaCatalog: (...args: unknown[]) => mockUseMediaCatalog(...args),
}));

const mockUploadLibraryAsset = vi.fn();
vi.mock('../../motion/assetClient', () => ({
  uploadLibraryAsset: (...args: unknown[]) => mockUploadLibraryAsset(...args),
  assetRequest: vi.fn(),
}));

const imagePoolItem: PoolItem = {
  id: '33333333-3333-4333-8333-333333333331',
  kind: 'image',
  ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444441', versionId: '55555555-5555-4555-8555-555555555551' },
  label: 'Tote Hero',
  source: 'generated',
  stepId: 'product-images',
  tags: [],
  pinned: false,
  addedAt: 1700000000000,
};

const imageModel: Model = {
  id: 'fal:flux',
  provider: 'fal',
  modelId: 'fal-ai/flux/schnell',
  label: 'Flux Schnell',
  modality: 'image',
  source: 'builtin',
  mode: 'text-to-image',
  supportsImageReference: true,
  maxInputImages: 4,
};

const codexImageModel: Model = {
  id: 'codex:image-generation',
  provider: 'codex',
  modelId: 'image-generation',
  label: 'Codex Image',
  modality: 'image',
  source: 'builtin',
  mode: 'text-to-image',
};

const videoModel: Model = {
  id: 'fal:wan',
  provider: 'fal',
  modelId: 'fal-ai/wan/v2.2-a14b/text-to-video',
  label: 'Wan Video',
  modality: 'video',
  source: 'builtin',
  mode: 'text-to-video',
  maxInputImages: 1,
};

const speechModel: Model = {
  id: 'fal:kokoro',
  provider: 'fal',
  modelId: 'fal-ai/kokoro/american-english',
  label: 'Kokoro TTS',
  modality: 'audio',
  source: 'builtin',
  mode: 'text-to-speech',
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('MediaStep', () => {
  it('uses the localized legacy draft in generation without treating a plain blur as an edit', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { image: imageModel.id },
          capabilities: [],
        },
        models: [imageModel],
      },
      failed: false,
      retry: vi.fn(),
    });
    const run = makeBaseRun('motion-full-chain', {
      brief: { concept: '秋季上新', visualStyle: '极简', aspect: '9:16' },
      steps: { storyboard: { draft: { prompt: 'Storyboard frame for 秋季上新: 极简, 9:16 composition' } } },
    });
    const { props, mocks } = createStepProps('motion-full-chain', 'storyboard', { run });
    const mounted = await mountStep(<I18nProvider initialLocale="zh-CN"><MediaStep {...props} /></I18nProvider>);

    try {
      const field = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-storyboard')!;
      expect(field.value).toContain('生成一张分镜画面。\n影片概念：秋季上新\n风格描述：极简');
      await act(async () => { field.focus(); field.blur(); });
      expect(mocks.mutate).not.toHaveBeenCalled();
      const generate = Array.from(mounted.container.querySelectorAll('button')).find(button => button.textContent?.trim() === '生成')!;
      await act(async () => { generate.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith('generate:storyboard', 'generate', expect.objectContaining({
        prompt: field.value,
        parameters: { image_size: 'portrait_16_9', num_images: 1 },
      }));
    } finally {
      await mounted.unmount();
    }
  });

  it('uses the brief aspect for Codex Image and allows an explicit storyboard choice', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'codex', label: 'Codex', available: true, enabled: true, configured: true, credentialSource: 'local-agent', verification: 'unverified', reason: 'ready' }],
          agents: [],
          routes: { image: codexImageModel.id },
          capabilities: [],
        },
        models: [codexImageModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const run = makeBaseRun('motion-full-chain', { brief: { concept: 'New season', aspect: '9:16' } });
    const { props, mocks } = createStepProps('motion-full-chain', 'storyboard', { run });
    const mounted = await mountStep(<MediaStep {...props} />);
    try {
      const aspect = mounted.container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Aspect ratio"]')!;
      const generate = [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Generate')!;
      expect(aspect.textContent).toBe('9:16');
      await act(async () => { generate.click(); });
      expect(mocks.mutate).toHaveBeenLastCalledWith('generate:storyboard', 'generate', expect.objectContaining({
        parameters: { aspect_ratio: '9:16' },
      }));

      const updatedRun = { ...run, brief: { ...run.brief, aspect: '16:9' } };
      await mounted.rerender(<MediaStep {...props} run={updatedRun} />);
      expect(aspect.textContent).toBe('16:9');

      await act(async () => { aspect.click(); });
      const square = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(option => option.textContent === '1:1')!;
      await act(async () => { square.click(); });
      expect(aspect.textContent).toBe('1:1');
      await act(async () => { generate.click(); });
      expect(mocks.mutate).toHaveBeenLastCalledWith('generate:storyboard', 'generate', expect.objectContaining({
        parameters: { aspect_ratio: '1:1' },
      }));
    } finally {
      await mounted.unmount();
    }
  });

  it.each(['account', 'opendesign'] as const)('uses the brief for the %s soundtrack default and submits manual overrides with the current prompt', async provider => {
    const musicModel: Model = {
      id: `${provider}:elevenlabs-music-v2`,
      provider,
      modelId: 'elevenlabs-music-v2',
      label: 'ElevenLabs Music',
      modality: 'audio',
      source: 'builtin',
      mode: 'text-to-audio',
    };
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: provider, label: 'OpenDesign', available: true, enabled: true, configured: true, credentialSource: 'account', verification: 'verified', reason: 'ok', mediaEntitlement: 'included' }],
          agents: [],
          routes: { audio: musicModel.id },
          capabilities: [],
        },
        models: [musicModel],
      },
      failed: false,
      retry: vi.fn(),
    });
    const run = makeBaseRun('motion-full-chain');
    const { props, mocks } = createStepProps('motion-full-chain', 'soundtrack', { run });
    const render = (durationSeconds?: string) => (
      <I18nProvider initialLocale="zh-CN">
        <MediaStep {...props} run={{ ...run, brief: durationSeconds ? { durationSeconds } : {} }} />
      </I18nProvider>
    );
    const mounted = await mountStep(render());

    try {
      const duration = mounted.container.querySelector<HTMLInputElement>('.om-duration-track input[type="range"]')!;
      const readout = mounted.container.querySelector('.om-duration-readout')!;
      const prompt = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-soundtrack')!;
      const generate = [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.trim() === '生成')!;
      const expectSubmission = (seconds: number, text: string) => {
        expect(mocks.mutate).toHaveBeenLastCalledWith('generate:soundtrack', 'generate', expect.objectContaining({
          model: musicModel.id,
          mode: 'text-to-audio',
          locale: 'zh-CN',
          parameters: provider === 'account' ? { duration: seconds } : { music_length_ms: seconds * 1000 },
          prompt: text,
        }));
      };
      expect(duration.getAttribute('aria-label')).toBe('时长（秒）');
      expect(duration.min).toBe('3');
      expect(duration.max).toBe('60');
      await act(async () => { generate.click(); });
      expectSubmission(3, '创作一段配乐。');

      for (const seconds of [15, 30, 60]) {
        await mounted.rerender(render(String(seconds)));
        expect(readout.textContent).toBe(`${seconds}秒`);
        await act(async () => { generate.click(); });
        expectSubmission(seconds, `创作一段配乐。\n时长：${seconds} 秒`);
      }
      await mounted.rerender(render('180'));
      expect(readout.textContent).toBe('60秒');
      await mounted.rerender(render('1'));
      expect(readout.textContent).toBe('3秒');

      const customPrompt = '轻快的钢琴配乐';
      await act(async () => { setFieldValue(prompt, customPrompt); });
      for (const seconds of [4, 5, 6, 7]) {
        await act(async () => { duration.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
        expect(readout.textContent).toBe(`${seconds}秒`);
        await act(async () => { generate.click(); });
        expectSubmission(seconds, customPrompt);
      }
      const tenSeconds = [...mounted.container.querySelectorAll<HTMLButtonElement>('.om-duration-tick')].find(button => button.textContent === '10')!;
      await act(async () => { tenSeconds.click(); });
      await mounted.rerender(render('30'));
      expect(readout.textContent).toBe('10秒');
      await act(async () => { generate.click(); });
      expectSubmission(10, customPrompt);
    } finally {
      await mounted.unmount();
    }
  });

  it('uses the video model range on the slider and keeps fixed-duration model choices', async () => {
    const continuous: Model = {
      ...videoModel, id: 'account:seedance', provider: 'account', modelId: 'seedance', label: 'Continuous Video',
      supportsImageReference: true, nativeOptions: { durations: { values: [4, 5, 6, 7, 8, 9], default: 5 } },
    };
    const discrete: Model = {
      ...continuous, id: 'account:fixed', modelId: 'fixed', label: 'Fixed-duration Video',
      nativeOptions: { durations: { values: [5, 10], default: 5 } },
    };
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'account', label: 'OpenDesign', available: true, mediaEntitlement: 'included' }],
          agents: [],
          routes: { video: continuous.id },
          capabilities: [],
        },
        models: [continuous, discrete],
      },
      failed: false,
      retry: vi.fn(),
    });
    const run = makeBaseRun('motion-full-chain', {
      pool: [imagePoolItem],
      steps: { 'motion-film': { bindings: { firstFrame: [imagePoolItem.id] }, draft: { prompt: 'A moving title' } } },
    });
    const { props, mocks } = createStepProps('motion-full-chain', 'motion-film', { run });
    const mounted = await mountStep(<MediaStep {...props} />);
    try {
      const slider = mounted.container.querySelector<HTMLInputElement>('.om-duration-track input[type="range"]')!;
      expect(slider.getAttribute('aria-label')).toBe('Duration (seconds)');
      expect(slider.min).toBe('4');
      expect(slider.max).toBe('9');
      expect(slider.value).toBe('5');
      await act(async () => { slider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
      const generate = [...mounted.container.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Generate')!;
      await act(async () => { generate.click(); });
      expect(mocks.mutate).toHaveBeenLastCalledWith('generate:motion-film', 'generate', expect.objectContaining({
        model: continuous.id, parameters: { duration: 6 }, prompt: 'A moving title', referencePoolItemIds: [imagePoolItem.id],
      }));

      const modelPicker = mounted.container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Model"]')!;
      await act(async () => { modelPicker.click(); });
      const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(item => item.textContent?.includes(discrete.label))!;
      await act(async () => { option.click(); });
      expect(mounted.container.querySelector('.om-duration-track input[type="range"]')).toBeNull();
      const fixedChoices = [...mounted.container.querySelectorAll<HTMLButtonElement>('.om-option-pill')];
      expect(fixedChoices.map(item => item.textContent)).toEqual(['5s', '10s']);
      await act(async () => { fixedChoices[1].click(); });
      await act(async () => { generate.click(); });
      expect(mocks.mutate).toHaveBeenLastCalledWith('generate:motion-film', 'generate', expect.objectContaining({
        model: discrete.id, parameters: { duration: 10 },
      }));
    } finally {
      await mounted.unmount();
    }
  });

  it('shows provider-setup panel and hides Generate button when no compatible models are available', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: { status: { providers: [], agents: [], routes: {}, capabilities: [] }, models: [] },
      failed: false,
      retry: vi.fn(),
    });

    const { props, mocks } = createStepProps('black-friday', 'product-images');
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      expect(mounted.container.querySelector('[data-provider-setup="true"]')).toBeTruthy();
      expect(mounted.container.textContent).toContain('No image model is configured.');
      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate');
      expect(generateBtn).toBeUndefined();

      const setupBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Set up a provider'))!;
      await act(async () => { setupBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });

  it('generates video with firstFrame referencePoolItemIds and switches to Motion project panel', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { video: videoModel.id },
          capabilities: [{ modality: 'video', available: true, modelIds: [videoModel.id], selectedModelId: videoModel.id }],
        },
        models: [videoModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const run = makeBaseRun('black-friday', {
      pool: [imagePoolItem],
      steps: {
        'sales-film': {
          bindings: { firstFrame: [imagePoolItem.id] },
          draft: { prompt: '30s Black Friday tote showcase' },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'sales-film', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      expect(generateBtn.disabled).toBe(false);
      await act(async () => { generateBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:sales-film',
        'generate',
        expect.objectContaining({
          stepId: 'sales-film',
          modality: 'video',
          model: videoModel.id,
          prompt: '30s Black Friday tote showcase',
          referencePoolItemIds: [imagePoolItem.id],
        }),
      );
      expect(mocks.showToast).toHaveBeenCalledWith('Generation started', 'info', 'feedback');

      // Switch to Motion project tab
      const motionTab = Array.from(mounted.container.querySelectorAll('[role="tab"]')).find(t => t.textContent?.includes('Motion project')) as HTMLElement;
      expect(motionTab).toBeTruthy();
      await act(async () => { motionTab.click(); });

      const createMotionBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Create Motion project'))!;
      await act(async () => { createMotionBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'create-motion:sales-film',
        'create_motion',
        expect.objectContaining({
          stepId: 'sales-film',
          projectType: 'natural_language',
          poolItemIds: [imagePoolItem.id],
        }),
      );

      // Browse full collection calls nav.openBlackFriday
      const browseBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Browse full collection'))!;
      await act(async () => { browseBtn.click(); });
      expect(mocks.nav.openBlackFriday).toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
  });

  it('uploads offline files via uploadLibraryAsset -> add_pool -> add_iteration', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: { status: { providers: [], agents: [], routes: {}, capabilities: [] }, models: [] },
      failed: false,
      retry: vi.fn(),
    });
    mockUploadLibraryAsset.mockResolvedValue({
      id: '44444444-4444-4444-8444-444444444449',
      name: 'product.png',
      modality: 'image',
      currentVersionId: '55555555-5555-4555-8555-555555555559',
      versions: [{ id: '55555555-5555-4555-8555-555555555559' }],
    });

    const run = makeBaseRun('black-friday');
    const { props, mocks } = createStepProps('black-friday', 'product-images', {
      run,
      mutateImpl: (async (_intent, command) => {
        if (command === 'add_pool') return { run, poolItemIds: ['33333333-3333-4333-8333-333333333339'] };
        return { run };
      }) as never,
    });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const fileInput = mounted.container.querySelector<HTMLInputElement>('input[type="file"]')!;
      expect(fileInput.accept).toBe('.png,.jpg,.jpeg,.webp,.gif,.avif');
      expect(mounted.container.textContent).toContain('Supported formats · PNG, JPG, JPEG, WebP, GIF, AVIF');
      const file = new File(['png-bytes'], 'product.png', { type: 'image/png' });
      Object.defineProperty(fileInput, 'files', { configurable: true, value: [file] });
      await act(async () => {
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      });

      expect(mockUploadLibraryAsset).toHaveBeenCalledWith(file, {});
      expect(mocks.mutate).toHaveBeenCalledWith(
        'upload-pool:product-images',
        'add_pool',
        expect.objectContaining({
          items: [expect.objectContaining({ stepId: 'product-images', source: 'upload', label: 'product.png' })],
        }),
      );
      expect(mocks.mutate).toHaveBeenCalledWith(
        'upload-iter:product-images',
        'add_iteration',
        expect.objectContaining({
          stepId: 'product-images',
          iteration: expect.objectContaining({
            source: 'upload',
            outputs: [{ type: 'pool', poolItemId: '33333333-3333-4333-8333-333333333339' }],
          }),
        }),
      );
      expect(mocks.highlight).toHaveBeenCalledWith(['33333333-3333-4333-8333-333333333339']);
    } finally {
      await mounted.unmount();
    }
  });

  it('seeds speech audio prompt from active script iteration and submits text-to-speech mode', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { audio: speechModel.id },
          capabilities: [{ modality: 'audio', available: true, modelIds: [speechModel.id], selectedModelId: speechModel.id }],
        },
        models: [speechModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const scriptIter: StepIteration = {
      id: '66666666-6666-4666-8666-666666666666',
      number: 1,
      createdAt: 1700000000000,
      source: 'local',
      inputs: [],
      outputs: [{ type: 'script', text: 'Hey everyone, here are 3 workflow tips.' }],
    };
    const run = makeBaseRun('ai-influencer', {
      steps: {
        brief: { iterations: [scriptIter], activeIterationId: scriptIter.id },
      },
    });

    const { props, mocks } = createStepProps('ai-influencer', 'voice', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-voice')!;
      expect(textarea.value).toBe('Hey everyone, here are 3 workflow tips.');

      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => { generateBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:voice',
        'generate',
        expect.objectContaining({
          stepId: 'voice',
          modality: 'audio',
          mode: 'text-to-speech',
          model: speechModel.id,
          prompt: 'Hey everyone, here are 3 workflow tips.',
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('renders completed image outputs and allows cancelling a pending job', async () => {
    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { image: imageModel.id },
          capabilities: [{ modality: 'image', available: true, modelIds: [imageModel.id], selectedModelId: imageModel.id }],
        },
        models: [imageModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const completedIter: StepIteration = {
      id: '77777777-7777-4777-8777-777777777771',
      number: 1,
      createdAt: 1700000000000,
      source: 'generated',
      inputs: [],
      outputs: [{ type: 'pool', poolItemId: imagePoolItem.id }],
      job: { jobId: 'job-1', state: 'completed', modality: 'image', model: imageModel.id },
    };
    const runCompleted = makeBaseRun('black-friday', {
      pool: [imagePoolItem],
      steps: {
        'product-images': {
          iterations: [completedIter],
          activeIterationId: completedIter.id,
          draft: { prompt: 'Studio tote photo' },
        },
      },
    });
    const completed = createStepProps('black-friday', 'product-images', { run: runCompleted });
    const mounted = await mountStep(<MediaStep {...completed.props} />);

    try {
      const img = mounted.container.querySelector<HTMLImageElement>('.om-step-media-grid img');
      expect(img?.getAttribute('alt')).toBe('Tote Hero');

      // Re-render with a running job to verify cancel button
      const runningIter: StepIteration = {
        id: '77777777-7777-4777-8777-777777777772',
        number: 2,
        createdAt: 1700000001000,
        source: 'generated',
        inputs: [],
        outputs: [],
        job: { jobId: 'job-2', state: 'running', modality: 'image', model: imageModel.id },
      };
      const runPending = makeBaseRun('black-friday', {
        pool: [imagePoolItem],
        steps: {
          'product-images': {
            iterations: [completedIter, runningIter],
            activeIterationId: runningIter.id,
          },
        },
      });
      const pending = createStepProps('black-friday', 'product-images', { run: runPending });
      await mounted.rerender(<MediaStep {...pending.props} />);

      const cancelBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Cancel'))!;
      await act(async () => { cancelBtn.click(); });
      expect(pending.mocks.mutate).toHaveBeenCalledWith(
        `cancel:product-images:${runningIter.id}`,
        'cancel',
        { stepId: 'product-images', iterationId: runningIter.id },
      );

      // Verify prompt edit updates cleanly
      const promptEl = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-product-images')!;
      await act(async () => { setFieldValue(promptEl, 'New prompt text'); });
      expect(promptEl.value).toBe('New prompt text');
    } finally {
      await mounted.unmount();
    }
  });

  it('prefers configured cloud/API providers over codex, excludes unentitled account models, and exposes Model providers', async () => {
    const codexModel: Model = {
      id: 'codex:image-generation',
      provider: 'codex',
      modelId: 'image-generation',
      label: 'Codex Image',
      modality: 'image',
      source: 'builtin',
      mode: 'text-to-image',
      supportsImageReference: true,
    };
    const accountModel: Model = {
      id: 'account:seedream-5.5',
      provider: 'account',
      modelId: 'seedream-5.5',
      label: 'Seedream 5.5',
      modality: 'image',
      source: 'live',
      mode: 'text-to-image',
    };

    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [
            { id: 'codex', label: 'Codex', available: true, enabled: true, configured: true, credentialSource: 'local-agent', verification: 'unverified', reason: 'ready' },
            { id: 'account', label: 'OpenDesign', available: true, enabled: true, configured: true, credentialSource: 'account', verification: 'unverified', mediaEntitlement: 'not-included' },
            { id: 'fal', label: 'fal.ai', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' },
          ],
          agents: [],
          routes: {},
          capabilities: [{ modality: 'image', available: true, modelIds: [codexModel.id, imageModel.id], selectedModelId: codexModel.id }],
        },
        models: [codexModel, accountModel, imageModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const run = makeBaseRun('motion-full-chain', {
      steps: {
        storyboard: { draft: { prompt: 'Hero storyboard frame' } },
      },
    });
    const { props, mocks } = createStepProps('motion-full-chain', 'storyboard', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const modelTrigger = mounted.container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Model"]')!;
      expect(modelTrigger.textContent).toContain('Flux Schnell');

      await act(async () => { modelTrigger.click(); });
      const optionTexts = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map(el => el.textContent ?? '');
      expect(optionTexts.some(text => text.includes('Seedream 5.5'))).toBe(false);
      expect(optionTexts.some(text => text.includes('Codex Image'))).toBe(true);
      await act(async () => { modelTrigger.click(); });

      const providersBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Model providers'))!;
      await act(async () => { providersBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalledTimes(1);

      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => { generateBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:storyboard',
        'generate',
        expect.objectContaining({
          stepId: 'storyboard',
          modality: 'image',
          model: imageModel.id,
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('upgrades from fallback Codex Image when another provider becomes available after prompt edit', async () => {
    const codexModel: Model = {
      id: 'codex:image-generation',
      provider: 'codex',
      modelId: 'image-generation',
      label: 'Codex Image',
      modality: 'image',
      source: 'builtin',
      mode: 'text-to-image',
      supportsImageReference: true,
    };

    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [
            { id: 'codex', label: 'Codex', available: true, enabled: true, configured: true, credentialSource: 'local-agent', verification: 'unverified', reason: 'ready' },
          ],
          agents: [],
          routes: {},
          capabilities: [{ modality: 'image', available: true, modelIds: [codexModel.id], selectedModelId: codexModel.id }],
        },
        models: [codexModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const run = makeBaseRun('motion-full-chain', {
      steps: {
        storyboard: { draft: { prompt: 'Initial storyboard frame' } },
      },
    });
    const { props, mocks } = createStepProps('motion-full-chain', 'storyboard', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const promptEl = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-storyboard')!;
      await act(async () => {
        setFieldValue(promptEl, 'Updated storyboard prompt');
        promptEl.focus();
        promptEl.blur();
      });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'draft:storyboard',
        'update_step',
        expect.objectContaining({
          stepId: 'storyboard',
          draft: expect.not.objectContaining({ model: codexModel.id }),
        }),
      );

      mockUseMediaCatalog.mockReturnValue({
        catalog: {
          status: {
            providers: [
              { id: 'codex', label: 'Codex', available: true, enabled: true, configured: true, credentialSource: 'local-agent', verification: 'unverified', reason: 'ready' },
              { id: 'fal', label: 'fal.ai', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' },
            ],
            agents: [],
            routes: {},
            capabilities: [{ modality: 'image', available: true, modelIds: [codexModel.id, imageModel.id], selectedModelId: imageModel.id }],
          },
          models: [codexModel, imageModel],
        },
        failed: false,
        retry: vi.fn(),
      });
      await mounted.rerender(<MediaStep {...props} />);

      const generateBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => { generateBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'generate:storyboard',
        'generate',
        expect.objectContaining({
          stepId: 'storyboard',
          model: imageModel.id,
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('shows provider recovery on quota failures and retries with a newly selected model', async () => {
    const codexModel: Model = {
      id: 'codex:image-generation',
      provider: 'codex',
      modelId: 'image-generation',
      label: 'Codex Image',
      modality: 'image',
      source: 'builtin',
      mode: 'text-to-image',
      supportsImageReference: true,
    };

    mockUseMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [
            { id: 'codex', label: 'Codex', available: true, enabled: true, configured: true, credentialSource: 'local-agent', verification: 'unverified', reason: 'ready' },
            { id: 'fal', label: 'fal.ai', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' },
          ],
          agents: [],
          routes: { image: codexModel.id },
          capabilities: [{ modality: 'image', available: true, modelIds: [codexModel.id, imageModel.id], selectedModelId: codexModel.id }],
        },
        models: [codexModel, imageModel],
      },
      failed: false,
      retry: vi.fn(),
    });

    const failedIter: StepIteration = {
      id: '77777777-7777-4777-8777-777777777773',
      number: 1,
      createdAt: 1700000000000,
      source: 'generated',
      prompt: 'Storyboard frame for hello: sssss, composition',
      settings: { scene: 'text-to-image', parameters: { aspect_ratio: '1:1' } },
      inputs: [],
      outputs: [],
      job: {
        jobId: 'job-codex-limit',
        state: 'failed',
        modality: 'image',
        model: codexModel.id,
        error: "Codex image generation exited (1)\nYou've hit your usage limit. Visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 23rd, 2026 8:07 PM.",
      },
    };
    const run = makeBaseRun('motion-full-chain', {
      steps: {
        storyboard: {
          iterations: [failedIter],
          activeIterationId: failedIter.id,
          draft: { prompt: 'Storyboard frame for hello: sssss, composition' },
        },
      },
    });

    const { props, mocks } = createStepProps('motion-full-chain', 'storyboard', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const errorBox = mounted.container.querySelector('.om-step-inline-error')!;
      expect(errorBox.textContent).toContain('Your current model provider hit a limit or needs access');

      const setupBtn = Array.from(errorBox.querySelectorAll('button')).find(b => b.textContent?.includes('Set up a provider'))!;
      await act(async () => { setupBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalledTimes(1);

      const modelTrigger = mounted.container.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Model"]')!;
      await act(async () => { modelTrigger.click(); });
      const fluxOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes('Flux Schnell'))!;
      await act(async () => { fluxOption.click(); });

      const retryBtn = Array.from(errorBox.querySelectorAll('button')).find(b => b.textContent?.includes('Retry with Flux Schnell'))!;
      expect(retryBtn).toBeTruthy();
      await act(async () => { retryBtn.click(); });

      const retryCall = mocks.mutate.mock.calls.find(call => call[0] === 'generate:storyboard');
      expect(retryCall?.[1]).toBe('generate');
      expect(retryCall?.[2]).toMatchObject({
        stepId: 'storyboard',
        modality: 'image',
        model: imageModel.id,
        prompt: 'Storyboard frame for hello: sssss, composition',
        scene: 'text-to-image',
        parameters: { image_size: 'landscape_16_9', num_images: 1 },
      });
      expect((retryCall?.[2] as { parameters?: Record<string, unknown> })?.parameters).not.toHaveProperty('aspect_ratio');
    } finally {
      await mounted.unmount();
    }
  });

  it('renders a rich live generation stage with friendly model label, phase title, prompt preview and Cancel', async () => {
    const runningIter: StepIteration = {
      id: '77777777-7777-4777-8777-777777777774',
      number: 2,
      createdAt: Date.now() - 4000,
      source: 'generated',
      prompt: 'Studio product photo of Holiday Tote with crisp rim lighting',
      settings: { scene: 'text-to-image' },
      inputs: [],
      outputs: [],
      job: {
        jobId: 'job-running-1',
        state: 'running',
        modality: 'image',
        model: imageModel.id,
      },
    };
    const run = makeBaseRun('black-friday', {
      steps: {
        'product-images': {
          iterations: [runningIter],
          activeIterationId: runningIter.id,
          draft: { prompt: runningIter.prompt },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'product-images', { run });
    const mounted = await mountStep(<MediaStep {...props} />);

    try {
      const stage = mounted.container.querySelector('.om-step-job-stage')!;
      expect(stage).toBeTruthy();
      expect(stage.textContent).toContain('Creating image…');
      expect(stage.textContent).toContain('Flux Schnell');
      expect(stage.textContent).toContain('Studio product photo of Holiday Tote');
      expect(mounted.container.textContent).not.toContain('fal:flux-schnell');

      const cancelBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Cancel'))!;
      await act(async () => { cancelBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith('cancel:product-images:77777777-7777-4777-8777-777777777774', 'cancel', {
        stepId: 'product-images',
        iterationId: runningIter.id,
      });
    } finally {
      await mounted.unmount();
    }
  });

  it('does not persist promptEdited on a plain focus/blur without edits', async () => {
    const run = makeBaseRun('black-friday', {
      steps: {
        'product-images': {
          draft: { prompt: 'Seeded product prompt', promptEdited: false },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'product-images', { run });
    const mounted = await mountStep(<MediaStep {...props} />);
    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('#media-prompt-product-images')!;
      await act(async () => {
        textarea.focus();
        textarea.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
      });
      expect(mocks.mutate).not.toHaveBeenCalledWith(
        'draft:product-images',
        'update_step',
        expect.anything(),
      );
    } finally {
      await mounted.unmount();
    }
  });
});
