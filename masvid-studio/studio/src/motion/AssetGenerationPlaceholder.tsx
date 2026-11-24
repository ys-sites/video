import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { assetMediaUrl } from '../../../shared/asset-library';
import { resumableJob, type GenerationJob, type Model } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { Tooltip } from '../components/ui/Tooltip';
import { WorkingIndicator } from './AssetCreationVisuals';
import { formatElapsed, modelDisplayLabel } from './generationLabels';

function formatJobError(error: string | undefined, t: (key: string) => string): string | undefined {
  if (!error) return undefined;
  if (error.startsWith('SAVE_NOT_AVAILABLE:')) return t('The retained files are missing, changed or unreadable. Saving cannot be retried. No new generation was requested.');
  if (error.startsWith('CODEX_IMAGE_PROXY_AUTH_REQUIRED:')) return t('The local Codex proxy requires its own authentication. In Codex settings, select the configured proxy provider and check its endpoint and credentials. Signing in again alone will not fix a missing proxy key. Your original asset is unchanged; no automatic retry was made.');
  if (error.startsWith('CODEX_IMAGE_AUTH_REQUIRED:')) return t('The configured Codex image service rejected authorization. Check the active provider, endpoint and authentication in Codex settings; sign in again only if your account session has expired. Your original asset is unchanged; no automatic retry was made.');
  if (error.startsWith('ASSET_MEDIA_RUNTIME_NOT_READY:')) return t('Local media components are unavailable. Prepare or repair this installation, then submit again. No model request was made; your original asset is unchanged.');
  return t(error);
}

function useElapsedLabel(startedAt: number, active: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => {
      if (!document.hidden) setNow(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return formatElapsed(Math.max(0, now - startedAt));
}

/**
 * Single-focus blurred generation placeholder:
 * - `variant="overlay"`: fills a `.om-gen-media` slot inside MediaGenerationHistory so completed
 *   outputs unblur in place on the exact same DOM card with zero layout jump.
 * - `variant="tile"`: standalone card for the global `/assets` AssetBrowser leadingTiles grid.
 */
export function AssetGenerationPlaceholder({
  job,
  variant = 'tile',
  active = true,
  models,
  onCancel,
  onView,
  onRetrySave,
  onResume,
  onReusePrompt,
  onDismiss,
}: {
  job: GenerationJob;
  variant?: 'overlay' | 'tile';
  active?: boolean;
  models?: readonly Model[];
  onCancel: (job: GenerationJob) => void;
  onView: (job: GenerationJob) => void;
  onRetrySave?: (job: GenerationJob) => Promise<void>;
  onResume?: (job: GenerationJob) => Promise<void>;
  onReusePrompt?: (prompt: string) => void;
  onDismiss?: (jobId: string) => void;
}) {
  const { t } = useI18n();
  const working = job.state === 'queued' || job.state === 'running';
  const done = job.state === 'completed';
  const saving = job.phase === 'downloading' || job.phase === 'saving';
  const resumable = resumableJob(job);
  const accountImage = job.model.provider === 'account' && job.modality === 'image';
  const [retrying, setRetrying] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);
  const resuming = useRef(false);

  const elapsed = useElapsedLabel(job.startedAt ?? job.createdAt, active && working);

  const reference = job.library?.references?.[0];
  const result = job.libraryAssets?.[0];
  const backdropUrl = !backdropFailed
    ? (done && result && job.modality === 'image'
      ? assetMediaUrl(result.assetId, result.versionId)
      : reference
        ? assetMediaUrl(reference.assetId, reference.versionId)
        : undefined)
    : undefined;

  const statusLine = saving && working
    ? t('Saving to assets')
    : working && job.phase === 'reconnecting'
      ? t('Reconnecting…')
      : job.state === 'queued'
        ? t('Queued')
        : working
          ? `${t('Generating')} · ${elapsed}`
          : done
            ? t('Saving to assets')
            : job.savePending && job.state === 'failed'
              ? t('Saving needs attention')
              : job.state === 'failed'
                ? t('Generation failed')
                : t('Generation stopped');

  const errorText = formatJobError(job.error, t);
  const modelName = modelDisplayLabel(models, job.model.id, job.model.label);

  const retrySave = async () => {
    if (!onRetrySave || retrying) return;
    setRetrying(true);
    try { await onRetrySave(job); } finally { setRetrying(false); }
  };
  const resume = async () => {
    if (!onResume || resuming.current) return;
    resuming.current = true;
    setRetrying(true);
    try { await onResume(job); } finally { resuming.current = false; setRetrying(false); }
  };

  // 3-segment 2px progress bar: 0 = queued, 1 = generating, 2 = saving
  const activeSegment = done ? 3 : saving ? 2 : job.state === 'running' ? 1 : 0;

  const stage = (
    <div
      className="om-placeholder-stage"
      data-state={job.state}
      data-phase={job.phase}
      data-variant={variant}
      aria-label={t('Generation activity')}
      aria-busy={working}
    >
      {backdropUrl ? (
        <img
          className="om-placeholder-backdrop"
          src={backdropUrl}
          alt=""
          aria-hidden="true"
          onError={() => setBackdropFailed(true)}
        />
      ) : (
        <div className="om-placeholder-aura" aria-hidden="true" />
      )}
      <div className="om-placeholder-scrim" aria-hidden="true" />

      <div className="om-placeholder-overlay">
        <div className="om-placeholder-corner">
          {working ? (
            <Tooltip label={t('Cancel')} wrap>
              <Button
                variant="plain"
                className="om-gen-icon-pill om-placeholder-close"
                aria-label={t('Cancel')}
                onClick={() => onCancel(job)}
              >
                <RemixIcon name="close-line" size={14} />
              </Button>
            </Tooltip>
          ) : onDismiss ? (
            <Tooltip label={t('Dismiss')} wrap>
              <Button
                variant="plain"
                className="om-gen-icon-pill om-placeholder-close"
                data-pinned="true"
                aria-label={t('Dismiss')}
                onClick={() => onDismiss(job.id)}
              >
                <RemixIcon name="close-line" size={14} />
              </Button>
            </Tooltip>
          ) : null}
        </div>

        <div className="om-placeholder-center">
          {working || done ? (
            <WorkingIndicator />
          ) : (
            <RemixIcon
              name={job.state === 'failed' ? 'error-warning-line' : 'pause-line'}
              size={22}
            />
          )}
          <span className="om-placeholder-status-line" role="status">{statusLine}</span>
          {accountImage && job.download && !done && (
            <span className="om-placeholder-download" role="status">
              {(job.download.receivedBytes / 1024 / 1024).toFixed(1)} / {(job.download.totalBytes / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
          {!working && !done && errorText && (
            <Tooltip label={errorText} wrap>
              <span className="om-placeholder-error">{errorText}</span>
            </Tooltip>
          )}
          {!working && !done && (
            <div className="om-placeholder-actions">
              {resumable && onResume && (
                <Button variant="plain" className="om-gen-action-pill" disabled={retrying} onClick={() => void resume()}>
                  {t(accountImage ? (retrying ? 'Continuing download…' : 'Continue download') : (retrying ? 'Checking original task…' : 'Check original task'))}
                </Button>
              )}
              {job.savePending && onRetrySave && (
                <Button variant="plain" className="om-gen-action-pill" disabled={retrying} onClick={() => void retrySave()}>
                  {t(retrying ? 'Retrying save…' : 'Retry saving')}
                </Button>
              )}
              {job.prompt && onReusePrompt && (
                <Button variant="plain" className="om-gen-action-pill" onClick={() => onReusePrompt(job.prompt)}>
                  <RemixIcon name="refresh-line" size={12} />{t('Reuse prompt')}
                </Button>
              )}
              {result && (
                <Button variant="plain" className="om-gen-action-pill" onClick={() => onView(job)}>
                  {t('View asset')}<RemixIcon name="arrow-right-up-line" size={12} />
                </Button>
              )}
            </div>
          )}
        </div>

        {(working || done) && (
          <div className="om-placeholder-progress" role="progressbar" aria-valuemin={0} aria-valuemax={3} aria-valuenow={activeSegment} aria-label={t('Generation progress')}>
            {[0, 1, 2].map(segment => (
              <span
                key={segment}
                className="om-placeholder-segment"
                data-complete={segment < activeSegment || undefined}
                data-current={working && segment === activeSegment || undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (variant === 'overlay') {
    return (
      <div className="om-placeholder-tile om-placeholder-overlay-host" data-state={job.state} data-tone={job.modality}>
        {stage}
      </div>
    );
  }

  return (
    <article
      className="om-asset-tile om-card om-placeholder-tile om-creation-job"
      data-tone={job.modality}
      data-state={job.state}
      data-aspect={job.modality === 'video' ? 'wide' : 'card'}
    >
      <div className="om-asset-preview">{stage}</div>
      <div className="om-asset-tile-caption">
        <Tooltip label={job.prompt || modelName || job.model.label} wrap>
          <strong>{job.prompt || modelName || job.model.label}</strong>
        </Tooltip>
        <span className="om-muted">{modelName || job.model.label}</span>
      </div>
    </article>
  );
}
