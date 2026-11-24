// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { scenarioCategories, scenarioDefinitions, type ScenarioId } from '../../../shared/scenarios';
import { I18nProvider } from '../i18n/I18n';
import { CreativeNavigation, type CreativeNavigationProps } from './CreativeNavigation';
import { selectMegaMenuRecentRuns } from './ScenarioMegaMenu';

vi.mock('./tracking', () => ({ trackMotion: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/motion-api/phase1/call') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        if (body?.arguments?.action === 'scenario' && body?.arguments?.scenario?.command === 'list') {
          return Response.json({
            runs: [
              {
                id: '11111111-1111-1111-1111-111111111111',
                scenarioId: 'black-friday',
                title: 'Holiday Tote Campaign',
                createdAt: 1000,
                updatedAt: 2000,
                archivedAt: null,
                revision: 2,
                activeStepId: 'product-images',
                poolCount: 3,
                doneSteps: 1,
                pendingJobs: 0,
              },
            ],
            nextOffset: null,
          });
        }
      }
      return Response.json({ models: [], status: { providers: [] } });
    }),
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function baseProps(overrides: Partial<CreativeNavigationProps> = {}): CreativeNavigationProps {
  return {
    onChooseStudio: vi.fn(),
    specialty: null,
    destination: null,
    motionActive: false,
    onNavigate: vi.fn(),
    currentPage: 'explore',
    onOpenPage: vi.fn(),
    trackingPage: 'explore',
    scenarioActive: null,
    onOpenScenario: vi.fn(),
    onOpenScenarioHub: vi.fn(),
    ...overrides,
  };
}

async function renderNav(overrides: Partial<CreativeNavigationProps> = {}) {
  const props = baseProps(overrides);
  await act(async () => {
    root!.render(
      <I18nProvider initialLocale="en">
        <div data-motion-studio="">
          <CreativeNavigation {...props} />
        </div>
      </I18nProvider>,
    );
  });
  return props;
}

it('places Workflows with a New badge directly after Explore, opens a 3-column mega menu with all 5 scenarios and recent runs', async () => {
  const props = await renderNav();
  const slots = [...container.querySelectorAll<HTMLElement>('.om-creative-strip > [data-nav-slot]')];
  const labels = slots.map(slot => {
    const btn = slot.querySelector<HTMLButtonElement>('button:not([aria-expanded])');
    return btn?.getAttribute('aria-label') ?? btn?.textContent?.trim();
  });
  expect(labels[0]).toBe('Explore');
  expect(labels[1]).toBe('Workflows');
  expect(labels[2]).toBe('Image');

  const workflowsBtn = slots[1].querySelector<HTMLButtonElement>('button[aria-label="Workflows"]')!;
  expect(workflowsBtn.querySelector('[data-nav-badge="New"]')?.textContent).toBe('New');
  expect(workflowsBtn.getAttribute('aria-current')).toBeNull();

  // Open mega menu via trigger button.
  const trigger = slots[1].querySelector<HTMLButtonElement>('button[aria-label="Workflows · Topics, campaigns and roles"]')!;
  await act(async () => {
    trigger.click();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  const menu = document.querySelector<HTMLElement>('.om-creative-menu-workflows')!;
  expect(menu).not.toBeNull();
  const columns = [...menu.querySelectorAll<HTMLElement>('.om-scenario-mega-column')];
  expect(columns).toHaveLength(3);
  expect(columns.map(col => col.dataset.scenarioCategory)).toEqual(scenarioCategories.map(c => c.id));
  expect(columns.map(col => col.querySelector('h2')?.textContent)).toEqual(['Topics', 'Campaigns', 'Roles']);

  const tiles = [...menu.querySelectorAll<HTMLButtonElement>('[data-scenario-tile]')];
  expect(tiles).toHaveLength(scenarioDefinitions.length);
  expect(tiles.map(tile => tile.dataset.scenarioTile)).toEqual(scenarioDefinitions.map(s => s.id));

  // Lazy recent run appears in footer and opens with runId.
  const runBtn = menu.querySelector<HTMLButtonElement>('.om-scenario-mega-run')!;
  expect(runBtn).not.toBeNull();
  expect(runBtn.textContent).toContain('Holiday Tote Campaign');
  await act(async () => runBtn.click());
  expect(props.onOpenScenario).toHaveBeenCalledWith('black-friday', '11111111-1111-1111-1111-111111111111');

  // Reopen and click a scenario tile directly.
  await act(async () => trigger.click());
  const designTile = document.querySelector<HTMLButtonElement>('[data-scenario-tile="design-full-chain"]')!;
  await act(async () => designTile.click());
  expect(props.onOpenScenario).toHaveBeenLastCalledWith('design-full-chain', undefined);

  // Reopen and click All workflows footer button.
  await act(async () => trigger.click());
  const allBtn = document.querySelector<HTMLButtonElement>('.om-scenario-mega-all')!;
  expect(allBtn.textContent).toContain('All workflows');
  await act(async () => allBtn.click());
  expect(props.onOpenScenarioHub).toHaveBeenCalledOnce();
});

it('sets aria-current="page" on Workflows for hub and active scenario routes, and highlights the active tile', async () => {
  await renderNav({ currentPage: null, scenarioActive: 'hub' });
  const workflowsBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Workflows"]')!;
  expect(workflowsBtn.getAttribute('aria-current')).toBe('page');

  await renderNav({ currentPage: null, scenarioActive: 'ai-influencer' as ScenarioId });
  expect(container.querySelector<HTMLButtonElement>('button[aria-label="Workflows"]')?.getAttribute('aria-current')).toBe('page');
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Workflows · Topics, campaigns and roles"]')!;
  await act(async () => trigger.click());
  expect(document.querySelector('[data-scenario-tile="ai-influencer"]')?.getAttribute('aria-current')).toBe('page');
  expect(document.querySelector('[data-scenario-tile="black-friday"]')?.getAttribute('aria-current')).toBeNull();
});

it('moves Workflows into the More Studio overflow panel on narrow widths and keeps hub navigation working', async () => {
  const resizeCallbacks: ResizeObserverCallback[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: ResizeObserverCallback) {
        resizeCallbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-nav-slot') || this.querySelector?.('button')?.textContent === 'More Studio') {
      return { width: 120, height: 32, top: 0, left: 0, right: 120, bottom: 32, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    }
    return originalRect.call(this);
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      if (this.classList?.contains('om-creative-navigation')) return 245;
      return 0;
    },
  });

  const props = await renderNav();
  const slots = [...container.querySelectorAll<HTMLElement>('.om-creative-strip > [data-nav-slot]')];
  // With 245px available and 120px per slot + 120px More trigger, only slot 0 (Explore) stays visible; slot 1 (Workflows) overflows.
  expect(slots[0].hasAttribute('data-stowed')).toBe(false);
  expect(slots[1].hasAttribute('data-stowed')).toBe(true);

  const moreBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(btn => btn.textContent?.trim() === 'More Studio')!;
  await act(async () => moreBtn.click());
  const overflowTools = document.querySelector<HTMLElement>('.om-nav-more-tools')!;
  expect(overflowTools).not.toBeNull();
  const overflowWorkflows = overflowTools.querySelector<HTMLButtonElement>('button[aria-label="Workflows"]')!;
  expect(overflowWorkflows).not.toBeNull();
  await act(async () => overflowWorkflows.click());
  expect(props.onOpenScenarioHub).toHaveBeenCalledOnce();
});

it('deduplicates recent runs per sub-workflow and caps the mega-menu recent strip to 3 items with overflow count', () => {
  const mk = (id: string, scenarioId: ScenarioId, title: string, updatedAt: number, archivedAt: number | null = null) => ({
    id,
    scenarioId,
    title,
    createdAt: updatedAt - 1000,
    updatedAt,
    archivedAt,
    revision: 1,
    activeStepId: 'brief',
    poolCount: 0,
    doneSteps: 0,
    pendingJobs: 0,
  });

  const { visible, hiddenCount } = selectMegaMenuRecentRuns([
    mk('r1', 'black-friday', 'Black Friday Latest', 5000),
    mk('r2', 'black-friday', 'Black Friday Older Duplicate', 4500),
    mk('r3', 'motion-full-chain', 'Motion Film Draft', 4000),
    mk('r4', 'design-full-chain', 'Landing Page Draft', 3500),
    mk('r5', 'ai-influencer', 'Creator Episode', 3000),
    mk('r6', 'gemini-4-neon', 'Archived Neon', 2500, 2600),
  ]);

  expect(visible.map(r => r.id)).toEqual(['r1', 'r3', 'r4']);
  expect(hiddenCount).toBe(2);
});
