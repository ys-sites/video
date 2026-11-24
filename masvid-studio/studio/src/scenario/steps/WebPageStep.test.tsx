// @vitest-environment happy-dom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignProjectDetail } from '../../../../shared/design-project';
import type { PoolItem } from '../../../../shared/scenario-runs';
import { designClient } from '../../design/designClient';
import { WebPageStep } from './WebPageStep';
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

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<!doctype html><html><body></body></html>', { status: 200 }));
});

const projectId = '22222222-2222-4222-8222-222222222222';
const rev1 = 'a'.repeat(64);
const rev2 = 'b'.repeat(64);
const rev3 = 'c'.repeat(64);

function makeDesignProject(revision: string): DesignProjectDetail {
  return {
    id: projectId,
    title: 'Landing Page',
    scenario: 'prototype',
    entry: 'index.html',
    designSystemId: null,
    templateId: null,
    source: 'blank',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    trashedAt: null,
    revision,
    versionId: 'v-1',
    versionLabel: 'v1',
    files: [{ path: 'index.html', size: 200, sha256: revision, kind: 'html' }],
    path: '/fixture/design/' + projectId,
    previewUrl: `/motion-api/design/raw/${projectId}/index.html`,
    editorUrl: `/?page=design&scene=projects&designProject=${projectId}`,
    openComments: 0,
  };
}

const sampleHtml = `<!doctype html><html><body>
  <div data-om-slot="hero" data-om-label="Hero visual"></div>
  <div data-om-slot="gallery" data-om-label="Gallery"></div>
</body></html>`;

const imgPool1: PoolItem = {
  id: '33333333-3333-4333-8333-333333333331',
  kind: 'image',
  ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444441', versionId: '55555555-5555-4555-8555-555555555551' },
  label: 'Hero Shot',
  source: 'upload',
  stepId: 'page-images',
  tags: [],
  pinned: false,
  addedAt: 1700000000000,
};

const imgPool2: PoolItem = {
  id: '33333333-3333-4333-8333-333333333332',
  kind: 'image',
  ref: { type: 'asset', assetId: '44444444-4444-4444-8444-444444444442', versionId: '55555555-5555-4555-8555-555555555552' },
  label: 'Gallery Shot',
  source: 'upload',
  stepId: 'page-images',
  tags: [],
  pinned: false,
  addedAt: 1700000000001,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WebPageStep', () => {
  it('creates an offline starter page and renders the preview iframe with ?v=<revision>', async () => {
    vi.spyOn(designClient, 'listTemplates').mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(designClient, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(designClient, 'getProject').mockResolvedValue({ project: makeDesignProject(rev1) });
    vi.spyOn(designClient, 'readFile').mockResolvedValue({ path: 'index.html', content: sampleHtml, revision: rev1, size: sampleHtml.length, nextOffset: null });

    const run = makeBaseRun('design-full-chain');
    const createdProject = makeDesignProject(rev1);
    const { props, mocks } = createStepProps('design-full-chain', 'landing-page', {
      run,
      mutateImpl: (async () => ({ run, project: createdProject })) as never,
    });
    const mounted = await mountStep(<WebPageStep {...props} />);

    try {
      const starterBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Create page'))!;
      expect(starterBtn).toBeTruthy();
      await act(async () => { starterBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        'create-page:landing-page:starter',
        'create_page',
        { stepId: 'landing-page', mode: 'starter' },
      );

      // Re-render with the linked designProjectId in step state
      const linkedRun = makeBaseRun('design-full-chain', {
        steps: { 'landing-page': { links: { designProjectId: projectId } } },
      });
      const next = createStepProps('design-full-chain', 'landing-page', { run: linkedRun });
      await mounted.rerender(<WebPageStep {...next.props} />);

      const iframe = mounted.container.querySelector<HTMLIFrameElement>('iframe.om-step-page-iframe');
      expect(iframe?.getAttribute('src')).toBe(`/motion-api/design/raw/${projectId}/index.html?v=${rev1}`);
      expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    } finally {
      await mounted.unmount();
    }
  });

  it('embeds a single image and chains design revisions sequentially on Embed all', async () => {
    vi.spyOn(designClient, 'getProject').mockResolvedValue({ project: makeDesignProject(rev1) });
    vi.spyOn(designClient, 'readFile').mockResolvedValue({ path: 'index.html', content: sampleHtml, revision: rev1, size: sampleHtml.length, nextOffset: null });

    const run = makeBaseRun('design-full-chain', {
      pool: [imgPool1, imgPool2],
      steps: {
        'landing-page': { links: { designProjectId: projectId } },
        'embed-images': { bindings: { embedImages: [imgPool1.id, imgPool2.id] } },
      },
    });

    const submittedRevisions: string[] = [];
    const responses = [makeDesignProject(rev2), makeDesignProject(rev3)];
    let callIdx = 0;

    const { props, mocks } = createStepProps('design-full-chain', 'embed-images', {
      run,
      mutateImpl: (async (_intent, _command, args) => {
        submittedRevisions.push(String(args.expectedDesignRevision));
        const nextProject = responses[Math.min(callIdx++, responses.length - 1)];
        return { run, project: nextProject, version: { id: `v-${callIdx + 1}` }, path: `assets/img-${callIdx}.png` };
      }) as never,
    });

    const mounted = await mountStep(<WebPageStep {...props} />);
    try {
      // Test single Embed on first row
      const firstRow = mounted.container.querySelector(`[data-embed-item="${imgPool1.id}"]`)!;
      const embedBtn = Array.from(firstRow.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Embed')!;
      await act(async () => { embedBtn.click(); });

      expect(mocks.mutate).toHaveBeenCalledWith(
        `embed:embed-images:${imgPool1.id}`,
        'embed_image',
        expect.objectContaining({
          stepId: 'embed-images',
          designProjectId: projectId,
          expectedDesignRevision: rev1,
          poolItemId: imgPool1.id,
          target: { kind: 'slot', slot: 'hero' },
        }),
      );
      expect(mocks.showToast).toHaveBeenCalledWith('Image embedded', 'info', 'feedback');

      // Reset and test Embed all chaining rev2 -> rev3
      submittedRevisions.length = 0;
      callIdx = 0;
      responses[0] = makeDesignProject(rev3);
      responses[1] = makeDesignProject('d'.repeat(64));

      const embedAllBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Embed all'))!;
      await act(async () => { embedAllBtn.click(); });

      expect(submittedRevisions).toEqual([rev2, rev3]);

      // Verify Pick from pool & remove chip in BindingSlot
      const removeChipBtn = mounted.container.querySelector<HTMLButtonElement>(`button[aria-label="Remove ${imgPool1.label}"]`)!;
      await act(async () => { removeChipBtn.click(); });
      expect(mocks.mutate).toHaveBeenCalledWith(
        'bind:embedImages',
        'update_step',
        { stepId: 'embed-images', bindings: { embedImages: [imgPool2.id] } },
      );
    } finally {
      await mounted.unmount();
    }
  });

  it('shows jump CTA on embed-only step when linked upstream page does not exist yet', async () => {
    const run = makeBaseRun('design-full-chain');
    const { props, mocks } = createStepProps('design-full-chain', 'embed-images', { run });
    const mounted = await mountStep(<WebPageStep {...props} />);

    try {
      expect(mounted.container.textContent).toContain('Create the page in Landing page first.');
      const jumpBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Go to Landing page'))!;
      expect(jumpBtn).toBeTruthy();
      await act(async () => { jumpBtn.click(); });
      expect(mocks.nav.selectStep).toHaveBeenCalledWith('landing-page');
    } finally {
      await mounted.unmount();
    }
  });

  it('shows a pre-filled page prompt composer with quick chips and filters unrelated templates by default', async () => {
    vi.spyOn(designClient, 'listTemplates').mockResolvedValue({
      items: [
        { id: 'pricing-page', title: 'Pricing Page', description: 'Pricing layout', scenario: 'prototype', previewUrl: '/p1', tags: [] },
        { id: 'trading-dashboard', title: 'Trading Analysis Dashboard', description: 'Unrelated finance layout', scenario: 'prototype', previewUrl: '/p2', tags: [] },
      ] as never,
      nextCursor: null,
    });
    vi.spyOn(designClient, 'listProjects').mockResolvedValue({ projects: [] });

    const run = makeBaseRun('black-friday', {
      brief: { productName: 'Holiday Weekender Tote', salePrice: '$79', originalPrice: '$129', promoCode: 'BF40' },
    });
    const { props } = createStepProps('black-friday', 'detail-page', { run });
    const mounted = await mountStep(<WebPageStep {...props} />);

    try {
      const textarea = mounted.container.querySelector<HTMLTextAreaElement>('#page-prompt-detail-page')!;
      expect(textarea).toBeTruthy();
      expect(textarea.value).toContain('Holiday Weekender Tote');
      expect(textarea.value).toContain('BF40');

      // Recommended template shows; unrelated trading dashboard stays hidden until expanded
      expect(mounted.container.textContent).toContain('Pricing Page');
      expect(mounted.container.textContent).not.toContain('Trading Analysis Dashboard');

      const showAllBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Show all layouts (2)'))!;
      await act(async () => { showAllBtn.click(); });
      expect(mounted.container.textContent).toContain('Trading Analysis Dashboard');
    } finally {
      await mounted.unmount();
    }
  });

  it('supports StepCapabilityBar Copy MCP prompt with ensureRun, quick media generation, and Sync reloading linked project', async () => {
    const clipboardSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardSpy },
    });

    vi.spyOn(designClient, 'listTemplates').mockResolvedValue({ items: [], nextCursor: null });
    vi.spyOn(designClient, 'listProjects').mockResolvedValue({
      projects: [makeDesignProject(rev1)],
    });
    const getProjectSpy = vi.spyOn(designClient, 'getProject').mockResolvedValue({ project: makeDesignProject(rev1) });
    const readFileSpy = vi.spyOn(designClient, 'readFile').mockResolvedValue({
      path: 'index.html',
      content: sampleHtml,
      revision: rev1,
      size: sampleHtml.length,
      nextOffset: null,
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

    // Unsaved draft: Copy MCP prompt calls ensureRun and copies step-scoped prompt.
    const draftSetup = createStepProps('design-full-chain', 'landing-page', { run: null });
    const draftMounted = await mountStep(<WebPageStep {...draftSetup.props} />);
    try {
      const assistBar = draftMounted.container.querySelector('[data-step-assist="landing-page"]')!;
      const copyMcpBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Copy MCP prompt'))!;
      await act(async () => {
        copyMcpBtn.click();
        await Promise.resolve();
      });
      expect(draftSetup.mocks.ensureRun).toHaveBeenCalledTimes(1);
      expect(clipboardSpy).toHaveBeenCalledTimes(1);
      const copied = clipboardSpy.mock.calls[0][0] as string;
      expect(copied).toContain('11111111-1111-4111-8111-111111111111');
      expect(copied).toContain('stepId: "landing-page"');
      expect(copied).toContain('command: "add_pool"');
      expect(copied).toContain('recordIteration: true');
      expect(copied).toContain('command: "link_design"');

      // Secondary link-existing-project card starts collapsed behind disclosure.
      expect(draftMounted.container.textContent).not.toContain('Link an existing Design project');
      const linkDisclosure = Array.from(draftMounted.container.querySelectorAll('button')).find(b =>
        b.textContent?.includes('Or reuse an existing Design page'),
      )!;
      await act(async () => { linkDisclosure.click(); });
      expect(draftMounted.container.textContent).toContain('Link an existing Design project');
    } finally {
      await draftMounted.unmount();
    }

    // Linked project: quick-gen creates image/video job and Sync refreshes run + reloads linked Design project.
    const linkedRun = makeBaseRun('design-full-chain', {
      steps: { 'landing-page': { links: { designProjectId: projectId } } },
    });
    const linkedSetup = createStepProps('design-full-chain', 'landing-page', { run: linkedRun });
    const linkedMounted = await mountStep(<WebPageStep {...linkedSetup.props} />);
    try {
      const initialGetCalls = getProjectSpy.mock.calls.length;
      const initialReadCalls = readFileSpy.mock.calls.length;

      const assistBar = linkedMounted.container.querySelector('[data-step-assist="landing-page"]')!;
      const mcpGuideBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('MCP guide'))!;
      await act(async () => { mcpGuideBtn.click(); });
      expect(linkedSetup.mocks.nav.openMcp).toHaveBeenCalledTimes(1);

      const quickToggle = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.includes('Generate media'))!;
      await act(async () => { quickToggle.click(); });

      const quickGen = linkedMounted.container.querySelector('[data-quick-gen="landing-page"]')!;
      expect(quickGen).toBeTruthy();

      const promptInput = quickGen.querySelector<HTMLTextAreaElement>('#quick-gen-prompt-landing-page')!;
      await act(async () => { setFieldValue(promptInput, 'Hero geometric glass banner'); });

      const generateBtn = Array.from(quickGen.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Generate')!;
      await act(async () => {
        generateBtn.click();
        await Promise.resolve();
      });
      expect(linkedSetup.mocks.mutate).toHaveBeenCalledWith(
        'quick-gen:landing-page:image',
        'generate',
        {
          stepId: 'landing-page',
          modality: 'image',
          model: 'fal:flux',
          prompt: 'Hero geometric glass banner',
        },
      );

      getProjectSpy.mockResolvedValueOnce({ project: makeDesignProject(rev2) });
      readFileSpy.mockResolvedValueOnce({
        path: 'index.html',
        content: sampleHtml,
        revision: rev2,
        size: sampleHtml.length,
        nextOffset: null,
      });

      const syncBtn = Array.from(assistBar.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Sync')!;
      await act(async () => {
        syncBtn.click();
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(linkedSetup.mocks.refresh).toHaveBeenCalledTimes(1);
      expect(getProjectSpy.mock.calls.length).toBeGreaterThan(initialGetCalls);
      expect(readFileSpy.mock.calls.length).toBeGreaterThan(initialReadCalls);
      expect(linkedSetup.mocks.showToast).toHaveBeenCalledWith('Synced latest assets', 'info', 'feedback');
    } finally {
      await linkedMounted.unmount();
    }
  });

  it('refreshes revision and surfaces an error toast when auto-embed fails during starter creation', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const createdProject = {
      id: projectId,
      title: 'Black Friday Detail Page',
      revision: 'rev-1',
      entry: 'index.html',
      files: [{ path: 'index.html', bytes: 120 }],
    };
    const refreshedProject = { ...createdProject, revision: 'rev-2' };
    const getProjectSpy = vi.spyOn(designClient, 'getProject').mockResolvedValue({ project: refreshedProject } as any);
    vi.spyOn(designClient, 'readFile').mockResolvedValue({
      path: 'index.html',
      content: '<html><body><section data-om-slot="hero"></section><section data-om-slot="gallery"></section></body></html>',
    } as any);

    const img1 = {
      id: 'aaaa1111-1111-4111-8111-111111111111',
      kind: 'image' as const,
      label: 'Hero 1',
      source: 'generated' as const,
      stepId: 'product-images',
      createdAt: 1700000000000,
      tags: [],
      pinned: true,
      ref: { type: 'asset' as const, assetId: 'asset-1', versionId: 'ver-1' },
    };
    const img2 = {
      id: 'aaaa2222-2222-4222-8222-222222222222',
      kind: 'image' as const,
      label: 'Hero 2',
      source: 'generated' as const,
      stepId: 'product-images',
      createdAt: 1700000001000,
      tags: [],
      pinned: true,
      ref: { type: 'asset' as const, assetId: 'asset-2', versionId: 'ver-2' },
    };
    const run = makeBaseRun('black-friday', {
      pool: [img1, img2],
      steps: {
        'detail-page': {
          bindings: { embedImages: [img1.id, img2.id] },
        },
      },
    });
    const { props, mocks } = createStepProps('black-friday', 'detail-page', { run });
    mocks.mutate.mockImplementation(async (_key: string, command: string) => {
      if (command === 'create_page') return { run, project: createdProject };
      if (command === 'embed_image') throw new Error('DESIGN_CONFLICT');
      return { run };
    });

    const mounted = await mountStep(<WebPageStep {...props} />);
    try {
      const createBtn = Array.from(mounted.container.querySelectorAll('button')).find(b => b.textContent?.includes('Create page'))!;
      await act(async () => {
        createBtn.click();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(getProjectSpy).toHaveBeenCalledWith(projectId);
      expect(mocks.showToast).toHaveBeenCalledWith(
        'Starter page created, but 2 attached image(s) could not be embedded.',
        'error',
        'feedback',
      );
    } finally {
      await mounted.unmount();
    }
  });
});
