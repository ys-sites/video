import { useEffect, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import {
  scenarioCategories,
  scenarioSkills,
  type ScenarioDefinition,
} from '../../../shared/scenarios';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { scenarioCover } from './scenarioCovers';
import './scenario.css';

export type ScenarioCardProps = {
  scenario: ScenarioDefinition;
  variant: 'tile' | 'card' | 'compact';
  onStart(): void;
  meta?: ReactNode;
};

export function ScenarioCard({ scenario, variant, onStart, meta }: ScenarioCardProps) {
  const { t } = useI18n();
  const coverSrc = scenarioCover(scenario.id);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    setImgFailed(false);
  }, [coverSrc]);

  const category = scenarioCategories.find(item => item.id === scenario.category);
  const skillCount = scenarioSkills(scenario).length;
  const showSteps = variant !== 'compact';
  const showCta = variant === 'card' || variant === 'tile';

  return (
    <article
      className="om-scenario-card"
      data-scenario-card={scenario.id}
      data-variant={variant}
    >
      <Button
        variant="plain"
        type="button"
        className="om-scenario-card-trigger"
        onClick={onStart}
      >
        <div className="om-scenario-card-cover">
          {coverSrc && !imgFailed ? (
            <img
              src={coverSrc}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={() => setImgFailed(true)}
            />
          ) : (
            <CoverPlaceholder fill />
          )}
          {scenario.badge && (
            <span className="om-badge om-scenario-card-badge" data-nav-badge={scenario.badge}>
              {t(scenario.badge === 'Top' ? 'Featured' : scenario.badge)}
            </span>
          )}
        </div>

        <div className="om-scenario-card-body">
          <div className="om-scenario-card-eyebrow">
            {category && (
              <span className="om-scenario-card-category" data-category={scenario.category}>
                <RemixIcon name={category.icon} size={12} />
                <span>{t(category.label)}</span>
              </span>
            )}
            <span className="om-scenario-card-step-count">
              {t('{count} steps · {skills} skills', {
                count: scenario.steps.length,
                skills: skillCount,
              })}
            </span>
          </div>

          <h3 className="om-scenario-card-title">{t(scenario.title)}</h3>
          <p className="om-scenario-card-subtitle">{t(scenario.subtitle)}</p>

          {showSteps && (
            <div className="om-scenario-card-steps" aria-label={t('Workflow steps')}>
              {scenario.steps.map(step => (
                <span
                  key={step.id}
                  className="om-scenario-step-chip"
                  data-step-type={step.type}
                  title={t(step.title)}
                >
                  <RemixIcon name={step.icon} size={12} />
                  {variant === 'card' && <span>{t(step.title)}</span>}
                </span>
              ))}
            </div>
          )}

          {showCta && (
            <span className="om-scenario-card-cta">
              <span>{t(variant === 'tile' ? 'Start' : 'Start workflow')}</span>
              <RemixIcon name="arrow-right-line" size={14} />
            </span>
          )}
        </div>
      </Button>

      {meta && <div className="om-scenario-card-meta">{meta}</div>}
    </article>
  );
}
