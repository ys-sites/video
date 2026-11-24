import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OmTracking } from '../shared/tracking.ts';
import { WorkspaceStore } from '../workspace.ts';
import { legacyRemoteTerminal, modelReferenceLimit, resumableJob, mediaProviders, modalities, type Agent, type GenerateInput, type GenerationJob, type GatewayStatus, type Model, type Modality, type ProviderId, type ProviderState } from '../shared/gateway.ts';
import { builtinModels, discoverModels, modelKey, providerIds, providerLabels, validModelId } from './catalog.ts';
import { detectAgents, generateCodexImage } from './agents.ts';
import { downloadMedia, mediaType, publicProviderFetch, ProviderError, retryRead, type Fetcher } from './network.ts';
import { providerAdapters, waveSpeedModels } from './providers.ts';
import { cloudModels } from './opendesign.ts';
import { ProviderConnections, type GatewayConfig } from './connections.ts';
import { isGatewayProvider, isMediaProvider, registeredProvider } from '../shared/provider-registry.ts';
import { compatibleProvider } from './compatible.ts';
import { OpenDesignAccount } from './account.ts';
import { accountMediaState } from './account-media.ts';
import { AssetLibrary } from './asset-library.ts';
import { requireLibraryMediaRuntime } from './asset-probe.ts';
import { generationOptions, resolveGenerationParameters, validateGenerationOptions } from '../shared/generation-options.ts';
import { audioAssetTitle, classifyAudioKind } from '../shared/audio-kind.ts';
import { MAX_ASSET_BYTES } from '../shared/asset-limits.ts';

/** Queued input-image snapshot; the first keeps its historical name for older jobs. */
const referenceFile = (index: number, mimeType: string) => (index ? `reference-${index}.` : 'reference.') + (mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1]);

type Options = { tracking?: OmTracking; fetcher?: Fetcher; detect?: () => Promise<Agent[]>; codex?: typeof generateCodexImage; download?: typeof downloadMedia; pollMs?: number };
type SavedOutput = { path: string; mimeType: string; bytes: number; sha256: string };
const saveUnavailable = 'SAVE_NOT_AVAILABLE: retained outputs are missing, changed or unreadable; no model request was made';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function alive(pid?: number) { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } }
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw new Error('Model gateway data is unreadable'); }
}
async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 }); await rename(temp, file); }
  finally { await rm(temp, { force: true }); }
}
function providerId(value: unknown): asserts value is ProviderId {
  if (!providerIds.includes(value as ProviderId)) throw new Error('Unknown model provider');
}
function modality(value: unknown): asserts value is Modality {
  if (!modalities.includes(value as Modality)) throw new Error('modality must be image, video or audio');
}
function parameters(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 64_000) throw new Error('parameters must be an object under 64 KB');
  if (Object.keys(value).some(key => /^(?:model|prompt|api[_-]?key|authorization|webhook_url|__proto__|constructor|prototype)$/i.test(key))) throw new Error('parameters contains a reserved field');
  return value as Record<string, unknown>;
}

export class ModelGateway {
  store: WorkspaceStore;
  options: Options;
  root: string;
  connections: ProviderConnections;
  account: OpenDesignAccount;
  active = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private cloudFailure?: { identity: string; time: number };
  private cloudReads = new Map<string, Promise<string | undefined>>();
  private detecting?: Promise<Agent[]>;
  private agentCache?: { time: number; agents: Agent[] };
  private ticking = false;
  private closed = false;
  constructor(store: WorkspaceStore, options: Options = {}) {
    this.store = store; this.options = options; this.root = path.join(store.directory, 'model-gateway');
    this.connections = new ProviderConnections(store, options.fetcher ?? publicProviderFetch);
    this.account = new OpenDesignAccount(store.directory);
  }
  config(): Promise<GatewayConfig> { return this.connections.gatewayConfig(); }
  private credential(id: ProviderId) { return this.connections.resolveCredential(id); }
  async configureProvider(id: unknown, input: Record<string, unknown>) {
    if (typeof id !== 'string') throw new Error('Unknown model provider');
    await this.connections.configure(id, input);
    return this.status();
  }
  private cloudOrigin() { return this.connections.baseUrl('opendesign'); }
  async agents(refresh = false) {
    if (!refresh && this.agentCache && Date.now() - this.agentCache.time < 30_000) return this.agentCache.agents;
    if (!this.detecting) this.detecting = (this.options.detect ?? detectAgents)().then(agents => { this.agentCache = { time: Date.now(), agents }; return agents; }).finally(() => { this.detecting = undefined; });
    return this.detecting;
  }
  /** Bind private catalogue metadata to its effective credential, origin and configuration generation. */
  private async cloudContext() {
    const key = (await this.credential('opendesign')).key, baseUrl = await this.cloudOrigin();
    const state = (await this.config()).providers.opendesign;
    return { key, baseUrl, identity: key && baseUrl && state?.enabled !== false ? hash(JSON.stringify([baseUrl, key, state?.catalogRevision])) : undefined };
  }
  private async cachedCloudModels(): Promise<Model[]> {
    const context = await this.cloudContext();
    const cached = await readJson<{ identity?: string; models?: Model[] }>(path.join(this.root, 'cloud-catalog.json'), {});
    return context.identity && cached.identity === context.identity && Array.isArray(cached.models) && (await this.cloudContext()).identity === context.identity ? cached.models : [];
  }
  private async syncCloudModels(refresh: boolean): Promise<string | undefined> {
    const context = await this.store.lock(() => this.cloudContext());
    if (!context.identity) return;
    const cached = await readJson<{ identity?: string; models?: Model[] }>(path.join(this.root, 'cloud-catalog.json'), {});
    if (!refresh && cached.identity === context.identity && Array.isArray(cached.models)) return;
    if (!refresh && this.cloudFailure?.identity === context.identity && Date.now() - this.cloudFailure.time < 30_000) return 'OpenDesign Cloud catalogue unavailable; sync models to retry';
    const current = this.cloudReads.get(context.identity);
    if (current) return current;
    const read = (async (): Promise<string | undefined> => {
      try {
        const models = await cloudModels(context.baseUrl!, context.key, this.options.fetcher ?? publicProviderFetch);
        return await this.store.lock(async () => {
          if ((await this.cloudContext()).identity !== context.identity) return undefined;
          await atomic(path.join(this.root, 'cloud-catalog.json'), { identity: context.identity, models });
          this.cloudFailure = undefined;
          return undefined;
        });
      } catch {
        if ((await this.cloudContext()).identity !== context.identity) return;
        this.cloudFailure = { identity: context.identity, time: Date.now() };
        return 'OpenDesign Cloud catalogue unavailable; only cached models for the current connection and built-in models are shown';
      }
    })();
    this.cloudReads.set(context.identity, read);
    try { return await read; } finally { this.cloudReads.delete(context.identity); }
  }
  private async models(): Promise<Model[]> {
    const cached = await readJson<Model[]>(path.join(this.root, 'catalog.json'), []);
    const overrides = await this.connections.modelOverrides();
    const custom = (await this.config()).customModels, compatible = await this.connections.mediaModels(), account = await this.account.mediaModels();
    // Read bound Cloud rows last: no asynchronous work may revive them after this identity check.
    const cloud = await this.cachedCloudModels();
    return [...new Map([...builtinModels, ...cached.filter(model => model.provider !== 'opendesign'), ...cloud, ...custom, ...compatible, ...account].map(model => [model.id, model])).values()].map(model => {
      const live = cloud.find(row => row.id === model.id);
      const merged = { ...model, ...overrides[model.id], ...(live ? { supportsImageReference: live.supportsImageReference, maxInputImages: live.maxInputImages, nativeOptions: live.nativeOptions } : {}) };
      const normalized = ['opendesign', 'account'].includes(merged.provider) && merged.modality === 'image' && merged.supportsImageReference
        ? { ...merged, maxInputImages: modelReferenceLimit(merged) }
        : merged;
      return { ...normalized, generationOptions: generationOptions(normalized) };
    });
  }
  async listModels(input: { provider?: unknown; modality?: unknown; query?: unknown; refresh?: unknown; offset?: unknown; limit?: unknown } = {}) {
    if (input.provider !== undefined && input.provider !== 'account' && !providerIds.includes(input.provider as string) && !(await this.connections.list()).some(p => p.id === input.provider)) throw new Error('Unknown model provider');
    if (input.modality !== undefined) modality(input.modality);
    if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 200)) throw new Error('Invalid model search');
    if (input.refresh !== undefined && typeof input.refresh !== 'boolean') throw new Error('refresh must be boolean');
    const warnings: string[] = [];
    if (input.provider === 'opendesign' || input.refresh === true && !input.provider) { const warning = await this.syncCloudModels(input.refresh === true); if (warning) warnings.push(warning); }
    if (input.refresh && input.provider === 'account') await this.account.models(true);
    if (input.refresh && typeof input.provider === 'string' && input.provider !== 'account' && !providerIds.includes(input.provider)) await this.connections.sync(input.provider);
    if (input.refresh) {
      const selected = mediaProviders.filter(id => id !== 'opendesign').filter(id => !input.provider || input.provider === id);
      const discovered = await Promise.all(selected.map(async id => {
        try {
          if (id === 'wavespeed') {
            const key = (await this.credential(id)).key;
            return key ? await waveSpeedModels(key, this.options.fetcher ?? fetch) : [];
          }
          return await discoverModels(id, String(input.query ?? ''), this.options.fetcher ?? fetch);
        }
        catch { warnings.push(`${providerLabels[id]} catalogue unavailable; showing cached and built-in models`); return []; }
      }));
      await this.store.lock(async () => {
        const cached = await readJson<Model[]>(path.join(this.root, 'catalog.json'), []);
        const merged = [...new Map([...cached.filter(model => model.provider !== 'opendesign'), ...discovered.flat()].map(model => [model.id, model])).values()].slice(-5000);
        await atomic(path.join(this.root, 'catalog.json'), merged);
      });
    }
    const query = String(input.query ?? '').toLowerCase();
    const all = (await this.models()).filter(model => (!input.provider || model.provider === input.provider) && (!input.modality || model.modality === input.modality)
      && (!query || `${model.id} ${model.label} ${model.mode} ${model.description ?? ''}`.toLowerCase().includes(query)));
    const offset = input.offset ?? 0, limit = input.limit ?? 100;
    if (!Number.isInteger(offset) || Number(offset) < 0 || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('Invalid model pagination');
    return { models: all.slice(Number(offset), Number(offset) + Number(limit)), total: all.length,
      nextOffset: Number(offset) + Number(limit) < all.length ? Number(offset) + Number(limit) : null, warnings };
  }
  async registerModel(input: { provider?: unknown; modelId?: unknown; label?: unknown; modality?: unknown; mode?: unknown; defaults?: unknown }) {
    providerId(input.provider); validModelId(input.modelId); modality(input.modality);
    if (input.provider === 'codex') throw new Error('Codex exposes its built-in image model only');
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 180) throw new Error('A model label is required');
    if (typeof input.mode !== 'string' || !/^[a-z-]{3,60}$/.test(input.mode)) throw new Error('A generation mode is required');
    const model: Model = { id: modelKey(input.provider, input.modelId), provider: input.provider, modelId: input.modelId, label: input.label.trim(),
      modality: input.modality, mode: input.mode, source: 'custom', defaults: parameters(input.defaults) };
    await this.connections.saveMediaModel(model);
    return { model };
  }
  async setRoute(kind: unknown, modelId: unknown) {
    modality(kind);
    if (modelId !== null && !(await this.models()).some(m => m.id === modelId && m.modality === kind)) throw new Error('Route must select a model of the same modality');
    await this.connections.setDefault(kind, modelId as string | null);
    return this.status();
  }
  async status(refreshAgents = false, options: { refreshAccount?: boolean } = {}): Promise<GatewayStatus> {
    const accountSummary = this.account.summary(options.refreshAccount === true);
    const [config, agents, models, account] = await Promise.all([
      this.config(), this.agents(refreshAgents),
      // A billing refresh can sync newly entitled models before we calculate media capabilities.
      options.refreshAccount ? accountSummary.then(() => this.models()) : this.models(),
      accountSummary,
    ]);
    const providers: ProviderState[] = await Promise.all(providerIds.map(async id => {
      const saved = config.providers[id] ?? {};
      const enabled = saved.enabled !== false;
      if (id === 'codex') {
        const agent = agents.find(a => a.id === id);
        return { id, label: providerLabels[id], enabled, configured: !!agent?.authenticated, available: enabled && !!agent?.available,
          credentialSource: 'local-agent', verification: 'unverified', reason: !enabled ? 'Disabled' : agent?.reason ?? 'Not detected' };
      }
      const credentials = await this.credential(id);
      const definition = registeredProvider(id)!;
      const baseUrl = definition.baseUrlEditable ? await this.connections.baseUrl(id) : undefined;
      const active = !!credentials.key;
      const verification = credentials.key && saved.keyHash === hash(credentials.key) ? saved.verification ?? 'unverified' : 'unverified';
      return { id, label: providerLabels[id], enabled: active && enabled, configured: !!credentials.key, available: active && enabled && (!definition.baseUrlEditable || !!baseUrl) && verification !== 'rejected',
        ...(definition.baseUrlEditable ? { baseUrl: baseUrl ?? '' } : {}),
        credentialSource: credentials.source, verification, checkedAt: saved.checkedAt,
        reason: !active ? 'API key required' : !enabled ? 'Disabled' : definition.baseUrlEditable && !baseUrl ? `${definition.label} API origin required` : verification === 'rejected' ? 'Credentials or permissions rejected; update the key' : verification === 'verified' ? 'A generation request succeeded with this key' : 'Configured; availability and quota are checked when generating' };
    }));
    providers.push(...await this.connections.states());
    const accountMedia = accountMediaState(account);
    providers.push({ id: 'account', label: registeredProvider('account')!.label, enabled: account.state === 'signed-in', configured: account.state === 'signed-in', available: account.state === 'signed-in', credentialSource: 'account', verification: 'unverified', ...accountMedia });
    const mediaProviders = new Set(providers.filter(p => p.available && !(p.id === 'account' && accountMedia.mediaEntitlement === 'not-included')).map(p => p.id));
    const capabilities = modalities.map(kind => {
      const available = models.filter(model => model.modality === kind && mediaProviders.has(model.provider));
      const selected = config.routes[kind] ? available.find(m => m.id === config.routes[kind]) : available.find(m => m.mode.startsWith('text-to-'));
      return { modality: kind, available: available.length > 0, modelIds: available.map(m => m.id), selectedModelId: selected?.id };
    });
    return { providers, agents, routes: config.routes, capabilities };
  }
  async getJob(id: unknown) {
    if (!uuid(id)) throw new Error('Invalid generation job ID');
    const job = await readJson<GenerationJob | null>(path.join(this.root, 'jobs', id + '.json'), null);
    if (!job) throw new Error('Generation job not found');
    // Jobs preserve their original output paths. Studio can subsequently rename/delete files.
    for (const asset of job.assets) {
      const target = job.library ? await this.store.safePath(asset.path, new AssetLibrary(this.store).root)
        : await this.store.safePath(asset.path, this.store.projectDirectoryFor(job.projectId!));
      asset.available = await lstat(target).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
    }
    return job;
  }
  async listJobs(projectId?: string) {
    const names = await readdir(path.join(this.root, 'jobs')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
    const jobs = await Promise.all(names.filter(name => uuid(name.slice(0, -5)) && name.endsWith('.json')).map(name => this.getJob(name.slice(0, -5))));
    return jobs.filter(job => !projectId || job.projectId === projectId).sort((a, b) => b.createdAt - a.createdAt);
  }
  private saveJob(job: GenerationJob) { return atomic(path.join(this.root, 'jobs', job.id + '.json'), job); }
  private async saveResult(job: GenerationJob) {
    if (job.state === 'queued' || job.state === 'running') throw new Error('Expected a terminal generation job');
    await this.saveJob(job);
    this.options.tracking?.track('media_generation_result', {
      modality: job.modality, job_id: job.id, job_state: job.state,
      asset_count: Math.max(job.assets.length, job.libraryAssets?.length ?? 0),
    }, undefined, 'worker');
  }
  async submit(input: GenerateInput): Promise<GenerationJob> {
    if (!input || typeof input !== 'object') throw new Error('Generation input required');
    modality(input.modality);
    this.options.tracking?.track('media_generation_requested', { modality: input.modality }, undefined, 'worker');
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 20_000) throw new Error('Prompt must contain 1–20000 characters');
    const params = parameters(input.parameters);
    if (input.library && input.projectId) throw new Error('Choose either an asset library or a project destination');
    const library = new AssetLibrary(this.store);
    if (input.library?.references !== undefined && !Array.isArray(input.library.references)) throw new Error('Asset references must be an array');
    if (input.referenceAsset !== undefined && (typeof input.referenceAsset !== 'string' || !input.referenceAsset || input.referenceAsset.length > 1024)) throw new Error('Invalid reference image path');
    if (input.idempotencyKey !== undefined && (typeof input.idempotencyKey !== 'string' || !/^[\w-]{1,100}$/.test(input.idempotencyKey))) throw new Error('Invalid idempotency key');
    if (input.usage && (typeof input.usage !== 'object' || Object.entries(input.usage).some(([key, value]) => !['compositionId', 'elementId', 'property'].includes(key) || typeof value !== 'string' || value.length > 240))) throw new Error('Invalid editor usage context');
    const cloudIdentity = await this.store.lock(async () => (await this.cloudContext()).identity);
    const status = await this.status();
    const selected = input.model ?? status.routes[input.modality] ?? status.capabilities.find(c => c.modality === input.modality)?.selectedModelId;
    let model = (await this.models()).find(m => m.id === selected && m.modality === input.modality);
    if (!model && typeof selected === 'string') {
      const colon = selected.indexOf(':'), provider = mediaProviders.find(id => id === selected.slice(0, colon)), modelId = selected.slice(colon + 1);
      if (provider) {
        validModelId(modelId);
        model = { id: selected, provider, modelId, label: modelId, modality: input.modality, mode: input.mode ?? `text-to-${input.modality}`, source: 'custom' };
      }
    }
    if (input.mode !== undefined && !['text-to-image', 'text-to-video', 'text-to-audio', 'text-to-speech'].includes(input.mode)) throw new Error('Unsupported generation mode');
    if (input.mode && input.mode !== `text-to-${input.modality}` && !(input.modality === 'audio' && input.mode === 'text-to-speech')) throw new Error('Generation mode does not match modality');
    // Account and Cloud catalogues select distinct operations for speech and other audio.
    if (model && ['account', 'opendesign'].includes(model.provider) && input.mode && input.mode !== model.mode) throw new Error(`Generation mode does not match the selected ${model.provider === 'account' ? 'account' : 'Cloud'} model`);
    if (model && input.mode) model = { ...model, mode: input.mode };
    const projectId = input.library ? undefined : input.projectId ?? this.store.projectCatalog().activeId;
    const requestHash = hash(JSON.stringify({ projectId, library: input.library, model: input.model ?? null, modality: input.modality, prompt: input.prompt, parameters: params, mode: input.mode, usage: input.usage, ...(input.referenceAsset ? { referenceAsset: input.referenceAsset } : {}) }));
    return this.store.lock(async () => {
      if (!input.library) {
        if (!this.store.projectCatalog().projects.some(p => p.id === projectId)) throw new Error('Project not found');
        const entry = await this.store.safePath('index.html', this.store.projectDirectoryFor(projectId!));
        await lstat(entry).catch(() => { throw new Error('Open a project before generating media'); });
      }
      const jobs = await this.listJobs();
      const previous = input.idempotencyKey ? jobs.find(j => j.idempotencyKey === input.idempotencyKey && j.projectId === projectId) : undefined;
      if (previous) { if (previous.requestHash !== requestHash) throw new Error('Idempotency key was already used for another request'); return previous; }
      if (!model || !status.providers.find(p => p.id === model.provider)?.available) throw new Error('Selected model is unavailable; configure an available provider or choose a different model');
      if (model.provider === 'opendesign' && (await this.cloudContext()).identity !== cloudIdentity) throw new Error('Cloud configuration changed; reload models before generating');
      const referenceCount = (input.library?.references?.length ?? 0) + (input.referenceAsset ? 1 : 0);
      const resolvedParameters = resolveGenerationParameters(model, params, referenceCount > 0);
      validateGenerationOptions(model, resolvedParameters, referenceCount > 0);
      // Video sends only a first frame; the project-direct referenceAsset route stays image-only as before.
      const referenceLimit = input.referenceAsset && input.modality !== 'image' ? 0 : modelReferenceLimit(model);
      if (referenceCount && model.provider === 'opendesign' && model.modality === 'image' && model.supportsImageReference === undefined) throw new Error('Image editing capability is unknown. Sync Cloud models before using references.');
      if (referenceCount && !referenceLimit) throw new Error(input.modality === 'video' ? 'This video model does not accept an input image. Choose a video model with maxInputImages, or remove the reference.'
        : input.referenceAsset ? 'Selected model does not support reference image editing' : 'This model does not support asset references. Choose an image model that supports editing, or remove the reference.');
      if (referenceCount > referenceLimit) throw new Error(`This model accepts at most ${referenceLimit} input image${referenceLimit === 1 ? '' : 's'}`);
      if (referenceCount && input.referenceAsset && input.library) throw new Error('Choose library references or a project referenceAsset');
      if (model.provider === 'opendesign' && referenceCount && resolvedParameters.images !== undefined) throw new Error('Choose pinned references or parameters.images for Cloud input');
      if (input.library) await library.validateGeneration(input.library);
      if (input.library?.assetId && (await library.get(input.library.assetId)).modality !== input.modality) throw new Error('Asset versions must have the same media type');
      if (jobs.filter(j => j.state === 'queued' || j.state === 'running').length >= 20) throw new Error('Generation queue is full (20 jobs)');
      const storedParameters = model.mode === 'text-to-speech' && typeof resolvedParameters.voice === 'string' && !params.voice
        ? { ...params, voice: resolvedParameters.voice }
        : params;
      const job: GenerationJob = { id: randomUUID(), saveToLibrary: true, ...(input.library ? { library: { ...input.library, createNew: !input.library.assetId, assetId: input.library.assetId ?? randomUUID() } } : { projectId }), state: 'queued', modality: input.modality, prompt: input.prompt.trim(), model,
        ...(model.provider === 'account' ? { providerOrigin: await this.account.identity() } : model.provider === 'opendesign' ? { providerOrigin: await this.cloudOrigin() }
          : !isGatewayProvider(model.provider) ? { providerOrigin: await this.connections.baseUrl(model.provider) } : {}),
        ...(!isGatewayProvider(model.provider) && model.provider !== 'account' ? { providerRevision: await this.connections.identity(model.provider) } : {}),
        parameters: storedParameters, usage: input.usage, idempotencyKey: input.idempotencyKey, requestHash,
        createdAt: Date.now(), updatedAt: Date.now(), phase: 'queued', assets: [] };
      const work = path.join(this.root, 'work', job.id);
      try {
        const sources: { asset?: { assetId: string; versionId: string }; projectPath?: string }[] = input.referenceAsset ? [{ projectPath: input.referenceAsset }]
          : (input.library?.references ?? []).map(asset => ({ asset }));
        const openDesignUpload = ['account', 'opendesign'].includes(model.provider);
        const maxReferenceBytes = openDesignUpload ? 2 * 1024 * 1024 : 20 * 1024 * 1024;
        for (const [index, item] of sources.entries()) {
          const reference = item.asset ? await library.resolve(item.asset) : undefined;
          const source = reference?.filename ?? await this.store.safePath(item.projectPath!, this.store.projectDirectoryFor(projectId!));
          const info = await lstat(source);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error('Reference image must be a local file under 20 MB');
          if (info.size > maxReferenceBytes) throw new Error(openDesignUpload ? 'The reference image is larger than the 2 MiB OpenDesign upload limit.' : 'Reference image must be a local file under 20 MB');
          const bytes = await readFile(source), media = mediaType(bytes, 'image');
          if (bytes.length > maxReferenceBytes) throw new Error(openDesignUpload ? 'The reference image is larger than the 2 MiB OpenDesign upload limit.' : 'Reference image exceeds 20 MB');
          if (!['png', 'jpg', 'webp'].includes(media.extension)) throw new Error('Use a PNG, JPEG or WebP reference image');
          if (['opendesign', 'account'].includes(model.provider) && bytes.length > 2 * 1024 * 1024) throw new Error('The reference image is larger than the 2 MiB OpenDesign upload limit.');
          if (reference && hash(bytes) !== reference.version.sha256) throw new Error('Reference asset bytes have changed');
          const snapshot = { path: item.projectPath ?? `asset:${item.asset!.assetId}/${item.asset!.versionId}`, sha256: hash(bytes), mimeType: media.mimeType, bytes: bytes.length };
          (job.references ??= []).push(snapshot); job.reference ??= snapshot;
          await mkdir(work, { recursive: true, mode: 0o700 });
          await writeFile(path.join(work, referenceFile(index, media.mimeType)), bytes, { flag: 'wx', mode: 0o600 });
        }
        await this.saveJob(job);
        this.options.tracking?.track('media_generation_submitted', { modality: job.modality, job_id: job.id }, undefined, 'worker');
        return job;
      } catch (error) { await rm(work, { recursive: true, force: true }); throw error; }
    });
  }
  async resume(id: unknown, requestId: unknown) {
    if (typeof requestId !== 'string' || !/^[\w-]{1,100}$/.test(requestId)) throw new Error('A stable requestId is required');
    return this.store.lock(async () => {
      const job = await this.getJob(id);
      if (!(job.model.provider === 'opendesign' || job.model.provider === 'account' && job.modality === 'image') || !job.remoteId || !/^[a-zA-Z0-9_-]{1,180}$/.test(job.remoteId)) throw new Error('Only an existing Cloud or account image task can be resumed');
      if (['queued', 'running', 'completed'].includes(job.state)) return job;
      if (!resumableJob(job)) throw new Error(job.savePending ? 'Use retry_save for retained local outputs' : 'This task cannot be resumed');
      if (job.projectId && !this.store.projectCatalog().projects.some(project => project.id === job.projectId)) throw new Error('Project not found');
      if (job.model.provider === 'account') {
        if (job.providerOrigin !== await this.account.identity()) throw new Error('Account changed; the original task was not resumed');
      } else if (job.providerOrigin !== await this.cloudOrigin()) throw new Error('Provider API origin changed; the original task was not resumed');
      if (job.model.provider === 'opendesign' && !(await this.credential('opendesign')).key || !(await this.status()).providers.find(provider => provider.id === job.model.provider)?.available) throw new Error('Provider is no longer available');
      if ((await this.listJobs()).filter(item => ['queued', 'running'].includes(item.state)).length >= 20) throw new Error('Generation queue is full (20 jobs)');
      job.state = 'queued'; job.phase = 'resuming'; job.updatedAt = Date.now(); delete job.error;
      await this.saveJob(job); return job;
    });
  }
  async cancel(id: unknown) {
    const job = await this.store.lock(async () => {
      const job = await this.getJob(id);
      // A queued recovery has no worker for this attempt; its PID may belong to a prior attempt.
      if (job.state === 'queued') delete job.workerPid;
      if (job.state === 'queued' || job.state === 'running') { job.state = 'cancelled'; job.phase = 'cancelled'; job.updatedAt = Date.now(); await this.saveResult(job); }
      return job;
    });
    const worker = this.active.get(job.id);
    worker?.controller.abort();
    if (job.state === 'cancelled' && !job.savePending && !worker && !alive(job.workerPid)) await rm(path.join(this.root, 'work', job.id), { recursive: true, force: true });
    return job;
  }
  private async savedOutputs(job: GenerationJob): Promise<SavedOutput[]> {
    try {
      const files = JSON.parse(await readFile(path.join(this.root, 'work', job.id, 'outputs.json'), 'utf8'));
      if (!Array.isArray(files) || !files.length || files.some((file, index) => !file
        || !new RegExp(`^assets/generated/${job.id}-${index + 1}\\.[a-z0-9]+$`).test(file.path)
        || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > MAX_ASSET_BYTES
        || typeof file.mimeType !== 'string' || !file.mimeType.startsWith(job.modality + '/'))) throw new Error(saveUnavailable);
      return files;
    } catch (error) {
      if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!)) throw new Error(saveUnavailable);
      throw error;
    }
  }
  private async prepareOutput(library: AssetLibrary, file: SavedOutput, dir: string) {
    let snapshot: Awaited<ReturnType<AssetLibrary['prepare']>> | undefined;
    const source = path.join(dir, path.basename(file.path));
    try {
      snapshot = await library.prepare(await this.store.safePath(path.basename(file.path), dir));
      if (snapshot.sha256 !== file.sha256 || snapshot.bytes !== file.bytes || snapshot.media.mimeType !== file.mimeType) throw new Error(saveUnavailable);
      return snapshot;
    } catch (error) {
      if (snapshot) await rm(snapshot.file, { force: true });
      if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes((error as NodeJS.ErrnoException).code!) && (error as NodeJS.ErrnoException & { path?: string }).path === source
        || error instanceof Error && /not readable|could not be decoded|Unsupported media type|Asset must be a file|符号链接/.test(error.message)) throw new Error(saveUnavailable);
      throw error;
    }
  }
  async retrySave(id: unknown) {
    const original = await this.getJob(id);
    if (['completed', 'queued', 'running'].includes(original.state)) return original;
    try {
      const library = new AssetLibrary(this.store);
      for (const file of await this.savedOutputs(original)) {
        const snapshot = await this.prepareOutput(library, file, path.join(this.root, 'work', original.id));
        await rm(snapshot.file, { force: true });
      }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith('SAVE_NOT_AVAILABLE:')) throw error;
      return this.store.lock(async () => {
        const job = await this.getJob(id);
        if (['completed', 'queued', 'running'].includes(job.state)) return job;
        // Cancellation is final for this route: report that nothing was saved, but keep the job cancelled.
        if (job.state === 'cancelled') throw error;
        const alreadyFailed = job.state === 'failed';
        // Keep Cloud-terminal provenance before the error text is replaced.
        if (legacyRemoteTerminal(job)) job.remoteTerminal = true;
        job.state = 'failed'; job.phase = 'save_unavailable'; job.savePending = false; job.error = error.message; job.updatedAt = Date.now();
        if (alreadyFailed) await this.saveJob(job);
        else await this.saveResult(job);
        throw error;
      });
    }
    return this.store.lock(async () => {
      const job = await this.getJob(id);
      if (['completed', 'queued', 'running'].includes(job.state)) return job;
      job.savePending = true; job.state = 'queued'; job.phase = 'saving'; job.updatedAt = Date.now(); delete job.error;
      await this.saveJob(job); return job;
    });
  }
  async tick() {
    if (this.ticking || this.closed) return;
    this.ticking = true;
    try {
      if (!(await this.listJobs()).some(job => job.state === 'queued' || job.state === 'running' && !alive(job.workerPid))) return;
      const claimed = await this.store.lock(async () => {
        const jobs = await this.listJobs();
        for (const job of jobs.filter(j => j.state === 'running' && !alive(j.workerPid))) {
          job.savePending = !!job.savePending || await lstat(path.join(this.root, 'work', job.id, 'outputs.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
          job.state = 'failed'; job.phase = job.savePending ? 'save_failed' : 'interrupted'; job.error = job.savePending ? 'Saving was interrupted. Local outputs are retained; retry_save saves them without another model request.' : 'Worker stopped; request was not automatically resubmitted. Check provider history before retrying.'; if (resumableJob(job) && job.model.provider === 'opendesign') job.error += ' Check the original Cloud task with action=resume without paying again.'; job.updatedAt = Date.now(); await this.saveResult(job);
          if (!job.savePending && !(job.model.provider === 'account' && resumableJob(job))) await rm(path.join(this.root, 'work', job.id), { recursive: true, force: true });
        }
        const capacity = Math.max(0, 2 - jobs.filter(j => j.state === 'running').length);
        const next = jobs.filter(j => j.state === 'queued' && !this.active.has(j.id)).reverse().slice(0, capacity);
        for (const job of next) { job.state = 'running'; job.phase = 'starting'; job.startedAt = Date.now(); job.updatedAt = Date.now(); job.workerPid = process.pid; await this.saveJob(job); }
        return next;
      });
      for (const job of claimed) {
        const controller = new AbortController();
        const done = this.run(job, controller).catch(() => {
          // A storage failure must not become an unhandled rejection or retry a paid request.
          console.error(`Model gateway could not persist job ${job.id}; check local data storage`);
        }).finally(() => this.active.delete(job.id));
        this.active.set(job.id, { controller, done });
      }
    } finally { this.ticking = false; }
  }
  private async run(job: GenerationJob, controller: AbortController) {
    const dir = path.join(this.root, 'work', job.id);
    let key = '';
    let retained = !!job.savePending;
    const timeout = setTimeout(() => controller.abort(new Error('Generation timed out')), (job.modality === 'video' ? 30 : 15) * 60_000);
    let checking = false;
    const cancelPoll = setInterval(() => {
      if (checking) return; checking = true;
      void this.getJob(job.id).then(latest => { if (latest.state === 'cancelled') controller.abort(); }).catch(() => controller.abort()).finally(() => { checking = false; });
    }, 500);
    const progress = async (phase: string, remoteId?: string, download?: GenerationJob['download']) => {
      await this.store.lock(async () => { const current = await this.getJob(job.id); if (current.state !== 'running') { controller.abort(); return; }
        current.phase = phase; if (remoteId) current.remoteId = remoteId; if (download) current.download = download;
        if (phase === 'remote_failed') current.remoteTerminal = true;
        current.updatedAt = Date.now(); await this.saveJob(current); });
    };
    try {
      retained ||= await lstat(path.join(dir, 'outputs.json')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      let files = retained ? await this.savedOutputs(job) : null;
      if (!files) {
        if (job.projectId && !this.store.projectCatalog().projects.some(project => project.id === job.projectId)) throw new Error('Project not found');
        key = (await this.credential(job.model.provider)).key;
        const provider = (await this.status()).providers.find(p => p.id === job.model.provider);
        if (!provider?.available) throw new Error('Provider is no longer available');
        if (job.model.provider === 'opendesign' && job.providerOrigin !== await this.cloudOrigin()) throw new Error('Provider API origin changed; the queued task was not submitted');
        if (job.model.provider !== 'account' && !isGatewayProvider(job.model.provider) && job.providerOrigin !== await this.connections.baseUrl(job.model.provider)) throw new Error('Provider API origin changed; the queued task was not submitted');
        if (job.model.provider !== 'account' && !isGatewayProvider(job.model.provider) && (job.providerRevision !== await this.connections.identity(job.model.provider) || !(await this.connections.mediaModels()).some(model => model.id === job.model.id))) throw new Error('Provider or model configuration changed; the queued task was not submitted');
        await requireLibraryMediaRuntime();
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let buffers: Buffer[];
        const inputs = (job.references ?? (job.reference ? [job.reference] : [])).map((item, index) => ({ file: path.join(dir, referenceFile(index, item.mimeType)), mimeType: item.mimeType, bytes: item.bytes }));
        const reference = inputs[0]?.file;
        if (job.model.provider === 'account') {
          buffers = await this.account.generate(job, dir, controller.signal, progress, reference, inputs);
        } else if (job.model.provider === 'codex') {
          await progress('generating');
          const imageOptions = { ...job.model.defaults, ...job.parameters };
          buffers = [await (this.options.codex ?? generateCodexImage)(job.prompt + (Object.keys(imageOptions).length ? '\nImage options: ' + JSON.stringify(imageOptions) : ''), dir, controller.signal, reference)];
        } else {
          const adapter = isMediaProvider(job.model.provider) ? providerAdapters[job.model.provider] : compatibleProvider;
          const keepResult = async (data: Record<string, unknown>, remoteTerminal = false) => {
            if (!data || Object.getPrototypeOf(data) !== Object.prototype || JSON.stringify(data).length > 2_000_000) return;
            const redact = (value: unknown): unknown => typeof value === 'string' ? key ? value.replaceAll(key, '[redacted]') : value
              : Array.isArray(value) ? value.map(redact) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [key ? name.replaceAll(key, '[redacted]') : name, redact(item)])) : value;
            const clean = redact(data) as Record<string, unknown>;
            if (JSON.stringify(clean).length > 2_000_000) return;
            await this.store.lock(async () => { const current = await this.getJob(job.id); if (current.state !== 'running') return; current.result = clean; if (remoteTerminal) current.remoteTerminal = true; current.updatedAt = Date.now(); await this.saveJob(current); });
          };
          const urls = await adapter.generate(job, { key, baseUrl: job.providerOrigin, fetcher: this.options.fetcher ?? fetch, signal: controller.signal, progress, pollMs: this.options.pollMs, references: inputs, result: keepResult });
          await this.connections.verifyKey(job.model.provider, key, 'verified', job.providerOrigin);
          await progress('downloading');
          buffers = [];
          for (const url of urls) buffers.push(Buffer.isBuffer(url) ? url : await retryRead(() => (this.options.download ?? downloadMedia)(url, controller.signal), controller.signal, 5, () => progress('reconnecting'), () => progress('downloading')));
        }
        await progress('downloading');
        files = [];
        if (!buffers.length) throw new Error('Provider returned no media');
        for (const [i, bytes] of buffers.entries()) {
          const media = mediaType(bytes, job.modality), filename = `${job.id}-${i + 1}.${media.extension}`;
          // This path has no committed output manifest. Replace a prior worker's unfinished result,
          // while keeping the separately verified image download and checkpoint available for recovery.
          await rm(path.join(dir, filename), { force: true });
          await writeFile(path.join(dir, filename), bytes, { flag: 'wx', mode: 0o600 });
          files.push({ path: `assets/generated/${filename}`, mimeType: media.mimeType, bytes: bytes.length, sha256: hash(bytes) });
        }
        await atomic(path.join(dir, 'outputs.json'), files);
        retained = true;
      }
      await this.store.lock(async () => {
        const current = await this.getJob(job.id); current.savePending = true;
        if (current.state === 'running') current.phase = 'saving';
        current.updatedAt = Date.now(); await this.saveJob(current);
      });
      controller.signal.throwIfAborted();
      const library = new AssetLibrary(this.store);
      const prepared: Awaited<ReturnType<AssetLibrary['prepare']>>[] = [];
      try {
        for (const file of files) prepared.push(await this.prepareOutput(library, file, dir));
        await this.store.lock(async () => {
          const current = await this.getJob(job.id); if (current.state !== 'running') return;
          current.libraryAssets = [];
          for (const [index, file] of files.entries()) {
            controller.signal.throwIfAborted();
            const digest = hash(`${job.id}:${index}`);
            const targetId = job.library && (!index || !job.library.createNew) ? job.library.assetId : `${digest.slice(0, 8)}-${digest.slice(8, 12)}-${digest.slice(12, 16)}-${digest.slice(16, 20)}-${digest.slice(20, 32)}`;
            const existing = await library.get(targetId).catch(error => { if (error.message !== 'ASSET_NOT_FOUND') throw error; return undefined; });
            const asset = await library.addLocked(prepared[index], { assetId: existing?.id, createId: targetId,
              name: job.library?.title || (job.modality === 'audio' ? audioAssetTitle(job.prompt) : job.prompt.replace(/\s+/g, ' ').trim().slice(0, 80)), expectedModality: job.modality,
              version: { source: 'generated', prompt: job.prompt, model: job.model.id, parameters: job.parameters, references: job.library?.references ?? [],
                ...(job.modality === 'audio' ? { audioKind: classifyAudioKind(job.model.id, job.model.mode, 'generated', `${job.model.modelId} ${job.model.label}`) } : {}),
                parentVersionId: job.library?.parentVersionId, jobId: job.id, requestId: `${job.id}-${index}`, requestHash: file.sha256, conversationId: job.library?.conversationId, result: current.result } });
            const version = asset.versions.find(v => v.requestId === `${job.id}-${index}`)!;
            current.libraryAssets.push({ assetId: asset.id, versionId: version.id });
            current.updatedAt = Date.now(); await this.saveJob(current);
          }
          if (job.projectId) {
            if (!this.store.projectCatalog().projects.some(p => p.id === job.projectId)) throw new Error('Target project no longer exists; outputs remain in the asset library');
            for (const [index, file] of files.entries()) {
              controller.signal.throwIfAborted();
              const target = await this.store.safePath(file.path, this.store.projectDirectoryFor(job.projectId));
              await mkdir(path.dirname(target), { recursive: true });
              const snapshot = path.join(dir, `project-${randomUUID()}`);
              try {
                const { filename } = await library.resolve(current.libraryAssets[index], true);
                await copyFile(filename, snapshot);
                try { await link(snapshot, target); }
                catch (error) {
                  if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                  const existing = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
                  try {
                    const info = await existing.stat();
                    if (!info.isFile() || info.size !== file.bytes || hash(await existing.readFile()) !== file.sha256) throw new Error('Project output changed; refusing to overwrite it');
                  } finally { await existing.close(); }
                }
              } finally { await rm(snapshot, { force: true }); }
              current.assets[index] = { path: file.path, mimeType: file.mimeType, bytes: file.bytes };
            }
          }
          current.state = 'completed'; current.phase = 'completed'; current.savePending = false; delete current.error; current.updatedAt = Date.now();
          await this.saveResult(current);
          retained = false;
        });
      } finally { await Promise.all(prepared.map(file => rm(file.file, { force: true }))); }
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 401 || error.status === 403)) await this.connections.verifyKey(job.model.provider, key, 'rejected', job.providerOrigin);
      await this.store.lock(async () => {
        const current = await this.getJob(job.id); if (current.state !== 'running') return;
        const unavailable = error instanceof Error && error.message.startsWith('SAVE_NOT_AVAILABLE:');
        current.state = 'failed'; current.phase = unavailable ? 'save_unavailable' : retained ? 'save_failed' : 'failed'; current.savePending = retained && !unavailable; current.updatedAt = Date.now();
        let message = controller.signal.aborted ? 'Generation stopped or timed out; no automatic retry was made' : error instanceof Error ? error.message : 'Generation failed';
        if (key) message = message.replaceAll(key, '[redacted]');
        if (resumableJob(current) && current.model.provider === 'opendesign') message += ' Check the original Cloud task with action=resume without paying again.';
        current.error = message.slice(0, 500); await this.saveResult(current);
      });
    } finally {
      clearTimeout(timeout); clearInterval(cancelPoll);
      const current = await this.getJob(job.id);
      const keepDownload = current.model.provider === 'account' && current.modality === 'image' && resumableJob(current);
      if (!retained && !keepDownload) await rm(dir, { recursive: true, force: true });
    }
  }
  async close() { this.closed = true; this.account.close(); for (const task of this.active.values()) task.controller.abort(); await Promise.allSettled([...this.active.values()].map(task => task.done)); }
}
const gateways = new WeakMap<WorkspaceStore, ModelGateway>();
export function gatewayFor(store: WorkspaceStore, tracking?: OmTracking) {
  store = store.workspaceStore ?? store;
  let gateway = gateways.get(store);
  if (!gateway) {
    gateway = new ModelGateway(store, { tracking });
    gateways.set(store, gateway);
  } else if (tracking) {
    gateway.options.tracking = tracking;
  }
  return gateway;
}
