import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { assetMediaUrl } from '../../../shared/asset-library';
import { designRoutes } from '../../../shared/design-project';
import type { PoolItem, ScenarioRun } from '../../../shared/scenario-runs';
import { Skeleton } from '../components/ui/Skeleton';
import { VideoFrameThumbnail } from '../components/ui/VideoFrameThumbnail';
import { ScaledPreviewThumb } from '../design/ScaledPreviewThumb';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetAudioPreview } from '../motion/AssetAudioPreview';
import { AssetHoverVideo } from '../motion/AssetHoverVideo';

export function resolvePoolTextContent(item: PoolItem, run?: ScenarioRun | null): string {
  if (item.ref.type !== 'text' || !run) return item.label;
  const { stepId, iterationId } = item.ref;
  const stepState = run.steps[stepId];
  const iteration = stepState?.iterations.find(it => it.id === iterationId);
  if (!iteration) return item.label;

  for (const output of iteration.outputs) {
    if (output.type === 'script' && output.text.trim()) {
      return output.text.trim();
    }
    if (output.type === 'social' && output.posts.length > 0) {
      return output.posts
        .map(post => `[${post.platform}] ${post.title ? `${post.title}\n` : ''}${post.text}`)
        .join('\n\n');
    }
    if (output.type === 'brief') {
      const pairs = Object.entries(output.values)
        .map(([key, value]) => {
          const text = Array.isArray(value) ? value.join(', ') : value;
          return text ? `${key}: ${text}` : '';
        })
        .filter(Boolean);
      if (pairs.length > 0) return pairs.join('\n');
    }
  }
  return item.label;
}

export function designPreviewUrlForPoolItem(item: PoolItem): string | null {
  if (item.ref.type !== 'design') return null;
  const base = designRoutes.raw(item.ref.projectId, 'index.html');
  if (item.ref.versionId) {
    return `${base}?version=${encodeURIComponent(item.ref.versionId)}`;
  }
  return `${base}?v=${encodeURIComponent(item.ref.revision)}`;
}

export type PoolThumbProps = {
  item: PoolItem;
  run?: ScenarioRun | null;
  size?: 'sm' | 'md' | 'lg';
  hoverPreview?: boolean;
  className?: string;
};

export function PoolThumb({
  item,
  run,
  size = 'md',
  hoverPreview = false,
  className = '',
}: PoolThumbProps) {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState(false);

  const src = useMemo(() => {
    if (item.ref.type === 'asset') {
      return assetMediaUrl(item.ref.assetId, item.ref.versionId);
    }
    return designPreviewUrlForPoolItem(item) ?? '';
  }, [item]);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (item.kind === 'image' && item.ref.type === 'asset') {
    return (
      <div className={`om-scenario-thumb om-scenario-thumb--${size} ${className}`} data-kind="image">
        {failed ? (
          <div className="om-scenario-thumb-fallback">
            <RemixIcon name="image-line" size={size === 'sm' ? 14 : 20} />
          </div>
        ) : (
          <>
            {!loaded && <Skeleton className="om-scenario-thumb-skeleton" />}
            <img
              src={src}
              alt={item.label}
              loading="lazy"
              decoding="async"
              draggable={false}
              onLoad={() => setLoaded(true)}
              onError={() => setFailed(true)}
            />
          </>
        )}
      </div>
    );
  }

  if (item.kind === 'video' && item.ref.type === 'asset') {
    return (
      <div
        className={`om-scenario-thumb om-scenario-thumb--${size} ${className}`}
        data-kind="video"
        onPointerEnter={event => {
          if (hoverPreview && event.pointerType !== 'touch' && !prefersReducedMotion) {
            setHovered(true);
          }
        }}
        onPointerLeave={() => setHovered(false)}
      >
        <VideoFrameThumbnail src={src} fallbackLabel={t('Video')} />
        {hoverPreview && hovered && !prefersReducedMotion && <AssetHoverVideo src={src} />}
      </div>
    );
  }

  if (item.kind === 'audio' && item.ref.type === 'asset') {
    if (size === 'sm') {
      return (
        <div className={`om-scenario-thumb om-scenario-thumb--sm ${className}`} data-kind="audio">
          <div className="om-scenario-thumb-fallback">
            <RemixIcon name="music-2-line" size={14} />
          </div>
        </div>
      );
    }
    return (
      <div
        className={`om-scenario-thumb om-scenario-thumb--${size} om-scenario-thumb--audio ${className}`}
        data-kind="audio"
        onClick={event => event.stopPropagation()}
      >
        {failed ? (
          <div className="om-scenario-thumb-fallback">
            <RemixIcon name="error-warning-line" size={18} />
            <span>{t('Audio unavailable')}</span>
            <Button variant="ghost" size="sm" onClick={() => setFailed(false)}>
              {t('Retry')}
            </Button>
          </div>
        ) : (
          <AssetAudioPreview src={src} onError={() => setFailed(true)} />
        )}
      </div>
    );
  }

  if (item.kind === 'page' && item.ref.type === 'design') {
    if (size === 'sm') {
      return (
        <div className={`om-scenario-thumb om-scenario-thumb--sm ${className}`} data-kind="page">
          <div className="om-scenario-thumb-fallback">
            <RemixIcon name="layout-line" size={14} />
          </div>
        </div>
      );
    }
    return (
      <div className={`om-scenario-thumb om-scenario-thumb--${size} ${className}`} data-kind="page">
        <ScaledPreviewThumb src={src} title={item.label} />
      </div>
    );
  }

  if (item.kind === 'motion') {
    return (
      <div className={`om-scenario-thumb om-scenario-thumb--${size} om-scenario-thumb--motion ${className}`} data-kind="motion">
        <RemixIcon name="film-line" size={size === 'sm' ? 14 : 24} />
        {size !== 'sm' && <span className="om-scenario-thumb-caption">{item.label}</span>}
      </div>
    );
  }

  const textBody = resolvePoolTextContent(item, run);
  const snippet = textBody.length > 120 ? `${textBody.slice(0, 120)}…` : textBody;

  return (
    <div className={`om-scenario-thumb om-scenario-thumb--${size} om-scenario-thumb--text ${className}`} data-kind="text">
      {size === 'sm' ? (
        <RemixIcon name="file-text-line" size={14} />
      ) : (
        <p className="om-scenario-thumb-snippet">{snippet}</p>
      )}
    </div>
  );
}

export type PoolItemPreviewDialogProps = {
  item: PoolItem | null;
  run?: ScenarioRun | null;
  canUseInCurrentStep: boolean;
  canDownloadMotion?: boolean;
  onClose(): void;
  onUseInCurrentStep?(item: PoolItem): void;
  onDownload?(item: PoolItem): void;
  onOpen?(item: PoolItem): void;
  onCopyReference?(item: PoolItem): void;
};

const POOL_KIND_LABELS: Record<PoolItem['kind'], string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  page: 'Page',
  motion: 'Motion',
  text: 'Text',
};

export function PoolItemPreviewDialog({
  item,
  run,
  canUseInCurrentStep,
  canDownloadMotion = false,
  onClose,
  onUseInCurrentStep,
  onDownload,
  onOpen,
  onCopyReference,
}: PoolItemPreviewDialogProps) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setFailed(false);
  }, [item?.id]);

  // Pause video automatically when offscreen or unmounted.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !item || item.kind !== 'video') return;
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => !entry.isIntersecting)) {
          video.pause();
        }
      });
      observer.observe(video);
    }
    return () => {
      observer?.disconnect();
      video.pause();
    };
  }, [item]);

  if (!item) return null;

  const assetUrl = item.ref.type === 'asset' ? assetMediaUrl(item.ref.assetId, item.ref.versionId) : null;
  const pageUrl = designPreviewUrlForPoolItem(item);
  const fullText = item.ref.type === 'text' ? resolvePoolTextContent(item, run) : null;
  const canOpen = item.ref.type === 'asset' || item.ref.type === 'design' || item.ref.type === 'motion';
  const canDownload =
    item.ref.type === 'asset' ||
    item.ref.type === 'design' ||
    item.ref.type === 'text' ||
    (item.ref.type === 'motion' && canDownloadMotion);

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
        <Dialog.Popup
          data-feedback-modal=""
          className="om-dialog om-scenario-preview-dialog"
          onKeyDown={event => event.stopPropagation()}
        >
          <header className="om-scenario-preview-header">
            <div className="om-scenario-preview-heading">
              <Dialog.Title className="om-subtitle">{item.label}</Dialog.Title>
              <span className="om-badge">{t(POOL_KIND_LABELS[item.kind])}</span>
            </div>
            <IconButton
              variant="ghost"
              size="sm"
              aria-label={t('Close preview')}
              onClick={onClose}
              icon={<RemixIcon name="close-line" size={18} />}
            />
          </header>

          <div className="om-scenario-preview-stage">
            {failed ? (
              <div className="om-scenario-preview-error" role="alert">
                <RemixIcon name="error-warning-line" size={24} />
                <p>{t('Preview unavailable')}</p>
                <Button variant="secondary" size="sm" onClick={() => setFailed(false)}>
                  {t('Retry')}
                </Button>
              </div>
            ) : item.kind === 'image' && assetUrl ? (
              <img
                className="om-scenario-preview-media"
                src={assetUrl}
                alt={item.label}
                onError={() => setFailed(true)}
              />
            ) : item.kind === 'video' && assetUrl ? (
              <video
                ref={videoRef}
                className="om-scenario-preview-media"
                src={assetUrl}
                controls
                playsInline
                preload="metadata"
                onError={() => setFailed(true)}
              />
            ) : item.kind === 'audio' && assetUrl ? (
              <div className="om-scenario-preview-audio">
                <AssetAudioPreview src={assetUrl} onError={() => setFailed(true)} />
              </div>
            ) : item.kind === 'page' && pageUrl ? (
              <iframe
                className="om-scenario-preview-iframe"
                sandbox="allow-scripts"
                src={pageUrl}
                title={item.label}
              />
            ) : item.kind === 'motion' && item.ref.type === 'motion' ? (
              <div className="om-scenario-preview-motion">
                <RemixIcon name="film-line" size={36} />
                <strong>{item.label}</strong>
                <span className="om-muted">{item.ref.projectId}</span>
              </div>
            ) : (
              <pre className="om-scenario-preview-text">{fullText ?? item.label}</pre>
            )}
          </div>

          <footer className="om-scenario-preview-footer">
            {canUseInCurrentStep && onUseInCurrentStep && (
              <Button
                variant="primary"
                size="sm"
                icon={<RemixIcon name="check-line" size={14} />}
                onClick={() => {
                  onUseInCurrentStep(item);
                  onClose();
                }}
              >
                {t('Use in current step')}
              </Button>
            )}
            {canDownload && onDownload && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="download-2-line" size={14} />}
                onClick={() => onDownload(item)}
              >
                {t('Download')}
              </Button>
            )}
            {canOpen && onOpen && (
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="external-link-line" size={14} />}
                onClick={() => {
                  onOpen(item);
                  onClose();
                }}
              >
                {t('Open')}
              </Button>
            )}
            {onCopyReference && (
              <Button
                variant="ghost"
                size="sm"
                icon={<RemixIcon name="file-copy-line" size={14} />}
                onClick={() => onCopyReference(item)}
              >
                {t('Copy reference')}
              </Button>
            )}
          </footer>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
