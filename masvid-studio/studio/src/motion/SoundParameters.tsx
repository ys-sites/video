import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { Slider } from 'open-design-ui/slider';
import { useId, useState } from 'react';
import type { Model } from '../../../shared/gateway';
import { generationOptions, type GenerationOption } from '../../../shared/generation-options';
import { Select } from '../components/ui/Select';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { requestParameters, type ParameterDraft } from './GenerationParameters';
import { DURATION_PRESETS, SFX_DURATION_PRESETS, SPEED_PRESETS, parseVoiceChoice, voiceCharacterDetail } from './soundPresets';
import type { SoundLiveTabId } from './soundTabs';
import { voicePreviewTrackId, type VoicePreviewController } from './voicePreviews';

const PRIMARY_AUDIO_KEYS = new Set(['voice', 'speed', 'duration', 'duration_seconds', 'instrumental', 'vocal_gender', 'loop']);

function resolveParameterState(model: Model, draft: ParameterDraft) {
  let extra: Record<string, unknown> = {};
  try {
    extra = requestParameters({ ...draft, values: {} });
  } catch {
    /* Preserve raw JSON while editing; submission validates and surfaces errors via Toast. */
  }
  const fields = (model.generationOptions ?? generationOptions(model))?.fields ?? [];
  const valueOf = (field: GenerationOption) =>
    draft.values[field.key] ?? extra[field.key] ?? model.defaults?.[field.key] ?? field.default;
  const primaryFields = fields.filter(f => PRIMARY_AUDIO_KEYS.has(f.key));
  const secondaryFields = fields.filter(f => !PRIMARY_AUDIO_KEYS.has(f.key));
  return { fields, primaryFields, secondaryFields, valueOf };
}

function updateFieldValue(draft: ParameterDraft, field: GenerationOption, next: unknown): ParameterDraft {
  const values = { ...draft.values };
  if (next === undefined) delete values[field.key];
  else values[field.key] = next;
  Object.assign(values, field.choices?.find(choice => choice.value === next)?.requires);
  return { ...draft, values };
}

function selectFeaturedVoices<T extends { value: string; detail: string }>(voices: readonly T[], activeValue: string): T[] {
  if (voices.length <= 8) return [...voices];
  const female = voices.filter(v => /\bfemale\b/i.test(v.detail));
  const male = voices.filter(v => /\bmale\b/i.test(v.detail));
  const base: T[] = [];
  for (const item of [...female.slice(0, 2), ...male.slice(0, 2)]) {
    if (!base.some(existing => existing.value === item.value)) base.push(item);
  }
  for (const item of voices) {
    if (base.length >= 4) break;
    if (!base.some(existing => existing.value === item.value)) base.push(item);
  }
  if (activeValue && !base.some(v => v.value === activeValue)) {
    const matched = voices.find(v => v.value === activeValue);
    if (matched) return [...base.slice(0, 3), matched];
  }
  return base;
}

export function SoundParameters({
  tabId,
  model,
  draft,
  disabled = false,
  voicePreview,
  onChange,
}: {
  tabId: SoundLiveTabId;
  model: Model;
  draft: ParameterDraft;
  disabled?: boolean;
  voicePreview?: VoicePreviewController;
  onChange: (draft: ParameterDraft) => void;
}) {
  const { t } = useI18n();
  const idPrefix = useId();
  const [customVoiceOpen, setCustomVoiceOpen] = useState(false);
  const [customVoiceInput, setCustomVoiceInput] = useState('');
  const { fields, primaryFields, valueOf } = resolveParameterState(model, draft);

  if (primaryFields.length === 0) return null;

  const setField = (field: GenerationOption, next: unknown) => onChange(updateFieldValue(draft, field, next));
  const instrumentalField = fields.find(f => f.key === 'instrumental');
  const instrumental = Boolean(instrumentalField && valueOf(instrumentalField));

  const renderVoiceField = (field: GenerationOption) => {
    const current = valueOf(field);
    const currentStr = current === undefined ? '' : String(current);
    if (field.kind === 'text') {
      return (
        <div className="om-sound-param-field" key={field.key}>
          <div className="om-sound-param-head">
            <label className="om-sound-field-label" htmlFor={`${idPrefix}-${field.key}`}>
              {t(field.label)}{field.required ? ' *' : ''}
            </label>
          </div>
          <label className="om-field">
            <input
              id={`${idPrefix}-${field.key}`}
              aria-label={t(field.label)}
              disabled={disabled}
              placeholder={t('Enter voice ID')}
              value={currentStr}
              onChange={event => setField(field, event.target.value || undefined)}
            />
          </label>
        </div>
      );
    }

    const parsed = (field.choices ?? []).map(choice => {
      const base = parseVoiceChoice(choice);
      return {
        ...base,
        detail: voiceCharacterDetail(base.value, base.detail),
        previewUrl: choice.previewUrl,
      };
    });
    const compactGrid = parsed.length <= 8;
    const featured = selectFeaturedVoices(parsed, currentStr);
    const isCustomVoice = Boolean(
      field.allowCustom
      && currentStr.trim()
      && !(field.choices ?? []).some(choice => String(choice.value) === currentStr),
    );
    const customBoxExpanded = customVoiceOpen || isCustomVoice;

    return (
      <div className="om-sound-param-field" key={field.key}>
        <div className="om-sound-param-head">
          <span className="om-sound-field-label">{t('Voice')}</span>
          {isCustomVoice && (
            <div className="om-sound-param-head-meta">
              <span className="om-badge">{t('Custom voice')}</span>
            </div>
          )}
        </div>

        <div
          className="om-sound-voice-grid"
          data-columns={featured.length === 1 ? '1' : undefined}
          role="group"
          aria-label={t(field.label)}
        >
          {featured.map(voice => {
            const active = currentStr === voice.value;
            const previewSource = voicePreview?.resolve(model, voice);
            const trackId = voicePreviewTrackId(model.id, voice.value);
            const isCurrent = voicePreview?.activeTrackId === trackId;
            const isPlaying = isCurrent && Boolean(voicePreview?.playing);
            const isLoading = isCurrent && Boolean(voicePreview?.loading);
            const previewLabel = t(isPlaying ? 'Pause {name}' : 'Preview {name}', { name: voice.name });

            return (
              <div
                key={voice.value}
                className="om-sound-voice-card"
                data-selected={active || undefined}
                data-playing={isPlaying || undefined}
              >
                <Button
                  type="button"
                  variant="plain"
                  className="om-sound-voice-select"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() => {
                    setCustomVoiceOpen(false);
                    setCustomVoiceInput('');
                    setField(field, voice.value);
                  }}
                >
                  <span className="om-sound-voice-copy">
                    <strong>{voice.name}</strong>
                    {voice.detail && <small>{t(voice.detail)}</small>}
                  </span>
                </Button>
                {previewSource && (
                  <Tooltip label={previewLabel}>
                    <IconButton
                      type="button"
                      variant="plain"
                      className="om-sound-voice-preview"
                      data-playing={isPlaying || undefined}
                      data-loading={isLoading || undefined}
                      aria-label={previewLabel}
                      aria-pressed={isPlaying}
                      disabled={disabled}
                      onClick={() => voicePreview?.toggle(model, voice)}
                      icon={
                        <RemixIcon
                          name={isLoading ? 'loader-4-line' : isPlaying ? 'pause-fill' : 'play-fill'}
                          size={13}
                          className={isLoading ? 'animate-spin motion-reduce:animate-none' : !isPlaying ? 'om-sound-play-glyph' : undefined}
                        />
                      }
                    />
                  </Tooltip>
                )}
              </div>
            );
          })}
        </div>

        {!compactGrid && (
          <div className="om-sound-voice-select-row">
            <Select
              label={t('All voices')}
              disabled={disabled}
              value={currentStr || '__auto'}
              onCommit={next => {
                setCustomVoiceOpen(false);
                setCustomVoiceInput('');
                setField(field, next === '__auto' ? undefined : next);
              }}
              options={[
                { value: '__auto', label: t('Model default') },
                ...parsed.map(voice => ({
                  value: voice.value,
                  label: voice.detail ? `${voice.name} · ${t(voice.detail)}` : voice.name,
                })),
              ]}
            />
          </div>
        )}

        {field.allowCustom && (
          customBoxExpanded ? (
            <div className="om-sound-custom-voice-box">
              <div className="om-sound-param-head">
                <label className="om-sound-field-label" htmlFor={`${idPrefix}-custom-voice`}>
                  {t('Custom voice ID')}
                </label>
                <IconButton
                  type="button"
                  variant="plain"
                  className="om-nav-item om-sound-reset-icon"
                  aria-label={t('Dismiss')}
                  disabled={disabled}
                  onClick={() => {
                    setCustomVoiceOpen(false);
                    setCustomVoiceInput('');
                    if (isCustomVoice) setField(field, undefined);
                  }}
                  icon={<RemixIcon name="close-line" size={13} />}
                />
              </div>
              <label className="om-field">
                <input
                  id={`${idPrefix}-custom-voice`}
                  aria-label={t('Custom voice ID')}
                  disabled={disabled}
                  placeholder={t('Optional provider voice ID')}
                  value={customVoiceOpen ? customVoiceInput : (isCustomVoice ? currentStr : '')}
                  onChange={event => {
                    const raw = event.target.value;
                    setCustomVoiceInput(raw);
                    if (!customVoiceOpen) setCustomVoiceOpen(true);
                    const next = raw.trim();
                    setField(field, next || undefined);
                  }}
                />
              </label>
            </div>
          ) : (
            <Button
              type="button"
              variant="plain"
              className="om-nav-item om-sound-custom-voice-toggle"
              disabled={disabled}
              onClick={() => {
                setCustomVoiceInput(isCustomVoice ? currentStr : '');
                setCustomVoiceOpen(true);
              }}
            >
              <RemixIcon name="add-line" size={13} />
              <span>{t('Custom voice ID')}</span>
            </Button>
          )
        )}
      </div>
    );
  };

  const renderDurationField = (field: GenerationOption) => {
    const current = valueOf(field);
    const currentNum = typeof current === 'number' ? current : undefined;
    const presets = tabId === 'sfx' || field.key === 'duration_seconds' ? SFX_DURATION_PRESETS : DURATION_PRESETS;
    return (
      <div className="om-sound-param-field" key={field.key}>
        <div className="om-sound-param-head">
          <label className="om-sound-field-label" htmlFor={`${idPrefix}-${field.key}`}>
            {t('Duration')}
          </label>
          {currentNum !== undefined && <span className="om-sound-mono-readout">{currentNum}s</span>}
        </div>
        <div className="om-sound-duration-row">
          <div className="om-sound-pill-group" role="group" aria-label={t(field.label)}>
            <Button
              type="button"
              variant="plain"
              className="om-sound-pill"
              aria-pressed={currentNum === undefined}
              disabled={disabled}
              onClick={() => setField(field, undefined)}
            >
              {t('Auto')}
            </Button>
            {presets.map(seconds => (
              <Button
                type="button"
                variant="plain"
                key={seconds}
                className="om-sound-pill"
                aria-pressed={currentNum === seconds}
                disabled={disabled}
                onClick={() => setField(field, seconds)}
              >
                {seconds}s
              </Button>
            ))}
          </div>
          <label className="om-field om-sound-duration-input">
            <input
              id={`${idPrefix}-${field.key}`}
              aria-label={t('Custom duration (seconds)')}
              type="number"
              min={field.min ?? 1}
              max={field.max}
              step={field.step ?? 1}
              disabled={disabled}
              placeholder="--"
              value={currentNum ?? ''}
              onChange={event => setField(field, event.target.value === '' ? undefined : Number(event.target.value))}
            />
            <span className="om-eyebrow" aria-hidden="true">s</span>
          </label>
        </div>
      </div>
    );
  };

  const renderSpeedField = (field: GenerationOption) => {
    const raw = valueOf(field);
    const speed = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
    const min = field.min ?? 0.5;
    const max = field.max ?? 2;
    const step = field.step ?? 0.1;
    return (
      <div className="om-sound-param-field" key={field.key}>
        <div className="om-sound-param-head">
          <span className="om-sound-field-label">{t('Speed')}</span>
          <span className="om-sound-mono-readout">{speed.toFixed(1)}x</span>
        </div>
        <div className="om-sound-speed-controls">
          <Slider
            label={t(field.label)}
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, speed))}
            disabled={disabled}
            onCommit={next => setField(field, Number(next.toFixed(1)))}
            className="om-sound-slider"
          />
          <div className="om-sound-pill-group" role="group" aria-label={t('Speed presets')}>
            {SPEED_PRESETS.map(preset => (
              <Button
                type="button"
                variant="plain"
                key={preset}
                className="om-sound-pill"
                aria-pressed={Math.abs(speed - preset) < 0.05}
                disabled={disabled}
                onClick={() => setField(field, preset)}
              >
                {preset}x
              </Button>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderBooleanField = (field: GenerationOption) => {
    const checked = Boolean(valueOf(field));
    return (
      <div className="om-sound-toggle-row" key={field.key}>
        <span className="om-sound-field-label">{t(field.label)}</span>
        <Button
          type="button"
          variant="plain"
          className="om-switch"
          role="switch"
          aria-label={t(field.label)}
          aria-checked={checked}
          disabled={disabled}
          onClick={() => setField(field, !checked)}
        >
          <span />
        </Button>
      </div>
    );
  };

  const renderChoiceField = (field: GenerationOption) => {
    const current = valueOf(field);
    const choices = field.choices ?? [];
    const fieldDisabled = disabled || (field.key === 'vocal_gender' && instrumental);
    if (choices.length <= 4) {
      return (
        <div className="om-sound-param-field" key={field.key} data-dimmed={fieldDisabled || undefined}>
          <div className="om-sound-param-head">
            <span className="om-sound-field-label">{t(field.label)}</span>
          </div>
          <div className="om-sound-pill-group" role="group" aria-label={t(field.label)}>
            <Button
              type="button"
              variant="plain"
              className="om-sound-pill"
              aria-pressed={current === undefined}
              disabled={fieldDisabled}
              onClick={() => setField(field, undefined)}
            >
              {t('Auto')}
            </Button>
            {choices.map(option => (
              <Button
                type="button"
                variant="plain"
                key={String(option.value)}
                className="om-sound-pill"
                aria-pressed={current === option.value}
                disabled={fieldDisabled}
                onClick={() => setField(field, option.value)}
              >
                {t(option.label)}
              </Button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div className="om-sound-param-field" key={field.key}>
        <div className="om-sound-param-head">
          <span className="om-sound-field-label">{t(field.label)}</span>
        </div>
        <Select
          label={t(field.label)}
          disabled={fieldDisabled}
          value={current === undefined ? '__auto' : String(current)}
          onCommit={next => setField(field, next === '__auto' ? undefined : choices.find(c => String(c.value) === next)?.value)}
          options={[
            { value: '__auto', label: t('Model default') },
            ...choices.map(option => ({ value: String(option.value), label: t(option.label) })),
          ]}
        />
      </div>
    );
  };

  return (
    <section className="om-sound-block om-sound-param-card" aria-label={t('Audio settings')}>
      {primaryFields.map(field => {
        if (field.key === 'voice') return renderVoiceField(field);
        if (field.key === 'duration' || field.key === 'duration_seconds') return renderDurationField(field);
        if (field.key === 'speed') return renderSpeedField(field);
        if (field.kind === 'boolean') return renderBooleanField(field);
        if (field.kind === 'choice') return renderChoiceField(field);
        return null;
      })}
    </section>
  );
}

export function SoundAdvancedParameters({
  model,
  draft,
  disabled = false,
  onChange,
}: {
  model: Model;
  draft: ParameterDraft;
  disabled?: boolean;
  onChange: (draft: ParameterDraft) => void;
}) {
  const { t } = useI18n();
  const idPrefix = useId();
  const { fields, secondaryFields, valueOf } = resolveParameterState(model, draft);
  // Only expose a raw JSON fallback for custom third-party models with no structured schema.
  // Built-in and OpenDesign (account/cloud) models use dedicated controls and fixed parameter contracts.
  const showRawJson = fields.length === 0 && model.provider !== 'account' && model.provider !== 'opendesign';

  if (secondaryFields.length === 0 && !showRawJson) return null;

  const setField = (field: GenerationOption, next: unknown) => onChange(updateFieldValue(draft, field, next));
  const hasSecondaryOverrides = secondaryFields.some(field => Object.hasOwn(draft.values, field.key));
  const hasJsonOverride = showRawJson && draft.advanced.trim() !== '{}';
  const hasOverrides = hasSecondaryOverrides || hasJsonOverride;

  const resetAdvanced = () => {
    const nextValues = { ...draft.values };
    for (const field of secondaryFields) delete nextValues[field.key];
    onChange({
      values: nextValues,
      advanced: showRawJson ? '{}' : draft.advanced,
    });
  };

  return (
    <details className="om-sound-block om-sound-advanced om-creation-options">
      <summary className="om-nav-item om-sound-advanced-summary">
        <RemixIcon name="equalizer-line" size={14} />
        <span>{t('Advanced')}</span>
        {hasOverrides && <span className="om-sound-override-dot" aria-label={t('Customized')} />}
        <RemixIcon name="arrow-down-s-line" size={14} />
      </summary>
      <div className="om-sound-advanced-body">
        {hasOverrides && (
          <div className="om-sound-advanced-reset">
            <Button
              type="button"
              variant="plain"
              className="om-nav-item om-sound-clear-btn"
              disabled={disabled}
              onClick={resetAdvanced}
            >
              {t('Reset')}
            </Button>
          </div>
        )}

        {secondaryFields.map(field => {
          const current = valueOf(field);
          if (field.kind === 'boolean') {
            const checked = Boolean(current);
            return (
              <div className="om-sound-toggle-row" key={field.key}>
                <span className="om-sound-field-label">{t(field.label)}</span>
                <Button
                  type="button"
                  variant="plain"
                  className="om-switch"
                  role="switch"
                  aria-label={t(field.label)}
                  aria-checked={checked}
                  disabled={disabled}
                  onClick={() => setField(field, !checked)}
                >
                  <span />
                </Button>
              </div>
            );
          }
          if (field.kind === 'choice') {
            const choices = field.choices ?? [];
            return (
              <div className="om-sound-param-field" key={field.key}>
                <span className="om-sound-field-label">{t(field.label)}</span>
                <Select
                  label={t(field.label)}
                  disabled={disabled}
                  value={current === undefined ? '__auto' : String(current)}
                  onCommit={next => setField(field, next === '__auto' ? undefined : choices.find(c => String(c.value) === next)?.value)}
                  options={[
                    { value: '__auto', label: t('Model default') },
                    ...choices.map(option => ({ value: String(option.value), label: t(option.label) })),
                  ]}
                />
              </div>
            );
          }
          if (field.kind === 'number') {
            return (
              <div className="om-sound-param-field" key={field.key}>
                <label className="om-sound-field-label" htmlFor={`${idPrefix}-${field.key}`}>{t(field.label)}</label>
                <div className="om-generation-number">
                  <label className="om-field">
                    <input
                      id={`${idPrefix}-${field.key}`}
                      aria-label={t(field.label)}
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      disabled={disabled}
                      placeholder={t('Auto')}
                      value={typeof current === 'number' ? current : ''}
                      onChange={event => setField(field, event.target.value === '' ? undefined : Number(event.target.value))}
                    />
                  </label>
                  {field.min !== undefined && field.max !== undefined && (
                    <Slider
                      label={t(field.label)}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      disabled={disabled}
                      value={Number(current ?? field.min)}
                      onCommit={next => setField(field, next)}
                    />
                  )}
                </div>
              </div>
            );
          }
          return (
            <div className="om-sound-param-field" key={field.key}>
              <label className="om-sound-field-label" htmlFor={`${idPrefix}-${field.key}`}>
                {t(field.label)}{field.required ? ' *' : ''}
              </label>
              <label className="om-field">
                <input
                  id={`${idPrefix}-${field.key}`}
                  aria-label={t(field.label)}
                  disabled={disabled}
                  value={String(current ?? '')}
                  onChange={event => setField(field, event.target.value || undefined)}
                />
              </label>
            </div>
          );
        })}

        {showRawJson && (
          <div className="om-sound-param-field">
            <label className="om-sound-field-label" htmlFor={`${idPrefix}-advanced-json`}>
              {t('JSON')}
            </label>
            <label className="om-field om-code-field">
              <textarea
                id={`${idPrefix}-advanced-json`}
                aria-label={t('Model parameters')}
                rows={3}
                disabled={disabled}
                value={draft.advanced}
                onChange={event => onChange({ ...draft, advanced: event.target.value })}
              />
            </label>
          </div>
        )}
      </div>
    </details>
  );
}
