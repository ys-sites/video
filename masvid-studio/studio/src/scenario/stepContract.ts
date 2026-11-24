import type { ReactNode, RefObject } from 'react';
import type {
  PoolItem,
  ScenarioCommand,
  ScenarioRun,
  ScenarioStepState,
  StepIteration,
} from '../../../shared/scenario-runs';
import type {
  PoolKind,
  ScenarioDefinition,
  ScenarioId,
  ScenarioStepDefinition,
  ScenarioWorkspaceMode,
} from '../../../shared/scenarios';
import type { useToast } from '../hooks/useToast';
import type { StudioDestination } from '../motion/creativeStudios';

export type ScenarioRunApi = {
  ensureRun(): Promise<ScenarioRun>;
  mutate<T = { run: ScenarioRun }>(intent: string, command: ScenarioCommand, args: Record<string, unknown>): Promise<T>;
  refresh(): Promise<void>;
  busy: ReadonlySet<string>;
};

export type StepOutputPanelMeta = {
  status?: 'running' | 'failed' | 'ready';
  version?: number;
};

export type BriefSaveRef = RefObject<(() => Promise<string | undefined> | undefined) | null>;

export type StepProps = {
  scenario: ScenarioDefinition;
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  run: ScenarioRun | null;
  active: boolean;
  api: ScenarioRunApi;
  pool: {
    items: PoolItem[];
    byId: Map<string, PoolItem>;
    requestPick(opts: { slot: string; kinds: PoolKind[]; max?: number; selected: string[] }): Promise<string[] | null>;
    highlight(ids: string[]): void;
  };
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
  briefSaveRef?: BriefSaveRef;
  validateNextRef?: RefObject<(() => boolean) | null>;
  nav: {
    openDesignProject(id: string): void;
    openMotionProject(id: string): Promise<boolean>;
    openModelHub(id: string): void;
    openBlackFriday(trigger: HTMLElement): void;
    openTemplateLibrary(trigger: HTMLElement): void;
    openStudioScene(target: StudioDestination, prompt: string): void;
    openProviders(provider?: string): void;
    selectStep(stepId: string): void;
    openMcp(example?: string): void;
  };
  renderExportMenu(extraItems?: ReactNode): ReactNode;
  renderIterations(opts: { renderOutput(iteration: StepIteration): ReactNode }): ReactNode;
  renderOutputPanel?(content: ReactNode, meta?: StepOutputPanelMeta): ReactNode;
  renderCapabilityBar?(content: ReactNode): ReactNode;
};

export type ScenarioWorkspaceProps = {
  scenarioId: ScenarioId;
  runId: string | null;
  stepId: string | null;
  mode?: ScenarioWorkspaceMode | null;
  active: boolean;
  onRoute(
    patch: { run?: string | null; step?: string | null; mode?: ScenarioWorkspaceMode | null },
    replace?: boolean,
  ): void;
  onExplore(): void;
  onOpenHub(): void;
  breadcrumb?: ReactNode;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
  onOpenModelHub(id: string): void;
  onOpenBlackFriday(trigger: HTMLElement): void;
  onOpenTemplateLibrary(trigger: HTMLElement): void;
  onOpenStudioScene(target: StudioDestination, prompt: string): void;
  onOpenProviders(provider?: string): void;
  onOpenMcp(example?: string): void;
};
