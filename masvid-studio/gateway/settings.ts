import { publicProviderConnection, type DirectoryModel, type ModelKind, type ProviderConnection, type ProviderDirectory } from '../shared/provider-directory.ts';
import { isGatewayProvider, isMediaProvider, registeredProvider } from '../shared/provider-registry.ts';
import { accountMediaState } from './account-media.ts';
import type { ModelGateway } from './service.ts';

export async function providerDirectory(gateway: ModelGateway): Promise<ProviderDirectory> {
  const [status, connections, saved, account, accountModels, defaults] = await Promise.all([
    gateway.status(), gateway.connections.list(), gateway.connections.config(), gateway.account.summary(), gateway.account.models(), gateway.connections.defaults(),
  ]);
  const media: ProviderConnection[] = status.providers.filter(p => isGatewayProvider(p.id)).map(provider => ({
    ...registeredProvider(provider.id)!, ...provider, baseUrl: provider.baseUrl ?? registeredProvider(provider.id)!.baseUrl, custom: false,
  }));
  const official: ProviderConnection = { ...registeredProvider('account')!,
    custom: false, configured: account.state === 'signed-in', enabled: account.state === 'signed-in', available: account.state === 'signed-in',
    credentialSource: account.state === 'signed-in' ? 'account' : 'none', reason: accountMediaState(account).reason, website: account.consoleUrl };
  const models: DirectoryModel[] = [];
  for (let offset: number | null = 0; offset !== null;) {
    const page = await gateway.listModels({ offset, limit: 100 });
    models.push(...page.models.filter(model => media.some(p => p.id === model.provider)).map(model => ({ ...model, kind: model.modality, enabled: true })));
    offset = page.nextOffset;
  }
  return { providers: [official, ...media, ...connections].map(publicProviderConnection), models: [...models, ...saved.models, ...accountModels].map(model => ({ ...model, ...saved.modelOverrides?.[model.id] })), defaults };
}
export async function syncProvider(gateway: ModelGateway, id: string) {
  if (id === 'account') await gateway.account.models(true);
  else if (isMediaProvider(id)) {
    const result = await gateway.listModels({ provider: id, refresh: true });
    if (result.warnings.length) throw new Error(result.warnings.join('. '));
  } else if (id === 'codex') await gateway.status(true);
  else await gateway.connections.sync(id);
}
export async function setDefaultModel(gateway: ModelGateway, kind: ModelKind, id: string | null) {
  const directory = await providerDirectory(gateway);
  const model = directory.models.find(model => model.id === id && model.kind === kind && model.enabled);
  if (id && (!model || !directory.providers.find(provider => provider.id === model.provider)?.available)) throw new Error('Choose an enabled model from a configured provider');
  await gateway.connections.setDefault(kind, id);
}
