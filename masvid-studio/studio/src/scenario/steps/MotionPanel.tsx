import { Button } from 'open-design-ui/button';
import { useEffect, useMemo, useState } from 'react';
import { blackFridaySkillIds, blackFridayTemplates } from '../../../../shared/black-friday-collection';
import { isEditableTemplate, type GalleryTemplate } from '../../../../shared/catalog';
import { assetMediaUrl } from '../../../../shared/asset-library';
import type { PoolItem, ScenarioRun } from '../../../../shared/scenario-runs';
import { Select } from '../../components/ui';
import { Checkbox } from '../../components/ui/Checkbox';
import { FieldInput, FieldTextarea } from '../../components/ui/FormField';
import { Skeleton } from '../../components/ui/Skeleton';
import { useI18n } from '../../i18n/I18n';
import { RemixIcon } from '../../icons/RemixIcons';
import { BlackFridaySkillCarousel } from '../../motion/BlackFridaySkillCarousel';
import { useExploreTemplates } from '../../motion/ExploreTemplates';
import { motionSkills } from '../../motion/skillCatalog';
import { TemplateGalleryCard } from '../../motion/TemplateGalleryCard';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { useOptionalWorkspaceChrome } from '../../motion/WorkspaceChromeContext';
import type { StepProps } from '../stepContract';
import {
  buildStepAgentPrompt,
  copyText,
  extractErrorMessage,
  isScenarioConflictError,
  poolKindIcon,
  poolKindLabel,
} from './stepUtils';

function PoolAssetThumb({ item }: { item: PoolItem }) {
  if (item.ref.type === 'asset' && item.kind === 'image') {
    return (
      <img
        className="om-step-slot-thumb"
        src={assetMediaUrl(item.ref.assetId, item.ref.versionId)}
        alt=""
        loading="lazy"
      />
    );
  }
  return (
    <span className="om-step-slot-icon" data-pool-kind={item.kind} aria-hidden="true">
      <RemixIcon name={poolKindIcon(item.kind)} size={14} />
    </span>
  );
}

export function MotionPanel({
  scenario,
  step,
  state,
  run,
  active,
  api,
  pool,
  toast,
  nav,
}: StepProps) {
  const { t, locale } = useI18n();
  const { info: integration } = useIntegrationInfo();
  const chrome = useOptionalWorkspaceChrome();
  const motionConfig = step.motion ?? { templateSource: 'none' as const, skills: [] };
  const templateSource = motionConfig.templateSource;

  // Motion template shelf (only fetched when templateSource === 'motion' and active)
  const motionTemplates = useExploreTemplates(
    active && templateSource === 'motion' ? 'motion' : undefined,
    locale,
    '',
    6,
  );
  const shelfItems = useMemo(
    () => motionTemplates.pages.flatMap(page => page.items).slice(0, 6),
    [motionTemplates.pages],
  );

  // Black Friday skills & stage references (offline-safe)
  const blackFridaySkills = useMemo(
    () => blackFridaySkillIds.flatMap(id => motionSkills.filter(skill => skill.id === id)),
    [],
  );
  const blackFridayStages = useMemo(
    () => (templateSource === 'black-friday' ? blackFridayTemplates([], locale) : []),
    [templateSource, locale],
  );

  // Recommended skills for non-black-friday motion steps
  const recommendedSkills = useMemo(
    () => motionConfig.skills.flatMap(id => motionSkills.filter(skill => skill.id === id)),
    [motionConfig.skills],
  );

  const [priorityId, setPriorityId] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<GalleryTemplate | null>(null);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(motionConfig.skills[0] ?? null);

  const defaultTitle = `${run?.title ?? scenario.title} · ${step.title}`.slice(0, 100);
  const [title, setTitle] = useState(defaultTitle);
  const [requirements, setRequirements] = useState('');
  const [creating, setCreating] = useState(false);
  const [linking, setLinking] = useState(false);
  const [openingProject, setOpeningProject] = useState(false);
  const [stagesExpanded, setStagesExpanded] = useState(false);
  const [linkExpanded, setLinkExpanded] = useState(false);

  // Pool asset items eligible for import into Motion project
  const importablePoolItems = useMemo(
    () => pool.items.filter(item => item.ref.type === 'asset' && (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio')),
    [pool.items],
  );

  const defaultBoundIds = useMemo(() => {
    const bound = new Set([...(state.bindings.firstFrame ?? []), ...(state.bindings.soundtrack ?? [])]);
    const valid = importablePoolItems.filter(item => bound.has(item.id)).map(item => item.id);
    return valid.length ? valid : importablePoolItems.slice(0, 6).map(item => item.id);
  }, [importablePoolItems, state.bindings.firstFrame, state.bindings.soundtrack]);

  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>(defaultBoundIds);
  const [poolTouched, setPoolTouched] = useState(false);

  useEffect(() => {
    if (!poolTouched) {
      setSelectedPoolIds(defaultBoundIds);
    } else {
      const validSet = new Set(importablePoolItems.map(item => item.id));
      setSelectedPoolIds(prev => prev.filter(id => validSet.has(id)));
    }
  }, [defaultBoundIds, importablePoolItems, poolTouched]);

  const workspaceProjects = useMemo(
    () => (chrome?.workspace.projects ?? []).filter(p => !p.trashedAt),
    [chrome?.workspace.projects],
  );
  const [linkProjectId, setLinkProjectId] = useState('');
  useEffect(() => {
    if (!linkProjectId && workspaceProjects.length > 0) {
      setLinkProjectId(workspaceProjects[0].id);
    }
  }, [linkProjectId, workspaceProjects]);

  const linkedMotionProjectId = state.links.motionProjectId ?? null;
  const linkedProjectLabel = useMemo(() => {
    if (!linkedMotionProjectId) return null;
    const ws = workspaceProjects.find(p => p.id === linkedMotionProjectId);
    if (ws) return ws.title;
    const poolItem = pool.items.find(
      item => item.ref.type === 'motion' && item.ref.projectId === linkedMotionProjectId,
    );
    return poolItem?.label ?? linkedMotionProjectId;
  }, [linkedMotionProjectId, workspaceProjects, pool.items]);

  const togglePoolItem = (id: string) => {
    setPoolTouched(true);
    setSelectedPoolIds(prev => (prev.includes(id) ? prev.filter(existing => existing !== id) : [...prev, id]));
  };

  const handleCreateMotion = async () => {
    const trimmedTitle = title.trim() || defaultTitle;
    const copyableTemplate = selectedTemplate && isEditableTemplate(selectedTemplate) ? selectedTemplate : null;
    const projectType = copyableTemplate ? 'template' : 'natural_language';

    const requirementParts: string[] = [];
    if (requirements.trim()) requirementParts.push(requirements.trim());
    if (selectedTemplate && !copyableTemplate) {
      requirementParts.push(`Reference style: ${selectedTemplate.title} (${selectedTemplate.id}). ${selectedTemplate.description}`);
    }
    if (selectedSkillId) {
      const skill = motionSkills.find(item => item.id === selectedSkillId);
      if (skill) {
        requirementParts.push(`Follow Skill ${skill.id} (${skill.name}): ${skill.output}.`);
      }
    }
    if (motionConfig.defaultDurationSeconds) {
      requirementParts.push(`Target duration: ${motionConfig.defaultDurationSeconds}s.`);
    }

    setCreating(true);
    try {
      await api.mutate<{ run: ScenarioRun; project: { projectId: string; sessionId: string | null; previewUrl: string } }>(
        `create-motion:${step.id}`,
        'create_motion',
        {
          stepId: step.id,
          projectType,
          ...(copyableTemplate ? { templateId: copyableTemplate.id } : {}),
          title: trimmedTitle,
          ...(requirementParts.length ? { requirements: requirementParts.join('\n') } : {}),
          poolItemIds: selectedPoolIds,
        },
      );
      toast.showToast(t('Motion project created'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not create Motion project.')), 'error', 'feedback');
      }
    } finally {
      setCreating(false);
    }
  };

  const handleLinkMotion = async () => {
    if (!linkProjectId) return;
    setLinking(true);
    try {
      await api.mutate(`link-motion:${step.id}:${linkProjectId}`, 'link_motion', {
        stepId: step.id,
        projectId: linkProjectId,
      });
      toast.showToast(t('Motion project linked'), 'info', 'feedback');
    } catch (error) {
      if (!isScenarioConflictError(error)) {
        toast.showToast(extractErrorMessage(error, t('Could not link Motion project.')), 'error', 'feedback');
      }
    } finally {
      setLinking(false);
    }
  };

  const handleOpenMotionEditor = async (projectId: string) => {
    setOpeningProject(true);
    try {
      await nav.openMotionProject(projectId);
    } finally {
      setOpeningProject(false);
    }
  };

  const handleCopyMotionHandoff = async () => {
    const targetRun = run ?? await api.ensureRun().catch(() => null);
    const prompt = buildStepAgentPrompt(scenario, targetRun, { stepId: step.id, locale, integration });
    const ok = await copyText(prompt);
    toast.showToast(
      ok ? t('Copied. Paste into your Agent.') : t('Could not copy to clipboard.'),
      ok ? 'info' : 'error',
      'feedback',
    );
  };

  return (
    <div className="om-step-motion-panel" data-motion-panel={templateSource}>
      {linkedMotionProjectId && (
        <section className="om-step-card om-step-linked-motion" aria-label={t('Linked Motion project')}>
          <div className="om-step-section-head">
            <div className="om-step-linked-motion-info">
              <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
                <RemixIcon name="movie-line" size={16} />
              </span>
              <div>
                <h3 className="om-step-section-title">{linkedProjectLabel}</h3>
                <p className="om-step-muted">{t('Linked editable Motion Studio project')}</p>
              </div>
            </div>
            <div className="om-step-toolbar-group">
              <Button
                variant="primary"
                size="sm"
                icon={<RemixIcon name="movie-line" size={14} />}
                loading={openingProject}
                onClick={() => void handleOpenMotionEditor(linkedMotionProjectId)}
              >
                {t('Open in Motion Editor')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<RemixIcon name="plug-line" size={14} />}
                title={t('Copy MCP prompt')}
                onClick={() => void handleCopyMotionHandoff()}
              >
                MCP
              </Button>
            </div>
          </div>
        </section>
      )}

      {templateSource === 'motion' && (
        <section className="om-step-section" aria-label={t('Motion templates')}>
          <div className="om-step-section-head">
            <div className="om-brief-composer-lead">
              <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
                <RemixIcon name="movie-line" size={16} />
              </span>
              <div>
                <h3 className="om-step-section-title">{t('Start from a Motion template')}</h3>
                <p className="om-step-muted">{t('Optional. Pick a template or leave blank to create a fresh project.')}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={<RemixIcon name="external-link-line" size={14} />}
              onClick={e => nav.openTemplateLibrary(e.currentTarget)}
            >
              {t('Browse template library')}
            </Button>
          </div>
          {motionTemplates.error ? (
            <div className="om-step-inline-error">
              <span>{t('Could not load Motion templates.')}</span>
              <Button variant="ghost" size="sm" onClick={motionTemplates.retry}>{t('Retry')}</Button>
            </div>
          ) : motionTemplates.loading && shelfItems.length === 0 ? (
            <div className="om-step-template-grid">
              {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="om-step-template-skeleton" />)}
            </div>
          ) : shelfItems.length > 0 ? (
            <div className="om-step-motion-shelf">
              {shelfItems.map(item => {
                const isSelected = selectedTemplate?.id === item.id;
                return (
                  <div key={item.id} className="om-step-motion-card-wrap" data-selected={isSelected ? 'true' : undefined}>
                    <TemplateGalleryCard
                      template={item}
                      active={active && priorityId === item.id}
                      onPriority={setPriorityId}
                      showAvatar={false}
                      brandedFallback
                      onSelect={tpl => setSelectedTemplate(prev => (prev?.id === tpl.id ? null : tpl))}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="om-step-muted">{t('No Motion templates loaded. You can still create a custom Motion project below.')}</p>
          )}

          {recommendedSkills.length > 0 && (
            <div className="om-step-skill-row">
              <span className="om-step-muted">{t('Recommended Skills')}:</span>
              <div className="om-step-chip-list">
                {recommendedSkills.map(skill => (
                  <Button
                    key={skill.id}
                    variant={selectedSkillId === skill.id ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={selectedSkillId === skill.id}
                    onClick={() => setSelectedSkillId(prev => (prev === skill.id ? null : skill.id))}
                  >
                    {t(skill.title)}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {templateSource === 'black-friday' && (
        <section className="om-step-section" aria-label={t('Black Friday Skills and references')}>
          <div className="om-step-section-head">
            <div className="om-brief-composer-lead">
              <span className="om-brief-composer-icon" data-tone="audio" aria-hidden="true">
                <RemixIcon name="flashlight-line" size={16} />
              </span>
              <div>
                <h3 className="om-step-section-title">{t('Black Friday Skills and stage references')}</h3>
                <p className="om-step-muted">{t('Choose a Black Friday Skill or campaign reference to guide your 30s sales film.')}</p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              icon={<RemixIcon name="flashlight-line" size={14} />}
              onClick={e => nav.openBlackFriday(e.currentTarget)}
            >
              {t('Browse full collection')}
            </Button>
          </div>

          {blackFridaySkills.length > 0 && (
            <div className="om-step-bf-carousel">
              <BlackFridaySkillCarousel
                skills={blackFridaySkills}
                previewsEnabled={active}
                onOpenSkill={id => {
                  setSelectedSkillId(id);
                  const found = blackFridaySkills.find(s => s.id === id);
                  if (found) {
                    toast.showToast(t('Selected Skill: {title}', { title: t(found.title) }), 'info', 'feedback');
                  }
                }}
              />
            </div>
          )}

          <div className="om-step-skill-row">
            <span className="om-step-muted">{t('Active Skill')}:</span>
            <div className="om-step-chip-list">
              {blackFridaySkills.map(skill => (
                <Button
                  key={skill.id}
                  variant={selectedSkillId === skill.id ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={selectedSkillId === skill.id}
                  onClick={() => setSelectedSkillId(prev => (prev === skill.id ? null : skill.id))}
                >
                  {t(skill.title)}
                </Button>
              ))}
            </div>
          </div>

          {blackFridayStages.length > 0 && (
            <div className="om-step-disclosure">
              <Button
                variant="ghost"
                size="sm"
                className="om-step-disclosure-trigger"
                aria-expanded={stagesExpanded}
                icon={<RemixIcon name={stagesExpanded ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} />}
                onClick={() => setStagesExpanded(prev => !prev)}
              >
                <span>{t('Stage reference templates')}</span>
              </Button>
              {stagesExpanded && (
                <div className="om-step-disclosure-body om-step-bf-stages">
                  {blackFridayStages.map(stage => (
                    <div key={stage.id} className="om-step-bf-stage">
                      <div className="om-step-bf-stage-head">
                        <strong>{t(stage.title)}</strong>
                        <span className="om-step-muted">{t(stage.description)}</span>
                      </div>
                      <div className="om-step-motion-shelf">
                        {stage.items.slice(0, 3).map(item => {
                          const isSelected = selectedTemplate?.id === item.id;
                          return (
                            <div key={item.id} className="om-step-motion-card-wrap" data-selected={isSelected ? 'true' : undefined}>
                              <TemplateGalleryCard
                                template={item}
                                active={active && priorityId === item.id}
                                onPriority={setPriorityId}
                                showAvatar={false}
                                brandedFallback
                                onSelect={tpl => setSelectedTemplate(prev => (prev?.id === tpl.id ? null : tpl))}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="om-step-card" aria-label={t('Create Motion project')}>
        <div className="om-step-section-head">
          <div className="om-brief-composer-lead">
            <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
              <RemixIcon name="clapperboard-line" size={16} />
            </span>
            <div>
              <h3 className="om-step-section-title">{t('Create Motion project')}</h3>
              <p className="om-step-muted">
                {selectedTemplate
                  ? t('Using: {title}', { title: selectedTemplate.title })
                  : t('Creates an editable Motion project with your selected assets.')}
              </p>
            </div>
          </div>
          {selectedTemplate && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedTemplate(null)}>
              {t('Clear selection')}
            </Button>
          )}
        </div>

        <div className="om-step-field">
          <label className="om-step-field-label" htmlFor={`motion-title-${step.id}`}>
            {t('Project title')}
          </label>
          <FieldInput
            id={`motion-title-${step.id}`}
            className="om-step-input"
            value={title}
            maxLength={100}
            onChange={e => setTitle(e.target.value)}
          />
        </div>

        <div className="om-step-field">
          <label className="om-step-field-label" htmlFor={`motion-req-${step.id}`}>
            {t('Creative notes (optional)')}
          </label>
          <FieldTextarea
            id={`motion-req-${step.id}`}
            className="om-step-textarea"
            rows={2}
            value={requirements}
            placeholder={t('Pacing, transitions, text callouts or music cues…')}
            onChange={e => setRequirements(e.target.value)}
          />
        </div>

        <div className="om-step-field">
          <span className="om-step-field-label">
            {t('Include assets ({count})', { count: selectedPoolIds.length })}
          </span>
          {importablePoolItems.length > 0 ? (
            <div className="om-step-checklist">
              {importablePoolItems.map(item => {
                const checked = selectedPoolIds.includes(item.id);
                return (
                  <div key={item.id} className="om-step-check-row">
                    <Checkbox
                      aria-label={item.label}
                      checked={checked}
                      onCheckedChange={() => togglePoolItem(item.id)}
                    />
                    <PoolAssetThumb item={item} />
                    <span className="om-step-check-label" onClick={() => togglePoolItem(item.id)}>{item.label}</span>
                    <span className="om-step-badge">{t(poolKindLabel(item.kind))}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="om-step-muted">{t('No images, videos, or audio here yet — you can add assets later in Motion Editor.')}</p>
          )}
        </div>

        <div className="om-step-actions-end">
          <Button
            variant="primary"
            icon={<RemixIcon name="movie-line" size={14} />}
            loading={creating}
            onClick={() => void handleCreateMotion()}
          >
            {t('Create Motion project')}
          </Button>
        </div>
      </section>

      {workspaceProjects.length > 0 && (
        <section className="om-step-disclosure" aria-label={t('Link another project')}>
          <Button
            variant="ghost"
            size="sm"
            className="om-step-disclosure-trigger"
            aria-expanded={linkExpanded}
            icon={<RemixIcon name={linkExpanded ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={14} />}
            onClick={() => setLinkExpanded(prev => !prev)}
          >
            <span>
              {t('Or link an existing Motion project')} · {t('{count} available', { count: workspaceProjects.length })}
            </span>
          </Button>
          {linkExpanded && (
            <div className="om-step-disclosure-body om-step-disclosure-panel">
              <div className="om-step-section-head">
                <div className="om-brief-composer-lead">
                  <span className="om-brief-composer-icon" data-tone="video" aria-hidden="true">
                    <RemixIcon name="link" size={16} />
                  </span>
                  <div>
                    <h3 className="om-step-section-title">{t('Link another project')}</h3>
                    <p className="om-step-muted">{t('Connect an existing Motion project from this workspace.')}</p>
                  </div>
                </div>
              </div>
              <div className="om-step-link-row">
                <Select
                  label={t('Workspace Motion project')}
                  value={linkProjectId}
                  options={workspaceProjects.map(p => ({ value: p.id, label: p.title }))}
                  onCommit={setLinkProjectId}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={linking}
                  disabled={!linkProjectId}
                  onClick={() => void handleLinkMotion()}
                >
                  {t('Link project')}
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
