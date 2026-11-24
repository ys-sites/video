import { WorkspaceBack } from './WorkspaceBack';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { CategoryStrip } from './CategoryStrip';
import { SkillSubmissionLink } from './SkillSubmissionLink';
import type { TechniqueStudio } from '../../../shared/studio-catalog';
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { studioSkillDefaults, localizedSkillPrompt, skillShotPrompt, aspectRatios, durations, motionSkills, skillCategories, skillShortcut, type MotionSkill, type SkillCategory, type SkillParameters } from './skillCatalog';
import type { AssetDraft } from './AssetComposer';
import { mediaEditorDestination, studioIconTone, studioComingSoon, type StudioDestination } from './creativeStudios';
import { useOptionalWorkspaceChrome } from './WorkspaceChromeContext';
import { StudioTemplateShelf } from './StudioTemplateShelf';
import { SkillMedia } from './SkillMedia';
import { ComingSoonGuide } from './ComingSoonGuide';
import { GitHubMark } from '../../../packages/design-system/react/GitHubMark';
import { MotionIcon } from './icons';
import { motionApi } from './useWorkspace';
import { setupGuideUrl, type IntegrationInfo } from '../../../shared/integration';
import { AssetPicker } from './AssetBrowser';
import { Popover } from '../components/ui/Popover';
import { Tooltip } from '../components/ui/Tooltip';
import { Collapsible } from '@base-ui/react/collapsible';
import * as tracking from './pageTracking';
import { useSkillLayoutMotion } from './useSkillLayoutMotion';
import './skills.css';

export { skillSubmissionUrl } from './SkillSubmissionLink';

/** Cards lead with the task, like the template library; the upstream project name stays verbatim as the source. */
const displayNameOf = (t: (text: string) => string) => (skill: MotionSkill) => t(skill.title);

/** Compare repository identity, ignoring file paths, query strings and anchors. */
function githubRepositoryOf(source?: string): string | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    if (!['http:', 'https:'].includes(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname)) return null;
    const [owner, repository] = url.pathname.split('/').filter(Boolean);
    return owner && repository ? `${owner}/${repository.replace(/\.git$/i, '')}`.toLowerCase() : null;
  } catch { return null; }
}

/** Open-source motion techniques the user can hand to an Agent through OpenMotion MCP. */
export function SkillsPage({ skillId, onSkillChange, routeCategory, onCategoryChange, studio, onExplore, onClose, onCreate, briefs, previewsEnabled = true, hasProject = false, detailOnly = false }: { routeCategory?: SkillCategory | null; onCategoryChange?: (value: SkillCategory | null) => void; detailOnly?: boolean; studio?: TechniqueStudio; previewsEnabled?: boolean; briefs?: Map<string, SkillParameters>; onCreate?: (destination: StudioDestination, draft?: AssetDraft) => void; onExplore?: () => void; onClose?: () => void; skillId: string | null; onSkillChange: (id: string | null) => void; hasProject?: boolean }) {
  const { t, locale } = useI18n(), toast = useToast(), displayName = displayNameOf(t);
  const chrome = useOptionalWorkspaceChrome();
  const comingSoon = studioComingSoon(studio);
  const [query, setQuery] = useState(''), [localCategory, setLocalCategory] = useState<SkillCategory | null>(null);
  const category = routeCategory === undefined ? localCategory : routeCategory;
  const setCategory = routeCategory !== undefined && onCategoryChange ? onCategoryChange : setLocalCategory;
  const [picking, setPicking] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [instantDetail, setInstantDetail] = useState(false);
  const main = useRef<HTMLDivElement>(null);
  const captureLayout = useSkillLayoutMotion(main, instantDetail);
  const detailClose = useRef<HTMLButtonElement>(null);
  const studioDefaults = useMemo<SkillParameters>(() => studioSkillDefaults(studio?.id), [studio]);
  const [parameters, setParameters] = useState<SkillParameters>(studioDefaults), [manualCopy, setManualCopy] = useState<{ text: string; surface: 'instruction' | 'command' } | null>(null);
  // Same install guide as template instructions; the repository guide is the fallback until the service answers.
  const [installUrl, setInstallUrl] = useState(() => setupGuideUrl(null));
  useEffect(() => {
    let cancelled = false;
    motionApi<IntegrationInfo>('/integration').then(info => { if (!cancelled) setInstallUrl(setupGuideUrl(info)); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const instruction = useRef<HTMLPreElement>(null), command = useRef<HTMLPreElement>(null), search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (detailOnly) return;
    const focus = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search.current?.focus(); } };
    window.addEventListener('keydown', focus); return () => window.removeEventListener('keydown', focus);
  }, [detailOnly]);
  // Select the failed text in its own visible surface so one ⌘C copies the requested content.
  useEffect(() => {
    if (!manualCopy || (manualCopy.surface === 'command' && !commandOpen)) return;
    const element = manualCopy.surface === 'command' ? command.current : instruction.current;
    if (element?.isConnected) { element.focus(); window.getSelection()?.selectAllChildren(element); }
  }, [manualCopy, commandOpen]);
  const catalog = useMemo(() => studio ? studio.techniques.flatMap(id => motionSkills.filter(skill => skill.id === id)) : motionSkills, [studio]);
  const selected = catalog.find(skill => skill.id === skillId) ?? null;
  const sourceRepository = githubRepositoryOf(selected?.repository);
  const sharedCoverRepository = sourceRepository !== null && sourceRepository === githubRepositoryOf(selected?.cover?.source);
  const matching = (group: SkillCategory | null, text: string) => {
    const needle = text.trim().toLocaleLowerCase();
    return catalog.filter(skill => (!group || skill.category === group)
      && (!needle || [skill.name, skill.title, displayName(skill), t(skill.useWhen), skill.tagline, t(skill.tagline), t(skill.output), skill.repository ?? 'OpenMotion'].some(value => value.toLocaleLowerCase().includes(needle))));
  };
  const visible = useMemo(() => matching(category, query), [query, category, t, catalog]);
  const featured = studio ? catalog[0] : undefined;
  const featureInHero = featured?.cover?.poster && !query.trim();
  const cards = featureInHero ? visible.filter(skill => skill.id !== featured.id) : visible;
  const recording = parameters.reference && parameters.reference.modality !== 'image';
  const canCreateShot = Boolean(studio && !comingSoon && onCreate && !recording);
  const startShot = () => {
    if (!studio || comingSoon || !selected || !onCreate) return;
    const reference = parameters.reference;
    if (reference && reference.modality !== 'image') return;
    const destination = mediaEditorDestination(reference ? 'image-to-video' : 'text-to-video');
    onCreate(destination, { modality: 'video', prompt: skillShotPrompt(selected, parameters, t), shotPreferences: { aspect: parameters.aspect, duration: parameters.duration },
      references: reference ? [{ reference: { assetId: reference.assetId, versionId: reference.versionId }, name: reference.label }] : [] });
  };
  const updateBrief = (next: SkillParameters) => {
    if (studio && selected) briefs?.set(selected.id, next);
    setParameters(next);
  };
  // One page view per visit; one detail view per opened Skill; one search result per settled query (500 ms after typing stops).
  useEffect(() => { if (!detailOnly) tracking.reportSkillsPageView(hasProject); }, []);
  const detailView = useRef<string | undefined>(undefined), searchId = useRef<string | undefined>(undefined);
  useEffect(() => {
    detailView.current = selected ? tracking.newTrackingId() : undefined;
    if (selected && detailView.current) tracking.reportSkillDetailShown(selected, detailView.current);
  }, [selected?.id]);
  useEffect(() => { if (detailOnly && selected) detailClose.current?.focus({ preventScroll: true }); }, [detailOnly, selected]);
  // Any change to the query, category or interface language (which changes what matches) ends the previous search; a card opened before the new one settles carries no search id.
  const resultCount = visible.length;
  useEffect(() => {
    searchId.current = undefined;
    if (!query.trim()) return;
    const timer = setTimeout(() => { searchId.current = tracking.newTrackingId(); tracking.reportSkillSearch(searchId.current, query, resultCount, category); }, 500);
    return () => clearTimeout(timer);
  }, [query, category, locale]);
  const pickCategory = (value: SkillCategory | null) => {
    setCategory(value);
    tracking.reportSkillCategory(value, matching(value, query).length);
  };
  // The instruction follows the interface language, including the example brief and borrowed technique.
  const prompt = selected ? localizedSkillPrompt(selected, parameters, locale, installUrl, t) : '';
  const shortcut = selected ? skillShortcut({ ...selected, title: displayName(selected), example: t(selected.example) }, parameters, locale, installUrl) : '';
  const latest = useRef({ instruction: prompt, command: shortcut }); latest.current = { instruction: prompt, command: shortcut };
  const open = (skill: MotionSkill, position: number) => { if (!selected) captureLayout(); tracking.reportSkillCardOpened(skill, position, searchId.current); onSkillChange(skill.id); };
  // A failed copy keeps its exact text for manual copying only until the brief changes; then show the live text again.
  useEffect(() => { setManualCopy(null); }, [prompt, shortcut]);
  // The brief belongs to one skill; any route change (card, history, link) starts a fresh brief.
  useEffect(() => { setPicking(false); setParameters((skillId && briefs?.get(skillId)) || studioDefaults); setManualCopy(null); setCommandOpen(false); }, [skillId, studioDefaults, briefs]);
  async function copy(surface: 'instruction' | 'command' = 'instruction') {
    if (!selected) return;
    const text = surface === 'command' ? shortcut : prompt, attempt = tracking.newTrackingId(), brief = parameters, view = detailView.current;
    if (surface === 'command') tracking.reportSkillCommandCopyClicked(selected, view, attempt);
    else tracking.reportSkillDetailClick(selected, 'copy_instruction', view, attempt);
    try {
      await navigator.clipboard.writeText(text); setManualCopy(null); toast.showToast(t('Copied. Paste into your Agent.'), 'info');
      tracking.reportSkillCopyResult(selected, surface, 'clipboard_written', attempt, brief, view);
    }
    catch {
      // A late failure for a brief that has since changed must not restore stale text.
      if (latest.current[surface] !== text) return;
      tracking.reportSkillCopyResult(selected, surface, 'manual_fallback_shown', attempt, brief, view);
      setManualCopy({ text, surface }); toast.showToast(t(surface === 'command' ? 'Copy failed. Select and copy the command below.' : 'Copy failed. Select and copy the instruction below.'), 'error', 'feedback');
    }
  }
  const closeDetail = () => {
    if (!selected) return;
    captureLayout();
    tracking.reportSkillDetailClick(selected, 'close_detail', detailView.current);
    onSkillChange(null);
  };
  return <Collapsible.Root open={Boolean(selected)} className={detailOnly ? 'om-collection-skill' : 'om-gallery-surface om-skills-page om-skills-library'} data-detail={Boolean(selected)}
    onPointerDownCapture={() => setInstantDetail(false)} onKeyDownCapture={() => setInstantDetail(true)}
    onKeyDown={detailOnly ? event => {
      if (event.key !== 'Escape' || event.defaultPrevented || commandOpen) return;
      event.preventDefault();
      closeDetail();
    } : undefined}>
    <StudioToastViewport {...toast} />
    {!detailOnly && <div ref={main} className="om-skills-main">
      {studio && onExplore && <WorkspaceBack fallback={onExplore} />}
      <main className="om-gallery-results">
        {studio ? <section className="om-specialty-intro" data-coming-soon={comingSoon || undefined}>
          <div><h1 className="om-title"><span className="om-studio-heading-icon" data-tone={studioIconTone(studio)}><RemixIcon name={studio.icon} size={24} /></span>{t(studio.title)}</h1><p className="om-muted">{t(studio.briefHint)}</p>
            {comingSoon ? <ComingSoonGuide compact /> : onCreate && <div className="om-specialty-actions">
              <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => onCreate(mediaEditorDestination(studio.scenes[0]))}><RemixIcon name="add-line" size={16} />{t(studio.createLabel)}</Button>
              {studio.id === 'marketing' && <Button variant="ghost" className="om-button h-auto" onClick={() => onCreate(mediaEditorDestination('text-to-video'))}>{t('Create an ad clip')}</Button>}
            </div>}
          </div>{featured?.cover?.poster && <Button variant="plain" className="om-specialty-feature" onClick={() => open(featured, 1)}>
            <img src={featured.cover.poster} alt="" /><span className="om-button om-media-caption">{t(featured.title)}<RemixIcon name="arrow-right-line" size={16} /></span>
          </Button>}
        </section> : <section className="om-gallery-intro om-gallery-page-intro om-skills-intro">
          <h1>{t('Teach your Agent new moves.')}</h1>
          <div className="om-skills-heading-actions">
            <SkillSubmissionLink />
            {onClose && <Tooltip label={t('Close')}>
              <IconButton type="button" variant="ghost" className="om-button om-icon-button" onClick={onClose} aria-label={t('Close')} icon={<MotionIcon name="close" size={16} />} />
            </Tooltip>}
          </div>
          <p>{t('Pick a skill, fill in the brief and copy the instruction. Your Agent builds an editable project in OpenMotion.')}</p>
        </section>}
        <div className="om-gallery-sticky-header">
          <div className="om-gallery-toolbar om-skills-toolbar">
            {!studio && <CategoryStrip label="Skill category" selection={category} neutral>
              <Button variant="plain" aria-pressed={!category} onClick={() => pickCategory(null)}>{t('All')}</Button>
              {skillCategories.map(value => <Button variant="plain" key={value} aria-pressed={category === value} onClick={() => pickCategory(value)}>{t(value)}</Button>)}
            </CategoryStrip>}
            <label className="om-field om-search-field"><MotionIcon name="search" size={18} /><input ref={search} type="search" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('Search skills...')} aria-label={t('Search skills')} /><kbd aria-hidden="true">⌘ K</kbd></label>
          </div>
        </div>
        {studio && chrome && !query.trim() && <StudioTemplateShelf key={studio.id + locale} studio={studio.id} root={main} active={previewsEnabled && !selected} />}
        {studio && <header className="om-studio-skills-heading"><h2 className="om-title om-studio-techniques-title">{t(studio.id === '3d' ? '3D Creative Skills' : 'Creative Skills')}</h2>{comingSoon && <p className="om-muted">{t('While the Studio is coming soon, choose a Skill below and copy its brief to your Agent to start creating.')}</p>}</header>}
        <div className="om-gallery-masonry om-skills-grid">
          {cards.map((skill, index) => <SkillCard key={skill.id} skill={skill} name={displayName(skill)} useWhen={t(skill.useWhen)} selected={skill.id === skillId} onSelect={() => open(skill, index + (featureInHero ? 2 : 1))} />)}
        </div>
        {!visible.length && <div className="om-empty"><MotionIcon name="search" size={28} /><p>{t('No matching skills.')}</p><Button variant="ghost" className="om-button h-auto" onClick={() => { setQuery(''); setCategory(null); tracking.reportSkillFiltersCleared(); }}>{t('Clear filters')}</Button></div>}
      </main>
    </div>}
    <Collapsible.Panel render={<aside />} className="om-skill-detail om-surface-divider om-detail-reveal" data-instant={instantDetail}
      inert={!selected} aria-hidden={!selected || undefined} aria-label={selected ? displayName(selected) : undefined}>
      <RetainedDetailContent>{selected ? <>
      <header className="om-skill-detail-header"><h2 className="om-subtitle">{displayName(selected)}</h2><IconButton variant="ghost" ref={detailClose} className="motion-icon-button" aria-label={t('Close skill')} onClick={closeDetail} icon={<RemixIcon name="close-line" size={18} />} /></header>
      <SkillMedia key={selected.id} skill={selected} large />
      <section className="om-skill-form" aria-label={t('Brief')}>
        <label><span className="om-subtitle">{t('Your brief')}</span><span className="om-field"><textarea rows={4} maxLength={500} value={parameters.subject} placeholder={t(selected.example)} onChange={event => updateBrief({ ...parameters, subject: event.target.value })} /></span></label>
        {studio && <fieldset><legend className="om-subtitle">{t('Reference asset')}</legend><div className="om-specialty-actions">
          <Button variant="ghost" className="om-button h-auto" onClick={() => setPicking(true)}><RemixIcon name="folder-open-line" size={15} />{parameters.reference?.label ?? t('Choose an asset')}</Button>
          {parameters.reference && <IconButton variant="plain" className="om-nav-item" aria-label={t('Remove reference: {name}', { name: parameters.reference.label })} onClick={() => updateBrief({ ...parameters, reference: undefined })} icon={<RemixIcon name="close-line" size={15} />} />}
        </div></fieldset>}
        <fieldset><legend className="om-subtitle">{t('Duration')}</legend><div className="om-segmented">{durations.map(value => <Button variant="plain" key={value} className="om-nav-item" aria-pressed={parameters.duration === value} onClick={() => updateBrief({ ...parameters, duration: value })}>{t('{count}s', { count: value })}</Button>)}</div></fieldset>
        <fieldset><legend className="om-subtitle">{t('Aspect ratio')}</legend><div className="om-segmented">{aspectRatios.map(value => <Button variant="plain" key={value} className="om-nav-item" aria-pressed={parameters.aspect === value} onClick={() => updateBrief({ ...parameters, aspect: value })}>{value}</Button>)}</div></fieldset>
        <label><span className="om-subtitle">{t('Style (optional)')}</span><span className="om-field"><input maxLength={200} value={parameters.style} placeholder={t('e.g. dark background, neon green accents')} onChange={event => updateBrief({ ...parameters, style: event.target.value })} /></span></label>
      </section>
      <section className="om-skill-prompt" aria-label={t('Agent instruction')}>
        <span className="om-subtitle">{t('Agent instruction')}</span>
        <pre ref={instruction} data-manual={manualCopy?.surface === 'instruction'} tabIndex={0}>{manualCopy?.surface === 'instruction' ? manualCopy.text : prompt}</pre>
      </section>
      <div className="om-skill-provenance">
      {selected.repository ? <a className="om-skill-source" href={selected.repository} target="_blank" rel="noopener noreferrer" onClick={() => tracking.reportSkillDetailClick(selected, 'view_source', detailView.current)}><GitHubMark width={14} height={14} /><span>{selected.repository.replace(/^https?:\/\/github\.com\//, '')}</span><span className="om-skill-license">{selected.license === 'See repository' ? t('See repository') : selected.license}</span><MotionIcon name="arrow-up-right" size={14} /></a>
        : <p className="om-skill-source"><RemixIcon name="flashlight-line" size={16} /><span>{t('OpenMotion skill')}</span></p>}
      {selected.cover?.source && !sharedCoverRepository && <p className="om-skill-credit"><span>{t('Cover source')}</span>{/^https?:\/\//.test(selected.cover.source)
        ? <a href={selected.cover.source} target="_blank" rel="noopener noreferrer">{selected.cover.source.replace(/^https?:\/\//, '')}</a>
        : selected.cover.source}</p>}
      </div>
      <footer className="om-skill-footer">
        {studio && !comingSoon && onCreate && (recording
          ? <p className="om-muted">{t('Use the Agent brief to work with this recording. Clip generation accepts a still image as its first frame.')}</p>
          : <Button variant="ghost" className="om-button h-auto" data-primary onClick={startShot}><RemixIcon name="film-line" size={16} />{t('Create a shot from this brief')}</Button>)}
        <div className="om-skill-actions">
          <Button variant="ghost" className="om-button h-auto" data-primary={!canCreateShot || undefined} onClick={() => void copy()}><RemixIcon name="file-copy-line" size={16} />{t('Copy for Agent')}</Button>
          <Popover open={commandOpen} onOpenChange={open => { setCommandOpen(open); setManualCopy(null); if (open) tracking.reportSkillDetailClick(selected, 'open_command', detailView.current); }} side="top" align="end" aria-label={t('Use in another AI Agent')} className="om-skill-shortcut"
            trigger={<Button variant="ghost" className="om-button h-auto"><RemixIcon name="plug-line" size={16} />{t('Connect Agent')}</Button>}>
            <strong>{t('Use in another AI Agent')}</strong>
            <p className="om-muted">{t('Copy this command into a chat with Codex, Claude or another AI Agent to run this skill.')}</p>
            <pre ref={command} data-manual={manualCopy?.surface === 'command'} tabIndex={0}>{manualCopy?.surface === 'command' ? manualCopy.text : shortcut}</pre>
            <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => void copy('command')}><RemixIcon name="file-copy-line" size={16} />{t('Copy command')}</Button>
          </Popover>
        </div>
      </footer>
      </> : null}</RetainedDetailContent>
    </Collapsible.Panel>
    {studio && selected && picking && <AssetPicker onClose={() => setPicking(false)} onPick={(reference, asset) => {
      const number = asset.versions.findIndex(version => version.id === reference.versionId) + 1;
      updateBrief({ ...parameters, reference: { ...reference, modality: asset.modality, label: `${asset.name} · V${number}` } });
      setPicking(false);
    }} />}
  </Collapsible.Root>;
}

/** Keep the last rendered brief intact until the panel's exit transition unmounts it. */
function RetainedDetailContent({ children }: { children: ReactElement | null }) {
  const [content, setContent] = useState(children);
  if (children && children !== content) setContent(children);
  return children ?? content;
}

function SkillCard({ skill, name, useWhen, selected, onSelect }: { skill: MotionSkill; name: string; useWhen: string; selected: boolean; onSelect: () => void }) {
  const [hovered, setHovered] = useState(false), [visible, setVisible] = useState(false);
  const card = useRef<HTMLButtonElement>(null);
  // Autoplay while at least half the card is on screen (paused off screen, so only the visible few load).
  // Reduced-motion users keep hover-to-play.
  useEffect(() => {
    const element = card.current;
    if (!element || typeof IntersectionObserver === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.5 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const active = hovered || visible;
  const setActive = setHovered;
  return <Button variant="plain" ref={card} type="button" className="om-card om-skill-gallery-card" data-interactive data-skill-id={skill.id} data-selected={selected}
    onClick={onSelect} aria-pressed={selected} aria-labelledby={`skill-title-${skill.id}`} aria-describedby={`skill-purpose-${skill.id}`}
    onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)} onFocus={() => setActive(true)} onBlur={() => setActive(false)}>
    <span className="om-gallery-cover om-skill-card-demo">
      <SkillMedia skill={skill} playing={active} />
    </span>
    <span className="om-skill-card-meta">
      <span className="om-skill-card-heading"><strong id={`skill-title-${skill.id}`}>{name}</strong></span>
      <span className="om-skill-card-purpose" id={`skill-purpose-${skill.id}`} title={useWhen}>{useWhen}</span>
    </span>
  </Button>;
}
