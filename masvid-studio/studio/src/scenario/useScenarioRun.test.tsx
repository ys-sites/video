// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import type { ScenarioRun, ScenarioRunSummary } from '../../../shared/scenario-runs';
import { findScenario } from '../../../shared/scenarios';
import {
  useScenarioRun,
  type UseScenarioRunOptions,
  type UseScenarioRunResult,
} from './useScenarioRun';

const RUN_ID_1 = '11111111-1111-4111-8111-111111111111';
const RUN_ID_2 = '22222222-2222-4222-8222-222222222222';
const ITER_ID_1 = '33333333-3333-4333-8333-333333333333';

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
    id: RUN_ID_1,
    scenarioId: 'black-friday',
    title: 'Black Friday e-commerce · 2026-11-20',
    locale: 'en',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    revision: 1,
    brief: {},
    activeStepId: 'brief',
    steps,
    pool: [],
    ...overrides,
  };
}

function makeSummary(run: ScenarioRun, pendingJobs = 0): ScenarioRunSummary {
  return {
    id: run.id,
    scenarioId: run.scenarioId,
    title: run.title,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    archivedAt: run.archivedAt,
    revision: run.revision,
    activeStepId: run.activeStepId,
    poolCount: run.pool.length,
    doneSteps: 0,
    pendingJobs,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parsePhase1Call(init?: RequestInit): { command: string; args: Record<string, unknown> } {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const scenario = body.arguments?.scenario ?? {};
  const { command, ...args } = scenario;
  return { command, args };
}

let container: HTMLDivElement;
let root: Root;

function renderHook(
  props: UseScenarioRunOptions,
  onValue: (value: UseScenarioRunResult) => void,
) {
  function Harness(options: UseScenarioRunOptions) {
    const state = useScenarioRun(options);
    useEffect(() => {
      onValue(state);
    });
    return null;
  }
  act(() => {
    root.render(<Harness {...props} />);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useScenarioRun', () => {
  it('enters draft mode when no recent run exists and lazily creates a run on first mutation', async () => {
    const createdRun = makeRun({ id: RUN_ID_1, revision: 1 });
    const updatedRun = makeRun({ id: RUN_ID_1, revision: 2, brief: { productName: 'Weekender Tote' } });
    const calls: { command: string; args: Record<string, unknown> }[] = [];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      calls.push(parsed);
      if (parsed.command === 'list') return jsonResponse({ runs: [], nextOffset: null });
      if (parsed.command === 'create') return jsonResponse({ run: createdRun });
      if (parsed.command === 'update_brief') return jsonResponse({ run: updatedRun });
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    const onRunCreated = vi.fn();
    const onToast = vi.fn();
    let latest!: UseScenarioRunResult;

    renderHook(
      {
        scenarioId: 'black-friday',
        runId: null,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated,
        onToast,
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(latest.loading).toBe(false);
    expect(latest.run).toBeNull();
    expect(onRunCreated).not.toHaveBeenCalled();

    await act(async () => {
      await latest.mutate('brief', 'update_brief', { brief: { productName: 'Weekender Tote' } });
    });

    expect(calls.map(c => c.command)).toEqual(['list', 'create', 'update_brief']);
    expect(onRunCreated).toHaveBeenCalledWith(RUN_ID_1, true);
    expect(latest.run?.revision).toBe(2);
    expect(calls[2].args.runId).toBe(RUN_ID_1);
    expect(calls[2].args.expectedRevision).toBe(1);
    expect(typeof calls[2].args.requestId).toBe('string');
  });

  it('auto-resumes a recent run updated within 14 days and shows a toast with a New run action', async () => {
    const recentRun = makeRun({ id: RUN_ID_1, updatedAt: Date.now() - 1000 * 60 * 60 });
    const freshRun = makeRun({ id: RUN_ID_2, title: 'Fresh run' });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      if (parsed.command === 'list') {
        return jsonResponse({ runs: [makeSummary(recentRun)], nextOffset: null });
      }
      if (parsed.command === 'get') return jsonResponse({ run: recentRun });
      if (parsed.command === 'create') return jsonResponse({ run: freshRun });
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    const onRunCreated = vi.fn();
    const onToast = vi.fn();
    let latest!: UseScenarioRunResult;

    renderHook(
      {
        scenarioId: 'black-friday',
        runId: null,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated,
        onToast,
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latest.run?.id).toBe(RUN_ID_1);
    expect(onRunCreated).toHaveBeenCalledWith(RUN_ID_1, true);
    expect(onToast).toHaveBeenCalledWith(
      'Resumed your latest draft',
      'info',
      'feedback',
      expect.objectContaining({ label: 'New draft' }),
    );

    // Invoking the toast action starts a brand new run.
    const toastAction = onToast.mock.calls[0][3] as { onClick: () => Promise<void> };
    await act(async () => {
      await toastAction.onClick();
    });
    expect(latest.run?.id).toBe(RUN_ID_2);
    expect(onRunCreated).toHaveBeenLastCalledWith(RUN_ID_2, false);
  });

  it('refetches latest run, shows conflict toast, reuses requestId on retry, and rethrows SCENARIO_CONFLICT', async () => {
    const initialRun = makeRun({ id: RUN_ID_1, revision: 2 });
    const latestRun = makeRun({ id: RUN_ID_1, revision: 4, title: 'Changed elsewhere' });
    const finalRun = makeRun({ id: RUN_ID_1, revision: 5, title: 'My rename' });
    const seenRequestIds: string[] = [];
    let updateAttempts = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      if (parsed.command === 'get') {
        return jsonResponse({ run: updateAttempts === 0 ? initialRun : latestRun });
      }
      if (parsed.command === 'update_run') {
        updateAttempts += 1;
        seenRequestIds.push(String(parsed.args.requestId));
        if (updateAttempts === 1) {
          return jsonResponse(
            { error: 'SCENARIO_CONFLICT: Expected revision 2, currentRevision is 4' },
            400,
          );
        }
        return jsonResponse({ run: finalRun });
      }
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    const onToast = vi.fn();
    let latest!: UseScenarioRunResult;

    renderHook(
      {
        scenarioId: 'black-friday',
        runId: RUN_ID_1,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated: vi.fn(),
        onToast,
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.run?.revision).toBe(2);

    await act(async () => {
      await expect(
        latest.mutate('rename-run', 'update_run', { changes: { title: 'My rename' } }),
      ).rejects.toMatchObject({ code: 'SCENARIO_CONFLICT' });
    });

    expect(onToast).toHaveBeenCalledWith(
      'This workflow changed elsewhere. Showing the latest version.',
      'error',
      'feedback',
    );
    expect(latest.run?.revision).toBe(4);
    expect(latest.run?.title).toBe('Changed elsewhere');

    // Retrying the same intent reuses the exact same requestId with the refreshed revision.
    await act(async () => {
      await latest.mutate('rename-run', 'update_run', { changes: { title: 'My rename' } });
    });
    expect(seenRequestIds).toHaveLength(2);
    expect(seenRequestIds[0]).toBe(seenRequestIds[1]);
    expect(latest.run?.revision).toBe(5);
  });

  it('polls sync every 2500ms while pendingJobs > 0 and stops when hidden or completed', async () => {
    vi.useFakeTimers();

    const runningRun = makeRun({ id: RUN_ID_1, revision: 1 });
    runningRun.steps['product-images'].iterations.push({
      id: ITER_ID_1,
      number: 1,
      createdAt: Date.now(),
      source: 'generated',
      inputs: [],
      outputs: [],
      job: {
        jobId: 'job-1',
        state: 'running',
        modality: 'image',
        model: 'test-model',
      },
    });

    const completedRun = makeRun({ id: RUN_ID_1, revision: 2 });
    completedRun.steps['product-images'].iterations.push({
      id: ITER_ID_1,
      number: 1,
      createdAt: Date.now(),
      source: 'generated',
      inputs: [],
      outputs: [],
      job: {
        jobId: 'job-1',
        state: 'completed',
        modality: 'image',
        model: 'test-model',
      },
    });

    let syncCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      if (parsed.command === 'get') return jsonResponse({ run: runningRun });
      if (parsed.command === 'sync') {
        syncCount += 1;
        return jsonResponse({ run: syncCount >= 2 ? completedRun : runningRun });
      }
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    let latest!: UseScenarioRunResult;
    renderHook(
      {
        scenarioId: 'black-friday',
        runId: RUN_ID_1,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated: vi.fn(),
        onToast: vi.fn(),
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.pendingJobs).toBe(1);

    // First interval tick polls sync.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(syncCount).toBe(1);

    // Hide document: polling pauses.
    visibility = 'hidden';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(syncCount).toBe(1);

    // Become visible again: immediate sync completes the job and stops polling.
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(syncCount).toBe(2);
    expect(latest.pendingJobs).toBe(0);

    // Further timer ticks do not poll anymore.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(syncCount).toBe(2);
  });

  it('refreshes the active run when the window regains focus', async () => {
    const rev1 = makeRun({ id: RUN_ID_1, revision: 1, title: 'Tab 1' });
    const rev2 = makeRun({ id: RUN_ID_1, revision: 2, title: 'Updated in Tab 2' });
    let getCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      if (parsed.command === 'get') {
        getCount += 1;
        return jsonResponse({ run: getCount === 1 ? rev1 : rev2 });
      }
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });

    let latest!: UseScenarioRunResult;
    renderHook(
      {
        scenarioId: 'black-friday',
        runId: RUN_ID_1,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated: vi.fn(),
        onToast: vi.fn(),
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.run?.title).toBe('Tab 1');

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.run?.title).toBe('Updated in Tab 2');
    expect(getCount).toBe(2);
  });

  it('refreshes the active run when visibilitychange restores visible state without pending jobs', async () => {
    const rev1 = makeRun({ id: RUN_ID_1, revision: 1, title: 'Initial title' });
    const rev2 = makeRun({ id: RUN_ID_1, revision: 2, title: 'Updated while hidden' });
    let getCount = 0;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const parsed = parsePhase1Call(init);
      if (parsed.command === 'get') {
        getCount += 1;
        return jsonResponse({ run: getCount === 1 ? rev1 : rev2 });
      }
      return jsonResponse({ error: 'UNSUPPORTED: unexpected' }, 400);
    });

    let visibility: DocumentVisibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });

    let latest!: UseScenarioRunResult;
    renderHook(
      {
        scenarioId: 'black-friday',
        runId: RUN_ID_1,
        active: true,
        locale: 'en',
        t: msg => msg,
        onRunCreated: vi.fn(),
        onToast: vi.fn(),
      },
      value => {
        latest = value;
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(latest.run?.title).toBe('Initial title');
    expect(getCount).toBe(1);

    // Becoming hidden should not trigger a refresh.
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(getCount).toBe(1);

    // Becoming visible again refreshes the run via scenarioClient.get.
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCount).toBe(2);
    expect(latest.run?.title).toBe('Updated while hidden');
  });
});
