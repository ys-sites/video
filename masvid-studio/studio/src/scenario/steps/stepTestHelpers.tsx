import { Button } from 'open-design-ui/button';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { vi } from 'vitest';
import type { PoolItem, ScenarioRun, ScenarioStepState } from '../../../../shared/scenario-runs';
import { findScenario, findScenarioStep, type ScenarioId } from '../../../../shared/scenarios';
import { Menu } from '../../components/ui';
import { I18nProvider } from '../../i18n/I18n';
import type { StepProps } from '../stepContract';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function makeBaseStepState(stepId: string, overrides: Partial<ScenarioStepState> = {}): ScenarioStepState {
  return {
    stepId,
    status: 'todo',
    iterations: [],
    activeIterationId: null,
    bindings: {},
    draft: {},
    links: {},
    ...overrides,
  };
}

export function makeBaseRun(
  scenarioId: ScenarioId,
  overrides: {
    brief?: Record<string, string | string[]>;
    pool?: PoolItem[];
    steps?: Record<string, Partial<ScenarioStepState>>;
    revision?: number;
    activeStepId?: string;
  } = {},
): ScenarioRun {
  const scenario = findScenario(scenarioId)!;
  const steps: Record<string, ScenarioStepState> = {};
  for (const def of scenario.steps) {
    steps[def.id] = makeBaseStepState(def.id, overrides.steps?.[def.id]);
  }
  return {
    schemaVersion: 1,
    id: '11111111-1111-4111-8111-111111111111',
    scenarioId,
    title: `${scenario.title} · 2026-11-20`,
    locale: 'en',
    createdAt: 1700000000000,
    updatedAt: 1700000001000,
    archivedAt: null,
    revision: overrides.revision ?? 1,
    brief: overrides.brief ?? {},
    activeStepId: overrides.activeStepId ?? scenario.steps[0].id,
    steps,
    pool: overrides.pool ?? [],
  };
}

export function createStepProps(
  scenarioId: ScenarioId,
  stepId: string,
  options: {
    run?: ScenarioRun | null;
    active?: boolean;
    mutateImpl?: StepProps['api']['mutate'];
    requestPickImpl?: StepProps['pool']['requestPick'];
    busy?: ReadonlySet<string>;
  } = {},
) {
  const scenario = findScenario(scenarioId)!;
  const step = findScenarioStep(scenario, stepId)!;
  const run = options.run === undefined ? makeBaseRun(scenarioId) : options.run;
  const state = run?.steps[stepId] ?? makeBaseStepState(stepId);
  const poolItems = run?.pool ?? [];

  const mutate = vi.fn(
    options.mutateImpl ?? (async () => ({ run: run ?? makeBaseRun(scenarioId) }) as never),
  );
  const ensureRun = vi.fn(async () => run ?? makeBaseRun(scenarioId));
  const refresh = vi.fn(async () => {});
  const requestPick = vi.fn(options.requestPickImpl ?? (async () => null));
  const highlight = vi.fn();
  const showToast = vi.fn(() => 1);

  const nav = {
    openDesignProject: vi.fn(),
    openMotionProject: vi.fn(async () => true),
    openModelHub: vi.fn(),
    openBlackFriday: vi.fn(),
    openTemplateLibrary: vi.fn(),
    openStudioScene: vi.fn(),
    openProviders: vi.fn(),
    selectStep: vi.fn(),
    openMcp: vi.fn(),
  };

  const props: StepProps = {
    scenario,
    step,
    state,
    run,
    active: options.active ?? true,
    api: {
      ensureRun,
      mutate: mutate as StepProps['api']['mutate'],
      refresh,
      busy: options.busy ?? new Set<string>(),
    },
    pool: {
      items: poolItems,
      byId: new Map(poolItems.map(item => [item.id, item])),
      requestPick,
      highlight,
    },
    toast: { showToast },
    nav,
    renderExportMenu: extraItems => (
      <div data-test-export-menu="true">
        <Menu open container={null} trigger={<Button variant="ghost" size="sm">Export</Button>}>
          {extraItems}
        </Menu>
      </div>
    ),
    renderIterations: ({ renderOutput }) => (
      <div data-test-iterations="true">
        {state.iterations.map(iter => (
          <div key={iter.id} data-test-iteration={iter.id}>
            {renderOutput(iter)}
          </div>
        ))}
      </div>
    ),
  };

  return { props, mocks: { mutate, ensureRun, refresh, requestPick, highlight, showToast, nav } };
}

export function setFieldValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function mountStep(node: ReactElement): Promise<{ container: HTMLDivElement; root: Root; rerender: (next: ReactElement) => Promise<void>; unmount: () => Promise<void> }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<I18nProvider initialLocale="en">{node}</I18nProvider>);
  });
  return {
    container,
    root,
    rerender: async (next: ReactElement) => {
      await act(async () => {
        root.render(<I18nProvider initialLocale="en">{next}</I18nProvider>);
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}
