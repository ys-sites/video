import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem, ScenarioRun, ScenarioStepState, StepIteration } from '../../../../shared/scenario-runs';
import type { ScenarioDefinition, ScenarioStepDefinition } from '../../../../shared/scenarios';
import { Select } from '../../components/ui';
import { FilterChip } from '../../components/ui/FilterChip';
import { FieldTextarea } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { providerDisplayName } from '../../motion/imageMenuModels';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { useMediaCatalog } from '../../motion/useMediaCatalog';
import { ScenarioApiError } from '../scenarioClient';
import type { StepProps } from '../stepContract';
import { countStepPendingJobs } from '../useScenarioRun';
import {
  briefStringValue,
  buildStepAgentPrompt,
  copyText,
  extractErrorMessage,
  isScenarioConflictError,
  jobStateLabel,
  pickDefaultScenarioModelId,
  poolKindIcon,
  selectScenarioModels,
} from './stepUtils';

export function StepMediaOutputs({
  iteration,
  pool,
  fallback,
}: {
  iteration: StepIteration;
  pool: StepProps['pool'];
  fallback?: string;
}) {
  const { t } = useI18n();
  if (iteration.job && (iteration.job.state === 'queued' || iteration.job.state === 'running')) {
    return <Skeleton className="om-step-iter-skeleton" />;
  }
  if (iteration.job && (iteration.job.state === 'failed' || iteration.job.state === 'cancelled')) {
    return (
      <span className="om-step-iter-error">
        {iteration.job.error ?? t(jobStateLabel(iteration.job.state))}
      </span>
    );
  }
  const items = iteration.outputs
    .filter((out): out is { type: 'pool'; poolItemId: string } => out.type === 'pool')
    .map(out => pool.byId.get(out.poolItemId))
    .filter((item): item is PoolItem => Boolean(item));
  if (!items.length) {
    return fallback ? <span className="om-step-muted">{fallback}</span> : null;
  }
  return (
    <div className="om-step-iter-thumbs">
      {items.slice(0, 4).map(item =>
        item.ref.type === 'asset' && item.kind === 'image' ? (
          <img
            key={item.id}
            className="om-step-iter-thumb"
            src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
            alt={item.label}
            loading="lazy"
          />
        ) : (
          <span key={item.id} className="om-step-iter-pill">
            <RemixIcon name={poolKindIcon(item.kind)} size={13} />
            <span>{item.label}</span>
          </span>
        ),
      )}
    </div>
  );
}

export type StepCapabilityBarProps = {
  scenario: ScenarioDefinition;
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  run: ScenarioRun | null;
  active: boolean;
  api: StepProps['api'];
  pool: StepProps['pool'];
  toast: StepProps['toast'];
  nav: StepProps['nav'];
  stepPrompt?: string;
  allowQuickMedia?: boolean;
  defaultModality?: 'image' | 'video' | 'audio';
  compact?: boolean;
  onAfterSync?: () => Promise<void> | void;
};

export function StepCapabilityBar({
  scenario,
  step,
  state,
  run,
  active,
  api,
  pool,
  toast,
  nav,
  stepPrompt,
  allowQuickMedia = false,
  defaultModality = 'image',
  compact = false,
  onAfterSync,
}: StepCapabilityBarProps) {
  const { t, locale } = useI18n();
  const { info: integration } = useIntegrationInfo();

  const [quickOpen, setQuickOpen] = useState(false);
  const [modality, setModality] = useState<'image' | 'video' | 'audio'>(defaultModality);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [promptTouched, setPromptTouched] = useState(false);
  const [providerUnavailable, setProviderUnavailable] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [copyingMcp, setCopyingMcp] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fallbackPrompt = useMemo(() => {
    const explicit = stepPrompt?.trim();
    if (explicit) return explicit;
    if (!run?.brief) return '';
    return [
      briefStringValue(run.brief, 'productName'),
      briefStringValue(run.brief, 'personaName'),
      briefStringValue(run.brief, 'concept'),
      briefStringValue(run.brief, 'idea'),
      briefStringValue(run.brief, 'visualStyle'),
    ]
      .filter(Boolean)
      .join(' — ');
  }, [run?.brief, stepPrompt]);

  const [quickPrompt, setQuickPrompt] = useState(fallbackPrompt);

  const userSelectedModelRef = useRef(false);

  useEffect(() => {
    setQuickOpen(false);
    setModality(defaultModality);
    setRefIds([]);
    setPromptTouched(false);
    setProviderUnavailable(false);
    userSelectedModelRef.current = false;
  }, [step.id, defaultModality]);

  useEffect(() => {
    userSelectedModelRef.current = false;
  }, [step.id, modality]);

  useEffect(() => {
    if (!promptTouched) {
      setQuickPrompt(fallbackPrompt);
    }
  }, [fallbackPrompt, promptTouched]);

  const { catalog, failed: catalogFailed, retry: retryCatalog } = useMediaCatalog(
    allowQuickMedia && active && quickOpen,
  );

  const availableModels = useMemo(
    () => selectScenarioModels(catalog, modality),
    [catalog, modality],
  );

  const defaultModelId = useMemo(
    () => pickDefaultScenarioModelId(availableModels, catalog, modality),
    [availableModels, catalog, modality],
  );

  const [selectedModelId, setSelectedModelId] = useState(defaultModelId);
  useEffect(() => {
    if (!userSelectedModelRef.current || !availableModels.some(m => m.id === selectedModelId)) {
      setSelectedModelId(defaultModelId);
    }
  }, [availableModels, selectedModelId, defaultModelId]);

  useEffect(() => {
    if (availableModels.length > 0) {
      setProviderUnavailable(false);
    }
  }, [availableModels.length]);

  const selectedModel = useMemo(
    () => availableModels.find(m => m.id === selectedModelId) ?? availableModels[0],
    [availableModels, selectedModelId],
  );

  const refItems = useMemo(
    () =>
      refIds
        .map(id => pool.byId.get(id))
        .filter((item): item is PoolItem => Boolean(item)),
    [pool.byId, refIds],
  );
  const activeRefIds = useMemo(() => refItems.map(item => item.id), [refItems]);

  const pendingJobs = countStepPendingJobs(state);
  const noProvider = (catalog !== undefined && availableModels.length === 0) || providerUnavailable;

  const resolvedStepPrompt = (promptTouched ? quickPrompt.trim() : '') || fallbackPrompt;

  const handleToggleQuick = () => {
    setQuickOpen(prev => {
      const next = !prev;
      if (next && !promptTouched) {
        setQuickPrompt(fallbackPrompt);
      }
      return next;
    });
  };

  const handleCopyMcp = async () => {
    setCopyingMcp(true);
    try {
      let ensuredRun = run;
      if (!ensuredRun) {
        try {
          ensuredRun = await api.ensureRun();
        } catch {
          ensuredRun = null;
        }
      }
      const promptText = buildStepAgentPrompt(scenario, ensuredRun, {
        stepId: step.id,
        stepPrompt: resolvedStepPrompt || undefined,
        locale,
        integration,
      });
      const ok = await copyText(promptText);
      toast.showToast(
        ok
          ? t('Copied MCP prompt. Paste into your Agent to write assets back into this step.')
          : t('Could not copy to clipboard.'),
        ok ? 'info' : 'error',
        'feedback',
      );
    } finally {
      setCopyingMcp(false);
    }
  };

  const handleSync = async () => {
    if (!run) return;
    setSyncing(true);
    try {
      await api.refresh();
      await onAfterSync?.();
      toast.showToast(t('Synced latest assets'), 'info', 'feedback');
    } finally {
      setSyncing(false);
    }
  };

  const handlePickReference = async () => {
    const picked = await pool.requestPick({
      slot: 'quickReference',
      kinds: ['image'],
      max: 1,
      selected: activeRefIds,
    });
    if (picked) {
      setRefIds(picked.slice(0, 1));
    }
  };

  const handleQuickGenerate = async () => {
    const trimmed = quickPrompt.trim();
    if (!selectedModel || !trimmed) return;
    setGenerating(true);
    const targetMode = modality === 'audio'
      ? (selectedModel.mode === 'text-to-speech' ? 'text-to-speech' : 'text-to-audio')
      : undefined;
    try {
      await api.mutate(`quick-gen:${step.id}:${modality}`, 'generate', {
        stepId: step.id,
        modality,
        model: selectedModel.id,
        ...(targetMode ? { mode: targetMode } : {}),
        prompt: trimmed,
        ...(modality !== 'audio' && activeRefIds.length ? { referencePoolItemIds: activeRefIds } : {}),
      });
      toast.showToast(
        t('Generation started. New outputs will appear in Assets.'),
        'info',
        'feedback',
      );
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

  return (
    <section
      className={compact ? 'om-step-assist-bar om-step-assist-bar--compact' : 'om-step-assist-bar'}
      data-step-assist={step.id}
      aria-label={allowQuickMedia ? t('Models and Agent tools') : t('Agent tools')}
    >
      <div className="om-step-assist-row">
        <div className="om-step-assist-lead">
          <span className="om-brief-composer-icon" data-tone={step.type} aria-hidden="true">
            <RemixIcon name={allowQuickMedia ? 'sparkling-line' : 'robot-line'} size={15} />
          </span>
          <div>
            <h3 className="om-step-section-title">
              {allowQuickMedia ? t('Create with models or an Agent') : t('Work with your Agent via MCP')}
            </h3>
            {!compact && (
              <p className="om-step-muted">
                {allowQuickMedia
                  ? t('Generate images, video, or audio directly into Assets, or copy an MCP prompt so your Agent refines and saves back here.')
                  : t('Copy an MCP prompt for this step so your Agent writes assets back here and to Assets.')}
              </p>
            )}
          </div>
          {pendingJobs > 0 && (
            <span className="om-step-badge om-step-badge--accent">
              <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
              <span>{t('{count} generating', { count: pendingJobs })}</span>
            </span>
          )}
        </div>

        <div className="om-step-assist-actions">
          {allowQuickMedia && (
            <Button
              variant={quickOpen ? 'secondary' : 'ghost'}
              size="sm"
              type="button"
              aria-expanded={quickOpen}
              icon={<RemixIcon name="sparkling-line" size={14} />}
              onClick={handleToggleQuick}
            >
              {t('Generate media')}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={copyingMcp}
            icon={<RemixIcon name="robot-line" size={14} />}
            onClick={() => void handleCopyMcp()}
          >
            {t('Copy MCP prompt')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            icon={<RemixIcon name="plug-line" size={14} />}
            onClick={() => nav.openMcp()}
          >
            {t('MCP guide')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            loading={syncing}
            disabled={!run}
            icon={<RemixIcon name="refresh-line" size={14} />}
            onClick={() => void handleSync()}
          >
            {t('Sync')}
          </Button>
        </div>
      </div>

      {allowQuickMedia && quickOpen && (
        <div className="om-step-quick-gen" data-quick-gen={step.id}>
          <div className="om-step-chip-list" role="group" aria-label={t('Media type')}>
            <FilterChip
              active={modality === 'image'}
              className="om-step-icon-chip"
              data-tone="image"
              onClick={() => setModality('image')}
            >
              <span className="om-step-chip-icon" data-tone="image" aria-hidden="true">
                <RemixIcon name="image-line" size={13} />
              </span>
              <span>{t('Image')}</span>
            </FilterChip>
            <FilterChip
              active={modality === 'video'}
              className="om-step-icon-chip"
              data-tone="video"
              onClick={() => setModality('video')}
            >
              <span className="om-step-chip-icon" data-tone="video" aria-hidden="true">
                <RemixIcon name="movie-line" size={13} />
              </span>
              <span>{t('Video')}</span>
            </FilterChip>
            <FilterChip
              active={modality === 'audio'}
              className="om-step-icon-chip"
              data-tone="audio"
              onClick={() => setModality('audio')}
            >
              <span className="om-step-chip-icon" data-tone="audio" aria-hidden="true">
                <RemixIcon name="music-2-line" size={13} />
              </span>
              <span>{t('Audio')}</span>
            </FilterChip>
          </div>

          <div className="om-step-field">
            <label className="om-step-field-label" htmlFor={`quick-gen-prompt-${step.id}`}>
              {t('Prompt')}
            </label>
            <FieldTextarea
              id={`quick-gen-prompt-${step.id}`}
              className="om-step-textarea"
              rows={2}
              value={quickPrompt}
              placeholder={
                modality === 'image'
                  ? t('Describe the image to generate')
                  : modality === 'video'
                    ? t('Describe the video clip to generate')
                    : t('Describe the music or voiceover to generate')
              }
              onChange={e => {
                setPromptTouched(true);
                setQuickPrompt(e.target.value);
              }}
            />
          </div>

          {modality !== 'audio' && (
            <div className="om-step-chip-list">
              {refItems.map(item => (
                <span key={item.id} className="om-step-bound-chip">
                  {item.ref.type === 'asset' ? (
                    <img
                      className="om-step-slot-thumb"
                      src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
                      alt=""
                      loading="lazy"
                    />
                  ) : (
                    <span className="om-step-slot-icon" data-pool-kind={item.kind} aria-hidden="true">
                      <RemixIcon name="image-line" size={14} />
                    </span>
                  )}
                  <span className="om-step-bound-chip-label">{item.label}</span>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    type="button"
                    aria-label={t('Remove {label}', { label: item.label })}
                    icon={<RemixIcon name="close-line" size={12} />}
                    onClick={() => setRefIds(prev => prev.filter(id => id !== item.id))}
                  />
                </span>
              ))}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                icon={<RemixIcon name="image-line" size={14} />}
                onClick={() => void handlePickReference()}
              >
                {refItems.length > 0 ? t('Change reference image') : t('Attach reference image')}
              </Button>
            </div>
          )}

          {catalogFailed ? (
            <div className="om-step-inline-error">
              <span>{t('Could not load available models.')}</span>
              <Button variant="ghost" size="sm" type="button" onClick={retryCatalog}>
                {t('Retry')}
              </Button>
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
                  <strong>
                    {modality === 'image'
                      ? t('No image model is configured.')
                      : modality === 'video'
                        ? t('No video model is configured.')
                        : t('No audio model is configured.')}
                  </strong>
                  <p className="om-step-muted">
                    {t('Connect a model provider to generate directly, or copy the MCP prompt so your Agent writes assets back here.')}
                  </p>
                </div>
              </div>
              <div className="om-step-provider-actions">
                <Button
                  variant="primary"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="plug-line" size={14} />}
                  onClick={() => nav.openProviders()}
                >
                  {t('Set up a provider')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="robot-line" size={14} />}
                  onClick={() => void handleCopyMcp()}
                >
                  {t('Copy MCP prompt')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="om-step-quick-gen-controls">
              <div className="om-step-quick-gen-select">
                <Select
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
              <Button
                variant="ghost"
                size="sm"
                type="button"
                icon={<RemixIcon name="plug-line" size={14} />}
                onClick={() => nav.openProviders()}
              >
                {t('Model providers')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={<RemixIcon name="sparkling-line" size={14} />}
                loading={generating}
                disabled={!selectedModel || !quickPrompt.trim()}
                onClick={() => void handleQuickGenerate()}
              >
                {t('Generate')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
