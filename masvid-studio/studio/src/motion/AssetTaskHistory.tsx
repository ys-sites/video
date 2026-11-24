import { Button } from "open-design-ui/button";
import { Tooltip } from "../components/ui/Tooltip";
import { useState, type ReactElement, type ComponentProps } from 'react';
import { Popover } from '../components/ui/Popover';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { creationKinds } from './AssetCreationVisuals';
import { isActiveAssetTask, taskStateIcon, taskStateLabel, type AssetTask, type AssetTaskMode } from './assetTasks';

/** The same persistent task entry lives in the gallery and single-asset workspace. */
export function AssetTaskMenu({ disabled, ...history }: Omit<ComponentProps<typeof AssetTaskHistory>, 'trigger'> & { disabled?: boolean }) {
  const { t } = useI18n();
  const active = history.tasks.filter(isActiveAssetTask).length;
  const waiting = history.tasks.filter(task => task.state === 'waiting').length;
  const state = history.error ? 'failed' : waiting ? 'waiting' : active ? 'running' : 'idle';
  const spinning = state === 'running' || history.loading && !history.tasks.length;
  const count = history.error ? t('Task status unavailable') : waiting ? t('{count} awaiting approval', { count: waiting })
    : active ? t('{count} in progress', { count: active }) : history.tasks.length || undefined;
  return <AssetTaskHistory {...history} trigger={<Button variant="plain" className="om-button om-task-history-trigger" data-state={state} disabled={disabled} aria-label={t('View tasks')}>
    <RemixIcon name={spinning ? 'loader-4-line' : state === 'waiting' ? 'shield-check-line' : 'history-line'} size={16} className={spinning ? 'animate-spin motion-reduce:animate-none' : undefined} />
    <span>{t('Tasks')}</span>{count !== undefined && <span className="om-badge om-task-count" role="status">{count}</span>}<RemixIcon name="arrow-down-s-line" size={14} />
  </Button>} />;
}

export function AssetTaskHistory({ tasks, selectedKey, loading, error, onRetry, onSelect, trigger, tooltip }: {
  tasks: AssetTask[]; selectedKey?: string; loading: boolean; error?: string; onRetry: () => void;
  onSelect: (task: AssetTask) => void; trigger: ReactElement; tooltip?: string;
}) {
  const { t, formatDate } = useI18n();
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [filter, setFilter] = useState<AssetTaskMode | 'all'>('all');
  const visible = tasks.filter(task => (filter === 'all' || task.mode === filter) && `${task.title} ${task.detail}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Popover tooltip={tooltip} modal={false} open={open} onOpenChange={setOpen} align="end" aria-label={t('Task history')} className="om-task-history om-selection-panel" trigger={trigger}>
    <div className="om-task-history-heading"><span className="om-creation-icon" data-tone="agent"><RemixIcon name="history-line" size={16} /></span><strong>{t('Task history')}</strong><span className="om-badge">{tasks.length}</span></div>
    <label className="om-field"><RemixIcon name="search-line" size={15} /><input aria-label={t('Search tasks')} placeholder={t('Search tasks')} value={query} onChange={event => setQuery(event.target.value)} /></label>
    {/* Temporarily hide the Agent filter; All tasks still preserves access to existing conversations. */}
    <div className="om-task-filters" role="group" aria-label={t('Task type')}>{(['all', 'direct'] as const).map(value => <Button variant="plain" className="om-nav-item" key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>{value !== 'all' && <RemixIcon name={value === 'direct' ? 'sparkling-line' : 'chat-1-line'} size={14} />}{t(value === 'all' ? 'All tasks' : value === 'direct' ? 'Generate' : 'Agent')}</Button>)}</div>
    {error && <div className="om-task-history-notice" role="status"><p>{t('Could not load task history')}</p><Button variant="plain" className="om-nav-item" onClick={onRetry}><RemixIcon name="refresh-line" size={14} />{t('Retry')}</Button></div>}
    <div className="om-task-history-list" aria-label={t('Tasks')} aria-busy={loading}>
      {!visible.length && <p className="om-muted om-task-history-empty">{t(loading ? 'Loading tasks…' : query || filter !== 'all' ? 'No matching tasks' : 'Your creative tasks will appear here.')}</p>}
      {visible.map(task => <Button variant="plain" className="om-nav-item om-task-item" key={task.key} data-state={task.state} aria-current={task.key === selectedKey ? 'true' : undefined} onClick={() => { setOpen(false); onSelect(task); }}>
        <span className="om-creation-icon" data-tone={task.tone}><RemixIcon name={task.mode === 'agent' ? 'chat-1-line' : creationKinds.find(kind => kind.id === task.tone)!.icon} size={17} /></span>
        <span className="om-task-item-copy"><Tooltip label={task.title} wrap><strong>{task.title}</strong></Tooltip><span><span className="om-task-state"><RemixIcon name={taskStateIcon(task)} size={12} className={task.state === 'running' || task.state === 'queued' ? 'animate-spin motion-reduce:animate-none' : undefined} />{t(taskStateLabel(task))}</span><span className="om-task-item-detail">{task.mode === 'agent' ? t(task.detail) : task.detail}</span></span></span>
        <span className="om-task-item-end"><time dateTime={new Date(task.updatedAt).toISOString()}>{formatDate(task.updatedAt, { month: 'short', day: 'numeric' })}</time>{task.key === selectedKey ? <RemixIcon name="check-line" size={14} /> : <RemixIcon name="arrow-right-up-line" size={13} />}</span>
      </Button>)}
    </div>
    <div className="om-task-history-footer"><RemixIcon name="stack-line" size={13} /><span>{t('Model generation tasks, together.')}</span></div>
  </Popover>;
}
