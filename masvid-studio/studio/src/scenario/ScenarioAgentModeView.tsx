import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  scenarioCategories,
  scenarioConcisePrompt,
  scenarioSkills,
  type PoolKind,
  type ScenarioBriefField,
  type ScenarioDefinition,
  type ScenarioId,
  type ScenarioPromptIntegration,
  type ScenarioRunSummaryForPrompt,
  type ScenarioStepDefinition,
} from '../../../shared/scenarios';
import type {
  PoolItem,
  PoolRef,
  ScenarioBundleReceipt,
  ScenarioRun,
  ScenarioStepState,
} from '../../../shared/scenario-runs';
import { Select } from '../components/ui';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { FilterChip } from '../components/ui/FilterChip';
import { FieldInput, FieldTextarea } from '../components/ui/FormField';
import type { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { AssetPoolPanel, type PoolExportOptions } from './AssetPoolPanel';
import { scenarioCover } from './scenarioCovers';
import { buildShowcaseSlides } from './ScenarioStage';
import type { BriefSaveRef, ScenarioRunApi } from './stepContract';
import { briefPresetsFor, type BriefPreset } from './steps/briefPresets';
import { SocialPlatformGlyph } from './steps/SocialPlatformGlyph';
import { isScenarioConflictError, stepStatusLabel } from './steps/stepUtils';
import { cleanBriefForSave, useBriefAutosave } from './useBriefAutosave';

const PRIMARY_FIELDS_BY_SCENARIO: Record<ScenarioId, readonly string[]> = {
  'black-friday': ['productName', 'salePrice', 'promoCode', 'saleWindow', 'audience', 'cta'],
  'motion-full-chain': ['concept', 'durationSeconds', 'aspect', 'visualStyle', 'audience'],
  'gemini-4-neon': ['concept', 'codeStyle', 'durationSeconds', 'audience'],
  'design-full-chain': ['productName', 'audience', 'visualStyle', 'cta'],
  'ai-influencer': ['personaName', 'niche', 'topic', 'voiceStyle', 'audience'],
};

function initialBriefValues(
  fields: readonly ScenarioBriefField[],
  brief: Record<string, string | string[]> | undefined,
  locale: string,
): Record<string, string | string[]> {
  const next: Record<string, string | string[]> = {};
  for (const field of fields) {
    const existing = brief?.[field.id];
    if (field.kind === 'list' || field.kind === 'multi') {
      next[field.id] = Array.isArray(existing) ? [...existing] : [];
    } else if (typeof existing === 'string') {
      next[field.id] = existing;
    } else if (field.id === 'language') {
      next[field.id] = locale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    } else {
      next[field.id] = '';
    }
  }
  return next;
}

export type ScenarioAgentModeViewProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  activeStep: ScenarioStepDefinition;
  api: ScenarioRunApi;
  briefSaveRef: BriefSaveRef;
  integration: ScenarioPromptIntegration | null;
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
  poolItems: PoolItem[];
  highlightedIds: ReadonlySet<string>;
  onRefresh(): Promise<void>;
  onAddPoolItems(
    items: {
      ref: PoolRef;
      label?: string;
      tags?: string[];
      stepId?: string | null;
      source: PoolItem['source'];
    }[],
  ): Promise<string[]>;
  onUpdatePoolItem(
    poolItemId: string,
    changes: { label?: string; tags?: string[]; pinned?: boolean },
  ): Promise<void>;
  onRemovePoolItem(poolItemId: string): Promise<void>;
  onOpenDesignProject(id: string): void;
  onOpenMotionProject(id: string): Promise<boolean>;
  onExportBundle(options?: PoolExportOptions): Promise<ScenarioBundleReceipt | null>;
  exportingBundle: boolean;
  onCopySummaryJson(): Promise<void>;
  onCopyAgentPrompt(customPrompt?: string): Promise<void>;
  onOpenMcp(example?: string): void;
  onOpenStep(stepId: string): void;
  onSwitchToManual(): void;
};

export function ScenarioAgentModeView({
  scenario,
  run,
  activeStep,
  api,
  briefSaveRef,
  integration,
  toast,
  poolItems,
  highlightedIds,
  onRefresh,
  onAddPoolItems,
  onUpdatePoolItem,
  onRemovePoolItem,
  onOpenDesignProject,
  onOpenMotionProject,
  onExportBundle,
  exportingBundle,
  onCopySummaryJson,
  onCopyAgentPrompt,
  onOpenMcp,
  onOpenStep,
  onSwitchToManual,
}: ScenarioAgentModeViewProps) {
  const { t, locale } = useI18n();

  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    initialBriefValues(scenario.briefFields, run?.brief, locale),
  );
  const [moreExpanded, setMoreExpanded] = useState(false);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null);
  const [failedThumbs, setFailedThumbs] = useState<ReadonlySet<string>>(() => new Set());
  const [videoFailedId, setVideoFailedId] = useState<string | null>(null);

  const coverSrc = scenarioCover(scenario.id);
  const category = useMemo(
    () => scenarioCategories.find(item => item.id === scenario.category),
    [scenario.category],
  );
  const showcaseSlides = useMemo(() => buildShowcaseSlides(scenario), [scenario]);
  const selectedSlide = useMemo(
    () => showcaseSlides.find(slide => slide.id === selectedSlideId) ?? null,
    [selectedSlideId, showcaseSlides],
  );
  const selectedSlideStep = useMemo(
    () => (selectedSlide ? scenario.steps.find(step => step.id === selectedSlide.stepId) ?? null : null),
    [scenario.steps, selectedSlide],
  );

  useEffect(() => {
    setCoverFailed(false);
    setSelectedSlideId(null);
    setFailedThumbs(new Set());
    setVideoFailedId(null);
  }, [scenario.id]);

  const dirtyFieldsRef = useRef<Set<string>>(new Set());
  const activeFieldRef = useRef<string | null>(null);
  const latestValuesRef = useRef(values);
  latestValuesRef.current = values;

  const runId = run?.id ?? null;
  const prevScenarioIdRef = useRef(scenario.id);
  const prevRunIdRef = useRef<string | null>(runId);

  // Reset form when scenario changes or switching between persisted runs (keep dirty edits during null -> createdId).
  useEffect(() => {
    const scenarioChanged = prevScenarioIdRef.current !== scenario.id;
    const prevRunId = prevRunIdRef.current;
    const switchedToDifferentRun =
      prevRunId !== runId && (prevRunId !== null || runId === null);

    prevScenarioIdRef.current = scenario.id;
    prevRunIdRef.current = runId;

    if (scenarioChanged || switchedToDifferentRun) {
      dirtyFieldsRef.current.clear();
      const reset = initialBriefValues(scenario.briefFields, run?.brief, locale);
      latestValuesRef.current = reset;
      setValues(reset);
      setMoreExpanded(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id, runId]);

  // Merge remote brief updates without overwriting dirty or actively focused user inputs.
  useEffect(() => {
    if (!run?.brief) return;
    setValues(prev => {
      const next = { ...prev };
      let changed = false;
      for (const field of scenario.briefFields) {
        if (dirtyFieldsRef.current.has(field.id) || activeFieldRef.current === field.id) continue;
        const remote = run.brief[field.id];
        if (remote === undefined) continue;
        const prevSerialized = JSON.stringify(prev[field.id] ?? '');
        const nextSerialized = JSON.stringify(remote);
        if (prevSerialized !== nextSerialized) {
          next[field.id] = Array.isArray(remote) ? [...remote] : remote;
          changed = true;
        }
      }
      if (changed) {
        latestValuesRef.current = next;
      }
      return changed ? next : prev;
    });
  }, [run?.brief, run?.revision, scenario.briefFields]);

  const { flushBrief, scheduleAutosave } = useBriefAutosave(
    scenario.briefFields, api.mutate, dirtyFieldsRef, latestValuesRef, briefSaveRef,
  );

  const updateField = (fieldId: string, value: string | string[]) => {
    dirtyFieldsRef.current.add(fieldId);
    const next = { ...latestValuesRef.current, [fieldId]: value };
    latestValuesRef.current = next;
    setValues(next);
    scheduleAutosave();
  };

  const presets = useMemo(() => briefPresetsFor(scenario.id, locale), [scenario.id, locale]);

  const handleApplyPreset = (preset: BriefPreset) => {
    const merged = initialBriefValues(scenario.briefFields, preset.values, locale);
    for (const field of scenario.briefFields) {
      dirtyFieldsRef.current.add(field.id);
    }
    latestValuesRef.current = merged;
    setValues(merged);
    scheduleAutosave();
    toast.showToast(t('Example applied'), 'info', 'feedback');
  };

  const handleClearAll = () => {
    const cleared = initialBriefValues(scenario.briefFields, {}, locale);
    for (const field of scenario.briefFields) {
      dirtyFieldsRef.current.add(field.id);
    }
    latestValuesRef.current = cleared;
    setValues(cleared);
    scheduleAutosave();
  };

  const hasAnyText = useMemo(
    () =>
      scenario.briefFields.some(field => {
        if (field.id === 'tone' || field.id === 'language') return false;
        const raw = values[field.id];
        if (Array.isArray(raw)) return raw.some(v => v.trim().length > 0);
        return typeof raw === 'string' && raw.trim().length > 0;
      }),
    [scenario.briefFields, values],
  );

  const fieldsById = useMemo(
    () => new Map<string, ScenarioBriefField>(scenario.briefFields.map(field => [field.id, field])),
    [scenario.briefFields],
  );

  const primaryFieldIds = PRIMARY_FIELDS_BY_SCENARIO[scenario.id];
  const primaryFields = useMemo(
    () =>
      primaryFieldIds
        .map(id => fieldsById.get(id))
        .filter((field): field is ScenarioBriefField => Boolean(field)),
    [fieldsById, primaryFieldIds],
  );

  const remainingFields = useMemo(() => {
    const primarySet = new Set<string>(['idea', ...primaryFieldIds]);
    return scenario.briefFields.filter(field => !primarySet.has(field.id));
  }, [primaryFieldIds, scenario.briefFields]);

  const ideaField = fieldsById.get('idea');
  const ideaValue = typeof values.idea === 'string' ? values.idea : '';

  const uniqueSkills = useMemo(() => scenarioSkills(scenario), [scenario]);

  const previewRunSummary: ScenarioRunSummaryForPrompt | null = useMemo(() => {
    if (!run) return null;
    const stepsSummary: ScenarioRunSummaryForPrompt['steps'] = {};
    for (const [key, st] of Object.entries(run.steps)) {
      stepsSummary[key] = {
        stepId: st.stepId,
        status: st.status,
        activeIterationId: st.activeIterationId,
        links: st.links,
      };
    }
    return {
      id: run.id,
      title: run.title,
      revision: run.revision,
      locale: run.locale,
      brief: cleanBriefForSave(scenario.briefFields, values),
      activeStepId: run.activeStepId,
      steps: stepsSummary,
      pool: run.pool.map(item => ({
        id: item.id,
        kind: item.kind as PoolKind,
        label: item.label,
        stepId: item.stepId,
        pinned: item.pinned,
        ref: item.ref,
      })),
    };
  }, [run, scenario.briefFields, values]);

  const previewPromptText = useMemo(() => {
    if (!promptPreviewOpen) return '';
    const currentIdea = typeof values.idea === 'string' ? values.idea : '';
    return scenarioConcisePrompt(scenario, previewRunSummary, {
      customPrompt: currentIdea,
      locale,
      integration,
    });
  }, [integration, locale, previewRunSummary, promptPreviewOpen, scenario, values.idea]);

  const handleCopyClick = async () => {
    if (copying) return;
    setCopying(true);
    try {
      await flushBrief();
      const currentIdeaText =
        typeof latestValuesRef.current.idea === 'string' ? latestValuesRef.current.idea : '';
      await onCopyAgentPrompt(currentIdeaText);
    } catch (error) {
      if (!isScenarioConflictError(error)) toast.showToast(t('Could not save. Try again.'), 'error', 'feedback');
    } finally {
      setCopying(false);
    }
  };

  const handleSyncClick = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await onRefresh();
    } finally {
      setSyncing(false);
    }
  };

  const renderField = (field: ScenarioBriefField, compact = false) => {
    const raw = values[field.id];
    const stringVal = typeof raw === 'string' ? raw : '';
    const arrayVal = Array.isArray(raw) ? raw : [];
    const inputId = `agent-brief-${scenario.id}-${field.id}`;
    const isWide = field.kind === 'textarea' || field.kind === 'list' || field.kind === 'multi';

    return (
      <div
        key={field.id}
        className={isWide ? 'om-agent-param-field om-agent-param-field--wide' : 'om-agent-param-field'}
        data-agent-field={field.id}
      >
        <label className="om-agent-param-label" htmlFor={inputId}>
          {t(field.label)}
          {field.required && <span className="om-step-required" aria-hidden="true">*</span>}
        </label>

        {field.kind === 'textarea' && (
          <FieldTextarea
            id={inputId}
            className="om-agent-textarea"
            rows={3}
            value={stringVal}
            maxLength={field.maxLength}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            onFocus={() => { activeFieldRef.current = field.id; }}
            onBlur={() => { activeFieldRef.current = null; }}
            onChange={e => updateField(field.id, e.target.value)}
          />
        )}

        {(field.kind === 'text' || field.kind === 'url' || field.kind === 'price') && (
          <FieldInput
            id={inputId}
            density={compact ? 'compact' : 'regular'}
            className="om-agent-input"
            type={field.kind === 'url' ? 'url' : 'text'}
            value={stringVal}
            maxLength={field.maxLength}
            placeholder={field.placeholder ? t(field.placeholder) : undefined}
            onFocus={() => { activeFieldRef.current = field.id; }}
            onBlur={() => { activeFieldRef.current = null; }}
            onChange={e => updateField(field.id, e.target.value)}
          />
        )}

        {field.kind === 'select' && field.options && (
          <Select
            label={t(field.label)}
            value={stringVal || field.options[0]?.id || ''}
            options={field.options.map(opt => ({ value: opt.id, label: t(opt.label) }))}
            onCommit={next => updateField(field.id, next)}
          />
        )}

        {field.kind === 'multi' && field.options && (
          <div className="om-step-chip-list" role="group" aria-label={t(field.label)}>
            {field.options.map(opt => {
              const selected = arrayVal.includes(opt.id);
              return (
                <FilterChip
                  key={opt.id}
                  active={selected}
                  className={field.id === 'platformFocus' ? 'om-step-platform-chip' : undefined}
                  onClick={() => {
                    const next = selected
                      ? arrayVal.filter(id => id !== opt.id)
                      : [...arrayVal, opt.id];
                    updateField(field.id, next);
                  }}
                >
                  {field.id === 'platformFocus' && <SocialPlatformGlyph platform={opt.id} size="sm" />}
                  <span>{t(opt.label)}</span>
                </FilterChip>
              );
            })}
          </div>
        )}

        {field.kind === 'list' && (
          <div className="om-step-list-field">
            {(arrayVal.length ? arrayVal : ['']).map((entry, idx) => (
              <div key={idx} className="om-step-list-row">
                <FieldInput
                  density="compact"
                  className="om-agent-input"
                  value={entry}
                  maxLength={field.maxLength}
                  placeholder={field.placeholder ? t(field.placeholder) : undefined}
                  aria-label={`${t(field.label)} ${idx + 1}`}
                  onFocus={() => { activeFieldRef.current = field.id; }}
                  onBlur={() => { activeFieldRef.current = null; }}
                  onChange={e => {
                    const next = arrayVal.length ? [...arrayVal] : [''];
                    next[idx] = e.target.value;
                    updateField(field.id, next);
                  }}
                />
                {arrayVal.length > 1 && (
                  <IconButton
                    size="sm"
                    variant="ghost"
                    type="button"
                    aria-label={t('Remove item')}
                    icon={<RemixIcon name="close-line" size={14} />}
                    onClick={() => {
                      const next = arrayVal.filter((_, i) => i !== idx);
                      updateField(field.id, next);
                    }}
                  />
                )}
              </div>
            ))}
            {arrayVal.length < 5 && (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                icon={<RemixIcon name="add-line" size={14} />}
                onClick={() => updateField(field.id, [...(arrayVal.length ? arrayVal : ['']), ''])}
              >
                {t('Add item')}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="om-agent-mode-layout">
      <div className="om-agent-mode-main">
        <section
          className="om-agent-showcase"
          data-agent-section="showcase"
          aria-label={t('Examples')}
        >
          <header className="om-agent-showcase-hero">
            <span
              className="om-agent-showcase-cover"
              data-has-cover={coverSrc && !coverFailed ? 'true' : undefined}
              aria-hidden="true"
            >
              {coverSrc && !coverFailed ? (
                <img
                  src={coverSrc}
                  alt=""
                  draggable={false}
                  onError={() => setCoverFailed(true)}
                />
              ) : (
                <CoverPlaceholder fill />
              )}
            </span>

            <div className="om-agent-showcase-copy">
              <div className="om-agent-showcase-title-row">
                <h1 className="om-agent-showcase-title">{t(scenario.title)}</h1>
                {category && (
                  <span
                    className="om-badge om-scenario-header-category"
                    data-category={scenario.category}
                  >
                    <RemixIcon name={category.icon} size={11} />
                    <span>{t(category.label)}</span>
                  </span>
                )}
              </div>
              <p className="om-agent-showcase-subtitle">{t(scenario.subtitle)}</p>
            </div>

            <div className="om-agent-showcase-actions">
              {selectedSlide ? (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="close-line" size={14} />}
                  onClick={() => setSelectedSlideId(null)}
                >
                  {t('Hide preview')}
                </Button>
              ) : (
                <span className="om-badge om-agent-showcase-tag">
                  <RemixIcon name="sparkling-line" size={11} />
                  <span>{t('Examples')}</span>
                </span>
              )}
            </div>
          </header>

          {selectedSlide && (
            <div className="om-agent-showcase-preview" data-agent-preview={selectedSlide.stepId}>
              <div className="om-agent-showcase-preview-media">
                {selectedSlide.video && videoFailedId !== selectedSlide.id ? (
                  <video
                    key={selectedSlide.id}
                    src={selectedSlide.video}
                    poster={selectedSlide.poster}
                    muted
                    loop
                    playsInline
                    controls
                    preload="metadata"
                    aria-label={t(selectedSlide.title)}
                    onError={() => setVideoFailedId(selectedSlide.id)}
                  />
                ) : selectedSlide.poster && !failedThumbs.has(selectedSlide.id) ? (
                  <img
                    src={selectedSlide.poster}
                    alt={t(selectedSlide.title)}
                    draggable={false}
                  />
                ) : (
                  <CoverPlaceholder fill />
                )}
              </div>
              <div className="om-agent-showcase-preview-bar">
                <div className="om-agent-showcase-preview-copy">
                  <span
                    className="om-agent-showcase-caption-icon"
                    data-step-type={selectedSlide.stepType}
                    aria-hidden="true"
                  >
                    <RemixIcon name={selectedSlide.icon} size={13} />
                  </span>
                  <strong>{t(selectedSlide.title)}</strong>
                  {selectedSlideStep && (
                    <span className="om-agent-showcase-preview-hint">
                      {t(selectedSlideStep.hint)}
                    </span>
                  )}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  icon={<RemixIcon name="arrow-right-line" size={13} />}
                  onClick={() => onOpenStep(selectedSlide.stepId)}
                >
                  {t('Open step')}
                </Button>
              </div>
            </div>
          )}

          <div className="om-agent-showcase-strip" role="list" aria-label={t('Example preview')}>
            {showcaseSlides.map(slide => {
              const selected = slide.id === selectedSlideId;
              const thumbFailed = failedThumbs.has(slide.id);
              return (
                <Button
                  key={slide.id}
                  variant="plain"
                  type="button"
                  role="listitem"
                  className="om-agent-showcase-card"
                  data-selected={selected ? 'true' : undefined}
                  data-showcase-step={slide.stepId}
                  aria-pressed={selected}
                  onClick={() => {
                    setVideoFailedId(null);
                    setSelectedSlideId(prev => (prev === slide.id ? null : slide.id));
                  }}
                >
                  <span className="om-agent-showcase-thumb">
                    {slide.poster && !thumbFailed ? (
                      <img
                        src={slide.poster}
                        alt=""
                        loading="lazy"
                        draggable={false}
                        onError={() =>
                          setFailedThumbs(prev => {
                            const next = new Set(prev);
                            next.add(slide.id);
                            return next;
                          })
                        }
                      />
                    ) : (
                      <CoverPlaceholder fill />
                    )}
                    {slide.video && (
                      <span className="om-agent-showcase-play" aria-hidden="true">
                        <RemixIcon name="play-fill" size={11} />
                      </span>
                    )}
                  </span>
                  <span className="om-agent-showcase-caption">
                    <span
                      className="om-agent-showcase-caption-icon"
                      data-step-type={slide.stepType}
                      aria-hidden="true"
                    >
                      <RemixIcon name={slide.icon} size={12} />
                    </span>
                    <span className="om-agent-showcase-caption-label">{t(slide.title)}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </section>

        <div className="om-agent-section" data-agent-section="assets">
          <AssetPoolPanel
            scenario={scenario}
            run={run}
            currentStep={activeStep}
            items={poolItems}
            highlightedIds={highlightedIds}
            open={true}
            onOpenChange={() => {}}
            presentation="inline"
            onRefresh={onRefresh}
            pickRequest={null}
            onConfirmPick={() => {}}
            onCancelPick={() => {}}
            onAddItems={onAddPoolItems}
            onUpdateItem={onUpdatePoolItem}
            onRemoveItem={onRemovePoolItem}
            onUseInCurrentStep={async () => {}}
            onOpenDesignProject={onOpenDesignProject}
            onOpenMotionProject={onOpenMotionProject}
            onExportBundle={onExportBundle}
            exportingBundle={exportingBundle}
            onCopySummaryJson={onCopySummaryJson}
            toast={toast}
          />
        </div>

        <section
          className="om-agent-composer"
          data-agent-section="composer"
          inert={api.busy.has('create-new-run')}
          aria-label={t('Input')}
        >
          <header className="om-agent-composer-header">
            <div className="om-agent-composer-title-group">
              <span className="om-agent-composer-icon" aria-hidden="true">
                <RemixIcon name="sparkling-line" size={16} />
              </span>
              <h2 className="om-agent-composer-title">{t('Input')}</h2>
              {api.busy.has('brief-autosave') && (
                <span className="om-step-muted">{t('Saving…')}</span>
              )}
            </div>

            <div className="om-agent-composer-presets">
              <span className="om-brief-presets-label">{t('Try:')}</span>
              <div className="om-step-chip-list">
                {presets.map(preset => (
                  <Button
                    key={preset.id}
                    variant="ghost"
                    size="sm"
                    type="button"
                    className="om-brief-preset-chip"
                    onClick={() => handleApplyPreset(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
                {hasAnyText && (
                  <Button variant="ghost" size="sm" type="button" onClick={handleClearAll}>
                    {t('Clear')}
                  </Button>
                )}
              </div>
            </div>
          </header>

          <FieldTextarea
            id={`agent-prompt-${scenario.id}`}
            className="om-agent-prompt-input"
            rows={4}
            aria-label={t('Prompt')}
            placeholder={t('Describe what you want this workflow to create…')}
            value={ideaValue}
            maxLength={ideaField?.maxLength}
            onFocus={() => { activeFieldRef.current = 'idea'; }}
            onBlur={() => { activeFieldRef.current = null; }}
            onChange={e => updateField('idea', e.target.value)}
          />

          <div className="om-agent-param-grid">
            {primaryFields.map(field => renderField(field, true))}
          </div>

          {remainingFields.length > 0 && (
            <div className="om-agent-more-params">
              <Button
                variant="ghost"
                size="sm"
                type="button"
                aria-expanded={moreExpanded}
                icon={<RemixIcon name="equalizer-line" size={14} />}
                onClick={() => setMoreExpanded(prev => !prev)}
              >
                {t(moreExpanded ? 'Hide parameters' : 'More parameters')}
              </Button>
              {moreExpanded && (
                <div className="om-agent-param-grid om-agent-param-grid--more">
                  {remainingFields.map(field => renderField(field, true))}
                </div>
              )}
            </div>
          )}

          <footer className="om-agent-composer-footer">
            <span className="om-agent-composer-status">
              {poolItems.length > 0
                ? t('{count} assets ready for Agent', { count: poolItems.length })
                : t('Add reference files above to share with your Agent.')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              icon={<RemixIcon name="route-line" size={14} />}
              onClick={onSwitchToManual}
            >
              {t('Switch to step by step')}
            </Button>
          </footer>
        </section>
      </div>

      <aside className="om-agent-mode-sidebar" aria-label={t('MCP instructions')}>
        <section
          className="om-agent-copy-panel"
          data-agent-section="copy-agent"
          aria-label="MCP"
        >
          <Button
            variant="primary"
            size="md"
            type="button"
            className="om-agent-copy-primary"
            loading={copying}
            icon={<RemixIcon name="plug-line" size={16} />}
            title={t('Copy MCP prompt')}
            onClick={() => void handleCopyClick()}
          >
            MCP
          </Button>
          <p className="om-agent-copy-subtitle">
            {t('Copies concise metadata, attached Assets, and this workflow’s Skills for your Agent.')}
          </p>
          <div className="om-agent-copy-actions">
            <Button
              variant="ghost"
              size="sm"
              type="button"
              loading={syncing}
              icon={<RemixIcon name="refresh-line" size={14} />}
              onClick={() => void handleSyncClick()}
            >
              {t('Sync')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              icon={<RemixIcon name="plug-line" size={14} />}
              onClick={() => onOpenMcp()}
            >
              {t('MCP guide')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-expanded={promptPreviewOpen}
              icon={<RemixIcon name="code-s-slash-line" size={14} />}
              onClick={() => setPromptPreviewOpen(prev => !prev)}
            >
              {t(promptPreviewOpen ? 'Hide prompt' : 'Preview prompt')}
            </Button>
          </div>
          {promptPreviewOpen && (
            <pre className="om-agent-prompt-preview">{previewPromptText}</pre>
          )}
        </section>

        <section
          className="om-agent-skills-panel"
          data-agent-section="skills-workflow"
          aria-label={t('Skills workflow')}
        >
          <header className="om-agent-skills-header">
            <h2 className="om-agent-skills-title">{t('Skills workflow')}</h2>
            <span className="om-agent-skills-meta">
              {t('{steps} steps · {skills} skills', {
                steps: scenario.steps.length,
                skills: uniqueSkills.length,
              })}
            </span>
          </header>

          <ol className="om-agent-skills-timeline">
            {scenario.steps.map(step => {
              const stepState = run?.steps[step.id];
              const status: ScenarioStepState['status'] =
                stepState?.status ?? (step.type === 'brief' ? 'in-progress' : 'todo');
              const iterationsCount = stepState?.iterations.length ?? 0;
              return (
                <li
                  key={step.id}
                  className="om-agent-skills-step"
                  data-agent-step={step.id}
                >
                  <span
                    className="om-agent-skills-step-icon"
                    data-step-type={step.type}
                    aria-hidden="true"
                  >
                    <RemixIcon name={step.icon} size={14} />
                  </span>
                  <div className="om-agent-skills-step-body">
                    <div className="om-agent-skills-step-head">
                      <div className="om-agent-skills-step-titles">
                        <strong className="om-agent-skills-step-title">{t(step.title)}</strong>
                        <span className="om-step-badge" data-status={status}>
                          {t(stepStatusLabel(status))}
                        </span>
                        {iterationsCount > 0 && (
                          <span className="om-step-badge">
                            {t('{count} versions', { count: iterationsCount })}
                          </span>
                        )}
                      </div>
                      <IconButton
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t('Open {step} in step-by-step mode', {
                          step: t(step.title),
                        })}
                        title={t('Open {step} in step-by-step mode', {
                          step: t(step.title),
                        })}
                        icon={<RemixIcon name="arrow-right-line" size={14} />}
                        onClick={() => onOpenStep(step.id)}
                      />
                    </div>
                    <p className="om-agent-skills-step-hint">{t(step.hint)}</p>
                    {step.skills && step.skills.length > 0 && (
                      <div className="om-agent-skill-list">
                        {step.skills.map(skill => (
                          <span
                            key={`${step.id}:${skill.id}`}
                            className="om-agent-skill-chip"
                            data-skill-source={skill.source}
                            title={t(skill.role)}
                          >
                            <RemixIcon
                              name={skill.source === 'library' ? 'book-open-line' : 'route-line'}
                              size={12}
                            />
                            <span>{t(skill.label)}</span>
                            <code className="om-agent-skill-id">{skill.id}</code>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </aside>
    </div>
  );
}
