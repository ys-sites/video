import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  findScenario,
  scenarioDefinitions,
  type ScenarioDefinition,
  type ScenarioId,
  type ScenarioStepDefinition,
} from '../../../shared/scenarios';
import type {
  ScenarioCommand,
  ScenarioRun,
  ScenarioStepState,
} from '../../../shared/scenario-runs';
import { ScenarioApiError, scenarioClient, scenarioRequest } from './scenarioClient';
import type { BriefSaveRef, ScenarioRunApi } from './stepContract';
import type { useToast } from '../hooks/useToast';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 2500;

const COMMANDS_WITHOUT_REVISION = new Set<ScenarioCommand>([
  'catalog',
  'list',
  'get',
  'create',
  'sync',
  'export',
]);

export function makeScenarioRequestId(prefix = 'sc'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`.slice(0, 96);
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 96);
}

export function countPendingJobs(run: ScenarioRun | null): number {
  if (!run) return 0;
  let total = 0;
  for (const step of Object.values(run.steps)) {
    for (const iteration of step.iterations) {
      if (iteration.job && (iteration.job.state === 'queued' || iteration.job.state === 'running')) {
        total += 1;
      }
    }
  }
  return total;
}

export function countStepPendingJobs(state: ScenarioStepState | undefined): number {
  if (!state) return 0;
  let total = 0;
  for (const iteration of state.iterations) {
    if (iteration.job && (iteration.job.state === 'queued' || iteration.job.state === 'running')) {
      total += 1;
    }
  }
  return total;
}

export function emptyStepState(step: ScenarioStepDefinition): ScenarioStepState {
  return {
    stepId: step.id,
    status: step.type === 'brief' ? 'in-progress' : 'todo',
    iterations: [],
    activeIterationId: null,
    bindings: {},
    draft: {},
    links: {},
  };
}

export type UseScenarioRunOptions = {
  scenarioId: ScenarioId;
  runId: string | null;
  active: boolean;
  locale: string;
  t: (message: string, values?: Record<string, string | number>) => string;
  onRunCreated: (runId: string, replace?: boolean) => void;
  onToast: Pick<ReturnType<typeof useToast>, 'showToast'>['showToast'];
  onNewPoolItems?: (ids: string[]) => void;
  briefSaveRef?: BriefSaveRef;
};

export type UseScenarioRunResult = ScenarioRunApi & {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  loading: boolean;
  error: string | null;
  pendingJobs: number;
  startNewRun: () => Promise<ScenarioRun>;
  reload: () => void;
};

function stableArgsSignature(command: ScenarioCommand, args: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(args).sort()) {
    if (key === 'runId' || key === 'expectedRevision' || key === 'requestId') continue;
    filtered[key] = args[key];
  }
  return `${command}:${JSON.stringify(filtered)}`;
}

export function useScenarioRun({
  scenarioId,
  runId,
  active,
  locale,
  t,
  onRunCreated,
  onToast,
  onNewPoolItems,
  briefSaveRef,
}: UseScenarioRunOptions): UseScenarioRunResult {
  const scenario = useMemo(
    () => findScenario(scenarioId) ?? scenarioDefinitions[0],
    [scenarioId],
  );

  const [run, setRunState] = useState<ScenarioRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
  const [reloadToken, setReloadToken] = useState(0);

  const runRef = useRef<ScenarioRun | null>(null);
  const mountedRef = useRef(true);
  const ensurePromiseRef = useRef<Promise<ScenarioRun> | null>(null);
  const newRunPromiseRef = useRef<Promise<ScenarioRun> | null>(null);
  const createRequestIdRef = useRef<string>(makeScenarioRequestId('create'));
  const intentRequestsRef = useRef<Map<string, { requestId: string; signature: string }>>(new Map());
  const busyCountsRef = useRef<Map<string, number>>(new Map());
  const syncInFlightRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<void> | null>(null);

  const onRunCreatedRef = useRef(onRunCreated);
  onRunCreatedRef.current = onRunCreated;
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;
  const onNewPoolItemsRef = useRef(onNewPoolItems);
  onNewPoolItemsRef.current = onNewPoolItems;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyRun = useCallback((next: ScenarioRun | null, detectNewPool = false) => {
    const prev = runRef.current;
    if (detectNewPool && prev && next && prev.id === next.id) {
      const prevIds = new Set(prev.pool.map(item => item.id));
      const added = next.pool.filter(item => !prevIds.has(item.id)).map(item => item.id);
      if (added.length > 0) {
        onNewPoolItemsRef.current?.(added);
      }
    }
    runRef.current = next;
    if (mountedRef.current) {
      setRunState(next);
    }
  }, []);

  const beginBusy = useCallback((intent: string) => {
    const nextCount = (busyCountsRef.current.get(intent) ?? 0) + 1;
    busyCountsRef.current.set(intent, nextCount);
    if (mountedRef.current) {
      setBusy(new Set(busyCountsRef.current.keys()));
    }
  }, []);

  const endBusy = useCallback((intent: string) => {
    const currentCount = busyCountsRef.current.get(intent) ?? 0;
    if (currentCount <= 1) {
      busyCountsRef.current.delete(intent);
    } else {
      busyCountsRef.current.set(intent, currentCount - 1);
    }
    if (mountedRef.current) {
      setBusy(new Set(busyCountsRef.current.keys()));
    }
  }, []);

  // Reset per-scenario draft request state when switching scenarios.
  useEffect(() => {
    createRequestIdRef.current = makeScenarioRequestId('create');
    intentRequestsRef.current.clear();
    ensurePromiseRef.current = null;
  }, [scenarioId]);

  const startNewRun = useCallback((): Promise<ScenarioRun> => {
    if (newRunPromiseRef.current) return newRunPromiseRef.current;
    const intent = 'create-new-run';
    beginBusy(intent);
    const create = async () => {
      await briefSaveRef?.current?.();
      const res = await scenarioClient.create({
        requestId: makeScenarioRequestId('new'),
        scenarioId,
        locale,
      });
      createRequestIdRef.current = makeScenarioRequestId('create');
      intentRequestsRef.current.clear();
      ensurePromiseRef.current = null;
      applyRun(res.run, false);
      setError(null);
      onRunCreatedRef.current(res.run.id, false);
      return res.run;
    };
    newRunPromiseRef.current = create().finally(() => {
      newRunPromiseRef.current = null;
      endBusy(intent);
    });
    return newRunPromiseRef.current;
  }, [applyRun, beginBusy, endBusy, briefSaveRef, locale, scenarioId]);

  const startNewRunRef = useRef(startNewRun);
  startNewRunRef.current = startNewRun;

  // Initial load & runId changes.
  useEffect(() => {
    let cancelled = false;

    // Skip redundant fetch if the requested runId is already loaded for this scenario.
    if (runId && runRef.current && runRef.current.id === runId && runRef.current.scenarioId === scenarioId && reloadToken === 0) {
      setLoading(false);
      setError(null);
      return;
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        if (runId) {
          const res = await scenarioClient.get(runId);
          if (cancelled) return;
          applyRun(res.run, false);
          setLoading(false);
          return;
        }

        // No runId: check latest non-archived run within 14 days.
        const listed = await scenarioClient.list({ scenarioId, limit: 1 });
        if (cancelled) return;
        const latest = listed.runs[0];
        if (latest && latest.archivedAt === null && Date.now() - latest.updatedAt <= FOURTEEN_DAYS_MS) {
          const res = await scenarioClient.get(latest.id);
          if (cancelled) return;
          applyRun(res.run, false);
          setLoading(false);
          onRunCreatedRef.current(res.run.id, true);
          onToastRef.current(
            tRef.current('Resumed your latest draft'),
            'info',
            'feedback',
            {
              key: `scenario-resumed-${res.run.id}`,
              label: tRef.current('New draft'),
              onClick: async () => {
                try {
                  await startNewRunRef.current();
                } catch (error) {
                  if (!(error instanceof ScenarioApiError && error.code === 'SCENARIO_CONFLICT')) {
                    onToastRef.current(tRef.current('Could not start a new draft'), 'error', 'feedback');
                  }
                }
              },
            },
          );
          return;
        }

        // Draft mode: run stays null until first mutation.
        applyRun(null, false);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : tRef.current('Could not load workflow');
        setError(message);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [applyRun, reloadToken, runId, scenarioId]);

  const ensureRun = useCallback(async (): Promise<ScenarioRun> => {
    if (runRef.current && runRef.current.scenarioId === scenarioId) {
      return runRef.current;
    }
    if (ensurePromiseRef.current) {
      return ensurePromiseRef.current;
    }
    const promise = (async () => {
      beginBusy('ensure-run');
      try {
        const res = await scenarioClient.create({
          requestId: createRequestIdRef.current,
          scenarioId,
          locale,
        });
        applyRun(res.run, false);
        onRunCreatedRef.current(res.run.id, true);
        return res.run;
      } finally {
        ensurePromiseRef.current = null;
        endBusy('ensure-run');
      }
    })();
    ensurePromiseRef.current = promise;
    return promise;
  }, [applyRun, beginBusy, endBusy, locale, scenarioId]);

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }
    const current = runRef.current;
    if (!current) return;
    const promise = (async () => {
      try {
        const hasPending = countPendingJobs(current) > 0;
        const res = hasPending ? await scenarioClient.sync(current.id) : await scenarioClient.get(current.id);
        if (!mountedRef.current) return;
        if (runRef.current?.id === res.run.id) {
          applyRun(res.run, true);
        }
      } catch {
        // Background refresh failures stay silent; explicit user actions surface errors.
      } finally {
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = promise;
    return promise;
  }, [applyRun]);

  const mutate = useCallback(
    async <T = { run: ScenarioRun }>(
      intent: string,
      command: ScenarioCommand,
      args: Record<string, unknown> = {},
    ): Promise<T> => {
      beginBusy(intent);
      try {
        const current = await ensureRun();
        const signature = stableArgsSignature(command, args);
        let requestId = typeof args.requestId === 'string' && args.requestId ? args.requestId : '';
        if (!requestId) {
          const existing = intentRequestsRef.current.get(intent);
          if (existing && existing.signature === signature) {
            requestId = existing.requestId;
          } else {
            requestId = makeScenarioRequestId('mut');
            intentRequestsRef.current.set(intent, { requestId, signature });
          }
        }

        const payload: Record<string, unknown> = {
          ...args,
          runId: current.id,
          requestId,
        };
        if (!COMMANDS_WITHOUT_REVISION.has(command) && payload.expectedRevision === undefined) {
          payload.expectedRevision = current.revision;
        }

        const result = await scenarioRequest<T>(command, payload);
        intentRequestsRef.current.delete(intent);
        if (result && typeof result === 'object' && 'run' in result) {
          const nextRun = (result as { run?: ScenarioRun }).run;
          if (nextRun && nextRun.id === current.id && nextRun.id === runRef.current?.id && nextRun.revision >= runRef.current.revision) {
            applyRun(nextRun, true);
          }
        }
        return result;
      } catch (err) {
        if (err instanceof ScenarioApiError && err.code === 'SCENARIO_CONFLICT') {
          const current = runRef.current;
          if (current) {
            try {
              const latest = await scenarioClient.get(current.id);
              if (mountedRef.current && runRef.current?.id === latest.run.id) {
                applyRun(latest.run, true);
              }
            } catch {
              // Ignore secondary refetch error; primary conflict still surfaces.
            }
          }
          onToastRef.current(
            tRef.current('This workflow changed elsewhere. Showing the latest version.'),
            'error',
            'feedback',
          );
        } else if (err instanceof ScenarioApiError && err.code === 'INVALID_ARGUMENT') {
          intentRequestsRef.current.delete(intent);
        }
        throw err;
      } finally {
        endBusy(intent);
      }
    },
    [applyRun, beginBusy, endBusy, ensureRun],
  );

  const pendingJobs = useMemo(() => countPendingJobs(run), [run]);
  const activeRunId = run?.id ?? null;

  // Poll `sync` every 2500ms while pendingJobs > 0, active, and document is visible.
  useEffect(() => {
    if (!active || !activeRunId || pendingJobs <= 0) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const tick = async () => {
      if (cancelled || syncInFlightRef.current || document.visibilityState !== 'visible') return;
      syncInFlightRef.current = true;
      try {
        const res = await scenarioClient.sync(activeRunId);
        if (!cancelled && mountedRef.current && runRef.current?.id === res.run.id) {
          const prev = runRef.current;
          if (
            res.run.revision !== prev.revision ||
            countPendingJobs(res.run) !== countPendingJobs(prev)
          ) {
            applyRun(res.run, true);
          }
        }
      } catch {
        // Keep polling on transient sync error.
      } finally {
        syncInFlightRef.current = false;
      }
    };

    const startPolling = () => {
      if (timer !== null || document.visibilityState !== 'visible') return;
      timer = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void tick();
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [active, activeRunId, applyRun, pendingJobs]);

  // Cross-tab refresh on window focus and tab visibility restore.
  useEffect(() => {
    if (!active || !activeRunId) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && countPendingJobs(runRef.current) === 0) {
        void refresh();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [active, activeRunId, refresh]);

  const reload = useCallback(() => {
    setReloadToken(value => value + 1);
  }, []);

  return {
    scenario,
    run,
    loading,
    error,
    pendingJobs,
    busy,
    ensureRun,
    mutate,
    refresh,
    startNewRun,
    reload,
  };
}
