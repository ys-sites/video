import { Button } from 'open-design-ui/button';
import { useState, useEffect } from 'react';
import { modelKinds, type ModelKind } from '../../../shared/provider-directory';
import { Popover } from '../components/ui/Popover';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { gatewayRequest } from './gatewayClient';
import { useProviderDirectory, notifyProvidersChanged } from './useProviderDirectory';
import { modelKindLabel, typeIcons } from './ModelEditor';
import { ProviderAvatar, ModelAvatar, SettingsError, SettingsLoading } from './settingsPrimitives';
import { DefaultAgentCard } from './AgentSettings';
import { SettingsSurfaceBoundary } from './SettingsSurfaceBoundary';

export function ModelSwitcher({ openSettings, capability, label }: { openSettings: () => void; capability?: ModelKind; label?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('motion:agents-open', close); return () => window.removeEventListener('motion:agents-open', close); }, []);
  return <Popover open={open} onOpenChange={setOpen} aria-label={t('Select model')} align="end" className="om-model-picker om-selection-panel" trigger={<Button variant="ghost" className="om-button h-auto" aria-label={t('Select model')} title={t('Select model')}><span>{label || t('Models')}</span><RemixIcon name="arrow-down-s-line" size={12} /></Button>}>
    {open && <SettingsSurfaceBoundary><ModelChoices capability={capability} close={() => setOpen(false)} openSettings={openSettings} /></SettingsSurfaceBoundary>}
  </Popover>;
}
function ModelChoices({ capability, close, openSettings }: { capability?: ModelKind; close: () => void; openSettings: () => void }) {
  const { t, locale } = useI18n(), directory = useProviderDirectory(), toast = useToast();
  const [query, setQuery] = useState(''), [kind, setKind] = useState<ModelKind>(capability ?? 'image'), [providerId, setProviderId] = useState('all'), [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('media');
  const available = directory.data?.providers.filter(provider => provider.available) ?? [];
  const selectedProvider = available.find(provider => provider.id === providerId);
  const models = directory.data?.models.filter(model => model.kind === kind && model.enabled && available.some(provider => provider.id === model.provider && (!['image', 'video', 'audio'].includes(kind) || ['media', 'agent', 'account'].includes(provider.protocol) || provider.protocol === 'openai' && kind !== 'video'))
    && (providerId === 'all' || model.provider === providerId) && `${model.label} ${model.modelId} ${model.provider}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  async function choose(model: string | null) {
    setBusy(true);
    try { await gatewayRequest('settings/default-model', 'PUT', { kind, model }); notifyProvidersChanged(); close(); }
    catch (error) { toast.showToast(error instanceof Error ? error.message : t('Could not select model'), 'error'); }
    finally { setBusy(false); }
  }
  return <>{!capability && <div className="om-choice-tabs"><Button variant="plain" className="om-nav-item" aria-pressed={mode === 'media'} onClick={() => setMode('media')}><RemixIcon name="image-line" size={15} />{t('Media models')}</Button><Button variant="plain" className="om-nav-item" aria-pressed={mode === 'agent'} onClick={() => setMode('agent')}><RemixIcon name="terminal-box-line" size={15} />{t('Agent & model')}</Button></div>}{mode === 'agent' ? <DefaultAgentCard compact /> : <><h2 className="om-subtitle">{t('Select model')}</h2><label className="om-field"><RemixIcon name="search-line" size={16} /><input type="search" aria-label={t('Search models')} placeholder={t('Search models…')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    <div className="om-settings-actions">{!capability && <Menu modal={false} trigger={<Button variant="ghost" className="om-button h-auto"><RemixIcon name={typeIcons[kind]} size={15} />{modelKindLabel(kind, t, locale)}<RemixIcon name="arrow-down-s-line" size={14} /></Button>}><MenuRadioGroup value={kind} onValueChange={value => setKind(value as ModelKind)}>{modelKinds.map(value => <MenuRadioItem closeOnClick key={value} value={value}><RemixIcon name={typeIcons[value]} size={15} />{modelKindLabel(value, t, locale)}</MenuRadioItem>)}</MenuRadioGroup></Menu>}
      <Menu modal={false} trigger={<Button variant="ghost" className="om-button h-auto"><span className="om-provider-menu-label">{selectedProvider ? <ProviderAvatar name={selectedProvider.label} provider={selectedProvider} /> : <RemixIcon name="cloud-line" size={15} />}{selectedProvider?.label || t('All providers')}</span><RemixIcon name="arrow-down-s-line" size={14} /></Button>}><MenuRadioGroup value={providerId} onValueChange={value => setProviderId(String(value))}><MenuRadioItem closeOnClick value="all"><RemixIcon name="cloud-line" size={15} />{t('All providers')}</MenuRadioItem>{available.map(provider => <MenuRadioItem closeOnClick key={provider.id} value={provider.id}><span className="om-provider-menu-label"><ProviderAvatar name={provider.label} provider={provider} />{provider.label}</span></MenuRadioItem>)}</MenuRadioGroup></Menu>
    </div>
    {directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : <div className="om-model-choice-list">{models.map(model => <Button variant="plain" key={model.id} className="om-nav-item" aria-pressed={directory.data?.defaults[kind] === model.id} disabled={busy} onClick={() => void choose(model.id)}><ModelAvatar name={model.label} modelId={model.modelId} provider={available.find(provider => provider.id === model.provider)} /><span className="om-model-choice-label"><strong>{model.label}</strong><small className="om-muted">{available.find(provider => provider.id === model.provider)?.label}</small></span>{directory.data?.defaults[kind] === model.id && <RemixIcon name="check-line" size={16} />}</Button>)}{!models.length && <div className="om-empty om-muted">{t('No enabled models. Connect a provider or sync its models.')}</div>}</div>}
    <div className="om-settings-row om-selection-footer"><Button variant="ghost" className="om-button h-auto" onClick={() => { close(); openSettings(); }}><RemixIcon name="settings-3-line" size={15} />{t('Manage providers')}</Button>{directory.data?.defaults[kind] && <Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => void choose(null)}>{t('Reset default')}</Button>}</div>
    <StudioToastViewport {...toast} /></>}
  </>;
}
