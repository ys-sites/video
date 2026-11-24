import { useEffect, useState } from 'react';
import { Button } from 'open-design-ui/button';
import {
  cleanLegacyScenarioTitle,
  findScenario,
  scenarioCategories,
  scenariosByCategory,
  type ScenarioId,
} from '../../../shared/scenarios';
import type { ScenarioRunSummary } from '../../../shared/scenario-runs';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { scenarioCover } from '../scenario/scenarioCovers';
import { scenarioClient } from '../scenario/scenarioClient';
import { ExploreCoverImage } from './ExploreCoverImage';
import './scenarioNavigation.css';

const MAX_MEGA_RECENT = 3;
const MEGA_RECENT_FETCH_LIMIT = 15;

export function selectMegaMenuRecentRuns(
  runs: readonly ScenarioRunSummary[],
  maxItems = MAX_MEGA_RECENT,
): { visible: ScenarioRunSummary[]; hiddenCount: number } {
  const seenScenarios = new Set<ScenarioId>();
  const visible: ScenarioRunSummary[] = [];
  for (const run of runs) {
    if (run.archivedAt !== null) continue;
    if (seenScenarios.has(run.scenarioId)) continue;
    seenScenarios.add(run.scenarioId);
    visible.push(run);
    if (visible.length >= maxItems) break;
  }
  const activeCount = runs.filter(run => run.archivedAt === null).length;
  return {
    visible,
    hiddenCount: Math.max(0, activeCount - visible.length),
  };
}

export function ScenarioMegaMenu({
  activeScenarioId,
  onSelect,
  onOpenHub,
}: {
  activeScenarioId: ScenarioId | 'hub' | null;
  onSelect: (id: ScenarioId, runId?: string) => void;
  onOpenHub: () => void;
}) {
  const { t } = useI18n();
  const [recentRuns, setRecentRuns] = useState<ScenarioRunSummary[]>([]);
  const [hiddenRecentCount, setHiddenRecentCount] = useState(0);
  const [hasMoreRecent, setHasMoreRecent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    scenarioClient
      .list({ limit: MEGA_RECENT_FETCH_LIMIT })
      .then(result => {
        if (!cancelled && Array.isArray(result?.runs)) {
          const { visible, hiddenCount } = selectMegaMenuRecentRuns(result.runs, MAX_MEGA_RECENT);
          setRecentRuns(visible);
          setHiddenRecentCount(hiddenCount);
          setHasMoreRecent(result.nextOffset !== null && result.nextOffset !== undefined);
        }
      })
      .catch(() => {
        // Optional recent-runs strip stays hidden if the run service is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="om-scenario-mega">
      <div className="om-scenario-mega-columns">
        {scenarioCategories.map(category => {
          const items = scenariosByCategory(category.id);
          return (
            <section
              key={category.id}
              className="om-scenario-mega-column"
              aria-label={t(category.label)}
              data-scenario-category={category.id}
            >
              <div className="om-scenario-mega-column-head" data-category={category.id}>
                <RemixIcon name={category.icon} size={14} aria-hidden="true" />
                <h2>{t(category.label)}</h2>
              </div>
              <div className="om-scenario-mega-list">
                {items.map(scenario => (
                  <Button
                    key={scenario.id}
                    variant="plain"
                    className="om-scene-tile om-scenario-mega-tile"
                    data-scenario-tile={scenario.id}
                    aria-current={activeScenarioId === scenario.id ? 'page' : undefined}
                    onClick={() => onSelect(scenario.id)}
                  >
                    <span className="om-scene-tile-art om-scenario-mega-thumb" aria-hidden="true">
                      <ExploreCoverImage src={scenarioCover(scenario.id)} eager />
                    </span>
                    <span className="om-scenario-mega-copy">
                      <span className="om-scenario-mega-title">
                        <strong>{t(scenario.title)}</strong>
                        {scenario.badge && (
                          <span className="om-badge" data-nav-badge={scenario.badge} lang="en">
                            {scenario.badge}
                          </span>
                        )}
                      </span>
                      <span className="om-scenario-mega-subtitle">{t(scenario.subtitle)}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="om-scenario-mega-footer">
        {recentRuns.length > 0 && (
          <div className="om-scenario-mega-recent" aria-label={t('Recent')}>
            <span className="om-scenario-mega-recent-label">{t('Recent')}</span>
            <div className="om-scenario-mega-recent-list">
              {recentRuns.map(run => {
                const def = findScenario(run.scenarioId);
                const displayTitle = cleanLegacyScenarioTitle(run.title);
                return (
                  <Button
                    key={run.id}
                    variant="plain"
                    className="om-nav-item om-scenario-mega-run"
                    title={def ? `${t(def.title)} · ${displayTitle}` : displayTitle}
                    onClick={() => onSelect(run.scenarioId, run.id)}
                  >
                    <RemixIcon name={def?.icon ?? 'time-line'} size={13} aria-hidden="true" />
                    <span className="om-scenario-mega-run-title">{displayTitle}</span>
                  </Button>
                );
              })}
              {(hiddenRecentCount > 0 || hasMoreRecent) && (
                <Button
                  variant="plain"
                  className="om-nav-item om-scenario-mega-more"
                  title={t('Manage run history')}
                  onClick={onOpenHub}
                >
                  {hiddenRecentCount > 0
                    ? t('+{count} more', { count: hiddenRecentCount })
                    : t('More')}
                </Button>
              )}
            </div>
          </div>
        )}
        <Button
          variant="plain"
          className="om-nav-item om-scenario-mega-all"
          onClick={onOpenHub}
        >
          <span>{t('All workflows')}</span>
          <RemixIcon name="arrow-right-line" size={15} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
