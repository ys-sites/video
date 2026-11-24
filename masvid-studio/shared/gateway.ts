import type { LibraryGeneration } from './asset-library.ts';
import type { GenerationOptions } from './generation-options.ts';
import { openDesignImageReferenceCap } from './opendesign-models.ts';
/** Public contract shared by the model gateway, MCP and Studio. Never contains credentials. */
export const modalities = ['image', 'video', 'audio'] as const;
export type Modality = typeof modalities[number];
export { mediaProviders } from './provider-registry.ts';
/** Built-in media IDs and service-registered compatible connections share one route identity. */
export type ProviderId = string;
export type Model = {
  id: string; provider: ProviderId; modelId: string; label: string; modality: Modality;
  source: 'builtin' | 'live' | 'custom'; mode: string;
  defaults?: Record<string, unknown>; description?: string;
  /** Cloud: true/false is explicit provider evidence; absent means editing capability is unknown. */
  supportsImageReference?: boolean;
  /** Most input images the provider accepts: edit references for images, a first frame for video. */
  maxInputImages?: number;
  /** Provider-published native options (durations, resolutions, ratios, quality, sizes) shown during discovery. */
  nativeOptions?: Record<string, unknown>;
  /** Maintained, provider-native controls, shared by Studio and MCP discovery. */
  generationOptions?: GenerationOptions;
};
export type Agent = { id: string; label: string; installed: boolean; authenticated: boolean;
  imageGeneration: boolean; available: boolean; reason: string };
/** Advisory hints for signed-in accounts only; absent for signed-out or expired sessions. */
export type AccountMediaEntitlement = { mediaEntitlement: 'included' | 'not-included' | 'unknown'; plan?: string; hasBalance?: boolean };
export type ProviderState = { id: ProviderId; label: string; enabled: boolean; configured: boolean;
  available: boolean; credentialSource: 'stored' | 'environment' | 'local-agent' | 'account' | 'none';
  verification: 'unverified' | 'verified' | 'rejected'; reason: string; checkedAt?: number; baseUrl?: string } & Partial<AccountMediaEntitlement>;
export type GatewayStatus = { providers: ProviderState[]; agents: Agent[];
  routes: Partial<Record<Modality, string>>;
  capabilities: { modality: Modality; available: boolean; modelIds: string[]; selectedModelId?: string }[] };
export type GenerateInput = { modality: Modality; prompt: string; model?: string;
  mode?: string;
  projectId?: string; parameters?: Record<string, unknown>; idempotencyKey?: string;
  /** Workspace assets can be generated without creating or selecting a film project. */
  library?: LibraryGeneration;
  /** Project-relative input image. Supported only by explicitly capable adapters. */
  referenceAsset?: string;
  /** Reserved for editor consumers. Recorded only; does not silently edit a composition. */
  usage?: { compositionId?: string; elementId?: string; property?: string } };
export type GeneratedAsset = { path: string; mimeType: string; bytes: number; available?: boolean };
export type GenerationJob = { id: string; projectId?: string; library?: LibraryGeneration & { assetId: string; createNew?: boolean }; libraryAssets?: { assetId: string; versionId: string }[]; state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  /** New generation results also belong to the local workspace library. */
  saveToLibrary?: boolean;
  /** Durable local outputs remain; retry_save never invokes a model. */
  savePending?: boolean;
  providerOrigin?: string;
  providerRevision?: string;
  modality: Modality; prompt: string; model: Model; parameters: Record<string, unknown>;
  usage?: GenerateInput['usage']; idempotencyKey?: string; requestHash: string;
  reference?: { path: string; sha256: string; mimeType: string; bytes: number };
  /** Every snapshotted input image in submission order; `reference` remains the first one for older readers. */
  references?: { path: string; sha256: string; mimeType: string; bytes: number }[];
  /** Provider result metadata kept with the job, such as speech timestamps. */
  result?: Record<string, unknown>;
  /** Cloud confirmed failure/cancellation; polling cannot recover this task. */
  remoteTerminal?: boolean;
  /** Original account image transfer; signed URLs and credentials are never persisted. */
  download?: { assetId: string; receivedBytes: number; totalBytes: number };
  createdAt: number; updatedAt: number; startedAt?: number; workerPid?: number;
  phase: string; error?: string; remoteId?: string; assets: GeneratedAsset[] };

/** Effective adapter input contract, shared by service validation and existing Studio controls. */
export function modelReferenceLimit(model: Model): number {
  if (model.modality === 'image' && model.supportsImageReference) {
    if (model.provider === 'codex') return 1;
    const cap = ['opendesign', 'account'].includes(model.provider) ? openDesignImageReferenceCap(model.modelId) : undefined;
    // Earlier Cloud syncs persisted a synthetic maxInputImages: 1 when nativeOptions omitted max_input_images.
    const syntheticCloudFallback = model.provider === 'opendesign' && model.maxInputImages === 1
      && Boolean(model.nativeOptions) && !(Number.isInteger(model.nativeOptions?.max_input_images) && (model.nativeOptions!.max_input_images as number) > 0);
    const declared = syntheticCloudFallback ? undefined : model.maxInputImages;
    // OpenDesign catalogues without an explicit max_input_images fall back to the measured limit (unknown models stay at 1).
    return Math.min(declared ?? cap ?? 1, cap ?? Infinity);
  }
  return model.modality === 'video' ? Math.min(model.maxInputImages ?? 0, 1) : 0;
}
/** Local eligibility; the service additionally rechecks project, origin and credentials. */
export function resumableJob(job: GenerationJob): boolean {
  return (job.model.provider === 'opendesign' || job.model.provider === 'account' && job.modality === 'image') && typeof job.remoteId === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(job.remoteId)
    && job.state === 'failed' && !job.savePending && !job.remoteTerminal
    && !legacyRemoteTerminal(job);
}
/** Earlier adapters recorded a Cloud-confirmed failure/cancellation only in the error message. */
export function legacyRemoteTerminal(job: GenerationJob): boolean {
  return /^OpenDesign Cloud task (failed|cancelled)\b|^Account media task failed\./.test(job.error ?? '');
}
