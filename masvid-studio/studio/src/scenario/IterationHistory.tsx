import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import type { ScenarioBriefField, ScenarioStepDefinition } from '../../../shared/scenarios';
import type { ScenarioStepState, StepIteration } from '../../../shared/scenario-runs';
import { FieldInput } from '../components/ui/FormField';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { BriefVersionComparison } from './BriefVersionComparison';
import { briefSnapshot } from './briefVersion';

export type IterationHistoryProps = {
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  renderOutput(iteration: StepIteration): ReactNode;
  onPromote(iterationId: string): Promise<void>;
  onUseSettings(iteration: StepIteration): Promise<void>;
  onSaveNote(iterationId: string, note: string): Promise<void>;
  onRetry(iteration: StepIteration): Promise<void>;
  onCancel(iterationId: string): Promise<void>;
  busy?: ReadonlySet<string>;
  embedded?: boolean;
  briefFields?: readonly ScenarioBriefField[];
};

const SOURCE_LABELS: Record<StepIteration['source'], string> = {
  generated: 'Generated',
  local: 'Local',
  agent: 'From Agent',
  manual: 'Manual',
  upload: 'Upload',
  workspace: 'Workspace',
};

export function IterationHistory({
  step,
  state,
  renderOutput,
  onPromote,
  onUseSettings,
  onSaveNote,
  onRetry,
  onCancel,
  busy,
  embedded = false,
  briefFields,
}: IterationHistoryProps) {
  const { t, formatDate } = useI18n();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  const comparisonRef = useRef<HTMLDivElement>(null);
  const historyHeaderRef = useRef<HTMLElement>(null);
  const wasComparingBrief = useRef(false);

  const ordered = useMemo(
    () => [...state.iterations].sort((a, b) => b.number - a.number),
    [state.iterations],
  );

  const expanded = embedded ? true : (manualExpanded ?? ordered.length >= 2);

  const compareIterations = useMemo(() => {
    const byId = new Map(state.iterations.map(it => [it.id, it]));
    return compareIds
      .map(id => byId.get(id))
      .filter((item): item is StepIteration => Boolean(item));
  }, [compareIds, state.iterations]);

  const [older, newer] = [...compareIterations].sort((a, b) => a.number - b.number);
  const before = briefSnapshot(older);
  const after = briefSnapshot(newer);
  const briefDiff = briefFields && before && after ? { fields: briefFields, before, after } : null;
  const comparingBrief = expanded && Boolean(briefDiff);

  useEffect(() => {
    if (comparingBrief) comparisonRef.current?.focus();
    else if (wasComparingBrief.current) historyHeaderRef.current?.focus();
    wasComparingBrief.current = comparingBrief;
  }, [comparingBrief]);

  const toggleCompare = (iterationId: string) => {
    setCompareIds(prev => {
      if (prev.includes(iterationId)) {
        return prev.filter(id => id !== iterationId);
      }
      if (prev.length >= 2) {
        return [prev[1], iterationId];
      }
      return [...prev, iterationId];
    });
  };

  const startEditNote = (iteration: StepIteration) => {
    setEditingNoteId(iteration.id);
    setNoteDraft(iteration.note ?? '');
  };

  const commitNote = async (iterationId: string) => {
    await onSaveNote(iterationId, noteDraft.trim());
    setEditingNoteId(null);
  };

  if (ordered.length === 0) {
    return null;
  }

  return (
    <section
      className="om-scenario-history"
      data-embedded={embedded ? 'true' : undefined}
      aria-label={t('Version history')}
    >
      <header className="om-scenario-history-header" ref={historyHeaderRef} tabIndex={-1}>
        {embedded ? (
          <div className="om-scenario-history-heading">
            <RemixIcon name="history-line" size={14} />
            <span className="om-scenario-history-title">{t('Version history')}</span>
            <span className="om-badge">{ordered.length}</span>
          </div>
        ) : (
          <Button
            variant="plain"
            type="button"
            className="om-scenario-history-toggle"
            aria-expanded={expanded}
            onClick={() => setManualExpanded(!expanded)}
          >
            <RemixIcon name={expanded ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={15} />
            <RemixIcon name="history-line" size={14} />
            <span className="om-scenario-history-title">{t('Version history')}</span>
            <span className="om-badge">{ordered.length}</span>
          </Button>
        )}
        {expanded && compareIds.length > 0 && !comparingBrief && (
          <div className="om-scenario-history-compare-status">
            <span className="om-muted">
              {compareIds.length === 1
                ? t('Select one more version to compare')
                : t('Comparing 2 versions')}
            </span>
            <Button variant="ghost" size="sm" type="button" onClick={() => setCompareIds([])}>
              {t('Clear compare')}
            </Button>
          </div>
        )}
      </header>

      {expanded && compareIterations.length === 2 && (
        <div
          className="om-scenario-compare-panel"
          role="region"
          aria-label={t('Compare versions')}
          tabIndex={briefDiff ? -1 : undefined}
          ref={comparisonRef}
        >
          <div className="om-scenario-compare-header">
            <strong>
              {t('Compare v{left} and v{right}', {
                left: (briefDiff ? older : compareIterations[0]).number,
                right: (briefDiff ? newer : compareIterations[1]).number,
              })}
            </strong>
            <Button variant="ghost" size="sm" type="button" onClick={() => setCompareIds([])}>
              {t('Close compare')}
            </Button>
          </div>
          {briefDiff ? <BriefVersionComparison {...briefDiff} /> : (
            <div className="om-scenario-compare-grid">
              {compareIterations.map(iteration => {
                const isActive = state.activeIterationId === iteration.id;
                const jobState = iteration.job?.state;
                const unavailable = jobState === 'failed' || jobState === 'cancelled';
                return (
                  <div key={iteration.id} className="om-scenario-compare-col">
                    <div className="om-scenario-compare-col-head">
                      <div className="om-scenario-iter-badges">
                        <strong>{t('Version {number}', { number: iteration.number })}</strong>
                        <span className="om-badge">{t(SOURCE_LABELS[iteration.source])}</span>
                        {isActive && (
                          <span className="om-badge" data-active="true">
                            {t('Current')}
                          </span>
                        )}
                      </div>
                      {!isActive && (!iteration.job || iteration.job.state === 'completed') && (
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          onClick={() => void onPromote(iteration.id)}
                        >
                          {t('Make active')}
                        </Button>
                      )}
                    </div>
                    <div className="om-scenario-compare-output">
                      {unavailable
                        ? t(jobState === 'failed' ? 'Generation failed' : 'Generation cancelled')
                        : renderOutput(iteration)}
                    </div>
                    {iteration.prompt && (
                      <p className="om-scenario-compare-prompt">{iteration.prompt}</p>
                    )}
                    {iteration.note && (
                      <p className="om-scenario-iter-note">{iteration.note}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {expanded && !comparingBrief && (
        <div className="om-scenario-history-strip">
        {ordered.map(iteration => {
          const isActive = state.activeIterationId === iteration.id;
          const isComparing = compareIds.includes(iteration.id);
          const job = iteration.job;
          const isRunning = job?.state === 'queued' || job?.state === 'running';
          const isFailed = job?.state === 'failed';
          const isCancelled = job?.state === 'cancelled';
          const canPromote = !isActive && (!job || job.state === 'completed');
          const hasSettings = Boolean(iteration.prompt || (iteration.settings && Object.keys(iteration.settings).length > 0));
          const isBusy =
            busy?.has(`promote:${step.id}:${iteration.id}`) ||
            busy?.has(`cancel:${step.id}:${iteration.id}`) ||
            busy?.has(`note:${step.id}:${iteration.id}`);

          return (
            <article
              key={iteration.id}
              className="om-scenario-iter-card"
              data-iteration-id={iteration.id}
              data-active={isActive || undefined}
              data-comparing={isComparing || undefined}
            >
              <header className="om-scenario-iter-head">
                <div className="om-scenario-iter-badges">
                  <strong className="om-scenario-iter-version">{t('Version {number}', { number: iteration.number })}</strong>
                  <span className="om-badge">{t(SOURCE_LABELS[iteration.source])}</span>
                  {isActive && (
                    <span className="om-badge" data-active="true">
                      {t('Current')}
                    </span>
                  )}
                </div>
                <time className="om-scenario-iter-time">
                  {formatDate(iteration.createdAt, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </header>

              <div className="om-scenario-iter-body">
                {isRunning ? (
                  <div className="om-scenario-iter-job" role="status">
                    <Skeleton className="om-scenario-iter-skeleton" />
                    <div className="om-scenario-iter-job-row">
                      <span className="om-scenario-iter-job-status">
                        <RemixIcon name="loader-4-line" size={14} className="om-scenario-spin" />
                        <span>
                          {job.state === 'queued' ? t('Queued…') : t('Generating…')}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        disabled={isBusy}
                        onClick={() => void onCancel(iteration.id)}
                      >
                        {t('Cancel')}
                      </Button>
                    </div>
                  </div>
                ) : isFailed ? (
                  <div className="om-scenario-iter-error" role="alert">
                    <RemixIcon name="error-warning-line" size={16} />
                    <p>{t('Generation failed')}</p>
                    {job.error && (
                      <details>
                        <summary>{t('Error details')}</summary>
                        <p>{job.error}</p>
                      </details>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      icon={<RemixIcon name="refresh-line" size={14} />}
                      onClick={() => void onRetry(iteration)}
                    >
                      {t('Retry')}
                    </Button>
                  </div>
                ) : isCancelled ? (
                  <div className="om-scenario-iter-cancelled">
                    <span className="om-muted">{t('Generation cancelled')}</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      icon={<RemixIcon name="refresh-line" size={14} />}
                      onClick={() => void onRetry(iteration)}
                    >
                      {t('Run again')}
                    </Button>
                  </div>
                ) : (
                  <div className="om-scenario-iter-output">{renderOutput(iteration)}</div>
                )}

                {editingNoteId === iteration.id ? (
                  <div className="om-scenario-iter-note-editor">
                    <FieldInput
                      density="compact"
                      aria-label={t('Version note')}
                      placeholder={t('Add a note about this version…')}
                      value={noteDraft}
                      maxLength={2000}
                      onChange={event => setNoteDraft(event.target.value)}
                      onKeyDown={event => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void commitNote(iteration.id);
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setEditingNoteId(null);
                        }
                      }}
                    />
                    <div className="om-scenario-iter-note-actions">
                      <Button
                        variant="primary"
                        size="sm"
                        type="button"
                        onClick={() => void commitNote(iteration.id)}
                      >
                        {t('Save')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => setEditingNoteId(null)}
                      >
                        {t('Cancel')}
                      </Button>
                    </div>
                  </div>
                ) : iteration.note ? (
                  <p className="om-scenario-iter-note">{iteration.note}</p>
                ) : null}
              </div>

              <footer className="om-scenario-iter-actions">
                {canPromote && (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={isBusy}
                    onClick={() => void onPromote(iteration.id)}
                  >
                    {t('Make active')}
                  </Button>
                )}
                {ordered.length >= 2 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-pressed={isComparing}
                    onClick={() => toggleCompare(iteration.id)}
                  >
                    {t(isComparing ? 'Comparing' : 'Compare')}
                  </Button>
                )}
                {hasSettings && (
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onClick={() => void onUseSettings(iteration)}
                  >
                    {t('Use settings')}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => startEditNote(iteration)}
                >
                  {t(iteration.note ? 'Edit note' : 'Add note')}
                </Button>
              </footer>
            </article>
          );
        })}
        </div>
      )}
    </section>
  );
}
