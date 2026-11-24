import { Button } from 'open-design-ui/button';
import { useEffect, useState, type ReactNode } from 'react';
import type { LibraryAsset } from '../../../shared/asset-library';
import type { Modality } from '../../../shared/gateway';
import { creativeStudios, exploreCommunities, studioScenes, type CreativeStudio, type ExploreCommunity } from '../../../shared/studio-catalog';
import { useI18n } from '../i18n/I18n';
import { Popover } from '../components/ui/Popover';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { escapeRegex } from '../utils/regex';
import { assetRequest } from './assetClient';
import { creationKinds } from './AssetCreationVisuals';
import { mediaLabels, modelDestination, sceneDestination, studioIconTone, supportsScene, type StudioDestination } from './creativeStudios';
import { motionSkills } from './skillCatalog';
import { ModelAvatar } from './settingsPrimitives';
import { useMediaCatalog } from './useMediaCatalog';

type Result = { id: string; label: string; detail?: string; modality?: Modality; icon: ReactNode; open: () => void };

function searchIcon(name: string, tone: Modality | 'agent') {
  return <span className="om-creation-icon" data-tone={tone} aria-hidden="true"><RemixIcon name={name} size={16} /></span>;
}

function highlight(text: string, pattern: RegExp | null) {
  return pattern ? text.split(pattern).map((part, index) =>
    index % 2 ? <mark className="om-match-highlight" key={index}>{part}</mark> : part) : text;
}

const assetPageSize = 24;
function useAssetMatches(query: string, offset: number) {
  const [result, setResult] = useState<{ query: string; offset: number; assets?: LibraryAsset[]; nextOffset?: number | null }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!query) return;
    let current = true;
    const timer = window.setTimeout(async () => {
      try {
        const page = await assetRequest<{ assets: LibraryAsset[]; nextOffset: number | null }>({ action: 'list', query, offset, limit: assetPageSize });
        if (current) setResult({ query, offset, ...page });
      } catch { if (current) setResult({ query, offset }); }
    }, 180);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query, offset, attempt]);
  return { result: result?.query === query && result.offset === offset ? result : undefined, retry: () => { setResult(undefined); setAttempt(value => value + 1); } };
}

export function WorkspaceSearch({ onSkill, onScene, onStudio, onAsset, onCommunity, destination, onLibrary, onAccount, onChoose }: {
  onChoose?: () => void;
  onSkill: (id: string) => void; onScene: (scene: StudioDestination) => void; onStudio: (studio: CreativeStudio) => void;
  onAsset: (id: string, version: string) => void; onCommunity: (community: ExploreCommunity) => void;
  destination: StudioDestination | null; onLibrary: () => void; onAccount: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false), [input, setInput] = useState('');
  const [offset, setOffset] = useState(0);
  const query = open ? input.trim().toLocaleLowerCase() : '';
  const catalog = useMediaCatalog(Boolean(query)), assets = useAssetMatches(query, offset);
  const terms = query.split(/\s+/).filter(Boolean);
  const pattern = query ? new RegExp('(' + [...terms].sort((a, b) => b.length - a.length).map(escapeRegex).join('|') + ')', 'iu') : null;
  const matches = (...fields: string[]) => terms.every(term => fields.join(' ').toLocaleLowerCase().includes(term));
  const providers = new Map(catalog.catalog?.status.providers.map(provider => [provider.id, provider.label]));
  const groups: [string, Result[]][] = [
    ['Studios', creativeStudios.filter(studio => matches(studio.title, t(studio.title))).map(studio =>
      ({ id: studio.id, label: t(studio.title), icon: searchIcon(studio.icon, studioIconTone(studio)), open: () => onStudio(studio) }))],
    ['Scenes', studioScenes.filter(scene => query && matches(scene.id, t(scene.label), t(scene.hint), t(mediaLabels[scene.modality]))).map(scene =>
      ({ id: scene.id, label: t(scene.label), detail: t(mediaLabels[scene.modality]), icon: searchIcon(scene.icon, scene.modality), open: () => onScene(sceneDestination(scene, destination)) }))],
    ['Skills', motionSkills.filter(skill => query && matches(skill.name, t(skill.title), t(skill.tagline), t(skill.category))).map(skill =>
      ({ id: skill.id, label: t(skill.title), detail: t(skill.category), icon: searchIcon('puzzle-line', 'agent'), open: () => onSkill(skill.id) }))],
    ['Communities', exploreCommunities.filter(feed => matches(feed.id, t(feed.label))).map(feed =>
      ({ id: feed.id, label: t(feed.label), icon: searchIcon('apps-2-line', 'video'), open: () => onCommunity(feed) }))],
    ['Models', (catalog.catalog?.models ?? []).filter(model => query && matches(model.id, model.label, providers.get(model.provider) ?? model.provider, t(mediaLabels[model.modality])) && studioScenes.some(scene => supportsScene(model, scene))).map(model =>
      ({ id: model.id, label: model.label, detail: providers.get(model.provider) ?? model.provider, modality: model.modality,
        icon: <ModelAvatar name={model.label} modelId={model.modelId} provider={{ id: model.provider, custom: false }} />, open: () => onScene(modelDestination(model, destination)) }))],
    ['Workspace assets', (assets.result?.assets ?? []).map(asset =>
      ({ id: asset.id, label: asset.name, detail: t(mediaLabels[asset.modality]), icon: searchIcon(creationKinds.find(kind => kind.id === asset.modality)!.icon, asset.modality), open: () => onAsset(asset.id, asset.currentVersionId) }))],
  ];
  const choose = (action: () => void) => { setOpen(false); onChoose?.(); action(); };
  const loading = query && ((!catalog.catalog && !catalog.failed) || !assets.result);
  return <Popover tooltip={onChoose ? undefined : t('Search workspace')} modal={false} open={open} onOpenChange={setOpen} align="end" aria-label={t('Search workspace')} className="om-selection-panel om-workspace-search"
    trigger={<Button variant="plain" className={onChoose ? 'om-nav-item om-workspace-search-trigger' : 'om-nav-item om-workspace-search-trigger om-header-icon'} aria-label={t('Search workspace')}><RemixIcon name="search-line" size={17} />{onChoose && t('Search workspace')}</Button>}>
    {open && <>
      <label className="om-field"><RemixIcon name="search-line" size={16} /><input autoFocus type="search" maxLength={180} value={input} onChange={event => { setInput(event.target.value); setOffset(0); }} placeholder={t('Search workspace')} aria-label={t('Search workspace')} /></label>
      <div className="om-search-shortcuts"><Button variant="plain" className="om-nav-item" onClick={() => choose(onLibrary)}>{searchIcon('folder-open-line', 'audio')}{t('Workspace assets')}</Button><Button variant="plain" className="om-nav-item" onClick={() => choose(onAccount)}>{searchIcon('user-3-line', 'agent')}{t('Account')}</Button></div>
      <div className="om-search-results">{groups.map(([title, rows]) => rows.length > 0 && <section key={title} aria-label={t(title)}><h2 className="om-eyebrow">{t(title)}</h2>
        {rows.map(row => <Button variant="plain" className="om-nav-item" key={row.id} aria-label={[row.label, row.detail, row.modality && t(mediaLabels[row.modality])].filter(Boolean).join(', ')} onClick={() => choose(row.open)}>
          {row.icon}
          <span className="om-search-result-copy"><strong>{highlight(row.label, pattern)}</strong>{row.detail && <small className="om-muted">{highlight(row.detail, pattern)}</small>}</span>
          {row.modality && <span className="om-badge" data-tone={row.modality}>{t(mediaLabels[row.modality])}</span>}
        </Button>)}
      </section>)}
        {loading && <Skeleton className="om-creative-model-skeleton" />}
        {query && catalog.failed && <Button type="button" variant="ghost" className="om-button" onClick={catalog.retry}>{t('Retry loading models')}</Button>}
        {query && assets.result && !assets.result.assets && <Button type="button" variant="ghost" className="om-button" onClick={assets.retry}>{t('Retry loading assets')}</Button>}
        {query && (offset > 0 || assets.result?.nextOffset != null) && <div className="om-asset-pagination">
          <Button variant="ghost" className="om-button h-auto" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - assetPageSize))}>{t('Previous')}</Button>
          <span className="om-muted">{Math.floor(offset / assetPageSize) + 1}</span>
          <Button variant="ghost" className="om-button h-auto" disabled={assets.result?.nextOffset == null} onClick={() => { if (assets.result?.nextOffset != null) setOffset(assets.result.nextOffset); }}>{t('Next')}</Button>
        </div>}
        {query && !loading && !catalog.failed && assets.result?.assets && groups.every(([, rows]) => rows.length === 0) && <p className="om-muted">{t('No matches')}</p>}
      </div>
    </>}
  </Popover>;
}
