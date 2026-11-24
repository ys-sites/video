import { Suspense, type ReactNode, type RefObject } from 'react';
import type { CreativeStudio, TechniqueStudio } from '../../../shared/studio-catalog';
import { findScenario, type ScenarioId } from '../../../shared/scenarios';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import type { AssetDraft } from '../motion/AssetComposer';
import type { CinemaTemplate } from '../motion/cinemaTemplates';
import { mediaEditorDestination, motionStudio, type StudioDestination } from '../motion/creativeStudios';
import { reportCreativeClick } from '../motion/exploreTracking';
import type { McpClient } from '../motion/mcpClients';
import type { McpEntry } from '../motion/pageTracking';
import { SettingsSurfaceBoundary } from '../motion/SettingsSurfaceBoundary';
import type { SkillParameters } from '../motion/skillCatalog';
import type { SoundTabId } from '../motion/soundTabs';
import { reportBlackFridayEntry } from '../motion/templateLibraryTracking';
import { WorkspaceBreadcrumb } from '../motion/WorkspaceBreadcrumb';
import type { WorkspaceChrome } from '../motion/WorkspaceChromeContext';
import type { ExploreFilters, SettingsSection, WorkspacePage } from '../motion/workspacePageRouting';
import type { WorkspaceSource } from '../utils/workspaceHistory';
import {
  LazyAssetsPage,
  LazyBrandKitPage,
  LazyCinemaStudioPage,
  LazyCreativeWorkspace,
  LazyDesignProjectEditor,
  LazyDesignScenePage,
  LazyExploreStudios,
  LazyGameStudio,
  LazyMcpConnectionPage,
  LazyModelHub,
  LazyModelOverview,
  LazyMotionStudioPage,
  LazyScenarioHub,
  LazyScenarioWorkspace,
  LazySettingsCenter,
  LazySkillsPage,
} from './lazyPages';
import { KeepAliveSlot, useKeepAliveVisited } from './KeepAliveOutlet';
import { resolveActiveWorkspaceRoute } from './routeRegistry';

function RouteLoadingFallback() {
  return (
    <div className="motion-route-skeleton" role="status" aria-busy="true">
      <div className="motion-route-skeleton-header">
        <Skeleton style={{ width: '220px', maxWidth: '45%', height: 'var(--motion-space-24)' }} />
        <Skeleton style={{ width: '360px', maxWidth: '70%', height: 'var(--motion-space-14)' }} />
      </div>
      <div className="motion-route-skeleton-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="motion-route-skeleton-card" />
        ))}
      </div>
    </div>
  );
}

function RouteSurface({ children }: { children: ReactNode }) {
  return <SettingsSurfaceBoundary>{children}</SettingsSurfaceBoundary>;
}

export type RouteViewportProps = {
  page: WorkspacePage;
  projectId?: string;
  source: WorkspaceSource | null;
  fromExplore: boolean;
  hostChrome: boolean;
  templatesPage: boolean;
  connectionsOpen: boolean;
  lastExplore: ExploreFilters;
  motionEditorDisabled: boolean;
  motionTemplatesOpen: boolean;
  standaloneMcp: boolean;
  visibleSettings: SettingsSection | null;
  showStudioBackToExplore: boolean;
  selectedCinemaTemplate?: CinemaTemplate;
  connectionEntry: McpEntry;
  studioVisit: number;
  studioDrafts: RefObject<Map<string, AssetDraft>>;
  skillBriefs: RefObject<Map<string, SkillParameters>>;
  libraryTrigger: RefObject<HTMLElement | null>;
  openLibrary: WorkspaceChrome['openLibrary'];
  openModelSettings: () => void;
  openProviderSettings?: (provider: string) => void;
  navigatePage: (patch: Partial<WorkspacePage>, replace?: boolean, mode?: 'from-page' | 'keep') => void;
  openHome: () => void;
  openSettings: (section: SettingsSection, entry?: McpEntry) => void;
  closeSettings: () => void;
  openMcp: (client?: McpClient, example?: string, fromPage?: boolean) => void;
  openSkill: (skill: string) => void;
  closeSkills: () => void;
  openStudio: (studio: StudioDestination | null, seed?: string | AssetDraft, fromPage?: boolean) => void;
  openStudioFromPage: (studio: StudioDestination, seed?: string | AssetDraft) => void;
  chooseStudio: (entry: CreativeStudio, kind?: 'image' | 'video' | 'audio', fromPage?: boolean) => void;
  openModelFromPage: (id: string) => void;
  openModelHub: (id: string) => void;
  openScenarioHub: (fromPage?: boolean) => void;
  openScenario: (scenario: ScenarioId, runId?: string, fromPage?: boolean) => void;
  openMotionEditor: (selection: 'first' | 'last') => Promise<void>;
  openMotionProject: (id: string) => Promise<boolean>;
  returnToExplore: () => void;
  selectAssetRoute: (assetId: string | null, assetVersion: string | null) => void;
};

export function RouteViewport({
  page,
  projectId,
  source,
  fromExplore,
  hostChrome,
  templatesPage,
  connectionsOpen,
  lastExplore,
  motionEditorDisabled,
  motionTemplatesOpen,
  standaloneMcp,
  visibleSettings,
  showStudioBackToExplore,
  selectedCinemaTemplate,
  connectionEntry,
  studioVisit,
  studioDrafts,
  skillBriefs,
  libraryTrigger,
  openLibrary,
  openModelSettings,
  openProviderSettings,
  navigatePage,
  openHome,
  openSettings,
  closeSettings,
  openMcp,
  openSkill,
  closeSkills,
  openStudio,
  openStudioFromPage,
  chooseStudio,
  openModelFromPage,
  openModelHub,
  openScenarioHub,
  openScenario,
  openMotionEditor,
  openMotionProject,
  returnToExplore,
  selectAssetRoute,
}: RouteViewportProps) {
  const { t } = useI18n();
  const { settings, assets: assetsOpen, skills: skillsOpen } = page;
  const activeRoute = resolveActiveWorkspaceRoute(page, { templatesPage, standaloneMcp });
  const keepAliveVisited = useKeepAliveVisited(activeRoute.id, [
    ...(page.explore ? (['explore'] as const) : []),
    ...(assetsOpen ? (['assets'] as const) : []),
  ]);
  const mcpPage = settings === 'mcp' && (
    <LazyMcpConnectionPage
      entry={connectionEntry}
      projectId={projectId}
      hasProject={Boolean(projectId)}
      previewsEnabled={!connectionsOpen}
      openLibrary={openLibrary}
      openProviders={openModelSettings}
      route={page}
      onRouteChange={navigatePage}
      inSettings={page.mcpInSettings}
      breadcrumb={source && <WorkspaceBreadcrumb source={source} destination="MCP" />}
    />
  );

  // A single always-mounted Suspense boundary lets React's startTransition keep
  // the currently visible route painted while the next lazy chunk resolves,
  // avoiding blank flashes or skeleton flickers on in-app navigation.
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <KeepAliveSlot
        routeId="explore"
        active={page.explore && !templatesPage}
        visited={keepAliveVisited}
        className="om-explore-host"
      >
        <RouteSurface>
          <LazyExploreStudios
            initialTemplateCollection={page.templateCollection}
            onModel={openModelFromPage}
            onModelHub={openModelHub}
            onOpenMotionEditor={() => void openMotionEditor('last')}
            motionEditorDisabled={motionEditorDisabled}
            onOpenBlackFriday={trigger => {
              reportBlackFridayEntry();
              openLibrary(trigger, undefined, 'black-friday');
            }}
            onCreators={trigger => {
              libraryTrigger.current = trigger;
              navigatePage({ templates: true, creators: true, creator: null, template: null });
            }}
            onBrandKit={() => openSettings('brand-kit')}
            onMcp={(client, example) => openMcp(client, example, true)}
            onSelectDesignScene={designScene =>
              navigatePage({ designScene, designProject: null, templates: false, ...lastExplore })
            }
            onOpenDesignProject={id =>
              navigatePage({ designScene: 'projects', designProject: id, templates: false, ...lastExplore })
            }
            onStartScenario={id => openScenario(id, undefined, true)}
            onOpenScenarioHub={() => openScenarioHub(true)}
            filters={lastExplore}
            onChooseStudio={studio => chooseStudio(studio, undefined, true)}
            active={page.explore && !connectionsOpen}
            onNavigate={openStudioFromPage}
            onSkill={openSkill}
          />
        </RouteSurface>
      </KeepAliveSlot>

      {page.scenarioHub && !templatesPage && !settings && (
        <div className="om-explore-host">
          <RouteSurface>
            <LazyScenarioHub
              category={page.scenarioCategory}
              active={!connectionsOpen}
              onCategory={scenarioCategory => navigatePage({ scenarioCategory }, true)}
              onOpenScenario={(id, runId) => openScenario(id, runId, true)}
              onExplore={returnToExplore}
            />
          </RouteSurface>
        </div>
      )}

      {page.scenario && !templatesPage && !settings && (
        <div className="om-assets-host om-scenario-host" style={{ padding: 0 }}>
          <RouteSurface>
            <LazyScenarioWorkspace
              key={page.scenario}
              scenarioId={page.scenario}
              runId={page.scenarioRun}
              stepId={page.scenarioStep}
              mode={page.scenarioMode}
              active={!connectionsOpen}
              onRoute={(patch, replace) =>
                navigatePage(
                  {
                    ...(patch.run !== undefined ? { scenarioRun: patch.run } : {}),
                    ...(patch.step !== undefined ? { scenarioStep: patch.step } : {}),
                    ...(patch.mode !== undefined ? { scenarioMode: patch.mode } : {}),
                  },
                  Boolean(replace),
                )
              }
              onExplore={returnToExplore}
              onOpenHub={() => openScenarioHub()}
              breadcrumb={
                source && !fromExplore ? (
                  <WorkspaceBreadcrumb source={source} destination={t(findScenario(page.scenario)?.title ?? 'Workflows')} />
                ) : undefined
              }
              onOpenDesignProject={id =>
                navigatePage(
                  { designScene: 'projects', designProject: id, templates: false, ...lastExplore },
                  false,
                  'from-page',
                )
              }
              onOpenMotionProject={id => openMotionProject(id)}
              onOpenModelHub={openModelHub}
              onOpenBlackFriday={trigger => {
                reportBlackFridayEntry();
                openLibrary(trigger, undefined, 'black-friday');
              }}
              onOpenTemplateLibrary={trigger => openLibrary(trigger)}
              onOpenStudioScene={(target, prompt) => openStudioFromPage(target, prompt)}
              onOpenProviders={provider => {
                if (provider && openProviderSettings) openProviderSettings(provider);
                else openModelSettings();
              }}
              onOpenMcp={example => openMcp(undefined, example, true)}
            />
          </RouteSurface>
        </div>
      )}

      {page.cinemaLanding && !templatesPage && !settings && (
        <div className="om-explore-host">
          <RouteSurface>
            <LazyCinemaStudioPage
              onStart={() => openStudio(mediaEditorDestination('text-to-video'), undefined, true)}
              onTemplate={(template, position) => {
                reportCreativeClick('creative_studio', 'studio_bar', 'try_prompt', {
                  studio: 'cinema',
                  scene: template.scene,
                  template: template.id,
                  position,
                });
                navigatePage(
                  {
                    studio: mediaEditorDestination(template.scene),
                    cinemaTemplate: template.id,
                    templates: false,
                    ...lastExplore,
                  },
                  false,
                  'from-page',
                );
              }}
            />
          </RouteSurface>
        </div>
      )}

      {motionTemplatesOpen && (
        <div className="om-explore-host">
          <RouteSurface>
            <LazyMotionStudioPage
              active={!connectionsOpen}
              onOpenEditor={() => void openMotionEditor('first')}
              editorDisabled={motionEditorDisabled}
              onBackToExplore={fromExplore ? returnToExplore : undefined}
              onStartScenario={() => openScenario('motion-full-chain', undefined, true)}
            />
          </RouteSurface>
        </div>
      )}

      {page.modelHub && !templatesPage && (
        <div className="om-explore-host">
          <RouteSurface>
            <LazyModelHub
              id={page.modelHub}
              hasProject={Boolean(projectId)}
              onExplore={returnToExplore}
              onModel={openModelFromPage}
              onSettings={openSettings}
              onProvider={provider => navigatePage({ settings: 'providers', provider, templates: false })}
              onUse={() => chooseStudio(motionStudio)}
              onStartScenario={
                page.modelHub === 'gemini-4' ? () => openScenario('gemini-4-neon', undefined, true) : undefined
              }
            />
          </RouteSurface>
        </div>
      )}

      {page.modelOverview && !templatesPage && (
        <div className="om-explore-host">
          <RouteSurface>
            <LazyModelOverview
              id={page.modelOverview}
              source={source}
              onExplore={hostChrome ? returnToExplore : undefined}
              onProvider={provider => navigatePage({ settings: 'providers', provider: provider ?? null, templates: false })}
              onScene={(studio, prompt, soundTab) =>
                soundTab
                  ? navigatePage(
                      {
                        studio,
                        soundTab,
                        skill: null,
                        settings: null,
                        assets: false,
                        skills: false,
                        templates: false,
                        ...lastExplore,
                      },
                      false,
                      'from-page',
                    )
                  : openStudioFromPage(studio, prompt)
              }
            />
          </RouteSurface>
        </div>
      )}

      {page.studio && (
        <div className="om-workspace-layer" hidden={templatesPage} aria-hidden={templatesPage} inert={templatesPage}>
          <RouteSurface>
            <LazyCreativeWorkspace
              onOpenBrandKit={hostChrome ? () => openSettings('brand-kit') : undefined}
              soundTab={page.soundTab ?? null}
              skill={page.skill}
              onCollection={(specialty: TechniqueStudio, replace?: boolean) =>
                navigatePage({ specialty, templates: false }, Boolean(replace))
              }
              onSelectDesignScene={designScene =>
                navigatePage({ designScene, designProject: null, templates: false, ...lastExplore })
              }
              breadcrumb={
                source && !showStudioBackToExplore ? (
                  <WorkspaceBreadcrumb
                    source={source}
                    destination={t(page.studio.landing ? page.studio.scene.label : page.studio.studio.title)}
                  />
                ) : undefined
              }
              onBackToExplore={showStudioBackToExplore || (hostChrome && !source) ? returnToExplore : undefined}
              onExplore={returnToExplore}
              drafts={studioDrafts}
              active={!connectionsOpen}
              destination={page.studio}
              visit={studioVisit}
              hasProject={Boolean(projectId)}
              cinemaTemplate={selectedCinemaTemplate}
              onOpenStudio={studio => navigatePage({ studio, templates: false }, false, 'from-page')}
              onNavigate={(studio: StudioDestination, soundTab?: SoundTabId | null) =>
                navigatePage(
                  {
                    studio,
                    soundTab: soundTab ?? null,
                    templates: false,
                    cinemaTemplate:
                      studio.scene.modality === 'video' && studio.scene.id === page.studio?.scene.id
                        ? page.cinemaTemplate
                        : null,
                  },
                  false,
                  'keep',
                )
              }
            />
          </RouteSurface>
        </div>
      )}

      {page.designScene && !templatesPage && (
        <div className="om-assets-host" style={{ padding: 0 }}>
          <RouteSurface>
            {page.designProject ? (
              <LazyDesignProjectEditor
                projectId={page.designProject}
                onBack={() => navigatePage({ designScene: page.designScene, designProject: null, templates: false })}
                onOpenMcp={() => openMcp(undefined, undefined, true)}
              />
            ) : (
              <LazyDesignScenePage
                scene={page.designScene}
                onSelectDesignScene={designScene =>
                  navigatePage({ designScene, designProject: null, templates: false })
                }
                onOpenProject={id =>
                  navigatePage({ designScene: page.designScene ?? 'projects', designProject: id, templates: false })
                }
                onExplore={returnToExplore}
                onOpenMcp={() => openMcp(undefined, undefined, true)}
                onStartScenario={() => openScenario('design-full-chain', undefined, true)}
              />
            )}
          </RouteSurface>
        </div>
      )}

      <KeepAliveSlot
        routeId="assets"
        active={assetsOpen && !settings && !templatesPage}
        visited={keepAliveVisited}
        className="om-assets-host"
      >
        <RouteSurface>
          <LazyAssetsPage
            hasProject={Boolean(projectId)}
            active={assetsOpen && !settings && !templatesPage}
            routeId={page.assetId}
            routeVersion={page.assetVersion}
            onAssetRoute={selectAssetRoute}
          />
        </RouteSurface>
      </KeepAliveSlot>

      {page.specialty?.id === 'game' && !skillsOpen && !settings && !templatesPage && (
        <div className="om-skills-host">
          <RouteSurface>
            <LazyGameStudio onExplore={returnToExplore} onOpenMcp={() => openMcp(undefined, undefined, true)} />
          </RouteSurface>
        </div>
      )}

      {(skillsOpen || page.specialty) &&
        !(page.specialty?.id === 'game' && !skillsOpen) &&
        !settings &&
        !templatesPage && (
          <div className="om-skills-host">
            <RouteSurface>
              <LazySkillsPage
                previewsEnabled={!connectionsOpen}
                briefs={skillBriefs.current}
                onCreate={openStudioFromPage}
                key={page.specialty?.id ?? 'skills'}
                studio={page.specialty ?? undefined}
                onExplore={returnToExplore}
                onClose={skillsOpen ? closeSkills : undefined}
                skillId={page.skill}
                routeCategory={page.skills ? page.skillCategory : undefined}
                onCategoryChange={skillCategory => navigatePage({ skillCategory }, true)}
                onSkillChange={skill => navigatePage({ skill })}
                hasProject={Boolean(projectId)}
              />
            </RouteSurface>
          </div>
        )}

      {standaloneMcp && !templatesPage && <SettingsSurfaceBoundary>{mcpPage}</SettingsSurfaceBoundary>}

      {visibleSettings === 'brand-kit' ? (
        <SettingsSurfaceBoundary key="brand-kit">
          <LazyBrandKitPage
            inWorkspace={!hostChrome}
            onClose={openHome}
            selectedId={page.brandKit}
            onSelect={brandKit => navigatePage({ brandKit })}
            previewsEnabled={!connectionsOpen}
            hasProject={Boolean(projectId)}
          />
        </SettingsSurfaceBoundary>
      ) : (
        visibleSettings && (
          <SettingsSurfaceBoundary key="settings">
            <LazySettingsCenter
              hasProject={Boolean(projectId)}
              section={visibleSettings}
              onBack={closeSettings}
              onSection={openSettings}
              openConnections={entry => openSettings('mcp', entry)}
              mcp={mcpPage}
              providerId={page.provider}
              onProviderChange={provider => navigatePage({ provider })}
            />
          </SettingsSurfaceBoundary>
        )
      )}
    </Suspense>
  );
}
