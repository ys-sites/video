import { Button } from 'open-design-ui/button';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { compatibleImageResolutions, type GenerationOption } from '../../../shared/generation-options';
import { modelKinds, type DirectoryModel, type ModelKind, type ProviderConnection } from '../../../shared/provider-directory';
import { Select } from '../components/ui/Select';
import { useI18n, type Locale } from '../i18n/I18n';
import type { Translate } from '../i18n/messages';
import { RemixIcon } from '../icons/RemixIcons';
import { resolveModelOptions, toGatewayModel } from './modelMediaCapabilities';
import { SettingsDialog } from './settingsPrimitives';
import { defaultParameters, modelIdError } from './settingsValidation';

export const kindLabels: Record<ModelKind, string> = { text: 'Text', image: 'Image', video: 'Video', audio: 'Audio', transcription: 'Transcription', embedding: 'Embedding', reranker: 'Reranker' };
/** Model modality label: distinguishes Chinese "文本" (text modality) from editor "文字" (text layers). */
export function modelKindLabel(kind: ModelKind, t: Translate, locale?: Locale) {
  if (kind === 'text' && locale === 'zh-CN') return '文本';
  return t(kindLabels[kind]);
}
export const typeIcons: Record<ModelKind, string> = { text: 'text', image: 'image-line', video: 'film-line', audio: 'music-2-line', transcription: 'text', embedding: 'stack-line', reranker: 'equalizer-line' };

const DEFAULT_SENTINEL = '__model_default__';

function formatOptionLabel(field: GenerationOption, option: NonNullable<GenerationOption['choices']>[number], t: Translate): string {
  if (field.key === 'duration' && typeof option.value === 'number' && option.value > 0) return `${option.value}s`;
  if (field.key === 'resolution' && /^\d+k$/i.test(option.label)) return option.label.toUpperCase();
  return t(option.label);
}

function numberFieldError(field: GenerationOption, raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!/^[\d.eE+-]+$/.test(trimmed) || !Number.isFinite(value)) return 'Enter a valid number.';
  if (field.step === 1 && !Number.isInteger(value)) return 'Enter a whole number.';
  if (field.min !== undefined && value < field.min) return 'Value is below the allowed minimum.';
  if (field.max !== undefined && value > field.max) return 'Value exceeds the allowed maximum.';
  return undefined;
}

export function ModelEditor({ provider, model, onClose, save }: { provider: ProviderConnection; model?: DirectoryModel; onClose: () => void; save: (input: unknown) => Promise<boolean> }) {
  const { t, locale } = useI18n();
  const [id, setId] = useState(model?.modelId ?? ''), [label, setLabel] = useState(model?.label ?? ''), [group, setGroup] = useState(model?.group ?? '');
  const [kind, setKind] = useState<ModelKind>(model?.kind ?? (provider.protocol === 'media' ? 'image' : 'text'));
  const [defaults, setDefaults] = useState(JSON.stringify(model?.defaults ?? {}, null, 2));
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [textDrafts, setTextDrafts] = useState<Record<string, string>>({});

  const gatewayModel = useMemo(
    () => (model ? toGatewayModel({ ...model, kind }) : null),
    [model, kind],
  );
  const structuredFields = useMemo(
    () => (model ? (resolveModelOptions({ ...model, kind })?.fields ?? []) : []),
    [model, kind],
  );
  const structuredKeys = useMemo(() => new Set(structuredFields.map(item => item.key)), [structuredFields]);
  const initialHasExtraDefaults = Boolean(model?.defaults && Object.keys(model.defaults).some(key => !structuredKeys.has(key)));

  const [advanced, setAdvanced] = useState(structuredFields.length > 0 ? initialHasExtraDefaults : Boolean(model));
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(false);

  const canChangeKind = !model || !['media', 'agent', 'account'].includes(provider.protocol);
  const availableKinds = modelKinds.filter(value => (value !== 'transcription' || provider.protocol === 'openai') && (provider.protocol !== 'media' || ['image', 'video', 'audio'].includes(value)));
  const basicErrors = { id: model ? undefined : modelIdError(id), label: label.trim().length > 180 ? 'Display name cannot exceed 180 characters.' : undefined, group: group.length > 80 ? 'Group name cannot exceed 80 characters.' : undefined };
  const parsedDefaults = defaultParameters(defaults);
  const defaultsInvalid = validated && Boolean(parsedDefaults.error);
  const currentDefaults: Record<string, unknown> = parsedDefaults.error || !parsedDefaults.parameters ? {} : parsedDefaults.parameters;

  const numberErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    for (const item of structuredFields) {
      if (item.kind !== 'number' || !(item.key in numberDrafts)) continue;
      const err = numberFieldError(item, numberDrafts[item.key]);
      if (err) errors[item.key] = err;
    }
    return errors;
  }, [structuredFields, numberDrafts]);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const focusTarget = useRef<string>('defaults');
  const [focusRequest, setFocusRequest] = useState(0);
  const defaultsRef = useRef<HTMLTextAreaElement>(null);
  const defaultsId = useId();

  useEffect(() => {
    if (!focusRequest) return;
    const input = focusTarget.current === 'defaults' ? defaultsRef.current : inputRefs.current[focusTarget.current];
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  }, [focusRequest]);

  const updateDefaultsObject = (mutate: (next: Record<string, unknown>) => void) => {
    try {
      const parsed = JSON.parse(defaults);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid JSON object');
      const next = { ...(parsed as Record<string, unknown>) };
      mutate(next);
      setDefaults(JSON.stringify(next, null, 2));
    } catch {
      setValidated(true);
      setAdvanced(true);
      focusTarget.current = 'defaults';
      setFocusRequest(value => value + 1);
    }
  };

  const activeAspectRatio = currentDefaults.aspect_ratio;
  const allowedResolutions = gatewayModel && activeAspectRatio !== undefined
    ? compatibleImageResolutions(gatewayModel, activeAspectRatio)
    : undefined;

  const field = (key: 'id' | 'label' | 'group', title: string, value: string, change: (value: string) => void, required = false, disabled = false) => {
    const error = validated ? basicErrors[key] : undefined;
    const errorId = `${defaultsId}-${key}-error`;
    return <label className="om-label">{t(title)}<span className="om-field"><input ref={input => { inputRefs.current[key] = input; }} aria-label={t(title)} aria-invalid={Boolean(error) || undefined} aria-describedby={error ? errorId : undefined} value={value} onChange={e => change(e.target.value)} required={required} disabled={disabled} autoComplete="off" spellCheck={false} /></span><small id={errorId} className="om-field-error" role={error ? 'alert' : undefined}>{error ? t(error) : null}</small></label>;
  };

  const renderStructuredField = (option: GenerationOption) => {
    const savedValue = currentDefaults[option.key];
    if (option.kind === 'choice') {
      const baseChoices = option.choices ?? [];
      const choices = option.key === 'resolution' && allowedResolutions
        ? baseChoices.filter(choice => allowedResolutions.includes(String(choice.value)) || choice.value === savedValue)
        : baseChoices;
      const selectValue = savedValue === undefined || typeof savedValue === 'object' ? DEFAULT_SENTINEL : String(savedValue);
      const hasCurrentInChoices = selectValue === DEFAULT_SENTINEL || choices.some(choice => String(choice.value) === selectValue);
      const selectOptions = [
        { value: DEFAULT_SENTINEL, label: t('Model default') },
        ...(!hasCurrentInChoices && option.allowCustom ? [{ value: selectValue, label: selectValue }] : []),
        ...choices.map(choice => ({ value: String(choice.value), label: formatOptionLabel(option, choice, t) })),
      ];
      return <div className="om-label" key={option.key}>
        <span>{t(option.label)}</span>
        <Select
          label={t(option.label)}
          value={selectValue}
          options={selectOptions}
          onCommit={nextValue => updateDefaultsObject(next => {
            if (nextValue === DEFAULT_SENTINEL) {
              delete next[option.key];
            } else {
              const matched = choices.find(choice => String(choice.value) === nextValue);
              next[option.key] = matched ? matched.value : nextValue;
              if (matched?.requires) Object.assign(next, matched.requires);
            }
            if (option.key === 'aspect_ratio' && gatewayModel && next[option.key] !== undefined) {
              const nextAllowed = compatibleImageResolutions(gatewayModel, next[option.key]);
              if (nextAllowed && typeof next.resolution === 'string' && !nextAllowed.includes(next.resolution)) {
                delete next.resolution;
              }
            }
            for (const other of structuredFields) {
              if (other.key === option.key || other.kind !== 'choice') continue;
              const currentValue = next[other.key];
              if (currentValue === undefined) continue;
              const required = other.choices?.find(choice => choice.value === currentValue)?.requires;
              if (required && Object.entries(required).some(([reqKey, reqValue]) => next[reqKey] !== reqValue)) {
                delete next[other.key];
              }
            }
          })}
        />
      </div>;
    }

    if (option.kind === 'boolean') {
      const selectValue = typeof savedValue === 'boolean' ? String(savedValue) : DEFAULT_SENTINEL;
      return <div className="om-label" key={option.key}>
        <span>{t(option.label)}</span>
        <Select
          label={t(option.label)}
          value={selectValue}
          options={[
            { value: DEFAULT_SENTINEL, label: t('Model default') },
            { value: 'true', label: t('Enabled') },
            { value: 'false', label: t('Disabled') },
          ]}
          onCommit={nextValue => updateDefaultsObject(next => {
            if (nextValue === DEFAULT_SENTINEL) delete next[option.key];
            else next[option.key] = nextValue === 'true';
          })}
        />
      </div>;
    }

    if (option.kind === 'number') {
      const draft = option.key in numberDrafts
        ? numberDrafts[option.key]
        : typeof savedValue === 'number' && Number.isFinite(savedValue) ? String(savedValue) : '';
      const error = validated ? numberErrors[option.key] : undefined;
      const errorId = `${defaultsId}-param-${option.key}-error`;
      return <label className="om-label" key={option.key}>
        {t(option.label)}
        <span className="om-field">
          <input
            ref={input => { inputRefs.current[`param:${option.key}`] = input; }}
            aria-label={t(option.label)}
            type="text"
            inputMode="decimal"
            placeholder={t('Model default')}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            value={draft}
            onChange={event => {
              const raw = event.target.value;
              const err = numberFieldError(option, raw);
              if (!raw.trim()) {
                setNumberDrafts(current => { const next = { ...current }; delete next[option.key]; return next; });
                updateDefaultsObject(next => { delete next[option.key]; });
              } else {
                setNumberDrafts(current => ({ ...current, [option.key]: raw }));
                if (!err) updateDefaultsObject(next => { next[option.key] = Number(raw.trim()); });
              }
            }}
            onBlur={() => {
              if (!(option.key in numberDrafts)) return;
              const raw = numberDrafts[option.key];
              if (!raw.trim() || !numberFieldError(option, raw)) {
                setNumberDrafts(current => { const next = { ...current }; delete next[option.key]; return next; });
              }
            }}
          />
        </span>
        <small id={errorId} className="om-field-error" role={error ? 'alert' : undefined}>{error ? t(error) : null}</small>
      </label>;
    }

    const textValue = option.key in textDrafts
      ? textDrafts[option.key]
      : typeof savedValue === 'string' ? savedValue : '';
    return <label className="om-label" key={option.key}>
      {t(option.label)}
      <span className="om-field">
        <input
          aria-label={t(option.label)}
          type="text"
          placeholder={t('Model default')}
          value={textValue}
          onChange={event => {
            const raw = event.target.value;
            if (raw === '') {
              setTextDrafts(current => { const next = { ...current }; delete next[option.key]; return next; });
              updateDefaultsObject(next => { delete next[option.key]; });
            } else {
              setTextDrafts(current => ({ ...current, [option.key]: raw }));
              updateDefaultsObject(next => {
                if (!raw.trim()) delete next[option.key];
                else next[option.key] = raw;
              });
            }
          }}
          onBlur={() => {
            if (!(option.key in textDrafts)) return;
            setTextDrafts(current => { const next = { ...current }; delete next[option.key]; return next; });
          }}
        />
      </span>
    </label>;
  };

  return <SettingsDialog title={t(model ? 'Edit model' : 'Add model')} onClose={onClose}><form noValidate className="om-provider-form" onSubmit={async event => {
    event.preventDefault();
    const { parameters } = parsedDefaults;
    setValidated(true);
    const firstBasicError = (['id', 'label', 'group'] as const).find(key => basicErrors[key]);
    const firstNumberError = structuredFields.find(item => item.kind === 'number' && numberErrors[item.key])?.key;
    if (firstBasicError || firstNumberError || parsedDefaults.error) {
      focusTarget.current = firstBasicError ?? (firstNumberError ? `param:${firstNumberError}` : 'defaults');
      if (parsedDefaults.error) setAdvanced(true);
      setFocusRequest(value => value + 1);
      return;
    }
    setBusy(true);
    try { if (await save({ id: model?.id, modelId: id.trim(), label: label.trim() || id.trim(), kind, group, defaults: parameters })) onClose(); }
    finally { setBusy(false); }
  }}>
    {field('id', 'Model ID', id, setId, true, Boolean(model))}
    {field('label', 'Display name', label, setLabel)}
    {field('group', 'Group name', group, setGroup)}
    {canChangeKind && <div className="om-label">
      {t('Model type')}
      <div className="om-settings-tags">
        {availableKinds.map(value => (
          <Button variant="ghost" type="button" className="om-button h-auto" key={value} aria-pressed={kind === value} onClick={() => setKind(value)}>
            <RemixIcon name={typeIcons[value]} size={14} />{modelKindLabel(value, t, locale)}
          </Button>
        ))}
      </div>
    </div>}
    {kind === 'transcription' && <><p className="om-muted">{t('Choose a response supported by your model. Timed captions require timestamps; text-only results can still be reviewed and copied.')}</p>
      <Select label={t('Transcription response')} value={typeof currentDefaults.response_format === 'string' ? currentDefaults.response_format : 'auto'} options={[
        { value: 'auto', label: t('Model default') }, { value: 'verbose_json', label: t('Timed segments and words') }, { value: 'json', label: t('Plain transcript') }, { value: 'diarized_json', label: t('Speakers and timed segments') },
      ]} onCommit={value => updateDefaultsObject(next => {
        if (value === 'auto') delete next.response_format; else next.response_format = value;
        if (value !== 'verbose_json') delete next.timestamp_granularities;
        if (value !== 'diarized_json') delete next.chunking_strategy;
      })} />
    </>}
    {structuredFields.length > 0 && <div className="om-card om-card-stack">
      <div className="om-label">{t('Default parameters')}</div>
      <div className="om-default-param-grid">{structuredFields.map(renderStructuredField)}</div>
      <p className="om-muted">{t('Per-request choices in creation panels override these defaults.')}</p>
    </div>}
    <Button variant="plain" className="om-button om-disclosure" type="button" aria-expanded={advanced} onClick={() => setAdvanced(value => !value)}>{t('More settings')}<RemixIcon name={advanced ? 'arrow-up-line' : 'arrow-down-s-line'} size={15} /></Button>
    {advanced && <div className="om-card-stack">
      <label className="om-label">{t('Default request parameters (JSON)')}<span className="om-field om-code-field"><textarea ref={defaultsRef} aria-label={t('Default request parameters (JSON)')} aria-invalid={defaultsInvalid || undefined} aria-describedby={`${defaultsId}-help${defaultsInvalid ? ` ${defaultsId}-error` : ''}`} rows={5} spellCheck={false} value={defaults} onChange={event => {
        setNumberDrafts({});
        setTextDrafts({});
        setDefaults(event.target.value);
      }} /></span><small id={`${defaultsId}-error`} className="om-field-error" role={defaultsInvalid ? 'alert' : undefined}>{defaultsInvalid ? t(parsedDefaults.error!, { field: parsedDefaults.field ?? '' }) : null}</small><small id={`${defaultsId}-help`} className="om-muted">{t('Use the provider’s parameter names. Per-request values override these defaults. Language model settings are saved for integrations; local Agents manage their own parameters.')}</small></label>
    </div>}
    <div className="om-dialog-actions"><Button variant="ghost" className="om-button h-auto" type="button" disabled={busy} onClick={onClose}>{t('Cancel')}</Button><Button variant="ghost" className="om-button h-auto" data-primary disabled={busy}>{t(busy ? 'Saving…' : model ? 'Save model' : 'Add model')}</Button></div>
  </form></SettingsDialog>;
}
