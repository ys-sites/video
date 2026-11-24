import { Button } from 'open-design-ui/button';
import * as tracking from './pageTracking';
import { Tooltip } from "../components/ui/Tooltip";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ComponentProps, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { assetMediaUrl, type AssetReference, type LibraryAsset } from '../../../shared/asset-library';
import { modelReferenceLimit, type GenerationJob } from '../../../shared/gateway';
import { useI18n } from '../i18n/I18n';
import { CreationModelPicker, GenerationModelPickers } from './GenerationModelPickers';
import { Skeleton } from '../components/ui/Skeleton';
import { RemixIcon } from '../icons/RemixIcons';
import { gatewayRequest, type Modality } from './gatewayClient';
import { assetRequest } from './assetClient';
import { IconButton } from 'open-design-ui/icon-button';
import { AssetTaskHistory } from './AssetTaskHistory';
import type { AssetChatSummary, AssetTaskMode } from './assetTasks';
import { AssetConversation } from './AssetConversation';
import { AssetGenerationCard, creationKinds } from './AssetCreationVisuals';
import { GenerationParameters, emptyParameters, parameterInputImageRatio, requestParameters, shotParameters, type ParameterDraft } from './GenerationParameters';
import { notifyProvidersChanged } from './useProviderDirectory';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { useMediaCatalog } from './useMediaCatalog';
import type { StudioCreation } from './CreativeWorkspace';
import { studioExamples } from './sceneShowcase';
import { isFeatureScene, needsImage, sceneFeature, sceneVideoFeature } from './creativeStudios';
import { imageFeaturePrompt, imageFeatures, relightControls, type RelightChoices } from '../../../shared/image-features';
import { defaultVideoFeatureChoice, videoFeatureParameters, videoFeaturePrompt, videoFeatures } from '../../../shared/video-features';
import { FieldTextarea } from '../components/ui/FormField';
import { Select } from '../components/ui/Select';
import { attachableReferenceLimit, creationModels } from './creationModels';
import { isOpenDesignProvider, modelFamilyLabel, providerDisplayName } from './imageMenuModels';
import { registeredProvider } from '../../../shared/provider-registry';
import { ProviderSetupNotice } from './ProviderSetupNotice';

export interface AssetDraft { modality: Modality; prompt: string; relight?: RelightChoices; videoChoices?: Record<string, string>; shotPreferences?: { aspect: string; duration?: number }; preferredModel?: string; model?: string; parameters?: Record<string, unknown>; target?: { asset: LibraryAsset; versionId: string }; references: { reference: AssetReference; name: string }[] }
export function AssetComposer({ active, studio, draft, setDraft, agentReferences, setAgentReferences, jobs, showCurrentJob = true, mode, onMode, taskIds, history, selectingTask, onNew, onChatChanged, onChatStarted, onCancel, onView, onRetrySave, onResume, onReference, onUploadReference, onUploadFiles, uploadingReferences = false, onCreated, onError, onInfo, onClose }: {
  active: boolean; studio?: StudioCreation; draft: AssetDraft; setDraft: Dispatch<SetStateAction<AssetDraft>>; jobs: GenerationJob[]; showCurrentJob?: boolean;
  agentReferences: AssetDraft['references']; setAgentReferences: (references: AssetDraft['references']) => void;
  mode: AssetTaskMode; onMode: (mode: AssetTaskMode) => void; taskIds: { direct?: string; agent?: string };
  history: Omit<ComponentProps<typeof AssetTaskHistory>, 'trigger'>; selectingTask: boolean; onNew: () => void;
  onChatChanged: (chat: AssetChatSummary) => void; onChatStarted: (id: string) => void;
  onCancel: (job: GenerationJob) => void; onView: (job: GenerationJob) => void; onRetrySave?: (job: GenerationJob) => Promise<void>; onReference: () => void; onUploadReference?: () => void;
  onUploadFiles?: (files: File[], source?: 'drop' | 'paste') => void; uploadingReferences?: boolean;
  onCreated: (job: GenerationJob) => void; onResume?: (job: GenerationJob) => Promise<void>; onError: (message: string) => void; onInfo?: (message: string) => void; onClose: () => void;
}) {
  const { t } = useI18n(), { openModelSettings, openProviderSettings, openAccountSettings, openSubscriptionSettings } = useWorkspaceChrome();
  const scene = studio?.destination.scene;
  const imageWorkspace = studio?.destination.studio.id === 'design' && scene?.modality === 'image';
  const videoLanding = Boolean(studio?.destination.landing && scene?.modality === 'video');
  const imagePopupClass = imageWorkspace ? 'om-image-form-popup' : undefined;
  const showSceneIntro = (!imageWorkspace && !videoLanding) || scene?.id === 'character';
  const feature = scene && sceneFeature(scene);
  const featureRule = feature ? imageFeatures[feature] : undefined;
  const videoFeature = scene && sceneVideoFeature(scene);
  const videoFeatureRule = videoFeature ? videoFeatures[videoFeature] : undefined;
  // Image and video feature scenes scope to OpenDesign routes; eligibility itself is capability-driven.
  const featureMode = isFeatureScene(scene);
  const modelId = studio?.destination.model ?? draft.model;
  const promptId = useId();
  const libraryCatalog = useMediaCatalog(active && !studio);
  const { catalog: gateway, failed, retry } = studio?.catalog ?? libraryCatalog;
  const [busy, setBusy] = useState(false), [agentSending, setAgentSending] = useState(false);
  const [parameterDrafts, setParameterDrafts] = useState<Record<string, ParameterDraft>>({});
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const [syncing, setSyncing] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const dragDepth = useRef(0);
  const prevModelSwitchRef = useRef<{ sceneId?: string; refCount: number; modelId?: string; modelLabel?: string; modelLimit: number } | undefined>(undefined);
  const selectedTask = history.tasks.find(task => task.key === history.selectedKey);
  const switching = busy || agentSending || selectingTask;
  const resolvedModels = creationModels(
    gateway, draft.modality, modelId, scene, featureMode, draft.references.length, draft.preferredModel,
  );
  const { available, selected, choices, compatible, preferred } = resolvedModels;
  const preferredProvider = preferred && gateway?.status.providers.find(provider => provider.id === preferred.provider);
  const unconfiguredPreferred = Boolean(studio && gateway && preferred && !selected && preferredProvider && !preferredProvider.available);
  const providerLabel = preferredProvider?.label ?? (preferred && registeredProvider(preferred.provider)?.label) ?? preferred?.provider ?? '';
  const accountNotIncluded = selected?.provider === 'account' && preferredProvider?.mediaEntitlement === 'not-included';
  const maximumReferences = selected ? Math.min(modelReferenceLimit(selected), featureRule?.maxReferences ?? Infinity) : 0;
  const attachableReferences = scene ? attachableReferenceLimit(resolvedModels, scene) : maximumReferences;
  const showReferenceSection = Boolean(scene && (needsImage(scene) || ((scene.modality === 'image' || Boolean(videoFeature)) && maximumReferences > 0)));
  const gridReferences = Boolean(imageWorkspace && attachableReferences > 1);
  useEffect(() => {
    dragDepth.current = 0;
    setDraggingFiles(false);
  }, [scene?.id]);
  useEffect(() => {
    const currentSceneId = scene?.id;
    const currentRefCount = draft.references.length;
    const currentModelId = selected?.id;
    const currentModelLabel = selected ? modelFamilyLabel(selected) : undefined;
    const currentModelLimit = selected ? modelReferenceLimit(selected) : 0;
    const prev = prevModelSwitchRef.current;
    if (
      featureMode
      && prev
      && prev.sceneId === currentSceneId
      && prev.refCount <= 1
      && currentRefCount >= 2
      && prev.modelId
      && prev.modelLimit === 1
      && currentModelId
      && currentModelId !== prev.modelId
    ) {
      onInfo?.(t('{from} supports 1 reference image. Switched to {to}.', {
        from: prev.modelLabel ?? prev.modelId,
        to: currentModelLabel ?? currentModelId,
      }));
    }
    prevModelSwitchRef.current = {
      sceneId: currentSceneId,
      refCount: currentRefCount,
      modelId: currentModelId,
      modelLabel: currentModelLabel,
      modelLimit: currentModelLimit,
    };
  }, [draft.references.length, featureMode, onInfo, scene?.id, selected, t]);
  const hasFileTransfer = (transfer?: DataTransfer | null) => Boolean(transfer && Array.from(transfer.types).includes('Files'));
  const dropBlocked = uploadingReferences || draft.references.length >= attachableReferences;
  const handleReferenceDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current++;
    setDraggingFiles(true);
  };
  const handleReferenceDragOver = (event: DragEvent<HTMLElement>) => {
    if (!onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const handleReferenceDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDraggingFiles(false);
  };
  const handleReferenceDrop = (event: DragEvent<HTMLElement>) => {
    if (!onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) onUploadFiles(files, 'drop');
  };
  const handleComposerDragOver = (event: DragEvent<HTMLElement>) => {
    if (!showReferenceSection || !onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const handleComposerDrop = (event: DragEvent<HTMLElement>) => {
    if (!showReferenceSection || !onUploadFiles || !hasFileTransfer(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDraggingFiles(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) onUploadFiles(files, 'drop');
  };
  const hasUploadFiles = Boolean(onUploadFiles);
  const onUploadFilesRef = useRef(onUploadFiles);
  useLayoutEffect(() => { onUploadFilesRef.current = onUploadFiles; }, [onUploadFiles]);
  useEffect(() => {
    if (!active || mode !== 'direct' || !showReferenceSection || !hasUploadFiles) return;
    const isImageClipboardFile = (file: File) => file.type.startsWith('image/')
      || (!file.type && /\.(png|jpe?g|webp|gif|avif|heic|heif|bmp|tiff?)$/i.test(file.name));
    const handleDocumentPaste = (event: ClipboardEvent) => {
      const upload = onUploadFilesRef.current;
      if (!upload || document.querySelector('[role="dialog"]')) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      const inEditable = Boolean(target && (target.matches('textarea, input, [contenteditable="true"]') || target.isContentEditable));
      const plainText = typeof event.clipboardData?.getData === 'function' ? event.clipboardData.getData('text/plain') : '';
      if (inEditable && plainText.trim().length > 0) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const itemFiles = items
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const files = itemFiles.length ? itemFiles : Array.from(event.clipboardData?.files ?? []);
      const images = files.filter(isImageClipboardFile);
      if (!images.length) return;
      event.preventDefault();
      upload(images, 'paste');
    };
    document.addEventListener('paste', handleDocumentPaste);
    return () => document.removeEventListener('paste', handleDocumentPaste);
  }, [active, hasUploadFiles, mode, showReferenceSection]);
  const unknownReferences = selected?.provider === 'opendesign' && selected.modality === 'image' && selected.supportsImageReference === undefined;
  const cloudModelMissing = !!gateway && !!modelId?.startsWith('opendesign:') && !selected && !unconfiguredPreferred;
  const openDesignMissing = Boolean(studio && gateway && featureMode && !compatible.length);
  const setupProvider = unconfiguredPreferred ? preferred!.provider : openDesignMissing ? 'opendesign' : undefined;
  const syncModels = async () => {
    const provider = selected?.provider ?? (cloudModelMissing ? 'opendesign' : undefined);
    if (!provider || syncing) return; setSyncing(true);
    try { await gatewayRequest(`settings/providers/${provider}/sync`, 'POST', {}); notifyProvidersChanged(); }
    catch (error) { onError((error as Error).message); }
    finally { if (mounted.current) setSyncing(false); }
  };
  const invalidReferences = draft.references.length > maximumReferences || Boolean(scene && needsImage(scene) && !draft.references.length);
  const shotPreferences = draft.shotPreferences ?? (studio?.destination.studio.id === 'shorts' ? { aspect: '9:16' } : undefined);
  const parameterModel = selected;
  const parameterKey = parameterModel ? `${scene?.id ?? 'direct'}:${parameterModel.id}` : '';
  const studioDefaultValues = (model?: typeof parameterModel): Record<string, unknown> | undefined => {
    if (!model || model.defaults?.quality !== undefined || !isOpenDesignProvider(model.provider) || !/^gpt-image-2\.6-/.test(model.modelId)) return undefined;
    const qualityField = model.generationOptions?.fields.find(field => field.key === 'quality');
    return qualityField?.choices?.some(choice => choice.value === 'medium') ? { quality: 'medium' } : undefined;
  };
  const activeDefaultValues = studioDefaultValues(parameterModel);
  const restoredParameters = (model: NonNullable<typeof parameterModel>): ParameterDraft => {
    if (draft.model !== model.id || !draft.parameters) {
      const base = shotParameters(model, shotPreferences);
      if (!videoFeature) return base;
      const seeded = videoFeatureParameters(videoFeature, model);
      return Object.keys(seeded).length ? { ...base, values: { ...base.values, ...seeded } } : base;
    }
    return { values: {}, advanced: JSON.stringify(draft.parameters, null, 2) };
  };
  const parameters = parameterModel ? parameterDrafts[parameterKey] ?? restoredParameters(parameterModel) : emptyParameters;
  const inputImageRatio = selected && parameterInputImageRatio(selected, parameters, draft.references.length > 0);
  const kind = creationKinds.find(k => k.id === draft.modality)!;
  const latest = jobs.find(job => job.id === taskIds.direct);
  const promptReady = Boolean(draft.prompt.trim() || featureRule?.promptOptional);
  const submit = async () => {
    if (!selected || !promptReady || busy || uploadingReferences || invalidReferences) return; setBusy(true);
    const studioContext = studio ? { studio: studio.destination.studio.id, scene: studio.destination.scene.id, model: selected.id } : undefined;
    try {
      const parsed = requestParameters(parameters, selected, draft.references.length > 0, studioDefaultValues(selected));
      const prompt = feature ? imageFeaturePrompt(feature, draft.prompt, draft.relight)
        : videoFeature ? videoFeaturePrompt(videoFeature, draft.prompt, draft.videoChoices)
        : draft.prompt;
      const submittedParameters = { ...parsed, ...featureRule?.parameters };
      const result = await assetRequest<{ job: GenerationJob }>({ action: 'generate', requestId: crypto.randomUUID(), modality: draft.modality, prompt, model: selected.id, mode: selected.mode, parameters: submittedParameters,
        ...(draft.target ? { assetId: draft.target.asset.id, parentVersionId: draft.target.versionId } : {}), references: draft.references.map(r => r.reference) });
      if (mounted.current) {
        setDraft(current => current === draft ? { ...current, model: selected.id, parameters: parsed } : current);
        onCreated(result.job);
      }
      tracking.reportAssetGenerationSubmit(draft.modality, 'success', draft.references.length, Boolean(draft.target), studioContext);
    } catch (error) {
      tracking.reportAssetGenerationSubmit(draft.modality, 'failure', draft.references.length, Boolean(draft.target), studioContext);
      if (mounted.current) onError((error as Error).message);
    } finally { if (mounted.current) setBusy(false); }
  };
  const referenceControls = (items: AssetDraft['references'], update: (references: AssetDraft['references']) => void, maximum = Infinity) => <div className="om-asset-references"><Button variant="plain" className="om-nav-item om-creation-reference" onClick={onReference} disabled={items.length >= maximum}><RemixIcon name="add-line" size={16} />{t('Reference asset')}</Button>{items.map(item => <Button variant="plain" key={`${item.reference.assetId}/${item.reference.versionId}`} className="om-badge om-nav-item" onClick={() => update(items.filter(r => r !== item))} aria-label={t('Remove reference: {name}', { name: item.name })}><RemixIcon name="image-line" size={14} /><span>{item.name}</span><RemixIcon name="close-line" size={14} /></Button>)}</div>;
  const references = referenceControls(draft.references, references => setDraft({ ...draft, references }), maximumReferences);

  const providerSettingsButton = <IconButton variant="plain" className="om-nav-item" aria-label={t('Model providers')} onClick={openModelSettings} icon={<RemixIcon name="settings-3-line" size={15} />} />;
  const providerHeading = <div className="om-creation-row"><span className="om-eyebrow">{t('Provider')}</span>{providerSettingsButton}</div>;
  const modelHeading = <div className="om-creation-row"><span className="om-eyebrow">{t('Generation model')}</span>{providerSettingsButton}</div>;
  const studioModelHeading = <span className="om-eyebrow">{t('Generation model')}</span>;
  const speechPrompt = scene?.id === 'speech' || selected?.mode === 'text-to-speech';
  const promptInput: ComponentProps<'textarea'> = {
    id: promptId,
    maxLength: 20000,
    'aria-label': imageWorkspace ? undefined : t('Asset prompt'),
    placeholder: t(featureRule?.promptOptional ? 'Optional: add anything the model should know.' : scene?.hint ?? (speechPrompt ? 'Write the words you want spoken.' : kind.hint)),
    value: draft.prompt,
    onChange: event => setDraft({ ...draft, prompt: event.target.value }),
  };
  const promptField = imageWorkspace ? <div className="om-label">
    <label className="om-eyebrow" htmlFor={promptId}>{t('Detailed description')}</label>
    <div className="om-field" data-form-field="intrinsic">
      <FieldTextarea {...promptInput} appearance="embedded" className="om-image-prompt" />
    </div>
  </div> : <div className="om-creation-prompt">
    <label className="om-eyebrow" htmlFor={promptId}><RemixIcon name="pen-nib-line" size={14} />{t(speechPrompt ? 'Speech text' : 'Your idea')}</label>
    <textarea {...promptInput} />
    {!scene && (maximumReferences > 0 || draft.references.length > 0) && references}
    <div className="om-creation-prompt-footer">
      <span className="om-eyebrow">{t(draft.references.length ? 'References stay linked to their versions' : 'Start with a few words. Make it your own.')}</span>
      <span className="om-eyebrow">{draft.prompt.length.toLocaleString()} / 20k</span>
    </div>
  </div>;

  const configureProvider = (providerId: string) => providerId === 'account'
    ? (openAccountSettings ?? openModelSettings)()
    : openProviderSettings ? openProviderSettings(providerId) : openModelSettings();
  const providerSetupMessage = t('Configure a provider or sign in to use media models.');
  const openDesignSetupMessage = t('This feature uses OpenDesign models. Add an OpenDesign Cloud API key or sign in to continue.');
  const manageProviders = <Button variant="ghost" className="om-button h-auto" onClick={openModelSettings}>{t('Model providers')}</Button>;
  const configureOpenDesign = <>
    <Button variant="ghost" className="om-button h-auto" onClick={() => configureProvider('opendesign')}>{t('Configure {provider}', { provider: providerDisplayName('opendesign', gateway?.status.providers) })}</Button>
    <Button variant="ghost" className="om-button h-auto" onClick={() => configureProvider('account')}>{t('Sign in with OpenDesign')}</Button>
  </>;
  const manageProvidersNotice = imageWorkspace
    ? <ProviderSetupNotice message={providerSetupMessage}>{manageProviders}</ProviderSetupNotice>
    : <div className="om-creation-setup"><RemixIcon name="plug-line" size={20} /><p className="om-muted">{providerSetupMessage}</p>{manageProviders}</div>;
  const openDesignSetup = imageWorkspace
    ? <ProviderSetupNotice message={openDesignSetupMessage}>{configureOpenDesign}</ProviderSetupNotice>
    : <div className="om-creation-setup" role="status"><RemixIcon name="plug-line" size={20} /><p className="om-muted">{openDesignSetupMessage}</p><div className="om-control-row">{configureOpenDesign}</div></div>;
  const chooseModel = (model: string) => {
    setDraft(current => ({ ...current, model, parameters: undefined }));
    if (studio) studio.chooseModel(model);
  };
  const modelPicker = gateway && !failed && (studio ? compatible.length > 0 : choices.length > 0) ? (studio
    ? <CreationModelPicker models={compatible} providers={gateway.status.providers} selected={preferred} appearance={imageWorkspace ? 'boxed' : 'standard'}
      providerHeading={providerHeading} modelHeading={studioModelHeading} disabled={busy} onChoose={chooseModel} popupClassName={imagePopupClass} onManageProviders={openModelSettings} onConfigureProvider={configureProvider} />
    : <GenerationModelPickers models={choices} preferred={preferred} modelHeading={modelHeading} disabled={busy} onChoose={chooseModel} />) : <>
    {modelHeading}
    {failed ? <Button variant="ghost" className="om-button h-auto" onClick={retry}><RemixIcon name="refresh-line" size={16} />{t('Retry loading models')}</Button> : !gateway ? <Skeleton className="om-asset-model-skeleton" /> : openDesignMissing ? openDesignSetup : manageProvidersNotice}
  </>;
  const setup = <>
      {unconfiguredPreferred && (imageWorkspace
        ? <ProviderSetupNotice message={t('{provider} needs setup before generating.', { provider: providerLabel })}>
          <Button variant="ghost" className="om-button h-auto" onClick={() => configureProvider(preferred!.provider)}>
            {preferred!.provider === 'account' ? t('Sign in with OpenDesign') : t('Configure {provider}', { provider: providerLabel })}
          </Button>
        </ProviderSetupNotice>
        : <p className="om-muted" role="status">{t('{provider} needs setup before generating.', { provider: providerLabel })}</p>)}
      {studio && gateway && !available.length && compatible.length > 0 && !unconfiguredPreferred && (imageWorkspace
        ? manageProvidersNotice
        : <Button variant="ghost" className="om-button h-auto" onClick={openModelSettings}>{t('Configure a provider or sign in to use media models.')}</Button>)}
      {accountNotIncluded && <div className="om-creation-setup" role="status">
        <RemixIcon name="bank-card-line" size={20} />
        <p className="om-muted">{t('Signed in; multimodal generation requires OpenDesign Plus or above')}</p>
        <Button variant="ghost" className="om-button h-auto" onClick={() => (openSubscriptionSettings ?? openAccountSettings ?? openModelSettings)()}>
          {t('Manage subscription')}
        </Button>
      </div>}
      {gateway && modelId && !selected && !unconfiguredPreferred && !openDesignMissing && <p className="om-muted" role="status">{scene && <strong>{gateway.models.find(model => model.id === modelId)?.label ?? modelId} · </strong>}{t('This task’s model is unavailable. Choose a model to continue.')}</p>}
  </>;
  const modelNotice = unknownReferences || cloudModelMissing ? <p className="om-muted" role="status">{unknownReferences && t('Image editing capability is unknown. Sync models to check reference support.')} <Button variant="ghost" className="om-button h-auto" disabled={syncing} onClick={() => void syncModels()}>{t(syncing ? 'Working…' : 'Sync models')}</Button></p> : selected && draft.references.length > 0 && <p className="om-muted">{t(maximumReferences ? draft.modality === 'video' ? 'This video model uses one image as its first frame.' : 'This model edits up to {count} image references.' : 'This model cannot use asset references. Choose an image model that supports editing, or remove the references.', { count: maximumReferences })}</p>;
  const generationSettings = parameterModel && <GenerationParameters key={parameterKey} model={parameterModel} draft={parameters}
    defaultValues={activeDefaultValues} appearance={imageWorkspace ? 'boxed' : 'standard'} popupClassName={imagePopupClass}
    hasInputImage={draft.references.length > 0} hidden={Object.keys(featureRule?.parameters ?? {})} onChange={value => {
      setParameterDrafts(current => ({ ...current, [parameterKey]: value }));
      try { setDraft({ ...draft, model: parameterModel.id, parameters: requestParameters(value, parameterModel, draft.references.length > 0, activeDefaultValues) }); }
      catch { /* Keep invalid JSON or conflicting parameters in the local editor until corrected. */ }
    }} />;
  const generate = !imageWorkspace && setupProvider ? <Button variant="plain" className="om-button om-creation-submit-button" data-primary onClick={() => configureProvider(setupProvider)}>
    <RemixIcon name="plug-line" size={19} />{t('Set up to generate')}<RemixIcon name="arrow-right-line" size={18} />
  </Button> : <Button variant="plain" className="om-button om-creation-submit-button" data-primary
    disabled={busy || uploadingReferences || !selected || !promptReady || invalidReferences} onClick={() => void submit()}>
    <RemixIcon name="sparkling-fill" size={19} />{t(busy ? 'Submitting your idea…' : featureRule?.actionLabel ?? kind.action)}
    <RemixIcon name="arrow-right-line" size={18} />
  </Button>;

  return <aside className="om-asset-composer om-creation-surface" data-active={active} data-mode={mode}
    data-form-surface={imageWorkspace ? 'subtle' : undefined} data-image-workspace={imageWorkspace || undefined} aria-label={t('Create asset')}
    onDragOver={handleComposerDragOver} onDrop={handleComposerDrop}>
    {scene ? showSceneIntro && <header className="om-studio-form-heading" data-landing={studio?.destination.landing}>
      {scene.modality === 'image' && <img src={studioExamples(studio!.destination)[0].poster} alt="" />}
      {!studio?.destination.landing && <h2 className="om-title">{t(scene.label)}</h2>}
      <p className="om-muted">{t(scene.hint)}</p>
    </header> : <header className="om-task-toolbar">
      <h2 className="om-sr-only">{t(draft.target ? 'Create a new version' : 'Creative studio')}</h2>
      {/* Temporarily hide the Agent tab; existing conversations remain available in Tasks. */}
      <div className="om-choice-tabs om-task-modes" role="group" aria-label={t('Task type')}>{(['direct'] as const).map(value => <Tooltip label={t(value === 'direct' ? 'Direct generation' : 'Agent conversation')} wrap key={value}><Button variant="plain" className="om-nav-item" aria-pressed={mode === value} aria-label={t(value === 'direct' ? 'Direct generation' : 'Agent conversation')} disabled={switching} onClick={() => onMode(value)}><RemixIcon name={value === 'direct' ? 'sparkling-line' : 'chat-1-line'} size={15} /><span>{t(value === 'direct' ? 'Generate' : 'Agent')}</span></Button></Tooltip>)}</div>
      <AssetTaskHistory tooltip={selectedTask?.title ?? t('New task')} {...history} trigger={<Button variant="plain" className="om-nav-item om-task-picker" aria-label={t('Select task')} disabled={switching}><span>{selectingTask ? t('Loading tasks…') : selectedTask?.title ?? t('New task')}</span><RemixIcon name="arrow-down-s-line" size={14} /></Button>} />
      <Tooltip label={t('New task')} wrap><IconButton aria-label={t('New task')} icon={<RemixIcon name="add-line" size={17} />} disabled={switching} onClick={onNew} /></Tooltip>
      <Tooltip label={t('Close creator')} wrap><IconButton aria-label={t('Close creator')} icon={<RemixIcon name="close-line" size={17} />} onClick={onClose} /></Tooltip>
    </header>}
    {!scene && <div className="om-asset-chat-panel" hidden={mode !== 'agent'}><AssetConversation conversationId={taskIds.agent} onChanged={onChatChanged} onStarted={onChatStarted} onSending={setAgentSending} active={active && mode === 'agent'} references={agentReferences.map(r => r.reference)} referenceControls={referenceControls(agentReferences, setAgentReferences)} jobs={jobs} onCancel={onCancel} onView={onView} onRetrySave={onRetrySave} onResume={onResume} onError={onError} /></div>}{mode === 'direct' && <><div className="om-asset-direct-scroll">
      {showCurrentJob && latest && <div className="om-asset-current-job"><AssetGenerationCard job={latest} onCancel={onCancel} onView={onView} onRetrySave={onRetrySave} onResume={onResume} /></div>}
      <div className="om-asset-direct">
      {draft.target && <div className="om-card om-asset-edit-target"><span><RemixIcon name="history-line" size={16} />{draft.target.asset.name} · V{draft.target.asset.versions.findIndex(v => v.id === draft.target!.versionId) + 1}</span><Button variant="plain" className="om-nav-item" onClick={() => setDraft({ ...draft, target: undefined })}>{t('Create separately')}</Button></div>}
      {!scene && <div className="om-creation-types" role="group" aria-label={t('Media type')}>{creationKinds.map(item => <Button variant="plain" key={item.id} className="om-creation-type" data-tone={item.id} aria-pressed={draft.modality === item.id} disabled={Boolean(draft.target) && item.id !== draft.modality} onClick={() => setDraft({ ...draft, modality: item.id, model: undefined, parameters: undefined, ...(item.id === 'audio' ? { references: [] } : {}) })}><span className="om-creation-icon" data-tone={item.id}><RemixIcon name={item.icon} size={20} /></span><span>{t(item.label)}</span>{draft.modality === item.id && <RemixIcon name="check-line" size={13} />}</Button>)}</div>}
      {showReferenceSection && scene && <section className="om-scene-source" data-dragging={draggingFiles || undefined} data-drop-blocked={draggingFiles && dropBlocked ? 'true' : undefined}
        onDragEnter={handleReferenceDragEnter} onDragOver={handleReferenceDragOver} onDragLeave={handleReferenceDragLeave} onDrop={handleReferenceDrop}>
        <div className="om-scene-source-header">
          <h3 className="om-eyebrow">{t(imageWorkspace ? 'Upload' : scene.modality === 'video' ? 'First frame' : needsImage(scene) ? 'Reference asset' : 'Reference image')}</h3>
          {attachableReferences > 1 && <span className="om-eyebrow om-scene-source-count">{draft.references.length} / {attachableReferences}</span>}
        </div>
        {draft.references.length > 0 && <div className="om-scene-source-files" data-layout={gridReferences ? 'grid' : undefined}>
          {draft.references.map(item => {
            const { assetId, versionId } = item.reference;
            const key = assetId + '/' + versionId;
            const preview = <><img src={assetMediaUrl(assetId, versionId)} alt="" /><span>{item.name}</span></>;
            const removeLabel = t('Remove reference: {name}', { name: item.name });
            const removeIcon = <RemixIcon name="close-line" size={gridReferences ? 14 : 16} />;
            const remove = () => setDraft(current => ({
              ...current, references: current.references.filter(reference => reference !== item),
            }));
            return imageWorkspace ? (gridReferences ? <div key={key} className="om-scene-source-file" data-layout="grid" title={item.name}>
              <img src={assetMediaUrl(assetId, versionId)} alt="" />
              <span className="om-sr-only">{item.name}</span>
              <IconButton variant="plain" className="om-scene-source-remove" aria-label={removeLabel} icon={removeIcon} onClick={remove} />
            </div> : <div key={key} className="om-scene-source-file">
              {preview}
              <IconButton variant="plain" aria-label={removeLabel} icon={removeIcon} onClick={remove} />
            </div>) : <Button variant="plain" key={key} className="om-nav-item" aria-label={removeLabel} onClick={remove}>
              {preview}{removeIcon}
            </Button>;
          })}
        </div>}
        {draft.references.length < attachableReferences && <div className="om-source-actions" role={onUploadFiles ? 'group' : undefined} tabIndex={onUploadFiles ? 0 : undefined} aria-label={onUploadFiles ? t('Drop or paste images here') : undefined}>
          {onUploadReference && <Button variant="ghost" className="om-button h-auto" disabled={uploadingReferences} aria-busy={uploadingReferences || undefined} onClick={onUploadReference}>
            <RemixIcon name={uploadingReferences ? 'loader-4-line' : 'upload-line'} size={18} className={uploadingReferences ? 'animate-spin motion-reduce:animate-none' : undefined} />
            {t(uploadingReferences ? 'Uploading…' : 'Upload image')}
          </Button>}
          <Button variant="ghost" className="om-button h-auto" onClick={onReference}><RemixIcon name="image-2-line" size={18} />{t('Choose an asset')}</Button>
          {onUploadFiles && <p className="om-muted om-source-hint">{t('Drop or paste images here')}</p>}
        </div>}
      </section>}
      {feature === 'relight' && <section className="om-relight-controls" aria-label={t('Lighting')}>
        {relightControls.map(control => <div className="om-relight-field" key={control.key}>
          <span className="om-eyebrow">{t(control.label)}</span>
          <Select appearance="boxed" popupClassName={imagePopupClass} label={t(control.label)} value={draft.relight?.[control.key] ?? control.choices[0].value}
            options={control.choices.map(choice => ({ value: choice.value, label: t(choice.label) }))}
            onCommit={value => setDraft(current => ({ ...current, relight: { ...current.relight, [control.key]: value } }))} />
        </div>)}
      </section>}
      {videoFeatureRule && <section className="om-relight-controls" aria-label={t(scene!.label)}>
        {videoFeatureRule.controls.map(control => <div className="om-relight-field" key={control.key}>
          <span className="om-eyebrow">{t(control.label)}</span>
          <Select label={t(control.label)} value={draft.videoChoices?.[control.key] ?? defaultVideoFeatureChoice(control).value}
            options={control.choices.map(choice => ({ value: choice.value, label: t(choice.label) }))}
            onCommit={value => setDraft(current => ({ ...current, videoChoices: { ...current.videoChoices, [control.key]: value } }))} />
        </div>)}
      </section>}
      {!scene && <div className="om-creation-scene"><span className="om-badge"><RemixIcon name={selected?.mode === 'text-to-speech' ? 'voiceprint-line' : kind.icon} size={14} />{t(selected?.mode === 'text-to-speech' ? 'Text to speech' : draft.modality === 'audio' ? 'Music & sound' : draft.modality === 'video' ? draft.references.length ? 'Image to video' : 'Create video' : draft.references.length && selected?.supportsImageReference ? 'Edit image' : 'Create image')}</span><span className="om-eyebrow">{t('Settings follow your model')}</span></div>}
      {promptField}
      {!imageWorkspace && <><div className="om-creation-model">{modelPicker}</div>{setup}{modelNotice}</>}
      {inputImageRatio && <p className="om-muted" role="status">{t('Aspect ratio follows the first frame.')} {t('Fixed ratio choices are unavailable while a first frame is attached. Remove it to restore your text-to-video ratio.')}</p>}

      {!imageWorkspace && generationSettings}
    </div>
    {imageWorkspace && <>
      <div className="om-creation-submit om-image-parameters">
        {generationSettings}
        <div className="om-creation-model">{modelPicker}</div>
        {setup}
        {modelNotice}
      </div>
      <div className="om-image-submit">{generate}</div>
    </>}
    </div>
    {!imageWorkspace && <div className="om-creation-submit">{generate}<p className="om-creation-save-note"><RemixIcon name="stack-line" size={13} />{t('Saved automatically to your library')}</p><p className="om-eyebrow om-creation-billing">{t('Model usage is billed to your configured account.')}</p></div>}
    </>}
  </aside>;
}
