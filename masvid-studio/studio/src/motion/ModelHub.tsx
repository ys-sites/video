import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { MotionIcon } from './icons';
import { GitHubLink } from './GitHubLink';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { ModelAvatar } from './settingsPrimitives';
import { useMediaCatalog } from './useMediaCatalog';
import { useAccountSummary } from './AccountSettings';
import { mediaLabels } from './creativeStudios';
import { findModelHub } from './modelHubs';
import { HubVideoWall } from './HubVideoWall';
import { reportHubClick, reportHubPageView } from './exploreTracking';
import { BackToExploreButton } from './BackToExploreButton';

/** Aggregates one model family: what it is, what to make with it, and whether this installation can use it. */
export function ModelHub({ id, onExplore, onProvider, onModel, onUse, onSettings, onStartScenario, hasProject = false }: {
  id: string; hasProject?: boolean; onExplore: () => void; onProvider: (provider: string) => void; onModel: (id: string) => void;
  onUse: () => void; onSettings: (section: 'account' | 'subscription') => void; onStartScenario?: () => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  const hub = findModelHub(id);
  const { catalog, failed, retry } = useMediaCatalog(Boolean(hub));
  const account = useAccountSummary();
  const signedIn = account.account?.state === 'signed-in';
  // One view per visit, once the sign-in state is known (or could not be read).
  const viewed = useRef(false);
  const accountKnown = account.account !== null || account.error;
  useEffect(() => {
    if (!hub || viewed.current || !accountKnown) return;
    viewed.current = true;
    reportHubPageView(hub.id, hasProject, signedIn);
  }, [hub, accountKnown, signedIn, hasProject]);
  if (!hub) return <main className="om-explore"><div className="om-discovery-page">
    <div><BackToExploreButton onClick={onExplore} /></div>
    <section><h1 className="om-title">{t('Page unavailable')}</h1><p className="om-muted">{id}</p></section>
  </div></main>;
  const served = catalog?.models.filter(model => hub.modelPattern.test(model.id) || hub.modelPattern.test(model.modelId)) ?? [];
  const companions = catalog?.models.filter(model => !served.includes(model) && (hub.companionPattern.test(model.id) || hub.companionPattern.test(model.modelId))) ?? [];
  const provider = catalog?.status.providers.find(item => item.id === hub.provider);
  const track = (area: Parameters<typeof reportHubClick>[1], element: Parameters<typeof reportHubClick>[2], fields: Parameters<typeof reportHubClick>[3] = {}) =>
    reportHubClick(hub.id, area, element, { signedIn, ...fields });

  return <main className="om-explore om-model-hub-page" onKeyDown={event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.current?.focus(); }
  }}>
    <div className="om-gallery-sticky-header"><header className="om-gallery-header">
      <div className="om-gallery-wordmark"><BackToExploreButton onClick={() => { track('hub_header', 'back_to_explore'); onExplore(); }} /><span className="om-gallery-page-label">{hub.latestModel}</span></div>
      <div className="om-control-row om-gallery-header-actions">
        <label className="om-field om-search-field"><MotionIcon name="search" size={16} /><input ref={search} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onFocus={() => track('hub_header', 'search_focus')}
          placeholder={t('Search videos, creators, scenes…')} aria-label={t('Search videos')} /><kbd>{searchShortcut}</kbd></label>
        <GitHubLink className="om-button" />
      </div>
    </header></div>
    <div className="om-discovery-page om-model-hub" data-hub={hub.id}>

    <header className="om-model-hub-hero">
      <img src={hub.poster} alt="" />
      <div className="om-model-hub-hero-copy">
        <span className="om-model-hub-eyebrow"><RemixIcon name="sparkling-line" size={16} />{t(hub.eyebrow)} · {hub.vendor}</span>
        <h1>{hub.latestModel}</h1>
        <p>{t(hub.summary)}</p>
        <div className="om-model-hub-actions">
          {signedIn
            ? <>
              <Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={() => { track('hub_hero', 'open_in_studio'); onUse(); }}>{t('Open in {studio}', { studio: t('Motion Studio') })}<RemixIcon name="arrow-right-line" size={16} /></Button>
              <Button variant="plain" className="om-button om-model-hub-connected" onClick={() => { track('hub_hero', 'manage_connection'); onProvider('account'); }} title={t('Manage connection')}><RemixIcon name="checkbox-circle-fill" size={16} />{t('Connected to {provider}', { provider: 'OpenDesign' })}</Button>
            </>
            : <>
              <Button variant="ghost" className="om-button h-auto" data-primary="media" onClick={() => { track('hub_hero', 'sign_in'); onSettings('account'); }}>{t('Sign in to use {model} now', { model: hub.latestModel })}<RemixIcon name="arrow-right-line" size={16} /></Button>
              {provider?.available
                ? <Button variant="plain" className="om-button om-model-hub-connected" onClick={() => { track('hub_hero', 'manage_connection'); onProvider(hub.provider); }} title={t('Manage connection')}><RemixIcon name="checkbox-circle-fill" size={16} />{t('Connected to {provider}', { provider: provider.label })}</Button>
                : <Button variant="ghost" className="om-button h-auto" onClick={() => { track('hub_hero', 'connect_key'); onProvider(hub.provider); }}><RemixIcon name="plug-line" size={16} />{t('Connect your own API key')}</Button>}
            </>}
          {onStartScenario && (
            <Button variant="ghost" type="button" className="om-button h-auto" onClick={() => { track('hub_hero', 'open_in_studio'); onStartScenario(); }}>
              <RemixIcon name="route-line" size={16} />{t('Start Gemini 4 Neon workflow')}
            </Button>
          )}
        </div>
      </div>
    </header>

    {hub.videos.length > 0 && <HubVideoWall hubId={hub.id} signedIn={accountKnown ? signedIn : undefined} videos={hub.videos} query={query} title={hub.title} />}



    <section aria-live="polite">
      <h2 className="om-subtitle">{t('Availability in OpenMotion')}</h2>
      {failed ? <Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry loading models')}</Button>
        : !catalog ? <Skeleton className="om-featured-template-skeleton" />
        : served.length ? <div className="om-model-hub-models">{served.map((model, index) => <Button variant="plain" key={model.id} className="om-model-hub-model" onClick={() => { track('hub_availability', 'select_model', { model: model.id, position: index }); onModel(model.id); }}>
            <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
            <span><strong>{model.label}</strong><small>{model.provider} · {model.modelId}</small></span><RemixIcon name="arrow-right-s-line" size={16} />
          </Button>)}</div>
        : <div className="om-model-hub-paths">
            <p className="om-muted">{t('Two ways to use {model}:', { model: hub.modelName })}</p>
            <div className="om-model-hub-path" data-recommended="true">
              <span className="om-model-hub-path-label">{t('Recommended')}</span>
              {/* Signed-in people are never asked to sign in again; they see what their plan needs instead. */}
              <strong><RemixIcon name="account-circle-line" size={16} />{t(signedIn ? 'Use it with your OpenDesign plan' : 'Sign in and subscribe')}</strong>
              <p>{t(signedIn ? '{model} appears here as soon as OpenDesign serves it on your plan. No API key needed.' : 'Sign in to OpenDesign with a paid plan and use {model} right away. No API key needed.', { model: hub.modelName })}</p>
              <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => { track('hub_availability', signedIn ? 'view_plans' : 'sign_in'); onSettings(signedIn ? 'subscription' : 'account'); }}>{t(signedIn ? 'View plans' : 'Sign in')}<RemixIcon name="arrow-right-line" size={16} /></Button>
            </div>
            <div className="om-model-hub-path">
              <strong><RemixIcon name="plug-line" size={16} />{t('Connect your own API key')}</strong>
              <p>{t(provider?.available ? 'Your Gemini API key is connected. {model} appears here once your key has access.' : 'Add a Gemini API key with paid access. Usage is billed by Google.', { model: hub.modelName })}</p>
              <Button variant="ghost" className="om-button h-auto" onClick={() => { track('hub_availability', provider?.available ? 'manage_connection' : 'connect_key'); onProvider(hub.provider); }}><RemixIcon name="plug-line" size={16} />{t(provider?.available ? 'Model providers' : 'Connect {provider}', { provider: provider?.label ?? 'Gemini' })}</Button>
            </div>
          </div>}
    </section>


    {companions.length > 0 && <section>
      <h2 className="om-subtitle">{t('Pair with {vendor} media models', { vendor: 'Google' })}</h2>
      <div className="om-model-hub-models">{companions.map((model, index) => <Button variant="plain" key={model.id} className="om-model-hub-model" onClick={() => { track('hub_availability', 'select_model', { model: model.id, position: served.length + index }); onModel(model.id); }}>
        <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
        <span><strong>{model.label}</strong><small>{t(mediaLabels[model.modality])} · {model.provider}</small></span><RemixIcon name="arrow-right-s-line" size={16} />
      </Button>)}</div>
    </section>}


  </div></main>;
}
