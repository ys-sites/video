import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { assetMediaUrl, assetVersion, type AssetReference, type LibraryAsset } from '../../../shared/asset-library';
import type { GenerationJob, Model } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Menu, MenuItem, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { VideoFrameThumbnail } from '../components/ui/VideoFrameThumbnail';
import { MediaDurationBadge } from '../components/sidebar/MediaDurationBadge';
import { AssetHoverVideo } from './AssetHoverVideo';
import { AssetGenerationPlaceholder } from './AssetGenerationPlaceholder';
import { GallerySearchField } from './GalleryFilters';
import type { useAssetBrowser } from './AssetBrowser';
import {
  dayKey,
  formatAspectTag,
  formatDayHeading,
  formatDurationShort,
  formatResolutionTag,
  modelDisplayLabel,
  resolveLayoutAspect,
} from './generationLabels';

type FeedDensity = 'compact' | 'comfortable' | 'large';

type StreamItem =
  | { kind: 'job'; key: string; job: GenerationJob; asset?: LibraryAsset; timestamp: number }
  | { kind: 'asset'; key: string; asset: LibraryAsset; timestamp: number };

const SKELETON_ASPECTS = [1, 1.77, 0.56, 1.33, 1, 0.75];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

function formatDimensions(width?: number, height?: number) {
  return width && height ? `${width} × ${height}` : undefined;
}

function GenerationLightbox({
  assets,
  activeId,
  models,
  onSelectId,
  onClose,
  onReusePrompt,
  onUseReference,
  onUseFirstFrame,
  onOpenDetail,
  onDownload,
}: {
  assets: LibraryAsset[];
  activeId: string;
  models?: readonly Model[];
  onSelectId: (id: string) => void;
  onClose: () => void;
  onReusePrompt: (prompt: string) => void;
  onUseReference?: (item: { reference: AssetReference; name: string }) => void;
  onUseFirstFrame?: (item: { reference: AssetReference; name: string }) => void;
  onOpenDetail: (asset: LibraryAsset) => void;
  onDownload?: () => void;
}) {
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const index = assets.findIndex(item => item.id === activeId);
  const asset = index >= 0 ? assets[index] : undefined;
  const [selectedVersionId, setSelectedVersionId] = useState(asset?.currentVersionId ?? '');
  const version = asset && (assetVersion(asset, selectedVersionId) ?? assetVersion(asset));

  useEffect(() => {
    setZoomed(false);
    setSelectedVersionId(asset?.currentVersionId ?? '');
  }, [asset?.id, asset?.currentVersionId]);

  useEffect(() => {
    if (!asset) return;
    const onKey = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); onSelectId(assets[index - 1].id); }
      else if (event.key === 'ArrowRight' && index >= 0 && index < assets.length - 1) { event.preventDefault(); onSelectId(assets[index + 1].id); }
      else if ((event.key === 'd' || event.key === 'D') && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        downloadRef.current?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [asset, index, assets, onSelectId, onClose]);

  if (!asset || !version) return null;
  const src = assetMediaUrl(asset.id, version.id);
  const transparent = asset.modality === 'image' && version.parameters?.background === 'transparent';
  const promptText = version.prompt?.trim();
  const dims = formatDimensions(version.width, version.height);
  const modelName = modelDisplayLabel(models, version.model);
  const versionNum = asset.versions.findIndex(item => item.id === version.id) + 1;
  const orderedVersions = [...asset.versions].reverse();

  return (
    <div
      className="om-gen-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={asset.name}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="om-gen-lightbox-shell">
        <header className="om-gen-lightbox-header">
          <div className="om-gen-lightbox-title">
            <strong>{asset.name}</strong>
            <span className="om-muted">
              {modelName || t(version.source === 'upload' ? 'Local upload' : 'AI generated')}
              {asset.versions.length > 1 ? ` · V${versionNum}` : ''}
              {dims ? ` · ${dims}` : ''}
              {assets.length > 1 ? ` · ${index + 1} / ${assets.length}` : ''}
            </span>
          </div>
          <div className="om-asset-actions">
            {asset.modality === 'image' && (
              <Button variant="plain" className="om-button" onClick={() => setZoomed(value => !value)}>
                <RemixIcon name="search-line" size={15} />
                {t(zoomed ? 'Fit to screen' : 'Zoom 100%')}
              </Button>
            )}
            <a ref={downloadRef} className="om-button" href={src} download={version.filename || asset.name} onClick={() => onDownload?.()}>
              <RemixIcon name="download-2-line" size={15} />
              {t('Download')}
            </a>
            <Button variant="plain" className="om-button" onClick={() => { onClose(); onOpenDetail(asset); }}>
              <RemixIcon name="history-line" size={15} />
              {t('Asset details')}
            </Button>
            <Button variant="plain" className="om-button" aria-label={t('Close')} onClick={onClose}>
              <RemixIcon name="close-line" size={17} />
            </Button>
          </div>
        </header>

        <div className="om-gen-lightbox-stage" data-zoomed={zoomed || undefined}>
          {index > 0 && (
            <Button variant="plain" className="om-button om-gen-lightbox-nav" data-side="prev" aria-label={t('Previous')} onClick={() => onSelectId(assets[index - 1].id)}>
              <RemixIcon name="arrow-left-line" size={18} />
            </Button>
          )}
          {asset.modality === 'video' ? (
            <video key={src} src={src} controls autoPlay playsInline className="om-gen-lightbox-video" />
          ) : (
            <img
              key={src}
              src={src}
              alt={asset.name}
              className={`om-gen-lightbox-image${transparent ? ' motion-color-checkerboard' : ''}`}
              onClick={() => setZoomed(value => !value)}
            />
          )}
          {index < assets.length - 1 && (
            <Button variant="plain" className="om-button om-gen-lightbox-nav" data-side="next" aria-label={t('Next')} onClick={() => onSelectId(assets[index + 1].id)}>
              <RemixIcon name="arrow-right-line" size={18} />
            </Button>
          )}
        </div>

        <footer className="om-gen-lightbox-footer">
          <div className="om-gen-lightbox-meta">
            {promptText ? <p>{promptText}</p> : <p className="om-muted">{asset.name}</p>}
            {orderedVersions.length > 1 && (
              <div className="om-asset-version-list om-gen-lightbox-versions" role="group" aria-label={t('Version')}>
                {orderedVersions.map(item => {
                  const num = asset.versions.findIndex(v => v.id === item.id) + 1;
                  return (
                    <Button key={item.id} variant="plain" className="om-gen-action-pill" aria-pressed={item.id === version.id} onClick={() => setSelectedVersionId(item.id)}>
                      V{num}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="om-asset-actions">
            {promptText && (
              <Button variant="ghost" className="om-button h-auto" onClick={() => { onReusePrompt(promptText); onClose(); }}>
                <RemixIcon name="refresh-line" size={15} />
                {t('Reuse prompt')}
              </Button>
            )}
            {asset.modality === 'image' && onUseReference && (
              <Button
                variant="ghost"
                className="om-button h-auto"
                onClick={() => { onUseReference({ reference: { assetId: asset.id, versionId: version.id }, name: asset.name }); onClose(); }}
              >
                <RemixIcon name="image-line" size={15} />
                {t('Use as reference')}
              </Button>
            )}
            {asset.modality === 'image' && onUseFirstFrame && (
              <Button
                variant="ghost"
                className="om-button h-auto"
                data-primary
                onClick={() => { onUseFirstFrame({ reference: { assetId: asset.id, versionId: version.id }, name: asset.name }); onClose(); }}
              >
                <RemixIcon name="film-line" size={15} />
                {t('Use as first frame')}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/**
 * Modality-native "Generations" feed for Image & Video editors:
 * - Justified equal-height rows grouped by day so every aspect ratio (9:16, 1:1, 16:9, 21:9)
 *   renders intact without cropping or pillarboxes.
 * - Image: pure borderless visual wall with hover-only solid top-right actions & 1-line prompt.
 * - Video: taller justified rows with fixed 40px director's caption bar, human model labels,
 *   250ms-debounced silent hover preview, and Cinema Lightbox with unclipped native controls.
 * - True in-place unblur transition: session jobs stay on the exact `job:id` card node as they
 *   complete, transitioning from blurred placeholder to sharp finished media without layout jump.
 */
export function MediaGenerationHistory({
  modality,
  browser,
  active,
  models,
  placeholderJobs,
  emptyContent,
  blankCanvas = false,
  onOpenDetail,
  onReusePrompt,
  onUseReference,
  onUseFirstFrame,
  onCancelJob,
  onViewJob,
  onRetrySave,
  onResumeJob,
  onDismissJob,
  onDownload,
}: {
  modality: 'image' | 'video';
  browser: ReturnType<typeof useAssetBrowser>;
  active: boolean;
  models?: readonly Model[];
  placeholderJobs: GenerationJob[];
  emptyContent?: React.ReactNode;
  blankCanvas?: boolean;
  onOpenDetail: (asset: LibraryAsset) => void;
  onReusePrompt: (prompt: string) => void;
  onUseReference?: (item: { reference: AssetReference; name: string }) => void;
  onUseFirstFrame?: (item: { reference: AssetReference; name: string }) => void;
  onCancelJob: (job: GenerationJob) => void;
  onViewJob: (job: GenerationJob) => void;
  onRetrySave?: (job: GenerationJob) => Promise<void>;
  onResumeJob?: (job: GenerationJob) => Promise<void>;
  onDismissJob: (jobId: string) => void;
  onDownload?: () => void;
}) {
  const { t, locale } = useI18n();
  const { query, setQuery, sort, setSort, data, stale, loading, error, page, setPage, retry } = browser;
  const [density, setDensity] = useState<FeedDensity>('comfortable');
  const [searchOpen, setSearchOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string>();
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [revealingJobIds, setRevealingJobIds] = useState<Set<string>>(() => new Set());
  const previouslyWorkingJobs = useRef<Set<string>>(new Set());
  const hoverTimer = useRef<number | undefined>(undefined);
  const firstActiveRef = useRef<HTMLElement | null>(null);

  const assets = data?.assets ?? [];
  const visibleJobs = page === 0 ? placeholderJobs : [];
  const assetsById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);

  // Track jobs that were working/saving so we play the 600ms blur -> sharp reveal when their asset arrives.
  useEffect(() => {
    const newlyRevealed: string[] = [];
    for (const job of visibleJobs) {
      const working = job.state === 'queued' || job.state === 'running';
      const output = job.libraryAssets?.[0];
      const resolved = job.state === 'completed' && output ? assetsById.get(output.assetId) : undefined;
      if (working || (job.state === 'completed' && !resolved)) {
        previouslyWorkingJobs.current.add(job.id);
      } else if (resolved && previouslyWorkingJobs.current.has(job.id)) {
        previouslyWorkingJobs.current.delete(job.id);
        newlyRevealed.push(job.id);
      }
    }
    if (!newlyRevealed.length) return;
    setRevealingJobIds(prev => {
      const next = new Set(prev);
      for (const id of newlyRevealed) next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setRevealingJobIds(prev => {
        const next = new Set(prev);
        for (const id of newlyRevealed) next.delete(id);
        return next;
      });
    }, 650);
    return () => window.clearTimeout(timer);
  }, [visibleJobs, assetsById]);

  // Build unified stream: session jobs stay on `job:id`, deduplicating their resolved asset from the library list.
  const { groups, orderedAssets, activeCount, totalVisibleCount } = useMemo(() => {
    const claimedAssetIds = new Set<string>();
    const jobItems: StreamItem[] = visibleJobs.map(job => {
      const output = job.libraryAssets?.[0];
      const resolved = job.state === 'completed' && output ? assetsById.get(output.assetId) : undefined;
      if (resolved) claimedAssetIds.add(resolved.id);
      return { kind: 'job', key: `job:${job.id}`, job, asset: resolved, timestamp: job.createdAt };
    });

    const assetItems: StreamItem[] = assets
      .filter(asset => !claimedAssetIds.has(asset.id))
      .map(asset => ({
        kind: 'asset',
        key: `asset:${asset.id}`,
        asset,
        timestamp: asset.updatedAt || asset.createdAt,
      }));

    // Keep lightbox navigation order matching visual order.
    const ordered: LibraryAsset[] = [];
    for (const item of jobItems) if (item.kind === 'job' && item.asset) ordered.push(item.asset);
    for (const item of assetItems) if (item.kind === 'asset') ordered.push(item.asset);

    // Group by Day: active/session items lead the first group (or today's group); finished assets group by dayKey.
    const dayMap = new Map<string, StreamItem[]>();
    const pushToDay = (key: string, item: StreamItem) => {
      const list = dayMap.get(key);
      if (list) list.push(item);
      else dayMap.set(key, [item]);
    };

    const today = dayKey(Date.now());
    for (const item of jobItems) pushToDay(today, item);
    for (const item of assetItems) pushToDay(dayKey(item.timestamp), item);

    const grouped = [...dayMap.entries()].map(([key, items]) => ({ key, items }));
    const running = visibleJobs.filter(job => job.state === 'queued' || job.state === 'running').length;
    const totalCount = (data?.total ?? 0) + visibleJobs.filter(job => {
      const out = job.libraryAssets?.[0];
      return !(job.state === 'completed' && out && assetsById.has(out.assetId));
    }).length;

    return { groups: grouped, orderedAssets: ordered, activeCount: running, totalVisibleCount: totalCount };
  }, [visibleJobs, assets, assetsById, data?.total]);

  const hasJobs = visibleJobs.length > 0;
  const hasItems = groups.some(group => group.items.length > 0);
  const hasFilters = Boolean(query);
  const canHoverPreview = active && !loading;
  const renderedCount = groups.reduce((sum, g) => sum + g.items.length, 0);
  const isFew = renderedCount > 0 && renderedCount <= 2;

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  useEffect(() => {
    if (!canHoverPreview) { setPreviewId(undefined); return; }
    if (!previewId) return;
    const stop = () => setPreviewId(undefined);
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('scroll', stop, true);
    window.addEventListener('blur', stop);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('scroll', stop, true);
      window.removeEventListener('blur', stop);
    };
  }, [canHoverPreview, previewId]);

  const scheduleHover = (asset: LibraryAsset) => {
    window.clearTimeout(hoverTimer.current);
    if (!canHoverPreview || asset.modality !== 'video' || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    hoverTimer.current = window.setTimeout(() => setPreviewId(asset.id), 250);
  };

  const cancelHover = () => {
    window.clearTimeout(hoverTimer.current);
    setPreviewId(undefined);
  };

  const scrollToActive = () => {
    firstActiveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const renderAssetCard = (asset: LibraryAsset, cardKey: string, revealing = false) => {
    const version = assetVersion(asset);
    if (!version) return null;
    const src = assetMediaUrl(asset.id, version.id);
    const promptText = version.prompt?.trim();
    const transparent = asset.modality === 'image' && version.parameters?.background === 'transparent';
    const ar = resolveLayoutAspect({
      width: version.width,
      height: version.height,
      parameters: version.parameters,
      modality: asset.modality,
    });
    const modelName = modelDisplayLabel(models, version.model);
    const ratioTag = formatAspectTag(version.width, version.height, version.parameters);
    const durTag = formatDurationShort(version.duration);
    const resTag = formatResolutionTag(version.width, version.height);
    const versionNum = asset.versions.findIndex(item => item.id === asset.currentVersionId) + 1;
    const metaParts = [
      modelName || t(version.source === 'upload' ? 'Local upload' : 'AI generated'),
      ratioTag,
      durTag,
      resTag,
      asset.versions.length > 1 ? `V${versionNum}` : undefined,
    ].filter(Boolean);

    const cardStyle = { '--ar': ar } as CSSProperties;

    return (
      <article
        key={cardKey}
        className="om-gen-card"
        style={cardStyle}
        data-modality={asset.modality}
        data-transparent={transparent || undefined}
        data-revealing={revealing || undefined}
      >
        <div
          className="om-gen-media"
          onPointerEnter={event => { if (event.pointerType !== 'touch' && asset.modality === 'video') scheduleHover(asset); }}
          onPointerLeave={cancelHover}
          onPointerCancel={cancelHover}
        >
          <Button
            variant="plain"
            className="om-gen-open"
            aria-label={asset.name}
            onClick={() => setLightboxAssetId(asset.id)}
          >
            {asset.modality === 'video' ? (
              <>
                <VideoFrameThumbnail src={src} fallbackLabel={t('Preview unavailable')} />
                {canHoverPreview && previewId === asset.id && <AssetHoverVideo src={src} />}
                <MediaDurationBadge duration={version.duration} className="absolute top-2 left-2" />
              </>
            ) : (
              <img
                src={src}
                alt={asset.name}
                width={version.width}
                height={version.height}
                loading="lazy"
                decoding="async"
                className={transparent ? 'motion-color-checkerboard' : undefined}
              />
            )}
          </Button>

          <div className="om-gen-card-top">
            {asset.modality === 'image' && (
              <Tooltip label={t('Zoom preview')} wrap>
                <Button variant="plain" className="om-gen-icon-pill" aria-label={t('Zoom preview')} onClick={() => setLightboxAssetId(asset.id)}>
                  <RemixIcon name="search-line" size={14} />
                </Button>
              </Tooltip>
            )}
            <Tooltip label={t('Download')} wrap>
              <a className="om-gen-icon-pill" href={src} download={version.filename || asset.name} aria-label={t('Download')} onClick={() => onDownload?.()}>
                <RemixIcon name="download-2-line" size={14} />
              </a>
            </Tooltip>
            <Menu
              modal={false}
              align="end"
              aria-label={t('More actions')}
              trigger={
                <Button variant="plain" className="om-gen-icon-pill" aria-label={t('More actions')}>
                  <RemixIcon name="more-fill" size={14} />
                </Button>
              }
            >
              {promptText && (
                <MenuItem icon={<RemixIcon name="refresh-line" size={14} />} onClick={() => onReusePrompt(promptText)}>
                  {t('Reuse prompt')}
                </MenuItem>
              )}
              {asset.modality === 'image' && onUseReference && (
                <MenuItem
                  icon={<RemixIcon name="image-line" size={14} />}
                  onClick={() => onUseReference({ reference: { assetId: asset.id, versionId: version.id }, name: asset.name })}
                >
                  {t('Use as reference')}
                </MenuItem>
              )}
              {asset.modality === 'image' && onUseFirstFrame && (
                <MenuItem
                  icon={<RemixIcon name="film-line" size={14} />}
                  onClick={() => onUseFirstFrame({ reference: { assetId: asset.id, versionId: version.id }, name: asset.name })}
                >
                  {t('Use as first frame')}
                </MenuItem>
              )}
              <MenuItem icon={<RemixIcon name="history-line" size={14} />} onClick={() => onOpenDetail(asset)}>
                {t('Asset details')}
              </MenuItem>
            </Menu>
          </div>

          {asset.modality === 'image' && (
            <div className="om-gen-image-veil">
              <Tooltip label={promptText || asset.name} wrap>
                <span className="om-gen-image-prompt">{promptText || asset.name}</span>
              </Tooltip>
            </div>
          )}
        </div>

        {asset.modality === 'video' && (
          <div className="om-gen-caption">
            <Tooltip label={promptText || asset.name} wrap>
              <strong>{promptText || asset.name}</strong>
            </Tooltip>
            <span className="om-muted">{metaParts.join(' · ')}</span>
          </div>
        )}
      </article>
    );
  };

  let assignedFirstActive = false;

  const renderJobCard = (item: Extract<StreamItem, { kind: 'job' }>) => {
    const { job, asset, key } = item;
    if (asset) {
      return renderAssetCard(asset, key, revealingJobIds.has(job.id));
    }
    const refAsset = job.library?.references?.[0] ? assetsById.get(job.library.references[0].assetId) : undefined;
    const refVersion = refAsset ? assetVersion(refAsset, job.library?.references?.[0].versionId) : undefined;
    const fallbackRatio = refVersion?.width && refVersion?.height ? refVersion.width / refVersion.height : undefined;
    const ar = resolveLayoutAspect({
      parameters: job.parameters,
      fallbackRatio,
      modality: job.modality,
    });
    const modelName = modelDisplayLabel(models, job.model.id, job.model.label);
    const ratioTag = formatAspectTag(undefined, undefined, job.parameters);
    const metaParts = [modelName || job.model.label, ratioTag].filter(Boolean);
    const isWorking = job.state === 'queued' || job.state === 'running';
    const captureRef = isWorking && !assignedFirstActive;
    if (captureRef) assignedFirstActive = true;

    return (
      <article
        key={key}
        ref={captureRef ? node => { firstActiveRef.current = node; } : undefined}
        className="om-gen-card om-gen-card-pending"
        style={{ '--ar': ar } as CSSProperties}
        data-modality={job.modality}
        data-state={job.state}
      >
        <div className="om-gen-media">
          <AssetGenerationPlaceholder
            job={job}
            variant="overlay"
            active={active}
            models={models}
            onCancel={onCancelJob}
            onView={onViewJob}
            onRetrySave={onRetrySave}
            onResume={onResumeJob}
            onReusePrompt={onReusePrompt}
            onDismiss={onDismissJob}
          />
        </div>
        {modality === 'video' && (
          <div className="om-gen-caption">
            <Tooltip label={job.prompt || modelName || job.model.label} wrap>
              <strong>{job.prompt || modelName || job.model.label}</strong>
            </Tooltip>
            <span className="om-muted">{metaParts.join(' · ')}</span>
          </div>
        )}
      </article>
    );
  };

  return (
    <section
      className="om-gen-history"
      data-modality={modality}
      data-density={density}
      data-count={isFew ? 'few' : undefined}
      aria-label={t('Generations')}
    >
      {lightboxAssetId && (
        <GenerationLightbox
          assets={orderedAssets}
          activeId={lightboxAssetId}
          models={models}
          onSelectId={setLightboxAssetId}
          onClose={() => setLightboxAssetId(null)}
          onReusePrompt={onReusePrompt}
          onUseReference={onUseReference}
          onUseFirstFrame={onUseFirstFrame}
          onOpenDetail={onOpenDetail}
          onDownload={onDownload}
        />
      )}

      {!blankCanvas && (
        <header className="om-gen-header">
          <div className="om-gen-header-meta">
            <span className="om-gen-count">{t('{count} assets', { count: totalVisibleCount })}</span>
            {activeCount > 0 && (
              <Button variant="plain" className="om-gen-active-pill" onClick={scrollToActive}>
                <span className="om-gen-active-dot" aria-hidden="true" />
                {t('{count} generating', { count: activeCount })}
              </Button>
            )}
            {hasFilters && (
              <Button variant="plain" className="om-nav-item" onClick={() => { setQuery(''); setSearchOpen(false); }}>
                {t('Clear filters')}
              </Button>
            )}
          </div>

          <div className="om-gen-header-tools">
            {searchOpen || query ? (
              <GallerySearchField
                label={t('Search assets...')}
                value={query}
                onChange={setQuery}
                className="om-gen-search-inline"
              />
            ) : (
              <Tooltip label={t('Search assets')} wrap>
                <IconButton
                  variant="plain"
                  className="om-nav-item om-gen-tool-icon"
                  aria-label={t('Search assets')}
                  icon={<RemixIcon name="search-line" size={15} />}
                  onClick={() => setSearchOpen(true)}
                />
              </Tooltip>
            )}

            <Menu
              modal={false}
              align="end"
              aria-label={t('Sort')}
              trigger={
                <Button variant="plain" className="om-nav-item om-gen-filter-trigger" aria-label={t('Sort')}>
                  <RemixIcon name="equalizer-line" size={14} />
                  <span>{t(sort === 'newest' ? 'Newest first' : sort === 'oldest' ? 'Oldest first' : 'Name')}</span>
                  <RemixIcon name="arrow-down-s-line" size={14} />
                </Button>
              }
            >
              <MenuRadioGroup value={sort} onValueChange={value => setSort(String(value))}>
                <MenuRadioItem value="newest" closeOnClick>{t('Newest first')}</MenuRadioItem>
                <MenuRadioItem value="oldest" closeOnClick>{t('Oldest first')}</MenuRadioItem>
                <MenuRadioItem value="name" closeOnClick>{t('Name')}</MenuRadioItem>
              </MenuRadioGroup>
            </Menu>

            <div className="om-choice-tabs om-gen-view-scale" role="group" aria-label={t('Preview size')}>
              {([
                ['compact', 'S'],
                ['comfortable', 'M'],
                ['large', 'L'],
              ] as const).map(([value, label]) => (
                <Button
                  key={value}
                  variant="plain"
                  className="om-nav-item"
                  aria-pressed={density === value}
                  aria-label={t(value === 'compact' ? 'Compact grid' : value === 'comfortable' ? 'Medium grid' : 'Large preview')}
                  onClick={() => setDensity(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
        </header>
      )}

      <div className="om-asset-results" aria-busy={loading} inert={stale && !error}>
        {error && !hasJobs ? (
          <div className="om-empty">
            <RemixIcon name="error-warning-line" size={32} />
            <p>{t('Could not load assets')}</p>
            <Button variant="ghost" className="om-button h-auto" onClick={retry}>{t('Retry')}</Button>
          </div>
        ) : !data && !hasJobs ? (
          <div className="om-gen-flow">
            {SKELETON_ASPECTS.slice(0, modality === 'video' ? 4 : 6).map((ar, index) => (
              <div key={index} className="om-gen-card" style={{ '--ar': ar } as CSSProperties}>
                <Skeleton className="om-gen-media om-gen-skeleton" />
              </div>
            ))}
          </div>
        ) : !hasItems && emptyContent && !hasFilters ? (
          emptyContent
        ) : !hasItems ? (
          <div className="om-empty om-asset-empty">
            <RemixIcon name={modality === 'video' ? 'film-line' : 'image-line'} size={40} />
            <h2 className="om-subtitle">{t(hasFilters ? 'No matching assets' : 'Your next idea starts here')}</h2>
            <p className="om-muted">{t('Upload your own media or create an image, video or audio asset.')}</p>
            {hasFilters && (
              <Button variant="ghost" className="om-button h-auto" onClick={() => { setQuery(''); }}>
                {t('Clear filters')}
              </Button>
            )}
          </div>
        ) : (
          <div className="om-gen-stream">
            {groups.map(group => (
              <section key={group.key} className="om-gen-day-group" aria-label={formatDayHeading(group.key, t, locale)}>
                {(groups.length > 1 || assets.length > 0) && (
                  <h3 className="om-gen-day-heading om-eyebrow">{formatDayHeading(group.key, t, locale)}</h3>
                )}
                <div className="om-gen-flow">
                  {group.items.map(item => item.kind === 'job'
                    ? renderJobCard(item)
                    : renderAssetCard(item.asset, item.key))}
                </div>
              </section>
            ))}

            {data && (page > 0 || data.nextOffset !== null) && (
              <div className="om-asset-pagination">
                <Button variant="ghost" className="om-button h-auto" disabled={!page || loading} onClick={() => setPage(v => v - 1)}>{t('Previous')}</Button>
                <span className="om-muted">{page + 1}</span>
                <Button variant="ghost" className="om-button h-auto" disabled={data.nextOffset === null || loading} onClick={() => setPage(v => v + 1)}>{t('Next')}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
