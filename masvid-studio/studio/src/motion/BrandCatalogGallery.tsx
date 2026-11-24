import { Button } from 'open-design-ui/button';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { GalleryIntro } from './GalleryIntro';
import { templateContributionUrl } from './templateContribution';
import { Skeleton } from '../components/ui/Skeleton';
import { brandCatalogFile, type BrandCatalog, type BrandCatalogEntry } from '../../../shared/brand-catalog';
import type { GalleryTemplate } from '../../../shared/catalog';
import { brandKitShowcase, brandRequest } from './brandKitClient';
import { TemplateGalleryCard } from './TemplateGalleryCard';
import { useTemplatePlayback } from './useTemplatePlayback';
import { GalleryFilterPopover, GallerySortMenu, matchesGalleryFilters, matchesGallerySearch, toggleGalleryFilter, type GalleryFilters } from './GalleryFilters';

const sortOptions = [['catalog', 'Collection order'], ['name', 'Name A–Z'], ['reverse', 'Name Z–A']] as const;
const PAGE_SIZE = 48;
const entryValues = (entry: BrandCatalogEntry, key: string) => key === 'category' ? [entry.category] : key === 'appearance' ? [entry.appearance] : entry.colors;
const card = (entry: BrandCatalogEntry): GalleryTemplate => {
  const { duration, width, height } = brandKitShowcase;
  return { id: entry.id, title: entry.name, author: entry.name, brand: entry.name, sourceUrl: entry.websiteUrl || entry.sourceUrl, brandLogoUrl: brandCatalogFile(entry.id, 'favicon'), posterUrl: brandCatalogFile(entry.id, 'style-cover.svg'), width, height, duration, subtitle: entry.category, description: entry.description, collection: "reference", kind: "reference", tags: entry.tags };
};

export const BrandCatalogGallery = memo(function BrandCatalogGallery({ onImport, onCreate, busy, previewsEnabled, scrollRoot, query, onQueryChange }: { onImport: (id: string, visible: string[], trigger?: HTMLElement) => Promise<void>; onCreate: () => void; busy: boolean; previewsEnabled: boolean; scrollRoot: RefObject<HTMLElement | null>; query: string; onQueryChange: (value: string) => void }) {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<BrandCatalog>(), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  const [filters, setFilters] = useState<GalleryFilters>({}), [draft, setDraft] = useState<GalleryFilters>({});
  const [open, setOpen] = useState(false), [tab, setTab] = useState('category'), [facetQuery, setFacetQuery] = useState(''), [sort, setSort] = useState('catalog');
  const [priority, setPriority] = useState<string | null>(null);
  const [renderLimit, setRenderLimit] = useState(PAGE_SIZE);
  const loadMore = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    setError(false);
    void brandRequest<BrandCatalog>('/catalog').then(result => { if (!disposed) setCatalog(result); }, () => { if (!disposed) setError(true); });
    return () => { disposed = true; };
  }, [revision]);
  const entries = catalog?.entries || [];
  const cards = useMemo(() => new Map(entries.map(entry => [entry.id, card(entry)])), [entries]);
  const groups = useMemo(() => [
    { key: 'category', label: 'Categories', values: [...new Set(entries.map(entry => entry.category))].sort() },
    { key: 'appearance', label: 'Appearance', values: ['Light', 'Dark'] },
    { key: 'colors', label: 'Colors', values: [...new Set(entries.flatMap(entry => entry.colors))].sort() },
  ], [catalog]);
  const searchable = useMemo(() => entries.filter(entry => matchesGallerySearch(query, [entry.name, entry.description, entry.category, t(entry.category), t(entry.appearance), ...entry.tags, ...entry.colors.map(color => t(color))].join(' '))), [entries, query, t]);
  const visible = useMemo(() => searchable.filter(entry => matchesGalleryFilters(filters, key => entryValues(entry, key))).sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'reverse' ? b.name.localeCompare(a.name) : 0), [searchable, filters, sort]);
  const visibleIds = useMemo(() => visible.map(entry => entry.id), [visible]);
  const draftCount = useMemo(() => searchable.filter(entry => matchesGalleryFilters(draft, key => entryValues(entry, key))).length, [searchable, draft]);
  const hasFilters = Object.values(filters).some(values => values?.length), hasDraft = Object.values(draft).some(values => values?.length);
  const rendered = visible.slice(0, renderLimit);
  const playback = useTemplatePlayback(scrollRoot, visibleIds.slice(0, renderLimit).join('|'), previewsEnabled, true, priority, true);
  useEffect(() => { setRenderLimit(PAGE_SIZE); }, [catalog, query, filters, sort]);
  useEffect(() => {
    const node = loadMore.current;
    if (!node || renderLimit >= visible.length) return;
    if (typeof IntersectionObserver === 'undefined') { setRenderLimit(visible.length); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setRenderLimit(current => Math.min(current + PAGE_SIZE, visible.length));
    }, { root: scrollRoot.current, rootMargin: '720px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [renderLimit, visible.length, scrollRoot]);
  const lastRandom = useRef<string | null>(null);
  const openEntry = useCallback((id: string, trigger?: HTMLElement) => { if (!busy) void onImport(id, visibleIds, trigger).catch(() => {}); }, [busy, onImport, visibleIds]);
  const selectCard = useCallback((template: GalleryTemplate, trigger: HTMLButtonElement) => openEntry(template.id, trigger), [openEntry]);
  const setCardPriority = useCallback((id: string | null) => setPriority(id), []);
  const surprise = () => {
    const pool = visible.length > 1 ? visible.filter(entry => entry.id !== lastRandom.current) : visible;
    const entry = pool[Math.floor(Math.random() * pool.length)];
    if (entry) { lastRandom.current = entry.id; openEntry(entry.id); }
  };
  const reset = () => { setFilters({}); onQueryChange(''); };
  return <>
    <div className="om-gallery-toolbar">
      <div className="om-gallery-categories" role="group" aria-label={t('Categories')}><Button variant="plain" aria-pressed={!filters.category?.length} onClick={() => setFilters(previous => ({ ...previous, category: [] }))}>{t('All')}</Button>{groups[0].values.map(category => <Button variant="plain" key={category} aria-pressed={filters.category?.includes(category) || false} onClick={() => setFilters(previous => ({ ...previous, category: [category] }))}>{t(category)}</Button>)}</div>
      <div className="om-gallery-controls"><GalleryFilterPopover groups={groups} open={open} onOpenChange={next => { if (next) { setDraft(filters); setFacetQuery(''); } setOpen(next); }} draft={draft} onChange={setDraft} tab={tab} onTabChange={setTab} query={facetQuery} onQueryChange={setFacetQuery} active={hasFilters} countLabel={t('{count} brand kits', { count: draftCount })} hasDraft={hasDraft} onClear={() => setDraft({})} onApply={() => { setFilters(draft); setOpen(false); }} /><GallerySortMenu value={sort} options={sortOptions} onChange={setSort} /></div>
    </div>
    {(hasFilters || query) && <div className="om-gallery-chips">{query && <Button variant="plain" onClick={() => onQueryChange('')} aria-label={t('Remove filter {value}', { value: query })}>{query}<RemixIcon name="close-line" size={14} /></Button>}{Object.entries(filters).flatMap(([key, values]) => values?.map(value => <Button variant="plain" key={key + value} onClick={() => setFilters(previous => toggleGalleryFilter(previous, key, value))} aria-label={t('Remove filter {value}', { value: t(value) })}>{t(value)}<RemixIcon name="close-line" size={14} /></Button>))}<Button variant="plain" onClick={reset}>{t('Clear filters')}</Button></div>}
    <div className="om-gallery-results">
      <div className="om-gallery-masonry" aria-busy={busy || (!catalog && !error)} aria-label={!catalog && !error ? t('Loading Brand Kits') : undefined}>
        <GalleryIntro eyebrow={t('Official collection')} title={t('Find your next brand.')} count={t('{count} brand kits', { count: visible.length })} disabled={busy || !visible.length} onSurprise={surprise} submitLabel={t('Submit Brand Kit')} submitUrl={templateContributionUrl} createAction={{ label: t('New Brand Kit'), onClick: onCreate }} />
        {!catalog && !error && Array.from({ length: 12 }, (_, key) => <div key={key} className="om-gallery-skeleton" aria-hidden="true"><Skeleton className="om-brand-loading" /></div>)}
        {catalog && rendered.map(entry => <TemplateGalleryCard key={entry.id} template={cards.get(entry.id)!} resourceKind="brand-kit" coverUrl={brandCatalogFile(entry.id, 'cover')} animatedPreview={brandCatalogFile(entry.id, 'showcase')} active={priority === entry.id && playback.has(entry.id)} onPriority={setCardPriority} onSelect={selectCard} />)}
      </div>
      {catalog && rendered.length < visible.length && <div ref={loadMore} className="om-gallery-load-more" aria-hidden="true" />}
      {error && <div className="om-empty" role="alert"><h2 className="om-subtitle">{t('Could not load the official collection')}</h2><Button variant="ghost" className="om-button h-auto" onClick={() => setRevision(value => value + 1)}>{t('Retry')}</Button></div>}
      {catalog && !error && !visible.length && <div className="om-empty"><p className="om-muted">{t('No matching brand kits')}</p><Button variant="ghost" className="om-button h-auto" onClick={reset}>{t('Clear filters')}</Button></div>}
    </div>
  </>;
});
