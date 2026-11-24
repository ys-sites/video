import { IconButton } from 'open-design-ui/icon-button';
import { CategoryStrip } from './CategoryStrip';
import { TemplateIndustryMenu } from './TemplateIndustryMenu';
import { collectionFacet, formatCategories, type TemplateCollection } from './templateCollections';
import { loadCoveredTemplates } from './useCoveredTemplates';
import { Button } from 'open-design-ui/button';
import { blackFridayReference, blackFridayTemplates } from '../../../shared/black-friday-collection';
import { BlackFridayCollection, type BlackFridayFilter } from './BlackFridayCollection';
import { TemplateCreators } from './TemplateCreators';
import { templateCredit } from './templateCredits';
import { GalleryIntro } from './GalleryIntro';
import { BrandLogo } from "../../../packages/design-system/react/BrandLogo";
import { GithubLogo } from '@phosphor-icons/react';
import { templateRepositoryUrl } from './githubRepository';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { BrandSeriesCard, BrandStoriesDialog } from './BrandStories';
import { discoveryInsertions, groupBrandSeries, type BrandSeries } from './brandStoryData';
import { seriesId, seriesContext, reportSeriesCard, openSeriesView, type SeriesView } from './brandStoryTracking';
import storyStyles from './BrandStories.module.css';
import { isEditableTemplate, matchesTemplateCategory, type GalleryTemplate, type TemplatePage } from '../../../shared/catalog';
import { templatePrompt, type IntegrationInfo } from '../../../shared/integration';
import { useI18n } from '../i18n/I18n';
import { motionApi } from './useWorkspace';
import { MotionIcon } from './icons';
import { GalleryFilterPopover, GallerySortMenu, matchesGalleryFilters } from './GalleryFilters';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { Popover } from '../components/ui/Popover';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { orderedPurposes } from './templateDiscoveryTaxonomy';
import { templateContributionUrl, templateSubmissionPrompt } from './templateContribution';
import styles from './TemplateLibraryDialog.module.css';
import { TemplateMotionGuide } from './TemplateMotionGuide';
import { RelatedTemplatePreviews } from './RelatedTemplatePreviews';
import { facetValues as values, templateFacets as facets, templateAspect, templateRatio, relatedTemplates, relatedTemplatesByTags, randomTemplate, type Facet } from './templateDiscovery';
import { TemplateGalleryCard as TemplateCard, TopBrandsLabel, TemplatePoster, TemplateIdentity as Identity } from './TemplateGalleryCard';
import { useTemplatePlayback } from './useTemplatePlayback';
import { useTemplateImpressions } from './useTemplateImpressions';
import { matchesTemplateSearch, normalizedTemplateQuery } from './templateSearch';
import { TemplateReferenceDialog, TemplateSearchRecovery } from './TemplateSearchRecovery';
import { useTemplateSearchContext } from './useTemplateSearchContext';
import * as tracking from './templateLibraryTracking';
import type { DetailView, FilterAction, FilterGroup, Placement, Sort } from './templateLibraryTracking';
import { TemplateHandoffSteps, TemplateOpenRecovery, type TemplateOpenProgress } from './TemplateHandoffInfo';
import { TemplateDetailReview, TemplateProductionNotes, TemplateGuideReview, TemplateReviewSpecs } from './TemplateDetailReview';
import { templateHandoffEnabled, templateHandoffPrompt, preparedTemplateProjects, pendingTemplateProjects, rememberTemplateRequest, forgetTemplateRequest, TemplatePreparationBlockedError, findPreparedTemplate, type PreparedTemplateProject } from './templateHandoff';

type Filters = Partial<Record<Facet, string[]>>;
type CampaignSearch = { query: string; filter: BlackFridayFilter };
const emptyCampaignSearch: CampaignSearch = { query: '', filter: null };
const toggleValue = (filters: Filters, key: Facet, value: string): Filters => ({ ...filters, [key]: filters[key]?.includes(value) ? filters[key]!.filter(item => item !== value) : [...(filters[key] ?? []), value] });
const matchesFilters = (item: GalleryTemplate, filters: Filters, editable: boolean) => (!editable || isEditableTemplate(item)) && matchesGalleryFilters(filters, key => values(item, key as Facet));

function MetadataTag({ label, onClick }: { label: string; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [overflow, setOverflow] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    document.fonts?.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [label]);
  return <Tooltip withinDialog label={label} disabled={!overflow} wrap><Button variant="plain" ref={ref} onClick={onClick}>{label}</Button></Tooltip>;
}

function DetailMedia({ template }: { template: GalleryTemplate }) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false), [waiting, setWaiting] = useState(true), [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  return <div className={styles.stageMedia} style={{ aspectRatio: templateAspect(template), width: `min(100%, calc(var(--stage-media-height) * ${templateAspect(template)}))` }} aria-busy={Boolean(template.previewUrl && waiting && !failed)}>
    <TemplatePoster template={template} eager />
    {template.previewUrl && !failed && <video key={attempt} src={template.previewUrl} controls autoPlay muted playsInline loop preload="metadata"
      style={{ opacity: ready ? 1 : 0 }} onLoadedData={() => { setReady(true); setWaiting(false); }} onPlaying={() => setWaiting(false)} onCanPlay={() => setWaiting(false)} onWaiting={() => setWaiting(true)} onStalled={() => setWaiting(true)} onPause={() => setWaiting(false)} onError={() => { setFailed(true); setWaiting(false); }} />}
    {template.previewUrl && waiting && !failed && <div className={styles.mediaLoading} role="status"><span>{t('Loading preview…')}</span><Skeleton className={styles.mediaProgress} /></div>}
    {failed && <div className={styles.mediaFailure} role="status"><span>{t('Preview unavailable. Try again.')}</span><Button variant="plain" onClick={() => { setReady(false); setWaiting(true); setFailed(false); retry(value => value + 1); }}>{t('Retry')}</Button></div>}
  </div>;
}


type Props = { detailOnly?: boolean; initialTemplate?: GalleryTemplate; collection?: TemplateCollection | null; onCollectionChange?: (value: TemplateCollection | null) => void; collectionSkillOpen?: boolean; onBrowseTemplates?: () => void; onOpenSkill?: (id: string, trigger: HTMLButtonElement) => void; onStartScenario?: () => void; inWorkspace?: boolean; returnFocus?: HTMLElement | null; open: boolean; busy: boolean; openingDisabled?: boolean; error: string; onClose: () => void; onOpen: (id: string) => void; creators?: boolean; creator?: string | null; onCreatorChange?: (creator: string | null) => void; templateId?: string | null; onTemplateChange?: (id: string | null) => void; projectId?: string; onPrepareTemplate?: (template: GalleryTemplate, requestId: string) => Promise<PreparedTemplateProject>; onOpenProject?: (id: string) => Promise<boolean> };

/** Full-window discovery using the existing catalog and guarded editable-project actions. */
function DetailScroll({ enabled, container, children }: { enabled: boolean; container: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  return enabled ? <div ref={container} className={styles.reviewScroll}>{children}</div> : <>{children}</>;
}

export function TemplateLibraryDialog(props: Props) {
  const { t, locale } = useI18n();
  const { detailOnly = false, initialTemplate } = props;
  const [storiesPreview] = useState(() => new URLSearchParams(location.search).get('brandStoriesPreview') === '1');
  const [discoverySeed] = useState(() => Math.floor(Math.random() * 4294967296));
  const [brandStory, setBrandStory] = useState<{ series: BrandSeries; view: SeriesView } | null>(null);
  const [compareWithout, setCompareWithout] = useState('');
  const brandTrigger = useRef<HTMLButtonElement | null>(null);
  const { toasts, showToast, dismissToast } = useToast();
  const dialog = useRef<HTMLDialogElement>(null), detail = useRef<HTMLDialogElement>(null);
  const libraryClose = useRef<HTMLButtonElement>(null);
  const detailInfo = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const instructionText = useRef<HTMLElement>(null), libraryShown = useRef(false);
  const [downloading, setDownloading] = useState(false);
  const [catalog, setCatalog] = useState<GalleryTemplate[]>([]);
  const [warning, setWarning] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const [attempt, retry] = useState(0), [libraryQuery, setLibraryQuery] = useState(''), [sort, setSort] = useState<Sort>('recommended');
  const [facetsSelected, setFacetsSelected] = useState<Filters>({});
  const preset = useMemo(() => collectionFacet(props.collection), [props.collection]);
  const selected = useMemo<Filters>(() => preset ? { ...facetsSelected, [preset.key]: [preset.value] } : facetsSelected, [preset, facetsSelected]);
  function setSelected(next: Filters) {
    if (preset && next[preset.key]?.length === 1 && next[preset.key]?.[0] === preset.value) {
      const { [preset.key]: _preset, ...otherFacets } = next;
      setFacetsSelected(otherFacets);
    } else {
      setFacetsSelected(next);
      if (preset) props.onCollectionChange?.(null);
    }
  }
  const [preview, setPreview] = useState<GalleryTemplate | null>(null), [prompt, setPrompt] = useState('');
  const [manualCopy, setManualCopy] = useState('');
  const [promptError, setPromptError] = useState(false), [promptAttempt, retryPrompt] = useState(0);
  const [priority, setPriority] = useState<string | null>(null), [filtersOpen, setFiltersOpen] = useState(false);
  const [editableFilter, setEditableFilter] = useState(false);
  const editableOnly = props.collection === 'builtin' || editableFilter;
  function setEditableOnly(next: boolean) {
    setEditableFilter(next && props.collection !== 'builtin');
    if (!next && props.collection === 'builtin') props.onCollectionChange?.(null);
  }
  const format = props.collection === 'ads' || props.collection === 'short-form' ? props.collection : null;
  const [draftFilters, setDraftFilters] = useState<Filters>({});
  const [draftEditable, setDraftEditable] = useState(false);
  const [filterTab, setFilterTab] = useState<Facet>('uses');
  const [facetQuery, setFacetQuery] = useState('');
  const [brandFilter, setBrandFilter] = useState(false);
  const brandsOnly = props.collection === 'top-100-brands' || brandFilter;
  function setBrandsOnly(next: boolean) {
    setBrandFilter(next && props.collection !== 'top-100-brands');
    if (!next && props.collection === 'top-100-brands') props.onCollectionChange?.(null);
  }
  const blackFriday = props.collection === 'black-friday';
  const [campaignSearch, setCampaignSearch] = useState(emptyCampaignSearch);
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState<BlackFridayFilter>(null);
  const campaignQuery = campaignSearch.query;
  const campaignSearching = Boolean(campaignQuery.trim());
  const activeCampaignFilter = campaignSearching ? campaignSearch.filter : selectedCampaignFilter;
  const query = blackFriday ? campaignQuery : libraryQuery;
  const setQuery = (next: string) => {
    if (blackFriday) setCampaignSearch(current => {
      if (!next.trim()) return { query: next, filter: null };
      return { query: next, filter: current.query.trim() ? current.filter : null };
    });
    else setLibraryQuery(next);
  };
  const selectCampaignFilter = (filter: BlackFridayFilter) => {
    if (campaignSearching) setCampaignSearch(current => ({ ...current, filter }));
    else setSelectedCampaignFilter(filter);
  };
  const campaignStages = useMemo(() => blackFridayTemplates(catalog, locale), [catalog, locale]);
  const campaignItems = useMemo(() => campaignStages.flatMap(stage =>
    activeCampaignFilter === null || stage.id === activeCampaignFilter ? stage.items : [])
    .filter(item => matchesTemplateSearch(item, campaignQuery, t)), [campaignStages, activeCampaignFilter, campaignQuery, t]);
  useEffect(() => {
    if (!blackFriday || !props.open) {
      setSelectedCampaignFilter(null);
      setCampaignSearch(emptyCampaignSearch);
    }
  }, [blackFriday, props.open]);
  const [promptExpanded, setPromptExpanded] = useState(false), [guideOpen, setGuideOpen] = useState(false);
  const handoffPreview = templateHandoffEnabled() && !brandStory;
  const reviewBody = useRef<HTMLDivElement>(null), reviewFooter = useRef<HTMLDivElement>(null), reviewScroll = useRef<HTMLDivElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (handoffPreview && preview && !guideOpen) detailTitle.current?.focus({ preventScroll: true });
  }, [handoffPreview, preview?.id, guideOpen]);
  useEffect(() => {
    if (!handoffPreview || !manualCopy || guideOpen) return;
    const field = instructionText.current?.querySelector('textarea');
    field?.focus({ preventScroll: true });
    field?.scrollIntoView({ block: 'center' });
  }, [handoffPreview, manualCopy, guideOpen]);
  useEffect(() => {
    const element = reviewFooter.current;
    if (!handoffPreview || !element || !detail.current) return;
    const measure = () => detail.current?.style.setProperty('--review-action-height', `${element.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, [handoffPreview, preview?.id, guideOpen]);
  const [projectProgress, setProjectProgress] = useState<Record<string, TemplateOpenProgress>>(() => Object.fromEntries([
    ...pendingTemplateProjects().filter(item => item.originalProjectId === props.projectId).map(item => [item.templateId, { requestId: item.requestId, state: 'unknown' as const }]),
    ...preparedTemplateProjects().filter(item => item.originalProjectId === props.projectId || item.projectId === props.projectId).map(result => [result.templateId, { requestId: result.requestId, state: 'ready' as const, result }]),
  ]));
  const progressRef = useRef(projectProgress); progressRef.current = projectProgress;
  const previewLatest = useRef(preview); previewLatest.current = preview;
  const openLatest = useRef(props.open); openLatest.current = props.open;
  const writeProgress = (id: string, progress: TemplateOpenProgress) => {
    progressRef.current = { ...progressRef.current, [id]: progress };
    setProjectProgress(progressRef.current);
  };
  async function revealProject(template: GalleryTemplate, result: PreparedTemplateProject, view = detailView.current) {
    const attemptId = tracking.newTrackingId();
    const progress = { requestId: result.requestId, result };
    writeProgress(template.id, { ...progress, state: 'opening' });
    const opened = await props.onOpenProject?.(result.projectId).catch(() => false);
    tracking.reportProjectResult(template, result.requestId, attemptId, 'open', opened ? 'success' : 'failure', view, result.projectId);
    writeProgress(template.id, opened ? { ...progress, state: 'ready' }
      : { ...progress, state: 'open_failed', error: t('The project is retained. Retry opening it without creating another copy.') });
  }
  async function prepareProject(template: GalleryTemplate) {
    if (!isEditableTemplate(template) || !props.onPrepareTemplate || props.openingDisabled || props.busy) return;
    const previous = progressRef.current[template.id];
    if (previous?.state === 'creating' || previous?.state === 'opening' || previous?.state === 'unknown') return;
    const requestId = previous?.requestId ?? crypto.randomUUID();
    tracking.reportUseClicked(template, 'open_edit', detailView.current, undefined, requestId);
    if (previous?.result) { void revealProject(template, previous.result); return; }
    const attemptId = tracking.newTrackingId(), view = detailView.current;
    rememberTemplateRequest({ templateId: template.id, originalProjectId: props.projectId, requestId });
    writeProgress(template.id, { requestId, state: 'creating' });
    try {
      const result = await props.onPrepareTemplate(template, requestId);
      tracking.reportProjectResult(template, requestId, attemptId, 'create', 'success', view, result.projectId);
      forgetTemplateRequest(requestId);
      writeProgress(template.id, { requestId, state: 'ready', result });
      if (openLatest.current && detail.current?.open && previewLatest.current?.id === template.id) void revealProject(template, result, view);
    } catch (error) {
      if (error instanceof TemplatePreparationBlockedError) {
        forgetTemplateRequest(requestId);
        tracking.reportProjectResult(template, requestId, attemptId, 'create', 'failure', view);
        writeProgress(template.id, { requestId, state: 'failed', error: error.message });
        return;
      }
      const result = await findPreparedTemplate(template, props.projectId, requestId).catch(() => null);
      if (result) forgetTemplateRequest(requestId);
      tracking.reportProjectResult(template, requestId, attemptId, 'create', result ? 'success' : 'unknown', view, result?.projectId);
      writeProgress(template.id, result ? { requestId, state: 'ready', result } : { requestId, state: 'unknown', error: t('The connection did not return a complete result. Check this request before creating again.') });
    }
  }
  async function checkProject(template: GalleryTemplate) {
    const progress = progressRef.current[template.id]; if (!progress) return;
    const view = detailView.current, attemptId = tracking.newTrackingId();
    tracking.reportDetailAction(template, 'check_template_project', view);
    let result: PreparedTemplateProject | null;
    try { result = await findPreparedTemplate(template, props.projectId, progress.requestId); }
    catch {
      tracking.reportProjectResult(template, progress.requestId, attemptId, 'reconcile', 'unknown', view);
      showToast(t('The connection did not return a complete result. Check this request before creating again.'), 'error');
      return;
    }
    tracking.reportProjectResult(template, progress.requestId, attemptId, 'reconcile', result ? 'success' : 'not_found', view, result?.projectId);
    if (result) {
      forgetTemplateRequest(progress.requestId);
      writeProgress(template.id, { requestId: progress.requestId, state: 'ready', result });
    } else {
      writeProgress(template.id, { requestId: progress.requestId, state: 'failed' });
      showToast(t('Project not created'), 'info');
    }
  }
  const lastRandom = useRef<string>(undefined);
  const info = useRef<IntegrationInfo | null>(null);
  const routeChange = useRef(props.onTemplateChange); routeChange.current = props.onTemplateChange;
  const closeDetail = () => {
    if (preview) tracking.reportDetailAction(preview, 'close_detail', detailView.current);
    routeChange.current?.(null);
    if (!detailOnly) detail.current?.close();
  };
  // Tracking state. Ids tie one detail view, one copy and one search to the events that follow from them.
  const detailView = useRef<DetailView | undefined>(undefined), searchId = useRef<string | undefined>(undefined), reportedQuery = useRef(''), shown = useRef(false);
  useEffect(() => { if (guideOpen && preview) tracking.reportGuideShown(preview, detailView.current); }, [guideOpen, preview?.id]);
  const pendingResult = useRef<FilterAction | undefined>(undefined), composing = useRef(false), shownCards = useRef(new Set<string>()), instructionShown = useRef<string | undefined>(undefined);
  const [settle, setSettle] = useState(0);
  const [settledKeyword, setSettledKeyword] = useState(''), [searchComposing, setSearchComposing] = useState(false);
  const [recoveryExpanded, setRecoveryExpanded] = useState(false), [catalogVersion, setCatalogVersion] = useState('');
  const [referenceTrigger, setReferenceTrigger] = useState<HTMLButtonElement | null>(null);
  const referenceShownFor = useRef<string | undefined>(undefined);
  const searchShortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
  useEffect(() => { if (props.open && props.error) showToast(props.error, 'error'); }, [props.open, props.error, showToast]);
  useEffect(() => { if (props.open && warning) showToast(warning, 'info'); }, [props.open, warning, showToast]);
  useEffect(() => {
    if (!props.open || !props.busy) return;
    const id = showToast('Preparing editable project…', 'info');
    return () => dismissToast(id);
  }, [props.open, props.busy, showToast, dismissToast]);
  useEffect(() => {
    if (!props.open) { libraryShown.current = false; setReferenceTrigger(null); return; }
    const openedDialog = dialog.current;
    const trigger = props.returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const openedDetail = detail.current;
    if (detailOnly) openedDetail?.showModal();
    else if (!props.inWorkspace) openedDialog?.showModal();
    if (openedDialog?.open && !libraryShown.current) { libraryShown.current = true; tracking.reportLibraryShown(currentSearchContext.current.read()); }
    if (openedDialog?.querySelector('[data-black-friday] h1') !== document.activeElement) libraryClose.current?.focus({ preventScroll: true });
    return () => {
      openedDetail?.close();
      if (!props.inWorkspace) openedDialog?.close();
      setPreview(null);
      setPriority(null); setFiltersOpen(false);
      if (trigger?.isConnected && (!props.inWorkspace || document.activeElement === document.body || openedDialog?.contains(document.activeElement))) trigger.focus({ preventScroll: true });
    };
  }, [props.open, props.returnFocus, props.inWorkspace, detailOnly]);
  useEffect(() => {
    if (!props.open) return;
    setCatalog([]); setBrandStory(null); setFacetsSelected({}); setBrandFilter(false); setCompareWithout(''); setLibraryQuery(''); setCampaignSearch(emptyCampaignSearch); setSettledKeyword(''); setRecoveryExpanded(false); setPreview(null);
    if (dialog.current) detail.current?.close();
    shown.current = false; searchId.current = undefined; reportedQuery.current = ''; pendingResult.current = undefined; shownCards.current.clear(); seriesLists.current.clear(); shownSeries.current.clear();
    const controller = new AbortController();
    let version: string | undefined, pending = false;
    async function load() {
      pending = true; setLoading(true); setError('');
      try {
        const result = await loadCoveredTemplates(locale, controller.signal);
        if (!controller.signal.aborted) {
          version = result.catalogVersion;
          setWarning(result.warning ?? ''); setCatalog(result.items); setCatalogVersion(version ?? ''); shown.current = true;
        }
      } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
      finally { pending = false; if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    const timer = setInterval(async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const page = await motionApi<TemplatePage>(`/template-catalog?limit=1&locale=${encodeURIComponent(locale)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setWarning(page.warning ?? '');
        if (page.catalogVersion !== version) await load();
      } catch {} finally { pending = false; }
    }, 5000);
    void motionApi<IntegrationInfo>('/integration', { signal: controller.signal }).then(value => { info.current = value; }).catch(() => {});
    return () => { controller.abort(); clearInterval(timer); };
  }, [props.open, attempt, locale]);
  const available = useMemo(() => facets.map(([key, label]) => ({ key, label, values: [...new Set(catalog.flatMap(item => values(item, key)))] })).filter(facet => facet.values.length), [catalog]);
  const missingTemplate = Boolean(props.templateId && shown.current && !loading && !error && !catalog.some(item => item.id === props.templateId) && !blackFridayReference(props.templateId, locale));
  const categories = orderedPurposes(available.find(facet => facet.key === 'uses')?.values ?? []);
  const industries = available.find(facet => facet.key === 'industries')?.values ?? [];
  const sortOptions = [['recommended', 'Recommended order'], ['name', 'Name A–Z'], ['reverse', 'Name Z–A'], ['duration', 'Duration']] as const;
  const hasFilters = Boolean(format || libraryQuery || editableOnly || brandsOnly || compareWithout || Object.values(selected).some(items => items?.length));
  const searchable = useMemo(() => catalog.filter(item => (props.creators || ((!format || matchesTemplateCategory(item, format)) && (!brandsOnly || Boolean(item.brand?.trim())) && (!compareWithout || item.brand !== compareWithout))) && matchesTemplateSearch(item, libraryQuery, t)), [catalog, libraryQuery, format, brandsOnly, compareWithout, props.creators, t]);
  const draftCount = useMemo(() => filtersOpen ? searchable.filter(item => matchesFilters(item, draftFilters, draftEditable)).length : 0, [filtersOpen, searchable, draftFilters, draftEditable]);
  const hasDraftFilters = draftEditable || Object.values(draftFilters).some(items => items?.length);
  const visible = useMemo(() => {
    if (props.creators) return props.creator ? searchable.filter(item => templateCredit(item)?.id === props.creator) : [];
    return searchable.filter(item => matchesFilters(item, selected, editableOnly)).sort((a, b) => sort === 'recommended' ? (a.sortOrder ?? Infinity) - (b.sortOrder ?? Infinity) : sort === 'duration' ? (a.duration ?? Infinity) - (b.duration ?? Infinity) : a.title.localeCompare(b.title, locale) * (sort === 'reverse' ? -1 : 1));
  }, [searchable, selected, sort, locale, editableOnly, props.creators, props.creator]);
  useEffect(() => { if (dialog.current) dialog.current.scrollTop = 0; }, [libraryQuery, selected, sort, editableOnly, brandsOnly, compareWithout, blackFriday]);
  const filterCount = Number(Boolean(format)) + Object.values(selected).flat().length + Number(editableOnly) + Number(brandsOnly) + Number(Boolean(compareWithout));
  const hasAppliedFilters = filterCount > 0;
  const campaignSelection = blackFriday ? activeCampaignFilter ?? 'all' : null;
  const galleryFilterCount = blackFriday ? Number(activeCampaignFilter !== null) : filterCount;
  const searchContextKey = JSON.stringify([campaignSelection, format, normalizedTemplateQuery(query), Object.entries(selected).filter(([, items]) => items?.length).map(([key, items]) => [key, [...items!].sort()]).sort(([a], [b]) => String(a).localeCompare(String(b))), editableOnly, brandsOnly, compareWithout, sort, catalogVersion]);
  const searchContext = useTemplateSearchContext(props.open && !detailOnly, !loading && shown.current && !error && !searchComposing, searchContextKey, Boolean(query.trim() || galleryFilterCount));
  const currentSearchContext = useRef(searchContext); currentSearchContext.current = searchContext;
  // A search id belongs to exactly one keyword: once the box holds something else, events stop carrying it.
  // The list state is read when a handler, timer or effect fires, not when it was scheduled.
  const galleryItems = blackFriday ? campaignItems : visible;
  const galleryContext = { items: galleryItems, query, sort, filterCount: galleryFilterCount, covered: Boolean(preview || brandStory), blackFriday };
  const latest = useRef(galleryContext); latest.current = galleryContext;
  const listContext = useCallback(() => {
    const { query, sort, filterCount } = latest.current, keyword = query.trim();
    return { searchId: keyword && normalizedTemplateQuery(keyword) === reportedQuery.current ? searchId.current : undefined, sort, filterCount, ...currentSearchContext.current.read() };
  }, []);
  // One search report per settled query: 500 ms after typing stops, or right before the user acts on the results,
  // and never mid-composition or before the catalogue has loaded. Each new keyword gets a new search id.
  const settleSearch = () => {
    const keyword = normalizedTemplateQuery(query);
    if (!keyword) { setSettledKeyword(''); return; }
    if (keyword === reportedQuery.current) { setSettledKeyword(keyword); return; }
    if (composing.current || loading || error || !shown.current) return;
    const id = tracking.newTrackingId(); reportedQuery.current = keyword; searchId.current = id; setSettledKeyword(keyword);
    currentSearchContext.current.activity();
    tracking.reportSearchResult(id, query, galleryItems.length, { sort, filterCount: galleryFilterCount, ...currentSearchContext.current.read() });
  };
  const settleLatest = useRef(settleSearch); settleLatest.current = settleSearch;
  useEffect(() => {
    if (!query.trim()) { reportedQuery.current = ''; searchId.current = undefined; setSettledKeyword(''); return; }
    const timer = setTimeout(() => settleLatest.current(), 500);
    return () => clearTimeout(timer);
  }, [query, settle, loading, catalog.length]);
  const confirmSearch = () => { if (composing.current || !query.trim()) return; settleSearch(); if (!blackFriday) dialog.current?.scrollTo?.({ top: 0 }); };
  const clearSearch = () => { settleSearch(); tracking.reportRecoveryAction('clear_search', listContext()); setQuery(''); };
  const searchRecoveryActivity = () => { settleSearch(); currentSearchContext.current.activity(); return listContext(); };
  const expandSearchRecovery = () => { searchRecoveryActivity(); setRecoveryExpanded(true); };
  const stableSearch = !searchComposing && (!query.trim() || normalizedTemplateQuery(query) === settledKeyword);
  const showRecovery = !loading && !error && stableSearch;
  const showEmptyRecovery = !loading && !error && !visible.length;
  const suggestedRemoval = useMemo(() => {
    if (!showEmptyRecovery || !stableSearch || !hasAppliedFilters || !catalog.length) return;
    const matches = catalog.filter(item => (!format || matchesTemplateCategory(item, format)) && (!compareWithout || item.brand !== compareWithout) && matchesTemplateSearch(item, libraryQuery, t));
    const count = (filters: Filters, editable: boolean, brands: boolean) => matches.filter(item =>
      (!brands || Boolean(item.brand?.trim())) && matchesFilters(item, filters, editable)).length;
    const options = facets.flatMap(([key]) => (selected[key] ?? []).map(value => ({
      key, value, label: key === 'brand' ? value : t(value),
      count: count({ ...selected, [key]: selected[key]!.filter(item => item !== value) }, editableOnly, brandsOnly),
    })));
    const special = [
      ...(editableOnly ? [{ key: 'editable' as const, value: '', label: t('Ready to edit'), count: count(selected, false, brandsOnly) }] : []),
      ...(brandsOnly ? [{ key: 'top' as const, value: '', label: t('TOP 100 brands'), count: count(selected, editableOnly, false) }] : []),
    ];
    return [...options, ...special].filter(option => option.count > 0).sort((a, b) => b.count - a.count)[0];
  }, [showEmptyRecovery, stableSearch, hasAppliedFilters, format, catalog, libraryQuery, t, selected, editableOnly, brandsOnly, compareWithout]);
  // A filter, category or sort result is reported after the changed list has rendered, with the count the user now sees.
  useEffect(() => {
    const action = pendingResult.current; pendingResult.current = undefined;
    if (action) tracking.reportFilterResult(action, latest.current.items.length, listContext());
  }, [selected, sort, libraryQuery, editableOnly, brandsOnly]);
  // One result set per search, filter and sort combination: a card is reported again only when that combination changes.
  // Empty groups are dropped and groups and values sorted, so the same choices always make the same key.
  const resultSet = JSON.stringify([campaignSelection, format, query.trim(), sort, editableOnly, brandsOnly, compareWithout, Object.entries(selected).filter(([, items]) => items?.length).map(([key, items]) => [key, [...items!].sort()]).sort(([a], [b]) => String(a).localeCompare(String(b)))]);
  const seriesLists = useRef(new Map<string, string>()), shownSeries = useRef(new Set<string>());
  if (!seriesLists.current.has(resultSet)) seriesLists.current.set(resultSet, tracking.newTrackingId());
  const seriesListId = seriesLists.current.get(resultSet)!;
  const resultSetLatest = useRef(resultSet); resultSetLatest.current = resultSet;
  const cardSeen = useCallback((id: string) => {
    const { items, covered } = latest.current;
    if (document.hidden || covered) return false;
    const key = `${resultSetLatest.current}|${id}`, index = items.findIndex(item => item.id === id);
    if (index < 0 || shownCards.current.has(key)) return true;
    shownCards.current.add(key);
    settleLatest.current();
    tracking.reportCardShown(items[index], index + 1, listContext(), latest.current.blackFriday ? 'black_friday' : 'catalog');
    return true;
  }, [listContext]);
  const referenceSeen = (context = listContext()) => {
    if (document.hidden || !context.resultSetId) return false;
    if (referenceShownFor.current !== context.resultSetId) {
      referenceShownFor.current = context.resultSetId;
      tracking.reportReferenceEntryShown(context);
    }
    return true;
  };
  const referenceVisible = props.open && !blackFriday && !loading && !error && !query.trim() && visible.length > 0 && !preview && !brandStory && !referenceTrigger;
  useTemplateImpressions(dialog, 'library_home', referenceVisible, searchContextKey, () => referenceSeen(), 'data-reference-entry');
  useTemplateImpressions(dialog, galleryItems.map(item => item.id).join(','), props.open && !preview && !brandStory, resultSet, cardSeen);
  const brandGroups = useMemo(() => groupBrandSeries(catalog), [catalog]);
  const visibleBrandGroups = useMemo(() => groupBrandSeries(visible), [visible]);
  const insertions = useMemo(() => discoveryInsertions(visible, brandGroups, storiesPreview && !hasFilters, discoverySeed), [visible, brandGroups, storiesPreview, hasFilters, discoverySeed]);
  const seriesCards = storiesPreview && brandsOnly
    ? visibleBrandGroups.map((series, index) => ({ series, placement: 'top100' as const, position: index + 1, rank: index + 1 }))
    : [...insertions].map(([index, series], rank) => ({ series, placement: 'discovery' as const, position: index + rank + 1, rank: rank + 1 }));
  const seriesCardsLatest = useRef(seriesCards); seriesCardsLatest.current = seriesCards;
  const seriesSeen = (id: string) => {
    if (document.hidden || latest.current.covered) return false;
    const row = seriesCardsLatest.current.find(row => seriesId(row.series.name) === id);
    if (!row) return true;
    const key = seriesListId + '|' + id;
    if (shownSeries.current.has(key)) return true;
    shownSeries.current.add(key); settleLatest.current();
    reportSeriesCard(seriesContext(row.series, row.placement, row.position, row.rank, seriesListId, listContext()));
    return true;
  };
  useTemplateImpressions(dialog, seriesCards.map(row => seriesId(row.series.name)).join(','), props.open && storiesPreview && !blackFriday && !preview && !brandStory, seriesListId, seriesSeen, 'data-series-id');
  const openBrand = (series: BrandSeries, element: HTMLButtonElement, placement: 'top100' | 'discovery') => {
    const row = seriesCards.find(row => row.series.name === series.name && row.placement === placement);
    if (!row) return;
    settleLatest.current();
    const view = openSeriesView(seriesContext(series, placement, row.position, row.rank, seriesListId, listContext()));
    brandTrigger.current = element; setBrandStory({ series, view });
  };
  const closeBrand = () => { setBrandStory(null); brandTrigger.current?.focus({ preventScroll: true }); };
  const active = useTemplatePlayback(dialog, galleryItems.map(item => item.id).join(','), props.open && !preview && !brandStory, true, priority);
  const campaignStage = blackFriday && campaignStages.find(stage => stage.items.some(item => item.id === preview?.id));
  const related = useMemo(() => preview ? (campaignStage ? campaignStage.items.filter(item => item.id !== preview.id)
    : handoffPreview ? relatedTemplatesByTags(preview, catalog) : relatedTemplates(preview, catalog)) : [], [preview, catalog, handoffPreview, campaignStage]);
  const previewIndex = galleryItems.findIndex(item => item.id === preview?.id);
  const clear = () => { if (format) props.onCollectionChange?.(null); setSelected({}); setEditableOnly(false); setBrandsOnly(false); setCompareWithout(''); };
  const reset = () => {
    setCompareWithout('');
    if (hasFilters) { tracking.reportDiscoveryClick('filter_clear', listContext()); pendingResult.current = 'filter_clear'; }
    clear();
  };
  // `control` is where the option was picked: the purpose bar and industry menu report a category choice, the filter menu and chips a filter option.
  const picked = (control: 'category_select' | 'filter_option', group: FilterGroup, option: string | undefined, isSelected: boolean) => {
    settleSearch();
    tracking.reportDiscoveryClick(control, listContext(), { filter_group: group, option, selected: isSelected });
    pendingResult.current = control === 'category_select' ? 'category_select' : 'filter_apply';
  };
  const toggle = (key: Facet, value: string) => {
    picked('filter_option', key, value, !selected[key]?.includes(value));
    setSelected(toggleValue(selected, key, value));
  };
  const chooseCategory = (key: 'uses' | 'industries', value: string | undefined) => {
    setCompareWithout('');
    const next = value === undefined || (key === 'uses' && selected.uses?.includes(value)) ? [] : [value];
    picked('category_select', key, value, next.length > 0);
    if (key === 'uses') {
      setBrandsOnly(false);
      if (format) props.onCollectionChange?.(null);
    }
    setSelected({ ...selected, [key]: next });
  };
  const chooseBrands = (next: boolean) => {
    setCompareWithout('');
    picked(next ? 'category_select' : 'filter_option', 'brand', 'top-100-brands', next);
    setBrandsOnly(next);
    if (next) setSelected({ ...selected, uses: [] });
  };
  const toggleEditable = (next: boolean) => { picked('filter_option', 'editable', undefined, next); setEditableOnly(next); };
  const changeSort = (value: string) => {
    const next = tracking.asSort(value);
    settleSearch();
    tracking.reportDiscoveryClick('sort_option', { ...listContext(), sort: next }, { previous_sort: sort, changed: next !== sort });
    if (next !== sort) pendingResult.current = 'sort_change';
    setSort(next);
  };
  const openFilters = (next: boolean) => {
    if (next && !filtersOpen) {
      tracking.reportDiscoveryClick('filter_open', listContext());
      setDraftFilters(selected); setDraftEditable(editableOnly); setFacetQuery('');
      setFilterTab(available.some(facet => facet.key === filterTab) ? filterTab : available[0]?.key ?? 'uses');
    }
    setFiltersOpen(next);
  };
  const applyFilters = () => {
    for (const [key] of facets) {
      const previous = selected[key] ?? [], next = draftFilters[key] ?? [];
      for (const value of new Set([...previous, ...next])) {
        if (previous.includes(value) !== next.includes(value)) picked('filter_option', key, value, next.includes(value));
      }
    }
    if (editableOnly !== draftEditable) picked('filter_option', 'editable', undefined, draftEditable);
    setSelected(draftFilters); setEditableOnly(draftEditable); setFiltersOpen(false);
  };
  const show = useCallback((item: GalleryTemplate, placement: Placement = 'catalog', navigate = true, series?: SeriesView) => {
    if (navigate) routeChange.current?.(item.id);
    currentSearchContext.current.activity();
    const view: DetailView = { id: tracking.newTrackingId(), placement, context: listContext(), ...(series ? { series: { ...series, series_surface: 'template_detail' } } : {}) }; detailView.current = view; instructionShown.current = undefined;
    const index = latest.current.items.findIndex(candidate => candidate.id === item.id);
    tracking.reportDetailShown(item, view, placement === 'related' || index < 0 ? undefined : index + 1);
    setPreview(item); setPrompt(''); setPromptError(false); setManualCopy(''); setPromptExpanded(false); setGuideOpen(false);
    if (detailInfo.current) detailInfo.current.scrollTop = 0;
    if (reviewBody.current) reviewBody.current.scrollTop = 0;
    if (reviewScroll.current) reviewScroll.current.scrollTop = 0;
    if (detail.current) detail.current.scrollTop = 0;
    if (!detail.current?.open) {
      if (handoffPreview && !props.inWorkspace && dialog.current?.open) { dialog.current.close(); dialog.current.show(); }
      detail.current?.showModal();
    }
  }, [handoffPreview, props.inWorkspace]);
  useEffect(() => {
    if (!props.open || props.templateId === undefined) return;
    if (!props.templateId) { detail.current?.close(); return; }
    const item = catalog.find(template => template.id === props.templateId)
      ?? (initialTemplate?.id === props.templateId ? initialTemplate : null)
      ?? blackFridayReference(props.templateId, locale);
    if (item && item.id !== preview?.id) show(item, blackFriday ? 'black_friday' : 'catalog', false);
  }, [props.open, props.templateId, catalog, preview?.id, show, locale, blackFriday, initialTemplate]);
  const openCard = useCallback((item: GalleryTemplate) => {
    settleLatest.current();
    const placement = latest.current.blackFriday ? 'black_friday' : 'catalog';
    tracking.reportCardOpened(item, placement, latest.current.items.findIndex(candidate => candidate.id === item.id) + 1, listContext());
    show(item, placement);
  }, [show, listContext]);
  const openRelated = (item: GalleryTemplate, position: number) => {
    tracking.reportCardOpened(item, 'related', position, listContext(), preview ?? undefined, detailView.current);
    show(item, 'related', true, detailView.current?.series);
  };
  const navigate = (step: number) => {
    if (galleryItems.length < 2) return;
    tracking.reportDetailStep(preview, step, detailView.current);
    show(galleryItems[previewIndex < 0 ? (step > 0 ? 0 : galleryItems.length - 1) : (previewIndex + step + galleryItems.length) % galleryItems.length], 'navigation', true, detailView.current?.series);
  };
  const surprise = () => {
    settleSearch();
    const item = randomTemplate(visible, lastRandom.current);
    if (item) { tracking.reportSurprise(listContext(), visible.length); lastRandom.current = item.id; show(item, 'random'); }
  };
  // The instruction counts as shown once its text is on screen, once per detail view.
  useEffect(() => {
    const view = detailView.current;
    const target = instructionText.current?.querySelector(':scope > p, :scope > textarea');
    if (!props.open || !preview || !prompt || !view || !target || instructionShown.current === view.id
      || typeof IntersectionObserver === 'undefined') return;
    const threshold = 0.01; // A positive threshold notifies again after zero-area edge contact.
    let visible = false;
    const report = () => {
      if (!visible || document.hidden || !detail.current?.open || detailView.current?.id !== view.id || instructionShown.current === view.id) return;
      instructionShown.current = view.id; tracking.reportInstructionShown(preview, view); observer.disconnect();
    };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= threshold); report();
    }, { root: detail.current, threshold });
    observer.observe(target);
    document.addEventListener('visibilitychange', report);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', report); };
  }, [props.open, preview, prompt, manualCopy, promptExpanded, guideOpen]);
  useEffect(() => {
    if (!preview) return;
    setPromptError(false);
    let cancelled = false;
    async function loadPrompt() {
      try {
        const connection = info.current ?? await motionApi<IntegrationInfo>('/integration'); info.current = connection;
        if (!cancelled) setPrompt(handoffPreview || blackFridayReference(preview!.id, locale) ? templateHandoffPrompt(preview!, locale) : templatePrompt(connection, 'codex', preview!, locale));
      } catch { if (!cancelled) setPromptError(true); }
    }
    void loadPrompt();
    return () => { cancelled = true; };
  }, [preview, locale, promptAttempt]);
  async function copy(submit = false) {
    if (!prompt) return;
    const text = submit ? templateSubmissionPrompt(prompt, handoffPreview ? locale : 'en') : prompt;
    const template = preview, view = detailView.current, attemptId = tracking.newTrackingId();
    if (template) tracking.reportUseClicked(template, submit ? 'recreate_submit' : 'recreate', view, attemptId);
    try {
      await navigator.clipboard.writeText(text);
      if (previewLatest.current?.id === template?.id && detailView.current?.id === view?.id) { setManualCopy(''); showToast(handoffPreview ? t(submit ? 'Contribution instruction copied. Paste into your Agent to prepare a reusable template and contribution PR.' : 'Copied. Paste into your Agent, add your materials and requirements, then send.') : 'Copied. Paste into your Agent.', 'info'); }
      if (template) tracking.reportCopyResult(template, 'clipboard_written', attemptId, submit, view);
    } catch {
      if (previewLatest.current?.id === template?.id && detailView.current?.id === view?.id) { setManualCopy(text); setPromptExpanded(true); showToast(handoffPreview ? t('Copy failed. Select the instruction in this section to copy manually, or try again.') : 'Copy failed. Select and copy the instruction below.', 'error', 'feedback'); }
      if (template) tracking.reportCopyResult(template, 'manual_fallback_shown', attemptId, submit, view);
    }
  }
  async function copyBrandInstruction(template: GalleryTemplate, submit = false): Promise<string | null> {
    const view = brandStory ? { series: { ...brandStory.view, series_surface: 'timeline' as const } } : undefined;
    const attemptId = tracking.newTrackingId();
    tracking.reportUseClicked(template, submit ? 'recreate_submit' : 'recreate', view, attemptId);
    let text: string;
    try {
      const connection = info.current ?? await motionApi<IntegrationInfo>('/integration'); info.current = connection;
      const instruction = templatePrompt(connection, 'codex', template, locale);
      text = submit ? templateSubmissionPrompt(instruction) : instruction;
    } catch {
      showToast(t('Could not load the instruction.'), 'error', 'feedback');
      tracking.reportCopyResult(template, 'failed', attemptId, submit, view); return null;
    }
    let copyTimeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        navigator.clipboard.writeText(text),
        new Promise<never>((_, reject) => { copyTimeout = setTimeout(() => reject(new Error('Clipboard permission timed out')), 8000); }),
      ]);
      showToast(t(submit ? 'Contribution instruction copied. Paste into your Agent to prepare a reusable template and contribution PR.' : 'Copied. Paste into your Agent, add your materials and requirements, then send.'), 'info');
      tracking.reportCopyResult(template, 'clipboard_written', attemptId, submit, view); return null;
    } catch {
      showToast(t('Copy failed. Select the instruction below to copy manually, or try again.'), 'error', 'feedback');
      tracking.reportCopyResult(template, 'manual_fallback_shown', attemptId, submit, view); return text;
    } finally { clearTimeout(copyTimeout); }
  }
  async function downloadMotion(template = preview) {
    if (!template?.motionDocumentUrl) return;
    const view = template.id === preview?.id ? detailView.current : brandStory ? { series: { ...brandStory.view, series_surface: 'timeline' as const } } : undefined, attemptId = tracking.newTrackingId();
    tracking.reportDownloadClicked(template, 'download_guide', attemptId, view);
    let errorCode = 'FETCH_ERROR';
    setDownloading(true);
    try {
      const response = await fetch(template.motionDocumentUrl, { credentials: 'omit' });
      if (!response.ok) { errorCode = `HTTP_${response.status}`; throw new Error(`Download HTTP ${response.status}`); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'motion.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      tracking.reportDownloadResult(template, attemptId, 'browser_save_requested', undefined, view);
    } catch { showToast('Download failed. Please try again.', 'error', 'feedback'); tracking.reportDownloadResult(template, attemptId, 'fetch_failed', errorCode, view); }
    finally { setDownloading(false); }
  }
  const filterBy = (key: Facet, value: string) => {
    if (blackFriday || detailOnly) props.onBrowseTemplates?.();
    picked('filter_option', key, value, true);
    setSelected({ [key]: [value] }); setCompareWithout('');
    if (storiesPreview) setBrandStory(null);
    setLibraryQuery(''); setEditableOnly(false); setBrandsOnly(false);
    if (!detailOnly) closeDetail();
  };
  const chooseCreator = (creator: string | null) => {
    clear();
    setBrandStory(null);
    props.onCreatorChange?.(creator);
    if (dialog.current) dialog.current.scrollTop = 0;
  };
  const credit = preview && templateCredit(preview);
  const searchPlaceholder = t(blackFriday ? 'Search templates…' : props.creators && !props.creator ? 'Search creators' : 'Search templates, creators, styles…');
  const searchLabel = t(props.creators && !props.creator ? 'Search creators' : 'Search templates');
  const searchField = <label className="om-field om-search-field">
    <MotionIcon name="search" size={16} />
    <input ref={search} type="search" maxLength={200} value={query} placeholder={searchPlaceholder} aria-label={searchLabel}
      onChange={event => setQuery(event.target.value)}
      onFocus={() => { currentSearchContext.current.activity(); tracking.reportRecoveryAction('search_focus', listContext()); }}
      onCompositionStart={() => { composing.current = true; setSearchComposing(true); }}
      onCompositionEnd={event => {
        composing.current = false;
        setQuery(event.currentTarget.value);
        setSearchComposing(false);
        setSettle(value => value + 1);
      }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) confirmSearch(); }} />
    <kbd>{searchShortcut}</kbd>
  </label>;
  const closeLabel = t(props.creators ? 'Close' : 'Close template library');
  const searchActions = <div className="om-control-row om-gallery-header-actions">
    {searchField}
    <Tooltip label={closeLabel}><IconButton variant="ghost" ref={libraryClose} className="om-button om-icon-button" disabled={props.busy} onClick={props.onClose} aria-label={closeLabel} icon={<MotionIcon name="close" size={16} />} /></Tooltip>
  </div>;
  const gallery = !detailOnly && <>
    {!blackFriday && !props.creators && <div className={styles.stickyHeader}>
      <header className={styles.header}>
        <div className="om-gallery-wordmark">
          {!props.inWorkspace && <BrandLogo compact />}
          <span className={`om-gallery-page-label${props.inWorkspace ? ' om-gallery-title' : ''}`}>{t('Template library')}</span>
        </div>
        {searchActions}
      </header>
      <div className={styles.toolbar}>
        <CategoryStrip label="Video purpose" selection={brandsOnly ? 'top-100-brands' : selected.uses?.join('|')} plainArrows>
          <Button type="button" variant="ghost" className="om-button om-filter-pill" aria-pressed={!brandsOnly && !selected.uses?.length} onClick={() => chooseCategory('uses', undefined)}>{t('All')}</Button>
          <Button type="button" variant="ghost" className="om-button om-filter-pill" aria-label={t('TOP 100 brands')} aria-pressed={brandsOnly} onClick={() => chooseBrands(true)}><TopBrandsLabel /></Button>
          {categories.map(value => <Button type="button" variant="ghost" className="om-button om-filter-pill" key={value} aria-pressed={selected.uses?.includes(value) ?? false} onClick={() => chooseCategory('uses', value)}>{t(value)}</Button>)}
        </CategoryStrip>
        <div className={styles.controls}>
          <TemplateIndustryMenu industries={industries} selected={selected.industries} onSelect={value => chooseCategory('industries', value)} />
          <GalleryFilterPopover groups={available.map(group => ({ ...group, values: group.key === 'uses' ? categories : group.values }))}
            open={filtersOpen} onOpenChange={openFilters} draft={draftFilters} onChange={setDraftFilters}
            tab={filterTab} onTabChange={value => setFilterTab(value as Facet)} query={facetQuery} onQueryChange={setFacetQuery}
            active={Object.values(selected).flat().length + Number(editableOnly) > 0} countLabel={t('{count} templates', { count: draftCount })}
            hasDraft={hasDraftFilters} onApply={applyFilters} onClear={() => { setDraftFilters({}); setDraftEditable(false); }}
            extra={{ label: 'Ready to edit', checked: draftEditable, onChange: setDraftEditable }}
            renderValue={(key, value) => key === 'brand' ? <Identity template={catalog.find(item => item.brand === value)!} brand /> : null} />
          <GallerySortMenu value={sort} options={sortOptions} onChange={changeSort} />
        </div>
      </div>
      {hasFilters && <div className={styles.chips}>{format && <Button variant="plain" onClick={() => props.onCollectionChange?.(null)} aria-label={t('Remove filter {value}', { value: t(formatCategories[format]) })}>{t(formatCategories[format])}<MotionIcon name="close" size={12} /></Button>}{brandsOnly && <Button variant="plain" onClick={() => chooseBrands(false)} aria-label={t('Remove filter {value}', { value: t('TOP 100 brands') })}>{t('TOP 100 brands')}<MotionIcon name="close" size={12} /></Button>}{query && <Button variant="plain" onClick={clearSearch} aria-label={t('Remove filter {value}', { value: query })}><MotionIcon name="search" size={12} />{query}<MotionIcon name="close" size={12} /></Button>}{facets.flatMap(([key]) => (selected[key] ?? []).map(value => <Button variant="plain" key={key + value} onClick={() => toggle(key, value)} aria-label={t('Remove filter {value}', { value: t(value) })}>{key === 'brand' ? value : t(value)}<MotionIcon name="close" size={12} /></Button>))}{compareWithout && <Button variant="plain" onClick={() => setCompareWithout('')}>{t('Excluding {brand}', { brand: compareWithout })}<MotionIcon name="close" size={12} /></Button>}{editableOnly && <Button variant="plain" onClick={() => toggleEditable(false)}>{t('Ready to edit')}<MotionIcon name="close" size={12} /></Button>}{hasAppliedFilters && <Button variant="plain" onClick={reset}>{t('Clear filters')}</Button>}<span>{t('{count} templates', { count: visible.length })}</span></div>}
    </div>}
    {blackFriday && !props.creators ? <BlackFridayCollection templates={campaignItems}
      featuredPreviewsEnabled={props.open && !preview && !props.collectionSkillOpen} onBack={props.onClose}
      selectedFilter={activeCampaignFilter} onFilterChange={selectCampaignFilter} searchField={searchField}
      emptyResults={<div data-search-recovery="">
        <TemplateSearchRecovery visible expanded query={campaignQuery} context={listContext()} reason="no_results"
          onExpand={expandSearchRecovery} onActivity={searchRecoveryActivity} showToast={(message, kind) => showToast(message, kind, 'feedback')} />
      </div>}
      active={active} onPreview={openCard} onPriority={setPriority} onOpenSkill={props.onOpenSkill} onStartScenario={props.onStartScenario} />
    : props.creators ? <TemplateCreators catalog={catalog} creator={props.creator ?? null} query={query} searchActions={searchActions} works={visible} loading={loading}
      error={error} retry={() => retry(value => value + 1)} choose={chooseCreator} open={openCard} active={active} onPriority={setPriority} /> :
    <main className={styles.results} aria-busy={loading}>
      {missingTemplate && <div className={styles.empty} role="alert"><p>{t('This template is no longer available.')}</p><Button variant="plain" onClick={closeDetail}>{t('View all templates')}</Button></div>}
      <div className={storiesPreview && brandsOnly ? storyStyles.brandGrid : styles.grid}>
        {!showEmptyRecovery && <GalleryIntro eyebrow={storiesPreview && brandsOnly ? t('TOP 100 / Brand series') : t('Made to move.')} title={storiesPreview && brandsOnly ? t('Find ideas for your next launch.') : t('Find your next motion.')} description={storiesPreview && brandsOnly ? t('Browse by brand and follow their launches over time. Pick a video and make it your own.') : t('Explore the details. Find a direction. Make it your own.')} count={loading && !catalog.length ? t('Loading templates…') : storiesPreview && brandsOnly ? t('{brands} brands · {works} works', { brands: visibleBrandGroups.length, works: visible.length }) : t('{count} templates', { count: visible.length })} disabled={!visible.length || loading} onSurprise={surprise} submitLabel={t('Submit template')} submitUrl={templateContributionUrl} onSubmit={() => tracking.reportDiscoveryClick('submit_video', listContext())}
          afterActions={!query.trim() && <div className={`om-media-detail-actions ${styles.referenceEntry}`}>
            <span className={styles.referenceEntryLabel}>{t('Nothing suitable?')}</span>
            <Button variant="ghost" type="button" className="om-button h-auto" data-reference-entry="library_home" aria-haspopup="dialog" aria-label={t('Paste a video link to make your own')} onClick={event => {
              const context = listContext();
              referenceSeen(context);
              tracking.reportRecoveryAction('reference', context, 'library_home');
              setReferenceTrigger(event.currentTarget);
            }}>
              <span>{t('Paste a video link to make your own')}</span><MotionIcon name="arrow-right" size={16} />
            </Button>
          </div>} />}
        {loading && !catalog.length && Array.from({ length: 12 }, (_, index) => <div key={index} className={styles.skeletonCard} aria-hidden="true"><Skeleton style={{ aspectRatio: [1.35, 1.78, 1, 1.78][index % 4] }} /><div><Skeleton style={{ width: 28, height: 28, borderRadius: '50%' }} /><Skeleton style={{ width: '55%', height: 9 }} /></div></div>)}
        {storiesPreview && brandsOnly ? visibleBrandGroups.map(series => <BrandSeriesCard key={series.name} series={series} onOpen={(group, element) => openBrand(group, element, 'top100')} />) : visible.map((item, index) => <Fragment key={item.id}>{insertions.get(index) && <BrandSeriesCard series={insertions.get(index)!} discovery onOpen={(group, element) => openBrand(group, element, 'discovery')} />}<TemplateCard template={item} onSelect={openCard} active={active.has(item.id)} onPriority={setPriority} /></Fragment>)}
      </div>
      {loading && !catalog.length && <span className={styles.visuallyHidden} role="status">{t('Loading templates…')}</span>}
      {error && <div className={styles.empty} role="alert"><p>{t(error)}</p><Button variant="plain" onClick={() => retry(value => value + 1)}>{t('Retry')}</Button></div>}
      {props.open && <div data-search-recovery="" hidden={!showRecovery}>
        <TemplateSearchRecovery visible={showRecovery} query={query} context={listContext()} reason={!catalog.length ? 'catalog_empty' : showEmptyRecovery ? 'no_results' : 'unsuitable'} expanded={showEmptyRecovery || recoveryExpanded}
          searchAction={showEmptyRecovery && (!catalog.length ? <Button variant="ghost" className="om-button h-auto" onClick={() => retry(value => value + 1)}>{t('Reload')}</Button>
            : suggestedRemoval ? <Button variant="ghost" className="om-button h-auto" onClick={() => {
              if (suggestedRemoval.key === 'editable') toggleEditable(false);
              else if (suggestedRemoval.key === 'top') chooseBrands(false);
              else toggle(suggestedRemoval.key, suggestedRemoval.value);
            }}>{t('Remove {condition} · Show {results}', { condition: suggestedRemoval.label, results: suggestedRemoval.count === 1 ? t('1 template') : t('{count} templates', { count: suggestedRemoval.count }) })}</Button>
              : query.trim() ? <Button variant="ghost" className="om-button h-auto" onClick={() => search.current?.focus()}>{t('Edit search')}</Button>
                : hasAppliedFilters ? <Button variant="ghost" className="om-button h-auto" onClick={reset}>{t('Clear filters')}</Button> : null)}
          onExpand={expandSearchRecovery} onActivity={searchRecoveryActivity} showToast={(message, kind) => showToast(message, kind, 'feedback')} />
      </div>}
    </main>}
    {props.open && referenceTrigger && <TemplateReferenceDialog trigger={referenceTrigger} onClose={() => setReferenceTrigger(null)}
      onActivity={listContext} showToast={(message, kind) => showToast(message, kind, 'feedback')} />}
    {props.open && storiesPreview && brandStory && <BrandStoriesDialog key={brandStory.view.series_view_id} series={brandStory.series} trackingView={brandStory.view} covered={Boolean(preview)} onCopy={copyBrandInstruction} onDownload={item => downloadMotion(item)} onClose={closeBrand} onTemplate={(item, guide) => { show(item, 'catalog', true, brandStory.view); if (guide) setGuideOpen(true); }} onCompare={purpose => {
      const name = brandStory.series.name;
      closeBrand(); setBrandsOnly(false); setQuery(''); setEditableOnly(false); setSelected({ uses: [purpose] }); setCompareWithout(name);
    }} />}
  </>;
  const previewDialog = <>
    <dialog ref={detail} className={`${styles.detail} ${handoffPreview ? styles.reviewDetail : ''}`} aria-label={t('Template preview')} onCancel={event => { if (event.target !== detail.current) return; event.preventDefault(); if (handoffPreview && guideOpen) setGuideOpen(false); else closeDetail(); }} onClose={event => { if (event.target !== detail.current || detail.current?.open) return; setPreview(null); setPrompt(''); setGuideOpen(false); detailView.current = undefined; if (!detailOnly && handoffPreview && !props.inWorkspace && openLatest.current) { dialog.current?.close(); dialog.current?.showModal(); } }} onKeyDown={event => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1); }
    }}>
      {detailOnly && !preview && <div className={styles.empty}>
        {error || missingTemplate ? <p role="alert">{t(error || 'This template is no longer available.')}</p>
          : <p role="status">{t('Loading preview…')}</p>}
        {error && <Button type="button" variant="secondary" className="om-button" onClick={() => retry(value => value + 1)}>{t('Retry')}</Button>}
        <Button type="button" variant="secondary" className="om-button" onClick={closeDetail}>{t('Close template preview')}</Button>
      </div>}
      {preview && <>{(!handoffPreview || !guideOpen) && <DetailScroll enabled={handoffPreview} container={reviewScroll}><div className={`${styles.detailGrid} ${handoffPreview ? styles.reviewGrid : ''}`}>
        <div className={styles.stage}>
          {preview.posterUrl && <img className={styles.ambient} src={preview.posterUrl} alt="" aria-hidden="true" />}
          <div className={styles.stageGlass} />
          <DetailMedia key={preview.id} template={preview} />
          {handoffPreview && <nav className={styles.stageNavigation} aria-label={t('Browse videos')}>
            <Button variant="ghost" className="om-button h-auto" disabled={galleryItems.length < 2} onClick={() => navigate(-1)}><MotionIcon name="arrow-left" size={16} />{t('Previous template')}</Button>
            <span>{previewIndex >= 0 ? `${previewIndex + 1} / ${galleryItems.length}` : t('Related templates')}</span>
            <Button variant="ghost" className="om-button h-auto" disabled={galleryItems.length < 2} onClick={() => navigate(1)}>{t('Next template')}<MotionIcon name="arrow-right" size={16} /></Button>
          </nav>}
        </div>
        <div ref={detailInfo} className={styles.detailInfo}>
          <div className={styles.detailNav}>
            <Tooltip withinDialog wrap label={t('Close template preview')}><IconButton variant="plain" className={styles.iconButton} autoFocus={!handoffPreview} onClick={closeDetail} aria-label={t('Close template preview')} icon={<MotionIcon name="close" size={20} />} /></Tooltip>
            <span className={styles.detailCount}>{previewIndex >= 0 ? `${previewIndex + 1} / ${galleryItems.length}` : t('Related templates')}</span>
            <Tooltip withinDialog wrap label={t('Previous template')}><IconButton variant="plain" className={styles.iconButton} disabled={galleryItems.length < 2} onClick={() => navigate(-1)} aria-label={t('Previous template')} icon={<MotionIcon name="arrow-left" size={18} />} /></Tooltip>
            <Tooltip withinDialog wrap label={t('Next template')}><IconButton variant="plain" className={styles.iconButton} disabled={galleryItems.length < 2} onClick={() => navigate(1)} aria-label={t('Next template')} icon={<MotionIcon name="arrow-right" size={18} />} /></Tooltip>
          </div>
          <div ref={reviewBody} className={styles.detailBody}>
            <h2 ref={detailTitle} tabIndex={handoffPreview ? -1 : undefined} className="om-media-detail-title">{preview.title}</h2>
            {handoffPreview && preview.description && <p className={styles.description}>{preview.description}</p>}
            {handoffPreview && <TemplateReviewSpecs template={preview} />}
            <div className={styles.creator}>
              <Identity template={preview} />
              <div>{credit && props.onCreatorChange ? <Button variant="plain" className="om-text-link" onClick={() => chooseCreator(credit.id)}>{credit.name}</Button> : <strong>{preview.authorName || preview.author || preview.brand || 'OpenMotion'}</strong>}{preview.brand && preview.brand.trim().toLocaleLowerCase() !== (preview.authorName || preview.author || preview.brand).trim().toLocaleLowerCase() && <small>{preview.brand}</small>}</div>
              {preview.sourceUrl && <Tooltip withinDialog wrap label={t('Source')}><a className={styles.sourceLink} href={preview.sourceUrl} target="_blank" rel="noreferrer" onClick={() => tracking.reportDetailLink(preview, 'view_source', detailView.current)} aria-label={t('Source')}><MotionIcon name="arrow-up-right" size={18} /></a></Tooltip>}
            </div>
            {handoffPreview && <section className={styles.reviewResources} aria-label={t('Template resources')}>
              <a className={`om-text-link ${styles.repositoryLink}`} data-quiet href={templateRepositoryUrl(preview)} target="_blank" rel="noreferrer" onClick={() => tracking.reportDetailLink(preview, 'view_repository', detailView.current)}><GithubLogo size={16} weight="fill" aria-hidden="true" />{t('View on GitHub')}</a>
              <div className={styles.reviewResourceActions}>
                {preview.motionDocumentUrl && <Tooltip withinDialog wrap label="motion.md" description={t('Download the shot and motion notes.')}>
                  <Button variant="plain" className={`om-text-link ${styles.repositoryLink}`} data-quiet disabled={downloading} onClick={() => void downloadMotion()}><MotionIcon name="download" size={17} />{t(downloading ? 'Downloading…' : 'Download motion.md')}</Button>
                </Tooltip>}
              </div>
            </section>}
            {!handoffPreview && preview.description && <p className={styles.description}>{preview.description}</p>}
            {handoffPreview && <>
              <TemplateDetailReview template={preview} onCopyColor={color => { tracking.reportDetailAction(preview, 'copy_color', detailView.current); void navigator.clipboard.writeText(color).then(() => showToast(t('Copied {color}', { color }), 'info')).catch(() => showToast(t('Could not copy color. Try again.'), 'error')); }} onFilter={filterBy} />
            </>}
            <section ref={instructionText} className={`${styles.instruction} ${handoffPreview ? styles.reviewCreation : ''}`} aria-label={t(handoffPreview ? 'Template recreation instruction' : 'Template instruction')}><header><h3>{t(handoffPreview ? 'Template recreation instruction' : 'Template instruction')}</h3>
              {handoffPreview && <Popover key={preview.id} container={detail} align="end" openOnHover aria-label={t('After copying')} className={styles.handoffPopover} initialFocus={false} onOpenChange={open => { if (open) tracking.reportDetailAction(preview, 'handoff_help', detailView.current); }}
                trigger={<Button variant="plain" className={`om-text-link ${styles.handoffHelp}`} data-quiet>{t('Next steps')}<MotionIcon name="info" size={14} /></Button>}>
                <div onKeyDown={event => event.stopPropagation()}><TemplateHandoffSteps template={preview} /></div>
              </Popover>}
            </header>{(manualCopy ? <textarea className={styles.manualCopy} readOnly rows={8} value={manualCopy} aria-label={t('Content to copy')} onFocus={event => event.currentTarget.select()} /> : prompt ? <p className={promptExpanded ? styles.fullInstruction : styles.shortInstruction}>{prompt}</p> : promptError ? <div className={styles.promptFailure} role="status">{t('Could not load the instruction.')}<Button variant="plain" onClick={() => retryPrompt(value => value + 1)}>{t('Retry')}</Button></div> : <div className={styles.promptSkeleton} role="status" aria-label={t('Loading instruction…')}>{[100, 94, 100, 86, 62].map((width, index) => <Skeleton key={index} style={{ width: `${width}%`, height: 10 }} />)}</div>)}<Button variant="plain" disabled={!prompt} className={`om-text-link ${styles.expandInstruction}`} data-quiet aria-expanded={promptExpanded} onClick={() => { tracking.reportInstructionExpanded(preview, !promptExpanded, detailView.current); setPromptExpanded(!promptExpanded); }}>{t(promptExpanded ? 'Show less' : 'Show instruction')}<MotionIcon name="chevron-down" size={14} /></Button></section>
            {!handoffPreview && <div className={styles.actions}>
              {isEditableTemplate(preview) && <Button variant="ghost" className="om-button h-auto" data-primary disabled={props.busy || props.openingDisabled} onClick={() => { tracking.reportUseClicked(preview, 'open_edit', detailView.current); closeDetail(); props.onOpen(preview.id); }}>{t('Open and edit')}<MotionIcon name="arrow-up-right" size={16} /></Button>}
              <div className={styles.recreateActions}>
                <Button variant="ghost" className="om-button h-auto" data-primary disabled={!prompt} onClick={() => void copy()}>{t('Recreate template')}<MotionIcon name="sparkles" size={16} /></Button>
                <Tooltip withinDialog wrap label={t('Recreate and submit')}><IconButton variant="plain" className={`om-button ${styles.submitTemplate}`} disabled={!prompt} onClick={() => void copy(true)} aria-label={t('Recreate and submit')} icon={<MotionIcon name="git-branch" size={17} />} /></Tooltip>
              </div>
            </div>}
            {!handoffPreview && <div className={styles.resourceLinks}>
              {!handoffPreview && <a className={`om-text-link ${styles.repositoryLink}`} data-quiet href={templateRepositoryUrl(preview)} target="_blank" rel="noreferrer" onClick={() => tracking.reportDetailLink(preview, 'view_repository', detailView.current)}><GithubLogo size={16} weight="fill" aria-hidden="true" />{t('View on GitHub')}</a>}
              {preview.motionDocumentUrl && <Button variant="plain" className={`om-text-link ${styles.repositoryLink}`} data-quiet disabled={downloading} onClick={() => void downloadMotion()}><MotionIcon name="download" size={15} />{t(downloading ? 'Downloading…' : 'Download motion.md')}</Button>}
            </div>}
            <dl className={styles.metadata} hidden={handoffPreview}>
              {preview.duration != null && <div><dt>{t('Duration')}</dt><dd>{t('{value}s', { value: Number(preview.duration.toFixed(1)) })}</dd></div>}
              {(preview.width || preview.ratio) && <div><dt>{t('Aspect ratio')}</dt><dd>{templateRatio(preview)}</dd></div>}
              {facets.filter(([key]) => !['duration', 'ratio'].includes(key)).map(([key, label]) => values(preview, key).length > 0 && <div key={key}><dt>{t(label)}</dt><dd>{values(preview, key).map(value => <MetadataTag key={value} label={key === 'brand' ? value : t(value)} onClick={() => filterBy(key, value)} />)}</dd></div>)}
            </dl>
            {preview.projectFileUrl && <div className={styles.projectActions}><a href={preview.projectFileUrl} target="_blank" rel="noreferrer" onClick={() => tracking.reportDownloadClicked(preview, 'download_project', undefined, detailView.current)}>{t('Download OpenMotion project')}<MotionIcon name="arrow-up-right" size={14} /></a></div>}
            {!handoffPreview && (preview.styleDescription || preview.reviewFocus || preview.motionGuideUrl) && <section className={styles.guide} aria-label={t('Motion guide')}>
              {preview.styleDescription && <details><summary>{t('Visual style')}</summary><p>{preview.styleDescription}</p></details>}
              {preview.reviewFocus && <details><summary>{t('Production notes')}</summary><p>{preview.reviewFocus}</p></details>}
              {!handoffPreview && preview.motionGuideUrl && <details key={preview.id} onToggle={event => setGuideOpen(event.currentTarget.open)}><summary>{t('Motion guide')}</summary>{guideOpen && <TemplateMotionGuide url={preview.motionGuideUrl} title={t('Motion guide')} />}<a href={preview.motionGuideUrl} target="_blank" rel="noreferrer" onClick={() => tracking.reportDetailLink(preview, 'view_full_page', detailView.current)}>{t('View full page')}<MotionIcon name="arrow-up-right" size={14} /></a></details>}
            </section>}
            {!handoffPreview && related.length > 0 && <RelatedTemplatePreviews key={preview.id} templates={related} panel={detailInfo} onSelect={openRelated} />}
            {handoffPreview && <TemplateProductionNotes template={preview} onGuide={() => { tracking.reportDetailAction(preview, 'view_guide', detailView.current); setGuideOpen(true); }} />}
          </div>
          {handoffPreview && <div ref={reviewFooter} className={styles.reviewFooter} role="group" aria-label={t('Template actions')}>
              <div className={styles.handoffActions}>
                {isEditableTemplate(preview) && <><p>{t('A separate project keeps your current work intact. Replace the sample content after opening.')}</p><Button variant="ghost" className="om-button h-auto" data-primary disabled={props.busy || props.openingDisabled || ['creating', 'opening', 'unknown'].includes(projectProgress[preview.id]?.state)} onClick={() => void prepareProject(preview)}>{t(projectProgress[preview.id]?.state === 'creating' ? 'Creating project…' : projectProgress[preview.id]?.state === 'opening' ? 'Opening project…' : projectProgress[preview.id]?.result ? 'Continue editing this project' : 'Open and edit')}<MotionIcon name="arrow-up-right" size={16} /></Button></>}
                <div className={styles.recreateActions}>
                  <Button variant="ghost" className="om-button h-auto" data-primary={!isEditableTemplate(preview) || undefined} disabled={!prompt} onClick={() => void copy()}>{t('Recreate this template')}<MotionIcon name="sparkles" size={16} /></Button>
                  <Tooltip withinDialog wrap label={t('Contribute a template')} description={t('Copy contribution instructions for source, a preview and credits.')}>
                    <IconButton variant="plain" className={`om-button ${styles.submitTemplate}`} disabled={!prompt} aria-label={t('Copy contribution brief')} onClick={() => void copy(true)} icon={<MotionIcon name="git-branch" size={17} />} />
                  </Tooltip>
                </div>
              </div>
              <TemplateOpenRecovery progress={projectProgress[preview.id]} onRetry={() => { tracking.reportDetailAction(preview, 'retry_template_project', detailView.current); void prepareProject(preview); }} onCheck={() => void checkProject(preview)} onOpen={() => { tracking.reportDetailAction(preview, 'open_prepared_project', detailView.current); const result = projectProgress[preview.id]?.result; if (result) void revealProject(preview, result); }} />
          </div>}
        </div>
      </div>
      {handoffPreview && related.length > 0 && <RelatedTemplatePreviews wide key={preview.id} currentTemplate={preview} detailView={detailView.current} templates={related} panel={detailInfo} onSelect={openRelated} />}
      </DetailScroll>}
      {handoffPreview && <TemplateGuideReview template={preview} open={guideOpen} onFullPage={() => tracking.reportDetailLink(preview, 'view_full_page', detailView.current)} onClose={() => { tracking.reportDetailAction(preview, 'back_to_template', detailView.current); setGuideOpen(false); }} />}
      </>}
    </dialog>

    {props.open && <StudioToastViewport toasts={toasts} dismissToast={dismissToast} />}
  </>;
  if (detailOnly) return <div className={styles.library} style={{ display: 'contents' }} data-motion-template-detail="">{previewDialog}</div>;
  return <dialog ref={dialog} open={props.inWorkspace ? props.open : undefined} role={props.inWorkspace ? "region" : undefined} className={styles.library} data-workspace-gallery={props.inWorkspace || undefined} data-motion-template-library="" aria-label={t(props.creators ? 'Creators' : 'Template library')} onKeyDown={event => {
    event.stopPropagation();
    if (props.inWorkspace && event.key === 'Escape' && !event.defaultPrevented && !props.busy && !preview && !filtersOpen && event.target instanceof Element && event.target.closest('dialog') === dialog.current) {
      event.preventDefault();
      props.onClose();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !preview && !filtersOpen && !(event.target instanceof HTMLElement && event.target.closest('[data-search-recovery]'))) { event.preventDefault(); search.current?.focus(); }
  }} onCancel={event => { if (event.target !== dialog.current) return; event.preventDefault(); if (!props.busy) props.onClose(); }}>
    {gallery}
    {previewDialog}
  </dialog>;
}
