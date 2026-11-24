import { Dialog } from '@base-ui/react/dialog';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScenarioRunSummary } from '../../../shared/scenario-runs';
import type { ScenarioDefinition } from '../../../shared/scenarios';
import { FieldInput } from '../components/ui/FormField';
import { PanelEmptyState } from '../components/ui/PanelEmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { Tab, Tabs, TabsList } from '../components/ui/Tabs';
import type { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { scenarioClient } from './scenarioClient';
import { scenarioCover } from './scenarioCovers';
import { makeScenarioRequestId } from './useScenarioRun';

export const RUN_HISTORY_KEEP_LATEST = 5;
const RUN_HISTORY_PAGE_SIZE = 12;

export type ScenarioRunHistoryDialogProps = {
  scenario: ScenarioDefinition;
  open: boolean;
  onOpenChange(open: boolean): void;
  activeRunId: string | null;
  onSelectRun(runId: string): void;
  onNewRun(): Promise<void> | void;
  onActiveRunChanged?: (
    action: 'renamed' | 'archived',
    runId: string,
    nextFallbackId?: string | null,
  ) => void;
  onHistoryMutated?: () => void;
  toast: Pick<ReturnType<typeof useToast>, 'showToast'>;
};

export function ScenarioRunHistoryDialog({
  scenario,
  open,
  onOpenChange,
  activeRunId,
  onSelectRun,
  onNewRun,
  onActiveRunChanged,
  onHistoryMutated,
  toast,
}: ScenarioRunHistoryDialogProps) {
  const { t, formatDate } = useI18n();
  const [runs, setRuns] = useState<ScenarioRunSummary[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'active' | 'archived'>('active');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);

  const loadRuns = useCallback(
    async (offset = 0, append = false) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await scenarioClient.list({
          scenarioId: scenario.id,
          includeArchived: true,
          offset,
          limit: RUN_HISTORY_PAGE_SIZE,
        });
        const fetched = res.runs ?? [];
        setRuns(prev => {
          if (!append) return fetched;
          const seen = new Set(prev.map(item => item.id));
          return [...prev, ...fetched.filter(item => !seen.has(item.id))];
        });
        setNextOffset(res.nextOffset ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Could not load recent drafts'));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [scenario.id, t],
  );

  useEffect(() => {
    if (!open) {
      setRenamingId(null);
      setQuery('');
      setView('active');
      return;
    }
    void loadRuns(0, false);
  }, [open, loadRuns]);

  useEffect(() => {
    if (renamingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renamingId]);

  const activeRuns = useMemo(() => runs.filter(item => item.archivedAt === null), [runs]);
  const archivedRuns = useMemo(() => runs.filter(item => item.archivedAt !== null), [runs]);

  const visibleRuns = useMemo(() => {
    const source = view === 'active' ? activeRuns : archivedRuns;
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return source;
    return source.filter(item => item.title.toLowerCase().includes(trimmed));
  }, [activeRuns, archivedRuns, query, view]);

  // Older active drafts eligible for 1-click tidy-up (always preserve current run + newest 5).
  const olderToTidy = useMemo(() => {
    if (activeRuns.length <= RUN_HISTORY_KEEP_LATEST) return [];
    const kept = new Set<string>();
    if (activeRunId) kept.add(activeRunId);
    for (const item of activeRuns) {
      if (kept.size >= RUN_HISTORY_KEEP_LATEST) break;
      kept.add(item.id);
    }
    return activeRuns.filter(item => !kept.has(item.id));
  }, [activeRunId, activeRuns]);

  const beginRename = (item: ScenarioRunSummary) => {
    skipBlurRef.current = false;
    setRenamingId(item.id);
    setRenameDraft(item.title);
  };

  const commitRename = async (item: ScenarioRunSummary) => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed || trimmed === item.title) return;

    setBusyId(item.id);
    try {
      const res = await scenarioClient.updateRun({
        runId: item.id,
        expectedRevision: item.revision,
        requestId: makeScenarioRequestId('rename'),
        changes: { title: trimmed },
      });
      setRuns(prev =>
        prev.map(entry =>
          entry.id === item.id
            ? { ...entry, title: res.run.title, revision: res.run.revision, updatedAt: res.run.updatedAt }
            : entry,
        ),
      );
      if (item.id === activeRunId) {
        onActiveRunChanged?.('renamed', item.id);
      }
      onHistoryMutated?.();
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

  const handleSetArchived = async (item: ScenarioRunSummary, archived: boolean) => {
    setBusyId(item.id);
    try {
      const res = await scenarioClient.updateRun({
        runId: item.id,
        expectedRevision: item.revision,
        requestId: makeScenarioRequestId(archived ? 'archive' : 'restore'),
        changes: { archived },
      });
      const updatedArchivedAt = res.run.archivedAt;
      setRuns(prev =>
        prev.map(entry =>
          entry.id === item.id
            ? {
                ...entry,
                archivedAt: updatedArchivedAt,
                revision: res.run.revision,
                updatedAt: res.run.updatedAt,
              }
            : entry,
        ),
      );
      if (archived && item.id === activeRunId) {
        const nextActive = activeRuns.find(entry => entry.id !== item.id) ?? null;
        onActiveRunChanged?.('archived', item.id, nextActive?.id ?? null);
      }
      onHistoryMutated?.();
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
  };

  const handleTidyOlder = async () => {
    if (olderToTidy.length === 0) return;
    setTidying(true);
    let archivedCount = 0;
    const archivedMap = new Map<string, { archivedAt: number | null; revision: number; updatedAt: number }>();
    try {
      for (const item of olderToTidy) {
        try {
          const res = await scenarioClient.updateRun({
            runId: item.id,
            expectedRevision: item.revision,
            requestId: makeScenarioRequestId('tidy'),
            changes: { archived: true },
          });
          archivedMap.set(item.id, {
            archivedAt: res.run.archivedAt ?? Date.now(),
            revision: res.run.revision,
            updatedAt: res.run.updatedAt,
          });
          archivedCount += 1;
        } catch {
          // Continue archiving remaining older drafts even if one changed concurrently.
        }
      }
      if (archivedMap.size > 0) {
        setRuns(prev =>
          prev.map(entry => {
            const patch = archivedMap.get(entry.id);
            return patch ? { ...entry, ...patch } : entry;
          }),
        );
        onHistoryMutated?.();
        toast.showToast(
          t('Archived {count} older draft(s)', { count: archivedCount }),
          'info',
          'feedback',
        );
      }
    } finally {
      setTidying(false);
    }
  };

  const coverSrc = scenarioCover(scenario.id);
  const totalSteps = scenario.steps.length;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="hf-overlay-backdrop om-scenario-backdrop" />
        <Dialog.Popup
          data-feedback-modal=""
          data-scenario-run-history={scenario.id}
          className="om-dialog om-scenario-history-dialog"
          onKeyDown={event => event.stopPropagation()}
        >
          <header className="om-scenario-history-dialog-header">
            <div className="om-scenario-history-dialog-title-group">
              {coverSrc && (
                <span className="om-scenario-header-cover" aria-hidden="true">
                  <img src={coverSrc} alt="" draggable={false} />
                </span>
              )}
              <div>
                <Dialog.Title className="om-subtitle">
                  {t('{workflow} · Run history', { workflow: t(scenario.title) })}
                </Dialog.Title>
                <p className="om-scenario-history-dialog-sub">
                  {t('Manage saved drafts for this workflow, restore archived runs, or archive older ones.')}
                </p>
              </div>
            </div>
            <div className="om-scenario-history-dialog-head-actions">
              <Button
                variant="primary"
                size="sm"
                type="button"
                icon={<RemixIcon name="add-line" size={14} />}
                onClick={() => {
                  onOpenChange(false);
                  void onNewRun();
                }}
              >
                {t('New draft')}
              </Button>
              <IconButton
                variant="ghost"
                size="sm"
                type="button"
                aria-label={t('Close')}
                icon={<RemixIcon name="close-line" size={18} />}
                onClick={() => onOpenChange(false)}
              />
            </div>
          </header>

          <div className="om-scenario-history-dialog-toolbar">
            <Tabs
              value={view}
              onValueChange={next => setView(next === 'archived' ? 'archived' : 'active')}
            >
              <TabsList aria-label={t('Run history filter')}>
                <Tab value="active">
                  <span>{t('Active')}</span>
                  <span className="om-scenario-tab-count">{activeRuns.length}</span>
                </Tab>
                <Tab value="archived">
                  <span>{t('Archived')}</span>
                  <span className="om-scenario-tab-count">{archivedRuns.length}</span>
                </Tab>
              </TabsList>
            </Tabs>

            <div className="om-scenario-history-dialog-search">
              <FieldInput
                density="compact"
                value={query}
                placeholder={t('Search drafts…')}
                aria-label={t('Search drafts…')}
                onChange={event => setQuery(event.target.value)}
              />
            </div>

            {view === 'active' && olderToTidy.length > 0 && (
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
          </div>

          <div className="om-scenario-history-dialog-list">
            {loading ? (
              <div className="om-scenario-runs-skeleton" role="status" aria-label={t('Loading recent drafts')}>
                <Skeleton className="om-scenario-run-skeleton-row" />
                <Skeleton className="om-scenario-run-skeleton-row" />
                <Skeleton className="om-scenario-run-skeleton-row" />
              </div>
            ) : error ? (
              <div className="om-scenario-runs-error" role="alert">
                <RemixIcon name="error-warning-line" size={18} />
                <span>{error}</span>
                <Button variant="secondary" size="sm" type="button" onClick={() => void loadRuns(0, false)}>
                  {t('Retry')}
                </Button>
              </div>
            ) : visibleRuns.length === 0 ? (
              <PanelEmptyState
                icon="history-line"
                message={view === 'archived' ? t('No archived drafts') : t('No saved drafts yet')}
                description={
                  view === 'archived'
                    ? t('Archived drafts for this workflow appear here so you can restore them anytime.')
                    : t('Start a new draft or edit your brief to save your first run.')
                }
              />
            ) : (
              <ul className="om-scenario-runs-list">
                {visibleRuns.map(item => {
                  const isCurrent = item.id === activeRunId;
                  const isBusy = busyId === item.id || tidying;
                  const isRenaming = renamingId === item.id;
                  return (
                    <li
                      key={item.id}
                      className="om-scenario-run-row"
                      data-history-run={item.id}
                      data-current={isCurrent ? 'true' : undefined}
                    >
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
                              onBlur={() => void commitRename(item)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  void commitRename(item);
                                } else if (event.key === 'Escape') {
                                  event.preventDefault();
                                  skipBlurRef.current = true;
                                  setRenamingId(null);
                                }
                              }}
                            />
                          ) : (
                            <strong className="om-scenario-run-row-title">{item.title}</strong>
                          )}
                          {isCurrent && (
                            <span className="om-scenario-run-current-badge">
                              {t('Current draft')}
                            </span>
                          )}
                          {item.pendingJobs > 0 && (
                            <span className="om-badge" data-active="true">
                              <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
                              {t('{count} running', { count: item.pendingJobs })}
                            </span>
                          )}
                        </div>
                        <div className="om-scenario-run-row-meta">
                          <span>{t('{done}/{total} steps done', { done: item.doneSteps, total: totalSteps })}</span>
                          <span>·</span>
                          <span>{t('{count} assets', { count: item.poolCount })}</span>
                          <span>·</span>
                          <span>
                            {formatDate(item.updatedAt, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>

                      <div className="om-scenario-run-row-actions">
                        {view === 'active' ? (
                          <>
                            {!isCurrent && (
                              <Button
                                variant="secondary"
                                size="sm"
                                type="button"
                                disabled={isBusy}
                                onClick={() => {
                                  onSelectRun(item.id);
                                  onOpenChange(false);
                                }}
                              >
                                {t('Resume')}
                              </Button>
                            )}
                            <IconButton
                              variant="ghost"
                              size="sm"
                              type="button"
                              disabled={isBusy}
                              aria-label={t('Rename draft')}
                              title={t('Rename draft')}
                              icon={<RemixIcon name="edit-line" size={15} />}
                              onClick={() => beginRename(item)}
                            />
                            <IconButton
                              variant="ghost"
                              size="sm"
                              type="button"
                              disabled={isBusy}
                              aria-label={t('Archive draft')}
                              title={t('Archive draft')}
                              icon={<RemixIcon name="delete-bin-line" size={15} />}
                              onClick={() => void handleSetArchived(item, true)}
                            />
                          </>
                        ) : (
                          <Button
                            variant="secondary"
                            size="sm"
                            type="button"
                            disabled={isBusy}
                            icon={<RemixIcon name="arrow-go-back-line" size={14} />}
                            onClick={() => void handleSetArchived(item, false)}
                          >
                            {t('Restore')}
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {nextOffset !== null && !loading && (
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
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
