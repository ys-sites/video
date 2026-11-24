import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import {
  cleanLegacyScenarioTitle,
  type ScenarioDefinition,
  type ScenarioWorkspaceMode,
} from '../../../shared/scenarios';
import type { ScenarioRun, ScenarioRunSummary } from '../../../shared/scenario-runs';
import { FieldInput } from '../components/ui/FormField';
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

const QUICK_RUN_MENU_LIMIT = 5;

function cleanDraftTitle(title: string): string {
  return cleanLegacyScenarioTitle(title);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isDefaultGeneratedTitle(title: string, scenarioTitle: string): boolean {
  const cleaned = cleanDraftTitle(title);
  const pattern = new RegExp(
    `^${escapeRegExp(scenarioTitle)}(?:\\s*[·•-]\\s*\\d{4}-\\d{2}-\\d{2})?$`,
    'i',
  );
  return pattern.test(cleaned);
}

export type ScenarioHeaderProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  runs: ScenarioRunSummary[];
  hasMoreRuns?: boolean;
  runsLoading: boolean;
  onLoadRuns(): void;
  onSelectRun(runId: string): void;
  onOpenRunHistory?(): void;
  onNewRun(): void;
  onRenameRun(title: string): Promise<void>;
  onArchiveRun(): Promise<void>;
  onExplore(): void;
  onOpenHub(): void;
  breadcrumb?: ReactNode;
  mode: ScenarioWorkspaceMode;
  onModeChange(mode: ScenarioWorkspaceMode): void;
  poolOpen: boolean;
  poolCollapsed?: boolean;
  poolCount: number;
  onTogglePool(): void;
  onTogglePoolCollapsed?(): void;
  onCopyAgentHandoff(): void;
  onExportBundle(): void;
  exporting?: boolean;
  busy: ReadonlySet<string>;
};

export function ScenarioHeader({
  scenario,
  run,
  runs,
  hasMoreRuns = false,
  runsLoading,
  onLoadRuns,
  onSelectRun,
  onOpenRunHistory,
  onNewRun,
  onRenameRun,
  onArchiveRun,
  onExplore,
  onOpenHub,
  breadcrumb,
  mode,
  onModeChange,
  poolOpen,
  poolCollapsed = false,
  poolCount,
  onTogglePool,
  onTogglePoolCollapsed,
  onCopyAgentHandoff,
  onExportBundle,
  exporting = false,
  busy,
}: ScenarioHeaderProps) {
  const { t, formatDate } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const beginRename = () => {
    if (!run) return;
    skipBlurCommitRef.current = false;
    setDraftTitle(cleanDraftTitle(run.title));
    setRenaming(true);
  };

  const commitRename = async () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    const trimmed = draftTitle.trim();
    setRenaming(false);
    if (!run || !trimmed || trimmed === run.title) return;
    await onRenameRun(trimmed);
  };

  const cancelRename = () => {
    skipBlurCommitRef.current = true;
    setRenaming(false);
  };

  const runBusy = busy.has('create-new-run') || busy.has('rename-run') || busy.has('archive-run');

  const compactTriggerLabel = (() => {
    if (!run) return t('New draft');
    const cleaned = cleanDraftTitle(run.title);
    if (!cleaned || isDefaultGeneratedTitle(cleaned, scenario.title)) {
      const shortDate = formatDate(run.updatedAt, { month: 'short', day: 'numeric' });
      return shortDate ? `${t('Draft')} · ${shortDate}` : t('Draft');
    }
    return cleaned;
  })();

  // Keep the quick dropdown strictly capped to the 5 most recent runs for this sub-workflow,
  // ensuring the currently active draft stays visible if it's older than the top 5.
  const visibleQuickRuns = (() => {
    const top = runs.slice(0, QUICK_RUN_MENU_LIMIT);
    if (!run || top.some(item => item.id === run.id)) return top;
    const activeSummary = runs.find(item => item.id === run.id);
    if (!activeSummary) return top;
    return [activeSummary, ...top.slice(0, QUICK_RUN_MENU_LIMIT - 1)];
  })();
  const hiddenQuickCount = Math.max(0, runs.length - visibleQuickRuns.length);

  return (
    <header className="om-scenario-header">
      <div className="om-scenario-header-lead">
        <div className="om-scenario-header-back">
          {breadcrumb ?? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              aria-label={t('All workflows')}
              icon={<RemixIcon name="arrow-left-line" size={14} />}
              onClick={onOpenHub}
            >
              {t('All workflows')}
            </Button>
          )}
        </div>

        {mode === 'agent' && !breadcrumb && (
          <>
            <span className="om-scenario-header-divider" aria-hidden="true" />
            <div className="om-scenario-header-crumb" data-category={scenario.category}>
              <RemixIcon name={scenario.icon} size={15} />
              <h1 className="om-scenario-header-title">{t(scenario.title)}</h1>
            </div>
          </>
        )}

        <span className="om-scenario-header-divider" aria-hidden="true" />

        <div className="om-scenario-header-switcher">
          {renaming ? (
              <FieldInput
              ref={renameInputRef}
              density="compact"
              className="om-scenario-rename-input"
              aria-label={t('Rename')}
              value={draftTitle}
              maxLength={120}
              onChange={event => setDraftTitle(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void commitRename();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename();
                }
              }}
            />
          ) : (
            <Menu
              presentation="panel"
              className="om-scenario-run-menu"
              tooltip={t('Switch or manage drafts')}
              aria-label={t('Switch draft')}
              onOpenChange={open => {
                if (open) onLoadRuns();
              }}
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={runBusy}
                  className="om-scenario-run-button"
                  data-scenario-run-switcher=""
                  title={run ? cleanDraftTitle(run.title) : t('New draft')}
                >
                  <RemixIcon name="file-text-line" size={14} className="om-scenario-run-button-icon" />
                  <span className="om-scenario-run-button-label">
                    {compactTriggerLabel}
                  </span>
                  <RemixIcon name="arrow-down-s-line" size={14} className="om-scenario-run-button-chevron" />
                </Button>
              }
            >
              <MenuGroup>
                <MenuGroupLabel className="om-scenario-run-menu-heading">
                  <span>{t('Saved drafts')}</span>
                  {runs.length > 0 && (
                    <span className="om-scenario-run-menu-count">
                      {hasMoreRuns ? `${runs.length}+` : runs.length}
                    </span>
                  )}
                </MenuGroupLabel>
                {runsLoading ? (
                  <div className="om-scenario-run-menu-empty">{t('Loading…')}</div>
                ) : visibleQuickRuns.length === 0 ? (
                  <div className="om-scenario-run-menu-empty">{t('No saved drafts yet')}</div>
                ) : (
                  <div className="om-scenario-run-menu-list">
                    {visibleQuickRuns.map(item => {
                      const isCurrent = item.id === run?.id;
                      const displayTitle = cleanDraftTitle(item.title);
                      return (
                        <MenuItem
                          key={item.id}
                          className="om-scenario-run-item"
                          data-current={isCurrent ? 'true' : undefined}
                          aria-current={isCurrent ? 'true' : undefined}
                          title={displayTitle}
                          icon={
                            isCurrent ? (
                              <RemixIcon name="check-line" size={14} />
                            ) : (
                              <RemixIcon name="file-text-line" size={14} />
                            )
                          }
                          shortcut={formatDate(item.updatedAt, { month: 'short', day: 'numeric' })}
                          onClick={() => onSelectRun(item.id)}
                        >
                          <span className="om-scenario-run-item-row">
                            <span className="om-scenario-run-item-title">{displayTitle}</span>
                            {isCurrent && (
                              <span className="om-scenario-run-current-badge">
                                {t('Current draft')}
                              </span>
                            )}
                          </span>
                        </MenuItem>
                      );
                    })}
                    {(hiddenQuickCount > 0 || hasMoreRuns) && onOpenRunHistory && (
                      <MenuItem
                        className="om-scenario-run-more-item"
                        icon={<RemixIcon name="history-line" size={14} />}
                        onClick={onOpenRunHistory}
                      >
                        {hiddenQuickCount > 0
                          ? t('View all run history (+{count})', { count: hiddenQuickCount })
                          : t('View all run history')}
                      </MenuItem>
                    )}
                  </div>
                )}
              </MenuGroup>
              <MenuSeparator />
              <MenuGroup>
                <MenuGroupLabel className="om-scenario-run-menu-heading">
                  {t('Draft actions')}
                </MenuGroupLabel>
                <MenuItem
                  icon={<RemixIcon name="add-line" size={14} />}
                  onClick={onNewRun}
                >
                  {t('New draft')}
                </MenuItem>
                {onOpenRunHistory && (
                  <MenuItem
                    icon={<RemixIcon name="history-line" size={14} />}
                    onClick={onOpenRunHistory}
                  >
                    {t('Manage run history')}
                  </MenuItem>
                )}
                <MenuItem
                  icon={<RemixIcon name="edit-line" size={14} />}
                  disabled={!run}
                  onClick={beginRename}
                >
                  {t('Rename draft')}
                </MenuItem>
                <MenuItem
                  icon={<RemixIcon name="delete-bin-line" size={14} />}
                  tone="danger"
                  disabled={!run}
                  onClick={() => void onArchiveRun()}
                >
                  {t('Archive draft')}
                </MenuItem>
              </MenuGroup>
            </Menu>
          )}

          {onOpenRunHistory && !renaming && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              disabled={runBusy}
              className="om-scenario-history-button"
              data-scenario-history-trigger=""
              icon={<RemixIcon name="history-line" size={14} />}
              title={t('Open draft history')}
              onClick={onOpenRunHistory}
            >
              <span>{t('History')}</span>
              {runs.length > 0 && (
                <span className="om-scenario-history-count">
                  {hasMoreRuns ? `${runs.length}+` : runs.length}
                </span>
              )}
            </Button>
          )}
        </div>
      </div>

      <div className="om-scenario-header-actions">
        <div className="om-scenario-mode-switch" role="group" aria-label={t('Workflow mode')}>
          <Button
            variant={mode === 'manual' ? 'primary' : 'ghost'}
            size="sm"
            type="button"
            icon={<RemixIcon name="route-line" size={14} />}
            aria-pressed={mode === 'manual'}
            data-scenario-mode-tab="manual"
            onClick={() => onModeChange('manual')}
          >
            {t('Step by step')}
          </Button>
          <Button
            variant={mode === 'agent' ? 'primary' : 'ghost'}
            size="sm"
            type="button"
            icon={<RemixIcon name="robot-line" size={14} />}
            aria-pressed={mode === 'agent'}
            data-scenario-mode-tab="agent"
            onClick={() => onModeChange('agent')}
          >
            {t('Agent mode')}
          </Button>
        </div>

        {mode !== 'agent' && (
          <IconButton
            variant="secondary"
            size="sm"
            type="button"
            className="om-scenario-pool-toggle"
            aria-label={t('Assets ({count})', { count: poolCount })}
            aria-expanded={poolOpen}
            aria-controls="om-scenario-pool"
            onClick={onTogglePool}
            icon={<RemixIcon name="side-bar-line" size={16} />}
          />
        )}

        {mode !== 'agent' && onTogglePoolCollapsed && (
          <Button
            variant={poolCollapsed ? 'secondary' : 'ghost'}
            size="sm"
            type="button"
            className="om-scenario-pool-desktop-toggle"
            icon={<RemixIcon name={poolCollapsed ? 'side-bar-line' : 'side-bar-fill'} size={15} />}
            aria-expanded={!poolCollapsed}
            aria-controls="om-scenario-pool"
            aria-label={
              poolCollapsed
                ? t('Show assets ({count})', { count: poolCount })
                : t('Hide assets')
            }
            title={
              poolCollapsed
                ? t('Show assets ({count})', { count: poolCount })
                : t('Hide assets')
            }
            onClick={onTogglePoolCollapsed}
          >
            {poolCollapsed
              ? t('Assets ({count})', { count: poolCount })
              : t('Assets')}
          </Button>
        )}

        {mode !== 'agent' && (
          <Button
            variant="secondary"
            size="sm"
            type="button"
            className="om-scenario-desktop-action"
            icon={<RemixIcon name="plug-line" size={15} />}
            title={t('Copy MCP prompt')}
            onClick={onCopyAgentHandoff}
          >
            MCP
          </Button>
        )}

        <Button
          variant="secondary"
          size="sm"
          type="button"
          className="om-scenario-export-cta"
          loading={exporting}
          icon={<RemixIcon name="download-2-line" size={15} />}
          onClick={onExportBundle}
        >
          {t('Export all')}
        </Button>

        <div className="om-scenario-narrow-overflow">
          <Menu
            align="end"
            aria-label={t('Workflow actions')}
            trigger={
              <IconButton
                variant="secondary"
                size="sm"
                type="button"
                aria-label={t('More workflow actions')}
                icon={<RemixIcon name="more-2-line" size={16} />}
              />
            }
          >
            <MenuItem
              icon={<RemixIcon name="plug-line" size={14} />}
              onClick={onCopyAgentHandoff}
            >
              MCP
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="download-2-line" size={14} />}
              onClick={onExportBundle}
            >
              {t('Export all')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<RemixIcon name="add-line" size={14} />}
              onClick={onNewRun}
            >
              {t('New draft')}
            </MenuItem>
            {onOpenRunHistory && (
              <MenuItem
                icon={<RemixIcon name="history-line" size={14} />}
                onClick={onOpenRunHistory}
              >
                {t('Manage run history')}
              </MenuItem>
            )}
            <MenuItem
              icon={<RemixIcon name="edit-line" size={14} />}
              disabled={!run}
              onClick={beginRename}
            >
              {t('Rename')}
            </MenuItem>
            <MenuItem
              icon={<RemixIcon name="delete-bin-line" size={14} />}
              tone="danger"
              disabled={!run}
              onClick={() => void onArchiveRun()}
            >
              {t('Archive')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<RemixIcon name="apps-2-line" size={14} />}
              onClick={onOpenHub}
            >
              {t('All workflows')}
            </MenuItem>
          </Menu>
        </div>
      </div>
    </header>
  );
}
