import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import { Tooltip } from "../components/ui/Tooltip";
import { useEffect, useId, useRef, useState } from 'react';
import { type DirectoryModel, type ProviderConnection, type ProviderDirectory } from '../../../shared/provider-directory';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem, MenuSeparator } from '../components/ui/Menu';
import { Select } from '../components/ui/Select';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { gatewayRequest } from './gatewayClient';
import { notifyProvidersChanged, useProviderDirectory } from './useProviderDirectory';
import { ProviderAvatar, ModelAvatar, SettingsDialog, SettingsError, SettingsLoading, Toggle } from './settingsPrimitives';

import { ModelEditor, modelKindLabel } from './ModelEditor';
import { modelDisplayLabel, modelMediaCapabilities, shouldShowInlineModelId } from './modelMediaCapabilities';
import { ModelCatalog } from './ModelCatalog';
import { apiKeyError, apiUrlError, providerNameError } from './settingsValidation';
import { AccountStatus, UpgradeGuide, upgradePlan, useAccountSignIn } from './AccountSettings';
export { kindLabels, modelKindLabel } from './ModelEditor';
const categories = [{ id: 'all', label: 'All providers' }, { id: 'configured', label: 'Configured' }, { id: 'multimodal', label: 'Multimodal' }, { id: 'language', label: 'Language' }, { id: 'media', label: 'Media' }, { id: 'local', label: 'Local' }, { id: 'custom', label: 'Custom' }];
type Change = (action: () => Promise<unknown>, message: string) => Promise<boolean>;

/** Sidebar status: a dot only when the provider can actually run; configured-but-switched-off reads as Disabled. Unconfigured providers stay unmarked. */
export function providerListStatus(provider: { configured: boolean; enabled: boolean; available: boolean }): 'available' | 'disabled' | null {
  if (provider.available) return 'available';
  return provider.configured && !provider.enabled ? 'disabled' : null;
}

export function isOfficialProvider(provider: Pick<ProviderConnection, 'id'>): boolean {
  return provider.id === 'account' || provider.id === 'opendesign';
}

function providerSortRank(provider: ProviderConnection): number {
  if (provider.id === 'account') return 0;
  if (provider.id === 'opendesign') return 1;
  if (provider.setupRequired) return 5;
  if (provider.available) return 2;
  if (provider.configured) return 3;
  return 4;
}

const protocolLabels: Record<string, string> = {
  openai: 'OpenAI compatible',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
};

function providerSubtitle(provider: ProviderConnection, t: ReturnType<typeof useI18n>['t']): string {
  if (provider.id === 'opendesign') return t('Official API · API key');
  if (provider.protocol === 'agent') return t('Local Agent · Uses installed sign-in, no API key needed');
  if (provider.setupRequired) return t(provider.category === 'local' ? 'Local' : 'Built-in provider');
  if (provider.protocol === 'media') return t('Dedicated media · API key');
  const proto = protocolLabels[provider.protocol] ? t(protocolLabels[provider.protocol]) : provider.protocol;
  if (provider.custom) return `${t('Custom provider')} · ${proto}`;
  return proto;
}

export function ModelSettings({ onClose, openAccount, initialCategory = 'all', providerId, onProviderChange }: { onClose?: () => void; openAccount?: () => void; initialCategory?: string; providerId?: string | null; onProviderChange?: (id: string | null) => void }) {
  const { t, locale } = useI18n(), directory = useProviderDirectory(), toast = useToast();
  const [localSelected, setSelected] = useState(initialCategory === 'local' ? 'codex' : 'account'), [query, setQuery] = useState(''), [category, setCategory] = useState(initialCategory);
  const [status, setStatus] = useState('all'), [protocol, setProtocol] = useState('all');
  const [adding, setAdding] = useState(false), [localDetailOpen, setDetailOpen] = useState(false);
  const [handoffProvider, setHandoffProvider] = useState<string>();
  const handledHandoff = useRef(false);
  const entry = tracking.settingsEntryFrom();
  const requestedProvider = providerId ?? handoffProvider ?? (providerId === undefined ? localSelected : 'account');
  const detailOpen = Boolean(providerId ?? handoffProvider) || (providerId === undefined && localDetailOpen);
  const data = directory.data;
  const visibleProviders = data?.providers.filter(provider => {
    const models = data.models.filter(model => model.provider === provider.id);
    const textOnly = provider.kinds.length > 0 && provider.kinds.every(kind => kind === 'text') && models.every(model => model.kind === 'text');
    // New custom connections need to remain configurable before their first model sync.
    return !textOnly || provider.custom && !models.length;
  }) ?? [];
  const rejectedProvider = visibleProviders.find(p => p.configured && p.verification === 'rejected')?.id;
  useEffect(() => {
    if (entry !== 'agent_media_key_rejected') {
      handledHandoff.current = false;
      setHandoffProvider(undefined);
    } else if (providerId == null && rejectedProvider && !handledHandoff.current) {
      handledHandoff.current = true;
      setHandoffProvider(rejectedProvider);
    }
  }, [entry, providerId, rejectedProvider]);
  const selected = visibleProviders.some(provider => provider.id === requestedProvider) ? requestedProvider : 'account';
  const providers = visibleProviders.filter(provider => {
    const matches = category === 'all' || category === 'configured' && provider.configured || category === 'multimodal' && provider.kinds.length > 1
      || category === 'language' && provider.kinds.includes('text') || category === 'media' && provider.kinds.some(kind => ['image', 'video', 'audio', 'transcription'].includes(kind))
      || category === 'local' && provider.category === 'local' || category === 'custom' && provider.custom;
    return matches && (status === 'all' || status === 'enabled' && provider.enabled || status === 'disabled' && !provider.enabled || status === 'configured' && provider.configured || status === 'unconfigured' && !provider.configured) && (protocol === 'all' || provider.protocol === protocol) && `${provider.label} ${provider.id}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => providerSortRank(a) - providerSortRank(b));
  const officialProviders = providers.filter(isOfficialProvider);
  const otherProviders = providers.filter(item => !isOfficialProvider(item));
  const showSidebarGroups = officialProviders.length > 0 && otherProviders.length > 0;
  const provider = visibleProviders.find(provider => provider.id === selected);
  const select = (id: string) => {
    const item = visibleProviders.find(provider => provider.id === id);
    if (item) tracking.reportSettingsClick('provider_list', 'select_provider', { provider: item });
    handledHandoff.current = true;
    setHandoffProvider(undefined); setSelected(id); setDetailOpen(true); onProviderChange?.(id);
  };
  const closeDetail = () => {
    handledHandoff.current = true;
    setHandoffProvider(undefined); setDetailOpen(false); onProviderChange?.(null);
  };
  const renderProviderItem = (item: ProviderConnection) => {
    const official = isOfficialProvider(item);
    const roleHint = item.category === 'account' ? t('Your account') : official ? t('Official') : item.custom ? t('Custom provider') : item.kinds.length > 1 ? t('Multimodal') : modelKindLabel(item.kinds[0], t, locale);
    return <Tooltip label={`${item.label} · ${roleHint}`} wrap key={item.id}><Button variant="plain" aria-label={`${item.label} · ${roleHint}${providerListStatus(item) ? ` · ${t(providerListStatus(item) === 'available' ? 'Available' : 'Disabled')}` : ''}`} className="om-nav-item om-provider-item" data-status={providerListStatus(item)} onClick={() => select(item.id)} aria-current={item.id === selected ? 'page' : undefined}>
      <ProviderAvatar name={item.label} provider={item} /><span className="om-provider-item-name">{item.label}<small className="sr-only">{roleHint}</small></span>
      {official && <span className="om-badge om-official-badge">{t('Official')}</span>}
      {providerListStatus(item) === 'available' ? <span className="om-status-dot" role="img" aria-label={t('Available')} /> : providerListStatus(item) === 'disabled' ? <span className="om-badge">{t('Disabled')}</span> : null}
    </Button></Tooltip>;
  };
  return <section className="om-provider-settings" data-detail={detailOpen} aria-label={t('Model providers')}>
    <aside className="om-provider-list">
      <div className="om-provider-search"><label className="om-field"><RemixIcon name="search-line" size={16} /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search providers…')} aria-label={t('Search providers')} /></label>
        <Menu tooltip={t('Filter providers')} className="om-filter-menu" modal={false} aria-label={t('Filter providers')} trigger={<IconButton variant="ghost" className="motion-icon-button" aria-label={t('Filter providers')} icon={<RemixIcon name="filter-3-line" size={17} />} />}>
          <MenuRadioGroup value={category} onValueChange={value => { tracking.reportSettingsClick('provider_list', 'provider_filter'); setCategory(String(value)); }}>{categories.map(item => <MenuRadioItem value={item.id} key={item.id}>{item.id === 'language' ? modelKindLabel('text', t, locale) : t(item.label)}</MenuRadioItem>)}</MenuRadioGroup><MenuSeparator /><div className="om-menu-caption">{t('Status')}</div><MenuRadioGroup value={status} onValueChange={value => setStatus(String(value))}>{[['all', 'All statuses'], ['enabled', 'Enabled'], ['disabled', 'Disabled'], ['configured', 'Configured'], ['unconfigured', 'Not configured']].map(([id, label]) => <MenuRadioItem key={id} value={id}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup><MenuSeparator /><div className="om-menu-caption">{t('API protocol')}</div><MenuRadioGroup value={protocol} onValueChange={value => setProtocol(String(value))}>{[['all', 'All protocols'], ['openai', 'OpenAI compatible'], ['anthropic', 'Anthropic'], ['google', 'Google Gemini'], ['media', 'Media'], ['account', 'Your account'], ['agent', 'Local Agent']].map(([id, label]) => <MenuRadioItem key={id} value={id}>{t(label)}</MenuRadioItem>)}</MenuRadioGroup>
        </Menu>
      </div>
      <div className="om-provider-list-caption"><span className="om-eyebrow">{category === 'language' ? modelKindLabel('text', t, locale) : t(categories.find(item => item.id === category)?.label ?? 'All providers')} · {providers.length}</span>{(category !== 'all' || query || status !== 'all' || protocol !== 'all') && <Tooltip label={t('Clear filters')} wrap><IconButton variant="ghost" className="motion-icon-button" aria-label={t('Clear filters')} onClick={() => { setQuery(''); setCategory('all'); setStatus('all'); setProtocol('all'); }} icon={<RemixIcon name="close-line" size={14} />} /></Tooltip>}</div>
      <div className="om-settings-tags om-provider-filter-tags">{status !== 'all' && <Button variant="plain" className="om-badge" onClick={() => setStatus('all')}>{t(({ enabled: 'Enabled', disabled: 'Disabled', configured: 'Configured', unconfigured: 'Not configured' } as Record<string, string>)[status])}<RemixIcon name="close-line" size={12} /></Button>}{protocol !== 'all' && <Button variant="plain" className="om-badge" onClick={() => setProtocol('all')}>{protocol}<RemixIcon name="close-line" size={12} /></Button>}</div>
      <div className="om-provider-list-state">{directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : null}</div>
      <nav aria-label={t('Providers')} className="om-provider-items">
        {showSidebarGroups ? <>
          {officialProviders.map(renderProviderItem)}
          <div className="om-provider-divider" role="separator" />
          {otherProviders.map(renderProviderItem)}
        </> : providers.map(renderProviderItem)}
        {directory.data && !providers.length && <p className="om-empty om-muted">{t('No matching providers')}</p>}
      </nav>
      <Button variant="plain" className="om-button om-add-provider" onClick={() => { tracking.reportSettingsClick('provider_list', 'add_provider'); setAdding(true); }}><RemixIcon name="add-line" size={16} />{t('Add provider')}</Button>
    </aside>
    <div className="om-provider-detail">
      <Button variant="plain" className="om-button om-provider-back" onClick={closeDetail}><RemixIcon name="arrow-left-line" size={16} />{t('Providers')}</Button>
      {directory.error ? <SettingsError retry={directory.refresh} /> : !directory.data ? <SettingsLoading /> : provider ? <ProviderDetail key={provider.id} provider={provider} data={directory.data} openAccount={openAccount} showToast={toast.showToast} onRemoved={() => { setSelected('account'); closeDetail(); }} /> : <div className="om-empty">{t('Select a provider')}</div>}
    </div>
    {adding && <AddProvider onClose={() => setAdding(false)} onAdded={id => { setAdding(false); setCategory('all'); setQuery(''); select(id); notifyProvidersChanged(); toast.showToast(t('Provider added'), 'info'); }} showToast={toast.showToast} />}
    {onClose && <Button variant="ghost" className="om-button h-auto" onClick={onClose}>{t('Back to editor')}</Button>}
    <StudioToastViewport {...toast} />
  </section>;
}

function useProviderValidation(label: string | undefined, baseUrl: string | undefined, apiKey: string, provider?: ProviderConnection) {
  const [validated, setValidated] = useState(false), [focusRequest, setFocusRequest] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = { label: label === undefined ? undefined : providerNameError(label), baseUrl: baseUrl === undefined ? undefined : apiUrlError(baseUrl, provider?.protocol === 'media'), apiKey: apiKeyError(apiKey) };
  if (provider?.protocol !== 'media' && provider?.credentialSource === 'stored' && !apiKey.trim() && baseUrl !== undefined && !errors.baseUrl) {
    let storedOrigin: string | undefined;
    try { storedOrigin = new URL(provider.baseUrl).origin; } catch { /* An unset or malformed stored URL has no origin to compare. */ }
    if (storedOrigin && new URL(baseUrl).origin !== storedOrigin) {
      errors.apiKey = 'Enter the API key again when changing the API origin.';
    }
  }
  useEffect(() => {
    if (!focusRequest) return;
    const field = formRef.current?.querySelector<HTMLInputElement>('[aria-invalid="true"]');
    field?.focus(); field?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);
  return { formRef, reset: () => setValidated(false), errors: validated ? errors : { label: undefined, baseUrl: undefined, apiKey: undefined }, validate: () => {
    setValidated(true);
    if (Object.values(errors).some(Boolean)) { setFocusRequest(value => value + 1); return false; }
    return true;
  } };
}

function formatPlanLabel(plan?: string | null) {
  const value = plan?.trim();
  if (!value) return undefined;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * The OpenDesign provider shows the account page's guides and signs in in place: signed-out people see the
 * multimodal sign-in guide, sign-in progress stays on this page, Free and Go accounts see the upgrade guide.
 * Configured paid accounts fold account identity, plan and management directly into the provider header.
 */
function AccountProviderHeader({ provider, openAccount, showToast }: { provider: ProviderConnection; openAccount?: () => void; showToast: ReturnType<typeof useToast>['showToast'] }) {
  // Until the summary loads (or if it fails), the callout below still signs in here rather than leaving the page.
  const { t } = useI18n(), { state: { account }, busy, action, subscription, refreshBilling } = useAccountSignIn('provider_detail', showToast, provider);
  const [refreshing, setRefreshing] = useState(false);
  const entry = tracking.settingsEntryFrom();
  const plan = upgradePlan(account);
  const showStatusGuide = Boolean(account && ['signed-out', 'unavailable', 'authorizing', 'reauth-required'].includes(account.state));
  const showUpgradeGuide = Boolean(plan && account);
  const showBillingRecovery = Boolean(!showStatusGuide && !showUpgradeGuide && account?.state === 'signed-in' && (account.billingUnavailable || entry === 'agent_media_balance_low'));
  const showSignInFallback = !showStatusGuide && !showUpgradeGuide && !showBillingRecovery && !provider.configured;
  const advisoryReason = !showStatusGuide && !showUpgradeGuide && !showBillingRecovery && provider.configured && provider.reason && provider.reason !== 'Included with your account' ? provider.reason : undefined;
  const identity = account?.user?.email?.trim() || account?.user?.name?.trim();
  const planBadge = !showStatusGuide && !showUpgradeGuide && !showBillingRecovery && provider.configured ? formatPlanLabel(account?.plan) : undefined;
  const meta = identity ? `${identity} · ${t('Your account')}` : t('Your account');
  async function retryBilling() {
    tracking.reportSettingsClick('provider_detail', 'refresh_billing');
    setRefreshing(true);
    try { await refreshBilling(); } finally { setRefreshing(false); }
  }
  const billingUnavailable = Boolean(account?.billingUnavailable);
  const upgradeEntry = entry === 'agent_media_upgrade_free' || entry === 'agent_media_upgrade_go';
  return <>
    <header className="om-settings-row om-provider-header">
      <div className="om-provider-heading">
        <ProviderAvatar name={provider.label} provider={provider} />
        <div className="om-provider-heading-copy">
          <div className="om-provider-title-row">
            <h1 className="om-title">{provider.label}</h1>
            <span className="om-badge om-official-badge">{t('Official')}</span>
            {planBadge && <span className="om-badge om-provider-plan-badge">{planBadge}</span>}
            <span className="om-badge om-provider-status-badge" data-active={provider.configured}>{t(provider.configured ? 'Configured' : 'Not configured')}</span>
          </div>
          <p className="om-muted om-provider-meta">{meta}</p>
        </div>
      </div>
      {provider.configured && openAccount && !showStatusGuide && !showUpgradeGuide && !showBillingRecovery && <Button variant="ghost" className="om-button h-auto" onClick={openAccount}>{t('Manage account')}<RemixIcon name="arrow-right-line" size={14} /></Button>}
    </header>
    {showStatusGuide ? <AccountStatus account={account!} busy={busy} action={action} showToast={showToast} />
      : showUpgradeGuide ? <UpgradeGuide plan={plan!} subscription={subscription} />
      : showBillingRecovery ? <section className="om-card om-card-stack">
        <h2 className="om-subtitle">{t(billingUnavailable ? 'OpenDesign billing is unavailable' : 'OpenDesign balance is too low')}</h2>
        <p className="om-muted">{t(billingUnavailable ? "Couldn't verify your OpenDesign plan and balance right now." : 'Your OpenDesign balance was too low for the media request. Check your credits in OpenDesign, then refresh here.')}</p>
        {billingUnavailable && upgradeEntry && <p className="om-muted">{t('Multimodal generation requires OpenDesign Plus or above.')}</p>}
        <div className="om-settings-actions">
          {subscription.button('manage_subscription')}{subscription.link}
          <Button variant="ghost" className="om-button h-auto" disabled={refreshing} aria-busy={refreshing} onClick={() => void retryBilling()}>{t('Refresh')}</Button>
        </div>
      </section>
      : showSignInFallback ? <div className="om-card om-account-callout">
        <span className="om-account-callout-icon" aria-hidden="true"><RemixIcon name="account-circle-line" size={22} /></span>
        <div className="om-account-callout-body">
          <h2 className="om-subtitle">{t('One account. Your models, together.')}</h2>
          <p className="om-muted">{t('Sign in with OpenDesign to sync your models, subscription and usage.')}</p>
        </div>
        <div className="om-account-callout-action">
          <Button variant="ghost" className="om-button h-auto" data-primary disabled={busy} onClick={() => void action('login')}>{t('Sign in with OpenDesign')}</Button>
        </div>
      </div>
      : advisoryReason ? <div className="om-provider-notice" role="note"><RemixIcon name="information-line" size={16} /><span>{t(advisoryReason)}</span></div>
      : null}
  </>;
}

function ProviderDetail({ provider, data, openAccount, showToast, onRemoved }: { provider: ProviderConnection; data: ProviderDirectory; openAccount?: () => void; showToast: ReturnType<typeof useToast>['showToast']; onRemoved: () => void }) {
  const { t, locale } = useI18n();
  const [apiKey, setApiKey] = useState(''), [baseUrl, setBaseUrl] = useState(provider.baseUrl), [label, setLabel] = useState(provider.label);
  const [busy, setBusy] = useState(false), [visible, setVisible] = useState(false), [addModel, setAddModel] = useState(false), [removing, setRemoving] = useState(false);
  const [editing, setEditing] = useState<DirectoryModel | null>(null);
  const models = data.models.filter(model => model.provider === provider.id);

  const fixedOrigin = provider.baseUrlEditable === false;
  const validation = useProviderValidation(provider.custom ? label : undefined, fixedOrigin ? undefined : baseUrl, apiKey, provider);
  const keyErrorId = useId();
  useEffect(() => { setBaseUrl(provider.baseUrl); setLabel(provider.label); }, [provider.baseUrl, provider.label]);
  const change: Change = async (action, message) => {
    setBusy(true);
    const reported = tracking.providerAction(message);
    try { await action(); notifyProvidersChanged(); showToast(t(message), 'info'); if (reported) tracking.reportProviderSetting(provider, reported, 'success'); return true; }
    catch (error) { if (reported) tracking.reportProviderSetting(provider, reported, 'failure'); showToast(error instanceof Error ? error.message : t('Could not save settings'), 'error'); return false; }
    finally { setBusy(false); }
  };
  const subtitle = providerSubtitle(provider, t);
  const official = isOfficialProvider(provider);
  const nonMediaProtocolNotice = !provider.setupRequired && ['anthropic', 'google'].includes(provider.protocol);
  const hasMultipleKinds = new Set(models.map(model => model.kind)).size > 1;
  const defaultIds = new Set(Object.values(data.defaults).filter((value): value is string => Boolean(value)));
  return <div className="om-provider-detail-inner">
    {provider.protocol === 'account' ? <AccountProviderHeader provider={provider} openAccount={openAccount} showToast={showToast} /> : <header className="om-settings-row om-provider-header">
      <div className="om-provider-heading">
        <ProviderAvatar name={provider.label} provider={provider} />
        <div className="om-provider-heading-copy">
          <div className="om-provider-title-row">
            <h1 className="om-title">{provider.label}</h1>
            {official && <span className="om-badge om-official-badge">{t('Official')}</span>}
            {!provider.setupRequired && <span className="om-badge om-provider-status-badge" data-active={provider.configured}>{t(provider.configured ? 'Configured' : 'Not configured')}</span>}
          </div>
          <p className="om-muted om-provider-meta">{subtitle}</p>
        </div>
      </div>
      {!provider.setupRequired && <Toggle label={t('Enable provider')} checked={provider.enabled} disabled={busy || !provider.configured && provider.protocol !== 'agent'} onChange={enabled => void change(() => gatewayRequest(`settings/providers/${provider.id}`, 'PUT', { enabled }), 'Provider updated')} />}
    </header>}
    {provider.protocol === 'account' ? null
      : provider.protocol === 'agent' ? <div className="om-provider-notice om-agent-status-bar" role="status">
        <RemixIcon name={provider.available ? 'checkbox-circle-line' : 'information-line'} size={16} />
        <span className="om-agent-status-copy">{t(provider.reason)}</span>
        <Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => void change(() => gatewayRequest(`settings/providers/${provider.id}/sync`, 'POST', {}), 'Agent status refreshed')}><RemixIcon name="refresh-line" size={14} />{t(busy ? 'Working…' : 'Refresh status')}</Button>
      </div>
      : provider.setupRequired ? <div className="om-card om-card-stack"><h2 className="om-subtitle">{t('Dedicated integration required')}</h2><p className="om-muted">{t(provider.reason)}</p>{provider.website && <a className="om-button" href={provider.website} target="_blank" rel="noreferrer">{t('Provider website')}<RemixIcon name="external-link-line" size={14} /></a>}</div>
      : <form noValidate ref={validation.formRef} className="om-provider-form" onSubmit={event => { event.preventDefault(); if (!validation.validate()) return; void change(async () => {
        await gatewayRequest(`settings/providers/${provider.id}`, 'PUT', { ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), ...(!fixedOrigin ? { baseUrl: baseUrl.trim() } : {}), ...(provider.custom ? { label } : {}) }); validation.reset(); setApiKey(''); setVisible(false);
      }, 'Provider settings saved'); }}>
        {provider.verification === 'rejected' && <p className="om-muted" role="alert">{t('Credentials or permissions rejected; update the key')}</p>}
        {nonMediaProtocolNotice && <div className="om-provider-notice" role="note"><RemixIcon name="information-line" size={16} /><span>{t('This protocol currently syncs models and saves text defaults only; image, video and audio generation are not executed through it.')}</span></div>}
        {provider.custom && <TextField label={t('Provider name')} value={label} onChange={setLabel} error={validation.errors.label} required />}
        <label className="om-label">{t('API key')}<span className="om-field"><input type={visible ? 'text' : 'password'} aria-label={`${provider.label} API key`} aria-invalid={Boolean(validation.errors.apiKey) || undefined} aria-describedby={validation.errors.apiKey ? keyErrorId : undefined} autoComplete="off" spellCheck={false} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={t(provider.configured ? 'Key saved · enter to replace' : 'Paste your API key')} /><Tooltip label={t(visible ? 'Hide API key' : 'Show API key')} wrap><IconButton variant="ghost" type="button" className="motion-icon-button" aria-label={t(visible ? 'Hide API key' : 'Show API key')} onClick={() => setVisible(value => !value)} icon={<RemixIcon name={visible ? 'eye-off-line' : 'eye-line'} size={16} />} /></Tooltip></span><small id={keyErrorId} className="om-field-error" role={validation.errors.apiKey ? 'alert' : undefined}>{validation.errors.apiKey ? t(validation.errors.apiKey) : null}</small></label>
        <div className="om-settings-row"><span className="om-muted">{t(provider.credentialSource === 'environment' ? 'Using environment key' : 'Keys stay on this computer and are never returned by the API.')}</span>{provider.website && <a href={provider.website} target="_blank" rel="noreferrer" className="om-text-link">{t('Get API key')}<RemixIcon name="external-link-line" size={13} /></a>}</div>
        {!fixedOrigin && <TextField label={t('API base URL')} value={baseUrl} onChange={setBaseUrl} error={validation.errors.baseUrl} type="url" required placeholder="https://api.example.com/v1" />}
        <div className="om-settings-row"><div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy || !apiKey.trim() && baseUrl === provider.baseUrl && label === provider.label}>{t(busy ? 'Saving…' : 'Save settings')}</Button>
          {provider.credentialSource === 'stored' && <Button variant="ghost" className="om-button h-auto" type="button" disabled={busy} onClick={() => void change(async () => { await gatewayRequest(`settings/providers/${provider.id}`, 'PUT', { apiKey: null }); setApiKey(''); }, 'Saved key removed')}>{t('Remove saved key')}</Button>}</div>
          {provider.docs && <a className="om-text-link" href={provider.docs} target="_blank" rel="noreferrer">{t('Usage guide')}<RemixIcon name="external-link-line" size={13} /></a>}
        </div>
      </form>}
    {!provider.setupRequired && <section className="om-model-section" aria-label={t('Models')}>
      <div className="om-settings-row"><h2 className="om-subtitle">{t('Models')}{!hasMultipleKinds && <> <span className="om-muted">{models.length}</span></>}</h2>
        {provider.protocol !== 'agent' && <div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" disabled={busy || !provider.configured} onClick={() => void change(() => gatewayRequest(`settings/providers/${provider.id}/sync`, 'POST', {}), 'Models synced')}><RemixIcon name="refresh-line" size={15} />{t(busy ? 'Working…' : 'Sync models')}</Button>
          {provider.protocol !== 'account' && <Tooltip label={t('Add model')} wrap><IconButton variant="plain" className="om-button" aria-label={t('Add model')} onClick={() => setAddModel(true)} icon={<RemixIcon name="add-line" size={17} />} /></Tooltip>}</div>}
      </div>
      <ModelCatalog models={models} defaultIds={defaultIds} render={model => <ModelRow key={model.id} model={model} provider={provider} selected={data.defaults[model.kind] === model.id} busy={busy} change={change} edit={() => setEditing(model)} />} />
    </section>}
    {provider.custom && <div className="om-settings-row om-provider-remove"><span className="om-muted">{t('Remove this provider and its saved models from this workspace.')}</span><Button variant="ghost" className="om-button h-auto" disabled={busy} onClick={() => setRemoving(true)}>{t('Delete provider')}</Button></div>}
    {removing && <SettingsDialog title={t('Delete provider')} onClose={() => setRemoving(false)}><p className="om-muted">{t('This removes the saved key and models. Existing project media is kept.')}</p><div className="om-settings-actions"><Button variant="ghost" className="om-button h-auto" onClick={() => setRemoving(false)}>{t('Cancel')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy} onClick={() => void change(() => gatewayRequest(`settings/providers/${provider.id}`, 'DELETE'), 'Provider deleted').then(ok => { if (ok) onRemoved(); })}>{t('Delete')}</Button></div></SettingsDialog>}
    {editing && <ModelEditor provider={provider} model={editing} onClose={() => setEditing(null)} save={input => change(() => gatewayRequest('settings/models', 'PATCH', input), 'Model updated')} />}
    {addModel && <ModelEditor provider={provider} onClose={() => setAddModel(false)} save={input => change(() => gatewayRequest(`settings/providers/${provider.id}/models`, 'POST', input), 'Model added')} />}
  </div>;
}

function ModelRow({ model, provider, selected, busy, change, edit }: { model: DirectoryModel; provider: ProviderConnection; selected: boolean; busy: boolean; change: Change; edit: () => void }) {
  const { t, locale } = useI18n();
  const executable = !['image', 'video', 'audio'].includes(model.kind) || ['media', 'agent', 'account'].includes(provider.protocol) || provider.protocol === 'openai' && ['image', 'audio'].includes(model.kind);
  const displayLabel = modelDisplayLabel(model);
  const showModelId = shouldShowInlineModelId(displayLabel, model.modelId, provider.protocol);
  const idHint = !showModelId && model.modelId.trim() && model.modelId.trim() !== displayLabel.trim() ? model.modelId : undefined;
  const capabilityHints = modelMediaCapabilities(model, t);
  const canEditModel = !['agent', 'account'].includes(provider.protocol);
  return <div className="om-model-row" data-selected={selected || undefined}>
    <ModelAvatar name={displayLabel} modelId={model.modelId} provider={provider} />
    <div className="om-model-name">
      <div className="om-model-title">
        <strong title={idHint}>{displayLabel}</strong>
        {showModelId && <small className="om-muted om-model-id">{model.modelId}</small>}
      </div>
      {capabilityHints.length > 0 && <small className="om-muted om-model-capabilities">{capabilityHints.join(' · ')}</small>}
    </div>
    <span className="om-badge om-model-kind-badge">{modelKindLabel(model.kind, t, locale)}</span>
    <Button variant="ghost" className="om-button h-auto om-model-default-button" data-active={selected || undefined} aria-pressed={selected} disabled={busy || !model.enabled || !provider.available || !executable} aria-label={t('Use {model} as default', { model: displayLabel })} onClick={() => void change(() => gatewayRequest('settings/default-model', 'PUT', { kind: model.kind, model: selected ? null : model.id }), 'Default model updated')}>{selected ? <><RemixIcon name="check-line" size={14} />{t('Default')}</> : t('Use model')}</Button>
    {canEditModel && <Menu tooltip={t('Model options')} modal={false} trigger={<IconButton variant="ghost" className="motion-icon-button" aria-label={t('Model options')} icon={<RemixIcon name="more-2-line" size={16} />} />}><MenuItem onClick={edit}>{t('Edit model')}</MenuItem>{provider.protocol !== 'media' && <><MenuSeparator /><MenuItem onClick={() => void change(() => gatewayRequest('settings/models', 'PUT', { id: model.id, enabled: !model.enabled }), 'Model updated')}>{t(model.enabled ? 'Disable model' : 'Enable model')}</MenuItem><MenuItem onClick={() => void change(() => gatewayRequest('settings/models', 'PUT', { id: model.id, enabled: null }), 'Model removed')}>{t('Remove model')}</MenuItem></>}</Menu>}
  </div>;
}
function TextField({ label, value, onChange, type = 'text', required, placeholder, error }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean; placeholder?: string; error?: string }) {
  const id = useId(), { t } = useI18n();
  return <label className="om-label">{label}<span className="om-field"><input type={type} required={required} aria-label={label} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? id : undefined} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} autoComplete="off" spellCheck={false} /></span><small id={id} className="om-field-error" role={error ? 'alert' : undefined}>{error ? t(error) : null}</small></label>;
}
function AddProvider({ onClose, onAdded, showToast }: { onClose: () => void; onAdded: (id: string) => void; showToast: ReturnType<typeof useToast>['showToast'] }) {
  const { t } = useI18n();
  const [label, setLabel] = useState(''), [apiKey, setApiKey] = useState(''), [baseUrl, setBaseUrl] = useState(''), [protocol, setProtocol] = useState('openai'), [busy, setBusy] = useState(false);
  const validation = useProviderValidation(label, baseUrl, apiKey);
  return <SettingsDialog title={t('Add custom provider')} onClose={onClose}><form noValidate ref={validation.formRef} className="om-provider-form" onSubmit={event => { event.preventDefault(); if (!validation.validate()) return; setBusy(true); void gatewayRequest<{ id: string }>('settings/providers', 'POST', { label, apiKey: apiKey.trim() || undefined, baseUrl, protocol }).then(({ id }) => { tracking.reportProviderSetting({ id, custom: true }, 'add_provider', 'success'); setApiKey(''); onAdded(id); }).catch(error => { tracking.reportProviderSetting({ id: '', custom: true }, 'add_provider', 'failure'); showToast(error.message, 'error'); }).finally(() => setBusy(false)); }}>
    <div className="om-provider-avatar-preview"><ProviderAvatar name={label || 'P'} /></div>
    <TextField label={t('Provider name')} value={label} onChange={setLabel} error={validation.errors.label} required placeholder={t('My provider')} />
    <TextField label={t('API key')} value={apiKey} onChange={setApiKey} error={validation.errors.apiKey} type="password" placeholder={t('Paste your API key')} />
    <div className="om-label">{t('API protocol')}<Select label={t('API protocol')} value={protocol} onCommit={setProtocol} options={[{ value: 'openai', label: 'OpenAI compatible', icon: <ProviderAvatar name="OpenAI" provider={{ id: 'openai', custom: false }} /> }, { value: 'anthropic', label: 'Anthropic', icon: <ProviderAvatar name="Anthropic" provider={{ id: 'anthropic', custom: false }} /> }, { value: 'google', label: 'Google Gemini', icon: <ProviderAvatar name="Gemini" provider={{ id: 'gemini', custom: false }} /> }]} /></div>
    <TextField label={t('API base URL')} value={baseUrl} onChange={setBaseUrl} error={validation.errors.baseUrl} type="url" required placeholder="https://api.example.com/v1" />
    <small className="om-muted">{t('Include the API version or path prefix used by your provider.')}</small>
    {baseUrl && <p className="om-inset om-muted om-endpoint-preview">{t('Model catalogue')}: {baseUrl.replace(/\/+$/, '')}/models</p>}
    <div className="om-dialog-actions"><Button variant="ghost" type="button" className="om-button h-auto" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy}>{t(busy ? 'Adding…' : 'Add provider')}</Button></div>
  </form></SettingsDialog>;
}
