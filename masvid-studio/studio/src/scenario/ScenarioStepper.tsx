import { Fragment, useEffect, useRef } from 'react';
import type { ScenarioDefinition } from '../../../shared/scenarios';
import type { ScenarioRun, ScenarioStepState } from '../../../shared/scenario-runs';
import { Tab, Tabs, TabsList } from '../components/ui/Tabs';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { HorizontalRail } from '../motion/HorizontalRail';
import { countStepPendingJobs } from './useScenarioRun';

export type ScenarioStepperProps = {
  scenario: ScenarioDefinition;
  run: ScenarioRun | null;
  activeStepId: string;
  onSelectStep(stepId: string): void;
};

function statusGlyph(status: ScenarioStepState['status']): { icon: string; label: string } | null {
  if (status === 'in-progress') {
    return { icon: 'checkbox-blank-circle-fill', label: 'In progress' };
  }
  if (status === 'skipped') {
    return { icon: 'subtract-line', label: 'Skipped' };
  }
  return null;
}

export function ScenarioStepper({
  scenario,
  run,
  activeStepId,
  onSelectStep,
}: ScenarioStepperProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const activeTab = containerRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${activeStepId}"]`,
    );
    if (activeTab && typeof activeTab.scrollIntoView === 'function') {
      activeTab.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    }
  }, [activeStepId]);

  const activeIndex = Math.max(0, scenario.steps.findIndex(step => step.id === activeStepId));
  const activeStep = scenario.steps[activeIndex] ?? scenario.steps[0];
  const completedCount = scenario.steps.reduce((acc, step) => {
    const st = run?.steps[step.id]?.status;
    return acc + (st === 'done' || st === 'skipped' ? 1 : 0);
  }, 0);
  const totalSteps = Math.max(1, scenario.steps.length);
  const progressPct = Math.min(
    100,
    Math.round((Math.max(completedCount, activeIndex + 1) / totalSteps) * 100),
  );

  return (
    <nav className="om-scenario-stepper" aria-label={t('Workflow steps')} ref={containerRef}>
      <HorizontalRail
        label="Workflow steps"
        className="om-scenario-stepper-rail"
        viewportClassName="om-scenario-stepper-viewport"
        selection={activeStepId}
      >
        <Tabs
          value={activeStepId}
          onValueChange={next => {
            if (typeof next === 'string' && next !== activeStepId) {
              onSelectStep(next);
            }
          }}
        >
          <TabsList aria-label={t('Workflow steps')} className="om-scenario-stepper-list">
            {scenario.steps.map((step, index) => {
              const stepState = run?.steps[step.id];
              const status: ScenarioStepState['status'] =
                stepState?.status ?? (step.type === 'brief' ? 'in-progress' : 'todo');
              const pending = countStepPendingJobs(stepState);
              const glyph = statusGlyph(status);

              return (
                <Fragment key={step.id}>
                  <Tab
                    value={step.id}
                    className="om-scenario-step-tab"
                    data-step-type={step.type}
                    data-step-status={status}
                  >
                    <span className="om-scenario-step-index" aria-hidden="true">
                      {status === 'done' ? <RemixIcon name="check-line" size={11} /> : index + 1}
                    </span>
                    <span className="om-scenario-step-tab-icon" aria-hidden="true">
                      <RemixIcon name={step.icon} size={14} />
                    </span>
                    <span className="om-scenario-step-tab-title">{t(step.title)}</span>
                    {glyph && (
                      <span
                        className="om-scenario-step-status-glyph"
                        data-status={status}
                        title={t(glyph.label)}
                        aria-label={t(glyph.label)}
                      >
                        <RemixIcon name={glyph.icon} size={status === 'in-progress' ? 9 : 14} />
                      </span>
                    )}
                    {pending > 0 && (
                      <span
                        className="om-scenario-step-pending-badge"
                        aria-label={t('{count} jobs running', { count: pending })}
                      >
                        <RemixIcon name="loader-4-line" size={12} className="om-scenario-spin" />
                        <span>{pending}</span>
                      </span>
                    )}
                  </Tab>
                  {index < scenario.steps.length - 1 && (
                    <span className="om-scenario-step-connector" aria-hidden="true">
                      <RemixIcon name="arrow-right-s-line" size={14} />
                    </span>
                  )}
                </Fragment>
              );
            })}
          </TabsList>
        </Tabs>
      </HorizontalRail>
      <div className="om-scenario-stepper-progress" aria-hidden="true">
        <div
          className="om-scenario-stepper-progress-fill"
          data-step-type={activeStep?.type}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </nav>
  );
}
