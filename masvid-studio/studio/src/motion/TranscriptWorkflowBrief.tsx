import { subtitleLanguages } from '../../../shared/subtitle-languages';
import { useEffect, useRef, useState } from 'react';
import type { TranscriptDocument } from '../../../shared/transcript';
import { transcriptWorkflowPrompt } from '../../../shared/transcript-workflow';
import { defaultPlatformExportTarget, platformExportTargets, type PlatformExportTarget } from '../../../shared/platform-export';
import { useI18n } from '../i18n/I18n';
import { useStudioShellContext } from '../contexts/StudioContext';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../icons/RemixIcons';
import { useIntegrationInfo } from './useIntegrationInfo';
import { SettingsError, SettingsLoading } from './settingsPrimitives';



export function TranscriptWorkflowBrief({ projectId, sourcePaths, transcript }: { projectId: string; sourcePaths: string[]; transcript: TranscriptDocument | null }) {
  const { t, locale } = useI18n(), shell = useStudioShellContext();
  const { info, failed, retry } = useIntegrationInfo();
  const [platforms, setPlatforms] = useState<PlatformExportTarget[]>(() => [defaultPlatformExportTarget(locale)]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [links, setLinks] = useState(''), [otherPlatforms, setOtherPlatforms] = useState(''), [otherLanguages, setOtherLanguages] = useState(''), [notes, setNotes] = useState('');
  const [goal, setGoal] = useState<'highlights' | 'adapt'>('highlights'), [busy, setBusy] = useState(false), [manual, setManual] = useState('');
  const [more, setMore] = useState(false);
  const alive = useRef(true), lock = useRef(false);
  const sourceIdentity = JSON.stringify(sourcePaths);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => setManual(''), [links, platforms, languages, otherPlatforms, otherLanguages, notes, goal, transcript, sourceIdentity, projectId]);
  const sourceLanguage = languages.length === 0 && !otherLanguages.trim();
  const selectedPlatforms = platformExportTargets.filter(target => platforms.includes(target.id));
  const targets = [...selectedPlatforms.map(target => `${target.label} (${target.aspect}, ${target.width}×${target.height})`), otherPlatforms.trim()].filter(Boolean).join(', ');
  const requestedLanguages = [...subtitleLanguages.filter(language => languages.includes(language.id)).map(language => language.name), otherLanguages.trim()].filter(Boolean).join(', ');
  const platformSummary = [...selectedPlatforms.map(target => t(target.label)), otherPlatforms.trim()].filter(Boolean).join(' · ');
  const languageSummary = sourceLanguage ? t('Source language') : [...subtitleLanguages.filter(language => languages.includes(language.id)).map(language => language.label), otherLanguages.trim()].filter(Boolean).join(' · ');
  const field = (label: string, value: string, change: (v: string) => void, multiline = false) => <label className="flex flex-col gap-1.5 text-step-11 text-text-3">{t(label)}{multiline
    ? <textarea className="om-field w-full resize-y text-step-12" aria-label={t(label)} disabled={busy} value={value} rows={2} maxLength={3000} onChange={event => change(event.target.value)} />
    : <input className="om-field w-full text-step-12" aria-label={t(label)} disabled={busy} value={value} maxLength={500} onChange={event => change(event.target.value)} />}</label>;
  function togglePlatform(id: PlatformExportTarget) {
    setPlatforms(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
  }
  async function copy() {
    if (!info || lock.current || !targets) return; lock.current = true; setBusy(true);
    try {
      await shell.waitForPendingDomEditSaves(); if (!alive.current) return;
      const prompt = transcriptWorkflowPrompt({ projectId, sourcePaths, sourceLinks: links, targets, languages: requestedLanguages, goal, notes, transcript }, info, locale);
      try { await navigator.clipboard.writeText(prompt); if (alive.current) shell.showToast(t('Copied. Paste into your Agent.'), 'info'); }
      catch { if (alive.current) { setManual(prompt); shell.showToast(t('Could not copy. Select and copy the text manually.'), 'error'); } }
    } catch (error) { if (alive.current) shell.showToast(error instanceof Error ? error.message : t('Could not save the project'), 'error'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="flex min-h-0 flex-1 flex-col" data-testid="transcript-workflow">
    <header className="flex shrink-0 items-start gap-3 border-b border-border p-4">
      <span className="om-creation-icon" data-tone="agent"><RemixIcon name="global-line" size={16} /></span>
      <div className="min-w-0 space-y-1">
        <h2 className="text-step-13 font-semibold">{t('Create another version')}</h2>
        <p className="text-step-11 leading-relaxed text-text-3">{t('Choose your options, then copy the brief to your Agent.')}</p>
        <span className="inline-flex items-center gap-1 text-step-11 text-text-3"><RemixIcon name="checkbox-circle-line" size={12} />{t('Current project included')}</span>
      </div>
    </header>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 flex items-center gap-1.5 text-step-12 font-medium"><RemixIcon name="scissors-cut-line" size={14} />{t('Version goal')}</legend>
        <div className="grid grid-cols-2 gap-2">
          {([{ value: 'highlights', icon: 'scissors-cut-line', label: 'Extract highlights', detail: 'Up to 3 clips · 30–60s' }, { value: 'adapt', icon: 'film-line', label: 'Adapt the full video', detail: 'Keep the complete story' }] as const).map(option => <Button variant="plain" key={option.value} type="button" className="om-preset-choice" data-layout="card" aria-label={t(option.label)} aria-pressed={goal === option.value} disabled={busy} onClick={() => setGoal(option.value)}>
            <span className="flex w-full items-center justify-between gap-2"><span className="om-creation-icon" data-tone="video"><RemixIcon name={option.icon} size={16} /></span>{goal === option.value && <RemixIcon name="check-line" size={14} />}</span>
            <span className="text-step-12 font-medium">{t(option.label)}</span><span className="text-step-11 text-text-3">{t(option.detail)}</span>
          </Button>)}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 flex w-full items-center gap-1.5 text-step-12 font-medium"><RemixIcon name="slideshow-line" size={14} />{t('Target platforms')}<span className="ml-auto text-step-11 font-normal text-text-3">{t('Choose multiple')}</span></legend>
        <div className="grid grid-cols-2 gap-1.5">
          {platformExportTargets.map(target => <Button variant="plain" key={target.id} type="button" className="om-preset-choice" aria-label={t(target.label)} aria-pressed={platforms.includes(target.id)} disabled={busy} onClick={() => togglePlatform(target.id)}>
            <RemixIcon name={platforms.includes(target.id) ? 'check-line' : 'file-video-line'} size={14} /><span className="min-w-0 flex-1 text-left">{t(target.label)}</span><span className="text-step-10 text-text-3">{target.aspect}</span>
          </Button>)}
        </div>
      </fieldset>
      <fieldset className="min-w-0">
        <legend className="mb-2 flex w-full items-center gap-1.5 text-step-12 font-medium"><RemixIcon name="closed-captioning-line" size={14} />{t('Subtitle language')}<span className="ml-auto text-step-11 font-normal text-text-3">{t('Choose multiple')}</span></legend>
        <div className="flex flex-wrap gap-1.5">
          <Button variant="plain" type="button" className="om-preset-choice" aria-pressed={sourceLanguage} disabled={busy} onClick={() => { setLanguages([]); setOtherLanguages(''); }}><RemixIcon name={sourceLanguage ? 'check-line' : 'voiceprint-line'} size={14} />{t('Source language')}</Button>
          {subtitleLanguages.map(language => <Button variant="plain" key={language.id} type="button" className="om-preset-choice" lang={language.id} aria-pressed={languages.includes(language.id)} disabled={busy} onClick={() => setLanguages(current => current.includes(language.id) ? current.filter(value => value !== language.id) : [...current, language.id])}><RemixIcon name="check-line" size={14} className={languages.includes(language.id) ? undefined : 'invisible'} />{language.label}</Button>)}
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-step-11 text-text-3"><RemixIcon name="volume-up-line" size={12} />{t('Original voice retained')}</p>
      </fieldset>
      <div className="border-t border-border pt-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" aria-expanded={more} onClick={() => setMore(!more)}><RemixIcon name="settings-3-line" size={14} />{t('More options')}<RemixIcon name={more ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} className="ml-auto" /></Button>
        {more && <div className="mt-3 space-y-3">
          {field('Other platforms', otherPlatforms, setOtherPlatforms)}
          {field('Other subtitle languages', otherLanguages, setOtherLanguages)}
          {field('Source links or search brief', links, setLinks, true)}
          {field('Editorial requirements', notes, setNotes, true)}
        </div>}
      </div>
      {failed ? <SettingsError retry={retry} /> : !info ? <SettingsLoading /> : null}
      {manual && <textarea className="om-field w-full resize-y text-step-11" aria-label={t('Complete workflow instruction')} readOnly rows={6} value={manual} onFocus={event => event.currentTarget.select()} />}
    </div>
    <footer className="flex shrink-0 flex-col gap-2 border-t border-border p-4">
      <p className="line-clamp-2 text-step-11 text-text-3" role="status" title={`${platformSummary} / ${languageSummary}`}>{targets ? `${platformSummary} / ${languageSummary}` : t('Choose at least one platform')}</p>
      <Button variant="primary" loading={busy} icon={<RemixIcon name="file-copy-line" size={14} />} disabled={!info || !targets || Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering} onClick={() => void copy()}>{t('Copy production brief')}</Button>
    </footer>
  </div>;
}
