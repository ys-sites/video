import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { assetMediaUrl, assetVersion, type AssetVersion, type LibraryAsset } from '../../../shared/asset-library';
import { classifyAudioKind, type AudioKind } from '../../../shared/audio-kind';
import { resumableJob, type GenerationJob, type Model } from '../../../shared/gateway';
import { generationOptions } from '../../../shared/generation-options';
import { formatDuration } from '../components/sidebar/assetHelpers';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { Select } from '../components/ui/Select';
import { Skeleton } from '../components/ui/Skeleton';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { formatTime } from '../player/lib/time';
import type { useAssetBrowser } from './AssetBrowser';
import type { AssetDraft } from './AssetComposer';
import type { StudioCreation } from './CreativeWorkspace';
import { emptyParameters, type ParameterDraft } from './GenerationParameters';
import { ResizablePane } from './ResizablePane';
import { SoundComposer, resolveSoundModels } from './SoundComposer';
import { SoundPlayerDock, useSoundPlayer, type SoundPlayableTrack } from './SoundPlayerDock';
import {
  SOUND_MUSIC_RECIPES,
  SOUND_SFX_STARTERS,
  SOUND_SPEECH_SCRIPTS,
  deterministicWaveform,
  estimateSpeechSeconds,
  resampleWaveform,
  resolveAudioModelLabel,
  resolveSavedVoiceName,
  type SoundSfxStarter,
} from './soundPresets';
import {
  SOUND_TABS,
  classifyAudioTrackTab,
  findSoundTab,
  isSfxModel,
  type SoundLiveTabId,
  type SoundTabDefinition,
  type SoundTabId,
} from './soundTabs';
import { ComingSoonGuide } from './ComingSoonGuide';
import { dayKey } from './generationLabels';
import { GeneratingWaveform, InteractiveWaveform } from './SoundWaveforms';
import { useAudioWaveforms } from './useAudioWaveforms';
import { useVoiceAudition } from './voicePreviews';
import './soundStudio.css';

type AudioTypeFilter = 'all' | AudioKind;

const AUDIO_KIND_ICON: Record<AudioKind, string> = {
  music: 'music-2-line',
  sfx: 'flashlight-line',
  speech: 'voiceprint-line',
  upload: 'upload-2-line',
};

type StreamEntry =
  | { kind: 'job'; id: string; createdAt: number; job: GenerationJob }
  | { kind: 'track'; id: string; createdAt: number; track: SoundPlayableTrack };

function formatTrackDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--';
  return formatDuration(seconds) || formatTime(seconds);
}

function buildAssetTrack(
  asset: LibraryAsset,
  version: AssetVersion,
  studio: StudioCreation,
  t: (s: string) => string,
): SoundPlayableTrack {
  const models = studio.catalog.catalog?.models;
  const kind = classifyAudioTrackTab(version.model, models, version.source, version.audioKind);
  const modelLabel = resolveAudioModelLabel(version.model, models);
  const voiceName = kind === 'speech'
    ? resolveSavedVoiceName(version.parameters?.voice, version.model, models, true)
    : undefined;
  const subtitleParts = [
    voiceName,
    modelLabel ?? (version.source === 'upload' ? t('Local upload') : ''),
  ].filter(Boolean);
  return {
    id: `asset:${asset.id}/${version.id}`,
    kind: 'asset',
    title: asset.name,
    subtitle: subtitleParts.join(' · '),
    src: assetMediaUrl(asset.id, version.id),
    waveform: version.waveform?.length
      ? resampleWaveform(version.waveform, 128)
      : deterministicWaveform(`${asset.id}:${version.id}:${version.sha256}`, 128),
    durationHint: version.duration,
    prompt: version.prompt,
    downloadUrl: `${assetMediaUrl(asset.id, version.id)}?download=1`,
    asset,
    version,
  };
}

function parameterDraftFromParams(params: Record<string, unknown>, model?: Model): ParameterDraft {
  const structuredKeys = new Set(model ? (generationOptions(model, false)?.fields.map(field => field.key) ?? []) : []);
  const values: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (structuredKeys.has(key)) values[key] = value;
    else extra[key] = value;
  }
  return {
    values,
    advanced: Object.keys(extra).length > 0 ? JSON.stringify(extra, null, 2) : '{}',
  };
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function SoundGeneratingRow({
  job,
  models,
  onCancel,
  onRecreate,
}: {
  job: GenerationJob;
  models: readonly Model[] | undefined;
  onCancel: (job: GenerationJob) => void;
  onRecreate: (job: GenerationJob) => void;
}) {
  const { t } = useI18n();
  const working = job.state === 'queued' || job.state === 'running';
  const saving = job.phase === 'downloading' || job.phase === 'saving';
  const reconnecting = working && job.phase === 'reconnecting';
  const voiceName = resolveSavedVoiceName(job.parameters?.voice, job.model.id, models, true);
  const tabKind = classifyAudioKind(job.model.id, job.model.mode, 'generated', `${job.model.modelId} ${job.model.label}`);
  const primaryTitle = voiceName
    ?? (tabKind === 'sfx' ? t('Sound effects') : tabKind === 'speech' ? t('Speech') : t('Music'));

  return (
    <div
      role="listitem"
      className="om-sound-track-row om-sound-generating-row"
      data-state={job.state}
      aria-label={t('Generation activity')}
      aria-busy="true"
    >
      <span className="om-sound-row-spinner" aria-hidden="true">
        <RemixIcon name="loader-4-line" size={16} className="om-busy-icon" />
      </span>

      <div className="om-sound-row-info">
        <div className="om-sound-row-title-line">
          <strong className="om-sound-row-title">{primaryTitle}</strong>
          {(saving || reconnecting) && (
            <span className="om-badge" role="status">
              {t(saving ? 'Saving to assets' : 'Reconnecting…')}
            </span>
          )}
        </div>
        <Tooltip label={job.prompt} wrap>
          <p className="om-sound-row-desc">{job.prompt}</p>
        </Tooltip>
      </div>

      <div className="om-sound-row-wave">
        <GeneratingWaveform seed={job.id} />
      </div>

      <span className="om-badge om-sound-row-model">{resolveAudioModelLabel(job.model.id, models) ?? job.model.label}</span>

      <div className="om-sound-row-actions">
        <Tooltip label={t('Recreate')}>
          <IconButton
            type="button"
            variant="plain"
            className="om-nav-item om-sound-row-action"
            aria-label={t('Recreate')}
            onClick={() => onRecreate(job)}
            icon={<RemixIcon name="sparkling-line" size={15} />}
          />
        </Tooltip>
        {working && (
          <Button
            type="button"
            variant="ghost"
            className="om-button h-auto om-sound-row-pill-btn"
            onClick={() => onCancel(job)}
          >
            {t('Cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}

function SoundFailedRow({
  job,
  onRetrySave,
  onResume,
  onRecreate,
  onDismiss,
}: {
  job: GenerationJob;
  onRetrySave?: (job: GenerationJob) => Promise<void>;
  onResume?: (job: GenerationJob) => Promise<void>;
  onRecreate: (job: GenerationJob) => void;
  onDismiss: () => void;
}) {
  const { t } = useI18n();
  const [retrying, setRetrying] = useState(false);
  const [showError, setShowError] = useState(false);
  const resumable = resumableJob(job);
  const cancelled = job.state === 'cancelled' && !job.savePending;

  let diagnostic = job.error;
  if (diagnostic?.startsWith('SAVE_NOT_AVAILABLE:')) {
    diagnostic = t('The retained files are missing, changed or unreadable. Saving cannot be retried. No new generation was requested.');
  } else if (diagnostic?.startsWith('ASSET_MEDIA_RUNTIME_NOT_READY:')) {
    diagnostic = t('Local media components are unavailable. Prepare or repair this installation, then submit again. No model request was made; your original asset is unchanged.');
  }

  const retrySave = async () => {
    if (!onRetrySave || retrying) return;
    setRetrying(true);
    try { await onRetrySave(job); } finally { setRetrying(false); }
  };

  const resume = async () => {
    if (!onResume || retrying) return;
    setRetrying(true);
    try { await onResume(job); } finally { setRetrying(false); }
  };

  return (
    <div
      role="listitem"
      className="om-sound-failed-row"
      data-state={job.state}
      aria-label={t('Generation activity')}
    >
      <div className="om-sound-failed-main">
        <div className="om-sound-failed-badges">
          <span className="om-sound-failed-pill" data-tone={cancelled ? 'muted' : 'danger'} role="status">
            <RemixIcon name={cancelled ? 'close-line' : 'error-warning-line'} size={14} />
            <span>{t(cancelled ? 'Cancelled' : 'Failed')}</span>
          </span>
          {job.savePending && onRetrySave && (
            <Tooltip label={t('Generated files are kept locally. Retry saving without generating again.')} wrap>
              <Button
                type="button"
                variant="ghost"
                className="om-button h-auto om-sound-row-pill-btn"
                disabled={retrying}
                onClick={() => void retrySave()}
              >
                {t(retrying ? 'Retrying save…' : 'Retry saving')}
              </Button>
            </Tooltip>
          )}
          {resumable && onResume && (
            <Button
              type="button"
              variant="ghost"
              className="om-button h-auto om-sound-row-pill-btn"
              disabled={retrying}
              onClick={() => void resume()}
            >
              {t(retrying ? 'Checking original task…' : 'Check original task')}
            </Button>
          )}
        </div>

        <div className="om-sound-failed-copy">
          <div className="om-sound-failed-heading">
            <strong className="om-sound-row-title">
              {t(cancelled ? 'Generation cancelled' : 'Try again, or adjust your prompt and settings.')}
            </strong>
            {diagnostic && (
              <Tooltip label={t('Failure details')}>
                <IconButton
                  type="button"
                  variant="plain"
                  className="om-nav-item om-sound-reset-icon"
                  aria-label={t('Failure details')}
                  aria-expanded={showError}
                  onClick={() => setShowError(v => !v)}
                  icon={<RemixIcon name="information-line" size={14} />}
                />
              </Tooltip>
            )}
          </div>
          <Tooltip label={job.prompt} wrap>
            <p className="om-sound-row-desc">{job.prompt}</p>
          </Tooltip>
        </div>

        <div className="om-sound-row-actions">
          <Tooltip label={t('Recreate')}>
            <IconButton
              type="button"
              variant="plain"
              className="om-nav-item om-sound-row-action"
              aria-label={t('Recreate')}
              onClick={() => onRecreate(job)}
              icon={<RemixIcon name="sparkling-line" size={15} />}
            />
          </Tooltip>
          <Button
            type="button"
            variant="ghost"
            className="om-button h-auto om-sound-row-pill-btn"
            onClick={onDismiss}
          >
            <RemixIcon name="delete-bin-line" size={14} />
            <span>{t('Delete')}</span>
          </Button>
        </div>
      </div>

      {diagnostic && showError && (
        <p className="om-sound-failed-detail">{t(diagnostic)}</p>
      )}
    </div>
  );
}

function SoundSoonPreview({
  tab,
  onPivot,
}: {
  tab: SoundTabDefinition;
  onPivot: (target: SoundLiveTabId) => void;
}) {
  const { t } = useI18n();
  const pivot = tab.pivotTab ? findSoundTab(tab.pivotTab) : undefined;
  const pipeline = tab.pipeline ?? [];

  return (
    <div className="om-sound-soon-stage">
      <div className="om-sound-soon-shell">
        <header className="om-sound-soon-head">
          <div className="om-sound-soon-title-row">
            <span className="om-creation-icon om-sound-soon-icon" data-tone="audio" aria-hidden="true">
              <RemixIcon name={tab.icon} size={18} />
            </span>
            <h2 className="om-sound-soon-title">{t(tab.label)}</h2>
            <span className="om-badge om-sound-soon-pill">{t('Coming soon')}</span>
          </div>
        </header>

        {pipeline.length > 0 && (
          <div className="om-sound-pipeline" role="list" aria-label={t(tab.label)}>
            {pipeline.map((node, index) => (
              <div key={node.label} className="om-sound-pipeline-step" role="listitem">
                {index > 0 && (
                  <span className="om-sound-pipeline-connector" aria-hidden="true">
                    <span className="om-sound-pipeline-line" />
                    <RemixIcon name="arrow-right-line" size={14} />
                  </span>
                )}
                <div className="om-sound-pipeline-node" data-engine={index === 1 || undefined}>
                  <span className="om-sound-pipeline-glyph" aria-hidden="true">
                    <RemixIcon name={node.icon} size={18} />
                  </span>
                  <strong>{t(node.label)}</strong>
                  <span className="om-sound-mono-readout">{t(node.spec)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="om-sound-soon-footer">
          <ComingSoonGuide compact showStatus={false} />
          {pivot && (
            <Button
              type="button"
              variant="ghost"
              className="om-button h-auto"
              onClick={() => onPivot(pivot.id as SoundLiveTabId)}
            >
              <span>{t('Open {tab}', { tab: t(pivot.label) })}</span>
              <RemixIcon name="arrow-right-line" size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SoundStudioWorkspace({
  active,
  studio,
  draft,
  setDraft,
  browser,
  jobs,
  uploading,
  updatingAssets,
  mobileView,
  setMobileView,
  onUploadClick,
  onDropFiles,
  onOpenAsset,
  onTrashAsset,
  onCancelJob,
  onRetrySave,
  onResumeJob,
  onViewJob: _onViewJob,
  onCreated,
  onError,
  onNotify,
  onDownload,
}: {
  active: boolean;
  studio: StudioCreation;
  draft: AssetDraft;
  setDraft: Dispatch<SetStateAction<AssetDraft>>;
  browser: ReturnType<typeof useAssetBrowser>;
  jobs: GenerationJob[];
  uploading: boolean;
  updatingAssets: Set<string>;
  mobileView: 'library' | 'create';
  setMobileView: Dispatch<SetStateAction<'library' | 'create'>>;
  onUploadClick: () => void;
  onDropFiles: (files: File[]) => void;
  onOpenAsset: (asset: LibraryAsset) => void;
  onTrashAsset: (assetId: string) => Promise<boolean>;
  onCancelJob: (job: GenerationJob) => void;
  onRetrySave: (job: GenerationJob) => Promise<void>;
  onResumeJob: (job: GenerationJob) => Promise<void>;
  onViewJob: (job: GenerationJob) => void;
  onCreated: (job: GenerationJob) => void;
  onError: (message: string) => void;
  onNotify: (message: string) => void;
  onDownload: () => void;
}) {
  const { t, formatDate } = useI18n();
  const activeTab: SoundTabId = studio.soundTab ?? (studio.destination.scene.id === 'speech' ? 'speech' : 'music');
  const tabDef = findSoundTab(activeTab) ?? SOUND_TABS[0];
  const isSoonTab = tabDef.status === 'soon';
  const liveTab: SoundLiveTabId = isSoonTab ? (tabDef.pivotTab ?? 'music') : (tabDef.id as SoundLiveTabId);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const locateTimerRef = useRef<number | null>(null);
  const pendingLocateIdRef = useRef<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [locatedTrackId, setLocatedTrackId] = useState<string | null>(null);
  const [localTypeFilter, setLocalTypeFilter] = useState<AudioTypeFilter>('all');
  const hasServerAudioKind = typeof browser.setAudioKind === 'function';
  const typeFilter: AudioTypeFilter = hasServerAudioKind ? (browser.audioKind ?? 'all') : localTypeFilter;
  const setTypeFilter = useCallback((next: AudioTypeFilter) => {
    if (hasServerAudioKind) browser.setAudioKind(next);
    else setLocalTypeFilter(next);
  }, [hasServerAudioKind, browser]);
  const [seenSources, setSeenSources] = useState<{ generated: boolean; upload: boolean }>({ generated: false, upload: false });
  const [sessionJobIds, setSessionJobIds] = useState<string[]>([]);
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => new Set());
  const { selected: selectedModel, preferred: preferredModel } = resolveSoundModels(studio, liveTab);
  const activeModel = selectedModel ?? preferredModel;
  const models = studio.catalog.catalog?.models;
  const initialParamModel = draft.model ? models?.find(model => model.id === draft.model) : activeModel;
  const currentDraftKey = studio.draftKey ?? `sound/${activeTab}`;

  const [parameterDrafts, setParameterDrafts] = useState<Record<string, ParameterDraft>>(() =>
    initialParamModel && draft.parameters && Object.keys(draft.parameters).length > 0
      ? { [initialParamModel.id]: parameterDraftFromParams(draft.parameters, initialParamModel) }
      : {},
  );
  const seededDraftKeyRef = useRef<string | undefined>(
    !draft.parameters || Object.keys(draft.parameters).length === 0 || initialParamModel
      ? currentDraftKey
      : undefined,
  );

  // Seed parameter drafts once per draftKey transition (e.g. cross-tab starter or Recreate),
  // splitting structured fields from raw Advanced JSON so local JSON edits never leak into values.
  useEffect(() => {
    if (seededDraftKeyRef.current === currentDraftKey) return;
    if (!draft.parameters || Object.keys(draft.parameters).length === 0) {
      seededDraftKeyRef.current = currentDraftKey;
      return;
    }
    const targetModel = (draft.model ? models?.find(model => model.id === draft.model) : undefined) ?? activeModel;
    if (!targetModel) return;
    seededDraftKeyRef.current = currentDraftKey;
    const seeded = parameterDraftFromParams(draft.parameters, targetModel);
    setParameterDrafts(current => ({
      ...current,
      [targetModel.id]: seeded,
    }));
  }, [currentDraftKey, draft.model, draft.parameters, models, activeModel]);

  // Track any active audio job observed on screen so reload-recovered jobs transition cleanly
  // in-place to either their completed track row (with New badge) or an inline failed row.
  useEffect(() => {
    const activeIds = jobs
      .filter(job => job.modality === 'audio' && (job.state === 'queued' || job.state === 'running'))
      .map(job => job.id);
    if (activeIds.length === 0) return;
    setSessionJobIds(current => {
      const missing = activeIds.filter(id => !current.includes(id));
      return missing.length > 0 ? [...missing, ...current] : current;
    });
  }, [jobs]);

  const featuredRecipe = SOUND_MUSIC_RECIPES[0];
  const featuredDemoTrack: SoundPlayableTrack = useMemo(() => ({
    id: `demo:${featuredRecipe.id}`,
    kind: 'demo',
    title: t(featuredRecipe.title),
    subtitle: '',
    src: featuredRecipe.audio!,
    blobSource: true,
    waveform: resampleWaveform(featuredRecipe.waveform ?? [], 128),
    durationHint: featuredRecipe.durationSeconds,
    prompt: t(featuredRecipe.prompt),
  }), [t]);

  const assets = browser.data?.assets ?? [];
  useEffect(() => {
    if (!assets.length) return;
    const hasGen = assets.some(asset => assetVersion(asset)?.source === 'generated');
    const hasUp = assets.some(asset => assetVersion(asset)?.source === 'upload');
    setSeenSources(prev => (
      (prev.generated || !hasGen) && (prev.upload || !hasUp)
        ? prev
        : { generated: prev.generated || hasGen, upload: prev.upload || hasUp }
    ));
  }, [assets]);

  const allAssetTracks = useMemo(() => assets.flatMap(asset => {
    const version = assetVersion(asset);
    return version ? [buildAssetTrack(asset, version, studio, t)] : [];
  }), [assets, studio.catalog.catalog, t]);

  const waveformInputs = useMemo(
    () => allAssetTracks.map(track => ({ id: track.id, src: track.src, stored: track.version?.waveform })),
    [allAssetTracks],
  );
  const decodedWaveforms = useAudioWaveforms(waveformInputs, 128);

  const savedAssetIds = useMemo(
    () => new Set(allAssetTracks.map(item => item.asset?.id).filter((id): id is string => Boolean(id))),
    [allAssetTracks],
  );

  const filteredAssetTracks = useMemo(() => {
    if (typeFilter === 'all' || hasServerAudioKind) return allAssetTracks;
    return allAssetTracks.filter(track => classifyAudioTrackTab(track.version?.model, models, track.version?.source, track.version?.audioKind) === typeFilter);
  }, [allAssetTracks, typeFilter, hasServerAudioKind, models]);

  // Unified stream jobs: in-progress, save-pending and resumable jobs always appear;
  // completed jobs seamlessly yield to their saved library track row without duplicates;
  // failed/cancelled session jobs stay inline until dismissed.
  const streamJobs = useMemo(() => {
    const sessionSet = new Set(sessionJobIds);
    return jobs.filter(job => {
      if (job.modality !== 'audio') return false;
      if (dismissedJobIds.has(job.id)) return false;
      if (job.state === 'queued' || job.state === 'running') return true;
      if (job.savePending || resumableJob(job)) return true;
      if (job.state === 'completed') {
        const assetId = job.libraryAssets?.[0]?.assetId;
        return sessionSet.has(job.id) && (!assetId || !savedAssetIds.has(assetId));
      }
      return sessionSet.has(job.id);
    });
  }, [jobs, sessionJobIds, dismissedJobIds, savedAssetIds]);

  const streamEntries = useMemo<StreamEntry[]>(() => {
    const jobEntries: StreamEntry[] = streamJobs.map(job => ({
      kind: 'job',
      id: `job:${job.id}`,
      createdAt: job.createdAt,
      job,
    }));
    const trackEntries: StreamEntry[] = filteredAssetTracks.map(track => ({
      kind: 'track',
      id: track.id,
      createdAt: track.version?.createdAt ?? track.asset?.updatedAt ?? 0,
      track,
    }));
    if (browser.sort === 'name') return [...jobEntries, ...trackEntries];
    const combined = [...jobEntries, ...trackEntries];
    // Keep actively running jobs pinned above older entries while preserving chronological rhythm.
    combined.sort((a, b) => {
      const aRunning = a.kind === 'job' && (a.job.state === 'queued' || a.job.state === 'running');
      const bRunning = b.kind === 'job' && (b.job.state === 'queued' || b.job.state === 'running');
      if (aRunning !== bRunning) return aRunning ? -1 : 1;
      return browser.sort === 'oldest' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt;
    });
    return combined;
  }, [streamJobs, filteredAssetTracks, browser.sort]);

  const groupedStream = useMemo(() => {
    if (browser.sort === 'name') {
      return streamEntries.length > 0 ? [{ key: 'all', label: '', entries: streamEntries }] : [];
    }
    const groups: { key: string; label: string; entries: StreamEntry[] }[] = [];
    for (const entry of streamEntries) {
      const key = entry.createdAt > 0 ? dayKey(entry.createdAt) : 'recent';
      const existing = groups[groups.length - 1];
      if (existing && existing.key === key) {
        existing.entries.push(entry);
      } else {
        groups.push({
          key,
          label: entry.createdAt > 0
            ? formatDate(entry.createdAt, { year: 'numeric', month: 'long', day: 'numeric' })
            : '',
          entries: [entry],
        });
      }
    }
    return groups;
  }, [streamEntries, browser.sort, formatDate]);

  const playlist = useMemo(
    () => (filteredAssetTracks.length > 0 ? filteredAssetTracks : [featuredDemoTrack]),
    [filteredAssetTracks, featuredDemoTrack],
  );

  const pauseMainPlayerRef = useRef<() => void>(() => {});
  const stopVoiceAuditionRef = useRef<() => void>(() => {});

  const player = useSoundPlayer({
    active: active && !isSoonTab,
    playlist,
    onVoiceError: () => onError(t('Preview failed to load')),
    onPlayStart: () => stopVoiceAuditionRef.current(),
  });
  pauseMainPlayerRef.current = player.pause;

  const voiceAudition = useVoiceAudition({
    active: active && !isSoonTab,
    onPlayStart: () => pauseMainPlayerRef.current(),
    onError: () => onError(t('Preview failed to load')),
  });
  stopVoiceAuditionRef.current = voiceAudition.stop;
  const voicePreview = voiceAudition.controller;

  const revealTrackRow = useCallback((trackId: string): boolean => {
    const stage = stageRef.current;
    if (!stage) return false;
    const rows = stage.querySelectorAll<HTMLElement>('.om-sound-track-row[data-track-id]');
    const target = Array.from(rows).find(node => node.dataset.trackId === trackId);
    if (!target) return false;
    target.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    setLocatedTrackId(trackId);
    if (locateTimerRef.current !== null) window.clearTimeout(locateTimerRef.current);
    locateTimerRef.current = window.setTimeout(() => {
      setLocatedTrackId(current => (current === trackId ? null : current));
      locateTimerRef.current = null;
    }, 1400);
    return true;
  }, []);

  useEffect(() => () => {
    if (locateTimerRef.current !== null) window.clearTimeout(locateTimerRef.current);
  }, []);

  useEffect(() => {
    const pendingId = pendingLocateIdRef.current;
    if (!pendingId || isSoonTab) return;
    if (revealTrackRow(pendingId)) pendingLocateIdRef.current = null;
  }, [filteredAssetTracks, isSoonTab, revealTrackRow]);

  // DAW-style keyboard auditioning: Space toggles play/pause, Up/Down steps tracks.
  useEffect(() => {
    if (!active || isSoonTab) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableElement(event.target)) return;
      if (event.key === ' ' && !event.repeat) {
        if (event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"], [role="slider"]')) return;
        event.preventDefault();
        if (player.track) player.togglePlay();
        else if (playlist[0]) player.playTrack(playlist[0]);
      } else if (event.key === 'ArrowDown' && player.canStepNext) {
        if (event.target instanceof HTMLElement && event.target.closest('[role="listbox"], [role="menu"], [role="slider"]')) return;
        event.preventDefault();
        player.stepTrack(1);
      } else if (event.key === 'ArrowUp' && player.canStepPrev) {
        if (event.target instanceof HTMLElement && event.target.closest('[role="listbox"], [role="menu"], [role="slider"]')) return;
        event.preventDefault();
        player.stepTrack(-1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, isSoonTab, player, playlist]);

  const hasQueryOrSource = Boolean(browser.query.trim() || browser.source !== 'all');
  const hasFilters = Boolean(hasQueryOrSource || typeFilter !== 'all');
  const libraryEmpty = browser.data !== undefined && browser.data.total === 0 && !hasFilters;
  const starterTab: SoundLiveTabId | null = typeFilter === 'music' || typeFilter === 'sfx' || typeFilter === 'speech'
    ? typeFilter
    : libraryEmpty
      ? liveTab
      : null;
  const showStarters = Boolean(
    starterTab
    && browser.data !== undefined
    && streamEntries.length === 0
    && !hasQueryOrSource,
  );
  const showSourceFilter = browser.source !== 'all' || (seenSources.generated && seenSources.upload);

  const applyStarterPrompt = (targetTab: SoundLiveTabId, text: string, notice: string) => {
    if (targetTab !== activeTab && studio.selectSoundTab) {
      studio.selectSoundTab(targetTab, { modality: 'audio', prompt: text, references: [] });
      setMobileView('create');
      requestAnimationFrame(() => promptRef.current?.focus());
      onNotify(notice);
      return;
    }
    if (targetTab !== liveTab && studio.reuseInScene) {
      studio.reuseInScene(targetTab === 'speech' ? 'speech' : 'music', { modality: 'audio', prompt: text, references: [] });
      onNotify(notice);
      return;
    }
    setDraft(current => ({ ...current, prompt: text }));
    setMobileView('create');
    requestAnimationFrame(() => promptRef.current?.focus());
    onNotify(notice);
  };

  const resolveSfxStarterModel = (): Model | undefined => {
    if (liveTab === 'sfx' && activeModel) return activeModel;
    const gateway = studio.catalog.catalog;
    const sfxModels = gateway?.models.filter(
      model => model.modality === 'audio' && model.mode !== 'text-to-speech' && isSfxModel(model),
    ) ?? [];
    const availableSfx = sfxModels.filter(model =>
      gateway?.status.providers.some(provider => provider.id === model.provider && provider.available),
    );
    return availableSfx[0] ?? sfxModels[0];
  };

  const applySfxStarter = (starter: SoundSfxStarter) => {
    const localizedPrompt = t(starter.prompt);
    const targetModel = resolveSfxStarterModel();
    const nextValues: Record<string, unknown> = {
      duration_seconds: starter.durationSeconds,
      ...(starter.loop ? { loop: true } : {}),
    };
    if (targetModel) {
      setParameterDrafts(current => {
        const prev = current[targetModel.id] ?? emptyParameters;
        return { ...current, [targetModel.id]: { ...prev, values: { ...prev.values, ...nextValues } } };
      });
    }
    const nextDraft: AssetDraft = {
      modality: 'audio',
      prompt: localizedPrompt,
      ...(targetModel ? { model: targetModel.id } : {}),
      parameters: nextValues,
      references: [],
    };
    if (activeTab !== 'sfx' && studio.selectSoundTab) {
      studio.selectSoundTab('sfx', nextDraft, targetModel?.id ?? null);
      setMobileView('create');
      requestAnimationFrame(() => promptRef.current?.focus());
      onNotify(t('Prompt loaded into editor'));
      return;
    }
    if (liveTab !== 'sfx' && studio.reuseInScene) {
      studio.reuseInScene('music', nextDraft, targetModel?.id ?? null);
      onNotify(t('Prompt loaded into editor'));
      return;
    }
    setDraft(current => ({
      ...current,
      prompt: localizedPrompt,
      ...(targetModel ? { model: targetModel.id } : {}),
      parameters: { ...(current.parameters ?? {}), ...nextValues },
    }));
    setMobileView('create');
    requestAnimationFrame(() => promptRef.current?.focus());
    onNotify(t('Prompt loaded into editor'));
  };

  const copyAssetRef = (track: SoundPlayableTrack) => {
    if (!track.asset || !track.version) return;
    const refText = `${track.asset.id}/${track.version.id}`;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(refText).then(
        () => onNotify(t('Asset reference copied')),
        () => onNotify(refText),
      );
    } else {
      onNotify(refText);
    }
  };

  const hydrateComposer = (
    prompt: string,
    modelId: string | undefined,
    parameters: Record<string, unknown> | undefined,
    savedAudioKind?: AudioKind,
  ) => {
    const matchedModel = modelId ? models?.find(m => m.id === modelId) : undefined;
    const classified = classifyAudioTrackTab(modelId, models, undefined, savedAudioKind);
    const targetTab: SoundLiveTabId = classified === 'upload' ? liveTab : classified;

    if (modelId && parameters && Object.keys(parameters).length > 0) {
      const key = matchedModel?.id ?? modelId;
      setParameterDrafts(current => ({
        ...current,
        [key]: parameterDraftFromParams(parameters, matchedModel),
      }));
    }

    const nextDraft: AssetDraft = {
      modality: 'audio',
      prompt,
      model: matchedModel?.id ?? modelId,
      parameters,
      references: [],
    };

    if (targetTab !== activeTab && studio.selectSoundTab) {
      studio.selectSoundTab(targetTab, nextDraft, matchedModel?.id ?? null);
      setMobileView('create');
      requestAnimationFrame(() => promptRef.current?.focus());
      onNotify(t('Prompt and settings loaded'));
      return;
    }

    if (targetTab !== liveTab && studio.reuseInScene) {
      studio.reuseInScene(targetTab === 'speech' ? 'speech' : 'music', nextDraft, matchedModel?.id ?? null);
      onNotify(t('Prompt and settings loaded'));
      return;
    }

    if (matchedModel) studio.chooseModel(matchedModel.id);
    setDraft(current => ({
      ...current,
      prompt,
      model: matchedModel?.id ?? current.model,
      parameters,
    }));
    setMobileView('create');
    requestAnimationFrame(() => promptRef.current?.focus());
    onNotify(t('Prompt and settings loaded'));
  };

  const reuseTrack = (track: SoundPlayableTrack) => {
    if (!track.prompt) return;
    hydrateComposer(track.prompt, track.version?.model, track.version?.parameters, track.version?.audioKind);
  };

  const recreateJob = (job: GenerationJob) => {
    hydrateComposer(
      job.prompt,
      job.model.id,
      job.parameters,
      classifyAudioKind(job.model.id, job.model.mode, 'generated', `${job.model.modelId} ${job.model.label}`),
    );
  };

  const handleCreated = (job: GenerationJob) => {
    // Ensure active right-side filters or pagination cannot hide the in-place generating row or its completed track.
    if (typeFilter !== 'all' && typeFilter !== liveTab) setTypeFilter('all');
    if (browser.source === 'upload') browser.setSource('all');
    if (browser.query.trim()) browser.setQuery('');
    if (browser.page > 0) browser.setPage(0);

    setSessionJobIds(current => [job.id, ...current.filter(id => id !== job.id)]);
    setDismissedJobIds(current => {
      if (!current.has(job.id)) return current;
      const next = new Set(current);
      next.delete(job.id);
      return next;
    });
    setMobileView('library');
    onCreated(job);
  };

  const clearAllFilters = () => {
    browser.setQuery('');
    browser.setSource('all');
    setTypeFilter('all');
  };

  const locateTrack = (track: SoundPlayableTrack) => {
    setMobileView('library');
    if (isSoonTab) {
      pendingLocateIdRef.current = track.id;
      pivotToLiveTab(liveTab);
      return;
    }
    if (revealTrackRow(track.id)) return;
    if (hasFilters) {
      pendingLocateIdRef.current = track.id;
      clearAllFilters();
    }
  };

  const typeOptions: readonly { id: AudioTypeFilter; label: string }[] = useMemo(() => [
    { id: 'all', label: 'All' },
    { id: 'music', label: 'Music' },
    { id: 'sfx', label: 'Sound effects' },
    { id: 'speech', label: 'Speech' },
    ...(seenSources.upload || typeFilter === 'upload' ? [{ id: 'upload' as const, label: 'Local upload' }] : []),
  ], [seenSources.upload, typeFilter]);

  const newAssetIds = useMemo(() => new Set(
    jobs
      .filter(job => sessionJobIds.includes(job.id) && job.state === 'completed')
      .flatMap(job => job.libraryAssets?.map(ref => ref.assetId) ?? []),
  ), [jobs, sessionJobIds]);

  const pivotToLiveTab = (target: SoundLiveTabId) => {
    if (studio.selectSoundTab) {
      studio.selectSoundTab(target);
      return;
    }
    if (studio.reuseInScene) {
      studio.reuseInScene(target === 'speech' ? 'speech' : 'music', { modality: 'audio', prompt: '', references: [] }, null);
    }
  };

  const renderTrackRow = (track: SoundPlayableTrack, hasDayGroup: boolean) => {
    const asset = track.asset!;
    const version = track.version!;
    const isCurrent = player.track?.id === track.id;
    const isPlaying = isCurrent && player.playing;
    const versionNum = asset.versions.findIndex(v => v.id === version.id) + 1;
    const trackDuration = isCurrent && player.duration > 0 ? player.duration : (version.duration ?? 0);
    const progress = isCurrent && trackDuration > 0 ? Math.min(1, player.currentTime / trackDuration) : 0;
    const isFresh = newAssetIds.has(asset.id);
    const isSaving = updatingAssets.has(asset.id);
    const trackKind = classifyAudioTrackTab(version.model, models, version.source, version.audioKind);
    const modelLabel = resolveAudioModelLabel(version.model, models);
    const voiceName = trackKind === 'speech'
      ? resolveSavedVoiceName(version.parameters?.voice, version.model, models, true)
      : undefined;
    const isInstrumental = version.parameters?.instrumental === true;
    const isLoop = version.parameters?.loop === true;
    const normalizedPrompt = version.prompt?.replace(/\s+/g, ' ').trim();
    const titleTooltip = normalizedPrompt && normalizedPrompt.length > asset.name.length && normalizedPrompt.startsWith(asset.name)
      ? version.prompt!
      : asset.name;
    const detailParts = [
      modelLabel ?? (version.source === 'upload' ? t('Local upload') : ''),
      isInstrumental ? t('Instrumental') : '',
      isLoop ? t('Loop') : '',
    ].filter(Boolean).join(' · ');
    const timeLabel = formatDate(
      version.createdAt,
      hasDayGroup
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    );
    const bars = decodedWaveforms.get(track.id) ?? track.waveform;

    return (
      <div
        key={track.id}
        role="listitem"
        className="om-sound-track-row"
        data-track-id={track.id}
        data-audio-kind={trackKind}
        data-active={isCurrent || undefined}
        data-playing={isPlaying || undefined}
        data-fresh={isFresh || undefined}
        data-located={locatedTrackId === track.id || undefined}
      >
        <Tooltip label={t(isPlaying ? 'Pause' : 'Play')}>
          <IconButton
            type="button"
            variant="plain"
            className={isPlaying ? 'om-sound-row-play hf-od-primary' : 'om-sound-row-play'}
            data-playing={isPlaying || undefined}
            aria-label={t(isPlaying ? 'Pause {name}' : 'Play {name}', { name: asset.name })}
            onClick={() => player.playTrack(track)}
            icon={<RemixIcon name={isPlaying ? 'pause-fill' : 'play-fill'} size={16} className={!isPlaying ? 'om-sound-play-glyph' : undefined} />}
          />
        </Tooltip>

        <Button
          type="button"
          variant="plain"
          className="om-sound-row-info om-sound-row-info-btn"
          aria-label={t('Asset details')}
          onClick={() => onOpenAsset(asset)}
        >
          <span className="om-sound-row-title-line">
            <RemixIcon name={AUDIO_KIND_ICON[trackKind]} size={13} className="om-sound-row-kind-icon" />
            <Tooltip label={titleTooltip} wrap>
              <strong className="om-sound-row-title">{asset.name}</strong>
            </Tooltip>
            {asset.versions.length > 1 && <span className="om-badge">V{versionNum}</span>}
            {isFresh && <span className="om-badge" data-active="true">{t('New')}</span>}
          </span>
          <span className="om-sound-row-meta-line">
            {voiceName && (
              <span className="om-sound-voice-chip">{voiceName}</span>
            )}
            {detailParts && (
              <span className="om-sound-row-source">{detailParts}</span>
            )}
            {detailParts && timeLabel && (
              <span className="om-sound-row-sep" aria-hidden="true">·</span>
            )}
            {timeLabel && <span className="om-sound-row-desc">{timeLabel}</span>}
          </span>
        </Button>

        <div className="om-sound-row-wave">
          <InteractiveWaveform
            bars={bars}
            progress={progress}
            active={isCurrent}
            playing={isPlaying}
            duration={trackDuration}
            audioRef={player.audioRef}
            label={t('Seek {name}', { name: asset.name })}
            onSeek={ratio => player.playTrack(track, ratio)}
            onScrub={ratio => {
              if (trackDuration > 0) player.seekTo(ratio * trackDuration);
            }}
          />
        </div>

        <span className="om-sound-row-duration">{formatTrackDuration(trackDuration)}</span>

        <div className="om-sound-row-actions">
          {version.prompt && (
            <Tooltip label={t('Recreate')}>
              <IconButton
                type="button"
                variant="plain"
                className="om-nav-item om-sound-row-action"
                aria-label={t('Recreate')}
                onClick={() => reuseTrack(track)}
                icon={<RemixIcon name="sparkling-line" size={15} />}
              />
            </Tooltip>
          )}
          <Tooltip label={t('Download')}>
            <a
              className="om-nav-item om-sound-row-action"
              href={track.downloadUrl}
              download
              aria-label={t('Download')}
              onClick={onDownload}
            >
              <RemixIcon name="download-2-line" size={15} />
            </a>
          </Tooltip>
          <Menu
            side="bottom"
            align="end"
            aria-label={t('More actions')}
            className="om-sound-row-menu"
            trigger={
              <IconButton
                type="button"
                variant="plain"
                className="om-nav-item om-sound-row-action"
                aria-label={t('More actions')}
                icon={<RemixIcon name="more-fill" size={15} />}
              />
            }
          >
            <MenuItem
              className="om-sound-row-menu-item"
              icon={<RemixIcon name="arrow-right-up-line" size={14} />}
              onClick={() => onOpenAsset(asset)}
            >
              {t('Asset details')}
            </MenuItem>
            <MenuItem
              className="om-sound-row-menu-item"
              icon={<RemixIcon name="file-copy-line" size={14} />}
              onClick={() => copyAssetRef(track)}
            >
              {t('Copy asset reference')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              className="om-sound-row-menu-item"
              tone="danger"
              disabled={isSaving}
              icon={<RemixIcon name="delete-bin-line" size={14} />}
              onClick={() => {
                if (player.track?.id === track.id) player.close();
                void onTrashAsset(asset.id);
              }}
            >
              {t('Move to trash')}
            </MenuItem>
          </Menu>
        </div>
      </div>
    );
  };

  return (
    <div className="om-sound-studio" data-mobile-view={mobileView} data-sound-tab={activeTab}>
      {!isSoonTab && (
        <div className="om-assets-view-switch" role="group" aria-label={t('Sound Studio views')}>
          <div className="om-choice-tabs">
            <Button type="button" variant="plain" className="om-nav-item" aria-pressed={mobileView === 'create'} onClick={() => setMobileView('create')}>
              {t('Create')}
            </Button>
            <Button type="button" variant="plain" className="om-nav-item" aria-pressed={mobileView === 'library'} onClick={() => setMobileView('library')}>
              {t('Tracks')}
            </Button>
          </div>
        </div>
      )}

      <div className="om-assets-library om-sound-layout">
        {!isSoonTab && (
          <ResizablePane
            className="om-creator-pane om-sound-composer-pane"
            storageKey="motion-studio-controls-width"
            initial={388}
            min={320}
            max={540}
            edge="right"
            label={t('Resize creator')}
          >
            <SoundComposer
              active={active}
              tabId={liveTab}
              studio={studio}
              draft={draft}
              setDraft={setDraft}
              parameterDrafts={parameterDrafts}
              setParameterDrafts={setParameterDrafts}
              promptRef={promptRef}
              voicePreview={voicePreview}
              onCreated={handleCreated}
              onError={onError}
            />
          </ResizablePane>
        )}

        <section
          ref={stageRef}
          className="om-sound-stage"
          data-drag-active={dragActive || undefined}
          aria-label={t('Audio workspace')}
          onDragOver={event => {
            if (!isSoonTab && event.dataTransfer.types.includes('Files')) {
              event.preventDefault();
              if (!dragActive) setDragActive(true);
            }
          }}
          onDragLeave={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
          }}
          onDrop={event => {
            setDragActive(false);
            if (!isSoonTab && event.dataTransfer.files.length) {
              event.preventDefault();
              onDropFiles(Array.from(event.dataTransfer.files));
            }
          }}
        >
          {isSoonTab ? (
            <SoundSoonPreview
              tab={tabDef}
              onPivot={pivotToLiveTab}
            />
          ) : (
            <>
              <header className="om-sound-toolbar">
                <div className="om-sound-toolbar-filters">
                  <div className="om-choice-tabs om-sound-source-tabs" role="group" aria-label={t('Audio type')}>
                    {typeOptions.map(option => (
                      <Button
                        type="button"
                        variant="plain"
                        key={option.id}
                        className="om-nav-item"
                        aria-pressed={typeFilter === option.id}
                        onClick={() => setTypeFilter(option.id)}
                      >
                        {t(option.label)}
                      </Button>
                    ))}
                  </div>

                  {showSourceFilter && (
                    <div className="om-sound-select">
                      <Select
                        label={t('Source')}
                        value={browser.source}
                        onCommit={browser.setSource}
                        options={[
                          { value: 'all', label: t('All sources') },
                          { value: 'generated', label: t('AI generated') },
                          { value: 'upload', label: t('Local upload') },
                        ]}
                      />
                    </div>
                  )}

                  <label className="om-field om-sound-search">
                    <RemixIcon name="search-line" size={15} />
                    <input
                      type="search"
                      aria-label={t('Search audio')}
                      placeholder={t('Search audio...')}
                      value={browser.query}
                      onChange={event => browser.setQuery(event.target.value)}
                      maxLength={200}
                    />
                  </label>

                  <div className="om-sound-select">
                    <Select
                      label={t('Sort')}
                      value={browser.sort}
                      onCommit={browser.setSort}
                      options={[
                        { value: 'newest', label: t('Newest first') },
                        { value: 'oldest', label: t('Oldest first') },
                        { value: 'name', label: t('Name') },
                      ]}
                    />
                  </div>
                </div>

                <div className="om-sound-toolbar-actions">
                  <Button
                    type="button"
                    variant="ghost"
                    className="om-button h-auto"
                    disabled={uploading}
                    onClick={onUploadClick}
                  >
                    <RemixIcon name="upload-2-line" size={15} />
                    <span>{t(uploading ? 'Uploading…' : 'Upload')}</span>
                  </Button>
                </div>
              </header>

              <main className="om-sound-content">
                <section className="om-sound-section om-sound-library-section" aria-label={t('Audio library')}>
                  {browser.error && streamEntries.length === 0 ? (
                    <div className="om-empty om-sound-state-box">
                      <RemixIcon name="error-warning-line" size={28} />
                      <p>{t('Could not load assets')}</p>
                      <Button type="button" variant="ghost" className="om-button h-auto" onClick={browser.retry}>
                        {t('Retry')}
                      </Button>
                    </div>
                  ) : !browser.data && streamEntries.length === 0 ? (
                    <div className="om-sound-track-list" aria-busy="true" aria-label={t('Loading…')}>
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="om-sound-track-skeleton" />
                      ))}
                    </div>
                  ) : streamEntries.length > 0 ? (
                    <>
                      <div className="om-sound-day-stream" aria-busy={browser.loading} inert={browser.stale && !browser.error}>
                        {groupedStream.map(group => (
                          <div key={group.key} className="om-sound-day-group">
                            {group.label && <div className="om-sound-day-label">{group.label}</div>}
                            <div className="om-sound-track-list" role="list">
                              {group.entries.map(entry => {
                                if (entry.kind === 'track') return renderTrackRow(entry.track, Boolean(group.label));
                                const job = entry.job;
                                const isWorkingOrMorphing =
                                  job.state === 'queued'
                                  || job.state === 'running'
                                  || (job.state === 'completed' && !job.savePending);
                                if (isWorkingOrMorphing) {
                                  return (
                                    <SoundGeneratingRow
                                      key={entry.id}
                                      job={job}
                                      models={models}
                                      onCancel={onCancelJob}
                                      onRecreate={recreateJob}
                                    />
                                  );
                                }
                                return (
                                  <SoundFailedRow
                                    key={entry.id}
                                    job={job}
                                    onRetrySave={onRetrySave}
                                    onResume={onResumeJob}
                                    onRecreate={recreateJob}
                                    onDismiss={() => setDismissedJobIds(current => new Set([...current, job.id]))}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>

                      {browser.data && (browser.page > 0 || browser.data.nextOffset !== null) && (
                        <div className="om-asset-pagination">
                          <Button
                            type="button"
                            variant="ghost"
                            className="om-button h-auto"
                            disabled={!browser.page || browser.loading}
                            onClick={() => browser.setPage(v => v - 1)}
                          >
                            {t('Previous')}
                          </Button>
                          <span className="om-muted">{browser.page + 1}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            className="om-button h-auto"
                            disabled={browser.data.nextOffset === null || browser.loading}
                            onClick={() => browser.setPage(v => v + 1)}
                          >
                            {t('Next')}
                          </Button>
                        </div>
                      )}
                    </>
                  ) : hasFilters && !showStarters ? (
                    <div className="om-empty om-sound-state-box">
                      <RemixIcon name="search-line" size={28} />
                      <h2 className="om-subtitle">{t('No matching assets')}</h2>
                      <Button
                        type="button"
                        variant="ghost"
                        className="om-button h-auto"
                        onClick={clearAllFilters}
                      >
                        {t('Clear filters')}
                      </Button>
                    </div>
                  ) : null}
                </section>

                {showStarters && starterTab && (
                  <section className="om-sound-section om-sound-starters" aria-label={t('Starters')}>
                    {starterTab === 'music' && (
                      <div className="om-sound-track-list" role="list">
                        <div
                          role="listitem"
                          className="om-sound-track-row om-sound-sample-row"
                          data-active={player.track?.id === featuredDemoTrack.id || undefined}
                          data-playing={(player.track?.id === featuredDemoTrack.id && player.playing) || undefined}
                        >
                          <Tooltip label={t(player.track?.id === featuredDemoTrack.id && player.playing ? 'Pause' : 'Play')}>
                            <IconButton
                              type="button"
                              variant="plain"
                              className={player.track?.id === featuredDemoTrack.id && player.playing ? 'om-sound-row-play hf-od-primary' : 'om-sound-row-play'}
                              data-playing={(player.track?.id === featuredDemoTrack.id && player.playing) || undefined}
                              aria-label={t(
                                player.track?.id === featuredDemoTrack.id && player.playing ? 'Pause {name}' : 'Play {name}',
                                { name: t(featuredRecipe.title) },
                              )}
                              onClick={() => player.playTrack(featuredDemoTrack)}
                              icon={<RemixIcon name={player.track?.id === featuredDemoTrack.id && player.playing ? 'pause-fill' : 'play-fill'} size={16} className={!(player.track?.id === featuredDemoTrack.id && player.playing) ? 'om-sound-play-glyph' : undefined} />}
                            />
                          </Tooltip>
                          <div className="om-sound-row-info">
                            <div className="om-sound-row-title-line">
                              <strong className="om-sound-row-title">{t(featuredRecipe.title)}</strong>
                              <span className="om-badge">{t('Sample')}</span>
                            </div>
                            <p className="om-sound-row-desc">{t(featuredRecipe.prompt)}</p>
                          </div>
                          <div className="om-sound-row-wave">
                            <InteractiveWaveform
                              bars={featuredDemoTrack.waveform}
                              progress={
                                player.track?.id === featuredDemoTrack.id && (player.duration || featuredRecipe.durationSeconds || 0) > 0
                                  ? Math.min(1, player.currentTime / (player.duration || featuredRecipe.durationSeconds || 1))
                                  : 0
                              }
                              active={player.track?.id === featuredDemoTrack.id}
                              playing={player.track?.id === featuredDemoTrack.id && player.playing}
                              duration={player.track?.id === featuredDemoTrack.id && player.duration > 0 ? player.duration : (featuredRecipe.durationSeconds ?? 37)}
                              audioRef={player.audioRef}
                              label={t('Seek {name}', { name: t(featuredRecipe.title) })}
                              onSeek={ratio => player.playTrack(featuredDemoTrack, ratio)}
                              onScrub={ratio => {
                                const dur = player.duration > 0 ? player.duration : (featuredRecipe.durationSeconds ?? 37);
                                player.seekTo(ratio * dur);
                              }}
                            />
                          </div>
                          <span className="om-sound-row-duration">
                            {formatTrackDuration(featuredRecipe.durationSeconds ?? 37)}
                          </span>
                          <div className="om-sound-row-actions">
                            <Button
                              type="button"
                              variant="plain"
                              className="om-nav-item om-sound-use-btn"
                              onClick={() => applyStarterPrompt('music', t(featuredRecipe.prompt), t('Prompt loaded into editor'))}
                            >
                              <RemixIcon name="add-line" size={14} />
                              {t('Use')}
                            </Button>
                          </div>
                        </div>

                        {SOUND_MUSIC_RECIPES.slice(1).map(recipe => (
                          <div key={recipe.id} role="listitem" className="om-sound-starter-row">
                            <div className="om-sound-starter-copy">
                              <strong>{t(recipe.title)}</strong>
                              <p className="om-sound-row-desc">{t(recipe.prompt)}</p>
                            </div>
                            <Button
                              type="button"
                              variant="plain"
                              className="om-nav-item om-sound-use-btn"
                              onClick={() => applyStarterPrompt('music', t(recipe.prompt), t('Prompt loaded into editor'))}
                            >
                              <RemixIcon name="add-line" size={14} />
                              {t('Use')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {starterTab === 'sfx' && (
                      <div className="om-sound-track-list" role="list">
                        {SOUND_SFX_STARTERS.map(starter => (
                          <div key={starter.id} role="listitem" className="om-sound-starter-row">
                            <div className="om-sound-starter-copy">
                              <div className="om-sound-row-title-line">
                                <strong>{t(starter.title)}</strong>
                                <span className="om-sound-mono-readout">{starter.durationSeconds}s</span>
                                {starter.loop && <span className="om-badge">{t('Loop')}</span>}
                              </div>
                              <p className="om-sound-row-desc">{t(starter.prompt)}</p>
                            </div>
                            <Button
                              type="button"
                              variant="plain"
                              className="om-nav-item om-sound-use-btn"
                              onClick={() => applySfxStarter(starter)}
                            >
                              <RemixIcon name="add-line" size={14} />
                              {t('Use')}
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {starterTab === 'speech' && (
                      <div className="om-sound-track-list" role="list">
                        {SOUND_SPEECH_SCRIPTS.map(item => {
                          const localized = t(item.script);
                          const seconds = estimateSpeechSeconds(localized);
                          return (
                            <div key={item.id} role="listitem" className="om-sound-starter-row">
                              <div className="om-sound-starter-copy">
                                <div className="om-sound-row-title-line">
                                  <strong>{t(item.title)}</strong>
                                  <span className="om-sound-mono-readout">~{seconds}s</span>
                                </div>
                                <p className="om-sound-row-desc">{localized}</p>
                              </div>
                              <Button
                                type="button"
                                variant="plain"
                                className="om-nav-item om-sound-use-btn"
                                onClick={() => applyStarterPrompt('speech', localized, t('Script loaded into editor'))}
                              >
                                <RemixIcon name="add-line" size={14} />
                                {t('Use')}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <Button
                      type="button"
                      variant="plain"
                      className="om-sound-drop-cue"
                      disabled={uploading}
                      onClick={onUploadClick}
                    >
                      <RemixIcon name="upload-2-line" size={15} />
                      <span>{t('Drop audio files here')}</span>
                    </Button>
                  </section>
                )}
              </main>
            </>
          )}

          {!isSoonTab && (
            <>
              {voiceAudition.audioProps && (
                <span className="om-sound-voice-audio-host" hidden>
                  <audio {...voiceAudition.audioProps} />
                </span>
              )}
              <SoundPlayerDock
                player={player}
                onLocateTrack={locateTrack}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
