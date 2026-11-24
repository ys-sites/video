import { useEffect, useRef, useState } from 'react';
import { Button } from 'open-design-ui/button';
import { RemixIcon } from '../../../../packages/design-system/react/RemixIcons';
import { designBriefPrompt, designScenarios, findDesignScenario, type DesignTemplateSummary } from '../../../../shared/design-project';
import { StudioToastViewport } from '../../components/StudioToastViewport';
import { useToast } from '../../hooks/useToast';
import { useI18n } from '../../i18n/I18n';
import { reportCreativeClick } from '../../motion/exploreTracking';
import { useIntegrationInfo } from '../../motion/useIntegrationInfo';
import { designClient } from '../designClient';
import { DesignTemplateDetailModal } from '../DesignTemplateDetailModal';
import { ScaledPreviewThumb } from '../ScaledPreviewThumb';
import type { DesignTabId } from './DesignSceneTabs';
import '../design.css';

/**
 * Design Studio HTML scenarios and live-preview starter template shelf embedded in Explore.
 */
export function ExploreDesignSection({
  onSelectDesignScene,
  onOpenProject,
}: {
  onSelectDesignScene: (scene: DesignTabId) => void;
  onOpenProject: (projectId: string) => void;
}) {
  const { t, locale } = useI18n();
  const { info: integrationInfo } = useIntegrationInfo();
  const toast = useToast();
  const [templates, setTemplates] = useState<DesignTemplateSummary[]>([]);
  const [previewIdx, setPreviewIdx] = useState<number | null>(null);
  const [remixing, setRemixing] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    designClient.listTemplates({ limit: 8 }).then(res => {
      if (active && Array.isArray(res?.items)) setTemplates(res.items);
    }).catch(() => { /* optional in offline/mocked tests */ });
    return () => { active = false; };
  }, []);

  const openPreview = (index: number, trigger: HTMLButtonElement) => {
    const template = templates[index];
    previewTrigger.current = trigger;
    setPreviewIdx(index);
    reportCreativeClick('explore', 'explore_collection', 'open_template', { studio: 'design', collection: 'design', scene: template.scenario, template: template.id });
  };

  const closePreview = () => {
    setPreviewIdx(null);
    requestAnimationFrame(() => previewTrigger.current?.focus({ preventScroll: true }));
  };

  const remix = async (tpl: DesignTemplateSummary) => {
    if (remixing) return;
    setRemixing(true);
    try {
      const { project } = await designClient.createProject({ scenario: tpl.scenario, templateId: tpl.id });
      setPreviewIdx(null);
      onOpenProject(project.id);
    } catch {
      toast.showToast(t('Could not create project'), 'error', 'feedback');
    } finally {
      setRemixing(false);
    }
  };

  const useWithAgent = async (tpl: DesignTemplateSummary) => {
    const prompt = designBriefPrompt({
      scenario: tpl.scenario,
      brief: tpl.examplePrompt || `Adapt the "${tpl.title}" template for my project.`,
      templateIds: [tpl.id],
      language: locale !== 'en' ? locale : null,
      integration: integrationInfo,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      toast.showToast(t('Copied. Paste into your Agent.'), 'info', 'feedback');
      closePreview();
    } catch {
      toast.showToast(t('Copy failed'), 'error', 'feedback');
    }
  };

  return (
    <div className="om-design-explore-block" data-design-explore-section="">
      <div className="om-design-section-head">
        <span className="om-design-muted">{t('HTML design scenarios · built with your MCP Agent')}</span>
        <Button type="button" size="sm" variant="ghost" icon={<RemixIcon name="folder-open-line" size={14} />} onClick={() => onSelectDesignScene('projects')}>
          {t('All design projects')}
        </Button>
      </div>

      <div className="om-design-scenario-grid">
        {designScenarios.map(scenario => (
          <Button
            key={scenario.id}
            type="button"
            variant="ghost"
            className="om-design-scenario-card"
            data-design-scenario={scenario.id}
            onClick={() => onSelectDesignScene(scenario.id)}
          >
            <div className="om-design-scenario-inner">
              <div className="om-design-scenario-top">
                <span className="om-design-icon-well">
                  <RemixIcon name={scenario.icon} size={17} />
                </span>
                <RemixIcon name="arrow-right-up-line" size={15} />
              </div>
              <strong className="om-design-card-title">{t(scenario.label)}</strong>
              <p className="om-design-card-desc">{t(scenario.hint)}</p>
            </div>
          </Button>
        ))}
      </div>

      {templates.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <span className="om-design-muted">{t('Design templates')}</span>
          <div className="om-design-grid">
            {templates.slice(0, 8).map((tpl, idx) => {
              const scen = findDesignScenario(tpl.scenario);
              return (
                <article key={tpl.id} className="om-design-card om-design-gallery-card" data-design-template={tpl.id} onClick={event => {
                  if (event.target instanceof Element && event.target.closest('button')) return;
                  event.currentTarget.querySelector<HTMLButtonElement>('.om-design-card-open')?.click();
                }}>
                  <div className="om-design-explore-cover">
                    <ScaledPreviewThumb
                      key={tpl.previewUrl}
                      brandedFallback
                      src={tpl.previewUrl}
                      title={tpl.title}
                      badge={scen ? t(scen.label) : tpl.scenario}
                    />
                    <Button
                      type="button"
                      size="md"
                      variant="ghost"
                      className="om-button om-design-gallery-action om-design-explore-use"
                      data-primary="media"
                      data-blurred=""
                      disabled={remixing}
                      onClick={() => void remix(tpl)}
                    >
                      {t('Use')}
                    </Button>
                  </div>
                  <div className="om-design-card-body">
                    <Button type="button" variant="plain" className="om-design-card-open" onClick={event => openPreview(idx, event.currentTarget)}>
                      <strong className="om-design-card-title">{tpl.title}</strong>
                    </Button>
                    <p className="om-design-card-desc">{tpl.description}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}

      {previewIdx !== null && (
        <DesignTemplateDetailModal
          templates={templates.slice(0, 8)}
          index={previewIdx}
          remixing={remixing}
          onNavigate={setPreviewIdx}
          onClose={closePreview}
          onRemix={tpl => { void remix(tpl); }}
          onUseWithAgent={tpl => { void useWithAgent(tpl); }}
        />
      )}

      <StudioToastViewport toasts={toast.toasts} dismissToast={toast.dismissToast} />
    </div>
  );
}
