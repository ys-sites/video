// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem, StepIteration } from '../../../../shared/scenario-runs';
import { SocialPackStep } from './SocialPackStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

const mockMediaCatalog = vi.fn(() => ({
  catalog: { status: { providers: [], agents: [], routes: {}, capabilities: [] }, models: [] },
  failed: false,
  retry: vi.fn(),
}));

vi.mock('../../motion/useMediaCatalog', () => ({
  useMediaCatalog: (...args: unknown[]) => mockMediaCatalog(...args),
}));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SocialPackStep', () => {
  it('plays the pinned lead video and switches the preview when media is reordered', async () => {
    const video: PoolItem = {
      id: 'video', kind: 'video', label: 'Vertical film', source: 'agent',
      ref: { type: 'asset', assetId: 'video-asset', versionId: 'video-version' },
      stepId: 'motion-film', tags: [], pinned: false, addedAt: 1700000000000,
    };
    const image: PoolItem = {
      ...video, id: 'image', kind: 'image', label: 'Storyboard',
      ref: { type: 'asset', assetId: 'image-asset', versionId: 'image-version' },
    };
    const iteration: StepIteration = {
      id: 'social-version', number: 1, createdAt: 1700000000000, source: 'agent', inputs: [],
      outputs: [{
        type: 'social',
        posts: [{ id: 'draft', platform: 'xiaohongshu', text: 'Launch draft', hashtags: [], mediaPoolItemIds: [video.id, image.id], aspect: '9:16' }],
      }],
    };
    const run = makeBaseRun('motion-full-chain', {
      pool: [video, image],
      steps: { social: { iterations: [iteration], activeIterationId: iteration.id } },
    });
    const { props } = createStepProps('motion-full-chain', 'social', { run });
    const mounted = await mountStep(<SocialPackStep {...props} />);
    try {
      const frame = mounted.container.querySelector('.om-step-social-preview-frame')!;
      const player = frame.querySelector('video')!;
      expect(player.getAttribute('src')).toBe(assetMediaUrl(video.ref.assetId, video.ref.versionId));
      expect(player.controls).toBe(true);
      expect(player.autoplay).toBe(false);
      expect(frame.getAttribute('data-aspect')).toBe('9:16');

      const moveRight = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Move right"]')!;
      await act(async () => { moveRight.click(); });
      expect(frame.querySelector('video')).toBeNull();
      expect(frame.querySelector('img')?.getAttribute('src')).toBe(assetMediaUrl(image.ref.assetId, image.ref.versionId));
    } finally {
      await mounted.unmount();
    }
  });

  it('drafts per platform, warns above character limit, regenerates new variants, and copies Markdown with Toast', async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardSpy },
    });

    const run = makeBaseRun('black-friday', {
      brief: {
        productName: 'Holiday Tote',
        salePrice: '$79',
        originalPrice: '$129',
        promoCode: 'BF40',
        saleWindow: 'Nov 27 – Dec 1',
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'social', { run });
    const mounted = await mountStep(<SocialPackStep {...props} />);

    try {
      const draftBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Generate posts'))!;
      await act(async () => { draftBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-draft:social:v0',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({
            source: 'local',
            settings: expect.objectContaining({ variant: 0 }),
          }),
        }),
      );

      // Verify platform cards rendered (black-friday has 5 platforms: x, instagram, tiktok, douyin, xiaohongshu)
      expect(mounted.container.querySelectorAll('[data-social-platform]').length).toBe(5);

      // Push X body text past 280 chars and assert warning state
      const xCard = mounted.container.querySelector('[data-social-platform="x"]')!;
      const xBody = xCard.querySelector('textarea')!;
      await act(async () => { setFieldValue(xBody, 'a'.repeat(295)); });

      const counter = xCard.querySelector('[data-char-counter="x"]')!;
      expect(counter.getAttribute('data-over-limit')).toBe('true');
      expect(counter.textContent).toContain('295 / 280');

      // Add a custom hashtag on X card
      const tagInput = xCard.querySelector<HTMLInputElement>('input[aria-label="Add hashtag for X"]')!;
      await act(async () => { setFieldValue(tagInput, '#FlashSale'); });
      const addTagBtn = Array.from(xCard.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Add')!;
      await act(async () => { addTagBtn.click(); });
      expect(xCard.textContent).toContain('#FlashSale');

      // Save edits creates a manual iteration
      const saveBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save edits'))!;
      expect(saveBtn.disabled).toBe(false);
      await act(async () => { saveBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-save:social',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({ source: 'manual' }),
        }),
      );

      // Copy all posts (Markdown) from export menu shows Toast
      const copyMdBtn = Array.from(mounted.container.querySelectorAll('[data-test-export-menu] *')).find(el => el.textContent?.trim() === 'Copy all posts (Markdown)') as HTMLElement;
      expect(copyMdBtn).toBeTruthy();
      await act(async () => { copyMdBtn.click(); });
      expect(clipboardSpy).toHaveBeenCalledWith(expect.stringContaining('# Social posts'));
      expect(mocks.showToast).toHaveBeenCalledWith('Copied all posts as Markdown', 'info', 'feedback');
    } finally {
      await mounted.unmount();
    }
  });

  it('increments variant on Regenerate when an iteration already exists', async () => {
    const existingIter: StepIteration = {
      id: '88888888-8888-4888-8888-888888888888',
      number: 1,
      createdAt: 1700000000000,
      source: 'local',
      settings: { variant: 0, tone: 'bold', platforms: ['x'] },
      inputs: [],
      outputs: [{
        type: 'social',
        posts: [{ id: 'x-v1', platform: 'x', text: 'First draft', hashtags: ['BlackFriday'], mediaPoolItemIds: [], aspect: '16:9' }],
      }],
    };
    const run = makeBaseRun('black-friday', {
      steps: {
        social: { iterations: [existingIter], activeIterationId: existingIter.id },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'social', { run });
    const mounted = await mountStep(<SocialPackStep {...props} />);

    try {
      const regenBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Regenerate'))!;
      await act(async () => { regenBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'social-draft:social:v1',
        'add_iteration',
        expect.objectContaining({
          stepId: 'social',
          iteration: expect.objectContaining({
            source: 'local',
            settings: expect.objectContaining({ variant: 1 }),
          }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('supports StepCapabilityBar Copy MCP prompt, Sync, and quick media generation without wiping drafted social posts', async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardSpy },
    });

    mockMediaCatalog.mockReturnValue({
      catalog: {
        status: {
          providers: [{ id: 'fal', label: 'fal', available: true, enabled: true, configured: true, credentialSource: 'stored', verification: 'verified', reason: 'ok' }],
          agents: [],
          routes: { image: 'fal:flux', video: 'fal:wan', audio: 'fal:music' },
          capabilities: [
            { modality: 'image', available: true, modelIds: ['fal:flux'], selectedModelId: 'fal:flux' },
            { modality: 'video', available: true, modelIds: ['fal:wan'], selectedModelId: 'fal:wan' },
            { modality: 'audio', available: true, modelIds: ['fal:music'], selectedModelId: 'fal:music' },
          ],
        },
        models: [
          { id: 'fal:flux', provider: 'fal', modelId: 'flux', label: 'Flux', modality: 'image', source: 'builtin' },
          { id: 'fal:wan', provider: 'fal', modelId: 'wan', label: 'Wan', modality: 'video', source: 'builtin' },
          { id: 'fal:music', provider: 'fal', modelId: 'music', label: 'MusicGen', modality: 'audio', source: 'builtin', mode: 'text-to-audio' },
        ] as never,
      },
      failed: false,
      retry: vi.fn(),
    });

    // Unsaved draft: Copy MCP prompt ensures a run and writes social write-back instructions.
    const draftSetup = createStepProps('black-friday', 'social', { run: null });
    const draftMounted = await mountStep(<SocialPackStep {...draftSetup.props} />);
    try {
      const assistBar = draftMounted.container.querySelector('[data-step-assist="social"]')!;
      const copyMcpBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Copy MCP prompt'))!;
      await act(async () => {
        copyMcpBtn.click();
        await Promise.resolve();
      });
      expect(draftSetup.mocks.ensureRun).toHaveBeenCalledTimes(1);
      expect(clipboardSpy).toHaveBeenCalledTimes(1);
      const copied = clipboardSpy.mock.calls[0][0] as string;
      expect(copied).toContain('11111111-1111-4111-8111-111111111111');
      expect(copied).toContain('stepId: "social"');
      expect(copied).toContain('command: "add_pool"');
      expect(copied).toContain('outputs: [{ type: "social", posts }]');
    } finally {
      await draftMounted.unmount();
    }

    // Saved run with drafted posts: generating quick media keeps existing social posts intact.
    const socialIter: StepIteration = {
      id: '88888888-8888-4888-8888-888888888888',
      number: 1,
      createdAt: 1700000000000,
      source: 'local',
      settings: { variant: 0, tone: 'bold', platforms: ['x'] },
      inputs: [],
      outputs: [{
        type: 'social',
        posts: [{ id: 'x-v1', platform: 'x', text: 'Existing X launch draft', hashtags: ['BlackFriday'], mediaPoolItemIds: [], aspect: '16:9' }],
      }],
    };
    const mediaIter: StepIteration = {
      id: '99999999-9999-4999-8999-999999999999',
      number: 2,
      createdAt: 1700000001000,
      source: 'generated',
      inputs: [],
      outputs: [],
      job: { jobId: 'job-social-vid', state: 'running', modality: 'video', model: 'fal:wan' },
    };

    const runWithPosts = makeBaseRun('black-friday', {
      steps: {
        social: { iterations: [socialIter], activeIterationId: socialIter.id },
      },
    });
    const setup = createStepProps('black-friday', 'social', { run: runWithPosts });
    const mounted = await mountStep(<SocialPackStep {...setup.props} />);
    try {
      const assistBar = mounted.container.querySelector('[data-step-assist="social"]')!;
      const mcpGuideBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('MCP guide'))!;
      await act(async () => { mcpGuideBtn.click(); });
      expect(setup.mocks.nav.openMcp).toHaveBeenCalledTimes(1);

      const quickToggle = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Generate media'))!;
      await act(async () => { quickToggle.click(); });

      const quickGen = mounted.container.querySelector('[data-quick-gen="social"]')!;
      const videoChip = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Video')!;
      await act(async () => { videoChip.click(); });

      const promptInput = quickGen.querySelector<HTMLTextAreaElement>('#quick-gen-prompt-social')!;
      await act(async () => { setFieldValue(promptInput, 'Short X social video loop'); });

      const generateBtn = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => {
        generateBtn.click();
        await Promise.resolve();
      });

      expect(setup.mocks.mutate).toHaveBeenCalledWith(
        'quick-gen:social:video',
        'generate',
        {
          stepId: 'social',
          modality: 'video',
          model: 'fal:wan',
          prompt: 'Short X social video loop',
        },
      );

      // Switch to Audio modality and submit audio quick generation.
      const audioChip = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Audio')!;
      await act(async () => { audioChip.click(); });
      await act(async () => { setFieldValue(promptInput, 'Upbeat 15s launch jingle'); });
      await act(async () => {
        generateBtn.click();
        await Promise.resolve();
      });
      expect(setup.mocks.mutate).toHaveBeenCalledWith(
        'quick-gen:social:audio',
        'generate',
        {
          stepId: 'social',
          modality: 'audio',
          model: 'fal:music',
          mode: 'text-to-audio',
          prompt: 'Upbeat 15s launch jingle',
        },
      );

      // Simulate server appending the media generation iteration and pointing activeIterationId to it.
      const runWithMedia = makeBaseRun('black-friday', {
        steps: {
          social: { iterations: [socialIter, mediaIter], activeIterationId: mediaIter.id },
        },
      });
      const updated = createStepProps('black-friday', 'social', { run: runWithMedia });
      await mounted.rerender(<SocialPackStep {...updated.props} />);

      const xTextarea = mounted.container.querySelector<HTMLTextAreaElement>('[data-social-platform="x"] textarea');
      expect(xTextarea?.value).toBe('Existing X launch draft');

      const syncBtn = Array.from(mounted.container.querySelectorAll('[data-step-assist="social"] button')).find(b => b.textContent?.trim() === 'Sync')!;
      await act(async () => {
        syncBtn.click();
        await Promise.resolve();
      });
      expect(updated.mocks.refresh).toHaveBeenCalledTimes(1);
      expect(updated.mocks.showToast).toHaveBeenCalledWith('Synced latest assets', 'info', 'feedback');
    } finally {
      await mounted.unmount();
    }
  });

  it('keeps Save edits enabled when add_iteration fails during drafting', async () => {
    const run = makeBaseRun('black-friday', {
      brief: { productName: 'Holiday Tote', salePrice: '$79' },
    });
    const { props, mocks } = createStepProps('black-friday', 'social', { run });
    mocks.mutate.mockRejectedValueOnce(new Error('Network error'));
    const mounted = await mountStep(<SocialPackStep {...props} />);
    try {
      const draftBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Generate posts'))!;
      await act(async () => {
        draftBtn.click();
        await Promise.resolve();
      });
      const saveBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save edits'))!;
      expect(saveBtn).toBeTruthy();
      expect(saveBtn.disabled).toBe(false);
    } finally {
      await mounted.unmount();
    }
  });
});
