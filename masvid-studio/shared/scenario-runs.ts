import { scenarioDefinitions, socialPlatforms, type PoolKind, type ScenarioId, type SocialPlatformId } from './scenarios.ts';

export const SCENARIO_LIMITS = {
  poolItems: 500,
  iterationsPerStep: 50,
  runBytes: 2_000_000,
  briefValue: 4000,
  postText: 5000,
  runsListed: 200,
  bundleBytes: 500 * 1024 * 1024,
} as const;

export type PoolRef =
  | { type: 'asset'; assetId: string; versionId: string }
  | { type: 'design'; projectId: string; versionId: string | null; revision: string }
  | { type: 'motion'; projectId: string; sessionId: string | null }
  | { type: 'text'; stepId: string; iterationId: string };

export type PoolItem = {
  id: string;
  kind: PoolKind;
  ref: PoolRef;
  label: string;
  source: 'upload' | 'workspace' | 'generated' | 'step-output' | 'agent';
  stepId: string | null;
  tags: string[];
  pinned: boolean;
  addedAt: number;
};

export type SocialPost = {
  id: string;
  platform: SocialPlatformId;
  title?: string;
  text: string;
  hashtags: string[];
  mediaPoolItemIds: string[];
  link?: string;
  aspect: string;
};

export type IterationOutput =
  | { type: 'pool'; poolItemId: string }
  | { type: 'brief'; values: Record<string, string | string[]> }
  | { type: 'script'; text: string }
  | { type: 'social'; posts: SocialPost[] };

export type StepIteration = {
  id: string;
  number: number;
  createdAt: number;
  source: 'generated' | 'local' | 'agent' | 'manual' | 'upload' | 'workspace';
  prompt?: string;
  settings?: Record<string, unknown>;
  inputs: string[];
  outputs: IterationOutput[];
  job?: {
    jobId: string;
    state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
    modality: 'image' | 'video' | 'audio';
    model: string;
    error?: string;
  };
  design?: { projectId: string; versionId: string | null; revision: string };
  note?: string;
  requestId?: string;
};

export type ScenarioStepState = {
  stepId: string;
  status: 'todo' | 'in-progress' | 'done' | 'skipped';
  iterations: StepIteration[];
  activeIterationId: string | null;
  bindings: Record<string, string[]>;
  draft: Record<string, unknown>;
  links: { designProjectId?: string; motionProjectId?: string; motionSessionId?: string };
};

export function findOutputIteration(
  step: Pick<ScenarioStepState, 'iterations' | 'activeIterationId'> | undefined,
  type: IterationOutput['type'],
): StepIteration | undefined {
  if (!step) return undefined;
  const providesOutput = (iter: StepIteration) => iter.outputs.some(out => out.type === type);
  const active = step.iterations.find(iter => iter.id === step.activeIterationId && providesOutput(iter));
  if (active) return active;
  for (let i = step.iterations.length - 1; i >= 0; i -= 1) {
    if (providesOutput(step.iterations[i])) return step.iterations[i];
  }
}

export type ScenarioRun = {
  schemaVersion: 1;
  id: string;
  scenarioId: ScenarioId;
  title: string;
  locale: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  revision: number;
  brief: Record<string, string | string[]>;
  activeStepId: string;
  steps: Record<string, ScenarioStepState>;
  pool: PoolItem[];
};

export type ScenarioRunSummary = Pick<
  ScenarioRun,
  'id' | 'scenarioId' | 'title' | 'createdAt' | 'updatedAt' | 'archivedAt' | 'revision' | 'activeStepId'
> & {
  poolCount: number;
  doneSteps: number;
  pendingJobs: number;
};

export type ScenarioBundleReceipt = {
  bundleId: string;
  filename: string;
  bytes: number;
  sha256: string;
  archivePath: string;
  downloadUrl: string;
  entries: number;
};

export const scenarioCommands = [
  'catalog', 'list', 'get', 'create', 'update_run', 'update_brief', 'update_step',
  'add_pool', 'update_pool', 'remove_pool', 'add_iteration', 'generate', 'sync',
  'cancel', 'promote', 'create_page', 'embed_image', 'link_design',
  'create_motion', 'link_motion', 'export',
] as const;
export type ScenarioCommand = typeof scenarioCommands[number];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const projectIdSchema = { type: 'string', pattern: '^(project|[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12})$' };
const requestId = { type: 'string', pattern: '^[\\w-]{1,100}$' };
const revision = { type: 'integer', minimum: 1 };
const designRevision = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const stepIdSchema = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,63}$' };
const scenarioIdSchema = { enum: scenarioDefinitions.map(scenario => scenario.id) };
const platformIdSchema = { enum: socialPlatforms.map(platform => platform.id) };

const poolRefSchema = {
  oneOf: [
    obj({ type: { enum: ['asset'] }, assetId: uuid, versionId: uuid }, ['type', 'assetId', 'versionId']),
    obj({ type: { enum: ['design'] }, projectId: uuid, versionId: {}, revision: designRevision }, ['type', 'projectId']),
    obj({ type: { enum: ['motion'] }, projectId: projectIdSchema, sessionId: {} }, ['type', 'projectId']),
    obj({ type: { enum: ['text'] }, stepId: stepIdSchema, iterationId: uuid }, ['type', 'stepId', 'iterationId']),
  ],
};

const addPoolItemSchema = obj({
  ref: poolRefSchema,
  label: { type: 'string', minLength: 1, maxLength: 200 },
  tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 60 } },
  stepId: {},
  source: { enum: ['upload', 'workspace', 'generated', 'step-output', 'agent'] },
}, ['ref', 'source']);

const socialPostSchema = obj({
  id: { type: 'string', minLength: 1, maxLength: 100 },
  platform: platformIdSchema,
  title: { type: 'string', maxLength: 200 },
  text: { type: 'string', maxLength: SCENARIO_LIMITS.postText },
  hashtags: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 80 } },
  mediaPoolItemIds: { type: 'array', maxItems: 20, items: uuid },
  link: { type: 'string', maxLength: 2000 },
  aspect: { type: 'string', minLength: 1, maxLength: 20 },
}, ['id', 'platform', 'text', 'hashtags', 'mediaPoolItemIds', 'aspect']);

const iterationOutputSchema = {
  oneOf: [
    obj({ type: { enum: ['pool'] }, poolItemId: uuid }, ['type', 'poolItemId']),
    obj({ type: { enum: ['brief'] }, values: { type: 'object', additionalProperties: true } }, ['type', 'values']),
    obj({ type: { enum: ['script'] }, text: { type: 'string', maxLength: 20000 } }, ['type', 'text']),
    obj({ type: { enum: ['social'] }, posts: { type: 'array', maxItems: 20, items: socialPostSchema } }, ['type', 'posts']),
  ],
};

const iterationInputSchema = obj({
  source: { enum: ['generated', 'local', 'agent', 'manual', 'upload', 'workspace'] },
  prompt: { type: 'string', maxLength: 20000 },
  settings: { type: 'object', additionalProperties: true },
  inputs: { type: 'array', maxItems: 50, items: uuid },
  outputs: { type: 'array', maxItems: 50, items: iterationOutputSchema },
  note: { type: 'string', maxLength: 2000 },
}, ['source']);

const embedTargetSchema = {
  oneOf: [
    obj({ kind: { enum: ['slot'] }, slot: { type: 'string', minLength: 1, maxLength: 64 } }, ['kind', 'slot']),
    obj({ kind: { enum: ['img'] }, index: { type: 'integer', minimum: 0, maximum: 500 } }, ['kind', 'index']),
    obj({ kind: { enum: ['append'] } }, ['kind']),
  ],
};

const commonMutate = ['runId', 'expectedRevision', 'requestId'];

const commandRequirements: Record<ScenarioCommand, { required: string[]; extraProperties?: Record<string, unknown> }> = {
  catalog: { required: [] },
  list: { required: [] },
  get: { required: ['runId'] },
  create: { required: ['requestId', 'scenarioId'] },
  update_run: { required: [...commonMutate, 'changes'] },
  update_brief: { required: [...commonMutate, 'brief'] },
  update_step: { required: [...commonMutate, 'stepId'] },
  add_pool: { required: [...commonMutate, 'items'] },
  update_pool: { required: [...commonMutate, 'poolItemId', 'changes'] },
  remove_pool: { required: [...commonMutate, 'poolItemId'] },
  add_iteration: { required: [...commonMutate, 'stepId', 'iteration'] },
  generate: {
    required: [...commonMutate, 'stepId', 'modality', 'model', 'prompt'],
    extraProperties: { mode: { enum: ['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'] } },
  },
  sync: { required: ['runId'] },
  cancel: { required: [...commonMutate, 'stepId', 'iterationId'] },
  promote: { required: [...commonMutate, 'stepId', 'iterationId'] },
  create_page: {
    required: [...commonMutate, 'stepId', 'mode'],
    extraProperties: { mode: { enum: ['starter', 'template', 'blank'] } },
  },
  embed_image: { required: [...commonMutate, 'stepId', 'designProjectId', 'expectedDesignRevision', 'poolItemId', 'target'] },
  link_design: { required: [...commonMutate, 'stepId', 'designProjectId'] },
  create_motion: { required: [...commonMutate, 'stepId', 'projectType', 'title'] },
  link_motion: { required: [...commonMutate, 'stepId', 'projectId'] },
  export: { required: ['runId', 'requestId'] },
};

export const scenarioToolArguments = {
  ...obj({
    command: { enum: [...scenarioCommands] },
    runId: uuid,
    expectedRevision: revision,
    requestId,
    scenarioId: scenarioIdSchema,
    includeArchived: { type: 'boolean' },
    offset: { type: 'integer', minimum: 0, maximum: 10_000 },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    title: { type: 'string', minLength: 1, maxLength: 120 },
    locale: { type: 'string', minLength: 2, maxLength: 35, description: 'Draft locale on create, or the locale for generated and exported media names. Generation and export default to the saved draft locale.' },
    brief: { type: 'object', additionalProperties: true },
    changes: obj({
      title: { type: 'string', minLength: 1, maxLength: 120 },
      archived: { type: 'boolean' },
      activeStepId: stepIdSchema,
      label: { type: 'string', minLength: 1, maxLength: 200 },
      tags: { type: 'array', maxItems: 20, items: { type: 'string', minLength: 1, maxLength: 60 } },
      pinned: { type: 'boolean' },
    }),
    stepId: stepIdSchema,
    status: { enum: ['todo', 'in-progress', 'done', 'skipped'] },
    draft: { type: 'object', additionalProperties: true },
    bindings: { type: 'object', additionalProperties: { type: 'array', items: uuid, maxItems: 50 } },
    activeIterationId: {},
    iterationNote: obj({ iterationId: uuid, note: { type: 'string', maxLength: 2000 } }, ['iterationId', 'note']),
    items: { type: 'array', minItems: 1, maxItems: 50, items: addPoolItemSchema },
    poolItemId: uuid,
    iteration: iterationInputSchema,
    iterationId: uuid,
    recordIteration: { type: 'boolean' },
    note: { type: 'string', maxLength: 2000 },
    modality: { enum: ['image', 'video', 'audio'] },
    model: { type: 'string', minLength: 1, maxLength: 300 },
    mode: { enum: ['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech', 'starter', 'template', 'blank'] },
    prompt: { type: 'string', minLength: 1, maxLength: 20000 },
    parameters: { type: 'object', additionalProperties: true },
    referencePoolItemIds: { type: 'array', maxItems: 20, items: uuid },
    scene: { type: 'string', minLength: 1, maxLength: 80 },
    templateId: { type: 'string', minLength: 1, maxLength: 128 },
    designProjectId: uuid,
    expectedDesignRevision: designRevision,
    target: embedTargetSchema,
    alt: { type: 'string', maxLength: 400 },
    projectType: { enum: ['template', 'natural_language'] },
    requirements: { type: 'string', minLength: 1, maxLength: 8000 },
    poolItemIds: { type: 'array', maxItems: SCENARIO_LIMITS.poolItems, items: uuid },
    projectId: projectIdSchema,
    stepIds: { type: 'array', minItems: 1, maxItems: 20, items: stepIdSchema },
    activeOnly: { type: 'boolean' },
    includeStandaloneHtml: { type: 'boolean' },
    includeMotionSource: { type: 'boolean' },
  }, ['command']),
  oneOf: scenarioCommands.map(command => ({
    type: 'object',
    properties: { command: { enum: [command] }, ...(commandRequirements[command].extraProperties ?? {}) },
    required: commandRequirements[command].required,
    additionalProperties: true,
  })),
};

export const scenarioToolDescription = ' action=scenario takes a scenario command to orchestrate end-to-end scenario workflows (catalog, list, get, create, update_run, update_brief, update_step, add_pool, update_pool, remove_pool, add_iteration, generate, sync, cancel, promote, create_page, embed_image, link_design, create_motion, link_motion, export). Runs store pinned workspace Assets, Design Studio and Motion project references rather than copying bytes; pass stable requestId and expectedRevision on mutations, poll generate jobs with sync without resubmitting paid work, call add_pool with recordIteration=true (and stepId on items) to save Agent-refined assets into both Assets and step version history atomically, and call export (optionally passing poolItemIds or stepIds) to build a downloadable ZIP package of selected assets or all deliverables.';

export function parseScenarioError(message: string): { code: string; message: string } {
  const match = /^([A-Z][A-Z0-9_]{1,63}):\s*([\s\S]*)$/.exec(message.trim());
  if (match) {
    return { code: match[1], message: match[2].trim() || match[1] };
  }
  return { code: 'SCENARIO_ERROR', message: message.trim() || 'Scenario request failed' };
}
