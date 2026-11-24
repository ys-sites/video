// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ScenarioRun, ScenarioRunSummary, StepIteration } from '../../../shared/scenario-runs';
import { findScenario, scenarioDefinitions, scenarioSkills } from '../../../shared/scenarios';
import { studioScenes } from '../../../shared/studio-catalog';
import { I18nProvider } from '../i18n/I18n';
import { IterationHistory } from './IterationHistory';
import { ScenarioHub } from './ScenarioHub';
import { buildShowcaseSlides } from './ScenarioStage';
import { ScenarioWorkspace } from './ScenarioWorkspace';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const ITER_1 = '22222222-2222-4222-8222-222222222222';
const ITER_2 = '33333333-3333-4333-8333-333333333333';
const ITER_3 = '44444444-4444-4444-8444-444444444444';

function makeRun(overrides: Partial<ScenarioRun> = {}): ScenarioRun {
  const scenario = findScenario('black-friday')!;
  const steps: ScenarioRun['steps'] = {};
  for (const step of scenario.steps) {
    steps[step.id] = {
      stepId: step.id,
      status: step.type === 'brief' ? 'in-progress' : 'todo',
      iterations: [],
      activeIterationId: null,
      bindings: {},
      draft: {},
      links: {},
    };
  }
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: RUN_ID,
    scenarioId: 'black-friday',
    title: 'Holiday tote campaign',
    locale: 'en',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    brief: { productName: 'Holiday Weekender Tote' },
    activeStepId: 'brief',
    steps,
    pool: [],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ScenarioWorkspace', () => {
  it('renders Black Friday steps in order, updates route on stepper click, exports bundle on Export all click, and renders toasts in feedback layer', async () => {
    const run = makeRun();
    const commands: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      commands.push(command);
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      if (command === 'export') {
        expect(body.arguments.scenario.activeOnly).toBe(false);
        expect(body.arguments.scenario.locale).toBe('en');
        return jsonResponse({
          run,
          bundle: {
            bundleId: 'bundle-1',
            filename: 'holiday-tote.zip',
            bytes: 256,
            sha256: 'a'.repeat(64),
            archivePath: '/fixture/data/scenarios/bundles/bundle-1.zip',
            downloadUrl: '/motion-api/scenario/bundle/bundle-1',
            entries: 3,
          },
        });
      }
      return jsonResponse({ run });
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const onRoute = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // All 5 Black Friday steps render in exact order as tabs.
    const tabs = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map(tab => tab.getAttribute('data-tab-id'))).toEqual([
      'brief',
      'product-images',
      'detail-page',
      'sales-film',
      'social',
    ]);

    // Clicking a stepper tab pushes the step patch into the route callback.
    const detailTab = tabs.find(tab => tab.getAttribute('data-tab-id') === 'detail-page')!;
    await act(async () => {
      detailTab.click();
    });
    expect(onRoute).toHaveBeenCalledWith({ run: RUN_ID, step: 'detail-page' }, false);

    // Clicking Export all triggers scenario export and displays Export ready toast.
    const exportCta = container.querySelector<HTMLButtonElement>('.om-scenario-export-cta')!;
    expect(exportCta).toBeTruthy();
    await act(async () => {
      exportCta.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(commands).toContain('export');
    expect(document.querySelector('.motion-feedback-layer [role="status"]')?.textContent).toContain('Export ready');

    // MCP copies the prompt and renders a floating toast in .motion-feedback-layer.
    const copyButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.trim() === 'MCP',
    )!;
    await act(async () => {
      copyButton.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(RUN_ID);
    const feedbackText = Array.from(document.querySelectorAll('.motion-feedback-layer [role="status"]'))
      .map(el => el.textContent)
      .join('\n');
    expect(feedbackText).toContain('Copied. Paste into your Agent.');
  });

  it('validates the image-to-video first frame before Next and lets both asset pickers reopen', async () => {
    const scenario = findScenario('motion-full-chain')!;
    const defaultStep = makeRun().steps.brief;
    const steps = Object.fromEntries(scenario.steps.map(step => [
      step.id, { ...defaultStep, stepId: step.id },
    ]));
    const asset = { source: 'workspace' as const, stepId: null, tags: [], pinned: false, addedAt: 1 };
    let run = makeRun({
      scenarioId: scenario.id, activeStepId: 'motion-film', steps, pool: [
        { ...asset, id: 'image-1', kind: 'image', label: 'Opening shot', ref: { type: 'asset', assetId: 'asset-1', versionId: 'version-1' } },
        { ...asset, id: 'image-2', kind: 'image', label: 'Closing shot', ref: { type: 'asset', assetId: 'asset-2', versionId: 'version-2' } },
        { ...asset, id: 'audio-1', kind: 'audio', label: 'Background music', ref: { type: 'asset', assetId: 'asset-3', versionId: 'version-3' } },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).includes('/motion-api/integration')) return jsonResponse({});
      const args = JSON.parse(String(init?.body ?? '{}')).arguments?.scenario;
      if (args?.command === 'update_step') {
        const current = run.steps[args.stepId];
        run = {
          ...run,
          revision: run.revision + 1,
          steps: {
            ...run.steps,
            [args.stepId]: { ...current, bindings: { ...current.bindings, ...args.bindings } },
          },
        };
      }
      return jsonResponse({ run });
    });
    const onRoute = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId={scenario.id}
            runId={RUN_ID}
            stepId="motion-film"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const firstFrame = container.querySelector<HTMLElement>('[data-slot="firstFrame"]')!;
    const next = container.querySelector<HTMLButtonElement>('.om-scenario-primary-cta')!;
    const error = () => firstFrame.querySelector('[role="alert"]');
    const clickMode = async (sceneId: 'text-to-video' | 'image-to-video') => {
      const label = studioScenes.find(scene => scene.id === sceneId)?.label;
      const mode = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find(button => button.textContent?.trim() === label)!;
      await act(async () => { mode.click(); });
    };
    expect(error()).toBeNull();
    await act(async () => { next.click(); });
    expect(onRoute).not.toHaveBeenCalled();
    expect(error()?.textContent).toBe('Choose a first frame to continue.');
    expect(firstFrame.querySelector('[aria-invalid="true"]')).toBeTruthy();
    expect(document.activeElement).toBe(firstFrame.querySelector('.om-step-binding-pick-btn'));

    await clickMode('text-to-video');
    expect(error()).toBeNull();
    await act(async () => { next.click(); });
    expect(onRoute).toHaveBeenLastCalledWith({ run: RUN_ID, step: 'soundtrack' }, false);
    onRoute.mockClear();

    await clickMode('image-to-video');
    await act(async () => { next.click(); });
    expect(onRoute).not.toHaveBeenCalled();

    for (const [slot, kind, count] of [['firstFrame', 'image', 2], ['soundtrack', 'audio', 1]] as const) {
      const pick = container.querySelector<HTMLButtonElement>(`[data-slot="${slot}"] .om-step-binding-pick-btn`)!;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await act(async () => { pick.click(); });
        const panel = document.querySelector('#om-scenario-pool')!;
        expect(panel.querySelector('.om-scenario-pool-title-group .om-badge')?.textContent?.trim()).toBe(String(count));
        const cards = Array.from(panel.querySelectorAll<HTMLElement>('[data-pool-item]'));
        expect(cards.map(card => card.dataset.kind)).toEqual(Array(count).fill(kind));
        const close = panel.querySelector<HTMLButtonElement>('[aria-label="Close assets"], [aria-label="Collapse assets"]')!;
        await act(async () => { close.click(); });
        expect(pick.disabled).toBe(false);
      }
    }

    const pick = firstFrame.querySelector<HTMLButtonElement>('.om-step-binding-pick-btn')!;
    await act(async () => { pick.click(); });
    const panel = document.querySelector('#om-scenario-pool')!;
    const image = panel.querySelector<HTMLElement>('[data-pool-item] [role="checkbox"]')!;
    await act(async () => { image.click(); });
    const apply = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.textContent?.trim() === 'Use 1 selected')!;
    await act(async () => { apply.click(); });
    expect(firstFrame.querySelector('[data-pool-item-id]')).toBeTruthy();
    expect(error()).toBeNull();
    await act(async () => { next.click(); });
    expect(onRoute).toHaveBeenLastCalledWith({ run: RUN_ID, step: 'soundtrack' }, false);
  });

  it('renders ScenarioHub category tabs and recent runs with resume and archive actions', async () => {
    const summary: ScenarioRunSummary = {
      id: RUN_ID,
      scenarioId: 'black-friday',
      title: 'Holiday tote campaign',
      createdAt: Date.now() - 5000,
      updatedAt: Date.now(),
      archivedAt: null,
      revision: 3,
      activeStepId: 'brief',
      poolCount: 4,
      doneSteps: 2,
      pendingJobs: 0,
    };

    const commands: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      commands.push(command);
      if (command === 'list') return jsonResponse({ runs: [summary], nextOffset: null });
      if (command === 'update_run') return jsonResponse({ run: makeRun({ archivedAt: Date.now() }) });
      return jsonResponse({ error: 'UNSUPPORTED' }, 400);
    });

    const onCategory = vi.fn();
    const onOpenScenario = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioHub
            category={null}
            active
            onCategory={onCategory}
            onOpenScenario={onOpenScenario}
            onExplore={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // All 5 scenarios render when category is null.
    expect(container.querySelectorAll('[data-scenario-card]')).toHaveLength(5);

    // Recent run renders and Resume opens it.
    const row = container.querySelector(`[data-run-row="${RUN_ID}"]`)!;
    expect(row.textContent).toContain('Holiday tote campaign');
    const resumeBtn = Array.from(row.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Resume'),
    )!;
    act(() => {
      resumeBtn.click();
    });
    expect(onOpenScenario).toHaveBeenCalledWith('black-friday', RUN_ID);

    // Archive button archives the draft and removes it from the list.
    const archiveBtn = row.querySelector<HTMLButtonElement>('button[aria-label="Archive draft"]')!;
    await act(async () => {
      archiveBtn.click();
      await Promise.resolve();
    });
    expect(commands).toContain('update_run');
    expect(container.querySelector(`[data-run-row="${RUN_ID}"]`)).toBeNull();
  });

  it('supports newest-first rendering, side-by-side compare, promote, use settings, notes, and retry in IterationHistory', async () => {
    const scenario = findScenario('black-friday')!;
    const step = scenario.steps.find(s => s.id === 'product-images')!;
    const iterations: StepIteration[] = [
      {
        id: ITER_1,
        number: 1,
        createdAt: Date.now() - 60000,
        source: 'generated',
        prompt: 'First prompt',
        settings: { scene: 'text-to-image' },
        inputs: [],
        outputs: [],
      },
      {
        id: ITER_2,
        number: 2,
        createdAt: Date.now() - 30000,
        source: 'generated',
        prompt: 'Second prompt',
        settings: { scene: 'relight' },
        inputs: [],
        outputs: [],
      },
      {
        id: ITER_3,
        number: 3,
        createdAt: Date.now() - 10000,
        source: 'generated',
        prompt: 'Failed prompt',
        inputs: [],
        outputs: [],
        job: {
          jobId: 'job-failed',
          state: 'failed',
          modality: 'image',
          model: 'test-model',
          error: 'Provider timeout',
        },
      },
    ];

    const onPromote = vi.fn().mockResolvedValue(undefined);
    const onUseSettings = vi.fn().mockResolvedValue(undefined);
    const onSaveNote = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);

    // Empty IterationHistory renders nothing until a version exists.
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <IterationHistory
            step={step}
            state={{
              stepId: step.id,
              status: 'todo',
              iterations: [],
              activeIterationId: null,
              bindings: {},
              draft: {},
              links: {},
            }}
            renderOutput={iter => <span>Output #{iter.number}</span>}
            onPromote={onPromote}
            onUseSettings={onUseSettings}
            onSaveNote={onSaveNote}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </I18nProvider>,
      );
    });
    expect(container.querySelector('.om-scenario-history')).toBeNull();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <IterationHistory
            step={step}
            state={{
              stepId: step.id,
              status: 'in-progress',
              iterations,
              activeIterationId: ITER_1,
              bindings: {},
              draft: {},
              links: {},
            }}
            renderOutput={iter => <span>Output #{iter.number}</span>}
            onPromote={onPromote}
            onUseSettings={onUseSettings}
            onSaveNote={onSaveNote}
            onRetry={onRetry}
            onCancel={onCancel}
          />
        </I18nProvider>,
      );
    });

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-iteration-id]'));
    expect(cards.map(card => card.getAttribute('data-iteration-id'))).toEqual([ITER_3, ITER_2, ITER_1]);

    // Retry failed job.
    const retryBtn = Array.from(cards[0].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Retry'),
    )!;
    await act(async () => {
      retryBtn.click();
    });
    expect(onRetry).toHaveBeenCalledWith(iterations[2]);

    // Promote v2.
    const promoteBtn = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Make active'),
    )!;
    await act(async () => {
      promoteBtn.click();
    });
    expect(onPromote).toHaveBeenCalledWith(ITER_2);

    // Use settings on v2.
    const useSettingsBtn = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Use settings'),
    )!;
    await act(async () => {
      useSettingsBtn.click();
    });
    expect(onUseSettings).toHaveBeenCalledWith(iterations[1]);

    // Compare two versions opens the side-by-side comparison panel.
    const compareBtn2 = Array.from(cards[1].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Compare'),
    )!;
    const compareBtn1 = Array.from(cards[2].querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Compare'),
    )!;
    await act(async () => {
      compareBtn2.click();
    });
    await act(async () => {
      compareBtn1.click();
    });
    const comparePanel = container.querySelector('.om-scenario-compare-panel');
    expect(comparePanel?.textContent).toContain('Compare v2 and v1');
  });

  it('shows only changed brief fields in version order and highlights separate edits', async () => {
    const scenario = findScenario('motion-full-chain')!;
    const previous = {
      idea: '片头用红色，中间保留原样，结尾用蓝色。',
      audience: '短视频创作者',
      tone: 'premium',
      concept: '旧主题',
    };
    const latest = {
      idea: '片头用绿色，中间保留原样，结尾用金色。',
      audience: previous.audience,
      tone: 'bold',
      visualStyle: '杂志风',
    };
    const iterations = [previous, latest, latest].map((values, index): StepIteration => ({
      id: [ITER_1, ITER_2, ITER_3][index],
      number: index + 1,
      createdAt: 1700000000000 + index,
      source: 'manual',
      inputs: [],
      outputs: [{ type: 'brief', values }],
    }));
    const onAction = vi.fn(async () => {});
    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <IterationHistory
            step={scenario.steps[0]}
            state={{ ...makeRun().steps.brief, iterations, activeIterationId: ITER_3 }}
            briefFields={scenario.briefFields}
            renderOutput={() => <p>Version preview</p>}
            onPromote={onAction}
            onUseSettings={onAction}
            onSaveNote={onAction}
            onRetry={onAction}
            onCancel={onAction}
          />
        </I18nProvider>,
      );
    });

    const selectCompare = async (id: string) => {
      const button = container.querySelector<HTMLButtonElement>(`[data-iteration-id="${id}"] button[aria-pressed]`)!;
      await act(async () => { button.click(); });
    };
    await selectCompare(ITER_2);
    await selectCompare(ITER_1);
    const panel = container.querySelector<HTMLElement>('.om-scenario-compare-panel')!;
    expect(panel.textContent).toContain('对比版本 1 与版本 2');
    expect(panel.textContent).toContain('有变化的字段（4）');
    expect(panel.textContent).not.toContain('目标受众');
    expect(panel.querySelector('[data-brief-change="idea"] del')?.textContent).toBe('红色');
    expect(Array.from(panel.querySelectorAll('[data-brief-change="idea"] ins'), node => node.textContent)).toEqual(['绿色', '金色']);
    expect(panel.querySelector('[data-brief-change="tone"] del')?.textContent).toBe('高级质感');
    expect(panel.querySelector('[data-brief-change="concept"]')?.textContent).toContain('未设置');
    expect(panel.querySelector('[data-brief-change="visualStyle"] ins')?.textContent).toBe('杂志风');
    expect(container.querySelector('.om-scenario-history-strip')).toBeNull();

    await act(async () => { panel.querySelector('button')!.click(); });
    expect(container.querySelectorAll('[data-iteration-id]')).toHaveLength(3);
    await selectCompare(ITER_3);
    await selectCompare(ITER_2);
    expect(container.querySelector('.om-scenario-compare-panel')?.textContent).toContain('两个版本的字段内容一致。');
  });

  it('supports desktop shared assets separator keyboard & pointer resizing within 240..520, dblclick reset to 320, and localStorage persistence', async () => {
    const run = makeRun();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const workspace = container.querySelector<HTMLElement>('.om-scenario-workspace')!;
    const separator = container.querySelector<HTMLElement>('[role="separator"][aria-label="Resize assets panel"]')!;
    expect(separator).toBeTruthy();
    expect(separator.getAttribute('aria-valuenow')).toBe('320');
    expect(workspace.style.getPropertyValue('--om-scenario-pool-width')).toBe('320px');

    // ArrowLeft widens (+20 -> 340) and persists.
    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('340');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('340');

    // ArrowRight narrows (-20 -> 320), and Home/End clamp to 520 / 240.
    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('320');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('520');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('520');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('520');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('240');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('240');

    await act(async () => {
      separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('240');

    // Double-click resets to 320.
    await act(async () => {
      separator.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('320');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('320');

    // Pointer drag left widens by delta and persists on pointerup.
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 600, pointerId: 1, bubbles: true }));
    });
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointermove', { clientX: 520, pointerId: 1, bubbles: true }));
    });
    await act(async () => {
      separator.dispatchEvent(new PointerEvent('pointerup', { clientX: 520, pointerId: 1, bubbles: true }));
    });
    expect(separator.getAttribute('aria-valuenow')).toBe('400');
    expect(workspace.style.getPropertyValue('--om-scenario-pool-width')).toBe('400px');
    expect(localStorage.getItem('opendesign.scenario.poolWidth')).toBe('400');
  });

  it('supports desktop collapse/reopen toggle persisted in localStorage and auto-expands on requestPick', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    vi.spyOn(window, 'matchMedia').mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const run = makeRun({ activeStepId: 'detail-page' });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      if (url.includes('/motion-api/design')) {
        return jsonResponse({ items: [], nextCursor: null, projects: [] });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="detail-page"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const bodyEl = container.querySelector<HTMLElement>('.om-scenario-body')!;
    const poolAside = container.querySelector<HTMLElement>('#om-scenario-pool')!;
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.getAttribute('data-collapsed')).toBe('false');
    expect(poolAside.getAttribute('aria-hidden')).toBeNull();
    expect(poolAside.hidden).toBe(false);

    // Collapse via panel collapse button.
    const collapseBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse assets"]')!;
    await act(async () => { collapseBtn.click(); });
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('true');
    expect(poolAside.getAttribute('data-collapsed')).toBe('true');
    expect(poolAside.getAttribute('aria-hidden')).toBe('true');
    expect(poolAside.hidden).toBe(true);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('true');

    // Reopen via header toggle button.
    const showBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Show assets (0)"]')!;
    expect(showBtn).toBeTruthy();
    await act(async () => { showBtn.click(); });
    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.getAttribute('data-collapsed')).toBe('false');
    expect(poolAside.getAttribute('aria-hidden')).toBeNull();
    expect(poolAside.hidden).toBe(false);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('false');

    // Collapse again, then trigger requestPick via BindingSlot's Choose assets button -> auto-expands.
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Collapse assets"]')!.click();
    });
    expect(poolAside.hidden).toBe(true);

    const chooseAssetsBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.om-step-binding-slot button')).find(
      btn => btn.textContent?.includes('Choose assets'),
    )!;
    expect(chooseAssetsBtn).toBeTruthy();
    await act(async () => { chooseAssetsBtn.click(); });

    expect(bodyEl.getAttribute('data-pool-collapsed')).toBe('false');
    expect(poolAside.hidden).toBe(false);
    expect(localStorage.getItem('opendesign.scenario.poolCollapsed')).toBe('false');
    expect(poolAside.textContent).toContain('Select assets for embedImages');

    await act(async () => {
      poolAside.querySelector<HTMLButtonElement>('button[aria-label="Collapse assets"]')!.click();
    });
    expect(chooseAssetsBtn.disabled).toBe(false);
    await act(async () => { chooseAssetsBtn.click(); });
    expect(poolAside.hidden).toBe(false);
    expect(poolAside.textContent).toContain('Select assets for embedImages');
  });

  it('renders grouped Saved drafts and Draft actions inside panel Draft Switcher menu with active draft badge', async () => {
    const run = makeRun();
    const otherRunId = '66666666-6666-4666-8666-666666666666';
    const summaries: ScenarioRunSummary[] = [
      {
        id: RUN_ID,
        scenarioId: 'black-friday',
        title: run.title,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        archivedAt: null,
        revision: run.revision,
        activeStepId: 'brief',
        poolCount: 0,
        doneSteps: 0,
        pendingJobs: 0,
      },
      {
        id: otherRunId,
        scenarioId: 'black-friday',
        title: 'Winter Flash Sale',
        createdAt: run.createdAt - 10000,
        updatedAt: run.updatedAt - 5000,
        archivedAt: null,
        revision: 2,
        activeStepId: 'brief',
        poolCount: 2,
        doneSteps: 1,
        pendingJobs: 0,
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') return jsonResponse({ runs: summaries, nextOffset: null });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const switcher = container.querySelector<HTMLButtonElement>('[data-scenario-run-switcher]')!;
    expect(switcher).toBeTruthy();
    expect(switcher.querySelector('.om-scenario-run-button-label')?.textContent).toBe(run.title);
    expect(switcher.querySelector('.om-scenario-run-button-tag')).toBeNull();

    await act(async () => {
      switcher.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    const panel = document.querySelector<HTMLElement>('[data-menu-panel][aria-label="Switch draft"]')!;
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('Saved drafts');
    expect(panel.textContent).toContain('Draft actions');
    expect(panel.textContent).toContain('Winter Flash Sale');
    expect(panel.textContent).toContain('New draft');
    expect(panel.textContent).toContain('Rename draft');
    expect(panel.textContent).toContain('Archive draft');

    const activeRow = panel.querySelector<HTMLElement>('[data-current="true"]')!;
    expect(activeRow).toBeTruthy();
    expect(activeRow.textContent).toContain(run.title);
    expect(activeRow.textContent).toContain('Current draft');
  });

  it('renders the immersive visual preview stage with filmstrip navigation and switches to real workflow assets', async () => {
    const run = makeRun({
      pool: [
        {
          id: 'pool-img-1',
          kind: 'image',
          label: 'Hero Tote Shot',
          stepId: 'product-images',
          source: 'generated',
          addedAt: Date.now() - 1000,
          pinned: false,
          tags: [],
          ref: { type: 'asset', assetId: 'asset-1', versionId: 'v1' },
        },
        {
          id: 'pool-img-2',
          kind: 'image',
          label: 'Studio Detail Shot',
          stepId: 'product-images',
          source: 'generated',
          addedAt: Date.now(),
          pinned: false,
          tags: [],
          ref: { type: 'asset', assetId: 'asset-2', versionId: 'v1' },
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const stage = container.querySelector<HTMLElement>('.om-scenario-stage')!;
    expect(stage).toBeTruthy();
    expect(stage.textContent).toContain('Studio Detail Shot');

    const thumbs = Array.from(stage.querySelectorAll<HTMLButtonElement>('.om-scenario-filmstrip-item'));
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0].getAttribute('data-selected')).toBe('true');

    // Clicking next cycles to the second workflow asset on the stage.
    const nextBtn = stage.querySelector<HTMLButtonElement>('button[aria-label="Next preview"]')!;
    await act(async () => {
      nextBtn.click();
    });
    expect(stage.textContent).toContain('Hero Tote Shot');
    expect(thumbs[1].getAttribute('data-selected')).toBe('true');

    // Pinned creation card footer shows step progress, category, asset count, and bold Next CTA.
    const cardFooter = container.querySelector<HTMLElement>('.om-scenario-card-footer')!;
    expect(cardFooter).toBeTruthy();
    expect(cardFooter.textContent).toContain('Step 1 / 5');
    expect(cardFooter.textContent).toContain('Assets (2)');
    expect(cardFooter.querySelector('.om-scenario-primary-cta')?.textContent).toContain('Next: Product images');
  });

  it('switches from Step by step to Agent mode with inline Assets, composer, Copy for Agent CTA, and Skills workflow', async () => {
    const scenario = findScenario('black-friday')!;
    const run = makeRun({
      pool: [
        {
          id: 'pool-ref-1',
          kind: 'image',
          label: 'Tote Flatlay Reference',
          stepId: 'brief',
          source: 'uploaded',
          addedAt: Date.now(),
          pinned: true,
          tags: [],
          ref: { type: 'asset', assetId: 'asset-ref-1', versionId: 'v1' },
        },
      ],
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      return jsonResponse({ run });
    });

    const onRoute = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            mode="manual"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const manualTab = container.querySelector<HTMLButtonElement>('[data-scenario-mode-tab="manual"]')!;
    const agentTab = container.querySelector<HTMLButtonElement>('[data-scenario-mode-tab="agent"]')!;
    expect(manualTab.getAttribute('aria-pressed')).toBe('true');
    expect(agentTab.getAttribute('aria-pressed')).toBe('false');
    expect(container.querySelector('.om-scenario-workspace')?.getAttribute('data-scenario-mode')).toBe('manual');
    expect(container.querySelector('[role="group"][aria-label="Workflow mode"]')).toBeTruthy();
    expect(container.querySelector('button[aria-label="More workflow actions"]')).toBeTruthy();
    expect(container.querySelector('.om-scenario-desktop-action')).toBeTruthy();

    await act(async () => {
      agentTab.click();
    });

    expect(onRoute).toHaveBeenCalledWith({ run: RUN_ID, step: null, mode: 'agent' }, false);
    expect(container.querySelector('.om-scenario-workspace')?.getAttribute('data-scenario-mode')).toBe('agent');
    expect(agentTab.getAttribute('aria-pressed')).toBe('true');
    // Header Assets toggles and duplicate desktop Copy for Agent CTA are omitted in Agent mode.
    expect(container.querySelector('.om-scenario-pool-desktop-toggle')).toBeNull();
    expect(container.querySelector('.om-scenario-desktop-action')).toBeNull();

    // Manual stage/stepper/sidebar disappear; inline Assets, composer, Copy CTA, and Skills workflow appear.
    expect(container.querySelector('.om-scenario-stage')).toBeNull();
    expect(container.querySelector('#om-scenario-pool.om-scenario-pool--inline')).toBeTruthy();
    expect(container.textContent).toContain('Tote Flatlay Reference');
    const showcaseSection = container.querySelector('[data-agent-section="showcase"]')!;
    expect(showcaseSection).toBeTruthy();
    expect(showcaseSection.querySelector('.om-agent-showcase-cover')).toBeTruthy();
    expect(showcaseSection.querySelectorAll('[data-showcase-step]').length).toBe(scenario.steps.length);
    expect(container.querySelector('[data-agent-section="composer"]')?.textContent).toContain('Input');

    // Clicking an example card expands its inline preview.
    const firstShowcaseCard = showcaseSection.querySelector<HTMLButtonElement>('[data-showcase-step]')!;
    await act(async () => {
      firstShowcaseCard.click();
    });
    expect(showcaseSection.querySelector('.om-agent-showcase-preview')).toBeTruthy();

    const copySection = container.querySelector<HTMLElement>('[data-agent-section="copy-agent"]')!;
    expect(copySection.querySelector('button')?.textContent?.trim()).toBe('MCP');

    const skillsSection = container.querySelector<HTMLElement>('[data-agent-section="skills-workflow"]')!;
    expect(skillsSection.textContent).toContain('Skills workflow');
    for (const step of scenario.steps) {
      expect(skillsSection.textContent).toContain(step.title);
    }
    for (const skill of scenarioSkills(scenario)) {
      expect(skillsSection.textContent).toContain(skill.id);
    }
  });

  it('flushes edited prompt in Agent mode before Copy for Agent and shows floating toast', async () => {
    let currentRun = makeRun();
    const briefUpdates: Record<string, unknown>[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const scenarioArgs = body.arguments?.scenario;
      const command = scenarioArgs?.command;
      if (command === 'get') return jsonResponse({ run: currentRun });
      if (command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      if (command === 'update_brief') {
        briefUpdates.push(scenarioArgs.brief);
        currentRun = {
          ...currentRun,
          brief: scenarioArgs.brief,
          revision: currentRun.revision + 1,
        };
        return jsonResponse({ run: currentRun });
      }
      return jsonResponse({ run: currentRun });
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            mode="agent"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Prompt"]')!;
    expect(textarea).toBeTruthy();
    const setNativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setNativeValue.call(textarea, 'Launch Black Friday cyber tote flash campaign');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const primaryCopyBtn = container.querySelector<HTMLButtonElement>('[data-agent-section="copy-agent"] .om-agent-copy-primary')!;
    await act(async () => {
      primaryCopyBtn.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(briefUpdates.length).toBeGreaterThanOrEqual(1);
    expect(briefUpdates[briefUpdates.length - 1]).toMatchObject({
      idea: 'Launch Black Friday cyber tote flash campaign',
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('workflow: black-friday');
    expect(copied).toContain(RUN_ID);
    expect(copied).toContain('openmotion_get_skill');
    expect(copied).toContain('Launch Black Friday cyber tote flash campaign');

    expect(document.querySelector('.motion-feedback-layer [role="status"]')?.textContent).toContain(
      'Copied. Paste into your Agent.',
    );
  });

  it('waits for Agent edits before creating a draft and keeps the edits available after a save failure', async () => {
    let originalRun = makeRun();
    const newRun = makeRun({ id: ITER_3, title: 'New campaign', brief: {} });
    const onRoute = vi.fn();
    const commands: string[] = [];
    let finishSave: (() => void) | undefined;
    let rejectSave = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const args = JSON.parse(String(init?.body ?? '{}')).arguments?.scenario;
      if (args?.command === 'get') return jsonResponse({ run: originalRun });
      if (args?.command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      if (args?.command === 'update_brief') {
        commands.push('save');
        expect(args.runId).toBe(RUN_ID);
        if (rejectSave) return jsonResponse({ error: 'Save unavailable' }, 500);
        await new Promise<void>(resolve => { finishSave = resolve; });
        originalRun = { ...originalRun, brief: { ...originalRun.brief, ...args.brief }, revision: originalRun.revision + 1 };
        return jsonResponse({ run: originalRun });
      }
      if (args?.command === 'create') {
        commands.push('create');
        return jsonResponse({ run: newRun });
      }
      return jsonResponse({});
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            mode="agent"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
    });

    const product = container.querySelector<HTMLInputElement>('[data-agent-field="productName"] input')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(product, 'Updated Weekender');
      product.dispatchEvent(new Event('input', { bubbles: true }));
    });

    async function clickNewDraft() {
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-scenario-run-switcher]')!.click();
      });
      const newDraft = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.trim() === 'New draft')!;
      await act(async () => { newDraft.click(); });
    }

    await clickNewDraft();
    expect(commands).toEqual(['save']);
    expect(onRoute).not.toHaveBeenCalled();
    expect(product.value).toBe('Updated Weekender');

    rejectSave = false;
    await clickNewDraft();
    expect(commands).toEqual(['save', 'save']);
    expect(onRoute).not.toHaveBeenCalled();
    await act(async () => { finishSave!(); });
    expect(commands).toEqual(['save', 'save', 'create']);
    expect(originalRun.brief.productName).toBe('Updated Weekender');
    expect(product.value).toBe('');
    expect(onRoute).toHaveBeenCalledWith({ run: newRun.id }, false);
  });

  it('opens a specific step in Step by step mode from Skills workflow and toggles Preview prompt', async () => {
    const run = makeRun();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const command = body.arguments?.scenario?.command;
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      return jsonResponse({ run });
    });

    const onRoute = vi.fn();

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            mode="agent"
            active
            onRoute={onRoute}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Toggle Preview prompt open and closed.
    expect(container.querySelector('.om-agent-prompt-preview')).toBeNull();
    const previewToggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Preview prompt'),
    )!;
    await act(async () => {
      previewToggle.click();
    });
    const previewEl = container.querySelector<HTMLElement>('.om-agent-prompt-preview')!;
    expect(previewEl).toBeTruthy();
    expect(previewEl.textContent).toContain('workflow: black-friday');
    expect(previewEl.textContent).toContain(`runId: ${RUN_ID}`);
    expect(previewEl.textContent).toContain('openmotion_get_skill');

    const hideToggle = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Hide prompt'),
    )!;
    await act(async () => {
      hideToggle.click();
    });
    expect(container.querySelector('.om-agent-prompt-preview')).toBeNull();

    // Open Product images in step-by-step mode routes back to manual mode on that step.
    const openStepBtn = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open Product images in step-by-step mode"]',
    )!;
    await act(async () => {
      openStepBtn.click();
    });
    expect(onRoute).toHaveBeenCalledWith({ run: RUN_ID, step: 'product-images', mode: 'manual' }, false);
    expect(container.querySelector('.om-scenario-workspace')?.getAttribute('data-scenario-mode')).toBe('manual');
  });

  it('displays Workflows wording on ScenarioHub and ScenarioCard', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ runs: [], nextOffset: null }),
    );

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioHub
            category={null}
            active
            onCategory={vi.fn()}
            onOpenScenario={vi.fn()}
            onExplore={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('.om-scenario-hub-title')?.textContent).toBe('Workflows');
    expect(container.querySelector('[role="tablist"][aria-label="Workflow categories"]')).toBeTruthy();
    const firstCard = container.querySelector<HTMLElement>('[data-scenario-card]')!;
    expect(firstCard.textContent).toContain('Start workflow');
    expect(firstCard.textContent).toMatch(/\d+ steps · \d+ skills/);
    const topBadge = container.querySelector<HTMLElement>('[data-nav-badge="Top"]')!;
    expect(topBadge.textContent).toBe('Featured');
  });

  it('localizes the Top workflow badge as 精选 instead of 顶部 in zh-CN', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      jsonResponse({ runs: [], nextOffset: null }),
    );

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="zh-CN">
          <ScenarioHub
            category={null}
            active
            onCategory={vi.fn()}
            onOpenScenario={vi.fn()}
            onExplore={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const topBadge = container.querySelector<HTMLElement>('[data-nav-badge="Top"]')!;
    expect(topBadge.textContent).toBe('精选');
  });

  it('caps Draft Switcher to 5 recent runs per workflow and manages active/archived history via ScenarioRunHistoryDialog', async () => {
    const baseNow = Date.now();
    const run = makeRun({ title: 'Black Friday Draft 1' });
    const summaries: ScenarioRunSummary[] = [
      {
        id: RUN_ID,
        scenarioId: 'black-friday',
        title: 'Black Friday Draft 1',
        createdAt: baseNow - 1000,
        updatedAt: baseNow,
        archivedAt: null,
        revision: 1,
        activeStepId: 'brief',
        poolCount: 2,
        doneSteps: 1,
        pendingJobs: 0,
      },
      ...Array.from({ length: 6 }, (_, idx) => ({
        id: `77777777-7777-4777-8777-77777777770${idx + 2}`,
        scenarioId: 'black-friday' as const,
        title: `Black Friday Draft ${idx + 2}`,
        createdAt: baseNow - (idx + 2) * 10000,
        updatedAt: baseNow - (idx + 2) * 5000,
        archivedAt: null,
        revision: 1,
        activeStepId: 'brief',
        poolCount: idx,
        doneSteps: 0,
        pendingJobs: 0,
      })),
      {
        id: '88888888-8888-4888-8888-888888888888',
        scenarioId: 'black-friday',
        title: 'Archived Flash Sale',
        createdAt: baseNow - 90000,
        updatedAt: baseNow - 80000,
        archivedAt: baseNow - 70000,
        revision: 2,
        activeStepId: 'brief',
        poolCount: 1,
        doneSteps: 2,
        pendingJobs: 0,
      },
    ];

    const archivedCalls: { runId: string; archived: boolean }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      const args = body.arguments?.scenario;
      const command = args?.command;
      if (command === 'get') return jsonResponse({ run });
      if (command === 'list') {
        const list = args?.includeArchived
          ? summaries
          : summaries.filter(item => item.archivedAt === null);
        return jsonResponse({ runs: list, nextOffset: null });
      }
      if (command === 'update_run') {
        archivedCalls.push({ runId: args.runId, archived: Boolean(args.changes?.archived) });
        const target = summaries.find(item => item.id === args.runId);
        if (target) {
          target.archivedAt = args.changes?.archived ? Date.now() : null;
          target.revision += 1;
        }
        return jsonResponse({
          run: {
            ...run,
            id: args.runId,
            archivedAt: target?.archivedAt ?? null,
            revision: target?.revision ?? 2,
          },
        });
      }
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="brief"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    // Top-level History button is directly accessible in the header (both modes) and opens the dialog in one click.
    const historyBtn = container.querySelector<HTMLButtonElement>('[data-scenario-history-trigger]')!;
    expect(historyBtn).toBeTruthy();
    expect(historyBtn.textContent).toContain('History');
    await act(async () => {
      historyBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
    });
    expect(document.querySelector<HTMLElement>('[data-scenario-run-history="black-friday"]')).toBeTruthy();
    const closeHistoryBtn = document.querySelector<HTMLButtonElement>(
      '[data-scenario-run-history="black-friday"] button[aria-label="Close"]',
    )!;
    await act(async () => {
      closeHistoryBtn.click();
      await Promise.resolve();
    });

    // Open Draft Switcher -> capped strictly at 5 inline run items + overflow entry.
    const switcher = container.querySelector<HTMLButtonElement>('[data-scenario-run-switcher]')!;
    await act(async () => {
      switcher.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const panel = document.querySelector<HTMLElement>('[data-menu-panel][aria-label="Switch draft"]')!;
    expect(panel.querySelectorAll('.om-scenario-run-item')).toHaveLength(5);
    expect(panel.textContent).toContain('View all run history (+2)');

    // Click Manage run history to open the per-sub-workflow history dialog.
    const manageItem = Array.from(panel.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(el =>
      el.textContent?.includes('Manage run history'),
    )!;
    await act(async () => {
      manageItem.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
    });

    const dialog = document.querySelector<HTMLElement>('[data-scenario-run-history="black-friday"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain('Black Friday Promo Kit · Run history');
    expect(dialog.querySelectorAll('[data-history-run]')).toHaveLength(7);

    // Click "Keep latest 5" -> archives the 2 older non-active drafts cleanly.
    const tidyBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Keep latest 5'),
    )!;
    expect(tidyBtn).toBeTruthy();
    await act(async () => {
      tidyBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      await Promise.resolve();
    });
    expect(archivedCalls.filter(c => c.archived)).toHaveLength(2);
    expect(dialog.querySelectorAll('[data-history-run]')).toHaveLength(5);

    // Switch to Archived tab -> restore an archived draft.
    const archivedTab = Array.from(dialog.querySelectorAll<HTMLElement>('[role="tab"]')).find(tab =>
      tab.textContent?.includes('Archived'),
    )!;
    await act(async () => {
      archivedTab.click();
    });
    expect(dialog.textContent).toContain('Archived Flash Sale');
    const restoreBtn = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(btn =>
      btn.textContent?.includes('Restore'),
    )!;
    await act(async () => {
      restoreBtn.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(archivedCalls.some(c => c.archived === false)).toBe(true);
  });

  it('hosts Output, Version history, and Agent tools in top-right card popovers instead of inline inside step content', async () => {
    const run = makeRun();
    run.steps['product-images'] = {
      stepId: 'product-images',
      status: 'in-progress',
      activeIterationId: ITER_2,
      bindings: {},
      draft: {},
      links: {},
      iterations: [
        {
          id: ITER_1,
          number: 1,
          createdAt: Date.now() - 60_000,
          source: 'generated',
          prompt: 'First studio shot',
          inputs: [],
          outputs: [],
          job: {
            jobId: 'job-1',
            state: 'failed',
            modality: 'image',
            model: 'codex:image-generation',
            error: 'Rate limit reached',
          },
        },
        {
          id: ITER_2,
          number: 2,
          createdAt: Date.now() - 10_000,
          source: 'generated',
          prompt: 'Second studio shot',
          inputs: [],
          outputs: [],
          job: {
            jobId: 'job-2',
            state: 'running',
            modality: 'image',
            model: 'codex:image-generation',
          },
        },
      ],
    };

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/motion-api/integration')) {
        return jsonResponse({ previewUrl: 'http://127.0.0.1:4173', dataDirectory: '/fixture/data' });
      }
      if (url.includes('/motion-api/media')) {
        return jsonResponse({ models: [], status: { providers: [] } });
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      if (body.arguments?.scenario?.command === 'list') {
        return jsonResponse({ runs: [], nextOffset: null });
      }
      return jsonResponse({ run });
    });

    await act(async () => {
      root.render(
        <I18nProvider initialLocale="en">
          <ScenarioWorkspace
            scenarioId="black-friday"
            runId={RUN_ID}
            stepId="product-images"
            active
            onRoute={vi.fn()}
            onExplore={vi.fn()}
            onOpenHub={vi.fn()}
            onOpenDesignProject={vi.fn()}
            onOpenMotionProject={vi.fn().mockResolvedValue(true)}
            onOpenModelHub={vi.fn()}
            onOpenBlackFriday={vi.fn()}
            onOpenTemplateLibrary={vi.fn()}
            onOpenStudioScene={vi.fn()}
            onOpenProviders={vi.fn()}
            onOpenMcp={vi.fn()}
          />
        </I18nProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Main scrolling step content stays clean: no inline Output, Version history, or Agent capability bar.
    const stepContent = container.querySelector('.om-scenario-step-content')!;
    expect(stepContent).toBeTruthy();
    expect(stepContent.textContent).not.toContain('Output · v2');
    expect(stepContent.querySelector('.om-scenario-history')).toBeNull();
    expect(stepContent.querySelector('.om-step-assist')).toBeNull();

    // Top-right card toolbar exposes Output (running), Version history (count 2), and Agent tools.
    const outputBtn = container.querySelector<HTMLButtonElement>('[data-card-tool="output"]')!;
    const historyBtn = container.querySelector<HTMLButtonElement>('[data-card-tool="history"]')!;
    const agentBtn = container.querySelector<HTMLButtonElement>('[data-card-tool="agent"]')!;
    expect(outputBtn).toBeTruthy();
    expect(outputBtn.hidden).toBe(false);
    expect(outputBtn.getAttribute('data-tool-status')).toBe('running');
    expect(historyBtn.querySelector('.om-scenario-card-tool-count')?.textContent).toBe('2');
    expect(agentBtn.hidden).toBe(false);

    // Clicking Output opens its popover with Output · v2.
    await act(async () => {
      outputBtn.click();
    });
    expect(document.querySelector('.om-scenario-output-popover')?.textContent).toContain('Output · v2');

    // Clicking Version history opens the embedded IterationHistory popover showing both v2 and v1.
    await act(async () => {
      historyBtn.click();
    });
    const historyPopover = document.querySelector('.om-scenario-history-popover')!;
    expect(historyPopover.querySelector('.om-scenario-history')).toBeTruthy();
    expect(historyPopover.querySelectorAll('.om-scenario-iter-card')).toHaveLength(2);

    // Clicking Agent tools opens its popover with Copy MCP prompt.
    await act(async () => {
      agentBtn.click();
    });
    expect(document.querySelector('.om-scenario-capability-popover')?.textContent).toContain('Copy MCP prompt');
  });

  it('provides a unique bespoke stage preview poster and matching aspect ratio for every step across all workflows', () => {
    const seenPosters = new Set<string>();
    let totalSteps = 0;

    for (const scenario of scenarioDefinitions) {
      const slides = buildShowcaseSlides(scenario);
      expect(slides).toHaveLength(scenario.steps.length);

      for (const [index, slide] of slides.entries()) {
        const step = scenario.steps[index];
        expect(slide.stepId).toBe(step.id);
        expect(slide.poster).toBeTruthy();
        expect(seenPosters.has(slide.poster)).toBe(false);
        seenPosters.add(slide.poster);

        if (step.type === 'audio') {
          expect(slide.aspect).toBe('square');
        } else if (scenario.id === 'ai-influencer' && step.id === 'talking-video') {
          expect(slide.aspect).toBe('portrait');
        } else {
          expect(slide.aspect).toBe('landscape');
        }
        totalSteps += 1;
      }
    }

    expect(totalSteps).toBe(27);
    expect(seenPosters.size).toBe(27);
  });
});
