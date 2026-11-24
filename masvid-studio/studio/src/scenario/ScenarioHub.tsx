import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  findScenario,
  scenarioCategories,
  scenarioDefinitions,
  type ScenarioCategory,
  type ScenarioId,
} from '../../../shared/scenarios';
import type { ScenarioRunSummary } from '../../../shared/scenario-runs';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { FilterChip } from '../components/ui/FilterChip';
import { FieldInput } from '../components/ui/FormField';
import { PanelEmptyState } from '../components/ui/PanelEmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Tab, Tabs, TabsList } from '../components/ui/Tabs';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { BackToExploreButton } from '../motion/BackToExploreButton';
import { ScenarioCard } from './ScenarioCard';
import { scenarioClient } from './scenarioClient';
import { scenarioCover } from './scenarioCovers';
import { RUN_HISTORY_KEEP_LATEST } from './ScenarioRunHistoryDialog';
import { makeScenarioRequestId } from './useScenarioRun';
import './scenario.css';

const HUB_RUNS_PAGE_SIZE = 6;

export type ScenarioHubProps = {
  category: ScenarioCategory | null;
  active: boolean;
  onCategory(category: ScenarioCategory | null): void;
  onOpenScenario(id: ScenarioId, runId?: string): void;
  onExplore(): void;
};

function RunCoverThumb({ scenarioId }: { scenarioId: ScenarioId }) {
  const src = scenarioCover(scenarioId);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  return (
    <span className="om-scenario-run-cover" aria-hidden="true">
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <CoverPlaceholder fill />
      )}
    </span>
  );
}

export function ScenarioHub({
  category,
  active,
  onCategory,
  onOpenScenario,
  onExplore,
}: ScenarioHubProps) {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const [runs, setRuns] = useState<ScenarioRunSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [runsLoading, setRunsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioId | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);

  const loadRuns = useCallback(
    async (offset = 0, append = false) => {
      if (append) setLoadingMore(true);
      else setRunsLoading(true);
      setRunsError(null);
      try {
        const res = await scenarioClient.list({
          ...(scenarioFilter !== 'all' ? { scenarioId: scenarioFilter } : {}),
          ...(statusFilter === 'archived' ? { includeArchived: true } : {}),
          offset,
          limit: HUB_RUNS_PAGE_SIZE,
        });
        const fetched = (res.runs ?? []).filter(item =>
          statusFilter === 'archived' ? item.archivedAt !== null : item.archivedAt === null,
        );
        setRuns(prev => {
          if (!append) return fetched;
          const seen = new Set(prev.map(item => item.id));
          return [...prev, ...fetched.filter(item => !seen.has(item.id))];
        });
        setNextOffset(res.nextOffset ?? null);
      } catch (err) {
        setRunsError(err instanceof Error ? err.message : t('Could not load recent drafts'));
      } finally {
        setRunsLoading(false);
        setLoadingMore(false);
      }
    },
    [scenarioFilter, statusFilter, t],
  );

  useEffect(() => {
    if (!active) return;
    void loadRuns(0, false);
  }, [active, loadRuns]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const filteredScenarios = useMemo(
    () => (category ? scenarioDefinitions.filter(item => item.category === category) : [...scenarioDefinitions]),
    [category],
  );

  const olderToTidy = useMemo(() => {
    if (statusFilter !== 'active' || runs.length <= RUN_HISTORY_KEEP_LATEST) return [];
    return runs.slice(RUN_HISTORY_KEEP_LATEST);
  }, [runs, statusFilter]);

  const beginRename = (run: ScenarioRunSummary) => {
    skipBlurRef.current = false;
    setRenamingId(run.id);
    setRenameDraft(run.title);
  };

  const commitRename = async (run: ScenarioRunSummary) => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === run.title) return;

    setBusyId(run.id);
    try {
      const res = await scenarioClient.updateRun({
        runId: run.id,
        expectedRevision: run.revision,
        requestId: makeScenarioRequestId('rename'),
        changes: { title: trimmed },
      });
      setRuns(prev =>
        prev.map(item =>
          item.id === run.id
            ? { ...item, title: res.run.title, revision: res.run.revision, updatedAt: res.run.updatedAt }
            : item,
        ),
      );
      toast.showToast(t('Draft renamed'), 'info', 'feedback');
    } catch (err) {
      toast.showToast(
        err instanceof Error ? err.message : t('Could not rename draft'),
        'error',
        'feedback',
      );
    } finally {
      setBusyId(null);
    }
  };

  const handleSetArchived = useCallback(
    async (run: ScenarioRunSummary, archived: boolean) => {
      setBusyId(run.id);
      try {
        await scenarioClient.updateRun({
          runId: run.id,
          expectedRevision: run.revision,
          requestId: makeScenarioRequestId(archived ? 'archive' : 'restore'),
          changes: { archived },
        });
        setRuns(prev => prev.filter(item => item.id !== run.id));
        toast.showToast(
          archived ? t('Draft archived') : t('Draft restored'),
          'info',
          'feedback',
        );
      } catch (err) {
        toast.showToast(
          err instanceof Error
            ? err.message
            : archived
              ? t('Could not archive draft')
              : t('Could not restore draft'),
          'error',
          'feedback',
        );
      } finally {
        setBusyId(null);
      }
    },
    [t, toast],
  );

  const handleTidyOlder = useCallback(async () => {
    if (olderToTidy.length === 0) return;
    setTidying(true);
    const archivedIds = new Set<string>();
    try {
      for (const item of olderToTidy) {
        try {
          await scenarioClient.updateRun({
            runId: item.id,
            expectedRevision: item.revision,
            requestId: makeScenarioRequestId('tidy'),
            changes: { archived: true },
          });
          archivedIds.add(item.id);
        } catch {
          // Continue archiving remaining older drafts.
        }
      }
      if (archivedIds.size > 0) {
        setRuns(prev => prev.filter(item => !archivedIds.has(item.id)));
        toast.showToast(
          t('Archived {count} older draft(s)', { count: archivedIds.size }),
          'info',
          'feedback',
        );
      }
    } finally {
      setTidying(false);
    }
  }, [olderToTidy, t, toast]);

  return (
    <section
      className="om-scenario-hub"
      data-scenario-hub=""
      data-category={category ?? 'all'}
      data-active={active ? 'true' : 'false'}
      aria-label={t('Workflows')}
    >
      <div className="om-scenario-hub-inner">
        <div className="om-scenario-hub-topbar">
          <BackToExploreButton onClick={onExplore} />
        </div>

        <header className="om-scenario-hub-hero">
          <div className="om-scenario-hub-hero-copy">
            <h1 className="om-title om-scenario-hub-title">{t('Workflows')}</h1>
            <p className="om-muted">
              {t('Pick a workflow to build step by step with shared Assets, or copy its Skills to your Agent.')}
            </p>
          </div>

          <nav aria-label={t('Workflow categories')}>
            <Tabs
              value={category ?? 'all'}
              onValueChange={value => onCategory(value === 'all' ? null : (value as ScenarioCategory))}
            >
              <TabsList aria-label={t('Workflow categories')} className="om-scenario-hub-tabs">
                <Tab value="all">
                  <span>{t('All')}</span>
                  <span className="om-scenario-tab-count">{scenarioDefinitions.length}</span>
                </Tab>
                {scenarioCategories.map(cat => {
                  const count = scenarioDefinitions.filter(s => s.category === cat.id).length;
                  return (
                    <Tab key={cat.id} value={cat.id}>
                      <RemixIcon name={cat.icon} size={14} />
                      <span>{t(cat.label)}</span>
                      <span className="om-scenario-tab-count">{count}</span>
                    </Tab>
                  );
                })}
              </TabsList>
            </Tabs>
          </nav>
        </header>

        <div className="om-scenario-hub-grid">
          {filteredScenarios.map(scenario => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              variant="card"
              onStart={() => onOpenScenario(scenario.id)}
            />
          ))}
        </div>

        <section className="om-scenario-hub-runs" aria-labelledby="om-scenario-recent-runs-heading">
          <div className="om-scenario-hub-runs-header">
            <div>
              <h2 id="om-scenario-recent-runs-heading" className="om-subtitle">
                {t('Recent drafts')}
              </h2>
              <p className="om-muted">
                {t('Pick up right where you left off — your notes, versions, and assets are all saved.')}
              </p>
            </div>
            <div className="om-scenario-hub-runs-tools">
              {olderToTidy.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  loading={tidying}
                  icon={<RemixIcon name="delete-bin-line" size={14} />}
                  onClick={() => void handleTidyOlder()}
                >
                  {t('Keep latest {count}', { count: RUN_HISTORY_KEEP_LATEST })}
                </Button>
              )}
              <Button
                variant={statusFilter === 'archived' ? 'secondary' : 'ghost'}
                size="sm"
                type="button"
                aria-pressed={statusFilter === 'archived'}
                icon={<RemixIcon name="history-line" size={14} />}
                onClick={() => setStatusFilter(prev => (prev === 'active' ? 'archived' : 'active'))}
              >
                {statusFilter === 'archived' ? t('Showing archived') : t('Archived')}
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                aria-label={t('Refresh recent drafts')}
                onClick={() => void loadRuns(0, false)}
                icon={<RemixIcon name="refresh-line" size={16} />}
              />
            </div>
          </div>

          <div className="om-scenario-hub-run-filters" role="group" aria-label={t('Filter drafts by workflow')}>
            <FilterChip
              active={scenarioFilter === 'all'}
              onClick={() => setScenarioFilter('all')}
            >
              {t('All')}
            </FilterChip>
            {scenarioDefinitions.map(def => (
              <FilterChip
                key={def.id}
                active={scenarioFilter === def.id}
                onClick={() => setScenarioFilter(def.id)}
              >
                <RemixIcon name={def.icon} size={13} />
                <span>{t(def.title)}</span>
              </FilterChip>
            ))}
          </div>

          {runsLoading ? (
            <div className="om-scenario-runs-skeleton" role="status" aria-label={t('Loading recent drafts')}>
              <Skeleton className="om-scenario-run-skeleton-row" />
              <Skeleton className="om-scenario-run-skeleton-row" />
              <Skeleton className="om-scenario-run-skeleton-row" />
            </div>
          ) : runsError ? (
            <div className="om-scenario-runs-error" role="alert">
              <RemixIcon name="error-warning-line" size={20} />
              <span>{runsError}</span>
              <Button variant="secondary" size="sm" onClick={() => void loadRuns(0, false)}>
                {t('Retry')}
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <div className="om-scenario-runs-empty">
              <PanelEmptyState
                icon={statusFilter === 'archived' ? 'history-line' : 'route-line'}
                message={statusFilter === 'archived' ? t('No archived drafts') : t('No drafts yet')}
                description={
                  statusFilter === 'archived'
                    ? t('Archived drafts for this workflow appear here so you can restore them anytime.')
                    : t('Start any workflow above to keep your ideas, visuals, and exports organized in one place.')
                }
              />
            </div>
          ) : (
            <>
              <ul className="om-scenario-runs-list">
                {runs.map(run => {
                  const def = findScenario(run.scenarioId);
                  const totalSteps = def?.steps.length ?? 0;
                  const isBusy = busyId === run.id || tidying;
                  const isRenaming = renamingId === run.id;
                  return (
                    <li key={run.id} className="om-scenario-run-row" data-run-row={run.id}>
                      <RunCoverThumb scenarioId={run.scenarioId} />
                      <div className="om-scenario-run-row-main">
                        <div className="om-scenario-run-row-title-line">
                          {isRenaming ? (
                            <FieldInput
                              ref={renameInputRef}
                              density="compact"
                              className="om-scenario-rename-input"
                              aria-label={t('Rename draft')}
                              value={renameDraft}
                              maxLength={120}
                              onChange={event => setRenameDraft(event.target.value)}
                              onBlur={() => void commitRename(run)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void commitRename(run);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  skipBlurRef.current = true;
                                  setRenamingId(null);
                                }
                              }}
                            />
                          ) : (
                            <strong className="om-scenario-run-row-title">{run.title}</strong>
                          )}
                          {def && <span className="om-badge">{t(def.title)}</span>}
                          {run.pendingJobs > 0 && (
                            <span className="om-badge" data-active="true">
                              <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
                              {t('{count} running', { count: run.pendingJobs })}
                            </span>
                          )}
                        </div>
                        <div className="om-scenario-run-row-meta">
                          <span>{t('{done}/{total} steps done', { done: run.doneSteps, total: totalSteps })}</span>
                          <span>·</span>
                          <span>{t('{count} assets', { count: run.poolCount })}</span>
                          <span>·</span>
                          <span>
                            {formatDate(run.updatedAt, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                      <div className="om-scenario-run-row-actions">
                        {statusFilter === 'active' ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => onOpenScenario(run.scenarioId, run.id)}
                            >
                              {t('Resume')}
                            </Button>
                            <IconButton
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              aria-label={t('Rename draft')}
                              title={t('Rename draft')}
                              onClick={() => beginRename(run)}
                              icon={<RemixIcon name="edit-line" size={15} />}
                            />
                            <IconButton
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              aria-label={t('Archive draft')}
                              title={t('Archive draft')}
                              onClick={() => void handleSetArchived(run, true)}
                              icon={<RemixIcon name="delete-bin-line" size={15} />}
                            />
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isBusy}
                            icon={<RemixIcon name="arrow-go-back-line" size={14} />}
                            onClick={() => void handleSetArchived(run, false)}
                          >
                            {t('Restore')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {nextOffset !== null && (
                <div className="om-scenario-runs-more">
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    loading={loadingMore}
                    onClick={() => void loadRuns(nextOffset, true)}
                  >
                    {t('Show more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>

      <StudioToastViewport {...toast} />
    </section>
  );
}
