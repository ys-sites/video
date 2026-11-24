import { Button } from 'open-design-ui/button';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { assetKinds, type AssetKind, type useAssetBrowser } from './AssetBrowser';

/**
 * Library toolbar: asset kinds plus, when enabled, the Games category (games made in Game Studio, merged into Assets only).
 * While Games is selected, the asset source and sort options do not apply and are hidden; search filters game titles.
 */
export function AssetGalleryToolbar({ browser, onKindChange, games = false, onGames }: {
  browser: ReturnType<typeof useAssetBrowser>;
  onKindChange: (kind: AssetKind) => void;
  /** The Games category (games made in Game Studio) is shown when onGames is provided. */
  games?: boolean;
  onGames?: () => void;
}) {
  const { t } = useI18n();
  const { kind, query, setQuery, source, setSource, sort, setSort } = browser;
  const sources = [{ value: 'all', label: t('All sources') }, { value: 'generated', label: t('AI generated') }, { value: 'upload', label: t('Local upload') }];
  const sorts = [{ value: 'newest', label: t('Newest') }, { value: 'oldest', label: t('Oldest first') }, { value: 'name', label: t('Name') }];
  return <div className="om-asset-gallery-toolbar">
    <div className="om-asset-gallery-browse">
      <nav className="om-asset-tabs" aria-label={t('Asset types')}>
        {assetKinds.map(item => <Button variant="plain" key={item.id} className="om-nav-item" aria-current={kind === item.id && !games ? 'page' : undefined} onClick={() => onKindChange(item.id)}>{t(item.id === 'all' ? 'All' : item.label)}</Button>)}
        {onGames && <Button variant="plain" className="om-nav-item" aria-current={games ? 'page' : undefined} onClick={onGames}>{t('Games')}</Button>}
      </nav>
      {!games && <><span className="om-divider om-asset-toolbar-divider" aria-hidden="true" />
      <div className="om-asset-gallery-options">
        <Menu modal={false} aria-label={t('Source')} trigger={<Button variant="plain" className="om-nav-item" data-compact aria-label={t('Source')}>{sources.find(item => item.value === source)?.label}<RemixIcon name="arrow-down-s-line" size={14} /></Button>}>
          <MenuRadioGroup value={source} onValueChange={value => setSource(String(value))}>{sources.map(item => <MenuRadioItem key={item.value} value={item.value} closeOnClick>{item.label}</MenuRadioItem>)}</MenuRadioGroup>
        </Menu>
        <Menu modal={false} aria-label={t('Sort')} trigger={<Button variant="plain" className="om-nav-item" data-compact aria-label={t('Sort')}>{sorts.find(item => item.value === sort)?.label}<RemixIcon name="arrow-down-s-line" size={14} /></Button>}>
          <MenuRadioGroup value={sort} onValueChange={value => setSort(String(value))}>{sorts.map(item => <MenuRadioItem key={item.value} value={item.value} closeOnClick>{item.label}</MenuRadioItem>)}</MenuRadioGroup>
        </Menu>
      </div></>}
    </div>
    <div className="om-asset-gallery-tools">
      <label className="om-field om-asset-search"><RemixIcon name="search-line" size={16} /><input type="search" aria-label={t(games ? 'Search games' : 'Search library assets')} placeholder={t(games ? 'Search games' : 'Search library assets')} value={query} onChange={event => setQuery(event.target.value)} maxLength={200} /></label>
      <Tooltip label={t('Trash')}><IconButton size="lg" variant={kind === 'trash' && !games ? 'secondary' : 'ghost'} aria-label={t('Trash')} aria-pressed={kind === 'trash' && !games} icon={<RemixIcon name="delete-bin-line" size={16} />} onClick={() => onKindChange('trash')} /></Tooltip>
    </div>
    {(query || (source !== 'all' && !games)) && <div className="om-asset-gallery-clear"><Button variant="plain" className="om-nav-item" onClick={() => { setQuery(''); setSource('all'); }}>{t('Clear filters')}</Button></div>}
  </div>;
}
