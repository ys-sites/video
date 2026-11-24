import { Button } from 'open-design-ui/button';
import { useEffect, useId, useImperativeHandle, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { assetDownloadUrl, assetMediaUrl, assetUploadAccept, type AssetReference, type LibraryAsset } from '../../../../shared/asset-library';
import { modelReferenceLimit, type Model } from '../../../../shared/gateway';
import { generationOptions, type GenerationOption } from '../../../../shared/generation-options';
import type { PoolItem, ScenarioRun, StepIteration } from '../../../../shared/scenario-runs';
import { resolveScenarioStepPrompt } from '../../../../shared/scenario-prompts';
import { MenuItem, Select, Tab, TabPanel, Tabs, TabsList } from '../../components/ui';
import { FilterChip } from '../../components/ui/FilterChip';
import { FieldTextarea } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Skeleton';
import { assetUploadFormatsHint, assetUploadMessage, recordAssetUploadFailure, type AssetUploadSummary } from '../../i18n/assetUploadMessages';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { AssetAudioPreview } from '../../motion/AssetAudioPreview';
import { AssetPicker } from '../../motion/AssetBrowser';
import { uploadLibraryAsset } from '../../motion/assetClient';
import { needsImage, sceneDestination, studioScenes } from '../../motion/creativeStudios';
import { DurationControl } from '../../motion/GenerationParameters';
import { providerDisplayName } from '../../motion/imageMenuModels';
import { useMediaCatalog } from '../../motion/useMediaCatalog';
import { ScenarioApiError } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import { BindingSlot } from './BindingSlot';
import { MotionPanel } from './MotionPanel';
import { StepCapabilityBar, StepMediaOutputs } from './StepCapabilityBar';
import { StepVideoPreview } from './StepVideoPreview';
import {
  extractErrorMessage,
  isProviderLimitOrAuthError,
  isScenarioConflictError,
  jobStateLabel,
  pickDefaultScenarioModelId,
  selectScenarioModels,
  triggerUrlDownload,
} from './stepUtils';

function AudioPreviewCard({ src }: { src: string }) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="om-step-inline-error">
        <span>{t('Audio preview unavailable.')}</span>
        <Button variant="ghost" size="sm" onClick={() => setFailed(false)}>{t('Retry')}</Button>
      </div>
    );
  }
  return <AssetAudioPreview src={src} onError={() => setFailed(true)} />;
}

function findUpstreamScript(run: ScenarioRun | null): string {
  if (!run) return '';
  for (const stepState of Object.values(run.steps)) {
    const active = stepState.iterations.find(iter => iter.id === stepState.activeIterationId);
    const activeScript = active?.outputs.find((out): out is { type: 'script'; text: string } => out.type === 'script');
    if (activeScript?.text.trim()) return activeScript.text;
    for (let i = stepState.iterations.length - 1; i >= 0; i -= 1) {
      const out = stepState.iterations[i].outputs.find((item): item is { type: 'script'; text: string } => item.type === 'script');
      if (out?.text.trim()) return out.text;
    }
  }
  return '';
}

const durationKeys = new Set(['duration', 'duration_seconds', 'music_length_ms']);
const minimalFieldKeys = new Set(['aspect_ratio', 'ratio', 'image_size', 'n', 'num_images', 'voice', ...durationKeys]);

function workflowMusicDurationField(model: Model | undefined) {
  if (model?.modelId === 'elevenlabs-music-v2' && model.mode === 'text-to-audio'
    && (model.provider === 'account' || model.provider === 'opendesign')) {
    const account = model.provider === 'account';
    const unit = account ? 1 : 1000;
    // Cover the workflow's short-film durations without exposing long music results that the current account path cannot save.
    return {
      unit,
      field: { key: account ? 'duration' : 'music_length_ms', label: 'Duration (seconds)', kind: 'number', min: 3 * unit, max: 60 * unit, step: unit, default: 3 * unit } as const,
    };
  }
}

function pickMinimalFields(model: Model | undefined, hasInputImage: boolean): GenerationOption[] {
  if (!model) return [];
  const options = generationOptions(model, hasInputImage);
  if (!options) return [];
  return options.fields.filter(
    field =>
      (field.kind === 'choice' && field.choices && field.choices.length > 0 && (minimalFieldKeys.has(field.key) || field.presentation === 'ratio' || field.presentation === 'count')) ||
      (field.kind === 'number' && (minimalFieldKeys.has(field.key) || field.presentation === 'count')),
  ).slice(0, 3);
}

function secondsDurationField(field: GenerationOption): GenerationOption | undefined {
  if (!durationKeys.has(field.key)) return;
  if (field.kind === 'choice' && field.choices?.every(choice => typeof choice.value === 'number')) return field;
  if (field.kind !== 'number' || field.min === undefined || field.max === undefined || field.max <= field.min) return;
  if (field.key !== 'music_length_ms') return field;
  return { ...field, min: field.min / 1000, max: field.max / 1000, step: (field.step ?? 1000) / 1000 };
}

export function MediaStep(props: StepProps) {
  const {
    scenario,
    step,
    state,
    run,
    active,
    api,
    pool,
    toast,
    nav,
    validateNextRef,
    renderExportMenu,
    renderIterations,
    renderOutputPanel,
    renderCapabilityBar,
  } = props;

  const { t, locale } = useI18n();
  const modality: 'image' | 'video' | 'audio' =
    step.type === 'video' ? 'video' : step.type === 'audio' ? 'audio' : 'image';
  const uploadHintId = useId();
  const uploadHint = assetUploadFormatsHint(t, modality);

  const hasMotionTab = modality === 'video' && Boolean(step.motion);
  const [videoTab, setVideoTab] = useState<'generate' | 'motion'>('generate');

  // Scenes / audio modes
  const audioModes = step.audioModes ?? (modality === 'audio' ? ['speech', 'music'] : []);
  const sceneIds = modality === 'audio'
    ? audioModes
    : (step.scenes ?? (modality === 'video' ? ['image-to-video', 'text-to-video'] : ['text-to-image']));

  const initialScene = typeof state.draft.scene === 'string' && sceneIds.includes(state.draft.scene as never)
    ? state.draft.scene
    : sceneIds[0];
  const [activeSceneId, setActiveSceneId] = useState<string>(initialScene);

  useEffect(() => {
    if (!sceneIds.includes(activeSceneId as never)) {
      setActiveSceneId(sceneIds[0]);
    }
  }, [sceneIds, activeSceneId]);

  const currentScene = useMemo(
    () => studioScenes.find(s => s.id === activeSceneId),
    [activeSceneId],
  );
  const isSpeechMode = modality === 'audio' && activeSceneId === 'speech';
  const upstreamScript = useMemo(() => (isSpeechMode ? findUpstreamScript(run) : ''), [isSpeechMode, run]);

  const seededPrompt = useMemo(() => {
    if (isSpeechMode && upstreamScript) return upstreamScript;
    return resolveScenarioStepPrompt(scenario, step, run?.brief ?? {}, state.draft, locale);
  }, [isSpeechMode, upstreamScript, scenario, step, run?.brief, state.draft, locale]);

  const [prompt, setPrompt] = useState(seededPrompt);
  const promptDirtyRef = useRef(false);

  const userSelectedModelRef = useRef(false);

  useEffect(() => {
    promptDirtyRef.current = false;
    userSelectedModelRef.current = false;
    setPrompt(seededPrompt);
  }, [step.id, activeSceneId]);

  useEffect(() => {
    if (!promptDirtyRef.current) {
      setPrompt(seededPrompt);
    }
  }, [seededPrompt]);

  // Catalog & compatible models
  const { catalog, failed: catalogFailed, retry: retryCatalog } = useMediaCatalog(active);
  const availableModels = useMemo(
    () => selectScenarioModels(catalog, modality, currentScene),
    [catalog, modality, currentScene],
  );

  const defaultModelId = useMemo(
    () => pickDefaultScenarioModelId(availableModels, catalog, modality, state.draft.model),
    [availableModels, catalog, modality, state.draft.model],
  );

  const [selectedModelId, setSelectedModelId] = useState(defaultModelId);
  useEffect(() => {
    if (!userSelectedModelRef.current || !availableModels.some(m => m.id === selectedModelId)) {
      setSelectedModelId(defaultModelId);
    }
  }, [availableModels, selectedModelId, defaultModelId]);

  const selectedModel = useMemo(
    () => availableModels.find(m => m.id === selectedModelId) ?? availableModels[0],
    [availableModels, selectedModelId],
  );

  // Input slot bindings
  const referenceIds = modality === 'image'
    ? (state.bindings.references ?? [])
    : modality === 'video'
      ? (state.bindings.firstFrame ?? [])
      : [];
  const soundtrackIds = modality === 'video' ? (state.bindings.soundtrack ?? []) : [];
  const hasInputImage = referenceIds.some(id => pool.byId.get(id)?.kind === 'image');
  const requiresReference = Boolean(currentScene && needsImage(currentScene));
  const needsFirstFrame = modality === 'video' && videoTab === 'generate' && requiresReference;
  const [firstFrameError, setFirstFrameError] = useState(false);
  const firstFramePickRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!needsFirstFrame || hasInputImage) setFirstFrameError(false);
  }, [needsFirstFrame, hasInputImage]);

  useImperativeHandle(validateNextRef, () => () => {
    if (!needsFirstFrame || hasInputImage) return true;
    setFirstFrameError(true);
    firstFramePickRef.current?.scrollIntoView({ block: 'center' });
    firstFramePickRef.current?.focus({ preventScroll: true });
    return false;
  }, [needsFirstFrame, hasInputImage]);

  const maxReferences = modality === 'image'
    ? Math.max(1, selectedModel ? modelReferenceLimit(selectedModel) || 5 : 5)
    : 1;

  // Minimal parameters
  const hasEditingInput = modality === 'image' && hasInputImage;
  const musicDuration = useMemo(() => workflowMusicDurationField(selectedModel), [selectedModel]);
  const paramFields = useMemo<GenerationOption[]>(
    () => musicDuration ? [musicDuration.field] : pickMinimalFields(selectedModel, hasEditingInput),
    [musicDuration, selectedModel, hasEditingInput],
  );
  const briefDuration = run?.brief.durationSeconds;
  const briefAspect = scenario.id === 'motion-full-chain' && step.id === 'storyboard'
    ? run?.brief.aspect || scenario.briefFields.find(field => field.id === 'aspect')?.options?.[0]?.id
    : undefined;
  const [paramOverrides, setParamOverrides] = useState<Record<string, unknown>>({});

  useEffect(() => {
    setParamOverrides({});
  }, [paramFields]);

  const params = useMemo(() => {
    const defaults: Record<string, unknown> = {};
    for (const field of paramFields) {
      const briefChoice = briefAspect && field.presentation === 'ratio'
        ? field.choices?.find(choice => choice.value === briefAspect || choice.label === briefAspect)
        : undefined;
      const value = briefChoice?.value ?? field.default ?? field.choices?.[0]?.value
        ?? (durationKeys.has(field.key) ? field.min : undefined);
      if (value !== undefined) defaults[field.key] = value;
    }
    const seconds = typeof briefDuration === 'string' && briefDuration.trim() ? Number(briefDuration) : NaN;
    if (musicDuration && Number.isFinite(seconds)) {
      const { field, unit } = musicDuration;
      const value = Math.round(seconds) * unit;
      defaults[field.key] = Math.min(field.max, Math.max(field.min, value));
    }
    return { ...defaults, ...paramOverrides };
  }, [briefAspect, briefDuration, musicDuration, paramFields, paramOverrides]);

  // Generation / upload / workspace picker state
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickingAsset, setPickingAsset] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset providerUnavailable when catalog reloads with models
  useEffect(() => {
    if (availableModels.length > 0) setProviderUnavailable(false);
  }, [availableModels.length]);

  const noProvider = (catalog !== undefined && availableModels.length === 0) || providerUnavailable;

  const persistDraftPrompt = async (nextPrompt: string) => {
    const edited = promptDirtyRef.current;
    if (!run || (!edited && !userSelectedModelRef.current && activeSceneId === initialScene)) return;
    if (edited) promptDirtyRef.current = false;
    try {
      await api.mutate(`draft:${step.id}`, 'update_step', {
        stepId: step.id,
        draft: {
          ...(edited ? { prompt: nextPrompt, promptEdited: true } : {}),
          scene: activeSceneId,
          ...(userSelectedModelRef.current && selectedModel ? { model: selectedModel.id } : {}),
        },
      });
    } catch {
      if (edited) promptDirtyRef.current = true;
    }
  };

  const handleGenerate = async (override?: { prompt?: string; model?: string; parameters?: Record<string, unknown>; inputs?: string[]; scene?: string; mode?: 'text-to-image' | 'text-to-video' | 'text-to-audio' | 'text-to-speech' }) => {
    const targetModel = override?.model ?? selectedModel?.id;
    const targetPrompt = (override?.prompt ?? prompt).trim();
    if (!targetModel || !targetPrompt) return;

    const targetRefs = override?.inputs ?? referenceIds;
    const targetScene = override?.scene ?? activeSceneId;
    const targetMode = override?.mode ?? (
      modality === 'audio'
        ? (targetScene === 'speech' ? 'text-to-speech' : 'text-to-audio')
        : undefined
    );
    const chosenParams = override?.parameters ?? Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== ''),
    );

    setGenerating(true);
    try {
      await api.mutate(`generate:${step.id}`, 'generate', {
        stepId: step.id,
        modality,
        model: targetModel,
        ...(targetMode ? { mode: targetMode } : {}),
        prompt: targetPrompt,
        ...(modality !== 'image' ? { locale } : {}),
        ...(Object.keys(chosenParams).length ? { parameters: chosenParams } : {}),
        ...(targetRefs.length ? { referencePoolItemIds: targetRefs } : {}),
        ...(targetScene ? { scene: targetScene } : {}),
      });
      toast.showToast(t('Generation started'), 'info', 'feedback');
    } catch (error) {
      if (error instanceof ScenarioApiError && error.code === 'PROVIDER_UNAVAILABLE') {
        setProviderUnavailable(true);
        toast.showToast(t('No configured model provider is available for this step.'), 'error', 'feedback');
      } else if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Generation failed to start.')), 'error', 'feedback');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleCancelJob = async (iterationId: string) => {
    setCancellingId(iterationId);
    try {
      await api.mutate(`cancel:${step.id}:${iterationId}`, 'cancel', {
        stepId: step.id,
        iterationId,
      });
      toast.showToast(t('Generation cancelled'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not cancel generation.')), 'error', 'feedback');
      }
    } finally {
      setCancellingId(null);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (uploading || !files.length) return;
    setUploading(true);
    try {
      const uploaded: LibraryAsset[] = [];
      const summary: AssetUploadSummary = { uploaded: 0, failed: 0, unknown: 0, reasons: new Set() };
      for (const file of files) {
        try {
          uploaded.push(await uploadLibraryAsset(file, modality === 'video' ? { modality: 'video' } : {}));
        } catch (error) {
          recordAssetUploadFailure(summary, file, error);
        }
      }
      if (modality !== 'image') summary.imageFormatHelp = false;
      if (!uploaded.length) {
        toast.showToast(assetUploadMessage(summary), 'error', 'feedback');
        return;
      }
      const addRes = await api.mutate<{ run: ScenarioRun; poolItemIds: string[] }>(
        `upload-pool:${step.id}`,
        'add_pool',
        {
          items: uploaded.map(asset => ({
            ref: { type: 'asset', assetId: asset.id, versionId: asset.currentVersionId },
            label: asset.name,
            stepId: step.id,
            source: 'upload',
          })),
        },
      );
      await api.mutate(`upload-iter:${step.id}`, 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'upload',
          outputs: addRes.poolItemIds.map(poolItemId => ({ type: 'pool', poolItemId })),
        },
      });
      pool.highlight(addRes.poolItemIds);
      if (summary.failed || summary.unknown) {
        summary.uploaded = uploaded.length;
        toast.showToast(assetUploadMessage(summary), 'error', 'feedback');
      } else {
        toast.showToast(t('Uploaded {count} files', { count: uploaded.length }), 'info', 'feedback');
      }
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not upload files.')), 'error', 'feedback');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleWorkspacePick = async (ref: AssetReference, asset: LibraryAsset) => {
    setPickingAsset(true);
    try {
      const addRes = await api.mutate<{ run: ScenarioRun; poolItemIds: string[] }>(
        `workspace-pool:${step.id}:${asset.id}`,
        'add_pool',
        {
          items: [{
            ref: { type: 'asset', assetId: ref.assetId, versionId: ref.versionId },
            label: asset.name,
            stepId: step.id,
            source: 'workspace',
          }],
        },
      );
      await api.mutate(`workspace-iter:${step.id}:${asset.id}`, 'add_iteration', {
        stepId: step.id,
        iteration: {
          source: 'workspace',
          outputs: addRes.poolItemIds.map(poolItemId => ({ type: 'pool', poolItemId })),
        },
      });
      pool.highlight(addRes.poolItemIds);
      setPickerOpen(false);
      toast.showToast(t('Added from workspace assets'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not add workspace asset.')), 'error', 'feedback');
      }
    } finally {
      setPickingAsset(false);
    }
  };

  // Active / latest iteration & resolved pool outputs
  const activeIteration = useMemo(() => {
    if (state.activeIterationId) {
      const found = state.iterations.find(iter => iter.id === state.activeIterationId);
      if (found) return found;
    }
    return state.iterations.at(-1) ?? null;
  }, [state.iterations, state.activeIterationId]);

  const activePoolOutputs = useMemo(() => {
    if (!activeIteration) return [];
    return activeIteration.outputs
      .filter((out): out is { type: 'pool'; poolItemId: string } => out.type === 'pool')
      .map(out => pool.byId.get(out.poolItemId))
      .filter((item): item is PoolItem => Boolean(item));
  }, [activeIteration, pool.byId]);

  const activeDownloadableAssets = useMemo(
    () => activePoolOutputs.filter(
      (item): item is PoolItem & { ref: { type: 'asset'; assetId: string; versionId: string } } =>
        item.ref.type === 'asset',
    ),
    [activePoolOutputs],
  );

  const handleDownloadActiveFiles = () => {
    if (!activeDownloadableAssets.length) return;
    for (const item of activeDownloadableAssets) {
      triggerUrlDownload(assetDownloadUrl(item.ref.assetId, item.ref.versionId, item.label));
    }
    toast.showToast(t('Download started'), 'info', 'feedback');
  };

  const failedModelId = activeIteration?.job?.model;
  const failedModelAvailable = Boolean(failedModelId && availableModels.some(m => m.id === failedModelId));
  const retryModelId = selectedModel && (!failedModelAvailable || selectedModel.id !== failedModelId)
    ? selectedModel.id
    : (failedModelId || selectedModel?.id);
  const switchedModel = Boolean(retryModelId && failedModelId && retryModelId !== failedModelId);
  const showLimitHint = activeIteration?.job?.state === 'failed' && isProviderLimitOrAuthError(activeIteration.job.error);
  const activeJobModelLabel = useMemo(() => {
    const modelId = activeIteration?.job?.model;
    if (!modelId) return '';
    return (
      catalog?.models.find(m => m.id === modelId)?.label ??
      availableModels.find(m => m.id === modelId)?.label ??
      modelId
    );
  }, [activeIteration?.job?.model, availableModels, catalog?.models]);

  const isJobActive = Boolean(
    activeIteration?.job &&
      (activeIteration.job.state === 'queued' || activeIteration.job.state === 'running'),
  );
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isJobActive || !activeIteration) {
      setElapsedSeconds(0);
      return;
    }
    const updateElapsed = () => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - activeIteration.createdAt) / 1000)));
    };
    updateElapsed();
    const timer = setInterval(updateElapsed, 1000);
    return () => clearInterval(timer);
  }, [activeIteration, isJobActive]);

  const formattedElapsed = `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
  const activeJobPhaseTitle = activeIteration?.job?.state === 'queued'
    ? t('Waiting in queue…')
    : modality === 'image'
      ? t('Creating image…')
      : modality === 'video'
        ? t('Creating video…')
        : t('Creating audio…');

  const noModelMessage = modality === 'image'
    ? t('No image model is configured.')
    : modality === 'video'
      ? t('No video model is configured.')
      : t('No audio model is configured.');

  const uploadLabel = modality === 'image'
    ? t('Upload images')
    : modality === 'video'
      ? t('Upload videos')
      : t('Upload audio');

  const exportMenuExtras =
    activeDownloadableAssets.length > 0 || state.links.motionProjectId ? (
      <>
        {activeDownloadableAssets.length > 0 && (
          <MenuItem icon={<RemixIcon name="download-2-line" size={14} />} onClick={handleDownloadActiveFiles}>
            {t('Download active files')}
          </MenuItem>
        )}
        {state.links.motionProjectId && (
          <MenuItem
            icon={<RemixIcon name="movie-line" size={14} />}
            onClick={() => void nav.openMotionProject(state.links.motionProjectId!)}
          >
            {t('Open in Motion Editor')}
          </MenuItem>
        )}
      </>
    ) : null;

  const modalityIcon = modality === 'image'
    ? 'image-line'
    : modality === 'video'
      ? 'movie-line'
      : (isSpeechMode ? 'voiceprint-line' : 'music-2-line');

  const modalityTitle = modality === 'image'
    ? t('Create images')
    : modality === 'video'
      ? t('Create video')
      : t('Create audio');

  const generateWorkbench = (
    <>
      <section className="om-step-card om-media-composer" data-tone={modality} aria-label={t('Generator settings')}>
        <div className="om-brief-composer-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone={modality} aria-hidden="true">
              <RemixIcon name={modalityIcon} size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{modalityTitle}</h3>
              <p className="om-step-muted">
                {t('Pre-filled from your brief. Edit freely, attach reference images, or upload your own.')}
              </p>
            </div>
          </div>
          {currentScene && (
            <Button
              variant="ghost"
              size="sm"
              icon={<RemixIcon name="external-link-line" size={14} />}
              onClick={() => nav.openStudioScene(sceneDestination(currentScene), prompt)}
            >
              {t('Open full generator')}
            </Button>
          )}
        </div>

        {sceneIds.length > 1 && (
          <div className="om-step-chip-list" role="group" aria-label={t('Mode')}>
            {sceneIds.map(id => {
              const sceneDef = studioScenes.find(s => s.id === id);
              const label = modality === 'audio'
                ? (id === 'speech' ? t('Voiceover (speech)') : t('Music'))
                : t(sceneDef?.label ?? id);
              const chipIcon = modality === 'audio'
                ? (id === 'speech' ? 'voiceprint-line' : 'music-2-line')
                : (sceneDef?.icon ?? modalityIcon);
              return (
                <FilterChip
                  key={id}
                  active={activeSceneId === id}
                  className="om-step-icon-chip"
                  data-tone={modality}
                  onClick={() => setActiveSceneId(id)}
                >
                  <span className="om-step-chip-icon" data-tone={modality} aria-hidden="true">
                    <RemixIcon name={chipIcon} size={13} />
                  </span>
                  <span>{label}</span>
                </FilterChip>
              );
            })}
          </div>
        )}

        {modality === 'image' && (
          <BindingSlot
            slot="references"
            label={t('Reference images')}
            hint={requiresReference ? t('Required for this mode') : undefined}
            kinds={['image']}
            max={maxReferences}
            required={requiresReference}
            stepId={step.id}
            boundIds={referenceIds}
            pool={pool}
            api={api}
            toast={toast}
          />
        )}

        {modality === 'video' && (
          <div className="om-step-slots-stack">
            <BindingSlot
              slot="firstFrame"
              label={t('First frame')}
              hint={requiresReference ? t('Required for Image to video') : undefined}
              kinds={['image']}
              max={1}
              required={requiresReference}
              error={needsFirstFrame && !hasInputImage && firstFrameError ? t('Choose a first frame to continue.') : undefined}
              pickButtonRef={firstFramePickRef}
              stepId={step.id}
              boundIds={referenceIds}
              pool={pool}
              api={api}
              toast={toast}
            />
            <BindingSlot
              slot="soundtrack"
              label={t('Soundtrack')}
              kinds={['audio']}
              max={1}
              stepId={step.id}
              boundIds={soundtrackIds}
              pool={pool}
              api={api}
              toast={toast}
            />
          </div>
        )}

        <div className="om-step-field">
          <div className="om-step-field-label-row">
            <label className="om-step-field-label" htmlFor={`media-prompt-${step.id}`}>
              {isSpeechMode ? t('Speech script') : t('Prompt')}
            </label>
            {isSpeechMode && upstreamScript && prompt !== upstreamScript && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  promptDirtyRef.current = false;
                  setPrompt(upstreamScript);
                }}
              >
                {t('Load active script')}
              </Button>
            )}
          </div>
          <FieldTextarea
            id={`media-prompt-${step.id}`}
            className="om-step-textarea"
            rows={isSpeechMode ? 5 : 3}
            value={prompt}
            placeholder={t(currentScene?.hint ?? 'Describe what to generate.')}
            onChange={e => {
              promptDirtyRef.current = true;
              setPrompt(e.target.value);
            }}
            onBlur={() => void persistDraftPrompt(prompt)}
          />
        </div>

        {catalogFailed ? (
          <div className="om-step-inline-error">
            <span>{t('Could not load available models.')}</span>
            <Button variant="ghost" size="sm" onClick={retryCatalog}>{t('Retry')}</Button>
          </div>
        ) : !catalog && !providerUnavailable ? (
          <Skeleton className="om-step-controls-skeleton" />
        ) : noProvider ? (
          <div className="om-step-provider-card" data-provider-setup="true" data-tone={modality}>
            <div className="om-step-provider-head">
              <span className="om-brief-composer-icon" data-tone={modality} aria-hidden="true">
                <RemixIcon name="plug-line" size={16} />
              </span>
              <div>
                <strong>{noModelMessage}</strong>
                <p className="om-step-muted">
                  {t('Connect a media provider to generate here, upload or choose workspace files, or copy an MCP prompt for your Agent below.')}
                </p>
              </div>
            </div>
            <div className="om-step-provider-actions">
              <Button
                variant="primary"
                size="sm"
                icon={<RemixIcon name="plug-line" size={14} />}
                onClick={() => nav.openProviders()}
              >
                {t('Set up a provider')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="upload-2-line" size={14} />}
                loading={uploading}
                aria-describedby={uploadHintId}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadLabel}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="folder-open-line" size={14} />}
                onClick={() => setPickerOpen(true)}
              >
                {t('Choose from workspace')}
              </Button>
            </div>
            <p id={uploadHintId} className="om-step-field-hint">{uploadHint}</p>
          </div>
        ) : (
          <div className="om-step-gen-controls">
            <div className="om-step-gen-selects">
              <div className="om-step-param-field">
                <span className="om-step-field-label">{t('Model')}</span>
                <Select
                  appearance="boxed"
                  label={t('Model')}
                  value={selectedModel?.id ?? ''}
                  options={availableModels.map(m => ({
                    value: m.id,
                    label: m.label,
                    description: providerDisplayName(m.provider, catalog?.status.providers ?? []),
                  }))}
                  onCommit={next => {
                    userSelectedModelRef.current = true;
                    setSelectedModelId(next);
                  }}
                />
              </div>

              {paramFields.map(field => {
                const duration = secondsDurationField(field);
                if (duration) {
                  const unit = field.key === 'music_length_ms' ? 1000 : 1;
                  const value = params[field.key];
                  return (
                    <div key={`${selectedModel?.id}:${field.key}`} className="om-step-param-field om-step-param-field--duration">
                      <span className="om-step-field-label">{t(field.label)}</span>
                      <DurationControl
                        field={duration}
                        currentValue={typeof value === 'number' ? value / unit : undefined}
                        showInput={false}
                        onCommit={seconds => {
                          if (seconds !== undefined) setParamOverrides(prev => ({ ...prev, [field.key]: unit === 1 ? seconds : Math.round(seconds * unit) }));
                        }}
                      />
                    </div>
                  );
                }
                if (field.kind === 'choice' && field.choices) {
                  const val = String(params[field.key] ?? field.default ?? field.choices[0]?.value ?? '');
                  return (
                    <div key={field.key} className="om-step-param-field">
                      <span className="om-step-field-label">{t(field.label)}</span>
                      <Select
                        appearance="boxed"
                        label={t(field.label)}
                        value={val}
                        options={field.choices.map(ch => ({ value: String(ch.value), label: ch.label }))}
                        onCommit={next => {
                          const matched = field.choices?.find(ch => String(ch.value) === next);
                          setParamOverrides(prev => ({ ...prev, [field.key]: matched ? matched.value : next }));
                        }}
                      />
                    </div>
                  );
                }
                if (field.kind === 'number') {
                  const countChoices = field.presentation === 'count'
                    ? [1, 2, 3, 4]
                    : [field.min ?? 4, field.default ?? 5, field.max ?? 10].filter((v, i, arr) => arr.indexOf(v) === i);
                  const val = String(params[field.key] ?? field.default ?? countChoices[0]);
                  return (
                    <div key={field.key} className="om-step-param-field">
                      <span className="om-step-field-label">{t(field.label)}</span>
                      <Select
                        appearance="boxed"
                        label={t(field.label)}
                        value={val}
                        options={countChoices.map(n => ({ value: String(n), label: String(n) }))}
                        onCommit={next => setParamOverrides(prev => ({ ...prev, [field.key]: Number(next) }))}
                      />
                    </div>
                  );
                }
                return null;
              })}
            </div>

            <div className="om-step-gen-actions">
              <div className="om-step-toolbar-group">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RemixIcon name="upload-2-line" size={14} />}
                  loading={uploading}
                  aria-describedby={uploadHintId}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploadLabel}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RemixIcon name="folder-open-line" size={14} />}
                  onClick={() => setPickerOpen(true)}
                >
                  {t('Choose from workspace')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RemixIcon name="plug-line" size={14} />}
                  onClick={() => nav.openProviders()}
                >
                  {t('Model providers')}
                </Button>
              </div>
              <Button
                variant="primary"
                icon={<RemixIcon name="sparkling-line" size={14} />}
                loading={generating}
                disabled={!selectedModel || !prompt.trim() || (requiresReference && !hasInputImage)}
                onClick={() => void handleGenerate()}
              >
                {t('Generate')}
              </Button>
            </div>
            <p id={uploadHintId} className="om-step-field-hint">{uploadHint}</p>
          </div>
        )}
      </section>

      {activeIteration && (() => {
        const outputStatus: 'running' | 'failed' | 'ready' =
          activeIteration.job && (activeIteration.job.state === 'queued' || activeIteration.job.state === 'running')
            ? 'running'
            : activeIteration.job && (activeIteration.job.state === 'failed' || activeIteration.job.state === 'cancelled')
              ? 'failed'
              : 'ready';
        const outputSection = (
        <section className="om-step-card" aria-label={t('Active result')}>
          <div className="om-step-section-head">
            <h3 className="om-step-section-title">
              {t('Output · v{number}', { number: activeIteration.number })}
            </h3>
            {activeIteration.job && (
              <span className="om-step-badge">{t(jobStateLabel(activeIteration.job.state))}</span>
            )}
          </div>

          {activeIteration.job && (activeIteration.job.state === 'queued' || activeIteration.job.state === 'running') ? (
            <div className="om-step-job-progress" role="status" aria-live="polite">
              <div className="om-step-job-stage" data-modality={modality} data-state={activeIteration.job.state}>
                <div className="om-step-job-stage-icon" aria-hidden="true">
                  <RemixIcon name="loader-4-line" size={22} className="om-scenario-spin" />
                </div>
                <div className="om-step-job-stage-body">
                  <strong className="om-step-job-stage-title">{activeJobPhaseTitle}</strong>
                  <div className="om-step-job-stage-meta">
                    <span>{activeJobModelLabel}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formattedElapsed}</span>
                  </div>
                  {activeIteration.prompt && (
                    <p className="om-step-job-stage-prompt">{activeIteration.prompt}</p>
                  )}
                </div>
              </div>
              <div className="om-step-job-bar">
                <span className="om-step-muted">
                  {t('Generating with {model}…', { model: activeJobModelLabel })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RemixIcon name="stop-fill" size={12} />}
                  loading={cancellingId === activeIteration.id}
                  onClick={() => void handleCancelJob(activeIteration.id)}
                >
                  {t('Cancel')}
                </Button>
              </div>
            </div>
          ) : activeIteration.job && (activeIteration.job.state === 'failed' || activeIteration.job.state === 'cancelled') ? (
            <div className="om-step-inline-error" role="alert">
              <div className="om-step-inline-error-copy">
                <div className="om-step-inline-error-head">
                  <RemixIcon name="error-warning-line" size={15} aria-hidden="true" />
                  <strong>
                    {activeIteration.job.state === 'cancelled'
                      ? t('Generation was cancelled.')
                      : showLimitHint
                        ? t('{model} reached its usage limit or needs access.', { model: activeJobModelLabel })
                        : t('Generation failed.')}
                  </strong>
                </div>
                {showLimitHint && (
                  <span className="om-step-inline-error-hint">
                    {t('Your current model provider hit a limit or needs access. Switch models above or connect another provider to continue.')}
                  </span>
                )}
                {activeIteration.job.error && (
                  <div className="om-step-inline-error-detail">{activeIteration.job.error}</div>
                )}
              </div>
              <div className="om-step-inline-error-actions">
                {!noProvider && (
                  <Button
                    variant={switchedModel ? 'primary' : 'secondary'}
                    size="sm"
                    loading={generating}
                    onClick={() => void handleGenerate({
                      prompt: activeIteration.prompt ?? prompt,
                      model: retryModelId,
                      inputs: activeIteration.inputs,
                      parameters: switchedModel
                        ? undefined
                        : ((activeIteration.settings?.parameters as Record<string, unknown> | undefined) ?? undefined),
                      scene: (activeIteration.settings?.scene as string | undefined) ?? activeSceneId,
                      mode: (activeIteration.settings?.mode as 'text-to-image' | 'text-to-video' | 'text-to-audio' | 'text-to-speech' | undefined) ?? undefined,
                    })}
                  >
                    {activeIteration.job.state === 'cancelled'
                      ? t('Run again')
                      : switchedModel && selectedModel
                        ? t('Retry with {model}', { model: selectedModel.label })
                        : t('Retry')}
                  </Button>
                )}
                {activeIteration.job.state === 'failed' && (
                  <>
                    <Button
                      variant={showLimitHint && !switchedModel ? 'secondary' : 'ghost'}
                      size="sm"
                      icon={<RemixIcon name="plug-line" size={14} />}
                      onClick={() => nav.openProviders()}
                    >
                      {t('Set up a provider')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<RemixIcon name="upload-2-line" size={14} />}
                      loading={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadLabel}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : activePoolOutputs.length > 0 ? (
            <div className="om-step-media-grid" data-modality={modality}>
              {activePoolOutputs.map(item => {
                if (item.ref.type === 'asset' && item.kind === 'image') {
                  const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
                  return (
                    <figure key={item.id} className="om-step-media-item">
                      <img src={src} alt={item.label} loading="lazy" />
                      <figcaption className="om-step-media-caption">
                        <span>{item.label}</span>
                        <a href={assetDownloadUrl(item.ref.assetId, item.ref.versionId, item.label)} download className="om-step-link-icon" aria-label={t('Download {label}', { label: item.label })}>
                          <RemixIcon name="download-2-line" size={14} />
                        </a>
                      </figcaption>
                    </figure>
                  );
                }
                if (item.ref.type === 'asset' && item.kind === 'video') {
                  const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
                  return (
                    <figure key={item.id} className="om-step-media-item om-step-media-item--wide">
                      <StepVideoPreview key={src} src={src} active={active} label={item.label} />
                      <figcaption className="om-step-media-caption">
                        <span>{item.label}</span>
                        <a href={assetDownloadUrl(item.ref.assetId, item.ref.versionId, item.label)} download className="om-step-link-icon" aria-label={t('Download {label}', { label: item.label })}>
                          <RemixIcon name="download-2-line" size={14} />
                        </a>
                      </figcaption>
                    </figure>
                  );
                }
                if (item.ref.type === 'asset' && item.kind === 'audio') {
                  const src = assetMediaUrl(item.ref.assetId, item.ref.versionId);
                  return (
                    <div key={item.id} className="om-step-media-item om-step-media-item--wide">
                      <AudioPreviewCard src={src} />
                      <div className="om-step-media-caption">
                        <span>{item.label}</span>
                        <a href={assetDownloadUrl(item.ref.assetId, item.ref.versionId, item.label)} download className="om-step-link-icon" aria-label={t('Download {label}', { label: item.label })}>
                          <RemixIcon name="download-2-line" size={14} />
                        </a>
                      </div>
                    </div>
                  );
                }
                if (item.ref.type === 'motion') {
                  const projectId = item.ref.projectId;
                  return (
                    <div key={item.id} className="om-step-motion-summary">
                      <RemixIcon name="movie-line" size={16} />
                      <span>{item.label}</span>
                      <Button variant="secondary" size="sm" onClick={() => void nav.openMotionProject(projectId)}>
                        {t('Open in Motion Editor')}
                      </Button>
                    </div>
                  );
                }
                return null;
              })}
            </div>
          ) : (
            <p className="om-step-muted">{t('No media outputs attached to this version yet.')}</p>
          )}
        </section>
        );
        return renderOutputPanel
          ? renderOutputPanel(outputSection, { status: outputStatus, version: activeIteration.number })
          : outputSection;
      })()}
    </>
  );

  return (
    <div className="om-step-body" data-step-body={modality}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={assetUploadAccept(modality)}
        hidden
        onChange={e => void handleFileChange(e)}
      />

      {renderExportMenu(exportMenuExtras)}

      {hasMotionTab ? (
        <Tabs value={videoTab} onValueChange={next => setVideoTab(next === 'motion' ? 'motion' : 'generate')}>
          <TabsList aria-label={t('Video creation mode')}>
            <Tab value="generate" className="om-step-mode-tab" data-tone="video">
              <RemixIcon name="sparkling-line" size={14} />
              <span>{t('Generate clip')}</span>
            </Tab>
            <Tab value="motion" className="om-step-mode-tab" data-tone="video">
              <RemixIcon name="movie-line" size={14} />
              <span>{t('Motion project')}</span>
            </Tab>
          </TabsList>
          <TabPanel value="generate" className="om-step-tab-panel">
            {generateWorkbench}
          </TabPanel>
          <TabPanel value="motion" className="om-step-tab-panel">
            <MotionPanel {...props} />
          </TabPanel>
        </Tabs>
      ) : (
        generateWorkbench
      )}

      {(() => {
        const capabilityNode = (
          <StepCapabilityBar
            scenario={scenario}
            step={step}
            state={state}
            run={run}
            active={active}
            api={api}
            pool={pool}
            toast={toast}
            nav={nav}
            stepPrompt={prompt}
            allowQuickMedia={false}
            compact
          />
        );
        return renderCapabilityBar ? renderCapabilityBar(capabilityNode) : capabilityNode;
      })()}

      {renderIterations({
        renderOutput: (iteration: StepIteration) => (
          <StepMediaOutputs iteration={iteration} pool={pool} fallback={t('No outputs')} />
        ),
      })}

      {pickerOpen && (
        <AssetPicker
          imageOnly={modality === 'image'}
          busy={pickingAsset}
          onClose={() => setPickerOpen(false)}
          onPick={(ref, asset) => void handleWorkspacePick(ref, asset)}
        />
      )}
    </div>
  );
}
