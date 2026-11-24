import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import { destinationTarget, reportCreativePageView } from './exploreTracking';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { assetVersion, type LibraryAsset } from '../../../shared/asset-library';
import { resumableJob, type GenerationJob } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { AssetBrowserContent, useAssetBrowser, AssetPicker, assetKinds, type AssetKind } from './AssetBrowser';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { IconButton } from 'open-design-ui/icon-button';
import { Tooltip } from '../components/ui/Tooltip';
import { GameAssetsGrid, GameAssetsRow, useMyGames } from './game/GameAssetsSection';
import { AssetTaskMenu } from './AssetTaskHistory';
import { assetTasks, mergeAssetJobs, type AssetChatSummary, type AssetTask, type AssetTaskMode } from './assetTasks';
import { gatewayRequest } from './gatewayClient';
import { AssetComposer, type AssetDraft } from './AssetComposer';
import { AssetGenerationPlaceholder } from './AssetGenerationPlaceholder';
import { MediaGenerationHistory } from './MediaGenerationHistory';
import { assetRequest, uploadLibraryAsset } from './assetClient';
import { AssetUploadError } from './assetUploadError';
import { assetUploadMessage, type AssetUploadSummary } from '../i18n/assetUploadMessages';
import { AssetDetailWorkspace } from './AssetDetailWorkspace';
import { ResizablePane } from './ResizablePane';
import type { StudioCreation } from './CreativeWorkspace';
import { sceneLayout } from './sceneShowcase';
import { StudioIdeas } from './StudioIdeas';
import { AudioStudioLanding } from './AudioStudioLanding';
import { SoundStudioWorkspace } from './SoundStudioWorkspace';
import { resolveAudioModelLabel, resolveSavedVoiceName } from './soundPresets';
import { classifyAudioTrackTab } from './soundTabs';
import { formatDuration } from '../components/sidebar/assetHelpers';
import { attachableReferenceLimit, creationModels } from './creationModels';
import { isFeatureScene } from './creativeStudios';
import { isSupportedReferenceMime, OPEN_DESIGN_MAX_REFERENCE_BYTES, prepareReferenceImage, ReferenceImageError } from './compressReferenceImage';
import { imageModelLabel, isOpenDesignProvider } from './imageMenuModels';
import { AssetGalleryToolbar } from './AssetGalleryToolbar';
import './assets.css';
export function AssetsPage({ active, hasProject = false, studio, routeId, routeVersion, onAssetRoute }: { routeId?: string | null; routeVersion?: string | null; onAssetRoute?: (id: string | null, version: string | null) => void; active: boolean; hasProject?: boolean; studio?: StudioCreation }) {
  const { t } = useI18n(), toast = useToast();
  const [kind, setKind] = useState<AssetKind>(studio?.destination.scene.modality ?? 'all'), [revision, setRevision] = useState(0), [creating, setCreating] = useState(Boolean(studio) && !studio?.openCreate), [picking, setPicking] = useState(false), [pickerMulti, setPickerMulti] = useState(false), [uploading, setUploading] = useState(false), [selected, setSelected] = useState<LibraryAsset>(), [versionId, setVersionId] = useState(''), [jobs, setJobs] = useState<GenerationJob[]>([]), [sessionJobIds, setSessionJobIds] = useState<string[]>([]), [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => new Set());
  const [draft, setDraft] = useState<AssetDraft>(() => studio?.initialDraft ?? { modality: studio?.destination.scene.modality ?? 'image', prompt: '', references: [] });
  const [draftKeyState, setDraftKeyState] = useState(studio?.draftKey);
  if (studio?.draftKey && studio.draftKey !== draftKeyState) {
    setDraftKeyState(studio.draftKey);
    setDraft(studio.initialDraft ?? { modality: studio.destination.scene.modality, prompt: '', references: [] });
  }
  const layout = studio && sceneLayout(studio.destination.scene);
  const [studioTab, setStudioTab] = useState<'guide' | 'library'>();
  const [mobileView, setMobileView] = useState<'library' | 'create'>('create');
  const [agentReferences, setAgentReferences] = useState<AssetDraft['references']>([]);
  const [mode, setMode] = useState<AssetTaskMode>('direct'), [taskIds, setTaskIds] = useState<{ direct?: string; agent?: string }>({}), [taskEpoch, setTaskEpoch] = useState(0);
  const [conversations, setConversations] = useState<AssetChatSummary[]>([]), [historyLoading, setHistoryLoading] = useState(true), [historyError, setHistoryError] = useState<string>(), [historyRetry, setHistoryRetry] = useState(0), [selectingTask, setSelectingTask] = useState(false);
  const studioForm = studio && !selected ? studio : undefined;
  const scoped = Boolean(studio), lastStudioDraft = useRef(draft);
  useLayoutEffect(() => {
    if (studioForm && (!studioForm.draftKey || studioForm.draftKey === draftKeyState) && !draft.target && draft.modality === studioForm.destination.scene.modality) {
      lastStudioDraft.current = draft;
      studioForm.remember(draft);
    }
  }, [studioForm, draft, draftKeyState]);
  const selectionRequest = useRef(0);
  const selectedAsset = useRef<LibraryAsset | undefined>(undefined), assetReadRequest = useRef(0);
  const pendingWrites = useRef(new Set<string>()), [updatingAssets, setUpdatingAssets] = useState<Set<string>>(new Set());
  const mediaGenerations = Boolean(studio && (studio.destination.scene.modality === 'image' || studio.destination.scene.modality === 'video'));
  const browser = useAssetBrowser({ kind, revision, active, lockedSource: mediaGenerations ? 'generated' : undefined });
  // Games made in Game Studio appear in the library view only, never inside a Studio form.
  const [gamesView, setGamesView] = useState(false);
  const myGames = useMyGames(active && !studio);
  // One page view each time the library is shown; the page stays mounted while hidden. Inside a Design, Cinema or
  // Sound Studio the same page is that Studio's form, so it reports the Studio and scene instead of the library.
  useEffect(() => {
    if (!active) return;
    if (studio) reportCreativePageView('creative_studio', hasProject, { ...destinationTarget(studio.destination), landing: Boolean(studio.destination.landing) });
    else tracking.reportAssetsPageView(hasProject);
  }, [active, studio?.destination.studio.id, studio?.destination.scene.id, studio?.destination.landing]);
  const audioStudio = studio?.openCreate ? studio : undefined;
  const hasGuide = studio?.destination.landing || layout === 'workbench';
  const guide = Boolean(hasGuide && (studioTab ? studioTab === 'guide' : studio?.destination.landing || browser.data?.total === 0));
  const applyPrompt = (prompt: string) => { setDraft(current => ({ ...current, prompt })); setMobileView('create'); };
  const gallery = useRef<HTMLElement>(null), galleryScroll = useRef<{ top: number; key: string } | undefined>(undefined);
  useLayoutEffect(() => {
    if (selected || !gallery.current || !browser.data || !galleryScroll.current) return;
    if (galleryScroll.current.key === browser.data.key) gallery.current.scrollTop = galleryScroll.current.top;
    galleryScroll.current = undefined;
  }, [selected, browser.data]);
  const tasks = assetTasks(jobs, conversations), selectedKey = taskIds[mode] ? `${mode}:${taskIds[mode]}` : undefined;
  const chatChanged = useCallback((chat: AssetChatSummary) => setConversations(current => {
    if ((current.find(item => item.id === chat.id)?.updatedAt ?? -1) > chat.updatedAt) return current;
    return [chat, ...current.filter(item => item.id !== chat.id)];
  }), []);
  const referenceUpload = useRef<HTMLInputElement>(null), upload = useRef<HTMLInputElement>(null), replace = useRef<HTMLInputElement>(null), knownJobs = useRef<GenerationJob[]>([]);
  const mountedRef = useRef(true);
  const uploadingRef = useRef(false);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const refresh = useCallback(() => setRevision(v => v + 1), []), onError = useCallback((message: string) => toast.showToast(message), [toast.showToast]), onInfo = useCallback((message: string) => toast.showToast(message, 'info'), [toast.showToast]);
  const missingVersion = t('Asset version unavailable');
  const clearPreview = useCallback(() => {
    selectionRequest.current++; assetReadRequest.current++; selectedAsset.current = undefined;
    setSelectingTask(false); setSelected(undefined); setVersionId(''); setCreating(scoped && !studio?.openCreate);
    if (scoped) { setMode('direct'); setDraft(lastStudioDraft.current); setTaskIds({}); }
  }, [scoped, Boolean(studio?.openCreate)]);
  const closePreview = useCallback(() => {
    clearPreview();
    onAssetRoute?.(null, null);
  }, [clearPreview, onAssetRoute]);
  const selectVersion = useCallback((asset: LibraryAsset, id: string) => {
    selectionRequest.current++; assetReadRequest.current++; selectedAsset.current = asset;
    setSelectingTask(false); setSelected(asset); setVersionId(id); setCreating(false);
  }, []);
  const open = useCallback((asset: LibraryAsset, id = asset.currentVersionId) => {
    if (gallery.current && browser.data) galleryScroll.current = { top: gallery.current.scrollTop, key: browser.data.key };
    selectVersion(asset, id);
    onAssetRoute?.(asset.id, id);
  }, [browser.data, onAssetRoute, selectVersion]);
  useEffect(() => {
    if (!active || !onAssetRoute) return;
    if (!routeId) {
      if (selectedAsset.current) clearPreview();
      return;
    }
    const existing = selectedAsset.current;
    if (existing?.id === routeId && assetVersion(existing, routeVersion ?? existing.currentVersionId)) {
      setVersionId(routeVersion ?? existing.currentVersionId);
      return;
    }
    clearPreview();
    const request = ++selectionRequest.current;
    void assetRequest<{ asset: LibraryAsset }>({ action: 'get', assetId: routeId }).then(({ asset }) => {
      if (request !== selectionRequest.current) return;
      const id = routeVersion ?? asset.currentVersionId;
      if (!assetVersion(asset, id)) throw new Error(missingVersion);
      selectVersion(asset, id);
    }).catch(error => {
      if (request === selectionRequest.current) { onError(error.message); onAssetRoute(null, null); }
    });
    return () => { selectionRequest.current++; };
  }, [active, routeId, routeVersion, onAssetRoute, onError, clearPreview, selectVersion, missingVersion]);
  useEffect(() => {
    if (!active) return; let cancelled = false, pending = false;
    const poll = async () => {
      if (pending || document.hidden) return; pending = true;
      try {
        const [jobResult, chatResult] = await Promise.allSettled([assetRequest<{ jobs: GenerationJob[] }>({ action: 'jobs' }), gatewayRequest<{ conversations: AssetChatSummary[] }>('assets/conversations')]);
        if (cancelled) return;
        if (chatResult.status === 'fulfilled') setConversations(current => {
          const merged = new Map(current.map(chat => [chat.id, chat]));
          for (const chat of chatResult.value.conversations) if ((merged.get(chat.id)?.updatedAt ?? 0) <= chat.updatedAt) merged.set(chat.id, chat);
          return [...merged.values()];
        });
        setHistoryError(jobResult.status === 'rejected' || chatResult.status === 'rejected' ? 'Could not load task history' : undefined);
        if (jobResult.status === 'rejected') return;
        const next = mergeAssetJobs(knownJobs.current, jobResult.value.jobs);
        if (JSON.stringify(next) !== JSON.stringify(knownJobs.current)) {
          const outputsChanged = JSON.stringify(next.flatMap(job => job.libraryAssets ?? [])) !== JSON.stringify(knownJobs.current.flatMap(job => job.libraryAssets ?? []));
          knownJobs.current = next; setJobs(next);
          if (outputsChanged) refresh();
        }
      } catch { if (!cancelled) setHistoryError('Could not load task history'); } finally { pending = false; if (!cancelled) setHistoryLoading(false); }
    };
    void poll(); const timer = setInterval(() => void poll(), 2500); return () => { cancelled = true; clearInterval(timer); };
  }, [active, refresh, historyRetry]);
  useEffect(() => {
    if (!active || !selected) return; let cancelled = false;
    const request = ++assetReadRequest.current;
    void assetRequest<{ asset: LibraryAsset }>({ action: 'get', assetId: selected.id }).then(({ asset }) => {
      if (cancelled || request !== assetReadRequest.current || selectedAsset.current?.id !== asset.id || pendingWrites.current.has(asset.id)) return;
      if (Boolean(asset.trashedAt) !== Boolean(selectedAsset.current.trashedAt)) { closePreview(); refresh(); return; }
      if (asset.updatedAt < selectedAsset.current.updatedAt) return;
      setVersionId(current => assetVersion(asset, current) ? current : asset.currentVersionId);
      selectedAsset.current = asset; setSelected(asset);
    }).catch(error => { if (!cancelled && request === assetReadRequest.current) onError(error.message); });
    return () => { cancelled = true; };
  }, [active, selected?.id, revision, onError, closePreview, refresh]);
  const importFiles = async (files: File[], newVersion = false, entry: 'library_button' | 'library_drop' | 'library_new_version' | 'other' = newVersion ? 'library_new_version' : 'library_button', onImported?: (asset: LibraryAsset) => void, shouldContinue?: () => boolean) => {
    const targetId = newVersion ? selected?.id : undefined, parentVersionId = newVersion ? versionId : undefined, request = selectionRequest.current;
    if (newVersion && !targetId) return;
    if (uploadingRef.current || !files.length) return;
    uploadingRef.current = true;
    setUploading(true);
    const summary: AssetUploadSummary = { uploaded: 0, failed: 0, unknown: 0, reasons: new Set() };
    let attempted = 0;
    try {
      for (const file of files) {
        if (!mountedRef.current || (shouldContinue && !shouldContinue())) break;
        attempted++;
        try { const asset = await uploadLibraryAsset(file, { assetId: targetId, parentVersionId }); summary.uploaded++; if (mountedRef.current && request === selectionRequest.current) onImported?.(asset); if (newVersion && mountedRef.current && request === selectionRequest.current && selectedAsset.current?.id === targetId) open(asset); }
        catch (error) {
          if (error instanceof AssetUploadError && error.outcome === 'rejected') {
            summary.failed++; if (error.reason) summary.reasons.add(error.reason);
            if ((error.reason === 'unsupported' || error.reason === 'unreadable') && (
              file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|svg|heic|heif|tiff?|bmp|psd)$/i.test(file.name)
              || (newVersion && selected?.modality === 'image') || studio?.destination.scene.modality === 'image'
            )) summary.imageFormatHelp = true;
          } else summary.unknown++;
        }
      }
      if (!mountedRef.current) return;
      if (summary.uploaded || summary.unknown) refresh();
      if (attempted > 0 && (!shouldContinue || shouldContinue())) {
        toast.showToast(assetUploadMessage(summary), summary.failed || summary.unknown ? 'error' : 'info');
      }
      if (attempted > 0) tracking.reportLibraryImport(entry, attempted, summary.uploaded);
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
  };
  const persistUpdate = async (assetId: string, changes: Record<string, unknown>) => {
    if (pendingWrites.current.has(assetId)) throw new Error(t('This asset is being updated. Try again in a moment.'));
    pendingWrites.current.add(assetId); setUpdatingAssets(new Set(pendingWrites.current));
    assetReadRequest.current++;
    try {
      const { asset } = await assetRequest<{ asset: LibraryAsset }>({ action: 'update', assetId, changes });
      // A completed write only reconciles its own asset, never a later selection.
      if (selectedAsset.current?.id === assetId && asset.updatedAt >= selectedAsset.current.updatedAt) {
        if (Boolean(asset.trashedAt) !== Boolean(selectedAsset.current.trashedAt)) closePreview();
        else {
          selectedAsset.current = asset; setSelected(asset);
          if (typeof changes.currentVersionId === 'string') setVersionId(changes.currentVersionId);
        }
      }
    } finally {
      assetReadRequest.current++;
      pendingWrites.current.delete(assetId); setUpdatingAssets(new Set(pendingWrites.current));
      refresh();
    }
  };
  const update = async (assetId: string, changes: Record<string, unknown>) => {
    if (pendingWrites.current.has(assetId)) return false;
    const modality = selectedAsset.current?.id === assetId ? selectedAsset.current.modality : undefined;
    try {
      await persistUpdate(assetId, changes);
      tracking.reportAssetUpdate(changes, 'success', modality);
      if (changes.trashed === true) toast.showToast(t('Asset removed'), 'info', undefined, {
        key: `restore:${assetId}`, label: t('Undo'), onClick: async () => {
          try { await persistUpdate(assetId, { trashed: false }); tracking.reportAssetUpdate({ trashed: false }, 'success', modality); }
          catch (error) { tracking.reportAssetUpdate({ trashed: false }, 'failure', modality); throw error; }
          toast.showToast(t('Asset restored'), 'info');
        },
      });
      else toast.showToast(t(changes.trashed === false ? 'Asset restored' : 'Saved'), 'info');
      return true;
    } catch (error) { tracking.reportAssetUpdate(changes, 'failure', modality); onError((error as Error).message); return false; }
  };
  const cancelJob = (job: GenerationJob) => { tracking.reportAssetsClick('asset_tasks', 'cancel_task', { modality: job.modality }); void assetRequest({ action: 'cancel', jobId: job.id }).then(() => setHistoryRetry(value => value + 1)).catch(error => onError(error.message)); };
  const retrySave = async (job: GenerationJob) => {
    tracking.reportAssetsClick('asset_tasks', 'retry_save', { modality: job.modality });
    try {
      const { job: next } = await assetRequest<{ job: GenerationJob }>({ action: 'retry_save', jobId: job.id, requestId: `save-${job.id}` });
      knownJobs.current = mergeAssetJobs(knownJobs.current, [next]); setJobs(knownJobs.current);
    } catch (error) { onError((error as Error).message.startsWith('SAVE_NOT_AVAILABLE:') ? t('The retained files are missing, changed or unreadable. Saving cannot be retried. No new generation was requested.') : (error as Error).message); }
  };
  const resumeJob = async (job: GenerationJob) => {
    tracking.reportAssetsClick('asset_tasks', 'resume_task', { modality: job.modality });
    try {
      const { job: next } = await assetRequest<{ job: GenerationJob }>({ action: 'resume', jobId: job.id, requestId: `resume-${job.id}` });
      knownJobs.current = mergeAssetJobs(knownJobs.current, [next]); setJobs(knownJobs.current);
    } catch (error) { onError((error as Error).message); }
  };
  const openReference = async (reference: { assetId: string; versionId: string }) => {
    const request = ++selectionRequest.current;
    try {
      const { asset } = await assetRequest<{ asset: LibraryAsset }>({ action: 'get', assetId: reference.assetId });
      if (request !== selectionRequest.current) return;
      open(asset, reference.versionId);
    } catch (error) { if (request === selectionRequest.current) onError((error as Error).message); }
  };
  const viewJob = (job: GenerationJob) => { if (job.libraryAssets?.[0]) void openReference(job.libraryAssets[0]); };
  const version = selected && assetVersion(selected, versionId);
  const startDraft = (next: AssetDraft, nextMode: AssetTaskMode = 'direct') => {
    setMobileView('create');
    selectionRequest.current++; setSelectingTask(false); setDraft(next); setMode(nextMode);
    if (nextMode === 'agent') setAgentReferences([]);
    setTaskIds(current => ({ ...current, [nextMode]: undefined })); setTaskEpoch(value => value + 1); setCreating(true);
  };
  const edit = () => {
    if (!selected || !version) return;
    tracking.reportAssetsClick('asset_detail', 'edit_version', { modality: selected.modality });
    startDraft({ modality: selected.modality, prompt: version.prompt ?? '', model: version.model, parameters: version.parameters, target: { asset: selected, versionId }, references: selected.modality === 'image' ? [{ reference: { assetId: selected.id, versionId }, name: selected.name }] : [] });
  };
  const create = () => {
    const modality = kind === 'video' || kind === 'audio' ? kind : 'image';
    tracking.reportAssetsClick('assets_library', 'create_asset', { modality });
    startDraft({ modality, prompt: '', references: [] });
  };
  const selectTask = async (task: AssetTask) => {
    const request = ++selectionRequest.current; setSelectingTask(true);
    try {
      let nextDraft = draft;
      if (task.mode === 'direct') {
        const job = task.jobs[0], referenceIds = job.library?.references ?? [];
        const references = await Promise.all(referenceIds.map(async reference => {
          const { asset } = await assetRequest<{ asset: LibraryAsset }>({ action: 'get', assetId: reference.assetId });
          if (!assetVersion(asset, reference.versionId)) throw new Error(t('A referenced version is no longer available.'));
          return { reference, name: asset.name };
        }));
        let target: AssetDraft['target'];
        if (job.library?.parentVersionId && !job.library.createNew) {
          const { asset } = await assetRequest<{ asset: LibraryAsset }>({ action: 'get', assetId: job.library.assetId });
          if (!assetVersion(asset, job.library.parentVersionId)) throw new Error(t('A referenced version is no longer available.'));
          target = { asset, versionId: job.library.parentVersionId };
        }
        nextDraft = { modality: job.modality, prompt: job.prompt, model: job.model.id, parameters: job.parameters, references, target };
      }
      if (request !== selectionRequest.current) return;
      setDraft(nextDraft); setMode(task.mode); if (task.mode === 'agent') setAgentReferences([]); setTaskIds(current => ({ ...current, [task.mode]: task.id }));
      setTaskEpoch(value => value + 1); setCreating(true); setMobileView('create');
    } catch (error) { if (request === selectionRequest.current) onError((error as Error).message); }
    finally { if (request === selectionRequest.current) setSelectingTask(false); }
  };
  const studioModality = studio?.destination.scene.modality;
  useEffect(() => {
    const activeIds = jobs
      .filter(job => (!studioModality || job.modality === studioModality) && (job.state === 'queued' || job.state === 'running'))
      .map(job => job.id);
    if (!activeIds.length) return;
    setSessionJobIds(prev => {
      const next = new Set(prev);
      let changed = false;
      for (const id of activeIds) if (!next.has(id)) { next.add(id); changed = true; }
      return changed ? Array.from(next) : prev;
    });
  }, [jobs, studioModality]);
  const savedVersions = useMemo(() => {
    const keys = new Set<string>();
    for (const asset of browser.data?.assets ?? []) {
      for (const item of asset.versions) keys.add(`${asset.id}/${item.id}`);
    }
    return keys;
  }, [browser.data?.assets]);
  const placeholderJobs = useMemo(() => {
    if (studioModality === 'audio' || (!studio && kind === 'trash')) return [];
    const sessionSet = new Set(sessionJobIds);
    const keepCompletedInPlace = Boolean(studio && (studioModality === 'image' || studioModality === 'video'));
    return jobs.filter(job => {
      if (dismissedJobIds.has(job.id)) return false;
      if (studioModality ? job.modality !== studioModality : (kind !== 'all' && job.modality !== kind)) return false;
      if (job.state === 'queued' || job.state === 'running') return true;
      if (job.savePending || resumableJob(job)) return true;
      if (job.state === 'completed') {
        if (!sessionSet.has(job.id)) return false;
        if (keepCompletedInPlace) return true;
        const outputs = job.libraryAssets;
        if (!outputs?.length) return true;
        return !outputs.every(output => savedVersions.has(`${output.assetId}/${output.versionId}`));
      }
      return sessionSet.has(job.id);
    }).sort((a, b) => {
      const aWorking = a.state === 'queued' || a.state === 'running';
      const bWorking = b.state === 'queued' || b.state === 'running';
      if (aWorking !== bWorking) return aWorking ? -1 : 1;
      return b.createdAt - a.createdAt;
    });
  }, [jobs, studioModality, studio, kind, sessionJobIds, dismissedJobIds, savedVersions]);
  const activePlaceholderCount = useMemo(
    () => placeholderJobs.filter(job => job.state === 'queued' || job.state === 'running').length,
    [placeholderJobs],
  );
  const dismissJob = useCallback((jobId: string) => setDismissedJobIds(prev => new Set(prev).add(jobId)), []);
  const hasVisiblePendingJob = useMemo(
    () => placeholderJobs.some(job => job.state !== 'completed' || !(job.libraryAssets?.length && job.libraryAssets.every(output => savedVersions.has(`${output.assetId}/${output.versionId}`)))),
    [placeholderJobs, savedVersions],
  );
  const showLibraryPlaceholders = hasVisiblePendingJob && (!studio || !guide);
  const leadingPlaceholderTiles = showLibraryPlaceholders && browser.page === 0
    ? placeholderJobs.map(job => (
      <AssetGenerationPlaceholder
        key={`job:${job.id}`}
        job={job}
        variant="tile"
        active={active}
        onCancel={cancelJob}
        onView={viewJob}
        onRetrySave={retrySave}
        onResume={resumeJob}
        onReusePrompt={applyPrompt}
        onDismiss={dismissJob}
      />
    ))
    : undefined;
  const studioModels = studioForm ? creationModels(studioForm.catalog.catalog, draft.modality, studioForm.destination.model ?? draft.model, studioForm.destination.scene, isFeatureScene(studioForm.destination.scene), draft.references.length, draft.preferredModel) : undefined;
  const studioAttachableReferences = studioForm && studioModels ? attachableReferenceLimit(studioModels, studioForm.destination.scene) : Infinity;
  const enforceOpenDesignLimits = Boolean(
    studioForm && (
      isFeatureScene(studioForm.destination.scene)
      || (studioModels?.selected ? isOpenDesignProvider(studioModels.selected.provider) : (!studioForm.catalog.catalog && studioForm.destination.scene.modality === 'image'))
    ),
  );
  const attachedReferenceVersionKeys = useMemo(
    () => new Set(draft.references.map(item => `${item.reference.assetId}/${item.reference.versionId}`)),
    [draft.references],
  );
  const validateLibraryReference = (asset: LibraryAsset, chosenVersionId: string): string | undefined => {
    const itemVersion = assetVersion(asset, chosenVersionId);
    if (!itemVersion) return undefined;
    if (!isSupportedReferenceMime(itemVersion.mimeType, itemVersion.filename)) {
      return t('OpenDesign does not accept this reference image format.');
    }
    if (enforceOpenDesignLimits && typeof itemVersion.bytes === 'number' && itemVersion.bytes > OPEN_DESIGN_MAX_REFERENCE_BYTES) {
      return t('The reference image is larger than the 2 MiB OpenDesign upload limit.');
    }
    return undefined;
  };
  const draftContextRef = useRef({ draftKey: draftKeyState, taskEpoch, sceneId: studioForm?.destination.scene.id, attachLimit: studioAttachableReferences, references: draft.references });
  useLayoutEffect(() => {
    draftContextRef.current = { draftKey: draftKeyState, taskEpoch, sceneId: studioForm?.destination.scene.id, attachLimit: studioAttachableReferences, references: draft.references };
  }, [draftKeyState, taskEpoch, studioForm?.destination.scene.id, studioAttachableReferences, draft.references]);
  const uploadingReferences = uploading;
  const uploadReferenceFiles = async (picked: File[], entry: 'library_button' | 'library_drop' | 'other' = 'library_button') => {
    if (!picked.length || !studioForm) return;
    if (uploadingRef.current) { onInfo(t('Uploading…')); return; }
    const imageFiles = picked.filter(file => !file.type || file.type.startsWith('image/'));
    if (!imageFiles.length) { onError(t('Choose an image file.')); return; }
    const live = draftContextRef.current;
    if (live.references.length >= live.attachLimit) { onError(t('Reference limit reached.')); return; }
    const skippedNonImage = imageFiles.length < picked.length;
    const uploadDraftKey = live.draftKey;
    const uploadEpoch = live.taskEpoch;
    const uploadSceneId = live.sceneId;
    const request = selectionRequest.current;
    const preserveAlpha = studioForm.destination.scene.id === 'remove-background';
    const maxBytes = enforceOpenDesignLimits ? OPEN_DESIGN_MAX_REFERENCE_BYTES : Infinity;
    const shouldContinue = () => mountedRef.current
      && draftContextRef.current.draftKey === uploadDraftKey
      && draftContextRef.current.taskEpoch === uploadEpoch
      && draftContextRef.current.sceneId === uploadSceneId;
    const attachedInBatch = new Set<string>();
    const currentEffectiveCount = () => {
      const ctx = draftContextRef.current;
      const liveKeys = new Set(ctx.references.map(existing => `${existing.reference.assetId}/${existing.reference.versionId}`));
      let pendingDistinct = 0;
      for (const key of attachedInBatch) if (!liveKeys.has(key)) pendingDistinct++;
      return { count: liveKeys.size + pendingDistinct, liveKeys, attachLimit: ctx.attachLimit };
    };
    uploadingRef.current = true;
    setUploading(true);
    const summary: AssetUploadSummary = { uploaded: 0, failed: 0, unknown: 0, reasons: new Set() };
    let attempted = 0;
    let tooLargeCount = 0;
    let unsupportedCount = 0;
    let truncated = false;
    let hitLimit = false;
    try {
      for (const file of imageFiles) {
        if (!shouldContinue()) break;
        const beforePrepare = currentEffectiveCount();
        if (beforePrepare.count >= beforePrepare.attachLimit) { truncated = true; break; }
        let ready: File;
        try {
          ({ file: ready } = await prepareReferenceImage(file, { maxBytes, preserveAlpha }));
        } catch (error) {
          if (error instanceof ReferenceImageError && error.code === 'too-large') tooLargeCount++;
          else unsupportedCount++;
          continue;
        }
        if (!shouldContinue()) break;
        const beforeUpload = currentEffectiveCount();
        if (beforeUpload.count >= beforeUpload.attachLimit) { truncated = true; break; }
        attempted++;
        try {
          const asset = await uploadLibraryAsset(ready);
          summary.uploaded++;
          if (!mountedRef.current || request !== selectionRequest.current || !shouldContinue()) continue;
          if (asset.modality !== 'image') { onError(t('Choose an image file.')); continue; }
          const afterUpload = currentEffectiveCount();
          const item = { reference: { assetId: asset.id, versionId: asset.currentVersionId }, name: asset.name };
          const itemKey = `${asset.id}/${asset.currentVersionId}`;
          const alreadyPresent = afterUpload.liveKeys.has(itemKey) || attachedInBatch.has(itemKey);
          if (!alreadyPresent) {
            if (afterUpload.count >= afterUpload.attachLimit) { hitLimit = true; continue; }
            attachedInBatch.add(itemKey);
          }
          setDraft(current => {
            if (current.references.some(existing => existing.reference.assetId === item.reference.assetId && existing.reference.versionId === item.reference.versionId)) return current;
            if (current.references.length >= draftContextRef.current.attachLimit) return current;
            return { ...current, references: [...current.references, item] };
          });
        } catch (error) {
          if (error instanceof AssetUploadError && error.outcome === 'rejected') {
            summary.failed++; if (error.reason) summary.reasons.add(error.reason);
            if (error.reason === 'unsupported' || error.reason === 'unreadable') summary.imageFormatHelp = true;
          } else summary.unknown++;
        }
      }
      if (!mountedRef.current) return;
      if (summary.uploaded || summary.unknown) refresh();
      if (attempted > 0) {
        toast.showToast(assetUploadMessage(summary), summary.failed || summary.unknown ? 'error' : 'info');
      }
      if (attempted > 0) tracking.reportLibraryImport(entry, attempted, summary.uploaded);
      if (!shouldContinue()) return;
      if (tooLargeCount > 0) onError(t('The reference image is larger than the 2 MiB OpenDesign upload limit.'));
      if (unsupportedCount > 0) onError(t('OpenDesign does not accept this reference image format.'));
      if (skippedNonImage) onError(t('Choose an image file.'));
      if (truncated || hitLimit) toast.showToast(t('Reference limit reached.'), 'info');
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) setUploading(false);
    }
  };
  const openReferencePicker = () => {
    tracking.reportAssetsClick('asset_create', 'add_reference', { task_mode: mode });
    const remainingSlots = studioForm ? Math.max(0, studioAttachableReferences - draft.references.length) : Infinity;
    setPickerMulti(Boolean(studioForm && mode === 'direct' && studioAttachableReferences > 1 && remainingSlots > 1));
    setPicking(true);
  };
  const attachReference = (item: AssetDraft['references'][number]) => {
    if (draft.references.some(existing => existing.reference.assetId === item.reference.assetId && existing.reference.versionId === item.reference.versionId)) {
      setMobileView('create');
      return;
    }
    const sourceAsset = browser.data?.assets.find(candidate => candidate.id === item.reference.assetId);
    if (sourceAsset) {
      const invalidReason = validateLibraryReference(sourceAsset, item.reference.versionId);
      if (invalidReason) { onError(invalidReason); return; }
    }
    if (draft.references.length >= studioAttachableReferences) {
      onError(t('Reference limit reached.'));
      return;
    }
    setDraft(current => {
      if (current.references.length >= draftContextRef.current.attachLimit) return current;
      if (current.references.some(existing => existing.reference.assetId === item.reference.assetId && existing.reference.versionId === item.reference.versionId)) return current;
      return { ...current, references: [...current.references, item] };
    });
    setMobileView('create');
  };
  const blankCanvas = layout === 'canvas' && browser.data?.total === 0 && !placeholderJobs.length && !browser.query && (mediaGenerations || browser.source === 'all');
  const studioEmpty = studio && (layout === 'canvas' ? <StudioIdeas destination={studio.destination} onPrompt={applyPrompt}
    modelName={studioModels?.selected && imageModelLabel(studioModels.selected)} /> : <p className="om-muted">{t('No assets yet')}</p>);
  const history = { tasks, selectedKey, loading: historyLoading, error: historyError, onRetry: () => { setHistoryLoading(true); setHistoryRetry(value => value + 1); }, onSelect: (task: AssetTask) => { tracking.reportAssetsClick('asset_tasks', 'select_task', { task_mode: task.mode }); void selectTask(task); } };
  const taskMenu = <AssetTaskMenu {...history} disabled={selectingTask} />;
  const composer = <AssetComposer studio={studioForm} key={taskEpoch} active={active} draft={draft} setDraft={setDraft} agentReferences={agentReferences} setAgentReferences={setAgentReferences} jobs={jobs} showCurrentJob={mediaGenerations ? false : !showLibraryPlaceholders} mode={mode} onMode={next => { if (next !== mode) tracking.reportAssetsClick('asset_create', 'mode_switch', { task_mode: next }); setMode(next); }} taskIds={taskIds} history={history} selectingTask={selectingTask}
    onNew={() => startDraft(mode === 'agent' ? draft : { modality: draft.modality, prompt: '', references: [] }, mode)} onChatChanged={chatChanged}
    onChatStarted={id => setTaskIds(current => ({ ...current, agent: id }))}
    onCancel={cancelJob} onRetrySave={retrySave} onResume={resumeJob} onView={viewJob} uploadingReferences={uploadingReferences} onUploadReference={studioForm ? () => referenceUpload.current?.click() : undefined} onUploadFiles={studioForm ? (files, source) => { void uploadReferenceFiles(files, source === 'paste' ? 'other' : 'library_drop'); } : undefined} onReference={openReferencePicker} onCreated={job => {
      knownJobs.current = mergeAssetJobs(knownJobs.current, [job]); setJobs(knownJobs.current); setTaskIds(current => ({ ...current, direct: job.id }));
      setSessionJobIds(prev => prev.includes(job.id) ? prev : [...prev, job.id]);
      setDismissedJobIds(prev => { if (!prev.has(job.id)) return prev; const next = new Set(prev); next.delete(job.id); return next; });
      if (studio) setStudioTab('library');
      else if (kind === 'trash' || (kind !== 'all' && kind !== job.modality)) setKind(job.modality);
      if (browser.source === 'upload') browser.setSource('all');
      if (browser.query) browser.setQuery('');
      if (browser.page > 0) browser.setPage(0);
      if (gallery.current) gallery.current.scrollTo({ top: 0, behavior: 'smooth' });
      refresh(); toast.showToast(t(studio ? 'Added to Generations' : 'Generation started. Track it in Tasks.'), 'info');
    }} onError={onError} onInfo={onInfo} onClose={() => { selectionRequest.current++; setSelectingTask(false); setCreating(false); }} />;
  const soundWorkbench = studio?.destination.scene.modality === 'audio' && !audioStudio;
  const libraryToolbar = <AssetGalleryToolbar browser={browser} games={gamesView} onGames={() => { setGamesView(true); if (kind === 'trash') setKind('all'); }} onKindChange={next => {
    if (next !== kind || gamesView) tracking.reportAssetsClick('assets_library', next === 'trash' ? 'trash_view' : 'kind_filter', { asset_kind: next });
    setGamesView(false); setKind(next);
  }} />;
  const detailModels = studio?.catalog.catalog?.models;
  const detailAudioKind = selected?.modality === 'audio' && version ? classifyAudioTrackTab(version.model, detailModels, version.source, version.audioKind) : undefined;
  const detailModelLabel = selected?.modality === 'audio' && version ? resolveAudioModelLabel(version.model, detailModels) : undefined;
  const detailVoiceName = detailAudioKind === 'speech' && version ? resolveSavedVoiceName(version.parameters?.voice, version.model, detailModels, true) : undefined;
  const detailDurationLabel = version?.duration && version.duration > 0 ? formatDuration(version.duration) : undefined;
  const editSoundAsset = () => {
    if (!selected || !version || !studio) return;
    tracking.reportAssetsClick('asset_detail', 'edit_version', { modality: selected.modality });
    const classified = classifyAudioTrackTab(version.model, detailModels, version.source, version.audioKind);
    const targetTab = classified === 'upload' ? (studio.soundTab === 'sfx' || studio.soundTab === 'speech' ? studio.soundTab : 'music') : classified;
    const nextDraft: AssetDraft = {
      modality: 'audio',
      prompt: version.prompt ?? '',
      model: version.model,
      parameters: version.parameters,
      references: [],
    };
    closePreview();
    if (studio.selectSoundTab) {
      studio.selectSoundTab(targetTab, nextDraft, version.model ?? null);
    } else if (studio.reuseInScene) {
      studio.reuseInScene(targetTab === 'speech' ? 'speech' : 'music', nextDraft, version.model ?? null);
    } else {
      setDraft(nextDraft);
    }
    setMobileView('create');
    toast.showToast(t('Prompt and settings loaded'), 'info');
  };
  return <div className="om-assets-page" data-scene-layout={layout} data-creating={creating} data-previewing={Boolean(selected)} data-mobile-view={mobileView}>
    {selected ? <AssetDetailWorkspace asset={selected} versionId={versionId} active={active} uploading={uploading} saving={updatingAssets.has(selected.id)} editor={creating ? composer : undefined} taskControls={mediaGenerations || soundWorkbench ? undefined : taskMenu}
      backLabel={soundWorkbench ? t('Audio') : undefined}
      modelDisplayName={detailModelLabel}
      voiceName={detailVoiceName}
      durationLabel={detailDurationLabel}
      editLabel={soundWorkbench ? t('Recreate') : undefined}
      navigation={<AssetBrowserContent browser={browser} onOpen={open} compact selectedId={selected.id} />}
      onBack={() => { tracking.reportAssetsClick('asset_detail', 'close_detail', { modality: selected.modality }); closePreview(); }} onVersion={id => { if (id !== versionId) tracking.reportAssetsClick('asset_detail', 'switch_version', { modality: selected.modality }); setVersionId(id); onAssetRoute?.(selected.id, id); }} onUpdate={changes => update(selected.id, changes)} onEdit={soundWorkbench ? editSoundAsset : edit}
      onReference={selected.modality === 'image' ? () => { tracking.reportAssetsClick('asset_detail', 'use_as_reference', { modality: selected.modality }); startDraft({ modality: selected.modality, prompt: '', references: [{ reference: { assetId: selected.id, versionId }, name: selected.name }] }); } : undefined}
      onFirstFrame={studio?.useAsFirstFrame && selected.modality === 'image' && version ? () => studio.useAsFirstFrame?.({ reference: { assetId: selected.id, versionId: version.id }, name: selected.name }) : undefined}
      onOpenReference={reference => { void openReference(reference); }}
      onUpload={() => { tracking.reportAssetsClick('asset_detail', 'upload', { modality: selected.modality }); replace.current?.click(); }} onDownload={() => { tracking.reportAssetsClick('asset_detail', 'download_asset', { modality: selected.modality }); toast.showToast(t('Download started'), 'info'); }} /> : soundWorkbench && studio ? <SoundStudioWorkspace
        active={active}
        studio={studio}
        draft={draft}
        setDraft={setDraft}
        browser={browser}
        jobs={jobs}
        uploading={uploading}
        updatingAssets={updatingAssets}
        mobileView={mobileView}
        setMobileView={setMobileView}
        onUploadClick={() => { tracking.reportAssetsClick('assets_library', 'upload'); upload.current?.click(); }}
        onDropFiles={files => { void importFiles(files, false, 'library_drop'); }}
        onOpenAsset={asset => { tracking.reportAssetsClick('assets_library', 'open_asset', { modality: asset.modality }); open(asset); }}
        onTrashAsset={assetId => update(assetId, { trashed: true })}
        onCancelJob={cancelJob}
        onRetrySave={retrySave}
        onResumeJob={resumeJob}
        onViewJob={viewJob}
        onCreated={job => {
          knownJobs.current = mergeAssetJobs(knownJobs.current, [job]); setJobs(knownJobs.current); setTaskIds(current => ({ ...current, direct: job.id }));
          refresh();
        }}
        onError={onError}
        onNotify={message => toast.showToast(message, 'info')}
        onDownload={() => { tracking.reportAssetsClick('assets_library', 'download_asset', { modality: 'audio' }); toast.showToast(t('Download started'), 'info'); }}
      /> : <>
    {creating && <div className="om-assets-view-switch" role="group" aria-label={t('Workspace assets')}><div className="om-choice-tabs">
      <Button variant="plain" className="om-nav-item" aria-pressed={mobileView === 'library'} onClick={() => setMobileView('library')}>{t(hasGuide ? 'Guide & assets' : 'Asset library')}</Button>
      <Button variant="plain" className="om-nav-item" aria-pressed={mobileView === 'create'} onClick={() => setMobileView('create')}>{t('AI Create')}</Button>
    </div></div>}
    <div className="om-assets-library">
    {creating && studio && <ResizablePane className="om-creator-pane" storageKey="motion-studio-controls-width" initial={378} min={310} max={650} edge="right" label={t('Resize creator')}>{composer}</ResizablePane>}
    <main ref={gallery} className="om-assets-main" onDragOver={e => { if (!mediaGenerations && e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={e => { if (!mediaGenerations && e.dataTransfer.files.length) { e.preventDefault(); void importFiles(Array.from(e.dataTransfer.files), false, 'library_drop'); } }}>
      {audioStudio?.openCreate ? <AudioStudioLanding destination={audioStudio.destination} active={active} onPrompt={audioStudio.openCreate} onCreate={() => audioStudio.openCreate?.()} /> : <>
      {studio ? <header className="om-assets-heading">{hasGuide ? <div className="om-choice-tabs" role="group" aria-label={t('Guide & assets')}>
        <Button variant="plain" className="om-nav-item" aria-pressed={guide} onClick={() => setStudioTab('guide')}>{t('How it works')}</Button>
        <Button variant="plain" className="om-nav-item" aria-pressed={!guide} onClick={() => setStudioTab('library')}>{t('Generations')}{activePlaceholderCount > 0 && <span className="om-badge om-tab-count" role="status">{activePlaceholderCount}</span>}</Button>
      </div> : <h2 className="om-subtitle">{t('Generations')}</h2>}{!mediaGenerations && <div className="om-asset-actions">{taskMenu}</div>}</header> : <header className="om-assets-heading"><div><h1 className="om-title">{t(kind === 'trash' ? 'Trash' : 'Workspace assets')}</h1><p className="om-muted">{t('One library for every creation.')}</p></div><div className="om-asset-actions">{taskMenu}<Button variant="ghost" className="om-button h-auto" disabled={uploading} onClick={() => { tracking.reportAssetsClick('assets_library', 'upload'); upload.current?.click(); }}><RemixIcon name="upload-2-line" size={16} />{t(uploading ? 'Uploading…' : 'Upload')}</Button><Button variant="ghost" className="om-button h-auto" data-primary onClick={create}><RemixIcon name="add-line" size={16} />{t('AI Create')}</Button></div></header>}

      {guide && studio ? <StudioIdeas destination={studio.destination} active={active} onPrompt={applyPrompt} /> : studio && (studio.destination.scene.modality === 'image' || studio.destination.scene.modality === 'video') ? (
        <MediaGenerationHistory
          modality={studio.destination.scene.modality}
          browser={browser}
          active={active}
          models={studio.catalog.catalog?.models}
          placeholderJobs={placeholderJobs}
          emptyContent={studioEmpty}
          blankCanvas={blankCanvas}
          onOpenDetail={asset => { tracking.reportAssetsClick('assets_library', 'open_asset', { modality: asset.modality }); open(asset); }}
          onReusePrompt={applyPrompt}
          onUseReference={studio.destination.scene.modality === 'image' ? attachReference : undefined}
          onUseFirstFrame={studio.useAsFirstFrame}
          onCancelJob={cancelJob}
          onViewJob={viewJob}
          onRetrySave={retrySave}
          onResumeJob={resumeJob}
          onDismissJob={dismissJob}
          onDownload={() => { tracking.reportAssetsClick('assets_library', 'download_asset', { modality: studio.destination.scene.modality }); toast.showToast(t('Download started'), 'info'); }}
        />
      ) : !studio && gamesView ? <section aria-label={t('Games')}>{libraryToolbar}<div className="om-asset-results"><GameAssetsGrid data={myGames} query={browser.query} /></div></section> : <AssetBrowserContent browser={browser} hoverPreview={active} leadingTiles={leadingPlaceholderTiles} emptyContent={studioEmpty} toolbar={studio ? (blankCanvas ? <></> : undefined) : <>{libraryToolbar}{kind === 'all' && !browser.query && browser.source === 'all' && <GameAssetsRow data={myGames} onViewAll={() => setGamesView(true)} />}</>} onOpen={asset => { tracking.reportAssetsClick('assets_library', 'open_asset', { modality: asset.modality }); open(asset); }} onCreate={studio ? undefined : modality => { tracking.reportAssetsClick('assets_library', 'create_asset', { modality }); startDraft({ modality, prompt: '', references: [] }); }} />}
      </>}
    </main>
    {creating && !studio && <ResizablePane className="om-creator-pane" storageKey="motion-assets-creator-width" initial={460} min={340} max={800} edge="left" label={t('Resize creator')}>{composer}</ResizablePane>}
    </div>
    </>}
    <input ref={upload} type="file" multiple accept={studio ? studio.destination.scene.modality + '/*' : 'image/*,video/*,audio/*'} hidden onChange={e => { void importFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
    <input ref={referenceUpload} data-reference-upload="true" type="file" multiple={studioAttachableReferences > 1} accept="image/*" hidden onChange={event => {
      const picked = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = '';
      void uploadReferenceFiles(picked, 'library_button');
    }} />
    <input ref={replace} type="file" accept={`${selected?.modality ?? 'image'}/*`} hidden onChange={e => { void importFiles(Array.from(e.target.files ?? []), true); e.target.value = ''; }} />
    {active && picking && (() => {
      const remainingSlots = studioForm ? Math.max(0, studioAttachableReferences - draft.references.length) : Infinity;
      const multiPickReferences = Boolean(pickerMulti && studioForm && mode === 'direct');
      return <AssetPicker
        imageOnly={mode === 'direct' || Boolean(studioForm)}
        multiple={multiPickReferences}
        maxSelect={multiPickReferences ? remainingSlots : undefined}
        attachedVersionKeys={studioForm && mode === 'direct' ? attachedReferenceVersionKeys : undefined}
        multiConfirmLabel={multiPickReferences ? 'Use selected ({count})' : undefined}
        revision={revision}
        onClose={() => setPicking(false)}
        onPickMany={multiPickReferences ? items => {
          const live = draftContextRef.current;
          const existingKeys = new Set(live.references.map(r => `${r.reference.assetId}/${r.reference.versionId}`));
          const additions: AssetDraft['references'] = [];
          const validationErrors = new Set<string>();
          let hitLimit = false;
          for (const { reference, asset } of items) {
            const key = `${reference.assetId}/${reference.versionId}`;
            if (existingKeys.has(key)) continue;
            const invalidReason = validateLibraryReference(asset, reference.versionId);
            if (invalidReason) { validationErrors.add(invalidReason); continue; }
            if (existingKeys.size >= live.attachLimit) { hitLimit = true; break; }
            existingKeys.add(key);
            additions.push({ reference, name: asset.name });
          }
          if (additions.length) {
            setDraft(current => {
              const seen = new Set(current.references.map(r => `${r.reference.assetId}/${r.reference.versionId}`));
              const next = [...current.references];
              for (const item of additions) {
                const key = `${item.reference.assetId}/${item.reference.versionId}`;
                if (seen.has(key) || next.length >= draftContextRef.current.attachLimit) continue;
                seen.add(key);
                next.push(item);
              }
              return { ...current, references: next };
            });
          }
          setPicking(false);
          for (const message of validationErrors) onError(message);
          if (hitLimit) toast.showToast(t('Reference limit reached.'), 'info');
        } : undefined}
        onPick={(reference, asset) => {
          if (mode === 'agent') {
            const references = [...agentReferences.filter(r => r.reference.assetId !== reference.assetId || r.reference.versionId !== reference.versionId), { reference, name: asset.name }];
            setAgentReferences(references); setPicking(false); return;
          }
          const alreadyAttached = draft.references.some(r => r.reference.assetId === reference.assetId && r.reference.versionId === reference.versionId);
          if (studioForm && !alreadyAttached) {
            const invalidReason = validateLibraryReference(asset, reference.versionId);
            if (invalidReason) { onError(invalidReason); setPicking(false); return; }
          }
          if (studioForm && !alreadyAttached && draft.references.length >= studioAttachableReferences) {
            onError(t('Reference limit reached.')); setPicking(false); return;
          }
          const references = [...draft.references.filter(r => r.reference.assetId !== reference.assetId || r.reference.versionId !== reference.versionId), { reference, name: asset.name }];
          setDraft({ ...draft, references }); setPicking(false);
        }}
      />;
    })()}
    <StudioToastViewport {...toast} />
  </div>;
}
