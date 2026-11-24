// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepIteration } from '../../../../shared/scenario-runs';
import { I18nProvider } from '../../i18n/I18n';
import { BriefStep } from './BriefStep';
import { createStepProps, makeBaseRun, mountStep, setFieldValue } from './stepTestHelpers';

vi.mock('../../motion/useIntegrationInfo', () => ({
  useIntegrationInfo: () => ({ info: { previewUrl: 'http://127.0.0.1:4197', dataDirectory: '/fixture/workspace' }, failed: false, retry: vi.fn() }),
}));

const mockMediaCatalog = vi.fn(() => ({
  catalog: {
    status: { providers: [{ id: 'gemini', label: 'Gemini', available: false, enabled: false, configured: false, credentialSource: 'none', verification: 'unverified', reason: 'Not configured' }], agents: [], routes: {}, capabilities: [] },
    models: [],
  },
  failed: false,
  retry: vi.fn(),
}));

vi.mock('../../motion/useMediaCatalog', () => ({
  useMediaCatalog: (...args: unknown[]) => mockMediaCatalog(...args),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('BriefStep', () => {
  it('renders dynamic Black Friday fields, computes live discount badge, and debounces autosave', async () => {
    vi.useFakeTimers();
    const run = makeBaseRun('black-friday', {
      brief: {
        idea: 'Black Friday tote campaign',
        productName: 'Weekender Tote',
        originalPrice: '$100',
        salePrice: '$60',
        promoCode: 'BF40',
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      expect(mounted.container.querySelector('.om-step-discount-banner')).toBeNull();
      expect(mounted.container.querySelector('[data-discount-badge]')?.textContent).toContain('40% OFF');
      expect(mounted.container.textContent).toContain('BF40');

      // Empty Version history stays hidden when a draft has no saved versions yet.
      expect(mounted.container.querySelector('[data-test-iterations="true"]')).toBeNull();
      // Guided composer keeps a single Next button in the workspace footer (none inside the composer).
      expect(
        Array.from(mounted.container.querySelectorAll('[data-brief-composer="guided"] button')).some(b =>
          b.textContent?.includes('Next:'),
        ),
      ).toBe(false);

      const productInput = mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')!;
      expect(productInput.value).toBe('Weekender Tote');

      await act(async () => {
        setFieldValue(productInput, 'Leather Weekender Tote');
      });

      // Not sent before 800ms debounce
      expect(mocks.mutate).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(850);
      });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-autosave',
        'update_brief',
        expect.objectContaining({
          brief: expect.objectContaining({ productName: 'Leather Weekender Tote' }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('saves brief revisions, restores earlier revisions, and applies prompts only to unedited steps', async () => {
    const savedIter: StepIteration = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      number: 1,
      createdAt: 1700000000000,
      source: 'manual',
      inputs: [],
      outputs: [{ type: 'brief', values: { productName: 'Old Tote', idea: 'Original idea' } }],
    };
    const run = makeBaseRun('black-friday', {
      brief: { productName: 'New Tote', idea: 'Updated idea', salePrice: '$79', promoCode: 'BF40' },
      steps: {
        brief: { iterations: [savedIter], activeIterationId: savedIter.id },
        'product-images': { draft: { prompt: 'Custom user prompt', promptEdited: true } },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      const saveBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save version'))!;
      await act(async () => { saveBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-revision',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'manual',
            outputs: [expect.objectContaining({ type: 'brief' })],
          }),
        }),
      );

      // Expand Step prompts disclosure, then Apply to all steps skips product-images (promptEdited: true) and updates sales-film
      const viewPromptsBtn = Array.from(mounted.container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('View prompts'),
      )!;
      await act(async () => { viewPromptsBtn.click(); });

      const applyBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Apply to all steps'))!;
      await act(async () => { applyBtn.click(); });
      const seedCalls = mocks.mutate.mock.calls.filter(call => call[1] === 'update_step');
      expect(seedCalls.map(c => (c[2] as { stepId: string }).stepId)).toEqual(['sales-film']);

      // Version history is visible when iterations exist; restore works.
      expect(mounted.container.querySelector('[data-test-iterations="true"]')).toBeTruthy();
      const restoreBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Restore')!;
      await act(async () => { restoreBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-restore',
        'update_brief',
        expect.objectContaining({
          brief: expect.objectContaining({ productName: 'Old Tote' }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('localizes saved brief labels and option values while restoring the original values', async () => {
    const values = { idea: 'A product reveal', audience: 'Creators', tone: 'premium' };
    const savedVersion: StepIteration = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      number: 1,
      createdAt: 1700000000000,
      source: 'manual',
      inputs: [],
      outputs: [{ type: 'brief', values }],
    };
    const run = makeBaseRun('motion-full-chain', {
      steps: { brief: { iterations: [savedVersion], activeIterationId: savedVersion.id } },
    });
    const { props, mocks } = createStepProps('motion-full-chain', 'brief', { run });
    const mounted = await mountStep(
      <I18nProvider initialLocale="zh-CN"><BriefStep {...props} /></I18nProvider>,
    );

    try {
      const version = mounted.container.querySelector('[data-test-iterations]')!;
      expect(version.querySelector('p')?.textContent).toBe(
        '核心创意：A product reveal · 目标受众：Creators · 文案语气：高级质感',
      );
      await act(async () => { version.querySelector('button')!.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith('brief-restore', 'update_brief', {
        brief: expect.objectContaining(values),
      });
    } finally {
      await mounted.unmount();
    }
  });

  it('preserves active user input when remote brief updates arrive concurrently', async () => {
    const run1 = makeBaseRun('black-friday', {
      revision: 1,
      brief: { productName: 'Initial Tote', promoCode: 'OLD' },
    });
    const first = createStepProps('black-friday', 'brief', { run: run1 });
    const mounted = await mountStep(<BriefStep {...first.props} />);

    try {
      const productInput = mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')!;
      await act(async () => {
        productInput.focus();
        setFieldValue(productInput, 'My Unsaved Draft');
      });

      const run2 = makeBaseRun('black-friday', {
        revision: 2,
        brief: { productName: 'Remote Overwrite', promoCode: 'BF50' },
      });
      const second = createStepProps('black-friday', 'brief', { run: run2 });
      await mounted.rerender(<BriefStep {...second.props} />);

      // Active dirty field is preserved while non-dirty remote field updates
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')?.value).toBe('My Unsaved Draft');
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-promoCode')?.value).toBe('BF50');
    } finally {
      await mounted.unmount();
    }
  });

  it('supports AI influencer script outline generation and manual script saves', async () => {
    const run = makeBaseRun('ai-influencer', {
      brief: { personaName: 'Mina Park', topic: '3 automation habits', idea: 'Save 5 hours a week' },
    });
    const { props, mocks } = createStepProps('ai-influencer', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      // Episode script starts collapsed behind a borderless disclosure on a fresh draft
      expect(mounted.container.querySelector('textarea[aria-label="Episode script"]')).toBeNull();
      const genBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Generate script outline'))!;
      await act(async () => { genBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-script-outline',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'local',
            outputs: [expect.objectContaining({ type: 'script', text: expect.stringContaining('Mina Park') })],
          }),
        }),
      );

      // Generating an outline auto-expands Episode script so the user can refine and save
      const scriptArea = mounted.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Episode script"]')!;
      expect(scriptArea).toBeTruthy();
      await act(async () => { setFieldValue(scriptArea, 'Edited spoken script'); });

      const saveScriptBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Save script version'))!;
      expect(saveScriptBtn.className).not.toContain('primary');
      await act(async () => { saveScriptBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-script-save',
        'add_iteration',
        expect.objectContaining({
          stepId: 'brief',
          iteration: expect.objectContaining({
            source: 'manual',
            outputs: [{ type: 'script', text: 'Edited spoken script' }],
          }),
        }),
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('folds Gemini 4 availability and Neon inspiration rail behind a disclosure with compact status chip', async () => {
    const { props, mocks } = createStepProps('gemini-4-neon', 'brief');
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      // Secondary availability card and 8-card inspiration rail start collapsed on Brief
      expect(mounted.container.querySelectorAll('.om-step-inspiration-card').length).toBe(0);
      expect(mounted.container.querySelector('[data-gemini-status]')?.textContent).toContain('Not configured');

      const toggleBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('View details'))!;
      expect(toggleBtn).toBeTruthy();
      await act(async () => { toggleBtn.click(); });

      const cards = mounted.container.querySelectorAll('.om-step-inspiration-card');
      expect(cards.length).toBe(8);
      await act(async () => { (cards[0] as HTMLButtonElement).click(); });
      expect(mocks.nav.openModelHub).toHaveBeenCalledWith('gemini-4');

      const connectBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Connect Gemini'))!;
      await act(async () => { connectBtn.click(); });
      expect(mocks.nav.openProviders).toHaveBeenCalledWith('gemini');
    } finally {
      await mounted.unmount();
    }
  });

  it('defaults to the guided fill-in-the-blanks composer, applies one-click example presets, and toggles to All fields', async () => {
    vi.useFakeTimers();
    const { props, mocks } = createStepProps('black-friday', 'brief', { run: null });
    const mounted = await mountStep(<BriefStep {...props} />);

    try {
      // Guided fill-in-the-blanks sentence is active by default (no 12-box form grid yet)
      expect(mounted.container.querySelector('[data-brief-composer="guided"]')).toBeTruthy();
      expect(mounted.container.querySelector('.om-step-form-grid')).toBeNull();
      expect(mounted.container.querySelectorAll('.om-blank-wrap').length).toBeGreaterThanOrEqual(7);

      // Step prompts start collapsed behind a one-line disclosure until expanded
      expect(mounted.container.querySelector('.om-step-prompt-list')).toBeNull();
      const viewPromptsBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('View prompts'))!;
      await act(async () => { viewPromptsBtn.click(); });
      expect(mounted.container.querySelector('.om-step-prompt-list')).toBeTruthy();

      // Click a one-click example preset chip to fill all blanks instantly
      const presetBtn = mounted.container.querySelector<HTMLButtonElement>('.om-brief-preset-chip')!;
      expect(presetBtn).toBeTruthy();
      await act(async () => { presetBtn.click(); });

      expect(mocks.showToast).toHaveBeenCalledWith('Example applied', 'info', 'feedback');
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')?.value).toBe('Holiday Weekender Tote');
      expect(mounted.container.querySelector('[data-discount-badge]')?.textContent).toContain('39% OFF');

      await act(async () => { await vi.advanceTimersByTimeAsync(850); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'brief-autosave',
        'update_brief',
        expect.objectContaining({
          brief: expect.objectContaining({ productName: 'Holiday Weekender Tote', promoCode: 'BF40' }),
        }),
      );

      // Toggle to All fields reveals the full structured form synced with the filled values
      const allFieldsBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'All fields')!;
      await act(async () => { allFieldsBtn.click(); });
      expect(mounted.container.querySelector('[data-brief-composer="form"]')).toBeTruthy();
      expect(mounted.container.querySelector('.om-step-form-grid')).toBeTruthy();
      expect(mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')?.value).toBe('Holiday Weekender Tote');
    } finally {
      await mounted.unmount();
    }
  });

  it('supports StepCapabilityBar Copy MCP prompt with ensureRun, quick image/video generation, and Sync', async () => {
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
          routes: { image: 'fal:flux', video: 'fal:wan' },
          capabilities: [
            { modality: 'image', available: true, modelIds: ['fal:flux'], selectedModelId: 'fal:flux' },
            { modality: 'video', available: true, modelIds: ['fal:wan'], selectedModelId: 'fal:wan' },
          ],
        },
        models: [
          { id: 'fal:flux', provider: 'fal', modelId: 'flux', label: 'Flux', modality: 'image', source: 'builtin' },
          { id: 'fal:wan', provider: 'fal', modelId: 'wan', label: 'Wan', modality: 'video', source: 'builtin' },
        ] as never,
      },
      failed: false,
      retry: vi.fn(),
    });

    // Unsaved draft: Copy MCP prompt calls ensureRun and copies step-scoped write-back instructions.
    const draftSetup = createStepProps('black-friday', 'brief', { run: null });
    const draftMounted = await mountStep(<BriefStep {...draftSetup.props} />);
    try {
      const assistBar = draftMounted.container.querySelector('[data-step-assist="brief"]')!;
      const copyMcpBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Copy MCP prompt'))!;
      await act(async () => {
        copyMcpBtn.click();
        await Promise.resolve();
      });
      expect(draftSetup.mocks.ensureRun).toHaveBeenCalledTimes(1);
      expect(clipboardSpy).toHaveBeenCalledTimes(1);
      const copied = clipboardSpy.mock.calls[0][0] as string;
      expect(copied).toContain('11111111-1111-4111-8111-111111111111');
      expect(copied).toContain('stepId: "brief"');
      expect(copied).toContain('command: "add_pool"');
      expect(copied).toContain('command: "update_brief" | "add_iteration"');
    } finally {
      await draftMounted.unmount();
    }

    // Saved run: quick-gen expands, switches modality, calls generate, and Sync invokes refresh.
    const run = makeBaseRun('black-friday', {
      brief: { productName: 'Holiday Tote', idea: 'Full-grain leather tote' },
    });
    const savedSetup = createStepProps('black-friday', 'brief', { run });
    const savedMounted = await mountStep(<BriefStep {...savedSetup.props} />);
    try {
      const assistBar = savedMounted.container.querySelector('[data-step-assist="brief"]')!;
      const quickToggle = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Generate media'))!;
      await act(async () => { quickToggle.click(); });

      const quickGen = savedMounted.container.querySelector('[data-quick-gen="brief"]')!;
      expect(quickGen).toBeTruthy();

      const videoChip = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Video')!;
      await act(async () => { videoChip.click(); });

      const promptInput = quickGen.querySelector<HTMLTextAreaElement>('#quick-gen-prompt-brief')!;
      await act(async () => { setFieldValue(promptInput, '15s Holiday Tote reveal'); });

      const generateBtn = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => {
        generateBtn.click();
        await Promise.resolve();
      });

      expect(savedSetup.mocks.mutate).toHaveBeenCalledWith(
        'quick-gen:brief:video',
        'generate',
        {
          stepId: 'brief',
          modality: 'video',
          model: 'fal:wan',
          prompt: '15s Holiday Tote reveal',
        },
      );

      const syncBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Sync')!;
      await act(async () => {
        syncBtn.click();
        await Promise.resolve();
      });
      expect(savedSetup.mocks.refresh).toHaveBeenCalledTimes(1);
      expect(savedSetup.mocks.showToast).toHaveBeenCalledWith('Synced latest assets', 'info', 'feedback');
    } finally {
      await savedMounted.unmount();
    }
  });

  it('flushes pending brief edits on unmount before the debounce timer fires', async () => {
    vi.useFakeTimers();
    const run = makeBaseRun('black-friday', {
      brief: { productName: 'Old Tote' },
    });
    const { props, mocks } = createStepProps('black-friday', 'brief', { run });
    const mounted = await mountStep(<BriefStep {...props} />);
    try {
      const allFieldsBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('All fields'))!;
      await act(async () => { allFieldsBtn.click(); });
      const productInput = mounted.container.querySelector<HTMLInputElement>('#brief-black-friday-productName')!;
      await act(async () => { setFieldValue(productInput, 'Holiday Weekender Tote'); });
      expect(mocks.mutate).not.toHaveBeenCalled();
    } finally {
      await mounted.unmount();
    }
    expect(mocks.mutate).toHaveBeenCalledWith('brief-autosave', 'update_brief', {
      brief: { productName: 'Holiday Weekender Tote' },
    });
  });
});
