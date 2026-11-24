import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { Slider } from 'open-design-ui/slider';
import { useId, useState } from 'react';
import { modelReferenceLimit, type Model } from '../../../shared/gateway';
import { compatibleImageResolutions, generationOptions, resolveGenerationParameters, usesInputImageRatio, videoAudioAlwaysOn, type GenerationOption } from '../../../shared/generation-options';
import { cn } from '../components/ui/cn';
import { FieldTrigger } from '../components/ui/FormField';
import { Popover } from '../components/ui/Popover';
import { Select } from '../components/ui/Select';
import { SelectArrow } from '../components/ui/SelectArrow';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';

export type ParameterDraft = { values: Record<string, unknown>; advanced: string };
export const emptyParameters: ParameterDraft = { values: {}, advanced: '{}' };

export function durationTicks(min: number, max: number): number[] {
  if (max <= min) return [min];
  const step = max - min > 30 ? 10 : 5;
  const ticks = [min];
  for (let t = Math.ceil((min + 1) / step) * step; t < max; t += step) {
    if (t - min >= 3 && max - t >= 5) ticks.push(t);
  }
  ticks.push(max);
  if (ticks.length > 5 && step === 5) ticks.splice(ticks.length - 2, 1);
  return ticks;
}

/** Map shot preferences to choices the current provider actually publishes. */
export function shotParameters(model: Model, preferences?: { aspect: string; duration?: number }): ParameterDraft {
  if (!preferences) return emptyParameters;
  const values: Record<string, unknown> = {};
  for (const field of model.generationOptions?.fields ?? []) {
    const value = field.presentation === 'ratio' ? preferences.aspect : field.key === 'duration' ? preferences.duration : undefined;
    if (value === undefined) continue;
    if (field.kind === 'choice' && field.choices?.some(choice => choice.value === value && !choice.requires)) {
      values[field.key] = value;
    } else if (field.kind === 'number' && typeof value === 'number' && Number.isFinite(value)
      && (field.step !== 1 || Number.isInteger(value))
      && (field.min === undefined || value >= field.min)
      && (field.max === undefined || value <= field.max)) {
      values[field.key] = value;
    }
  }
  return { values, advanced: '{}' };
}
export function requestParameters(draft: ParameterDraft, model?: Model, hasInputImage = false, defaultValues?: Record<string, unknown>): Record<string, unknown> {
  const extra = JSON.parse(draft.advanced);
  if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error('Model parameters must be a JSON object');
  const values = { ...draft.values };
  // Retain the inactive text-to-video choice in the editor, but keep explicit JSON instructions for validation.
  if (model && parameterInputImageRatio(model, draft, hasInputImage)) delete values.ratio;
  // Quick controls override advanced JSON, which in turn overrides Studio-level fallback defaults.
  const parameters = { ...defaultValues, ...extra, ...values };
  if (model) resolveGenerationParameters(model, parameters, hasInputImage);
  return parameters;
}
export function parameterInputImageRatio(model: Model, draft: ParameterDraft, hasInputImage: boolean): boolean {
  let parameters = draft.values;
  try { parameters = requestParameters(draft); } catch { /* Keep the reference constraint visible while JSON is being edited. */ }
  return modelReferenceLimit(model) > 0 && usesInputImageRatio(model, hasInputImage, parameters);
}

export function DurationControl({
  field,
  currentValue,
  inputId,
  showInput = true,
  onCommit,
}: {
  field: GenerationOption;
  currentValue: number | undefined;
  inputId?: string;
  showInput?: boolean;
  onCommit: (next: number | undefined) => void;
}) {
  const { t, locale } = useI18n();
  const generatedId = useId();
  const [preview, setPreview] = useState<number | null>(null);
  const seconds = new Intl.NumberFormat(locale ?? 'en', { style: 'unit', unit: 'second', unitDisplay: 'narrow' });

  if (field.kind === 'choice') {
    return (
      <div className="om-option-pills" role="group" aria-label={t(field.label)}>
        {field.choices?.map(option => (
          <Button
            variant="plain"
            key={String(option.value)}
            className="om-option-pill"
            aria-pressed={currentValue === option.value}
            onClick={() => onCommit(Number(option.value))}
          >
            {typeof option.value === 'number' && option.value > 0 ? seconds.format(option.value) : t(option.value === -1 ? 'Auto' : option.label)}
          </Button>
        ))}
      </div>
    );
  }

  const min = field.min ?? 1;
  const max = field.max ?? 30;
  const step = field.step ?? 1;
  const displayValue = preview ?? currentValue;
  const sliderValue = displayValue ?? (typeof field.default === 'number' ? field.default : min);
  const ticks = durationTicks(min, max);

  return (
    <div className="om-duration-control">
      <div className="om-creation-row om-duration-header">
        <span className="om-duration-readout">{displayValue !== undefined ? seconds.format(displayValue) : t('Auto')}</span>
        {showInput && <label className="om-field om-duration-input">
          <input
            id={inputId ?? generatedId}
            aria-label={t(field.label)}
            type="number"
            min={min}
            max={max}
            step={step}
            placeholder={t('Auto')}
            value={typeof displayValue === 'number' ? displayValue : ''}
            onChange={e => {
              setPreview(null);
              onCommit(e.target.value === '' ? undefined : Number(e.target.value));
            }}
          />
        </label>}
      </div>
      <div className="om-duration-track">
        <Slider
          label={t(field.label)}
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onPreview={setPreview}
          onCommit={next => {
            setPreview(null);
            onCommit(next);
          }}
        />
      </div>
      <div className="om-duration-ticks">
        {ticks.map(tick => (
          <Button
            variant="plain"
            key={tick}
            className="om-duration-tick"
            data-active={displayValue === tick || undefined}
            style={{ left: max > min ? `${((tick - min) / (max - min)) * 100}%` : '0%' }}
            onClick={() => {
              setPreview(null);
              onCommit(tick);
            }}
          >
            <span className="om-duration-tick-dot" aria-hidden="true" />
            <span>{tick}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

/** `hidden` fields are set by the feature itself, so they are not offered as choices. */
export function GenerationParameters({ model, draft, defaultValues, hasInputImage = false, hidden = [], appearance = 'standard', popupClassName, onChange }: {
  model: Model; draft: ParameterDraft; defaultValues?: Record<string, unknown>; hasInputImage?: boolean; hidden?: readonly string[];
  appearance?: 'standard' | 'boxed'; popupClassName?: string; onChange: (draft: ParameterDraft) => void;
}) {
  const { t } = useI18n();
  const settingsLabelId = useId();
  const settingsSummaryId = useId();
  const boxed = appearance === 'boxed';
  let extra: Record<string, unknown> = {};
  try { extra = requestParameters({ ...draft, values: {} }); } catch { /* The raw editor remains editable; submission reports parse errors through Toast. */ }
  const inputImageRatio = parameterInputImageRatio(model, draft, hasInputImage);
  const activeOptions = (hasInputImage ? generationOptions(model, true) : undefined) ?? model.generationOptions;
  const fields = (activeOptions?.fields ?? []).filter(field => (!inputImageRatio || field.key !== 'ratio') && !hidden.includes(field.key));
  const aspectField = fields.find(field => field.key === 'aspect_ratio');
  const activeAspectRatio = draft.values.aspect_ratio ?? extra.aspect_ratio ?? model.defaults?.aspect_ratio ?? aspectField?.default;
  const allowedResolutions = compatibleImageResolutions(model, activeAspectRatio, hasInputImage);
  const effectiveDefault = (field: GenerationOption) => {
    if (defaultValues && defaultValues[field.key] !== undefined) return defaultValues[field.key];
    if (field.key === 'resolution' && allowedResolutions) {
      if (!allowedResolutions.length) return undefined;
      return typeof field.default === 'string' && allowedResolutions.includes(field.default) ? field.default : allowedResolutions[0];
    }
    return field.default;
  };
  const value = (field: GenerationOption) => draft.values[field.key] ?? extra[field.key] ?? model.defaults?.[field.key] ?? effectiveDefault(field);
  const choicesFor = (field: GenerationOption) => {
    const choices = field.choices ?? [];
    if (field.key !== 'resolution' || !allowedResolutions) return choices;
    const current = value(field);
    return choices.filter(c => allowedResolutions.includes(String(c.value)) || c.value === current);
  };
  const label = (field: GenerationOption) => {
    const v = value(field), option = field.choices?.find(c => c.value === v);
    if (v === undefined) return t('Auto');
    if (typeof v === 'object') return t('Custom');
    if (typeof v === 'boolean') return t(v ? 'On' : 'Off');
    if (field.key === 'duration' && typeof v === 'number' && v > 0) return `${v}s`;
    return t(option?.label ?? String(v));
  };
  const set = (field: GenerationOption, value: unknown) => {
    const values = { ...draft.values };
    if (value === undefined) delete values[field.key]; else values[field.key] = value;
    Object.assign(values, field.choices?.find(c => c.value === value)?.requires);
    if (field.key === 'aspect_ratio') {
      const nextAllowed = compatibleImageResolutions(model, value ?? extra.aspect_ratio ?? model.defaults?.aspect_ratio ?? aspectField?.default, hasInputImage);
      if (nextAllowed && typeof values.resolution === 'string' && !nextAllowed.includes(values.resolution)) delete values.resolution;
    }
    onChange({ ...draft, values });
  };
  const summaryLabel = (field: GenerationOption) => {
    const text = label(field);
    if (/\d/.test(text) || field.key === 'aspect_ratio' || field.key === 'ratio' || field.key === 'resolution' || field.key === 'size' || field.key === 'duration') {
      return text;
    }
    return `${t(field.label)} ${text}`;
  };
  const summary = [...(inputImageRatio ? [t('Follows first frame')] : []), ...fields.filter(f => f.kind !== 'text' && f.key !== 'seed' && f.presentation !== 'count' && value(f) !== undefined).map(summaryLabel)].slice(0, 3).join(' · ');
  const constraints = Object.assign({}, ...fields.map(f => f.choices?.find(c => c.value === value(f))?.requires)) as Record<string, string | number>;
  const count = fields.find(f => f.presentation === 'count');
  const isVideo = model.modality === 'video';
  const durationField = isVideo ? fields.find(f => f.key === 'duration') : undefined;
  const resolutionField = isVideo ? fields.find(f => f.key === 'resolution') : undefined;
  const ratioField = isVideo ? fields.find(f => f.key === 'ratio') : undefined;
  const audioField = isVideo ? fields.find(f => f.key === 'generate_audio' && f.kind === 'boolean') : undefined;
  const alwaysOnAudio = isVideo && !audioField && videoAudioAlwaysOn(model);
  const hasQuickCards = Boolean(durationField || resolutionField || ratioField || audioField || alwaysOnAudio);
  const quickCardKeys = new Set(['duration', 'resolution', 'ratio', 'generate_audio']);
  const remainingFields = fields.filter(f => !quickCardKeys.has(f.key));
  const compactSummary = hasQuickCards && fields.length >= 2 && remainingFields.length === 0 && !inputImageRatio;
  const popoverFields = compactSummary ? [] : fields;

  const renderRatioTiles = (field: GenerationOption) => (
    <div className="om-generation-ratios" role="group" aria-label={t(field.label)}>
      {field.choices?.map(option => {
        const match = option.label.match(/(\d+):(\d+)/), ratio = match ? Number(match[1]) / Number(match[2]) : 1;
        return (
          <Button
            variant="plain"
            key={String(option.value)}
            className="om-option-tile"
            disabled={constraints[field.key] !== undefined && constraints[field.key] !== option.value}
            aria-pressed={value(field) === option.value}
            onClick={() => set(field, option.value)}
          >
            {match ? <span className="om-ratio-outline" style={{ width: 22 * Math.min(ratio, 1), height: 22 / Math.max(ratio, 1) }} /> : <RemixIcon name="ruler-line" size={20} />}
            <span>{t(option.label)}</span>
          </Button>
        );
      })}
    </div>
  );

  const renderChoicePills = (field: GenerationOption) => (
    <div className="om-option-pills" role="group" aria-label={t(field.label)}>
      {choicesFor(field).map(option => (
        <Button
          variant="plain"
          key={String(option.value)}
          className="om-option-pill"
          disabled={constraints[field.key] !== undefined && constraints[field.key] !== option.value}
          aria-pressed={value(field) === option.value}
          onClick={() => set(field, option.value)}
        >
          {t(option.label)}
        </Button>
      ))}
    </div>
  );

  const selectValue = (field: GenerationOption) => {
    const current = value(field);
    return current === undefined || typeof current === 'object' ? '__auto' : String(current);
  };
  const fieldSelect = (field: GenerationOption) => {
    const choices = choicesFor(field);
    const current = selectValue(field);
    const hasDefault = (model.defaults?.[field.key] ?? effectiveDefault(field)) !== undefined;
    const autoOption = !hasDefault || current === '__auto' ? [{ value: '__auto', label: t('Model default') }] : [];
    return <Select label={t(field.label)} value={current} popupClassName={popupClassName} onCommit={next => set(field, choices.find(choice => String(choice.value) === next)?.value)}
      options={[...autoOption, ...choices.map(choice => ({
        value: String(choice.value), label: t(field.key === 'resolution' && /^\d+k$/i.test(choice.label) ? choice.label.toUpperCase() : choice.label),
        disabled: constraints[field.key] !== undefined && constraints[field.key] !== choice.value,
      }))]} />;
  };
  const settingsLabel = t('Generation settings');
  const settingsSummary = compactSummary ? t('Advanced parameters') : summary || (boxed ? t('Model parameters') : settingsLabel);
  const settingsTrigger = boxed ? <FieldTrigger className="om-picker-trigger om-generation-summary"
    aria-labelledby={settingsLabelId} aria-describedby={settingsSummaryId}>
    <RemixIcon name="equalizer-line" size={17} /><span id={settingsSummaryId}>{settingsSummary}</span><SelectArrow />
  </FieldTrigger> : <Button variant="plain" className="om-nav-item om-generation-summary">
    <RemixIcon name="equalizer-line" size={17} /><span>{settingsSummary}</span><RemixIcon name="arrow-down-s-line" size={15} />
  </Button>;
  return <div className={boxed ? 'om-label' : 'om-generation-settings'}>
    {boxed && <span id={settingsLabelId} className="om-eyebrow">{settingsLabel}</span>}
    {hasQuickCards && (
      <div className="om-param-cards">
        {durationField && (
          <Popover
            side="right"
            align="start"
            aria-label={t('Duration')}
            className="om-duration-popover"
            trigger={
              <Button variant="plain" className="om-param-card" aria-label={t('Duration')}>
                <span className="om-param-card-copy">
                  <span className="om-param-card-label">{t('Duration')}</span>
                  <span className="om-param-card-value">{label(durationField)}</span>
                </span>
                <RemixIcon name="arrow-right-s-line" size={15} />
              </Button>
            }
          >
            <div className="om-creation-row">
              <strong>{t('Duration')}</strong>
              {Object.hasOwn(draft.values, durationField.key) && (
                <Button variant="plain" className="om-nav-item" onClick={() => set(durationField, undefined)}>
                  {t('Reset')}
                </Button>
              )}
            </div>
            <DurationControl
              field={durationField}
              currentValue={typeof value(durationField) === 'number' ? value(durationField) as number : undefined}
              onCommit={v => set(durationField, v)}
            />
          </Popover>
        )}
        {resolutionField && (
          <Popover
            side="right"
            align="start"
            aria-label={t('Resolution')}
            className="om-choice-popover"
            trigger={
              <Button variant="plain" className="om-param-card" aria-label={t('Resolution')}>
                <span className="om-param-card-copy">
                  <span className="om-param-card-label">{t('Resolution')}</span>
                  <span className="om-param-card-value">{label(resolutionField)}</span>
                </span>
                <RemixIcon name="arrow-right-s-line" size={15} />
              </Button>
            }
          >
            <div className="om-creation-row">
              <strong>{t('Resolution')}</strong>
              {Object.hasOwn(draft.values, resolutionField.key) && (
                <Button variant="plain" className="om-nav-item" onClick={() => set(resolutionField, undefined)}>
                  {t('Reset')}
                </Button>
              )}
            </div>
            {renderChoicePills(resolutionField)}
          </Popover>
        )}
        {ratioField && (
          <Popover
            side="right"
            align="start"
            aria-label={t('Aspect ratio')}
            className="om-ratio-popover"
            trigger={
              <Button variant="plain" className="om-param-card" aria-label={t('Aspect ratio')}>
                <span className="om-param-card-copy">
                  <span className="om-param-card-label">{t('Aspect ratio')}</span>
                  <span className="om-param-card-value">{label(ratioField)}</span>
                </span>
                <RemixIcon name="arrow-right-s-line" size={15} />
              </Button>
            }
          >
            <div className="om-creation-row">
              <strong>{t('Aspect ratio')}</strong>
              {Object.hasOwn(draft.values, ratioField.key) && (
                <Button variant="plain" className="om-nav-item" onClick={() => set(ratioField, undefined)}>
                  {t('Reset')}
                </Button>
              )}
            </div>
            {renderRatioTiles(ratioField)}
          </Popover>
        )}
        {audioField && (
          <Button
            variant="plain"
            role="switch"
            aria-label={t('Generate audio')}
            aria-checked={Boolean(value(audioField))}
            className="om-param-card om-param-audio"
            onClick={() => set(audioField, !value(audioField))}
          >
            <span className="om-param-card-copy">
              <span className="om-param-card-label">{t('Generate audio')}</span>
              <span className="om-param-card-value">{t(value(audioField) ? 'On' : 'Off')}</span>
            </span>
            <RemixIcon name={value(audioField) ? 'volume-up-line' : 'volume-mute-line'} size={15} />
          </Button>
        )}
        {alwaysOnAudio && (
          <div className="om-param-card om-param-audio om-param-card-static" aria-label={t('Generate audio')}>
            <span className="om-param-card-copy">
              <span className="om-param-card-label">{t('Generate audio')}</span>
              <span className="om-param-card-value">{t('On')}</span>
            </span>
            <RemixIcon name="volume-up-line" size={15} />
          </div>
        )}
      </div>
    )}
    <div className="om-generation-summary-row" data-compact={compactSummary || undefined}>
      <Popover side="top" align="start" aria-label={settingsLabel} className={cn('om-generation-popover', popupClassName)} trigger={settingsTrigger}>
        <div className="om-creation-row"><strong>{t('Generation settings')}</strong><Button variant="plain" className="om-nav-item" onClick={() => onChange(emptyParameters)}>{t('Reset')}</Button></div>
        <p className="om-eyebrow">{model.label}</p>
        {inputImageRatio && <p className="om-muted">{t('Aspect ratio follows the first frame.')}</p>}
        {activeOptions?.delivery === 'prompt' && <p className="om-muted">{t('Creative preferences sent to Codex. The Agent chooses the final output settings.')}</p>}
        {!fields.length && <p className="om-muted">{t('This model uses provider-specific parameters. Add them in Advanced parameters.')}</p>}
        {popoverFields.length > 0 && <div className="om-generation-fields">{popoverFields.map(field => <div className="om-generation-field" key={field.key}>
          <div className="om-creation-row"><label className="om-label" htmlFor={`generation-${field.key}`}>{t(field.label)}{field.required ? ' *' : ''}</label>{Object.hasOwn(draft.values, field.key) && <IconButton variant="plain" className="om-nav-item" aria-label={t('Reset {name}', { name: t(field.label) })} onClick={() => set(field, undefined)} icon={<RemixIcon name="refresh-line" size={14} />} />}</div>
          {field.key === 'duration' && (field.kind === 'number' || (field.kind === 'choice' && (field.choices?.length ?? 0) <= 6))
            ? <DurationControl field={field} currentValue={typeof value(field) === 'number' ? value(field) as number : undefined} inputId={`generation-${field.key}`} onCommit={v => set(field, v)} />
            : <>
                {field.kind === 'choice' && (field.presentation === 'ratio' ? renderRatioTiles(field) : isVideo && field.key === 'resolution' && (field.choices?.length ?? 0) <= 4 ? renderChoicePills(field) : fieldSelect(field))}
                {field.kind === 'boolean' && <button className="om-switch" role="switch" aria-label={t(field.label)} aria-checked={Boolean(value(field))} onClick={() => set(field, !value(field))}><span /></button>}
                {field.kind === 'number' && <div className="om-generation-number"><label className="om-field"><input id={`generation-${field.key}`} aria-label={t(field.label)} type="number" min={field.min} max={field.max} step={field.step} placeholder={t('Auto')} value={typeof value(field) === 'number' ? value(field) as number : ''} onChange={e => set(field, e.target.value === '' ? undefined : Number(e.target.value))} /></label>{field.min !== undefined && field.max !== undefined && <Slider label={t(field.label)} min={field.min} max={field.max} step={field.step} value={Number(value(field) ?? field.min)} onCommit={v => set(field, v)} />}</div>}
                {field.kind === 'text' && <label className="om-field"><input id={`generation-${field.key}`} aria-label={t(field.label)} value={String(value(field) ?? '')} onChange={e => set(field, e.target.value || undefined)} /></label>}
              </>}
        </div>)}</div>}
        <details className="om-creation-options" open={compactSummary || undefined}><summary className="om-nav-item"><RemixIcon name="code-s-slash-line" size={15} />{t('Advanced parameters')}<RemixIcon name="arrow-down-s-line" size={14} /></summary><p className="om-muted">{t('Provider JSON. Quick controls override matching fields.')}</p><label className="om-field"><textarea aria-label={t('Model parameters')} rows={4} value={draft.advanced} onChange={e => onChange({ ...draft, advanced: e.target.value })} /></label></details>
      </Popover>
      {count && <Popover side="top" align="end" aria-label={t('Output count')} trigger={<Button variant="plain" className="om-nav-item"><RemixIcon name="stack-line" size={16} />×{label(count)}</Button>}><label className="om-label">{t('Output count')}<div className="om-field"><input aria-label={t('Output count')} type="number" min={1} step={1} value={Number(value(count) ?? 1)} onChange={e => set(count, e.target.value === '' ? undefined : Number(e.target.value))} /></div></label></Popover>}
    </div>
  </div>;
}
