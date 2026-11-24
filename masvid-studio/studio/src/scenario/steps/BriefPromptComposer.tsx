import { Button } from 'open-design-ui/button';
import { useMemo } from 'react';
import type { ScenarioBriefField, ScenarioDefinition } from '../../../../shared/scenarios';
import { Select } from '../../components/ui';
import { FilterChip } from '../../components/ui/FilterChip';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import {
  BRIEF_SENTENCE_TEMPLATES,
  briefPresetsFor,
  parseSentenceTemplate,
  type BriefPreset,
} from './briefPresets';
import { SocialPlatformGlyph } from './SocialPlatformGlyph';

const OFFER_HIGHLIGHT_FIELDS = new Set(['originalPrice', 'salePrice', 'discountPercent', 'promoCode']);

export type BriefPromptComposerProps = {
  scenario: ScenarioDefinition;
  values: Record<string, string | string[]>;
  discountBadge?: string;
  savingRevision: boolean;
  autosaving: boolean;
  onUpdateField: (fieldId: string, value: string | string[]) => void;
  onFocusField: (fieldId: string | null) => void;
  onApplyPreset: (preset: BriefPreset) => void;
  onClearAll: () => void;
  onSaveRevision: () => void;
  onSwitchToForm: () => void;
};

export function BriefPromptComposer({
  scenario,
  values,
  discountBadge,
  savingRevision,
  autosaving,
  onUpdateField,
  onFocusField,
  onApplyPreset,
  onClearAll,
  onSaveRevision,
  onSwitchToForm,
}: BriefPromptComposerProps) {
  const { t, locale } = useI18n();

  const fieldsById = useMemo(
    () => new Map<string, ScenarioBriefField>(scenario.briefFields.map(field => [field.id, field])),
    [scenario.briefFields],
  );

  const templateKey = BRIEF_SENTENCE_TEMPLATES[scenario.id];
  const localizedTemplate = t(templateKey);
  const tokens = useMemo(() => parseSentenceTemplate(localizedTemplate), [localizedTemplate]);
  const presets = useMemo(() => briefPresetsFor(scenario.id, locale), [scenario.id, locale]);

  const platformField = fieldsById.get('platformFocus');

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

  return (
    <section
      className="om-step-card om-brief-composer"
      data-brief-composer="guided"
      aria-label={t('Brief details')}
    >
      <div className="om-brief-composer-head">
        <div className="om-brief-composer-lead">
          <span className="om-brief-composer-icon" data-tone="brief" aria-hidden="true">
            <RemixIcon name="sparkling-line" size={16} />
          </span>
          <p className="om-step-muted">
            {t('Fill in the highlighted blanks, or pick an example.')}
          </p>
        </div>
        <div className="om-brief-composer-head-actions">
          {discountBadge && (
            <span className="om-step-badge om-step-badge--accent" data-discount-badge="true">
              {discountBadge}
            </span>
          )}
          <div className="om-step-segmented" role="group" aria-label={t('Brief editor mode')}>
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={true}
              icon={<RemixIcon name="sparkling-line" size={13} />}
              onClick={() => {}}
            >
              {t('Fill in the blanks')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={false}
              icon={<RemixIcon name="equalizer-line" size={13} />}
              onClick={onSwitchToForm}
            >
              {t('All fields')}
            </Button>
          </div>
        </div>
      </div>

      <div className="om-brief-sentence" data-brief-sentence={scenario.id}>
        {tokens.map((token, idx) => {
          if (token.type === 'text') {
            return <span key={`t-${idx}`} className="om-brief-sentence-text">{token.text}</span>;
          }
          const field = fieldsById.get(token.fieldId);
          if (!field) return null;

          const raw = values[field.id];
          const strVal = typeof raw === 'string' ? raw : '';

          if (field.kind === 'select' && field.options) {
            const selectedVal = strVal || field.options[0]?.id || '';
            return (
              <span key={`f-${field.id}-${idx}`} className="om-blank-select" data-blank-field={field.id}>
                <Select
                  label={t(field.label)}
                  value={selectedVal}
                  options={field.options.map(opt => ({ value: opt.id, label: t(opt.label) }))}
                  onCommit={next => onUpdateField(field.id, next)}
                />
              </span>
            );
          }

          const hint = field.placeholder ? t(field.placeholder) : t(field.label);
          const isWide = field.id === 'idea' || field.id === 'concept' || field.id === 'topic';
          const filled = strVal.trim().length > 0;
          const sizerText = strVal || hint;

          return (
            <span
              key={`f-${field.id}-${idx}`}
              className="om-blank-wrap"
              data-blank-field={field.id}
              data-filled={filled ? 'true' : undefined}
              data-required={field.required ? 'true' : undefined}
              data-wide={isWide ? 'true' : undefined}
              data-highlight={OFFER_HIGHLIGHT_FIELDS.has(field.id) ? 'offer' : undefined}
              title={t(field.label)}
            >
              <span className="om-blank-sizer" aria-hidden="true">{sizerText}</span>
              <input
                id={`brief-${scenario.id}-${field.id}`}
                type={field.kind === 'url' ? 'url' : 'text'}
                size={1}
                className="om-blank-input"
                value={strVal}
                maxLength={field.maxLength}
                placeholder={hint}
                aria-label={t(field.label)}
                required={field.required}
                onFocus={() => onFocusField(field.id)}
                onBlur={() => onFocusField(null)}
                onChange={e => onUpdateField(field.id, e.target.value)}
              />
            </span>
          );
        })}
      </div>

      {platformField && platformField.options && (
        <div className="om-brief-inline-platforms">
          <span className="om-brief-presets-label">{t(platformField.label)}</span>
          <div className="om-step-chip-list" role="group" aria-label={t(platformField.label)}>
            {platformField.options.map(opt => {
              const current = Array.isArray(values[platformField.id])
                ? (values[platformField.id] as string[])
                : [];
              const selected = current.includes(opt.id);
              return (
                <FilterChip
                  key={opt.id}
                  active={selected}
                  className="om-step-platform-chip"
                  onClick={() => {
                    const next = selected
                      ? current.filter(id => id !== opt.id)
                      : [...current, opt.id];
                    onUpdateField(platformField.id, next);
                  }}
                >
                  <SocialPlatformGlyph platform={opt.id} size="sm" />
                  <span>{t(opt.label)}</span>
                </FilterChip>
              );
            })}
          </div>
        </div>
      )}

      <div className="om-brief-composer-foot">
        <div className="om-brief-presets">
          <span className="om-brief-presets-label">{t('Try:')}</span>
          <div className="om-step-chip-list">
            {presets.map(preset => (
              <Button
                key={preset.id}
                variant="ghost"
                size="sm"
                className="om-brief-preset-chip"
                onClick={() => onApplyPreset(preset)}
              >
                {preset.label}
              </Button>
            ))}
            {hasAnyText && (
              <Button variant="ghost" size="sm" onClick={onClearAll}>
                {t('Clear')}
              </Button>
            )}
          </div>
        </div>

        <div className="om-step-toolbar-group">
          {autosaving && <span className="om-step-muted">{t('Saving…')}</span>}
          <Button
            variant="ghost"
            size="sm"
            icon={<RemixIcon name="save-line" size={14} />}
            loading={savingRevision}
            onClick={onSaveRevision}
          >
            {t('Save version')}
          </Button>
        </div>
      </div>
    </section>
  );
}
