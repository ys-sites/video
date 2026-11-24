import { subtitleLanguages } from '../../../../shared/subtitle-languages';
import { useEffect, useRef, useState } from 'react';
import { defaultPlatformExportTarget, platformExportGoals, platformExportPrompt, platformExportTargets, platformExportCanvases, platformExportDurations, platformExportCaptions, platformExportSettings, type PlatformExportOptions, type PlatformExportGoal, type PlatformExportTarget } from '../../../../shared/platform-export';
import { useStudioShellContext } from '../../contexts/StudioContext';
import { useI18n } from '../../i18n/I18n';
import { useToast } from '../../hooks/useToast';
import { useWorkspaceChrome } from '../../motion/WorkspaceChromeContext';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { Skeleton } from '../ui/Skeleton';
import { StudioToastViewport } from '../StudioToastViewport';
import { Button } from 'open-design-ui/button';
import { Select } from '../ui/Select';
import { ChoiceTiles } from '../ui/ChoiceTiles';
import { PlatformIcon } from '../../../../packages/design-system/react/PlatformIcon';
import { RemixIcon } from '../../icons/RemixIcons';

/** A clipboard handoff only; editing and rendering stay with the public MCP operations. */
export function PlatformExportPanel({ onClose }: { onClose: () => void }) {
  const { projectId } = useStudioShellContext();
  return <PlatformExportContent key={projectId} projectId={projectId} onClose={onClose} />;
}

function PlatformExportContent({ projectId, onClose }: { projectId: string | null; onClose: () => void }) {
  const { t, locale } = useI18n(), toast = useToast();
  const { workspace, switchingDisabled, beforeViewChange, openConnections } = useWorkspaceChrome();
  const { renderQueue } = useStudioShellContext();
  const { info, failed, retry } = useIntegrationInfo();
  const [target, setTarget] = useState<PlatformExportTarget>(() => defaultPlatformExportTarget(locale));
  const [goal, setGoal] = useState<PlatformExportGoal>('adapt');
  const [notes, setNotes] = useState(''), [languages, setLanguages] = useState('');
  const [options, setOptions] = useState<PlatformExportOptions>({});
  const [copying, setCopying] = useState(false), [manualCopy, setManualCopy] = useState('');
  const alive = useRef(true), busy = useRef(false);
  const available = Boolean(projectId && workspace.status?.projectId === projectId && !switchingDisabled && !renderQueue.emptyComposition);
  const availableNow = useRef(available); availableNow.current = available;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => setManualCopy(''), [target, goal, notes, languages, locale, options]);
  const title = workspace.projects.find(item => item.id === projectId)?.title || workspace.status?.projectTitle || t('Untitled');
  const platform = platformExportTargets.find(item => item.id === target)!;
  const settings = platformExportSettings(target, options);
  const goalIcons = { shorten: 'scissors-cut-line', highlights: 'sparkling-line', adapt: 'layout-2-line' };
  const configure = <K extends keyof PlatformExportOptions>(key: K, value: PlatformExportOptions[K]) => setOptions(previous => ({ ...previous, [key]: value }));

  async function copy() {
    if (!info || !projectId || !availableNow.current || busy.current) return;
    busy.current = true; setCopying(true); setManualCopy('');
    try {
      await beforeViewChange();
      if (!alive.current || !availableNow.current) return;
      const prompt = platformExportPrompt({ target, goal, locale, notes, languages: settings.captions === 'none' ? '' : languages, options, context: { info, project: { id: projectId, title } } });
      try {
        await navigator.clipboard.writeText(prompt);
        if (alive.current) toast.showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback');
      } catch {
        if (!alive.current) return;
        setManualCopy(prompt);
        toast.showToast(t('Could not copy. Select and copy the text manually.'), 'error', 'feedback');
      }
    } catch {
      if (alive.current) toast.showToast(t('Could not save the project. Resolve pending edits and try again.'), 'error', 'feedback');
    } finally {
      busy.current = false;
      if (alive.current) setCopying(false);
    }
  }

  return <div className="flex min-h-0 flex-1 flex-col" data-testid="platform-export-panel">
    <div data-testid="platform-export-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
    <div className="flex flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2 text-step-11 text-text-3"><RemixIcon name="file-video-line" size={14} /><span className="shrink-0">{t('Current project')}</span><span className="truncate text-text-1" title={title}>{title}</span></div>
      <div className="flex flex-col gap-2"><span className="text-step-11 font-medium text-text-2">{t('Platform')}</span>
        <ChoiceTiles label={t('Platform')} value={target} disabled={copying} className="grid grid-cols-4 gap-1.5" options={platformExportTargets.map(item => ({ value: item.id, label: t(item.label), icon: <PlatformIcon platform={item.id} /> }))} onChange={setTarget} />
      </div>
      <div className="flex flex-col gap-1"><span className="text-step-11 font-medium text-text-2">{t('Goal')}</span>
        <Select label={t('Goal')} value={goal} disabled={copying} options={platformExportGoals.map(item => ({ value: item.id, label: t(item.label), icon: <RemixIcon name={goalIcons[item.id]} size={16} /> }))} onCommit={value => setGoal(value as PlatformExportGoal)} />
        <p className="text-step-11 leading-relaxed text-text-3">{t(platformExportGoals.find(item => item.id === goal)!.description)}</p>
      </div>
      <details><summary className="om-disclosure-summary">{t('Customize version')}<RemixIcon name="arrow-down-s-line" size={14} /></summary>
      <div className="flex flex-col gap-3 pt-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col gap-1"><span className="text-step-11 text-text-2">{t('Aspect ratio')}</span>
          <Select label={t('Aspect ratio')} value={options.canvas ?? 'platform'} disabled={copying} options={[
            { value: 'platform', label: t('Platform default') + ' · ' + platform.aspect },
            ...platformExportCanvases.map(item => ({ value: item.id, label: item.id + ' · ' + t(item.label) })),
          ]} onCommit={value => configure('canvas', value as PlatformExportOptions['canvas'])} />
        </div>
        <div className="flex min-w-0 flex-col gap-1"><span className="text-step-11 text-text-2">{t('Duration')}</span>
          <Select label={t('Duration')} value={goal === 'adapt' ? 'original' : settings.duration} disabled={copying || goal === 'adapt'} options={goal === 'adapt' ? [{ value: 'original', label: t('Original duration') }] : platformExportDurations.map(value => ({ value, label: t('{duration} seconds', { duration: value }) }))} onCommit={value => configure('duration', value as PlatformExportOptions['duration'])} />
        </div>
      </div>
      <div className={goal === 'highlights' ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-1'}>
        <div className="flex min-w-0 flex-col gap-1"><span className="text-step-11 text-text-2">{t('Captions')}</span>
          <Select label={t('Captions')} value={settings.captions} disabled={copying} options={platformExportCaptions.map(item => ({ value: item.id, label: t(item.label), icon: <RemixIcon name="closed-captioning-line" size={14} /> }))} onCommit={value => configure('captions', value as PlatformExportOptions['captions'])} />
        </div>
        {goal === 'highlights' && <div className="flex min-w-0 flex-col gap-1"><span className="text-step-11 text-text-2">{t('Clip count')}</span>
          <Select label={t('Clip count')} value={String(settings.clipCount)} disabled={copying} options={[1, 2, 3].map(count => ({ value: String(count), label: t('Up to {count}', { count }) }))} onCommit={value => configure('clipCount', Number(value) as 1 | 2 | 3)} />
        </div>}
      </div>
      {settings.captions !== 'none' && <div className="flex flex-col gap-1"><span className="text-step-11 text-text-2">{t('Subtitle language')}</span><Select label={t('Subtitle language')} value={languages} disabled={copying} options={[{ value: '', label: t('Source language') }, ...subtitleLanguages.map(language => ({ value: language.name, label: language.label }))]} onCommit={setLanguages} /></div>}
      <details><summary className="om-disclosure-summary">{t('Additional requirements (optional)')}<RemixIcon name="arrow-down-s-line" size={14} /></summary>
        <textarea className="om-field min-h-16 w-full resize-y text-step-12" aria-label={t('Additional requirements (optional)')} placeholder={t('e.g. Keep the opening hook and original narration')} rows={2} maxLength={2000} disabled={copying} value={notes} onChange={event => setNotes(event.target.value)} />
      </details>
      </div></details>
      <div className="om-handoff-summary" data-testid="platform-export-summary"><RemixIcon name="sparkling-line" size={20} /><div className="min-w-0">
        <p className="text-step-12 font-medium">{t('Editable copy + MP4')}</p>
        <p className="text-step-11 text-text-3">{settings.canvas.width} × {settings.canvas.height} · {goal === 'adapt' ? t('Original duration') : t('{duration} seconds', { duration: settings.duration })}{goal === 'highlights' ? ' · ' + t('Up to {count}', { count: settings.clipCount }) : ''}</p>
      </div></div>
      {!available && <p className="text-step-11 text-text-3">{t(renderQueue.emptyComposition ? 'Add content before preparing a platform export.' : 'Wait for this project to be ready.')}</p>}
      {manualCopy && <textarea className="om-field min-h-32 w-full resize-y text-step-11" aria-label={t('Platform export instruction')} readOnly rows={6} value={manualCopy} onFocus={event => event.currentTarget.select()} />}
    </div>
    </div>
    <div data-testid="platform-export-actions" className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-3">
      <div className="min-h-8">
        {failed ? <div role="alert" className="flex items-center justify-between gap-2 text-step-11 text-text-2"><span>{t('Could not load settings')}</span><Button size="sm" onClick={retry}>{t('Retry')}</Button></div>
          : !info ? <div role="status" aria-label={t('Loading settings…')}><Skeleton className="h-8 w-full" /></div>
            : <p className="text-step-11 leading-relaxed text-text-3">{t('Paste into your Agent to create and export this version.')}</p>}
      </div>
      <Button variant="primary" size="lg" loading={copying} disabled={!info || !available} icon={<RemixIcon name="file-copy-line" size={16} />} onClick={() => void copy()}>{t(copying ? 'Saving…' : 'Copy for Agent')}</Button>
      <Button variant="ghost" size="sm" className="self-center" onClick={() => { onClose(); openConnections('platform_export'); }}>{t('Connection help')}<RemixIcon name="arrow-right-up-line" size={12} /></Button>
    </div>
    <StudioToastViewport {...toast} />
  </div>;
}
