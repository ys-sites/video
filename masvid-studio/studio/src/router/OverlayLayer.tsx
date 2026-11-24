import { Suspense, type RefObject } from 'react';
import type { GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { SettingsSurfaceBoundary } from '../motion/SettingsSurfaceBoundary';
import { prepareTemplateProject, TemplatePreparationBlockedError } from '../motion/templateHandoff';
import { workspacePageHref, type WorkspacePage } from '../motion/workspacePageRouting';
import { writeWorkspaceHistory } from '../utils/workspaceHistory';
import { LazyConnectionDialog, LazySkillsPage } from './lazyPages';

export type OverlayLayerProps = {
  page: WorkspacePage;
  projectId?: string;
  sessionId?: string;
  locale: string;
  connectionsOpen: boolean;
  templatesPage: boolean;
  detailOnly: boolean;
  libraryBusy: boolean;
  switchingDisabled: boolean;
  workspaceError: string;
  cardPreview: RefObject<{ template: GalleryTemplate; locale: string } | null>;
  libraryTrigger: RefObject<HTMLElement | null>;
  collectionSkillTrigger: RefObject<HTMLButtonElement | null>;
  navigatePage: (patch: Partial<WorkspacePage>, replace?: boolean, mode?: 'from-page' | 'keep') => void;
  beforeViewChange: () => Promise<void>;
  closeStandalonePreview: () => void;
  returnToExplore: () => void;
  openSkill: (skill: string) => void;
  openScenario: (scenario: 'black-friday', runId?: string, fromPage?: boolean) => void;
  openProject: (id: string) => Promise<boolean>;
  openTemplate: (id: string) => void;
  placement: 'in-workspace' | 'portal';
};

export function OverlayLayer({
  page,
  projectId,
  locale,
  connectionsOpen,
  templatesPage,
  detailOnly,
  libraryBusy,
  switchingDisabled,
  workspaceError,
  cardPreview,
  libraryTrigger,
  collectionSkillTrigger,
  navigatePage,
  beforeViewChange,
  closeStandalonePreview,
  returnToExplore,
  openSkill,
  openScenario,
  openProject,
  openTemplate,
  placement,
}: OverlayLayerProps) {
  const { t } = useI18n();
  const inWorkspaceOverlay = templatesPage || detailOnly;
  const shouldRenderLibrary = connectionsOpen && (placement === 'in-workspace' ? inWorkspaceOverlay : !inWorkspaceOverlay);
  const shouldRenderCollectionSkill =
    placement === 'in-workspace' && templatesPage && page.templateCollection === 'black-friday' && Boolean(page.skill);

  // Keep the Suspense boundary always mounted so startTransition holds the
  // underlying surface painted while the lazy overlay chunk loads.
  return (
    <SettingsSurfaceBoundary>
      <Suspense fallback={null}>
        {shouldRenderLibrary && (
          <LazyConnectionDialog
            collection={page.templateCollection}
            onCollectionChange={templateCollection => navigatePage({ templateCollection }, true)}
            collectionSkillOpen={page.templateCollection === 'black-friday' && Boolean(page.skill)}
            detailOnly={detailOnly}
            initialTemplate={
              detailOnly && cardPreview.current?.locale === locale ? cardPreview.current.template : undefined
            }
            onBrowseTemplates={() =>
              navigatePage({
                templates: true,
                templateCollection: null,
                ...(page.templateCollection === 'black-friday' && { skill: null }),
                template: null,
              })
            }
            onOpenSkill={(skill, trigger) => {
              if (!templatesPage) {
                openSkill(skill);
                return;
              }
              collectionSkillTrigger.current = trigger;
              navigatePage({ skill });
            }}
            onStartScenario={() => openScenario('black-friday', undefined, true)}
            inWorkspace={templatesPage}
            open
            projectId={projectId}
            returnFocus={libraryTrigger.current}
            section="templates"
            creators={page.creators}
            creator={page.creator}
            onCreatorChange={creator => navigatePage({ templates: true, creators: true, creator, template: null })}
            templateId={page.template}
            onTemplateChange={template => {
              if (!detailOnly) navigatePage({ template });
              else if (template) writeWorkspaceHistory(workspacePageHref(location.href, { template }), true);
              else closeStandalonePreview();
            }}
            busy={libraryBusy}
            openingDisabled={switchingDisabled}
            error={workspaceError}
            onClose={
              detailOnly
                ? closeStandalonePreview
                : () =>
                    page.templateCollection === 'black-friday'
                      ? returnToExplore()
                      : navigatePage({ templates: false })
            }
            onPrepareTemplate={async (template, requestId) => {
              try {
                await beforeViewChange();
              } catch (error) {
                throw new TemplatePreparationBlockedError(error instanceof Error ? error.message : t('Working…'));
              }
              return prepareTemplateProject(template, projectId, requestId);
            }}
            onOpenProject={id => openProject(id)}
            onOpen={openTemplate}
          />
        )}
        {shouldRenderCollectionSkill && (
          <LazySkillsPage
            detailOnly
            skillId={page.skill}
            onSkillChange={skill => navigatePage({ skill })}
          />
        )}
      </Suspense>
    </SettingsSurfaceBoundary>
  );
}
