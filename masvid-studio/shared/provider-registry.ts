import presets from './provider-presets.json' with { type: 'json' };
import type { ProviderDefinition } from './provider-directory.ts';

export type ProviderRegistration = ProviderDefinition & {
  integration: 'media' | 'compatible' | 'agent' | 'account';
  keyEnvironment?: string;
  originEnvironment?: string;
  catalogueBaseUrl?: string;
  reference?: string;
};

const media = {
  atlascloud: { label: 'Atlas Cloud', baseUrl: 'https://api.atlascloud.ai', website: 'https://www.atlascloud.ai/console/api-keys', keyEnvironment: 'ATLASCLOUD_API_KEY' },
  fal: { label: 'fal.ai', baseUrl: 'https://queue.fal.run', catalogueBaseUrl: 'https://api.fal.ai', website: 'https://fal.ai/dashboard/keys', keyEnvironment: 'FAL_KEY' },
  opendesign: { label: 'OpenDesign Cloud', baseUrl: '', website: 'https://open-design.ai/cloud/dashboard', keyEnvironment: 'OPENDESIGN_API_KEY', originEnvironment: 'OPENDESIGN_MEDIA_ORIGIN', baseUrlEditable: true },
  wavespeed: { label: 'WaveSpeedAI', baseUrl: 'https://api.wavespeed.ai', website: 'https://wavespeed.ai/accesskey', keyEnvironment: 'WAVESPEED_API_KEY' },
};
export type MediaProviderId = keyof typeof media;
export const mediaProviders = Object.keys(media) as MediaProviderId[];

/** Public metadata only; adapters and login sessions remain service-owned. */
export const providerRegistry: ProviderRegistration[] = [
  { id: 'codex', label: 'Codex', integration: 'agent', protocol: 'agent', category: 'local', kinds: ['image'], baseUrl: '', baseUrlEditable: false, reference: 'codex' },
  ...mediaProviders.map((id): ProviderRegistration => ({ id, integration: 'media', protocol: 'media', category: 'multimodal', kinds: ['image', 'video', 'audio'],
    baseUrlEditable: false, ...media[id], reference: id, docs: `/motion-api/models/providers/${id}/reference` })),
  { id: 'account', label: 'OpenDesign', integration: 'account', protocol: 'account', category: 'account', kinds: ['text', 'image', 'video', 'audio'],
    baseUrl: '', baseUrlEditable: false, website: 'https://open-design.ai/cloud', reference: 'account' },
  ...(presets as ProviderDefinition[]).map((provider): ProviderRegistration => ({ ...provider, integration: 'compatible', baseUrlEditable: true, reference: 'compatible' })),
];
// Masvid Studio: free only. Paid cloud media providers (OpenDesign Cloud, fal.ai, Atlas Cloud, WaveSpeedAI),
// the OpenDesign account, Codex and paid API presets are removed; local engines on this PC remain.
const FREE_LOCAL_PROVIDERS = new Set(['comfyui', 'ollama', 'lmstudio', 'litellm', 'ovms', 'omlx', 'rapid-mlx', 'claude-code']);
// Internal lookups (adapters, origins) still resolve every id so nothing crashes; only the public list is filtered.
const byId = new Map(providerRegistry.map(provider => [provider.id, provider]));
for (let i = providerRegistry.length - 1; i >= 0; i--) if (!FREE_LOCAL_PROVIDERS.has(providerRegistry[i].id)) providerRegistry.splice(i, 1);
export function isFreeLocalProvider(id: string) { return FREE_LOCAL_PROVIDERS.has(id); }
export function registeredProvider(id: string) { return byId.get(id); }
export function isMediaProvider(id: string): id is MediaProviderId { return registeredProvider(id)?.integration === 'media'; }
export function isGatewayProvider(id: string) { const integration = registeredProvider(id)?.integration; return integration === 'media' || integration === 'agent'; }
