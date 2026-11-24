import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { DesignError, type DesignAssetResolver, type DesignProjects } from '../design-projects.ts';
import { atomicJson, jsonFile } from '../phase1-versions.ts';
import { withProcessLock } from '../shared/process-lock.ts';
import { applyImageToHtml, scenarioStarterPage, type EmbedImageTarget } from '../shared/scenario-content.ts';
import { generatedScenarioMediaName } from '../shared/scenario-media-names.ts';
import { isAutomaticScenarioPrompt, scenarioStepPrompt } from '../shared/scenario-prompts.ts';
import {
  SCENARIO_LIMITS,
  type IterationOutput,
  type PoolItem,
  type PoolRef,
  type ScenarioBundleReceipt,
  type ScenarioRun,
  type ScenarioRunSummary,
  type ScenarioStepState,
  type StepIteration,
} from '../shared/scenario-runs.ts';
import {
  findScenario,
  findScenarioStep,
  scenarioCategories,
  scenarioDefinitions,
  socialPlatforms,
  type PoolKind,
  type ScenarioDefinition,
  type ScenarioId,
  type ScenarioStepDefinition,
} from '../shared/scenarios.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { BundleBuildError, buildScenarioBundle } from './scenario-bundle.ts';

export type ScenarioErrorCode =
  | 'INVALID_ARGUMENT'
  | 'SCENARIO_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'STEP_NOT_FOUND'
  | 'POOL_ITEM_NOT_FOUND'
  | 'SCENARIO_CONFLICT'
  | 'DESIGN_CONFLICT'
  | 'PROVIDER_UNAVAILABLE'
  | 'LIMIT_EXCEEDED'
  | 'ASSET_NOT_FOUND'
  | 'UNSUPPORTED';

export class ScenarioError extends Error {
  readonly code: ScenarioErrorCode;
  readonly applied: boolean;
  constructor(code: ScenarioErrorCode, message: string, applied = false) {
    super(`${code}: ${message}`);
    this.code = code;
    this.applied = applied;
  }
}

export type ScenarioHost = {
  origin: () => string;
  assets: (input: Record<string, unknown>) => Promise<any>;
  design: DesignProjects;
  resolveAsset: DesignAssetResolver;
  createMotionProject: (input: Record<string, unknown>) => Promise<any>;
  exportMotionArchive: (input: { action: 'export'; requestId: string; projectIds: string[] }) => Promise<any>;
};

type RequestReceipt = { inputHash: string; result: unknown };
type MotionCatalog = {
  projects: { id: string; title: string; templateId?: string; trashedAt?: number }[];
  sessions?: { id: string; artifacts: { projectId: string }[] }[];
};

const UUID_RE = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const REQUEST_ID_RE = /^[\w-]{1,100}$/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function derivedRequestId(requestId: string, suffix: string): string {
  const cleanSuffix = suffix.replace(/[^A-Za-z0-9_-]/g, '-');
  const candidate = `${requestId}-${cleanSuffix}`;
  if (candidate.length <= 100 && REQUEST_ID_RE.test(candidate)) return candidate;
  return `sc-${sha256(`${requestId}:${suffix}`).slice(0, 48)}`;
}

function validateUuid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ScenarioError('INVALID_ARGUMENT', `Invalid ${label}`);
  }
  return value;
}

function validateRequestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID_RE.test(value)) {
    throw new ScenarioError('INVALID_ARGUMENT', 'Valid requestId is required');
  }
  return value;
}

function validateTitle(value: unknown): string {
  if (typeof value !== 'string') throw new ScenarioError('INVALID_ARGUMENT', 'Title must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new ScenarioError('INVALID_ARGUMENT', 'Title must be 1–120 printable characters');
  }
  return trimmed;
}

function validateLabel(value: unknown): string {
  if (typeof value !== 'string') throw new ScenarioError('INVALID_ARGUMENT', 'Label must be a string');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 200 || /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new ScenarioError('INVALID_ARGUMENT', 'Label must be 1–200 printable characters');
  }
  return trimmed;
}

function validateTags(tags: unknown): string[] {
  if (tags === undefined) return [];
  if (!Array.isArray(tags) || tags.length > 20) throw new ScenarioError('INVALID_ARGUMENT', 'tags must be an array of at most 20 items');
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.trim() || tag.trim().length > 60 || /[\x00-\x1f\x7f]/.test(tag)) {
      throw new ScenarioError('INVALID_ARGUMENT', 'Each tag must be 1–60 printable characters');
    }
    const clean = tag.trim();
    if (!seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
    }
  }
  return out;
}

function validateBriefPatch(scenario: ScenarioDefinition, patch: unknown): Record<string, string | string[]> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new ScenarioError('INVALID_ARGUMENT', 'brief must be an object');
  }
  const fieldsById = new Map(scenario.briefFields.map(field => [field.id, field]));
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const field = fieldsById.get(key);
    if (!field) throw new ScenarioError('INVALID_ARGUMENT', `Unknown brief field: ${key}`);
    if (field.kind === 'list' || field.kind === 'multi') {
      if (!Array.isArray(value)) throw new ScenarioError('INVALID_ARGUMENT', `Brief field ${key} must be an array`);
      if (value.length > 20) throw new ScenarioError('INVALID_ARGUMENT', `Brief field ${key} exceeds maximum items`);
      const items = value.map(item => {
        if (typeof item !== 'string') throw new ScenarioError('INVALID_ARGUMENT', `Brief field ${key} items must be strings`);
        const trimmed = item.trim();
        if (trimmed.length > SCENARIO_LIMITS.briefValue) {
          throw new ScenarioError('LIMIT_EXCEEDED', `Brief field ${key} exceeds ${SCENARIO_LIMITS.briefValue} characters`);
        }
        return trimmed;
      }).filter(Boolean);
      result[key] = items;
    } else {
      if (typeof value !== 'string') throw new ScenarioError('INVALID_ARGUMENT', `Brief field ${key} must be a string`);
      if (value.length > SCENARIO_LIMITS.briefValue) {
        throw new ScenarioError('LIMIT_EXCEEDED', `Brief field ${key} exceeds ${SCENARIO_LIMITS.briefValue} characters`);
      }
      result[key] = value;
    }
  }
  return result;
}

function formatDateIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function poolRefKey(ref: PoolRef): string {
  switch (ref.type) {
    case 'asset': return `asset:${ref.assetId}:${ref.versionId}`;
    case 'design': return `design:${ref.projectId}`;
    case 'motion': return `motion:${ref.projectId}`;
    case 'text': return `text:${ref.stepId}:${ref.iterationId}`;
  }
}

function isProviderUnavailableMessage(message: string): boolean {
  return /selected model is unavailable|configure an available provider|api key required|no .* provider/i.test(message);
}

function summarizeRun(run: ScenarioRun): ScenarioRunSummary {
  const scenario = findScenario(run.scenarioId);
  const validStepIds = scenario ? new Set(scenario.steps.map(step => step.id)) : null;
  const stepStates = Object.entries(run.steps)
    .filter(([stepId]) => !validStepIds || validStepIds.has(stepId))
    .map(([, step]) => step);
  const doneSteps = stepStates.filter(step => step.status === 'done').length;
  let pendingJobs = 0;
  for (const step of stepStates) {
    for (const iter of step.iterations) {
      if (iter.job && (iter.job.state === 'queued' || iter.job.state === 'running')) {
        pendingJobs += 1;
      }
    }
  }
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
    doneSteps,
    pendingJobs,
  };
}

function computeDefaultBindings(run: ScenarioRun, scenario: ScenarioDefinition): ScenarioRun {
  const poolById = new Map(run.pool.map(item => [item.id, item]));
  const activePoolOutputs = (stepId: string, kinds?: PoolKind[]): string[] => {
    const state = run.steps[stepId];
    if (!state || !state.activeIterationId) return [];
    const active = state.iterations.find(iter => iter.id === state.activeIterationId);
    if (!active) return [];
    return active.outputs
      .filter((out): out is { type: 'pool'; poolItemId: string } => out.type === 'pool')
      .map(out => out.poolItemId)
      .filter(id => {
        const item = poolById.get(id);
        return Boolean(item && (!kinds || kinds.includes(item.kind)));
      });
  };

  const nextSteps: Record<string, ScenarioStepState> = {};
  for (let i = 0; i < scenario.steps.length; i += 1) {
    const def = scenario.steps[i];
    const current = run.steps[def.id];
    if (!current) continue;
    const bindings: Record<string, string[]> = {};
    for (const [slot, ids] of Object.entries(current.bindings)) {
      bindings[slot] = ids.filter(id => poolById.has(id));
    }

    const preceding = scenario.steps.slice(0, i);
    const nearestPreceding = (type: ScenarioStepDefinition['type']) =>
      [...preceding].reverse().find(step => step.type === type);

    if (def.type === 'image' && !Object.hasOwn(bindings, 'references')) {
      if (def.scenes?.includes('character')) {
        bindings.references = run.pool
          .filter(item => item.kind === 'image' && item.source === 'upload' && item.tags.some(t => t === 'persona' || t === 'product'))
          .map(item => item.id);
      } else {
        bindings.references = [];
      }
    }

    if (def.type === 'web-page' && (def.page?.mode === 'embed' || def.page?.mode === 'both') && !Object.hasOwn(bindings, 'embedImages')) {
      const prevImage = nearestPreceding('image');
      bindings.embedImages = prevImage ? activePoolOutputs(prevImage.id, ['image']) : [];
    }

    if (def.type === 'video') {
      if (!Object.hasOwn(bindings, 'firstFrame')) {
        const prevImage = nearestPreceding('image');
        const images = prevImage ? activePoolOutputs(prevImage.id, ['image']) : [];
        bindings.firstFrame = images.length ? [images[0]] : [];
      }
      if (!Object.hasOwn(bindings, 'soundtrack')) {
        const prevAudio = nearestPreceding('audio');
        bindings.soundtrack = prevAudio ? activePoolOutputs(prevAudio.id, ['audio']) : [];
      }
    }

    if (def.type === 'audio' && def.audioModes?.includes('speech') && !Object.hasOwn(bindings, 'script')) {
      const briefStep = nearestPreceding('brief');
      if (briefStep) {
        const briefState = run.steps[briefStep.id];
        const scriptPool = run.pool.find(
          item => item.ref.type === 'text' && item.ref.stepId === briefStep.id && item.ref.iterationId === briefState?.activeIterationId,
        );
        bindings.script = scriptPool ? [scriptPool.id] : [];
      } else {
        bindings.script = [];
      }
    }

    if (def.type === 'social-pack' && !Object.hasOwn(bindings, 'postMedia')) {
      const mediaIds: string[] = [];
      const seen = new Set<string>();
      for (const prev of preceding) {
        if (prev.type !== 'image' && prev.type !== 'video') continue;
        for (const id of activePoolOutputs(prev.id, ['image', 'video'])) {
          if (!seen.has(id)) {
            seen.add(id);
            mediaIds.push(id);
          }
        }
      }
      bindings.postMedia = mediaIds;
    }

    nextSteps[def.id] = { ...current, bindings };
  }

  return { ...run, steps: nextSteps };
}

function defaultMotionRequirements(scenario: ScenarioDefinition, run: ScenarioRun, step: ScenarioStepDefinition): string {
  const briefSummary = Object.entries(run.brief)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
    .filter(line => !line.endsWith(': '))
    .join('; ');
  const skills = step.motion?.skills?.length ? ` Skills: ${step.motion.skills.join(', ')}.` : '';
  const duration = step.motion?.defaultDurationSeconds ? ` Target duration: ${step.motion.defaultDurationSeconds}s.` : '';
  return `Build the "${step.title}" film for the "${scenario.title}" workflow (${run.title}).${duration}${skills}${briefSummary ? ` Brief: ${briefSummary}` : ''}`.slice(0, 7500);
}

export class ScenarioRuns {
  readonly dataDirectory: string;
  readonly root: string;
  private readonly runsDir: string;
  private readonly requestsDir: string;
  private readonly bundlesDir: string;
  private readonly lockPath: string;
  private store?: WorkspaceStore;

  constructor(dataDirectory: string, store?: WorkspaceStore) {
    this.dataDirectory = path.resolve(dataDirectory);
    this.store = store;
    this.root = path.join(this.dataDirectory, 'scenarios');
    this.runsDir = path.join(this.root, 'runs');
    this.requestsDir = path.join(this.root, 'requests');
    this.bundlesDir = path.join(this.root, 'bundles');
    this.lockPath = path.join(this.root, 'scenarios.lock');
  }

  setStore(store: WorkspaceStore) {
    this.store = store;
  }

  private async ensureDirs() {
    await Promise.all([
      mkdir(this.runsDir, { recursive: true, mode: 0o700 }),
      mkdir(this.requestsDir, { recursive: true, mode: 0o700 }),
      mkdir(this.bundlesDir, { recursive: true, mode: 0o700 }),
    ]);
  }

  private async lock<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureDirs();
    return withProcessLock(this.lockPath, fn);
  }

  private runPath(runId: string) {
    return path.join(this.runsDir, `${validateUuid(runId, 'runId')}.json`);
  }

  private receiptPath(scope: string, requestId: string) {
    return path.join(this.requestsDir, `${sha256(`${scope}:${validateRequestId(requestId)}`)}.json`);
  }

  private async readReceipt<T>(scope: string, requestId: string, inputHash: string): Promise<T | null> {
    const file = this.receiptPath(scope, requestId);
    const existing = await jsonFile<RequestReceipt | null>(file, null);
    if (!existing) return null;
    if (existing.inputHash !== inputHash) {
      throw new ScenarioError('INVALID_ARGUMENT', 'requestId already used with different arguments');
    }
    return existing.result as T;
  }

  private async writeReceipt(scope: string, requestId: string, inputHash: string, result: unknown) {
    await atomicJson(this.receiptPath(scope, requestId), { inputHash, result });
  }

  private async readRunRaw(runId: string): Promise<ScenarioRun> {
    const file = this.runPath(runId);
    const run = await jsonFile<ScenarioRun | null>(file, null);
    if (!run || run.schemaVersion !== 1 || run.id !== runId) {
      throw new ScenarioError('RUN_NOT_FOUND', `Scenario run ${runId} not found`);
    }
    return run;
  }

  private async saveRun(run: ScenarioRun): Promise<void> {
    const serialized = JSON.stringify(run);
    if (Buffer.byteLength(serialized, 'utf8') > SCENARIO_LIMITS.runBytes) {
      throw new ScenarioError('LIMIT_EXCEEDED', 'Scenario run exceeds 2 MB size limit. Start a new run.');
    }
    await atomicJson(this.runPath(run.id), run);
  }

  private async readMotionCatalog(): Promise<MotionCatalog> {
    if (this.store) {
      return this.store.projectCatalog();
    }
    return jsonFile<MotionCatalog>(path.join(this.dataDirectory, 'projects.json'), { projects: [], sessions: [] });
  }

  private requireScenario(scenarioId: unknown): ScenarioDefinition {
    const scenario = findScenario(scenarioId);
    if (!scenario) throw new ScenarioError('SCENARIO_NOT_FOUND', `Unknown scenario: ${String(scenarioId)}`);
    return scenario;
  }

  private requireStep(scenario: ScenarioDefinition, stepId: unknown): ScenarioStepDefinition {
    const step = findScenarioStep(scenario, stepId);
    if (!step) throw new ScenarioError('STEP_NOT_FOUND', `Unknown step ${String(stepId)} in scenario ${scenario.id}`);
    return step;
  }

  private assertRevision(run: ScenarioRun, expectedRevision: unknown) {
    if (typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new ScenarioError('INVALID_ARGUMENT', 'expectedRevision must be a positive integer');
    }
    if (run.revision !== expectedRevision) {
      throw new ScenarioError('SCENARIO_CONFLICT', `Expected revision ${expectedRevision}, currentRevision is ${run.revision}`);
    }
  }

  private seedPrompts(run: ScenarioRun, scenario: ScenarioDefinition, previousBrief: ScenarioRun['brief']) {
    for (const stepDef of scenario.steps) {
      if (!stepDef.promptTemplate) continue;
      const state = run.steps[stepDef.id];
      if (!state || state.iterations.length > 0 || !isAutomaticScenarioPrompt(scenario, stepDef, previousBrief, state.draft)) continue;
      const filled = scenarioStepPrompt(scenario, stepDef, run.brief, run.locale);
      if (filled) {
        state.draft = { ...state.draft, prompt: filled, promptLocale: run.locale };
      }
    }
  }

  private upsertPoolItem(
    run: ScenarioRun,
    input: { kind: PoolKind; ref: PoolRef; label: string; source: PoolItem['source']; stepId: string | null; tags?: string[] },
  ): PoolItem {
    const key = poolRefKey(input.ref);
    const existing = run.pool.find(item => poolRefKey(item.ref) === key);
    if (existing) {
      if (input.ref.type === 'design') {
        existing.ref = input.ref;
      }
      return existing;
    }
    if (run.pool.length >= SCENARIO_LIMITS.poolItems) {
      throw new ScenarioError('LIMIT_EXCEEDED', `Workflow assets limit (${SCENARIO_LIMITS.poolItems}) reached. Start a new run.`);
    }
    const created: PoolItem = {
      id: randomUUID(),
      kind: input.kind,
      ref: input.ref,
      label: input.label.slice(0, 200),
      source: input.source,
      stepId: input.stepId,
      tags: input.tags ?? [],
      pinned: false,
      addedAt: Date.now(),
    };
    run.pool.push(created);
    return created;
  }

  private assertPoolCapacity(run: ScenarioRun, additional = 1): void {
    if (run.pool.length + additional > SCENARIO_LIMITS.poolItems) {
      throw new ScenarioError('LIMIT_EXCEEDED', `Workflow assets limit (${SCENARIO_LIMITS.poolItems}) reached. Start a new run.`);
    }
  }

  private assertIterationCapacity(stepState: ScenarioStepState): void {
    if (stepState.iterations.length >= SCENARIO_LIMITS.iterationsPerStep) {
      throw new ScenarioError('LIMIT_EXCEEDED', `Iteration limit (${SCENARIO_LIMITS.iterationsPerStep}) reached for step ${stepState.stepId}. Start a new run.`);
    }
  }

  private pushIteration(
    stepState: ScenarioStepState,
    iter: Omit<StepIteration, 'id' | 'number' | 'createdAt'> & { id?: string },
  ): StepIteration {
    this.assertIterationCapacity(stepState);
    const number = (stepState.iterations.at(-1)?.number ?? 0) + 1;
    const created: StepIteration = {
      id: iter.id ?? randomUUID(),
      number,
      createdAt: Date.now(),
      source: iter.source,
      inputs: iter.inputs,
      outputs: iter.outputs,
      ...(iter.prompt !== undefined ? { prompt: iter.prompt } : {}),
      ...(iter.settings !== undefined ? { settings: iter.settings } : {}),
      ...(iter.job !== undefined ? { job: iter.job } : {}),
      ...(iter.design !== undefined ? { design: iter.design } : {}),
      ...(iter.note !== undefined ? { note: iter.note } : {}),
      ...(iter.requestId !== undefined ? { requestId: iter.requestId } : {}),
    };
    stepState.iterations.push(created);
    return created;
  }

  private async runPureMutation<T>(
    runId: string,
    scope: string,
    requestId: string,
    expectedRevision: number,
    inputForHash: unknown,
    mutate: (run: ScenarioRun, scenario: ScenarioDefinition) => T | Promise<T>,
  ): Promise<T> {
    const id = validateUuid(runId, 'runId');
    const rid = validateRequestId(requestId);
    const inputHash = sha256(JSON.stringify(inputForHash));
    return this.lock(async () => {
      const prior = await this.readReceipt<T>(scope, rid, inputHash);
      if (prior) return prior;
      const run = await this.readRunRaw(id);
      this.assertRevision(run, expectedRevision);
      const scenario = this.requireScenario(run.scenarioId);
      const result = await mutate(run, scenario);
      run.revision += 1;
      run.updatedAt = Date.now();
      await this.saveRun(run);
      const hydrated = (result && typeof result === 'object' && 'run' in (result as Record<string, unknown>))
        ? { ...(result as Record<string, unknown>), run: computeDefaultBindings(run, scenario) } as T
        : result;
      await this.writeReceipt(scope, rid, inputHash, hydrated);
      return hydrated;
    });
  }

  private async runSideEffectMutation<S, T>(
    runId: string,
    scope: string,
    requestId: string,
    expectedRevision: number,
    inputForHash: unknown,
    prepareAndExecute: (run: ScenarioRun, scenario: ScenarioDefinition) => Promise<S>,
    commit: (run: ScenarioRun, scenario: ScenarioDefinition, sideEffectResult: S) => T | Promise<T>,
    options?: { adoptOnConflict?: boolean },
  ): Promise<T> {
    const id = validateUuid(runId, 'runId');
    const rid = validateRequestId(requestId);
    const inputHash = sha256(JSON.stringify(inputForHash));

    await this.ensureDirs();
    const earlyReceipt = await this.readReceipt<T>(scope, rid, inputHash);
    if (earlyReceipt) return earlyReceipt;

    // Step 1: fast-fail revision check outside lock
    const snapshot = await this.readRunRaw(id);
    this.assertRevision(snapshot, expectedRevision);
    const snapshotScenario = this.requireScenario(snapshot.scenarioId);

    // Step 2: perform external side effects outside scenarios.lock
    const sideEffectResult = await prepareAndExecute(snapshot, snapshotScenario);

    // Step 3: acquire scenarios.lock, re-check receipt & revision, commit atomically
    return this.lock(async () => {
      const concurrentReceipt = await this.readReceipt<T>(scope, rid, inputHash);
      if (concurrentReceipt) return concurrentReceipt;
      const latest = await this.readRunRaw(id);
      if (!options?.adoptOnConflict) {
        this.assertRevision(latest, expectedRevision);
      }
      const scenario = this.requireScenario(latest.scenarioId);
      const result = await commit(latest, scenario, sideEffectResult);
      latest.revision += 1;
      latest.updatedAt = Date.now();
      await this.saveRun(latest);
      const hydrated = (result && typeof result === 'object' && 'run' in (result as Record<string, unknown>))
        ? { ...(result as Record<string, unknown>), run: computeDefaultBindings(latest, scenario) } as T
        : result;
      await this.writeReceipt(scope, rid, inputHash, hydrated);
      return hydrated;
    });
  }

  catalog() {
    return {
      scenarios: scenarioDefinitions,
      categories: scenarioCategories,
      platforms: socialPlatforms,
    };
  }

  async list(input: { scenarioId?: ScenarioId; includeArchived?: boolean; offset?: number; limit?: number } = {}): Promise<{ runs: ScenarioRunSummary[]; nextOffset: number | null }> {
    if (input.scenarioId !== undefined) this.requireScenario(input.scenarioId);
    const offset = Math.max(0, Math.floor(Number(input.offset ?? 0) || 0));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(input.limit ?? 50) || 50)));
    const names = await readdir(this.runsDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });

    const loaded: ScenarioRun[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const runId = name.slice(0, -5);
      if (!UUID_RE.test(runId)) continue;
      try {
        const parsed = await jsonFile<ScenarioRun | null>(path.join(this.runsDir, name), null);
        if (!parsed || parsed.schemaVersion !== 1 || parsed.id !== runId || !findScenario(parsed.scenarioId)) {
          console.warn(`[scenario-runs] Skipping invalid scenario run file: ${name}`);
          continue;
        }
        loaded.push(parsed);
      } catch (error) {
        console.warn(`[scenario-runs] Skipping unreadable scenario run file ${name}:`, error instanceof Error ? error.message : String(error));
      }
    }

    const filtered = loaded
      .filter(run => (!input.scenarioId || run.scenarioId === input.scenarioId) && (input.includeArchived || run.archivedAt === null))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, SCENARIO_LIMITS.runsListed);

    const page = filtered.slice(offset, offset + limit).map(summarizeRun);
    return {
      runs: page,
      nextOffset: offset + limit < filtered.length ? offset + limit : null,
    };
  }

  async get(runId: string): Promise<{ run: ScenarioRun }> {
    const run = await this.readRunRaw(validateUuid(runId, 'runId'));
    const scenario = this.requireScenario(run.scenarioId);
    return { run: computeDefaultBindings(run, scenario) };
  }

  async create(input: { requestId: string; scenarioId: ScenarioId; title?: string; brief?: Record<string, string | string[]>; locale?: string }): Promise<{ run: ScenarioRun }> {
    const rid = validateRequestId(input.requestId);
    const scenario = this.requireScenario(input.scenarioId);
    const title = input.title !== undefined ? validateTitle(input.title) : `${scenario.title} · ${formatDateIso(new Date())}`;
    const brief = input.brief !== undefined ? validateBriefPatch(scenario, input.brief) : {};
    const locale = typeof input.locale === 'string' && input.locale.trim() ? input.locale.trim().slice(0, 35) : 'en';
    const inputHash = sha256(JSON.stringify({ scenarioId: scenario.id, title: input.title ?? null, brief, locale }));

    return this.lock(async () => {
      const prior = await this.readReceipt<{ run: ScenarioRun }>('create', rid, inputHash);
      if (prior) return prior;

      const now = Date.now();
      const steps: Record<string, ScenarioStepState> = {};
      for (const stepDef of scenario.steps) {
        const draft: Record<string, unknown> = {};
        if (stepDef.promptTemplate) {
          const seeded = scenarioStepPrompt(scenario, stepDef, brief, locale);
          if (seeded) Object.assign(draft, { prompt: seeded, promptLocale: locale });
        }
        steps[stepDef.id] = {
          stepId: stepDef.id,
          status: stepDef.type === 'brief' ? 'in-progress' : 'todo',
          iterations: [],
          activeIterationId: null,
          bindings: {},
          draft,
          links: {},
        };
      }

      const run: ScenarioRun = {
        schemaVersion: 1,
        id: randomUUID(),
        scenarioId: scenario.id,
        title,
        locale,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        revision: 1,
        brief,
        activeStepId: scenario.steps[0].id,
        steps,
        pool: [],
      };
      await this.saveRun(run);
      const result = { run: computeDefaultBindings(run, scenario) };
      await this.writeReceipt('create', rid, inputHash, result);
      return result;
    });
  }

  async updateRun(input: { runId: string; expectedRevision: number; requestId: string; changes: { title?: string; archived?: boolean; activeStepId?: string } }): Promise<{ run: ScenarioRun }> {
    const changes = input.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new ScenarioError('INVALID_ARGUMENT', 'changes must be an object');
    }
    const allowed = new Set(['title', 'archived', 'activeStepId']);
    const keys = Object.keys(changes);
    if (!keys.length || keys.some(k => !allowed.has(k))) {
      throw new ScenarioError('INVALID_ARGUMENT', 'changes must specify title, archived or activeStepId');
    }
    const title = changes.title !== undefined ? validateTitle(changes.title) : undefined;

    return this.runPureMutation(
      input.runId,
      `update-run:${input.runId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, changes },
      (run, scenario) => {
        if (title !== undefined) run.title = title;
        if (changes.archived !== undefined) run.archivedAt = changes.archived ? Date.now() : null;
        if (changes.activeStepId !== undefined) {
          this.requireStep(scenario, changes.activeStepId);
          run.activeStepId = changes.activeStepId;
        }
        return { run };
      },
    );
  }

  async updateBrief(input: { runId: string; expectedRevision: number; requestId: string; brief: Record<string, string | string[]> }): Promise<{ run: ScenarioRun }> {
    return this.runPureMutation(
      input.runId,
      `update-brief:${input.runId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, brief: input.brief },
      (run, scenario) => {
        const validated = validateBriefPatch(scenario, input.brief);
        const previousBrief = run.brief;
        run.brief = { ...previousBrief, ...validated };
        this.seedPrompts(run, scenario, previousBrief);
        return { run };
      },
    );
  }

  async updateStep(input: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    status?: ScenarioStepState['status'];
    draft?: Record<string, unknown>;
    bindings?: Record<string, string[]>;
    activeIterationId?: string | null;
    iterationNote?: { iterationId: string; note: string };
  }): Promise<{ run: ScenarioRun }> {
    if (
      input.status === undefined &&
      input.draft === undefined &&
      input.bindings === undefined &&
      input.activeIterationId === undefined &&
      input.iterationNote === undefined
    ) {
      throw new ScenarioError('INVALID_ARGUMENT', 'Provide at least one of status, draft, bindings, activeIterationId or iterationNote');
    }

    return this.runPureMutation(
      input.runId,
      `update-step:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        stepId: input.stepId,
        status: input.status,
        draft: input.draft,
        bindings: input.bindings,
        activeIterationId: input.activeIterationId,
        iterationNote: input.iterationNote,
      },
      (run, scenario) => {
        this.requireStep(scenario, input.stepId);
        const step = run.steps[input.stepId];
        if (input.status !== undefined) {
          if (!['todo', 'in-progress', 'done', 'skipped'].includes(input.status)) {
            throw new ScenarioError('INVALID_ARGUMENT', `Invalid step status: ${String(input.status)}`);
          }
          step.status = input.status;
        }
        if (input.draft !== undefined) {
          if (!input.draft || typeof input.draft !== 'object' || Array.isArray(input.draft)) {
            throw new ScenarioError('INVALID_ARGUMENT', 'draft must be an object');
          }
          step.draft = { ...step.draft, ...input.draft };
        }
        if (input.bindings !== undefined) {
          if (!input.bindings || typeof input.bindings !== 'object' || Array.isArray(input.bindings)) {
            throw new ScenarioError('INVALID_ARGUMENT', 'bindings must be an object');
          }
          const poolIds = new Set(run.pool.map(item => item.id));
          const merged: Record<string, string[]> = { ...step.bindings };
          for (const [slot, ids] of Object.entries(input.bindings)) {
            if (!Array.isArray(ids)) throw new ScenarioError('INVALID_ARGUMENT', `Binding slot ${slot} must be an array`);
            const deduped: string[] = [];
            for (const id of ids) {
              if (!poolIds.has(id)) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Pool item ${id} not found`);
              if (!deduped.includes(id)) deduped.push(id);
            }
            merged[slot] = deduped;
          }
          step.bindings = merged;
        }
        if (input.activeIterationId !== undefined) {
          if (input.activeIterationId === null) {
            step.activeIterationId = null;
          } else {
            const id = validateUuid(input.activeIterationId, 'activeIterationId');
            if (!step.iterations.some(iter => iter.id === id)) {
              throw new ScenarioError('INVALID_ARGUMENT', `Iteration ${id} not found in step ${input.stepId}`);
            }
            step.activeIterationId = id;
          }
        }
        if (input.iterationNote !== undefined) {
          const iter = step.iterations.find(it => it.id === input.iterationNote!.iterationId);
          if (!iter) throw new ScenarioError('INVALID_ARGUMENT', `Iteration ${input.iterationNote.iterationId} not found`);
          iter.note = input.iterationNote.note.trim();
        }
        return { run };
      },
    );
  }

  async addPool(
    input: {
      runId: string;
      expectedRevision: number;
      requestId: string;
      items: { ref: PoolRef; label?: string; tags?: string[]; stepId?: string | null; source: PoolItem['source'] }[];
      recordIteration?: boolean;
      note?: string;
    },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; poolItemIds: string[] }> {
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 50) {
      throw new ScenarioError('INVALID_ARGUMENT', 'items must contain 1–50 pool entries');
    }

    const recordIteration = Boolean(input.recordIteration);
    const trimmedNote = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 2000) : undefined;

    type ResolvedPoolInput = {
      kind: PoolKind;
      ref: PoolRef;
      label: string;
      source: PoolItem['source'];
      stepId: string | null;
      tags: string[];
    };

    return this.runSideEffectMutation(
      input.runId,
      `add-pool:${input.runId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        items: input.items,
        ...(recordIteration ? { recordIteration: true } : {}),
        ...(trimmedNote ? { note: trimmedNote } : {}),
      },
      async (snapshot, scenario): Promise<ResolvedPoolInput[]> => {
        const resolvedList: ResolvedPoolInput[] = [];
        for (const entry of input.items) {
          const stepId = entry.stepId === undefined || entry.stepId === null ? null : this.requireStep(scenario, entry.stepId).id;
          const tags = validateTags(entry.tags);
          const ref = entry.ref;
          if (!ref || typeof ref !== 'object') throw new ScenarioError('INVALID_ARGUMENT', 'Pool item ref is required');

          if (ref.type === 'asset') {
            let resolved;
            try {
              resolved = await host.resolveAsset({ assetId: ref.assetId, versionId: ref.versionId });
            } catch (error) {
              const message = (error as Error)?.message ?? 'Asset not found';
              if (/ASSET_NOT_FOUND|ASSET_VERSION_UNAVAILABLE/i.test(message)) {
                throw new ScenarioError('ASSET_NOT_FOUND', message);
              }
              throw error;
            }
            const modality = resolved.asset.modality;
            if (modality !== 'image' && modality !== 'video' && modality !== 'audio') {
              throw new ScenarioError('INVALID_ARGUMENT', `Unsupported asset modality: ${modality}`);
            }
            resolvedList.push({
              kind: modality,
              ref: { type: 'asset', assetId: resolved.asset.id, versionId: resolved.version.id },
              label: entry.label ? validateLabel(entry.label) : (resolved.asset.name || resolved.version.name || 'Asset'),
              source: entry.source,
              stepId,
              tags,
            });
          } else if (ref.type === 'design') {
            let project;
            try {
              project = await host.design.get(ref.projectId, host.origin());
            } catch (error) {
              if (error instanceof DesignError && error.code === 'NOT_FOUND') {
                throw new ScenarioError('INVALID_ARGUMENT', `Design project ${ref.projectId} not found`);
              }
              throw error;
            }
            resolvedList.push({
              kind: 'page',
              ref: { type: 'design', projectId: project.id, versionId: project.versionId, revision: project.revision },
              label: entry.label ? validateLabel(entry.label) : project.title,
              source: entry.source,
              stepId,
              tags,
            });
          } else if (ref.type === 'motion') {
            const catalog = await this.readMotionCatalog();
            const proj = catalog.projects.find(p => p.id === ref.projectId && !p.trashedAt);
            if (!proj) throw new ScenarioError('INVALID_ARGUMENT', `Motion project ${ref.projectId} not found`);
            const session = catalog.sessions?.find(s => s.artifacts.some(a => a.projectId === proj.id));
            resolvedList.push({
              kind: 'motion',
              ref: { type: 'motion', projectId: proj.id, sessionId: ref.sessionId ?? session?.id ?? null },
              label: entry.label ? validateLabel(entry.label) : proj.title,
              source: entry.source,
              stepId,
              tags,
            });
          } else if (ref.type === 'text') {
            const targetStep = this.requireStep(scenario, ref.stepId);
            const st = snapshot.steps[targetStep.id];
            if (!st?.iterations.some(it => it.id === ref.iterationId)) {
              throw new ScenarioError('INVALID_ARGUMENT', `Text iteration ${ref.iterationId} not found in step ${targetStep.id}`);
            }
            resolvedList.push({
              kind: 'text',
              ref: { type: 'text', stepId: targetStep.id, iterationId: ref.iterationId },
              label: entry.label ? validateLabel(entry.label) : `${targetStep.title} text`,
              source: entry.source,
              stepId: stepId ?? targetStep.id,
              tags,
            });
          } else {
            throw new ScenarioError('INVALID_ARGUMENT', 'Unsupported pool reference type');
          }
        }
        return resolvedList;
      },
      (run, _scenario, resolvedList) => {
        const poolItemIds: string[] = [];
        const byStep = new Map<string, { source: StepIteration['source']; poolItemIds: string[] }>();
        for (const item of resolvedList) {
          const stored = this.upsertPoolItem(run, item);
          poolItemIds.push(stored.id);
          if (recordIteration && item.stepId) {
            let group = byStep.get(item.stepId);
            if (!group) {
              const iterSource: StepIteration['source'] = item.source === 'step-output' ? 'local' : item.source;
              group = { source: iterSource, poolItemIds: [] };
              byStep.set(item.stepId, group);
            }
            group.poolItemIds.push(stored.id);
          }
        }
        if (recordIteration) {
          for (const [stepId, group] of byStep) {
            const step = run.steps[stepId];
            if (!step) continue;
            const created = this.pushIteration(step, {
              source: group.source,
              inputs: [],
              outputs: group.poolItemIds.map(poolItemId => ({ type: 'pool', poolItemId })),
              ...(trimmedNote ? { note: trimmedNote } : {}),
              requestId: input.requestId,
            });
            step.activeIterationId = created.id;
            if (step.status === 'todo') {
              step.status = 'in-progress';
            }
          }
        }
        return { run, poolItemIds };
      },
    );
  }

  async updatePool(input: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    poolItemId: string;
    changes: { label?: string; tags?: string[]; pinned?: boolean };
  }): Promise<{ run: ScenarioRun }> {
    const changes = input.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
      throw new ScenarioError('INVALID_ARGUMENT', 'changes must be an object');
    }
    const allowed = new Set(['label', 'tags', 'pinned']);
    const keys = Object.keys(changes);
    if (!keys.length || keys.some(k => !allowed.has(k))) {
      throw new ScenarioError('INVALID_ARGUMENT', 'changes must specify label, tags or pinned');
    }
    const label = changes.label !== undefined ? validateLabel(changes.label) : undefined;
    const tags = changes.tags !== undefined ? validateTags(changes.tags) : undefined;

    return this.runPureMutation(
      input.runId,
      `update-pool:${input.runId}:${input.poolItemId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, poolItemId: input.poolItemId, changes },
      run => {
        const item = run.pool.find(entry => entry.id === input.poolItemId);
        if (!item) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Pool item ${input.poolItemId} not found`);
        if (label !== undefined) item.label = label;
        if (tags !== undefined) item.tags = tags;
        if (changes.pinned !== undefined) item.pinned = Boolean(changes.pinned);
        return { run };
      },
    );
  }

  async removePool(input: { runId: string; expectedRevision: number; requestId: string; poolItemId: string }): Promise<{ run: ScenarioRun }> {
    return this.runPureMutation(
      input.runId,
      `remove-pool:${input.runId}:${input.poolItemId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, poolItemId: input.poolItemId },
      run => {
        const index = run.pool.findIndex(item => item.id === input.poolItemId);
        if (index === -1) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Pool item ${input.poolItemId} not found`);
        run.pool.splice(index, 1);
        for (const step of Object.values(run.steps)) {
          for (const slot of Object.keys(step.bindings)) {
            step.bindings[slot] = step.bindings[slot].filter(id => id !== input.poolItemId);
          }
        }
        return { run };
      },
    );
  }

  async addIteration(input: {
    runId: string;
    expectedRevision: number;
    requestId: string;
    stepId: string;
    iteration: {
      source: StepIteration['source'];
      prompt?: string;
      settings?: Record<string, unknown>;
      inputs?: string[];
      outputs?: IterationOutput[];
      note?: string;
    };
  }): Promise<{ run: ScenarioRun; iteration: StepIteration }> {
    return this.runPureMutation(
      input.runId,
      `add-iteration:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, stepId: input.stepId, iteration: input.iteration },
      (run, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const poolIds = new Set(run.pool.map(item => item.id));

        const inputs = input.iteration.inputs ?? [];
        for (const id of inputs) {
          if (!poolIds.has(id)) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Input pool item ${id} not found`);
        }

        const outputs = input.iteration.outputs ?? [];
        for (const out of outputs) {
          if (out.type === 'pool' && !poolIds.has(out.poolItemId)) {
            throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Output pool item ${out.poolItemId} not found`);
          }
          if (out.type === 'brief') {
            validateBriefPatch(scenario, out.values);
          }
        }

        const created = this.pushIteration(step, {
          source: input.iteration.source,
          prompt: input.iteration.prompt,
          settings: input.iteration.settings,
          inputs,
          outputs,
          note: input.iteration.note,
          requestId: input.requestId,
        });

        // If this iteration carries a script output, mirror a text item into the shared pool for downstream voiceover binding.
        if (outputs.some(out => out.type === 'script')) {
          this.upsertPoolItem(run, {
            kind: 'text',
            ref: { type: 'text', stepId: stepDef.id, iterationId: created.id },
            label: `${stepDef.title} script v${created.number}`,
            source: 'step-output',
            stepId: stepDef.id,
          });
        }

        step.activeIterationId = created.id;
        if (step.status === 'todo') {
          step.status = 'in-progress';
        }
        return { run, iteration: created };
      },
    );
  }

  async generate(
    input: {
      runId: string;
      expectedRevision: number;
      requestId: string;
      stepId: string;
      modality: 'image' | 'video' | 'audio';
      model: string;
      mode?: 'text-to-image' | 'text-to-video' | 'text-to-audio' | 'text-to-speech';
      prompt: string;
      parameters?: Record<string, unknown>;
      referencePoolItemIds?: string[];
      scene?: string;
      locale?: string;
    },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; job: any; iteration: StepIteration }> {
    return this.runSideEffectMutation(
      input.runId,
      `generate:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        stepId: input.stepId,
        modality: input.modality,
        model: input.model,
        mode: input.mode,
        prompt: input.prompt,
        parameters: input.parameters,
        referencePoolItemIds: input.referencePoolItemIds,
        scene: input.scene,
        locale: input.locale,
      },
      async (snapshot, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const stepState = snapshot.steps[stepDef.id];
        this.assertIterationCapacity(stepState);
        this.assertPoolCapacity(snapshot, 1);
        const refIds = input.referencePoolItemIds ?? [];
        const references: { assetId: string; versionId: string }[] = [];
        for (const id of refIds) {
          const poolItem = snapshot.pool.find(item => item.id === id);
          if (!poolItem) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Reference pool item ${id} not found`);
          if (poolItem.ref.type !== 'asset') {
            throw new ScenarioError('INVALID_ARGUMENT', `Reference ${id} must be a workspace asset`);
          }
          if (poolItem.kind !== 'image') {
            throw new ScenarioError('INVALID_ARGUMENT', `Reference ${id} must be an image asset`);
          }
          references.push({ assetId: poolItem.ref.assetId, versionId: poolItem.ref.versionId });
        }

        const nextNumber = (stepState.iterations.at(-1)?.number ?? 0) + 1;
        const name = input.modality === 'image'
          ? `${snapshot.title} · ${stepDef.title} v${nextNumber}`
          : generatedScenarioMediaName(snapshot.title, scenario.title, stepDef.title, nextNumber, input.locale ?? snapshot.locale);
        let assetResult;
        try {
          assetResult = await host.assets({
            action: 'generate',
            requestId: derivedRequestId(input.requestId, 'asset'),
            model: input.model,
            modality: input.modality,
            ...(input.mode ? { mode: input.mode } : {}),
            prompt: input.prompt,
            ...(input.parameters ? { parameters: input.parameters } : {}),
            name: name.slice(0, 200),
            ...(references.length ? { references } : {}),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (isProviderUnavailableMessage(message)) {
            throw new ScenarioError('PROVIDER_UNAVAILABLE', message);
          }
          throw error;
        }
        return { job: assetResult.job, refIds };
      },
      (run, scenario, { job, refIds }) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const iteration = this.pushIteration(step, {
          source: 'generated',
          prompt: input.prompt,
          settings: {
            ...(input.mode ? { mode: input.mode } : {}),
            ...(input.parameters ? { parameters: input.parameters } : {}),
            ...(input.scene ? { scene: input.scene } : {}),
          },
          inputs: refIds,
          outputs: [],
          job: {
            jobId: job.id,
            state: job.state,
            modality: input.modality,
            model: input.model,
            ...(job.error ? { error: job.error } : {}),
          },
          requestId: input.requestId,
        });
        if (step.status === 'todo') step.status = 'in-progress';
        return { run, job, iteration };
      },
      { adoptOnConflict: true },
    );
  }

  async sync(input: { runId: string }, host: ScenarioHost): Promise<{ run: ScenarioRun }> {
    const id = validateUuid(input.runId, 'runId');
    const snapshot = await this.readRunRaw(id);
    const scenario = this.requireScenario(snapshot.scenarioId);

    const pending: { stepId: string; iterationId: string; jobId: string; modality: 'image' | 'video' | 'audio' }[] = [];
    for (const step of Object.values(snapshot.steps)) {
      for (const iter of step.iterations) {
        if (iter.job && (iter.job.state === 'queued' || iter.job.state === 'running')) {
          pending.push({ stepId: step.stepId, iterationId: iter.id, jobId: iter.job.jobId, modality: iter.job.modality });
        }
      }
    }
    if (!pending.length) {
      return { run: computeDefaultBindings(snapshot, scenario) };
    }

    // Fetch live job statuses & resolve completed library assets outside scenarios.lock
    type SyncUpdate = {
      stepId: string;
      iterationId: string;
      state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
      error?: string;
      resolvedAssets: { assetId: string; versionId: string; label: string; kind: PoolKind }[];
    };
    const updates: SyncUpdate[] = [];
    for (const item of pending) {
      let statusResult: any;
      try {
        statusResult = await host.assets({ action: 'status', jobId: item.jobId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not_found|not found|unknown job/i.test(message)) {
          updates.push({
            stepId: item.stepId,
            iterationId: item.iterationId,
            state: 'failed',
            error: 'This generation job was interrupted or expired. Click Retry to generate again.',
            resolvedAssets: [],
          });
        }
        continue;
      }
      const job = statusResult?.job;
      if (!job || typeof job.state !== 'string') continue;
      const resolvedAssets: SyncUpdate['resolvedAssets'] = [];
      if (job.state === 'completed' && Array.isArray(job.libraryAssets)) {
        for (const ref of job.libraryAssets as { assetId: string; versionId: string }[]) {
          const resolved = await host.resolveAsset(ref).catch(() => null);
          const kind: PoolKind =
            resolved?.asset.modality === 'image' || resolved?.asset.modality === 'video' || resolved?.asset.modality === 'audio'
              ? resolved.asset.modality
              : item.modality;
          resolvedAssets.push({
            assetId: ref.assetId,
            versionId: ref.versionId,
            label: resolved?.asset.name || `${item.stepId} output`,
            kind,
          });
        }
      }
      updates.push({
        stepId: item.stepId,
        iterationId: item.iterationId,
        state: job.state,
        ...(job.error ? { error: job.error } : {}),
        resolvedAssets,
      });
    }

    return this.lock(async () => {
      const run = await this.readRunRaw(id);
      const liveScenario = this.requireScenario(run.scenarioId);
      let changed = false;

      for (const update of updates) {
        const step = run.steps[update.stepId];
        const iter = step?.iterations.find(candidate => candidate.id === update.iterationId);
        if (!step || !iter || !iter.job) continue;

        if (iter.job.state !== update.state || iter.job.error !== update.error) {
          iter.job.state = update.state;
          if (update.error !== undefined) iter.job.error = update.error;
          else delete iter.job.error;
          changed = true;
        }

        if (update.state === 'completed' && update.resolvedAssets.length) {
          for (const asset of update.resolvedAssets) {
            const poolItem = this.upsertPoolItem(run, {
              kind: asset.kind,
              ref: { type: 'asset', assetId: asset.assetId, versionId: asset.versionId },
              label: asset.label,
              source: 'generated',
              stepId: update.stepId,
            });
            if (!iter.outputs.some(out => out.type === 'pool' && out.poolItemId === poolItem.id)) {
              iter.outputs.push({ type: 'pool', poolItemId: poolItem.id });
              changed = true;
            }
          }
          if (!step.activeIterationId) {
            step.activeIterationId = iter.id;
            changed = true;
          }
        }
      }

      if (changed) {
        run.revision += 1;
        run.updatedAt = Date.now();
        await this.saveRun(run);
      }
      return { run: computeDefaultBindings(run, liveScenario) };
    });
  }

  async cancel(
    input: { runId: string; expectedRevision: number; requestId: string; stepId: string; iterationId: string },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; job: any }> {
    return this.runSideEffectMutation(
      input.runId,
      `cancel:${input.runId}:${input.stepId}:${input.iterationId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, stepId: input.stepId, iterationId: input.iterationId },
      async (snapshot, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const iter = snapshot.steps[stepDef.id]?.iterations.find(it => it.id === input.iterationId);
        if (!iter || !iter.job) {
          throw new ScenarioError('INVALID_ARGUMENT', `Iteration ${input.iterationId} does not have a generation job`);
        }
        const cancelled = await host.assets({ action: 'cancel', jobId: iter.job.jobId });
        return cancelled.job;
      },
      (run, _scenario, job) => {
        const iter = run.steps[input.stepId]?.iterations.find(it => it.id === input.iterationId);
        if (iter?.job) {
          iter.job.state = job.state;
          if (job.error) iter.job.error = job.error;
        }
        return { run, job };
      },
    );
  }

  async promote(input: { runId: string; expectedRevision: number; requestId: string; stepId: string; iterationId: string }): Promise<{ run: ScenarioRun }> {
    return this.runPureMutation(
      input.runId,
      `promote:${input.runId}:${input.stepId}:${input.iterationId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, stepId: input.stepId, iterationId: input.iterationId },
      (run, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const iter = step.iterations.find(it => it.id === input.iterationId);
        if (!iter) throw new ScenarioError('INVALID_ARGUMENT', `Iteration ${input.iterationId} not found in step ${stepDef.id}`);
        step.activeIterationId = iter.id;

        if (iter.design) {
          const item = this.upsertPoolItem(run, {
            kind: 'page',
            ref: { type: 'design', projectId: iter.design.projectId, versionId: iter.design.versionId, revision: iter.design.revision },
            label: `${run.title} · ${stepDef.title}`,
            source: 'step-output',
            stepId: stepDef.id,
          });
          item.ref = { type: 'design', projectId: iter.design.projectId, versionId: iter.design.versionId, revision: iter.design.revision };
        }
        if (iter.outputs.some(out => out.type === 'script')) {
          this.upsertPoolItem(run, {
            kind: 'text',
            ref: { type: 'text', stepId: stepDef.id, iterationId: iter.id },
            label: `${stepDef.title} script v${iter.number}`,
            source: 'step-output',
            stepId: stepDef.id,
          });
        }
        return { run };
      },
    );
  }

  async createPage(
    input: { runId: string; expectedRevision: number; requestId: string; stepId: string; mode: 'starter' | 'template' | 'blank'; templateId?: string; title?: string },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; project: any }> {
    return this.runSideEffectMutation(
      input.runId,
      `create-page:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        stepId: input.stepId,
        mode: input.mode,
        templateId: input.templateId,
        title: input.title,
      },
      async (snapshot, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        if (stepDef.type !== 'web-page' || !stepDef.page) {
          throw new ScenarioError('INVALID_ARGUMENT', `Step ${stepDef.id} is not a web-page step`);
        }
        const pageTitle = input.title ? validateTitle(input.title) : `${snapshot.title} · ${stepDef.title}`.slice(0, 120);

        if (input.mode === 'template') {
          if (!input.templateId) throw new ScenarioError('INVALID_ARGUMENT', 'templateId is required for template mode');
          const project = await host.design.create(
            { requestId: derivedRequestId(input.requestId, 'design-create'), scenario: stepDef.page.designScenario, templateId: input.templateId, title: pageTitle },
            host.origin(),
          );
          return project;
        }
        if (input.mode === 'blank') {
          const project = await host.design.create(
            { requestId: derivedRequestId(input.requestId, 'design-create'), scenario: stepDef.page.designScenario, title: pageTitle },
            host.origin(),
          );
          return project;
        }
        // starter
        const created = await host.design.create(
          { requestId: derivedRequestId(input.requestId, 'design-create'), scenario: stepDef.page.designScenario, title: pageTitle },
          host.origin(),
        );
        const files = scenarioStarterPage(stepDef.page.recipe, snapshot.brief, snapshot.locale);
        const written = await host.design.write(
          created.id,
          {
            requestId: derivedRequestId(input.requestId, 'design-write'),
            expectedRevision: created.revision,
            files,
            summary: 'Scenario starter page',
            source: 'manual',
          },
          host.origin(),
        );
        return written.project;
      },
      (run, scenario, project) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const poolItem = this.upsertPoolItem(run, {
          kind: 'page',
          ref: { type: 'design', projectId: project.id, versionId: project.versionId, revision: project.revision },
          label: project.title,
          source: 'step-output',
          stepId: stepDef.id,
        });
        const iteration = this.pushIteration(step, {
          source: 'local',
          inputs: [],
          outputs: [{ type: 'pool', poolItemId: poolItem.id }],
          design: { projectId: project.id, versionId: project.versionId, revision: project.revision },
          requestId: input.requestId,
        });
        step.links.designProjectId = project.id;
        step.activeIterationId = iteration.id;
        if (step.status === 'todo') step.status = 'in-progress';
        return { run, project };
      },
    );
  }

  async embedImage(
    input: {
      runId: string;
      expectedRevision: number;
      requestId: string;
      stepId: string;
      designProjectId: string;
      expectedDesignRevision: string;
      poolItemId: string;
      target: EmbedImageTarget;
      alt?: string;
    },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; project: any; version: any; path: string }> {
    return this.runSideEffectMutation(
      input.runId,
      `embed-image:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        stepId: input.stepId,
        designProjectId: input.designProjectId,
        expectedDesignRevision: input.expectedDesignRevision,
        poolItemId: input.poolItemId,
        target: input.target,
        alt: input.alt,
      },
      async (snapshot, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        if (stepDef.type !== 'web-page') {
          throw new ScenarioError('INVALID_ARGUMENT', `Step ${stepDef.id} is not a web-page step`);
        }
        const poolItem = snapshot.pool.find(item => item.id === input.poolItemId);
        if (!poolItem) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Pool item ${input.poolItemId} not found`);
        if (poolItem.ref.type !== 'asset' || poolItem.kind !== 'image') {
          throw new ScenarioError('INVALID_ARGUMENT', 'Only image assets from the shared pool can be embedded');
        }

        let resolved;
        try {
          resolved = await host.resolveAsset({ assetId: poolItem.ref.assetId, versionId: poolItem.ref.versionId });
        } catch (error) {
          const message = (error as Error)?.message ?? 'Asset not found';
          if (/ASSET_NOT_FOUND|ASSET_VERSION_UNAVAILABLE/i.test(message)) {
            throw new ScenarioError('ASSET_NOT_FOUND', message);
          }
          throw error;
        }

        try {
          const imported = await host.design.importBinaryFile(
            input.designProjectId,
            {
              requestId: derivedRequestId(input.requestId, 'import'),
              expectedRevision: input.expectedDesignRevision,
              sourcePath: resolved.filename,
              expectedSha256: resolved.version.sha256,
              name: poolItem.label || resolved.asset.name,
              versionId: resolved.version.id,
              summary: `Import ${poolItem.label}`,
              source: 'manual',
            },
            host.origin(),
          );
          const entry = imported.project.entry;
          const file = await host.design.readFile(input.designProjectId, entry);
          const updatedHtml = applyImageToHtml(file.content, input.target, `./${imported.path}`, input.alt ?? poolItem.label);
          const written = await host.design.write(
            input.designProjectId,
            {
              requestId: derivedRequestId(input.requestId, 'write'),
              expectedRevision: imported.project.revision,
              files: [{ path: entry, content: updatedHtml }],
              summary: `Embed ${poolItem.label}`,
              source: 'manual',
            },
            host.origin(),
          );
          return { project: written.project, version: written.version, path: imported.path };
        } catch (error) {
          if (error instanceof DesignError) {
            if (error.code === 'VERSION_CONFLICT') throw new ScenarioError('DESIGN_CONFLICT', error.message);
            if (error.code === 'NOT_FOUND') throw new ScenarioError('INVALID_ARGUMENT', error.message);
            throw new ScenarioError('INVALID_ARGUMENT', error.message);
          }
          throw error;
        }
      },
      (run, scenario, { project, version, path: importedPath }) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const pagePoolItem = this.upsertPoolItem(run, {
          kind: 'page',
          ref: { type: 'design', projectId: project.id, versionId: version.id, revision: project.revision },
          label: project.title,
          source: 'step-output',
          stepId: stepDef.page?.linkedStepId ?? stepDef.id,
        });
        pagePoolItem.ref = { type: 'design', projectId: project.id, versionId: version.id, revision: project.revision };

        const iteration = this.pushIteration(step, {
          source: 'manual',
          inputs: [input.poolItemId],
          outputs: [{ type: 'pool', poolItemId: pagePoolItem.id }],
          design: { projectId: project.id, versionId: version.id, revision: project.revision },
          requestId: input.requestId,
        });
        step.links.designProjectId = project.id;
        step.activeIterationId = iteration.id;
        if (step.status === 'todo') step.status = 'in-progress';
        if (stepDef.page?.linkedStepId && run.steps[stepDef.page.linkedStepId] && !run.steps[stepDef.page.linkedStepId].links.designProjectId) {
          run.steps[stepDef.page.linkedStepId].links.designProjectId = project.id;
        }
        return { run, project, version, path: importedPath };
      },
    );
  }

  async linkDesign(
    input: { runId: string; expectedRevision: number; requestId: string; stepId: string; designProjectId: string },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; project: any }> {
    return this.runSideEffectMutation(
      input.runId,
      `link-design:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, stepId: input.stepId, designProjectId: input.designProjectId },
      async (_snapshot, scenario) => {
        this.requireStep(scenario, input.stepId);
        try {
          return await host.design.get(input.designProjectId, host.origin());
        } catch (error) {
          if (error instanceof DesignError && error.code === 'NOT_FOUND') {
            throw new ScenarioError('INVALID_ARGUMENT', `Design project ${input.designProjectId} not found`);
          }
          throw error;
        }
      },
      (run, scenario, project) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const poolItem = this.upsertPoolItem(run, {
          kind: 'page',
          ref: { type: 'design', projectId: project.id, versionId: project.versionId, revision: project.revision },
          label: project.title,
          source: 'workspace',
          stepId: stepDef.id,
        });
        const iteration = this.pushIteration(step, {
          source: 'workspace',
          inputs: [],
          outputs: [{ type: 'pool', poolItemId: poolItem.id }],
          design: { projectId: project.id, versionId: project.versionId, revision: project.revision },
          requestId: input.requestId,
        });
        step.links.designProjectId = project.id;
        step.activeIterationId = iteration.id;
        if (step.status === 'todo') step.status = 'in-progress';
        return { run, project };
      },
    );
  }

  async createMotion(
    input: {
      runId: string;
      expectedRevision: number;
      requestId: string;
      stepId: string;
      projectType: 'template' | 'natural_language';
      templateId?: string;
      title: string;
      requirements?: string;
      poolItemIds?: string[];
    },
    host: ScenarioHost,
  ): Promise<{ run: ScenarioRun; project: { projectId: string; sessionId: string | null; previewUrl: string } }> {
    const title = validateTitle(input.title).slice(0, 100);
    const poolItemIds = input.poolItemIds ?? [];
    if (poolItemIds.length > 20) throw new ScenarioError('LIMIT_EXCEEDED', 'At most 20 pool assets can be imported into a Motion project');

    return this.runSideEffectMutation(
      input.runId,
      `create-motion:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      {
        expectedRevision: input.expectedRevision,
        stepId: input.stepId,
        projectType: input.projectType,
        templateId: input.templateId,
        title,
        requirements: input.requirements,
        poolItemIds,
      },
      async (snapshot, scenario) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const selectedAssets: { poolItemId: string; assetId: string; versionId: string; label: string }[] = [];
        for (const id of poolItemIds) {
          const item = snapshot.pool.find(entry => entry.id === id);
          if (!item) throw new ScenarioError('POOL_ITEM_NOT_FOUND', `Pool item ${id} not found`);
          if (item.ref.type !== 'asset') throw new ScenarioError('INVALID_ARGUMENT', `Pool item ${id} must be a workspace asset`);
          selectedAssets.push({ poolItemId: id, assetId: item.ref.assetId, versionId: item.ref.versionId, label: item.label });
        }

        const requirements = input.requirements?.trim() || defaultMotionRequirements(scenario, snapshot, stepDef);
        const created = await host.createMotionProject({
          requestId: derivedRequestId(input.requestId, 'motion'),
          projectType: input.projectType,
          ...(input.templateId ? { templateId: input.templateId } : {}),
          title,
          requirements,
        });

        for (let i = 0; i < selectedAssets.length; i += 1) {
          const asset = selectedAssets[i];
          await host.assets({
            action: 'import_to_project',
            projectId: created.projectId,
            requestId: derivedRequestId(input.requestId, `import-${i}`),
            assetId: asset.assetId,
            versionId: asset.versionId,
            name: asset.label,
          });
        }
        return {
          projectId: created.projectId as string,
          sessionId: (created.sessionId as string | undefined) ?? null,
          previewUrl: (created.previewUrl as string | undefined) ?? '',
        };
      },
      (run, scenario, project) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const poolItem = this.upsertPoolItem(run, {
          kind: 'motion',
          ref: { type: 'motion', projectId: project.projectId, sessionId: project.sessionId },
          label: title,
          source: 'step-output',
          stepId: stepDef.id,
        });
        const iteration = this.pushIteration(step, {
          source: 'local',
          inputs: poolItemIds,
          outputs: [{ type: 'pool', poolItemId: poolItem.id }],
          requestId: input.requestId,
        });
        step.links.motionProjectId = project.projectId;
        if (project.sessionId) step.links.motionSessionId = project.sessionId;
        step.activeIterationId = iteration.id;
        if (step.status === 'todo') step.status = 'in-progress';
        return { run, project };
      },
    );
  }

  async linkMotion(input: { runId: string; expectedRevision: number; requestId: string; stepId: string; projectId: string }): Promise<{ run: ScenarioRun }> {
    return this.runSideEffectMutation(
      input.runId,
      `link-motion:${input.runId}:${input.stepId}`,
      input.requestId,
      input.expectedRevision,
      { expectedRevision: input.expectedRevision, stepId: input.stepId, projectId: input.projectId },
      async (_snapshot, scenario) => {
        this.requireStep(scenario, input.stepId);
        const catalog = await this.readMotionCatalog();
        const proj = catalog.projects.find(p => p.id === input.projectId && !p.trashedAt);
        if (!proj) throw new ScenarioError('INVALID_ARGUMENT', `Motion project ${input.projectId} not found`);
        const session = catalog.sessions?.find(s => s.artifacts.some(a => a.projectId === proj.id));
        return { projectId: proj.id, title: proj.title, sessionId: session?.id ?? null };
      },
      (run, scenario, linked) => {
        const stepDef = this.requireStep(scenario, input.stepId);
        const step = run.steps[stepDef.id];
        const poolItem = this.upsertPoolItem(run, {
          kind: 'motion',
          ref: { type: 'motion', projectId: linked.projectId, sessionId: linked.sessionId },
          label: linked.title,
          source: 'workspace',
          stepId: stepDef.id,
        });
        const iteration = this.pushIteration(step, {
          source: 'workspace',
          inputs: [],
          outputs: [{ type: 'pool', poolItemId: poolItem.id }],
          requestId: input.requestId,
        });
        step.links.motionProjectId = linked.projectId;
        if (linked.sessionId) step.links.motionSessionId = linked.sessionId;
        step.activeIterationId = iteration.id;
        if (step.status === 'todo') step.status = 'in-progress';
        return { run };
      },
    );
  }

  async exportBundle(
    input: {
      runId: string;
      requestId: string;
      locale?: string;
      stepIds?: string[];
      poolItemIds?: string[];
      activeOnly?: boolean;
      includeStandaloneHtml?: boolean;
      includeMotionSource?: boolean;
    },
    host: ScenarioHost,
  ): Promise<{ bundle: ScenarioBundleReceipt }> {
    const run = await this.readRunRaw(validateUuid(input.runId, 'runId'));
    const scenario = this.requireScenario(run.scenarioId);
    try {
      const bundle = await buildScenarioBundle(this.dataDirectory, host, run, scenario, {
        requestId: input.requestId,
        locale: input.locale,
        stepIds: input.stepIds,
        poolItemIds: input.poolItemIds,
        activeOnly: input.activeOnly,
        includeStandaloneHtml: input.includeStandaloneHtml,
        includeMotionSource: input.includeMotionSource,
      });
      return { bundle };
    } catch (error) {
      if (error instanceof BundleBuildError) {
        throw new ScenarioError(error.code, error.message.replace(/^[A-Z_]+:\s*/, ''));
      }
      throw error;
    }
  }
}

const runsByDir = new Map<string, ScenarioRuns>();

export function scenarioRunsFor(store: WorkspaceStore): ScenarioRuns {
  const rootStore = store.workspaceStore ?? store;
  const key = path.resolve(rootStore.directory);
  let instance = runsByDir.get(key);
  if (!instance) {
    instance = new ScenarioRuns(key, rootStore);
    runsByDir.set(key, instance);
  } else {
    instance.setStore(rootStore);
  }
  return instance;
}

export async function scenarioOperation(runs: ScenarioRuns, args: any, host: ScenarioHost): Promise<any> {
  if (!args || typeof args !== 'object') {
    throw new ScenarioError('INVALID_ARGUMENT', 'scenario arguments are required');
  }
  switch (args.command) {
    case 'catalog': return runs.catalog();
    case 'list': return runs.list(args);
    case 'get': return runs.get(args.runId);
    case 'create': return runs.create(args);
    case 'update_run': return runs.updateRun(args);
    case 'update_brief': return runs.updateBrief(args);
    case 'update_step': return runs.updateStep(args);
    case 'add_pool': return runs.addPool(args, host);
    case 'update_pool': return runs.updatePool(args);
    case 'remove_pool': return runs.removePool(args);
    case 'add_iteration': return runs.addIteration(args);
    case 'generate': return runs.generate(args, host);
    case 'sync': return runs.sync(args, host);
    case 'cancel': return runs.cancel(args, host);
    case 'promote': return runs.promote(args);
    case 'create_page': return runs.createPage(args, host);
    case 'embed_image': return runs.embedImage(args, host);
    case 'link_design': return runs.linkDesign(args, host);
    case 'create_motion': return runs.createMotion(args, host);
    case 'link_motion': return runs.linkMotion(args);
    case 'export': return runs.exportBundle(args, host);
    default:
      throw new ScenarioError('INVALID_ARGUMENT', `Unknown scenario command: ${String(args.command)}`);
  }
}
