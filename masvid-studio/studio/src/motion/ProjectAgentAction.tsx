import { Popover } from '@base-ui/react/popover';
import { useEffect, useRef, useState } from 'react';
import { projectAgentPrompt } from '../../../shared/project-agent-prompt';
import { useStudioShellContext } from '../contexts/StudioContext';
import { Button } from 'open-design-ui/button';
import { IconButton, Tooltip } from '../components/ui';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useToast } from '../hooks/useToast';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useIntegrationInfo } from './useIntegrationInfo';
import { useWorkspaceChrome } from './WorkspaceChromeContext';
import { SettingsError, SettingsLoading } from './settingsPrimitives';

export function ProjectAgentAction() {
  const { t } = useI18n();
  const { projectId } = useStudioShellContext();
  const { workspace, switchingDisabled, settingsOpen } = useWorkspaceChrome();
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const available = Boolean(projectId && workspace.status?.projectId === projectId && !switchingDisabled && !settingsOpen);
  useEffect(() => setOpen(false), [projectId, settingsOpen]);

  return <Popover.Root modal={false} open={open && available} onOpenChange={next => {
    if (next) setHasOpened(true);
    setOpen(next);
  }}>
    <Tooltip label={t('MCP')}>
      <Popover.Trigger render={<Button ref={trigger} className="motion-project-agent-trigger" disabled={!available}
        aria-label={t('MCP')}>
        {t('MCP')}
      </Button>} />
    </Tooltip>
    <Popover.Portal keepMounted>
      <Popover.Positioner side="bottom" align="end" sideOffset={8} collisionPadding={16} positionMethod="fixed" className="z-150">
        <Popover.Popup finalFocus={trigger} aria-describedby={undefined}
          className="hf-floating-motion flex w-[min(320px,calc(100vw-32px))] max-h-[var(--available-height)] flex-col overflow-y-auto rounded-xl border border-border bg-surface text-text-1 shadow-menu outline-none"
          onKeyDown={event => event.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <Popover.Title className="text-step-14 font-semibold text-text-1">{t('MCP')}</Popover.Title>
            <Popover.Close render={<IconButton aria-label={t('Close')} icon={<RemixIcon name="close-line" size={16} />} />} />
          </div>
          {hasOpened && available && <ProjectAgentContent key={projectId} projectId={projectId} onClose={() => setOpen(false)} onCopyFailure={() => setOpen(true)} />}
        </Popover.Popup>
      </Popover.Positioner>
    </Popover.Portal>
  </Popover.Root>;
}

function ProjectAgentContent({ projectId, onClose, onCopyFailure }: { projectId: string; onClose: () => void; onCopyFailure: () => void }) {
  const { t, locale } = useI18n();
  const { workspace, beforeViewChange, openConnections } = useWorkspaceChrome();
  const { info, failed, retry } = useIntegrationInfo();
  const toast = useToast();
  const [copying, setCopying] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const alive = useRef(true), busy = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const project = workspace.projects.find(item => item.id === projectId);
  const title = project?.title || workspace.status?.projectTitle || t('Untitled');

  async function copy() {
    if (!info || busy.current) return;
    busy.current = true; setCopying(true); setManualCopy('');
    try {
      await beforeViewChange();
      if (!alive.current) return;
      const prompt = projectAgentPrompt(info, { id: projectId, title }, locale);
      try {
        await navigator.clipboard.writeText(prompt);
        if (alive.current) toast.showToast(t('Instruction copied. Return to the conversation to continue.'), 'info', 'feedback');
      } catch {
        if (!alive.current) return;
        setManualCopy(prompt);
        onCopyFailure();
        toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
      }
    } catch {
      if (alive.current) toast.showToast(t('Could not save the project. Resolve pending edits and try again.'), 'error', 'feedback');
    } finally {
      busy.current = false;
      if (alive.current) setCopying(false);
    }
  }

  return <>
    <div className="flex min-w-0 flex-col gap-2 px-4 pt-1 pb-4">
      <div className="flex min-w-0 items-center gap-2 text-step-12">
        <span className="shrink-0 text-text-3">{t('Current project')}</span>
        <span className="min-w-0 truncate font-medium text-text-1" title={title}>{title}</span>
      </div>
      <div className="flex flex-col items-start gap-1">
        <p className="text-step-12 leading-relaxed text-text-2">{t('Copy the instruction to another conversation to continue editing this project.')}</p>
        <Button variant="ghost" size="sm" className="-ml-1 px-1 font-normal underline underline-offset-2" onClick={() => { onClose(); openConnections('project_agent'); }}>
          {t('Connection help')}<RemixIcon name="arrow-right-up-line" size={12} />
        </Button>
      </div>
      {failed ? <SettingsError retry={retry} /> : !info ? <SettingsLoading /> : null}
      {manualCopy && <textarea className="om-field min-h-32 w-full resize-y text-step-11" aria-label={t('Project instruction')}
        readOnly value={manualCopy} onFocus={event => event.currentTarget.select()} />}
    </div>
    <div className="motion-project-handoff-actions flex items-center gap-2 border-t border-border px-4 py-3">
      <Button variant="primary" size="sm" className="motion-project-handoff-button" disabled={!info} loading={copying} onClick={() => void copy()}>
        {t(copying ? 'Saving…' : 'Copy instruction')}
      </Button>
    </div>
    <StudioToastViewport {...toast} />
  </>;
}
