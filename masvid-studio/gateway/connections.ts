import { createHash, randomUUID } from 'node:crypto';
import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { isGatewayProvider, isMediaProvider, providerRegistry, registeredProvider } from '../shared/provider-registry.ts';
import { modelKinds, publicProviderConnection, type DirectoryModel, type ModelKind, type ModelMetadata, type ProviderConnection, type ProviderDefinition, type ProviderProtocol } from '../shared/provider-directory.ts';
import { modelMetadata } from './model-metadata.ts';
import { modalities, type Model, type Modality, type ProviderState } from '../shared/gateway.ts';
import type { WorkspaceStore } from '../workspace.ts';
import { apiJson, providerOrigin, publicProviderFetch, type Fetcher } from './network.ts';
import { readSettings, writeSettings } from './settings-storage.ts';

type SavedConnection = { label?: string; protocol?: ProviderProtocol; baseUrl?: string; enabled?: boolean; custom?: boolean; revision?: string };
type Config = { providers: Record<string, SavedConnection>; models: DirectoryModel[]; defaults: Partial<Record<ModelKind, string>>; modelOverrides?: Record<string, ModelMetadata & { label?: string }> };
const emptyConfig = (): Config => ({ providers: {}, models: [], defaults: {} });
const definitions = providerRegistry.filter(provider => provider.integration === 'compatible');
const protocols = ['openai', 'anthropic', 'google'];
export type GatewayConfig = { version: 1; providers: Record<string, { enabled?: boolean; baseUrl?: string; verification?: 'verified' | 'rejected'; keyHash?: string; checkedAt?: number; catalogRevision?: string }>;
  routes: Partial<Record<Modality, string>>; customModels: Model[] };
const hash = (key: string) => createHash('sha256').update(key).digest('hex');

/** Preserve path prefixes, while applying the same public HTTPS boundary as media providers. */
export function connectionBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Enter a public HTTPS API URL');
  let url: URL;
  try { url = new URL(value); providerOrigin(url.origin); } catch { throw new Error('Enter a public HTTPS API URL'); }
  if (url.username || url.password || url.search || url.hash || /%2f|%5c/i.test(url.pathname)) throw new Error('Enter an API URL without credentials, query or fragment');
  return url.href.replace(/\/+$/, '');
}
function validKey(key: unknown) {
  if (key !== undefined && key !== null && (typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\x00-\x1f]/.test(key))) throw new Error('Invalid API key');
}
function validId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,179}$/.test(id)) throw new Error('Invalid model ID');
}

/** One configuration boundary; existing on-disk layouts remain readable without migration. */
export class ProviderConnections {
  readonly store: WorkspaceStore;
  readonly fetcher: Fetcher;
  constructor(store: WorkspaceStore, fetcher: Fetcher = publicProviderFetch) { this.store = store; this.fetcher = fetcher; }
  private file(name: string) { return path.join(this.store.directory, 'model-gateway', name); }
  config() { return readSettings<Config>(this.file('connections.json'), emptyConfig()); }
  gatewayConfig() { return readSettings<GatewayConfig>(this.file('config.json'), { version: 1, providers: {}, routes: {}, customModels: [] }); }
  private keys() { return readSettings<Record<string, string>>(this.file('connection-secrets.json'), {}); }
  private gatewayKeys() { return readSettings<Record<string, string>>(this.file('secrets.json'), {}); }
  async identity(id: string) { return (await this.config()).providers[id]?.revision; }
  async resolveCredential(id: string) {
    const definition = registeredProvider(id);
    if (definition?.integration === 'account' || definition?.integration === 'agent') return { key: '', source: 'none' as const };
    const saved = isGatewayProvider(id) ? (await this.gatewayKeys())[id] : (await this.keys())[id];
    const env = definition?.keyEnvironment ? process.env[definition.keyEnvironment] : undefined;
    return { key: saved || env || '', source: saved ? 'stored' as const : env ? 'environment' as const : 'none' as const };
  }
  async credential(id: string) { return (await this.resolveCredential(id)).key; }
  async baseUrl(id: string) {
    const definition = registeredProvider(id);
    if (!isGatewayProvider(id)) return (await this.list()).find(provider => provider.id === id)?.baseUrl;
    const saved = (await this.gatewayConfig()).providers[id]?.baseUrl;
    const env = definition?.originEnvironment ? process.env[definition.originEnvironment] : undefined;
    const value = saved || env || definition?.baseUrl;
    return value && definition?.baseUrlEditable ? providerOrigin(value) : value || undefined;
  }
  async list(): Promise<ProviderConnection[]> {
    const [config, keys] = await Promise.all([this.config(), this.keys()]);
    const custom: ProviderDefinition[] = Object.entries(config.providers).filter(([, p]) => p.custom).map(([id, p]) => ({
      id, label: p.label!, protocol: p.protocol!, baseUrl: p.baseUrl!, kinds: ['text'], category: 'custom', baseUrlEditable: true,
    }));
    return [...definitions, ...custom].map(definition => {
      const saved = config.providers[definition.id] ?? {};
      const configured = Boolean(keys[definition.id]), enabled = saved.enabled ?? configured;
      const baseUrl = saved.baseUrl ?? definition.baseUrl;
      const available = configured && enabled && Boolean(baseUrl) && !definition.setupRequired;
      const kinds = [...new Set([...definition.kinds, ...config.models.filter(model => model.provider === definition.id).map(model => model.kind)])];
      return publicProviderConnection({ ...definition, ...saved, baseUrl, kinds, custom: !!saved.custom, configured, enabled, available,
        credentialSource: configured ? 'stored' : 'none', reason: definition.setupRequired ? 'This provider requires a dedicated integration. Use a compatible API endpoint as a custom provider.' : !configured ? 'API key required' : !enabled ? 'Disabled' : 'Configured; availability and quota are checked when generating' });
    });
  }
  async configure(id: string | null, input: Record<string, unknown>) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provider settings required');
    validKey(input.apiKey);
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be boolean');
    const definition = id === null ? undefined : registeredProvider(id);
    if (definition?.integration === 'account') throw new Error('OpenDesign uses account sign-in; open Account settings');
    if (id && isGatewayProvider(id)) {
      await this.configureGateway(id, input);
      return id;
    }
    if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 80)) throw new Error('Provider name is required (up to 80 characters)');
    if (input.protocol !== undefined && !protocols.includes(String(input.protocol))) throw new Error('Unsupported provider protocol');
    const baseUrl = input.baseUrl === undefined ? undefined : connectionBaseUrl(input.baseUrl);
    const providerId = id ?? 'custom-' + randomUUID();
    if (!id && (!input.label || !baseUrl || !input.protocol)) throw new Error('Provider name, protocol and API URL are required');
    if (id && !(await this.list()).some(provider => provider.id === id)) throw new Error('Provider not found');
    await this.store.lock(async () => {
      const config = await this.config(), keys = await this.keys();
      const previous = config.providers[providerId] ?? {};
      const next: SavedConnection = { ...previous, ...(!id ? { custom: true } : {}),
        ...(input.label ? { label: String(input.label).trim() } : {}), ...(baseUrl ? { baseUrl } : {}),
        ...(input.protocol ? { protocol: input.protocol as ProviderProtocol } : {}),
        ...(input.enabled !== undefined ? { enabled: Boolean(input.enabled) } : input.apiKey ? { enabled: true } : {}) };
      // Never send an old key to an edited origin. An explicit replacement is required.
      const originalUrl = previous.baseUrl ?? definitions.find(provider => provider.id === id)?.baseUrl;
      if (baseUrl && originalUrl && new URL(baseUrl).origin !== new URL(originalUrl).origin && input.apiKey === undefined && keys[providerId]) throw new Error('Enter the API key again when changing the API origin');
      if (input.apiKey === null) delete keys[providerId];
      else if (input.apiKey) keys[providerId] = String(input.apiKey).trim();
      if (input.apiKey !== undefined || baseUrl && baseUrl !== originalUrl || input.protocol && input.protocol !== previous.protocol) next.revision = randomUUID();
      config.providers[providerId] = next;
      await writeSettings(this.file('connection-secrets.json'), keys);
      await writeSettings(this.file('connections.json'), config);
    });
    return providerId;
  }
  private async configureGateway(id: string, input: Record<string, unknown>) {
    const definition = registeredProvider(id)!;
    if (definition.integration === 'agent' && input.apiKey !== undefined) throw new Error('Codex uses its own local login; no API key is stored here');
    const baseUrl = input.baseUrl === undefined ? undefined : providerOrigin(input.baseUrl);
    if (baseUrl && !definition.baseUrlEditable) throw new Error('This provider uses its built-in API origin');
    await this.store.lock(async () => {
      const config = await this.gatewayConfig(), state = config.providers[id] ?? {};
      if (id === 'opendesign' && (input.apiKey !== undefined || baseUrl && baseUrl !== state.baseUrl)) state.catalogRevision = randomUUID();
      if (baseUrl) { state.baseUrl = baseUrl; delete state.verification; delete state.keyHash; delete state.checkedAt; }
      if (input.apiKey !== undefined) {
        const keys = await this.gatewayKeys();
        if (input.apiKey === null) delete keys[id]; else keys[id] = String(input.apiKey).trim();
        await writeSettings(this.file('secrets.json'), keys);
        await chmod(path.dirname(this.file('secrets.json')), 0o700);
        delete state.verification; delete state.keyHash; delete state.checkedAt;
      }
      if (input.apiKey && isMediaProvider(id)) state.enabled = true;
      if (input.enabled !== undefined) state.enabled = input.enabled as boolean;
      config.providers[id] = state;
      await writeSettings(this.file('config.json'), config);
    });
  }
  async verifyKey(id: string, key: string, verification: 'verified' | 'rejected', origin?: string) {
    if (!isMediaProvider(id) || !key) return;
    await this.store.lock(async () => {
      if (await this.credential(id) !== key || registeredProvider(id)?.baseUrlEditable && origin !== await this.baseUrl(id)) return;
      const config = await this.gatewayConfig(); config.providers[id] = { ...config.providers[id], verification, keyHash: hash(key), checkedAt: Date.now() };
      await writeSettings(this.file('config.json'), config);
    });
  }
  async saveMediaModel(model: Model) {
    await this.store.lock(async () => {
      const config = await this.gatewayConfig(); config.customModels = [...config.customModels.filter(row => row.id !== model.id), model];
      await writeSettings(this.file('config.json'), config);
    });
  }
  async remove(id: string) {
    await this.store.lock(async () => {
      const config = await this.config(), keys = await this.keys();
      if (!config.providers[id]?.custom) throw new Error('Built-in providers cannot be deleted');
      for (const model of config.models.filter(model => model.provider === id)) if (config.modelOverrides) delete config.modelOverrides[model.id];
      delete config.providers[id]; delete keys[id]; config.models = config.models.filter(model => model.provider !== id);
      for (const kind of modelKinds) if (config.defaults[kind]?.startsWith(id + ':')) delete config.defaults[kind];
      await writeSettings(this.file('connection-secrets.json'), keys); await writeSettings(this.file('connections.json'), config);
    });
  }
  async models() { return (await this.config()).models; }
  async saveModel(provider: string, input: Record<string, unknown>) {
    if (!(await this.list()).some(p => p.id === provider)) throw new Error('Provider not found');
    if (input.kind === 'transcription' && !(await this.list()).some(p => p.id === provider && p.protocol === 'openai')) throw new Error('Transcription requires an OpenAI-compatible provider');
    validId(input.modelId);
    if (!modelKinds.includes(input.kind as ModelKind)) throw new Error('Choose a model capability');
    if (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 180) throw new Error('Model name is required');
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('enabled must be boolean');
    const model: DirectoryModel = { id: provider + ':' + input.modelId, provider, modelId: input.modelId, label: input.label.trim(), kind: input.kind as ModelKind,
      source: 'custom', enabled: input.enabled !== false, ...modelMetadata(input) };
    await this.store.lock(async () => { const config = await this.config(); config.models = [...config.models.filter(row => row.id !== model.id), model]; await writeSettings(this.file('connections.json'), config); });
    return model;
  }
  async modelOverrides() { return (await this.config()).modelOverrides ?? {}; }
  async updateMetadata(id: string, input: Record<string, unknown>) {
    if (input.kind === 'transcription' && !(await this.list()).some(p => id.startsWith(p.id + ':') && p.protocol === 'openai')) throw new Error('Transcription requires an OpenAI-compatible provider');
    const metadata = modelMetadata(input);
    if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 180)) throw new Error('Model name is required');
    if (input.kind !== undefined && !modelKinds.includes(input.kind as ModelKind)) throw new Error('Invalid model type');
    await this.store.lock(async () => {
      const config = await this.config(), model = config.models.find(row => row.id === id);
      if (model && input.kind && model.kind !== input.kind) {
        model.kind = input.kind as ModelKind; model.source = 'custom';
        for (const kind of modelKinds) if (kind !== model.kind && config.defaults[kind] === id) delete config.defaults[kind];
      }
      config.modelOverrides ??= {}; config.modelOverrides[id] = { ...metadata, ...(typeof input.label === 'string' ? { label: input.label.trim() } : {}) };
      await writeSettings(this.file('connections.json'), config);
    });
  }
  async updateModel(id: string, enabled: boolean | null) {
    await this.store.lock(async () => {
      const config = await this.config(), model = config.models.find(row => row.id === id);
      if (!model) throw new Error('Model not found');
      if (enabled === null) { config.models = config.models.filter(row => row.id !== id); if (config.modelOverrides) delete config.modelOverrides[id]; } else model.enabled = enabled;
      if (enabled !== true) for (const kind of modelKinds) if (config.defaults[kind] === id) delete config.defaults[kind];
      await writeSettings(this.file('connections.json'), config);
    });
  }
  async setDefault(kind: ModelKind, id: string | null) {
    if (!modelKinds.includes(kind)) throw new Error('Unknown model capability');
    await this.store.lock(async () => {
      if (modalities.includes(kind as Modality)) {
        const config = await this.gatewayConfig(); if (id) config.routes[kind as Modality] = id; else delete config.routes[kind as Modality];
        await writeSettings(this.file('config.json'), config);
      } else {
        const config = await this.config(); if (id) config.defaults[kind] = id; else delete config.defaults[kind];
        await writeSettings(this.file('connections.json'), config);
      }
    });
  }
  async defaults() { const [config, gateway] = await Promise.all([this.config(), this.gatewayConfig()]); return { ...config.defaults, ...gateway.routes }; }
  async sync(id: string) {
    const revision = await this.identity(id);
    const provider = (await this.list()).find(p => p.id === id);
    if (!provider?.configured || provider.setupRequired) throw new Error('Configure a compatible provider before syncing models');
    const base = connectionBaseUrl(provider.baseUrl), key = await this.credential(id);
    const headers: Record<string, string> = provider.protocol === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
      : provider.protocol === 'google' ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` };
    const models: DirectoryModel[] = []; let cursor = '';
    for (let page = 0; page < 20; page++) {
      const params = new URLSearchParams();
      if (provider.protocol === 'google') { params.set('pageSize', '100'); if (cursor) params.set('pageToken', cursor); }
      if (provider.protocol === 'anthropic') { params.set('limit', '100'); if (cursor) params.set('after_id', cursor); }
      const body = await apiJson(this.fetcher, base + '/models' + (params.size ? '?' + params : ''), { headers });
      const rows = provider.protocol === 'google' ? body.models : body.data;
      if (!Array.isArray(rows)) throw new Error('Provider model catalogue format is not supported');
      for (const row of rows) {
        const modelId = provider.protocol === 'google' ? row.name?.replace(/^models\//, '') : row.id;
        try { validId(modelId); } catch { continue; }
        // Only explicit output metadata establishes media capability. Unknown models remain language models.
        const outputs = row.architecture?.output_modalities ?? row.output_modalities;
        const asr = provider.protocol === 'openai' && (id === 'openai' && /^(gpt-transcribe|whisper-1|gpt-4o-(mini-)?transcribe(-.*)?)$/.test(modelId) || id === 'groq' && /^whisper-large-v3(-turbo)?$/.test(modelId));
        const kind: ModelKind = asr ? 'transcription' : Array.isArray(outputs) && outputs.includes('image') ? 'image'
          : Array.isArray(outputs) && outputs.includes('audio') ? 'audio'
          : Array.isArray(outputs) && outputs.includes('video') ? 'video'
          : row.type === 'embedding' || row.supportedGenerationMethods?.includes('embedContent') ? 'embedding' : 'text';
        const meta: Record<string, unknown> = {};
        for (const [key, raw] of [['contextWindow', row.context_length ?? row.context_window], ['maxInputTokens', row.inputTokenLimit], ['maxOutputTokens', row.outputTokenLimit ?? row.top_provider?.max_completion_tokens]] as const) if (Number.isInteger(raw) && raw > 0 && raw <= 100_000_000) meta[key] = raw;
        const inputs = row.architecture?.input_modalities ?? row.input_modalities;
        if (Array.isArray(inputs)) meta.inputs = [...new Set(inputs.map((input: string) => input === 'image' ? 'vision' : input).filter((input: string) => ['vision', 'audio', 'video'].includes(input)))];
        if (Array.isArray(row.supported_parameters)) meta.capabilities = [...(row.supported_parameters.includes('reasoning') ? ['reasoning'] : []), ...(row.supported_parameters.includes('tools') ? ['tools'] : [])];
        models.push({ id: id + ':' + modelId, provider: id, modelId, label: String(row.displayName || row.display_name || row.name || modelId).slice(0, 180), kind: row.type === 'reranker' ? 'reranker' : kind, enabled: true, source: 'live', ...meta });
      }
      const next = provider.protocol === 'google' ? body.nextPageToken : provider.protocol === 'anthropic' && body.has_more ? body.last_id : undefined;
      if (!next || next === cursor) break;
      cursor = String(next);
      if (page === 19) throw new Error('Model catalogue is too large; add the required models manually');
    }
    await this.store.lock(async () => {
      const config = await this.config();
      // A late sync may not overwrite a deleted or reconfigured connection.
      const current = (await this.list()).find(p => p.id === id);
      if (!current || await this.identity(id) !== revision || current.baseUrl !== provider.baseUrl || (await this.credential(id)) !== key) throw new Error('Provider changed while models were syncing; sync again');
      const previous = new Map(config.models.map(model => [model.id, model]));
      const retained = config.models.filter(model => model.provider !== id || model.source === 'custom');
      config.models = [...new Map([...models.map(model => ({ ...model, enabled: previous.get(model.id)?.enabled ?? true })), ...retained].map(model => [model.id, model])).values()];
      await writeSettings(this.file('connections.json'), config);
    });
  }
  async mediaModels(): Promise<Model[]> {
    const providers = await this.list();
    const overrides = await this.modelOverrides();
    return (await this.models()).filter(model => model.enabled && ['image', 'audio'].includes(model.kind) && providers.find(p => p.id === model.provider)?.protocol === 'openai')
      .map(model => ({ ...model, ...overrides[model.id], modality: model.kind as 'image' | 'audio', mode: model.kind === 'audio' ? 'text-to-speech' : 'text-to-image' }));
  }
  async states(): Promise<ProviderState[]> {
    return (await this.list()).map(provider => ({ ...provider, verification: 'unverified' }));
  }
}
