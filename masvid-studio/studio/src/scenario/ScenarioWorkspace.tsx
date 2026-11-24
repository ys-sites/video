import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { localizedScenarioMediaLabel } from '../../../shared/scenario-media-names';
import {
  scenarioConcisePrompt,
  findScenarioStep,
  scenarioCategories,
  type PoolKind,
  type ScenarioStepDefinition,
  type ScenarioWorkspaceMode,
} from '../../../shared/scenarios';
import type {
  PoolItem,
  PoolRef,
  ScenarioBundleReceipt,
  ScenarioRun,
  ScenarioRunSummary,
  ScenarioStepState,
  StepIteration,
} from '../../../shared/scenario-runs';
import { Popover } from '../components/ui/Popover';
import { Skeleton } from '../components/ui/Skeleton';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useIntegrationInfo } from '../motion/useIntegrationInfo';
import { ScenarioAgentModeView } from './ScenarioAgentModeView';
import { AssetPoolPanel, type PoolPickRequest } from './AssetPoolPanel';
import { IterationHistory } from './IterationHistory';
import { bundleDownloadUrl, scenarioClient } from './scenarioClient';
import { scenarioCover } from './scenarioCovers';
import { ScenarioHeader } from './ScenarioHeader';
import { ScenarioRunHistoryDialog } from './ScenarioRunHistoryDialog';
import { ScenarioStage } from './ScenarioStage';
import { ScenarioStepper } from './ScenarioStepper';
import type { BriefSaveRef, ScenarioWorkspaceProps, StepOutputPanelMeta, StepProps } from './stepContract';
import { resolveStepPrompt } from './StepExportMenu';
import { StepRouter } from './steps/StepRouter';
import { isScenarioConflictError } from './steps/stepUtils';
import { countStepPendingJobs, emptyStepState, useScenarioRun } from './useScenarioRun';
import './scenario.css';

export type { ScenarioWorkspaceProps };

const HIGHLIGHT_DURATION_MS = 1500;
const POOL_WIDTH_STORAGE_KEY = 'opendesign.scenario.poolWidth';
const POOL_COLLAPSED_STORAGE_KEY = 'opendesign.scenario.poolCollapsed';
const WORKBENCH_WIDTH_STORAGE_KEY = 'opendesign.scenario.workbenchWidth';
const DEFAULT_POOL_WIDTH = 320;
const MIN_POOL_WIDTH = 240;
const MAX_POOL_WIDTH = 520;
const POOL_KEYBOARD_STEP = 20;
const DEFAULT_WORKBENCH_WIDTH = 620;
const MIN_WORKBENCH_WIDTH = 380;
const MAX_WORKBENCH_WIDTH = 860;
const WORKBENCH_KEYBOARD_STEP = 24;

function maxPoolWidthFor(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return MAX_POOL_WIDTH;
  }
  return Math.max(MIN_POOL_WIDTH, Math.min(MAX_POOL_WIDTH, Math.floor(containerWidth * 0.45)));
}

function clampPoolWidth(width: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_POOL_WIDTH;
  return Math.max(MIN_POOL_WIDTH, Math.min(maxWidth, Math.round(width)));
}

function readStoredPoolWidth(): number {
  try {
    const raw = localStorage.getItem(POOL_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_POOL_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed)
      ? clampPoolWidth(parsed, MAX_POOL_WIDTH)
      : DEFAULT_POOL_WIDTH;
  } catch {
    return DEFAULT_POOL_WIDTH;
  }
}

function maxWorkbenchWidthFor(containerWidth: number, reservedPoolWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return MAX_WORKBENCH_WIDTH;
  }
  const available = containerWidth - reservedPoolWidth - 280;
  return Math.max(MIN_WORKBENCH_WIDTH, Math.min(MAX_WORKBENCH_WIDTH, Math.floor(available)));
}

function clampWorkbenchWidth(width: number, maxWidth: number): number {
  if (!Number.isFinite(width)) return DEFAULT_WORKBENCH_WIDTH;
  return Math.max(MIN_WORKBENCH_WIDTH, Math.min(maxWidth, Math.round(width)));
}

function readStoredWorkbenchWidth(): number {
  try {
    const raw = localStorage.getItem(WORKBENCH_WIDTH_STORAGE_KEY);
    if (!raw) return DEFAULT_WORKBENCH_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed)
      ? clampWorkbenchWidth(parsed, MAX_WORKBENCH_WIDTH)
      : DEFAULT_WORKBENCH_WIDTH;
  } catch {
    return DEFAULT_WORKBENCH_WIDTH;
  }
}

function readStoredPoolCollapsed(): boolean {
  try {
    return localStorage.getItem(POOL_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function primarySlotForStep(step: ScenarioStepDefinition, kind: PoolKind): string {
  switch (step.type) {
    case 'image':
      return 'references';
    case 'web-page':
      return 'embedImages';
    case 'video':
      return kind === 'audio' ? 'soundtrack' : 'firstFrame';
    case 'audio':
      return 'script';
    case 'social-pack':
      return 'postMedia';
    default:
      return 'inputs';
  }
}

type StepOutputToolbarState = {
  mounted: boolean;
  status?: 'running' | 'failed' | 'ready';
  version?: number;
};

function StepCardPopoverPortal({
  host,
  status,
  version,
  onMetaChange,
  children,
}: {
  host: HTMLElement | null;
  status?: 'running' | 'failed' | 'ready';
  version?: number;
  onMetaChange: (next: StepOutputToolbarState) => void;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    onMetaChange({ mounted: true, status, version });
    return () => onMetaChange({ mounted: false });
  }, [onMetaChange, status, version]);

  if (host) {
    return createPortal(children, host);
  }
  return null;
}

function StepIterationsBridge({
  renderOutput,
  renderOutputRef,
}: {
  renderOutput: (iteration: StepIteration) => ReactNode;
  renderOutputRef: { current: ((iteration: StepIteration) => ReactNode) | null };
}) {
  renderOutputRef.current = renderOutput;
  return null;
}

export function ScenarioWorkspace({
  scenarioId,
  runId,
  stepId,
  mode: routedMode,
  active,
  onRoute,
  onExplore,
  onOpenHub,
  breadcrumb,
  onOpenDesignProject,
  onOpenMotionProject,
  onOpenModelHub,
  onOpenBlackFriday,
  onOpenTemplateLibrary,
  onOpenStudioScene,
  onOpenProviders,
  onOpenMcp,
}: ScenarioWorkspaceProps) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { info: integration } = useIntegrationInfo();

  const [activeMode, setActiveMode] = useState<ScenarioWorkspaceMode>(routedMode ?? 'manual');
  const [poolOpen, setPoolOpen] = useState(false);

  useEffect(() => {
    setActiveMode(routedMode ?? 'manual');
  }, [routedMode]);
  const [exportingBundle, setExportingBundle] = useState(false);
  const [poolWidth, setPoolWidth] = useState<number>(readStoredPoolWidth);
  const [poolCollapsed, setPoolCollapsed] = useState<boolean>(readStoredPoolCollapsed);
  const [resizingPool, setResizingPool] = useState(false);
  const [workbenchWidth, setWorkbenchWidth] = useState<number>(readStoredWorkbenchWidth);
  const [resizingWorkbench, setResizingWorkbench] = useState(false);
  const [cardCoverFailed, setCardCoverFailed] = useState(false);
  const [containerWidth, setContainerWidth] = useState<number>(() =>
    typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
      ? window.innerWidth
      : 1280,
  );
  const [highlightedIds, setHighlightedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [scenarioRuns, setScenarioRuns] = useState<ScenarioRunSummary[]>([]);
  const [hasMoreScenarioRuns, setHasMoreScenarioRuns] = useState(false);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runHistoryOpen, setRunHistoryOpen] = useState(false);
  const [pickRequest, setPickRequest] = useState<PoolPickRequest | null>(null);
  const [outputHost, setOutputHost] = useState<HTMLDivElement | null>(null);
  const [outputPopoverOpen, setOutputPopoverOpen] = useState(false);
  const [outputMeta, setOutputMeta] = useState<StepOutputToolbarState>({ mounted: false });
  const [historyPopoverOpen, setHistoryPopoverOpen] = useState(false);
  const [capabilityHost, setCapabilityHost] = useState<HTMLDivElement | null>(null);
  const [capabilityPopoverOpen, setCapabilityPopoverOpen] = useState(false);
  const [capabilityMounted, setCapabilityMounted] = useState(false);

  const iterationsRenderOutputRef = useRef<((iteration: StepIteration) => ReactNode) | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const poolDragRef = useRef<{ x: number; width: number } | null>(null);
  const latestDragWidthRef = useRef<number>(poolWidth);
  const workbenchDragRef = useRef<{ x: number; width: number } | null>(null);
  const latestWorkbenchDragWidthRef = useRef<number>(workbenchWidth);
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const pickResolveRef = useRef<((ids: string[] | null) => void) | null>(null);

  const finishPick = useCallback((ids: string[] | null) => {
    const resolve = pickResolveRef.current;
    if (!resolve) return;
    pickResolveRef.current = null;
    setPickRequest(null);
    setPoolOpen(false);
    resolve(ids);
  }, []);

  const handleCancelPick = useCallback(() => finishPick(null), [finishPick]);

  const handlePoolOpenChange = useCallback((open: boolean) => {
    setPoolOpen(open);
    if (!open) handleCancelPick();
  }, [handleCancelPick]);

  const togglePoolOpen = useCallback(() => handlePoolOpenChange(!poolOpen), [handlePoolOpenChange, poolOpen]);

  useEffect(() => {
    setCardCoverFailed(false);
  }, [scenarioId]);

  useEffect(() => {
    const node = workspaceRef.current;
    if (!node) return;
    const measure = () => {
      const rectWidth = node.getBoundingClientRect().width;
      const nextWidth =
        rectWidth > 0
          ? rectWidth
          : typeof window !== 'undefined' && Number.isFinite(window.innerWidth) && window.innerWidth > 0
            ? window.innerWidth
            : 0;
      if (nextWidth > 0) {
        setContainerWidth(nextWidth);
      }
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const maxPoolWidth = useMemo(() => maxPoolWidthFor(containerWidth), [containerWidth]);
  const effectivePoolWidth = useMemo(
    () => clampPoolWidth(poolWidth, maxPoolWidth),
    [maxPoolWidth, poolWidth],
  );

  const reservedPoolWidth = !poolCollapsed && containerWidth >= 1100 ? effectivePoolWidth + 12 : 0;
  const maxWorkbenchWidth = useMemo(
    () => maxWorkbenchWidthFor(containerWidth, reservedPoolWidth),
    [containerWidth, reservedPoolWidth],
  );
  const effectiveWorkbenchWidth = useMemo(
    () => clampWorkbenchWidth(workbenchWidth, maxWorkbenchWidth),
    [maxWorkbenchWidth, workbenchWidth],
  );

  const persistPoolWidth = useCallback((width: number) => {
    try {
      localStorage.setItem(POOL_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Ignore storage errors (e.g., private browsing or disabled storage).
    }
  }, []);

  const commitPoolWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampPoolWidth(nextWidth, maxPoolWidth);
      setPoolWidth(clamped);
      latestDragWidthRef.current = clamped;
      persistPoolWidth(clamped);
    },
    [maxPoolWidth, persistPoolWidth],
  );

  const persistWorkbenchWidth = useCallback((width: number) => {
    try {
      localStorage.setItem(WORKBENCH_WIDTH_STORAGE_KEY, String(width));
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const commitWorkbenchWidth = useCallback(
    (nextWidth: number) => {
      const clamped = clampWorkbenchWidth(nextWidth, maxWorkbenchWidth);
      setWorkbenchWidth(clamped);
      latestWorkbenchDragWidthRef.current = clamped;
      persistWorkbenchWidth(clamped);
    },
    [maxWorkbenchWidth, persistWorkbenchWidth],
  );

  const finishWorkbenchResize = useCallback(() => {
    if (!workbenchDragRef.current) return;
    workbenchDragRef.current = null;
    setResizingWorkbench(false);
    persistWorkbenchWidth(latestWorkbenchDragWidthRef.current);
  }, [persistWorkbenchWidth]);

  const updatePoolCollapsed = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setPoolCollapsed(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      try {
        localStorage.setItem(POOL_COLLAPSED_STORAGE_KEY, resolved ? 'true' : 'false');
      } catch {
        // Ignore storage errors.
      }
      return resolved;
    });
  }, []);

  const togglePoolCollapsed = useCallback(() => {
    if (!poolCollapsed) handlePoolOpenChange(false);
    updatePoolCollapsed(!poolCollapsed);
  }, [handlePoolOpenChange, poolCollapsed, updatePoolCollapsed]);

  const finishPoolResize = useCallback(() => {
    if (!poolDragRef.current) return;
    poolDragRef.current = null;
    setResizingPool(false);
    persistPoolWidth(latestDragWidthRef.current);
  }, [persistPoolWidth]);

  const highlight = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    setHighlightedIds(prev => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    for (const id of ids) {
      const existing = highlightTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        highlightTimersRef.current.delete(id);
        setHighlightedIds(prev => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, HIGHLIGHT_DURATION_MS);
      highlightTimersRef.current.set(id, timer);
    }
  }, []);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pickResolveRef.current?.(null);
      pickResolveRef.current = null;
    };
  }, []);

  const handleRunCreated = useCallback(
    (createdRunId: string, replace = true) => {
      onRoute({ run: createdRunId }, replace);
    },
    [onRoute],
  );

  const briefSaveRef: BriefSaveRef = useRef(null);
  const validateNextRef = useRef<(() => boolean) | null>(null);
  const runState = useScenarioRun({
    scenarioId,
    runId,
    active,
    locale,
    t,
    onRunCreated: handleRunCreated,
    onToast: toast.showToast,
    onNewPoolItems: highlight,
    briefSaveRef,
  });

  const { scenario, run, loading, error, busy, ensureRun, mutate, refresh, startNewRun, reload } = runState;

  const activeStep = useMemo(
    () =>
      findScenarioStep(scenario, stepId) ??
      findScenarioStep(scenario, run?.activeStepId) ??
      scenario.steps[0],
    [run?.activeStepId, scenario, stepId],
  );

  const activeStepIndex = useMemo(
    () => Math.max(0, scenario.steps.findIndex(step => step.id === activeStep.id)),
    [activeStep.id, scenario.steps],
  );

  const activeStepState: ScenarioStepState = useMemo(
    () => run?.steps[activeStep.id] ?? emptyStepState(activeStep),
    [activeStep, run],
  );

  // A pick only belongs to the active step in the current draft and mode.
  useEffect(() => {
    if (pickResolveRef.current) handleCancelPick();
  }, [active, activeMode, activeStep.id, handleCancelPick, runId, scenarioId]);

  // Close per-workflow run history modal when switching to another workflow.
  useEffect(() => {
    setRunHistoryOpen(false);
  }, [scenarioId]);

  const poolItems = useMemo(() => run?.pool.map(item => {
    const label = localizedScenarioMediaLabel(item, run, scenario, locale);
    return label === item.label ? item : { ...item, label };
  }) ?? [], [locale, run, scenario]);
  const poolById = useMemo(
    () => new Map(poolItems.map(item => [item.id, item])),
    [poolItems],
  );

  const selectStep = useCallback(
    async (nextStepId: string) => {
      const leavingBrief = activeMode === 'manual' && activeStep.type === 'brief' && nextStepId !== activeStep.id;
      try {
        const savedRunId = leavingBrief && scenario.id === 'motion-full-chain' ? await briefSaveRef.current?.() : undefined;
        onRoute({ run: savedRunId ?? run?.id ?? runId, step: nextStepId }, false);
      } catch (error) {
        if (!isScenarioConflictError(error)) toast.showToast(t('Could not save edits.'), 'error', 'feedback');
      }
    },
    [activeMode, activeStep.id, activeStep.type, briefSaveRef, onRoute, run?.id, runId, scenario.id, t, toast],
  );

  const handleModeChange = useCallback(
    (next: ScenarioWorkspaceMode) => {
      setActiveMode(next);
      onRoute(
        {
          run: run?.id ?? runId,
          step: next === 'manual' ? activeStep.id : null,
          mode: next,
        },
        false,
      );
    },
    [activeStep.id, onRoute, run?.id, runId],
  );

  const handleOpenStepInManual = useCallback(
    (targetStepId: string) => {
      setActiveMode('manual');
      onRoute(
        {
          run: run?.id ?? runId,
          step: targetStepId,
          mode: 'manual',
        },
        false,
      );
    },
    [onRoute, run?.id, runId],
  );

  const loadScenarioRuns = useCallback(() => {
    setRunsLoading(true);
    void scenarioClient
      .list({ scenarioId, limit: 20 })
      .then(res => {
        setScenarioRuns(res.runs ?? []);
        setHasMoreScenarioRuns(res.nextOffset !== null && res.nextOffset !== undefined);
      })
      .catch(() => {})
      .finally(() => setRunsLoading(false));
  }, [scenarioId]);

  const handleSelectRun = useCallback(
    (selectedRunId: string) => {
      onRoute({ run: selectedRunId, step: null }, false);
    },
    [onRoute],
  );

  const handleNewRun = useCallback(async () => {
    try {
      await startNewRun();
      toast.showToast(t('Started a new draft'), 'info', 'feedback');
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not start a new draft'),
          'error',
          'feedback',
        );
      }
    }
  }, [startNewRun, t, toast]);

  const handleRenameRun = useCallback(
    async (title: string) => {
      try {
        await mutate('rename-run', 'update_run', { changes: { title } });
        toast.showToast(t('Draft renamed'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not rename draft'),
            'error',
            'feedback',
          );
        }
      }
    },
    [mutate, t, toast],
  );

  const handleArchiveRun = useCallback(async () => {
    try {
      await mutate('archive-run', 'update_run', { changes: { archived: true } });
      toast.showToast(t('Draft archived'), 'info', 'feedback');
      onOpenHub();
    } catch (err) {
      if (!isScenarioConflictError(err)) {
        toast.showToast(
          err instanceof Error ? err.message : t('Could not archive draft'),
          'error',
          'feedback',
        );
      }
    }
  }, [mutate, onOpenHub, t, toast]);

  const copyToClipboard = useCallback(
    async (text: string, successMessage: string) => {
      try {
        await navigator.clipboard.writeText(text);
        toast.showToast(successMessage, 'info', 'feedback');
      } catch {
        toast.showToast(
          t('Could not copy. Select and copy the text manually.'),
          'error',
          'feedback',
        );
      }
    },
    [t, toast],
  );

  const handleCopyAgentPrompt = useCallback(
    async (customPrompt?: string) => {
      let ensuredRun: ScenarioRun | null = null;
      try {
        ensuredRun = await ensureRun();
      } catch {
        ensuredRun = run;
      }
      const promptRun =
        ensuredRun && customPrompt !== undefined
          ? {
              ...ensuredRun,
              brief: {
                ...ensuredRun.brief,
                idea: customPrompt,
              },
            }
          : ensuredRun;
      const prompt = scenarioConcisePrompt(scenario, promptRun, {
        customPrompt,
        locale,
        integration,
      });
      await copyToClipboard(prompt, t('Copied. Paste into your Agent.'));
    },
    [copyToClipboard, ensureRun, integration, locale, run, scenario, t],
  );

  const handleCopyAgentHandoff = useCallback(
    () => handleCopyAgentPrompt(),
    [handleCopyAgentPrompt],
  );

  const handleExportBundle = useCallback(
    async (options?: {
      poolItemIds?: string[];
      activeOnly?: boolean;
      includeStandaloneHtml?: boolean;
      includeMotionSource?: boolean;
    }): Promise<ScenarioBundleReceipt | null> => {
      if (exportingBundle) return null;
      setExportingBundle(true);
      try {
        const res = await mutate<{ bundle: ScenarioBundleReceipt }>(
          `export-bundle:${Date.now()}`,
          'export',
          {
            locale,
            activeOnly: options?.activeOnly ?? false,
            includeStandaloneHtml: options?.includeStandaloneHtml ?? true,
            includeMotionSource: options?.includeMotionSource ?? false,
            ...(options?.poolItemIds?.length ? { poolItemIds: options.poolItemIds } : {}),
          },
        );
        const downloadUrl = bundleDownloadUrl(res.bundle.bundleId);
        const triggerDownload = () => {
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = res.bundle.filename;
          document.body.appendChild(link);
          link.click();
          link.remove();
        };
        triggerDownload();
        toast.showToast(
          t('Export ready'),
          'info',
          'feedback',
          {
            key: `download-${res.bundle.bundleId}`,
            label: t('Download'),
            onClick: triggerDownload,
          },
        );
        return res.bundle;
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not build export ZIP'),
            'error',
            'feedback',
          );
        }
        return null;
      } finally {
        setExportingBundle(false);
      }
    },
    [exportingBundle, locale, mutate, t, toast],
  );

  const handleCopySummaryJson = useCallback(async () => {
    const payload = {
      scenarioId: scenario.id,
      runId: run?.id ?? null,
      revision: run?.revision ?? null,
      title: run?.title ?? scenario.title,
      brief: run?.brief ?? {},
      steps: scenario.steps.map(stepDef => ({
        id: stepDef.id,
        title: stepDef.title,
        status: run?.steps[stepDef.id]?.status ?? 'todo',
        activeIterationId: run?.steps[stepDef.id]?.activeIterationId ?? null,
        links: run?.steps[stepDef.id]?.links ?? {},
      })),
      sharedAssets: (run?.pool ?? []).map(item => ({
        id: item.id,
        kind: item.kind,
        label: item.label,
        stepId: item.stepId,
        pinned: item.pinned,
        ref: item.ref,
      })),
    };
    await copyToClipboard(JSON.stringify(payload, null, 2), t('Summary JSON copied'));
  }, [copyToClipboard, run, scenario, t]);

  const requestPick = useCallback(
    (opts: PoolPickRequest): Promise<string[] | null> => {
      pickResolveRef.current?.(null);
      setPoolOpen(true);
      updatePoolCollapsed(false);
      return new Promise<string[] | null>(resolve => {
        pickResolveRef.current = resolve;
        setPickRequest(opts);
      });
    },
    [updatePoolCollapsed],
  );

  const handleAddPoolItems = useCallback(
    async (
      items: {
        ref: PoolRef;
        label?: string;
        tags?: string[];
        stepId?: string | null;
        source: PoolItem['source'];
      }[],
    ): Promise<string[]> => {
      const res = await mutate<{ run: typeof run; poolItemIds: string[] }>(
        `add-pool:${Date.now()}`,
        'add_pool',
        { items },
      );
      if (res.poolItemIds?.length) {
        highlight(res.poolItemIds);
      }
      return res.poolItemIds ?? [];
    },
    [highlight, mutate],
  );

  const handleUpdatePoolItem = useCallback(
    async (
      poolItemId: string,
      changes: { label?: string; tags?: string[]; pinned?: boolean },
    ) => {
      await mutate(`update-pool:${poolItemId}`, 'update_pool', {
        poolItemId,
        changes,
      });
    },
    [mutate],
  );

  const handleRemovePoolItem = useCallback(
    async (poolItemId: string) => {
      await mutate(`remove-pool:${poolItemId}`, 'remove_pool', { poolItemId });
    },
    [mutate],
  );

  const handleUseInCurrentStep = useCallback(
    async (item: PoolItem) => {
      const slot = primarySlotForStep(activeStep, item.kind);
      const existing = activeStepState.bindings[slot] ?? [];
      const nextIds =
        slot === 'firstFrame' || slot === 'script'
          ? [item.id]
          : existing.includes(item.id)
            ? existing
            : [...existing, item.id];

      try {
        await mutate(`bind:${activeStep.id}:${slot}`, 'update_step', {
          stepId: activeStep.id,
          bindings: { [slot]: nextIds },
        });
        toast.showToast(
          t('Added to {step}', { step: t(activeStep.title) }),
          'info',
          'feedback',
        );
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not bind asset to step'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep, activeStepState.bindings, mutate, t, toast],
  );

  const handleRefresh = useCallback(async () => {
    await refresh();
    toast.showToast(t('Synced latest assets'), 'info', 'feedback');
  }, [refresh, t, toast]);

  const handlePromoteIteration = useCallback(
    async (iterationId: string) => {
      try {
        await mutate(`promote:${activeStep.id}:${iterationId}`, 'promote', {
          stepId: activeStep.id,
          iterationId,
        });
        toast.showToast(t('Active version updated'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not update active version'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleUseIterationSettings = useCallback(
    async (iteration: StepIteration) => {
      try {
        const nextDraft: Record<string, unknown> = {
          ...(iteration.settings ?? {}),
          ...(iteration.prompt !== undefined ? { prompt: iteration.prompt, promptEdited: true } : {}),
        };
        await mutate(`use-settings:${activeStep.id}:${iteration.id}`, 'update_step', {
          stepId: activeStep.id,
          draft: nextDraft,
        });
        toast.showToast(t('Loaded version settings into form'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not apply version settings'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleSaveIterationNote = useCallback(
    async (iterationId: string, note: string) => {
      try {
        await mutate(`note:${activeStep.id}:${iterationId}`, 'update_step', {
          stepId: activeStep.id,
          iterationNote: { iterationId, note },
        });
        toast.showToast(t('Note saved'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not save note'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const handleRetryIteration = useCallback(
    async (iteration: StepIteration) => {
      if (!iteration.job) return;
      const settings = iteration.settings ?? {};
      const prompt = iteration.prompt ?? resolveStepPrompt(activeStepState);
      try {
        await mutate(`retry:${activeStep.id}:${iteration.id}:${Date.now()}`, 'generate', {
          stepId: activeStep.id,
          modality: iteration.job.modality,
          model: iteration.job.model,
          prompt,
          ...(typeof settings.mode === 'string' ? { mode: settings.mode } : {}),
          ...(settings.parameters && typeof settings.parameters === 'object'
            ? { parameters: settings.parameters }
            : {}),
          ...(typeof settings.scene === 'string' ? { scene: settings.scene } : {}),
          ...(iteration.inputs.length > 0 ? { referencePoolItemIds: iteration.inputs } : {}),
        });
        toast.showToast(t('Generation started'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not retry generation'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, activeStepState, mutate, t, toast],
  );

  const handleCancelIteration = useCallback(
    async (iterationId: string) => {
      try {
        await mutate(`cancel:${activeStep.id}:${iterationId}`, 'cancel', {
          stepId: activeStep.id,
          iterationId,
        });
        toast.showToast(t('Generation cancelled'), 'info', 'feedback');
      } catch (err) {
        if (!isScenarioConflictError(err)) {
          toast.showToast(
            err instanceof Error ? err.message : t('Could not cancel generation'),
            'error',
            'feedback',
          );
        }
      }
    },
    [activeStep.id, mutate, t, toast],
  );

  const renderExportMenu = useCallback(() => null, []);

  const updateOutputMeta = useCallback((next: StepOutputToolbarState) => {
    setOutputMeta(prev =>
      prev.mounted === next.mounted && prev.status === next.status && prev.version === next.version
        ? prev
        : next,
    );
  }, []);

  const updateCapabilityMeta = useCallback((next: StepOutputToolbarState) => {
    setCapabilityMounted(prev => (prev === next.mounted ? prev : next.mounted));
  }, []);

  const renderIterations = useCallback(
    ({ renderOutput }: { renderOutput(iteration: StepIteration): ReactNode }) => (
      <StepIterationsBridge
        renderOutput={renderOutput}
        renderOutputRef={iterationsRenderOutputRef}
      />
    ),
    [],
  );

  const renderOutputPanel = useCallback(
    (content: ReactNode, meta?: StepOutputPanelMeta) => (
      <StepCardPopoverPortal
        host={outputHost}
        status={meta?.status}
        version={meta?.version}
        onMetaChange={updateOutputMeta}
      >
        {content}
      </StepCardPopoverPortal>
    ),
    [outputHost, updateOutputMeta],
  );

  const renderCapabilityBar = useCallback(
    (content: ReactNode) => (
      <StepCardPopoverPortal
        host={capabilityHost}
        onMetaChange={updateCapabilityMeta}
      >
        {content}
      </StepCardPopoverPortal>
    ),
    [capabilityHost, updateCapabilityMeta],
  );

  const stepApi = useMemo(
    () => ({ ensureRun, mutate, refresh, busy }),
    [busy, ensureRun, mutate, refresh],
  );

  const stepPool = useMemo(
    () => ({ items: poolItems, byId: poolById, requestPick, highlight }),
    [highlight, poolById, poolItems, requestPick],
  );

  const stepToast = useMemo(
    () => ({ showToast: toast.showToast }),
    [toast.showToast],
  );

  const stepNav = useMemo(
    () => ({
      openDesignProject: onOpenDesignProject,
      openMotionProject: onOpenMotionProject,
      openModelHub: onOpenModelHub,
      openBlackFriday: onOpenBlackFriday,
      openTemplateLibrary: onOpenTemplateLibrary,
      openStudioScene: onOpenStudioScene,
      openProviders: onOpenProviders,
      selectStep,
      openMcp: onOpenMcp,
    }),
    [
      onOpenBlackFriday,
      onOpenDesignProject,
      onOpenMcp,
      onOpenModelHub,
      onOpenMotionProject,
      onOpenProviders,
      onOpenStudioScene,
      onOpenTemplateLibrary,
      selectStep,
    ],
  );

  const stepProps: StepProps = {
    scenario,
    step: activeStep,
    state: activeStepState,
    run,
    active,
    api: stepApi,
    pool: stepPool,
    toast: stepToast,
    briefSaveRef,
    nav: stepNav,
    validateNextRef,
    renderExportMenu,
    renderIterations,
    renderOutputPanel,
    renderCapabilityBar,
  };

  useEffect(() => {
    setOutputPopoverOpen(false);
    setHistoryPopoverOpen(false);
    setCapabilityPopoverOpen(false);
  }, [activeStep.id]);

  const stepPendingJobs = useMemo(
    () => countStepPendingJobs(activeStepState),
    [activeStepState],
  );
  const stepVersionsCount = activeStepState.iterations.length;

  const prevStep = activeStepIndex > 0 ? scenario.steps[activeStepIndex - 1] : null;
  const nextStep =
    activeStepIndex < scenario.steps.length - 1 ? scenario.steps[activeStepIndex + 1] : null;
  const category = useMemo(
    () => scenarioCategories.find(item => item.id === scenario.category) ?? null,
    [scenario.category],
  );

  const handleOpenAssets = useCallback(() => {
    const isNarrow =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(max-width: 1099px)').matches;
    if (isNarrow) togglePoolOpen();
    else togglePoolCollapsed();
  }, [togglePoolCollapsed, togglePoolOpen]);

  const loadingStateNode = (
    <div className="om-scenario-loading" role="status" aria-label={t('Loading workflow…')}>
      <Skeleton className="om-scenario-skeleton-title" />
      <Skeleton className="om-scenario-skeleton-card" />
      <Skeleton className="om-scenario-skeleton-card" />
    </div>
  );

  const errorStateNode = error ? (
    <div className="om-scenario-error-panel" role="alert">
      <RemixIcon name="error-warning-line" size={28} />
      <h2 className="om-subtitle">{t('Could not load workflow')}</h2>
      <p className="om-muted">{error}</p>
      <div className="om-scenario-error-actions">
        <Button variant="primary" size="sm" onClick={reload}>
          {t('Retry')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void handleNewRun()}>
          {t('New draft')}
        </Button>
      </div>
    </div>
  ) : null;

  const cardCoverSrc = scenarioCover(scenario.id);

  return (
    <section
      ref={workspaceRef}
      className="om-scenario-workspace"
      style={
        {
          '--om-scenario-pool-width': `${effectivePoolWidth}px`,
          '--om-scenario-workbench-width': `${effectiveWorkbenchWidth}px`,
        } as CSSProperties
      }
      data-scenario-workspace={scenario.id}
      data-run-id={run?.id ?? runId ?? ''}
      data-step-id={activeStep.id}
      data-scenario-mode={activeMode}
      data-active={active ? 'true' : 'false'}
      aria-label={t(scenario.title)}
    >
      <ScenarioHeader
        scenario={scenario}
        run={run}
        runs={scenarioRuns}
        hasMoreRuns={hasMoreScenarioRuns}
        runsLoading={runsLoading}
        onLoadRuns={loadScenarioRuns}
        onSelectRun={handleSelectRun}
        onOpenRunHistory={() => setRunHistoryOpen(true)}
        onNewRun={() => void handleNewRun()}
        onRenameRun={handleRenameRun}
        onArchiveRun={handleArchiveRun}
        onExplore={onExplore}
        onOpenHub={onOpenHub}
        breadcrumb={breadcrumb}
        mode={activeMode}
        onModeChange={handleModeChange}
        poolOpen={poolOpen}
        poolCollapsed={poolCollapsed}
        poolCount={poolItems.length}
        onTogglePool={togglePoolOpen}
        onTogglePoolCollapsed={togglePoolCollapsed}
        onCopyAgentHandoff={() => void handleCopyAgentHandoff()}
        onExportBundle={() => void handleExportBundle()}
        exporting={exportingBundle}
        busy={busy}
      />

      <div
        className="om-scenario-body"
        data-mode={activeMode}
        data-pool-collapsed={activeMode === 'agent' ? 'true' : poolCollapsed ? 'true' : 'false'}
        data-resizing-pool={activeMode === 'manual' && (resizingPool || resizingWorkbench) ? 'true' : undefined}
      >
        {activeMode === 'agent' ? (
          loading ? (
            <div className="om-agent-mode-state">{loadingStateNode}</div>
          ) : errorStateNode ? (
            <div className="om-agent-mode-state">{errorStateNode}</div>
          ) : (
            <ScenarioAgentModeView
              scenario={scenario}
              run={run}
              activeStep={activeStep}
              api={stepApi}
              briefSaveRef={briefSaveRef}
              integration={integration}
              toast={stepToast}
              poolItems={poolItems}
              highlightedIds={highlightedIds}
              onRefresh={handleRefresh}
              onAddPoolItems={handleAddPoolItems}
              onUpdatePoolItem={handleUpdatePoolItem}
              onRemovePoolItem={handleRemovePoolItem}
              onOpenDesignProject={onOpenDesignProject}
              onOpenMotionProject={onOpenMotionProject}
              onExportBundle={handleExportBundle}
              exportingBundle={exportingBundle}
              onCopySummaryJson={handleCopySummaryJson}
              onCopyAgentPrompt={handleCopyAgentPrompt}
              onOpenMcp={onOpenMcp}
              onOpenStep={handleOpenStepInManual}
              onSwitchToManual={() => handleModeChange('manual')}
            />
          )
        ) : (
          <>
        <ScenarioStage
          scenario={scenario}
          run={run}
          activeStep={activeStep}
          active={active}
          poolItems={poolItems}
          onSelectStep={selectStep}
          onOpenAssets={handleOpenAssets}
          onUseInStep={handleUseInCurrentStep}
          onOpenDesignProject={onOpenDesignProject}
          onOpenMotionProject={onOpenMotionProject}
        />

        <div
          className="om-scenario-workbench-resizer"
          role="separator"
          tabIndex={0}
          aria-label={t('Resize step panel')}
          aria-orientation="vertical"
          aria-valuemin={MIN_WORKBENCH_WIDTH}
          aria-valuemax={maxWorkbenchWidth}
          aria-valuenow={effectiveWorkbenchWidth}
          data-dragging={resizingWorkbench ? 'true' : undefined}
          onDoubleClick={() => commitWorkbenchWidth(DEFAULT_WORKBENCH_WIDTH)}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              commitWorkbenchWidth(effectiveWorkbenchWidth + WORKBENCH_KEYBOARD_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              commitWorkbenchWidth(effectiveWorkbenchWidth - WORKBENCH_KEYBOARD_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              commitWorkbenchWidth(maxWorkbenchWidth);
            } else if (event.key === 'End') {
              event.preventDefault();
              commitWorkbenchWidth(MIN_WORKBENCH_WIDTH);
            }
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            workbenchDragRef.current = { x: event.clientX, width: effectiveWorkbenchWidth };
            latestWorkbenchDragWidthRef.current = effectiveWorkbenchWidth;
            setResizingWorkbench(true);
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              // Ignore if synthetic pointer events do not register an active pointer id.
            }
          }}
          onPointerMove={event => {
            const drag = workbenchDragRef.current;
            if (!drag) return;
            const next = clampWorkbenchWidth(drag.width + (drag.x - event.clientX), maxWorkbenchWidth);
            latestWorkbenchDragWidthRef.current = next;
            setWorkbenchWidth(next);
          }}
          onPointerUp={finishWorkbenchResize}
          onPointerCancel={finishWorkbenchResize}
          onLostPointerCapture={finishWorkbenchResize}
        />

        <main className="om-scenario-workbench" data-step-type={activeStep.type}>
          <div className="om-scenario-card-top">
            <header className="om-scenario-card-identity">
              <span
                className="om-scenario-workflow-badge"
                data-category={scenario.category}
                data-has-cover={cardCoverSrc && !cardCoverFailed ? 'true' : undefined}
                aria-hidden="true"
              >
                {cardCoverSrc && !cardCoverFailed ? (
                  <img
                    src={cardCoverSrc}
                    alt=""
                    draggable={false}
                    onError={() => setCardCoverFailed(true)}
                  />
                ) : (
                  <RemixIcon name={scenario.icon} size={19} />
                )}
              </span>
              <div className="om-scenario-card-identity-copy">
                <div className="om-scenario-card-identity-row">
                  <h1 className="om-scenario-card-workflow-title">{t(scenario.title)}</h1>
                  {category && (
                    <span
                      className="om-badge om-scenario-header-category"
                      data-category={scenario.category}
                    >
                      <RemixIcon name={category.icon} size={11} />
                      <span>{t(category.label)}</span>
                    </span>
                  )}
                </div>
                <p className="om-scenario-card-workflow-subtitle">{t(scenario.subtitle)}</p>
              </div>

              {!loading && !error && (
                <div className="om-scenario-card-tools" role="toolbar" aria-label={t(activeStep.title)}>
                  <Popover
                    keepMounted
                    align="end"
                    open={outputPopoverOpen}
                    onOpenChange={setOutputPopoverOpen}
                    aria-label={t('Active result')}
                    tooltip={
                      outputMeta.version
                        ? t('Output · v{number}', { number: outputMeta.version })
                        : t('Active result')
                    }
                    className="om-scenario-card-popover om-scenario-output-popover"
                    trigger={
                      <IconButton
                        variant={outputPopoverOpen ? 'secondary' : 'ghost'}
                        size="sm"
                        type="button"
                        hidden={!outputMeta.mounted}
                        className="om-scenario-card-tool-btn"
                        data-card-tool="output"
                        data-tool-status={outputMeta.status}
                        aria-label={
                          outputMeta.version
                            ? t('Output · v{number}', { number: outputMeta.version })
                            : t('Active result')
                        }
                        aria-pressed={outputPopoverOpen}
                        icon={
                          <RemixIcon
                            name={
                              outputMeta.status === 'running'
                                ? 'loader-4-line'
                                : outputMeta.status === 'failed'
                                  ? 'error-warning-line'
                                  : 'sparkling-line'
                            }
                            size={15}
                            className={outputMeta.status === 'running' ? 'om-scenario-spin' : undefined}
                          />
                        }
                      />
                    }
                  >
                    <div ref={setOutputHost} className="om-scenario-card-popover-body" />
                  </Popover>

                  <Popover
                    align="end"
                    open={historyPopoverOpen}
                    onOpenChange={setHistoryPopoverOpen}
                    aria-label={t('Version history')}
                    tooltip={
                      stepVersionsCount > 0
                        ? `${t('Version history')} (${stepVersionsCount})`
                        : t('Version history')
                    }
                    className="om-scenario-card-popover om-scenario-history-popover"
                    trigger={
                      stepVersionsCount > 0 ? (
                        <Button
                          variant={historyPopoverOpen ? 'secondary' : 'ghost'}
                          size="sm"
                          type="button"
                          className="om-scenario-card-tool-btn om-scenario-card-tool-btn--count"
                          data-card-tool="history"
                          aria-label={t('Version history')}
                          aria-pressed={historyPopoverOpen}
                          icon={<RemixIcon name="history-line" size={14} />}
                        >
                          <span className="om-scenario-card-tool-count">
                            {stepVersionsCount > 99 ? '99+' : stepVersionsCount}
                          </span>
                        </Button>
                      ) : (
                        <IconButton
                          variant={historyPopoverOpen ? 'secondary' : 'ghost'}
                          size="sm"
                          type="button"
                          className="om-scenario-card-tool-btn"
                          data-card-tool="history"
                          aria-label={t('Version history')}
                          aria-pressed={historyPopoverOpen}
                          icon={<RemixIcon name="history-line" size={15} />}
                        />
                      )
                    }
                  >
                    <div className="om-scenario-card-popover-body">
                      {stepVersionsCount > 0 ? (
                        <IterationHistory
                          embedded
                          step={activeStep}
                          state={activeStepState}
                          briefFields={activeStep.type === 'brief' ? scenario.briefFields : undefined}
                          renderOutput={iteration =>
                            iterationsRenderOutputRef.current?.(iteration) ?? null
                          }
                          onPromote={handlePromoteIteration}
                          onUseSettings={handleUseIterationSettings}
                          onSaveNote={handleSaveIterationNote}
                          onRetry={handleRetryIteration}
                          onCancel={handleCancelIteration}
                          busy={busy}
                        />
                      ) : (
                        <div className="om-scenario-card-popover-empty">
                          <RemixIcon name="history-line" size={18} />
                          <strong>{t('Version history')}</strong>
                          <p className="om-muted">{t('No outputs')}</p>
                        </div>
                      )}
                    </div>
                  </Popover>

                  <Popover
                    keepMounted
                    align="end"
                    open={capabilityPopoverOpen}
                    onOpenChange={setCapabilityPopoverOpen}
                    aria-label={t('Agent tools')}
                    tooltip={t('Agent tools')}
                    className="om-scenario-card-popover om-scenario-capability-popover"
                    trigger={
                      <IconButton
                        variant={capabilityPopoverOpen ? 'secondary' : 'ghost'}
                        size="sm"
                        type="button"
                        hidden={!capabilityMounted}
                        className="om-scenario-card-tool-btn"
                        data-card-tool="agent"
                        data-tool-status={stepPendingJobs > 0 ? 'running' : undefined}
                        aria-label={t('Agent tools')}
                        aria-pressed={capabilityPopoverOpen}
                        icon={<RemixIcon name="robot-line" size={15} />}
                      />
                    }
                  >
                    <div ref={setCapabilityHost} className="om-scenario-card-popover-body" />
                  </Popover>
                </div>
              )}
            </header>

            <ScenarioStepper
              scenario={scenario}
              run={run}
              activeStepId={activeStep.id}
              onSelectStep={selectStep}
            />
          </div>

          <div className="om-scenario-step-scroll">
            {loading ? (
              loadingStateNode
            ) : errorStateNode ? (
              errorStateNode
            ) : (
              <div key={activeStep.id} className="om-scenario-step-frame" data-step-frame={activeStep.id}>
                <header className="om-scenario-step-header">
                  <div className="om-scenario-step-header-row">
                    <div className="om-scenario-step-title-line">
                      <span
                        className="om-scenario-step-badge-icon"
                        data-step-type={activeStep.type}
                        aria-hidden="true"
                      >
                        <RemixIcon name={activeStep.icon} size={15} />
                      </span>
                      <h2 className="om-scenario-step-title">{t(activeStep.title)}</h2>
                      {activeStep.optional && (
                        <span className="om-badge">{t('Optional')}</span>
                      )}
                    </div>
                  </div>
                  <p className="om-scenario-step-hint">{t(activeStep.hint)}</p>
                </header>

                <div className="om-scenario-step-content">
                  <StepRouter {...stepProps} />
                </div>
              </div>
            )}
          </div>

          {!loading && !error && (
            <div className="om-scenario-card-footer">
              <div className="om-scenario-card-meta">
                <div className="om-scenario-card-meta-group">
                  <span className="om-scenario-card-meta-item">
                    <RemixIcon name="time-line" size={14} />
                    <span>
                      {t('Step {current} / {total}', {
                        current: activeStepIndex + 1,
                        total: scenario.steps.length,
                      })}
                    </span>
                  </span>
                  {category && (
                    <>
                      <span className="om-scenario-card-meta-dot" aria-hidden="true">·</span>
                      <span className="om-scenario-card-meta-item">
                        <RemixIcon name={category.icon} size={14} />
                        <span>{t(category.label)}</span>
                      </span>
                    </>
                  )}
                </div>
                <Button
                  variant="plain"
                  type="button"
                  className="om-scenario-card-meta-item om-scenario-card-meta-btn"
                  onClick={handleOpenAssets}
                >
                  <RemixIcon name="stack-line" size={14} />
                  <span>{t('Assets ({count})', { count: poolItems.length })}</span>
                </Button>
              </div>

              <footer className="om-scenario-step-footer">
                {prevStep && (
                  <IconButton
                    variant="secondary"
                    size="lg"
                    type="button"
                    className="om-scenario-prev-cta"
                    aria-label={t('Previous: {step}', { step: t(prevStep.title) })}
                    title={t('Previous: {step}', { step: t(prevStep.title) })}
                    icon={<RemixIcon name="arrow-left-line" size={16} />}
                    onClick={() => selectStep(prevStep.id)}
                  />
                )}
                {nextStep ? (
                  <Button
                    variant="primary"
                    size="lg"
                    type="button"
                    className="om-scenario-primary-cta"
                    icon={<RemixIcon name={nextStep.icon} size={15} />}
                    onClick={() => {
                      if (validateNextRef.current?.() !== false) void selectStep(nextStep.id);
                    }}
                  >
                    <span>{t('Next: {step}', { step: t(nextStep.title) })}</span>
                    <RemixIcon name="arrow-right-line" size={15} />
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    type="button"
                    className="om-scenario-primary-cta"
                    loading={exportingBundle}
                    icon={<RemixIcon name="download-2-line" size={15} />}
                    onClick={() => void handleExportBundle()}
                  >
                    {t('Export all')}
                  </Button>
                )}
              </footer>
            </div>
          )}
        </main>

        <div
          className="om-scenario-pool-resizer"
          role="separator"
          tabIndex={0}
          aria-label={t('Resize assets panel')}
          aria-orientation="vertical"
          aria-valuemin={MIN_POOL_WIDTH}
          aria-valuemax={maxPoolWidth}
          aria-valuenow={effectivePoolWidth}
          data-dragging={resizingPool ? 'true' : undefined}
          hidden={poolCollapsed}
          onDoubleClick={() => commitPoolWidth(DEFAULT_POOL_WIDTH)}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              commitPoolWidth(effectivePoolWidth + POOL_KEYBOARD_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              commitPoolWidth(effectivePoolWidth - POOL_KEYBOARD_STEP);
            } else if (event.key === 'Home') {
              event.preventDefault();
              commitPoolWidth(maxPoolWidth);
            } else if (event.key === 'End') {
              event.preventDefault();
              commitPoolWidth(MIN_POOL_WIDTH);
            }
          }}
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            poolDragRef.current = { x: event.clientX, width: effectivePoolWidth };
            latestDragWidthRef.current = effectivePoolWidth;
            setResizingPool(true);
            try {
              event.currentTarget.setPointerCapture?.(event.pointerId);
            } catch {
              // Ignore if synthetic pointer events do not register an active pointer id.
            }
          }}
          onPointerMove={event => {
            const drag = poolDragRef.current;
            if (!drag) return;
            const next = clampPoolWidth(drag.width + (drag.x - event.clientX), maxPoolWidth);
            latestDragWidthRef.current = next;
            setPoolWidth(next);
          }}
          onPointerUp={finishPoolResize}
          onPointerCancel={finishPoolResize}
          onLostPointerCapture={finishPoolResize}
        />

        <AssetPoolPanel
          scenario={scenario}
          run={run}
          currentStep={activeStep}
          items={poolItems}
          highlightedIds={highlightedIds}
          open={poolOpen}
          onOpenChange={handlePoolOpenChange}
          collapsed={poolCollapsed}
          onToggleCollapsed={togglePoolCollapsed}
          onRefresh={handleRefresh}
          pickRequest={pickRequest}
          onConfirmPick={finishPick}
          onCancelPick={handleCancelPick}
          onAddItems={handleAddPoolItems}
          onUpdateItem={handleUpdatePoolItem}
          onRemoveItem={handleRemovePoolItem}
          onUseInCurrentStep={handleUseInCurrentStep}
          onOpenDesignProject={onOpenDesignProject}
          onOpenMotionProject={onOpenMotionProject}
          onExportBundle={handleExportBundle}
          exportingBundle={exportingBundle}
          onCopySummaryJson={handleCopySummaryJson}
          toast={stepToast}
        />
          </>
        )}
      </div>

      <ScenarioRunHistoryDialog
        scenario={scenario}
        open={runHistoryOpen}
        onOpenChange={setRunHistoryOpen}
        activeRunId={run?.id ?? runId ?? null}
        onSelectRun={handleSelectRun}
        onNewRun={handleNewRun}
        onHistoryMutated={loadScenarioRuns}
        onActiveRunChanged={(action, _updatedRunId, nextFallbackId) => {
          if (action === 'renamed') {
            void refresh();
          } else if (action === 'archived') {
            setRunHistoryOpen(false);
            if (nextFallbackId) {
              onRoute({ run: nextFallbackId, step: null }, false);
            } else {
              onOpenHub();
            }
          }
        }}
        toast={stepToast}
      />

      <StudioToastViewport {...toast} />
    </section>
  );
}
