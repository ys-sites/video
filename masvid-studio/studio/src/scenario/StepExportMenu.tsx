import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import type { ScenarioDefinition, ScenarioStepDefinition } from '../../../shared/scenarios';
import type { ScenarioRun, ScenarioStepState } from '../../../shared/scenario-runs';
import { Menu, MenuItem, MenuSeparator } from '../components/ui/Menu';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

export type StepExportMenuProps = {
  scenario: ScenarioDefinition;
  step: ScenarioStepDefinition;
  state: ScenarioStepState;
  run: ScenarioRun | null;
  extraItems?: ReactNode;
  onExportStepPackage: () => Promise<void>;
  onCopyPrompt: () => Promise<void>;
  onCopyStepAgentHandoff: () => Promise<void>;
  busy?: boolean;
};

export function resolveStepPrompt(state: ScenarioStepState): string {
  const active = state.activeIterationId
    ? state.iterations.find(item => item.id === state.activeIterationId)
    : state.iterations.at(-1);
  if (active?.prompt && active.prompt.trim()) return active.prompt.trim();
  const draftPrompt = state.draft?.prompt;
  if (typeof draftPrompt === 'string' && draftPrompt.trim()) return draftPrompt.trim();
  return '';
}

function hasRenderableNode(node: ReactNode): boolean {
  return Children.toArray(node).some(child => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) {
      return hasRenderableNode(child.props.children);
    }
    return child !== null && child !== undefined && typeof child !== 'boolean';
  });
}

export function StepExportMenu({
  step,
  state,
  run,
  extraItems,
  onExportStepPackage,
  onCopyPrompt,
  onCopyStepAgentHandoff,
  busy = false,
}: StepExportMenuProps) {
  const { t } = useI18n();
  const hasPrompt = resolveStepPrompt(state).length > 0;
  const hasExtras = hasRenderableNode(extraItems);

  return (
    <Menu
      align="end"
      aria-label={t('Export {step}', { step: t(step.title) })}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          type="button"
          loading={busy}
          data-step-export-menu={step.id}
          icon={<RemixIcon name="download-2-line" size={14} />}
        >
          <span>{t('Export step')}</span>
          <RemixIcon name="arrow-down-s-line" size={14} />
        </Button>
      }
    >
      <MenuItem
        icon={<RemixIcon name="download-2-line" size={14} />}
        disabled={!run || busy}
        onClick={() => void onExportStepPackage()}
      >
        {t('Download step (.zip)')}
      </MenuItem>

      {hasExtras && (
        <>
          <MenuSeparator />
          {extraItems}
        </>
      )}

      <MenuSeparator />
      <MenuItem
        icon={<RemixIcon name="file-copy-line" size={14} />}
        disabled={!hasPrompt}
        onClick={() => void onCopyPrompt()}
      >
        {t('Copy prompt')}
      </MenuItem>
      <MenuItem
        icon={<RemixIcon name="plug-line" size={14} />}
        onClick={() => void onCopyStepAgentHandoff()}
      >
        MCP
      </MenuItem>
    </Menu>
  );
}
