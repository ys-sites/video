import { useMemo, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import type { Model, ProviderState } from '../../../shared/gateway';
import { cn } from '../components/ui/cn';
import { FieldInput, FieldTrigger } from '../components/ui/FormField';
import { MenuPanel } from '../components/ui/MenuPanel';
import { Popover } from '../components/ui/Popover';
import { Select } from '../components/ui/Select';
import { SelectArrow } from '../components/ui/SelectArrow';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { ModelAvatar, ProviderAvatar } from './settingsPrimitives';
import { imageModelBadge, isOpenDesignProvider, modelFamilyKey, modelFamilyLabel, providerDisplayName, providerRank, providerReady } from './imageMenuModels';

/** Library creation outside a Studio: one model list across ready providers. */
export function GenerationModelPickers({ models, preferred, modelHeading, disabled, onChoose }: {
  models: Model[]; preferred?: Model; modelHeading: ReactNode; disabled: boolean; onChoose: (id: string) => void;
}) {
  const { t } = useI18n();
  return <div className="om-generation-pickers">
    <div className="om-generation-picker">
      {modelHeading}
      <Select label={t('Generation model')} disabled={disabled} value={preferred?.id ?? ''} onCommit={onChoose}
        options={models.map(model => ({ value: model.id, label: model.label, description: model.provider + ' · ' + model.mode,
          icon: <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} /> }))} />
    </div>
  </div>;
}

/**
 * Studio creation: choose the provider, then one of its models. Providers without credentials stay listed but
 * cannot be chosen; their models remain visible so the page can ask for setup.
 */
export function CreationModelPicker({ models, providers, selected, providerHeading, modelHeading, disabled, onChoose, onManageProviders, onConfigureProvider, appearance = 'standard', popupClassName }: {
  models: Model[]; providers: ProviderState[]; selected?: Model; providerHeading?: ReactNode; modelHeading: ReactNode; disabled: boolean;
  onChoose: (id: string) => void; onManageProviders?: () => void; onConfigureProvider?: (providerId: string) => void; appearance?: 'standard' | 'boxed'; popupClassName?: string;
}) {
  const { t } = useI18n();
  const boxed = appearance === 'boxed';
  const SearchInput = boxed ? FieldInput : 'input';
  const popupClass = cn('om-picker-popover', !boxed && 'om-selection-panel', popupClassName);
  const menuPanel = boxed ? <MenuPanel data-form-surface="subtle" /> : undefined;
  const [open, setOpen] = useState<'model' | 'provider' | null>(null);
  const [query, setQuery] = useState('');
  const providerIds = useMemo(() => {
    const tier = (id: string) => isOpenDesignProvider(id) ? (providerReady(providers, id) ? 0 : 1) : 2;
    return [...new Set(models.map(model => model.provider))].sort((a, b) => (tier(a) - tier(b)) || (providerRank(a) - providerRank(b)));
  }, [models, providers]);
  const currentProvider = selected?.provider ?? providerIds[0];
  const providerModels = models.filter(model => model.provider === currentProvider);
  const needle = query.trim().toLowerCase();
  const matches = (...texts: string[]) => !needle || texts.some(text => text.toLowerCase().includes(needle));
  const close = () => { setOpen(null); setQuery(''); };
  const openChange = (which: 'model' | 'provider') => (next: boolean) => { setOpen(next ? which : null); if (!next) setQuery(''); };
  const providerName = (id: string) => providerDisplayName(id, providers);
  const search = (placeholder: string, label: string) => <label className="om-field om-picker-search">
    <RemixIcon name="search-line" size={14} />
    <SearchInput {...(boxed ? { appearance: 'embedded' as const } : {})} type="search" value={query}
      onChange={event => setQuery(event.target.value)} placeholder={placeholder} aria-label={label} />
  </label>;
  const footer = onManageProviders && <footer className="om-picker-footer">
    <Button variant="plain" className="om-nav-item" onClick={() => { close(); onManageProviders(); }}>
      <RemixIcon name="settings-3-line" size={15} /><span>{t('Manage providers & API keys')}</span>
    </Button>
  </footer>;
  const trigger = (label: string, content: ReactNode) => {
    const props = { className: 'om-picker-trigger', disabled, 'aria-label': label };
    return boxed ? <FieldTrigger {...props}>{content}<SelectArrow /></FieldTrigger>
      : <Button variant="plain" {...props}>{content}<RemixIcon name="arrow-down-s-line" size={15} /></Button>;
  };

  /** Switching provider keeps the same model when the new provider serves it. */
  const chooseProvider = (providerId: string) => {
    const candidates = models.filter(model => model.provider === providerId);
    const same = selected && candidates.find(model => modelFamilyKey(model) === modelFamilyKey(selected));
    const next = same ?? candidates[0];
    if (next && next.id !== selected?.id) onChoose(next.id);
  };
  const visibleProviders = providerIds.filter(id => matches(providerName(id), id));
  const currentReady = Boolean(currentProvider && providerReady(providers, currentProvider));
  const providerPicker = currentProvider && <Popover side="bottom" align="start" open={open === 'provider'} onOpenChange={openChange('provider')}
    aria-label={t('Provider')} tooltip={providerName(currentProvider)} className={popupClass} renderPanel={menuPanel}
    trigger={trigger(t('Provider'), <>
      <ProviderAvatar name={providerName(currentProvider)} provider={{ id: currentProvider, custom: selected?.source === 'custom' }} />
      <span className="om-picker-trigger-label" data-placeholder={!currentReady || undefined}>{providerName(currentProvider)}</span>
    </>)}>
    {providerIds.length > 5 && search(t('Filter providers…'), t('Filter providers'))}
    <div className="om-picker-list" role="listbox" aria-label={t('Provider')}>
      {visibleProviders.length === 0 && <p className="om-muted om-picker-empty">{t('No matching providers')}</p>}
      {visibleProviders.map(id => {
        const ready = providerReady(providers, id), chosen = id === currentProvider;
        return <div key={id} className="om-picker-provider-row" data-ready={ready || undefined}>
          <Button variant="plain" role="option" aria-selected={chosen} disabled={!ready} className="om-nav-item om-picker-option"
            onClick={() => { close(); chooseProvider(id); }}>
            <ProviderAvatar name={providerName(id)} provider={{ id, custom: models.some(model => model.provider === id && model.source === 'custom') }} />
            <span className="om-picker-option-copy">
              <strong>{providerName(id)}</strong>
              {!ready && <small>{t(id === 'account' ? 'Sign-in required' : 'API key required')}</small>}
            </span>
            {chosen && <RemixIcon name="check-line" size={15} />}
          </Button>
          {!ready && onConfigureProvider && <Button variant="plain" className="om-picker-setup" onClick={() => { close(); onConfigureProvider(id); }}>
            {t(id === 'account' ? 'Sign in' : 'Setup')}
          </Button>}
        </div>;
      })}
    </div>
    {footer}
  </Popover>;

  const label = (model: Model) => modelFamilyLabel(model);
  const visibleModels = providerModels.filter(model => matches(label(model), model.modelId));
  const modelPicker = <Popover side="bottom" align="start" open={open === 'model'} onOpenChange={openChange('model')}
    aria-label={t('Generation model')} tooltip={selected ? label(selected) : undefined} className={popupClass} renderPanel={menuPanel}
    trigger={trigger(t('Generation model'), selected ? <>
      <ModelAvatar name={label(selected)} modelId={selected.modelId} provider={{ id: selected.provider, custom: selected.source === 'custom' }} />
      <span className="om-picker-trigger-label">{label(selected)}</span>
    </> : <span className="om-picker-trigger-label" data-placeholder>{t('Choose model')}</span>)}>
    {providerModels.length > 6 && search(t('Search models…'), t('Search models'))}
    <div className="om-picker-list" role="listbox" aria-label={t('Generation model')}>
      {visibleModels.length === 0 && <p className="om-muted om-picker-empty">{t('No matching models')}</p>}
      {visibleModels.map(model => {
        const chosen = model.id === selected?.id, badge = imageModelBadge(model);
        return <Button key={model.id} variant="plain" role="option" aria-selected={chosen} className="om-nav-item om-picker-option" data-ready={currentReady || undefined}
          onClick={() => { close(); if (!chosen) onChoose(model.id); }}>
          <ModelAvatar name={label(model)} modelId={model.modelId} provider={{ id: model.provider, custom: model.source === 'custom' }} />
          <span className="om-picker-option-copy"><strong>{label(model)}</strong></span>
          {badge && <span className="om-image-menu-badge" data-tone={badge === 'New' ? 'new' : 'top'}>{t(badge)}</span>}
          {chosen && <RemixIcon name="check-line" size={15} />}
        </Button>;
      })}
    </div>
  </Popover>;

  return <div className="om-generation-pickers" data-paired>
    <div className="om-generation-picker">{providerHeading ?? <span className="om-eyebrow">{t('Provider')}</span>}{providerPicker}</div>
    <div className="om-generation-picker">{modelHeading}{modelPicker}</div>
  </div>;
}
