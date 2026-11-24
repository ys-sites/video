import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import type { SkillCategory } from './skillCategories';
import { FieldInput } from "../components/ui/FormField";
import { DisclosureRow } from "../../../packages/design-system/react/DisclosureRow";
import { useProjectArchives, ProjectArchiveMenu, type ProjectArchiveActions } from './ProjectArchives';
import type { GalleryTemplate } from '../../../shared/catalog';
import type { McpClient } from './mcpClients';
import { creativeStudios, type CreativeStudio, type TechniqueStudio } from '../../../shared/studio-catalog';
import type { Modality } from '../../../shared/gateway';
import { hasStudioHome, scenesForStudio, studioDestination, studioDraftKey, type StudioDestination } from './creativeStudios';
import type { AssetDraft } from './AssetComposer';
import type { SkillParameters } from './skillCatalog';
import { findCinemaTemplate } from './cinemaTemplates';
import { useState, useRef, useCallback, useEffect, useTransition, type ReactNode } from 'react';
import { useInRouterContext, useLocation } from 'react-router';
import { useI18n } from '../i18n/I18n';
import { MotionIcon } from './icons';
import { RemixIcon } from '../icons/RemixIcons';
import { navigateWorkspace, useWorkspace } from './useWorkspace';
import { Tooltip } from '../components/ui/Tooltip';
import { Dialog } from '@base-ui/react/dialog';
import { StudioConnectionToast } from '../components/StudioConnectionToast';
import { ErrorNotice } from '../components/ui/ErrorNotice';
import { isConnectionFailure } from '../components/ui/errorNoticeMessage';
import { preservePresentation, workspacePresentation } from '../../../shared/workspace-url';
import { trackMotion } from './tracking';
import { ApplicationHeader, WorkspaceUtilityActions } from './ApplicationChrome';
import { BlackFridayTopBanner } from './BlackFridayTopBanner';
import { dismissBannerToday, shouldShowBlackFridayBanner, useMinuteCondition } from './campaignAttribution';
import type { McpEntry } from './pageTracking';
import { WorkspaceProjectsButton } from './WorkspaceProjectsButton';
import { Skeleton } from '../components/ui/Skeleton';
import { changesWorkspaceDestination, defaultDesignScene, isLegacyWorkspaceHref, readWorkspacePage, workspacePageHref, type SettingsSection, type WorkspacePage } from './workspacePageRouting';
import type { SoundTabId } from './soundTabs';
import { WORKSPACE_LOCATION_CHANGED, initializeWorkspaceHistory, navigateWorkspaceHistory, readLocationWorkspaceSource, restoreWorkspaceSource, workspaceHistoryIndex, workspaceHistorySource, workspaceSettingsSource, writeWorkspaceHistory } from '../utils/workspaceHistory';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { clickMethod, searchStarted, trackStudioClick } from './editorTracking';
import { reportCreativePageView } from './exploreTracking';
import type { ScenarioId } from '../../../shared/scenarios';
import { isWorkspacePageOpen, resolveNavTrackingPage, resolveRouteArrival } from '../router/routeRegistry';
import { RouteViewport } from '../router/RouteViewport';
import { OverlayLayer } from '../router/OverlayLayer';
import { StudioRouterProvider } from '../router/createAppRouter';
import { useWorkspaceBlocker } from '../router/useWorkspaceBlocker';

import { WorkspaceChromeContext, useWorkspaceChrome, type WorkspaceChrome, type EditorGuard } from './WorkspaceChromeContext';
export { useWorkspaceChrome, useOptionalWorkspaceChrome, type EditorGuard } from './WorkspaceChromeContext';

type WorkspaceFrameProps = {
  children: ReactNode; waitForSaves: () => Promise<void>; projectId?: string; sessionId?: string; blocked?: boolean; message?: string; saveState?: string; onLibraryClose?: () => void; onNavigate?: (targetHref?: string) => void;
};

export function WorkspaceFrame(props: WorkspaceFrameProps) {
  const inRouter = useInRouterContext();
  if (!inRouter) {
    return (
      <StudioRouterProvider>
        <WorkspaceFrameInner {...props} />
      </StudioRouterProvider>
    );
  }
  return <WorkspaceFrameInner {...props} />;
}

function WorkspaceFrameInner({ children, waitForSaves, projectId, sessionId, blocked = false, message = '', saveState = '', onLibraryClose, onNavigate }: WorkspaceFrameProps) {
  const { t, locale } = useI18n();
  const routerLocation = useLocation();
  const [page, setPage] = useState(() => readWorkspacePage(routerLocation.search, routerLocation.hash, routerLocation.pathname));
  const [source, setSource] = useState(() => readLocationWorkspaceSource(routerLocation.state));
  const [isRoutePending, startRouteTransition] = useTransition();
  const sourceUrl = source ? new URL(source.href) : null;
  const sourcePage = sourceUrl && readWorkspacePage(sourceUrl.search, sourceUrl.hash, sourceUrl.pathname);
  const fromExplore = sourcePage?.explore && !sourcePage.templates && !sourcePage.template;
  const { settings, assets: assetsOpen, skills: skillsOpen, templates: libraryRequested } = page;
  const standaloneMcp = settings === 'mcp' && !page.mcpInSettings;
  const selectedCinemaTemplate = findCinemaTemplate(page.cinemaTemplate);
  const detailOnly = Boolean(page.template) && !libraryRequested;
  const connectionsOpen = libraryRequested || detailOnly;
  const hostChrome = window.parent !== window && new URLSearchParams(routerLocation.search).get('hostChrome') === '1';
  const templatesPage = libraryRequested && !hostChrome;
  // Resource pages cover the editor without unmounting it.
  const pageOpen = isWorkspacePageOpen(page, templatesPage);
  const lastExplore = useRef({ community: page.community, medium: page.medium });
  if (page.explore) lastExplore.current = { community: page.community, medium: page.medium };
  const skillBriefs = useRef(new Map<string, SkillParameters>());
  const studioDrafts = useRef(new Map<string, AssetDraft>());
  const [studioVisit, setStudioVisit] = useState(0);
  const libraryOpen = useRef(libraryRequested);
  const libraryClosed = useRef(onLibraryClose); libraryClosed.current = onLibraryClose;
  useEffect(() => {
    const sync = (search: string, hash: string, pathname: string, locationState?: unknown) => {
      const next = readWorkspacePage(search, hash, pathname);
      if (libraryOpen.current && !next.templates) libraryClosed.current?.();
      libraryOpen.current = next.templates;
      const nextSource = locationState !== undefined ? readLocationWorkspaceSource(locationState) : workspaceHistorySource();
      startRouteTransition(() => {
        setPage(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        setSource(previous => previous?.index === nextSource?.index && previous?.href === nextSource?.href ? previous : nextSource);
      });
    };
    sync(routerLocation.search, routerLocation.hash, routerLocation.pathname, routerLocation.state);
    const onLocationChanged = () => sync(location.search, location.hash, location.pathname);
    window.addEventListener(WORKSPACE_LOCATION_CHANGED, onLocationChanged);
    return () => {
      window.removeEventListener(WORKSPACE_LOCATION_CHANGED, onLocationChanged);
    };
  }, [routerLocation]);
  useEffect(() => {
    if (isLegacyWorkspaceHref(location.search, page, location.pathname)) writeWorkspaceHistory(workspacePageHref(location.href, { studio: page.studio }), true);
  }, [page]);
  const navigatePage = useCallback((patch: Partial<WorkspacePage>, replace = false, mode?: 'from-page' | 'keep') => {
    const current = new URL(location.href);
    const target = new URL(workspacePageHref(current.href, patch), current);
    initializeWorkspaceHistory();
    const index = workspaceHistoryIndex();
    const origin = !replace && index !== null && target.href !== current.href ? { href: current.href, index } : null;
    let nextSource = workspaceHistorySource();
    if (mode === 'from-page') {
      if (origin) nextSource = origin;
    } else if (mode !== 'keep' && changesWorkspaceDestination(patch)) {
      nextSource = null;
    }
    const isSettingsCenter = (url: URL) => {
      const parsed = readWorkspacePage(url.search, url.hash, url.pathname);
      return Boolean(parsed.settings) && parsed.settings !== 'brand-kit' && (parsed.settings !== 'mcp' || parsed.mcpInSettings);
    };
    let settingsSource = null;
    if (isSettingsCenter(target)) {
      settingsSource = isSettingsCenter(current) ? workspaceSettingsSource() : origin;
    }
    writeWorkspaceHistory(target, replace, { page: nextSource, settings: settingsSource });
  }, []);
  const presentation = workspacePresentation(location.search);
  const guard = useRef<EditorGuard | null>(null);
  const [editorState, setEditorState] = useState<Pick<EditorGuard, 'blocked' | 'saveState' | 'message'> | null>(null);
  const registerEditor = useCallback((value: EditorGuard | null) => {
    guard.current = value;
    setEditorState(previous => previous?.blocked === value?.blocked && previous?.saveState === value?.saveState && previous?.message === value?.message ? previous : value);
  }, []);
  const beforeViewChange = useCallback(async () => {
    if (guard.current?.blocked) throw new Error(guard.current.message || t('Working…'));
    await (guard.current?.waitForSaves ?? waitForSaves)();
  }, [waitForSaves, t]);
  const navigate = useCallback((url: string, replace = false) => {
    if (!onNavigate) { navigateWorkspace(url, replace); return; }
    const target = preservePresentation(url, location.search);
    void navigateWorkspaceHistory(target, replace).then(() => {
      onNavigate(target);
    });
  }, [onNavigate]);
  const workspace = useWorkspace(beforeViewChange, projectId, sessionId, navigate, { externalHistoryGuard: Boolean(onNavigate) });
  const fallbackActingRef = useRef(false);
  const [blockerError, setBlockerError] = useState<{ message: string } | null>(null);
  useEffect(() => { setBlockerError(null); }, [projectId, sessionId]);
  const handleBlockedError = useCallback((errorMessage: string | null) => {
    setBlockerError(errorMessage ? { message: errorMessage } : null);
  }, []);
  useWorkspaceBlocker({
    enabled: Boolean(onNavigate),
    actingRef: workspace.actingRef ?? fallbackActingRef,
    waitForSaves: beforeViewChange,
    onBlockedError: handleBlockedError,
    onProjectChangeProceed: onNavigate,
  });
  const navigationError = blockerError ?? workspace.navigationError;
  const navigationToast = useToast();
  useEffect(() => {
    if (!navigationError) return;
    const id = navigationToast.showToast(navigationError.message, 'error', 'feedback');
    return () => navigationToast.dismissToast(id);
  }, [navigationError, navigationToast.showToast, navigationToast.dismissToast]);
  const connectionEntry = useRef<McpEntry>('direct_link');
  // A later visit through history or a pasted link has no control behind it.
  useEffect(() => { if (settings !== 'mcp') connectionEntry.current = 'direct_link'; }, [settings]);
  const libraryTrigger = useRef<HTMLElement | null>(null);
  const skillsTrigger = useRef<HTMLElement | null>(null);
  const skillsReturnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (skillsOpen) return;
    const trigger = skillsReturnFocus.current;
    skillsReturnFocus.current = null;
    skillsTrigger.current = null;
    if (page.explore && !page.templates) trigger?.focus({ preventScroll: true });
  }, [skillsOpen, page.explore, page.templates]);
  const cardPreview = useRef<{ template: GalleryTemplate; locale: string } | null>(null);
  const closeStandalonePreview = () => {
    // A card pushes one preview entry. Copied links start a new history session at index zero.
    if (onNavigate && (workspaceHistoryIndex() ?? 0) > 0) history.back();
    else writeWorkspaceHistory(workspacePageHref(location.href, { template: null }), true);
  };
  const collectionSkillTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (page.skill) return;
    if (page.templateCollection === 'black-friday') collectionSkillTrigger.current?.focus({ preventScroll: true });
    collectionSkillTrigger.current = null;
  }, [page.templateCollection, page.skill]);
  const [narrow, setNarrow] = useState(() => window.innerWidth < 768);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth >= 768);
  // Shown inside the campaign window on non-Explore tabs unless dismissed today; re-checked each minute for the end and the next day.
  const [bfBannerShown, setBfBannerShown] = useMinuteCondition(shouldShowBlackFridayBanner);
  const onExploreTab = page.explore && !templatesPage && !settings;
  const bfBannerVisible = !hostChrome && !onExploreTab && bfBannerShown;
  const closeBfBanner = useCallback(() => { dismissBannerToday(); setBfBannerShown(false); }, [setBfBannerShown]);
  const expireBfBanner = useCallback(() => setBfBannerShown(false), [setBfBannerShown]);
  const [projectQuery, setProjectQuery] = useState('');
  const editorRoute = !settings && !pageOpen;
  const editorActive = editorRoute && !connectionsOpen;
  const motionTemplatesOpen = page.motion && !templatesPage && !settings;
  const previousOperationError = useRef('');
  useEffect(() => {
    const currentError = workspace.errorSource === 'operation' ? workspace.error : '';
    const previousError = previousOperationError.current;
    previousOperationError.current = currentError;
    if (!currentError || currentError === previousError || !motionTemplatesOpen) return;
    navigationToast.showToast(currentError, 'error', 'feedback');
    workspace.clearError();
  }, [motionTemplatesOpen, workspace.errorSource, workspace.error, workspace.clearError, navigationToast.showToast]);
  useEffect(() => setSidebarOpen(editorRoute && !narrow), [editorRoute, narrow]);
  const navigationCollapsed = !editorActive;
  const toggleSidebar = useCallback(() => setSidebarOpen(open => !open), []);
  const openEditor = () => { navigatePage({ motion: false, templates: false }); if (narrow) setSidebarOpen(false); };
  const openAssets = useCallback(() => { navigatePage({ assets: true, assetId: null, assetVersion: null, templates: false }); }, [navigatePage]);
  const openSkills = useCallback((skillCategory: SkillCategory | null = null, trigger?: HTMLElement) => {
    skillsTrigger.current = trigger ?? null;
    navigatePage({ skills: true, skill: null, skillCategory, templates: false });
  }, [navigatePage]);
  const openSettings = useCallback((section: SettingsSection, entry?: McpEntry) => {
    if (entry) connectionEntry.current = entry;
    navigatePage({ settings: section, mcpInSettings: section === 'mcp', assets: false, skills: false, templates: false },
      false, entry ? 'from-page' : undefined);
  }, [navigatePage]);
  const applicationRef = useRef<HTMLDivElement>(null);
  const openHome = useCallback(() => {
    navigatePage({ explore: true, community: null, medium: null, templates: false });
    requestAnimationFrame(() => applicationRef.current?.querySelector<HTMLButtonElement>('.om-app-brand')?.focus());
  }, [navigatePage]);
  const closeSettings = () => {
    const settingsSource = workspaceSettingsSource();
    if (!settingsSource || !restoreWorkspaceSource(settingsSource)) openHome();
  };
  useEffect(() => {
    const open = () => openSettings('local');
    window.addEventListener('motion:agents-open', open);
    return () => window.removeEventListener('motion:agents-open', open);
  }, [openSettings]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => {
      // Close the desktop list in the same render that enables the modal drawer.
      if (query.matches) setSidebarOpen(false);
      setNarrow(query.matches);
    };
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === ',') { event.preventDefault(); openSettings('general'); }
      if (editorActive && event.altKey && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [editorActive, openSettings, toggleSidebar]);
  const libraryBusy = workspace.busy || blocked || Boolean(editorState?.blocked);
  const switchingDisabled = libraryBusy || !workspace.status;
  const motionEditorDisabled = switchingDisabled || workspace.projects.length === 0;
  const openMotionEditor = async (selection: 'first' | 'last') => {
    if (motionEditorDisabled) return;
    const current = projectId ?? workspace.activeProjectId;
    const previous = selection === 'last' ? workspace.projects.find(project => project.id === current) : undefined;
    const target = previous ?? workspace.projects[0];
    if (!target) return;
    if (target.id === projectId) openEditor();
    else if (!await workspace.open('projects', target.id) && !motionTemplatesOpen) {
      navigationToast.showToast(t('Could not open project'), 'error', 'feedback');
    }
  };
  const archives = useProjectArchives(workspace, beforeViewChange, switchingDisabled, () => { if (narrow) setSidebarOpen(false); });
  const reconnecting = Boolean(workspace.connectionError && isConnectionFailure(workspace.connectionError));
  const workspaceNotice = workspace.errorSource === 'connection' && reconnecting ? '' : workspace.error;
  const notice = workspaceNotice || message || editorState?.message || "";
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const noticeKey = `${workspaceNotice ? workspace.errorSource : 'editor'}:${notice || ''}`;
  // Hiding a notice never clears an editor's write guard. New errors reset the dismissal.
  const visibleNotice = notice && dismissedNotice !== noticeKey;
  if (!notice && dismissedNotice !== null) setDismissedNotice(null);
  const openLibrary: WorkspaceChrome['openLibrary'] = (trigger, template, collection) => {
    if (templatesPage && !page.creators && page.templateCollection === (collection ?? null) && !template) return;
    libraryTrigger.current = trigger ?? null;
    workspace.clearError();
    const openCollection = Boolean(collection) || !template;
    cardPreview.current = !openCollection && template ? { template, locale } : null;
    navigatePage({ templates: openCollection, template: template?.id ?? null, templateCollection: openCollection ? (collection ?? null) : null, creators: false, creator: null, ...(page.templateCollection === 'black-friday' && { skill: null }) },
      false, collection === 'black-friday' && page.explore && !connectionsOpen ? 'from-page' : undefined);
  };
  const openMotionTemplates = (trigger?: HTMLElement) => {
    openLibrary(trigger);
    if (narrow) setSidebarOpen(false);
  };
  const value: WorkspaceChrome = { workspace, switchingDisabled, saveState: editorState?.saveState || saveState, registerEditor, beforeViewChange,
    openLibrary,
    openConnections: entry => {
      connectionEntry.current = entry;
      navigatePage({ settings: 'mcp', templates: false }, false, 'from-page');
    },
    openModelSettings: () => openSettings('providers'),
    openProviderSettings: provider => navigatePage({ settings: 'providers', provider, assets: false, skills: false, templates: false }),
    openAccountSettings: () => openSettings('account'),
    openSubscriptionSettings: () => openSettings('subscription'),
    openHome, openAssets, assetsOpen: assetsOpen && !settings && !templatesPage, openSkills, skillsOpen: skillsOpen && !settings, toggleSidebar, sidebarOpen, navigationCollapsed,
    projectNavigation: !hostChrome && editorActive ? <span className="motion-project-navigation-trigger" hidden={sidebarOpen && !narrow}>
      <WorkspaceProjectsButton applicationRef={applicationRef} expanded={sidebarOpen} previewEnabled={!narrow && !sidebarOpen} onToggle={toggleSidebar}>
        {close => <WorkspaceSidebar archives={archives} currentId={projectId} close={close} expand={() => { close(); toggleSidebar(); }} onNavigate={close} query={projectQuery} setQuery={setProjectQuery} openSettings={openSettings} openTemplates={openMotionTemplates} />}
      </WorkspaceProjectsButton>
    </span> : null,
    settingsOpen: Boolean(settings) || pageOpen };
  const openSkill = (skill: string) => {
    const specialty = creativeStudios.find((entry): entry is TechniqueStudio => entry.surface === 'techniques' && entry.techniques.some(id => id === skill));
    navigatePage({ ...(specialty ? { specialty } : { skills: true }), skill, templates: false, ...lastExplore.current });
  };
  const selectAssetRoute = useCallback((assetId: string | null, assetVersion: string | null) => {
    if (readWorkspacePage(location.search, location.hash, location.pathname).assets) navigatePage({ assetId, assetVersion });
  }, [navigatePage]);
  const openStudio = (studio: StudioDestination | null, seed?: string | AssetDraft, fromPage = false) => {
    // A brief started from a technique studio keeps its Skill so its draft stays separate from other studios' briefs.
    const skill = typeof seed === 'object' && (studio?.studio.surface === 'techniques' || (studio?.landing && page.specialty)) ? page.skill : null;
    if (studio && seed) {
      studioDrafts.current.set(studioDraftKey(studio, skill), typeof seed === 'string'
        ? { modality: studio.scene.modality, prompt: seed, references: [] }
        : seed);
      setStudioVisit(number => number + 1);
    }
    navigatePage({ studio, skill, settings: null, assets: false, skills: false, templates: false, ...lastExplore.current },
      false, fromPage ? 'from-page' : undefined);
  };
  const openStudioFromPage = (studio: StudioDestination, seed?: string | AssetDraft) => openStudio(studio, seed, true);
  const chooseStudio = (entry: CreativeStudio, kind?: Modality, fromPage = false) => {
    if (entry.surface === 'techniques') navigatePage({ specialty: entry, skill: null, templates: false, ...lastExplore.current });
    else if (entry.surface === 'editor') navigatePage({ motion: true, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
    else if (entry.id === 'design' && !kind) navigatePage({ designScene: defaultDesignScene, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
    else if (entry.id === 'cinema' && !kind) navigatePage({ cinemaLanding: true, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
    else if (!kind && hasStudioHome(entry)) openStudio({ ...studioDestination(entry, page.studio?.studio.id === entry.id ? page.studio.scene.id : null), home: true }, undefined, fromPage);
    else if (kind === 'audio') {
      const keepCurrent = page.studio?.studio.id === entry.id && page.studio.scene.modality === 'audio';
      const target = {
        ...studioDestination(entry, keepCurrent ? page.studio!.scene.id : scenesForStudio(entry).find(scene => scene.modality === 'audio')?.id, keepCurrent ? page.studio!.model : null),
        mediaTab: true as const,
      };
      navigatePage({ studio: target, soundTab: keepCurrent ? page.soundTab ?? null : null, skill: null, settings: null, assets: false, skills: false, templates: false, ...lastExplore.current },
        false, fromPage ? 'from-page' : undefined);
    } else if (page.studio?.studio.id === entry.id && (!kind || page.studio.scene.modality === kind)) {
      openStudio(studioDestination(entry, page.studio.scene.id, page.studio.model), undefined, fromPage);
    } else openStudio(studioDestination(entry, scenesForStudio(entry).find(scene => scene.modality === kind)?.id), undefined, fromPage);
  };
  const openAudioNav = (studio: StudioDestination, soundTab?: SoundTabId | null) => {
    navigatePage({ studio, soundTab: soundTab ?? null, skill: null, settings: null, assets: false, skills: false, templates: false, ...lastExplore.current });
  };
  const openModel = (modelOverview: string, fromPage = false) =>
    navigatePage({ modelOverview, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
  const openModelFromPage = (id: string) => openModel(id, true);
  const openModelHub = (modelHub: string) => navigatePage({ modelHub, templates: false, ...lastExplore.current }, false, 'from-page');
  const openScenarioHub = useCallback((fromPage = false) => {
    navigatePage({ scenarioHub: true, scenarioCategory: null, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
  }, [navigatePage]);
  const openScenario = useCallback((scenario: ScenarioId, runId?: string, fromPage = false) => {
    navigatePage({ scenario, scenarioRun: runId ?? null, scenarioStep: null, templates: false, ...lastExplore.current }, false, fromPage ? 'from-page' : undefined);
  }, [navigatePage]);
  const currentPage = templatesPage || page.explore || skillsOpen ? 'explore' : standaloneMcp ? 'mcp' : null;
  // Count arrivals to template and discovery pages. Media forms report their own scene views.
  const routeView = resolveRouteArrival(page, templatesPage);
  useEffect(() => {
    if (!routeView) return;
    const hasProject = Boolean(projectId);
    if (routeView === 'explore') reportCreativePageView('explore', hasProject, { community: page.community, medium: page.medium ?? 'all' });
    else if (routeView === 'motion' || routeView === 'design' || routeView === 'cinema') reportCreativePageView('creative_studio', hasProject, { studio: routeView, landing: true });
    else reportCreativePageView('model_overview', hasProject, { model: page.modelOverview });
    // Only an arrival counts; filter changes within Explore are reported as clicks.
  }, [routeView]);
  // Where the top navigation is shown, so its clicks segment by the page the user was on.
  const navTrackingPage = resolveNavTrackingPage(page, { templatesPage, standaloneMcp });
  const returnToExplore = () => {
    if (source && fromExplore && restoreWorkspaceSource(source)) return;
    const filters = page.motion || page.cinemaLanding || page.modelOverview || page.modelHub || page.specialty || page.scenarioHub || page.scenario || page.studio || page.skills
      ? { community: page.community, medium: page.medium } : lastExplore.current;
    navigatePage({ explore: true, templates: false, ...filters });
  };
  const closeSkills = () => {
    skillsReturnFocus.current = skillsTrigger.current;
    returnToExplore();
  };
  const openMcp = (client?: McpClient, example?: string, fromPage = false) => {
    connectionEntry.current = 'app_header';
    navigatePage({ settings: 'mcp', templates: false, mcpExample: example ?? null, ...(client && { client, setup: 'agent' }) },
      false, fromPage ? 'from-page' : undefined);
  };
  const openPage = (target: 'explore' | 'mcp', client?: McpClient, example?: string) => {
    if (target === 'explore') { openHome(); return; }
    openMcp(client, example);
  };
  const visibleSettings = templatesPage || standaloneMcp ? null : settings;
  const showStudioBackToExplore = page.studio?.scene.modality === 'image' && fromExplore && !sourcePage.community && !sourcePage.medium;
  const openTemplateFromOverlay = (id: string) => {
    if (!switchingDisabled) void (sessionId ? workspace.createArtifact(sessionId, id) : workspace.startSession(undefined, id));
  };
  const overlaySharedProps = {
    page,
    projectId,
    sessionId,
    locale,
    connectionsOpen,
    templatesPage,
    detailOnly,
    libraryBusy,
    switchingDisabled,
    workspaceError: workspace.error,
    cardPreview,
    libraryTrigger,
    collectionSkillTrigger,
    navigatePage,
    beforeViewChange,
    closeStandalonePreview,
    returnToExplore,
    openSkill,
    openScenario,
    openProject: (id: string) => workspace.open('projects', id),
    openTemplate: openTemplateFromOverlay,
  };
  return <WorkspaceChromeContext.Provider value={value}>
    <StudioToastViewport {...navigationToast} />
    <StudioConnectionToast reconnecting={reconnecting} />
    {archives.manager}
    <Dialog.Root open={sidebarOpen && narrow && editorActive} onOpenChange={setSidebarOpen}>
    <div ref={applicationRef} className="om-application" data-embedded={presentation.embedded} data-host-chrome={hostChrome} data-has-bf-banner={bfBannerVisible || undefined} data-navigation-collapsed={navigationCollapsed}>
      {bfBannerVisible && <BlackFridayTopBanner trackingPage={navTrackingPage} onClose={closeBfBanner} onExpire={expireBfBanner} />}
      <ApplicationHeader atExploreHome={page.explore && !page.community && !page.medium && !connectionsOpen}
        specialty={page.specialty} onChooseStudio={chooseStudio} openSettings={openSettings}
        openAsset={(assetId, assetVersion) => navigatePage({ assets: true, assetId, assetVersion, templates: false })}
        onCommunity={feed => navigatePage({ explore: true, community: feed.id, medium: null, templates: false })} onSkill={openSkill} currentPage={currentPage} trackingPage={navTrackingPage} onOpenPage={openPage} settings={visibleSettings} destination={templatesPage ? null : page.studio} soundTab={templatesPage ? null : page.soundTab ?? null} motionActive={!templatesPage && (page.motion || editorActive)}
        designActive={!templatesPage && Boolean(page.designScene)} cinemaActive={!templatesPage && page.cinemaLanding}
        scenarioActive={!templatesPage && !settings ? (page.scenario ?? (page.scenarioHub ? 'hub' : null)) : null}
        onOpenScenario={(id, runId) => openScenario(id, runId)}
        onOpenScenarioHub={() => openScenarioHub()}
        onNavigate={openStudio} onNavigateSound={openAudioNav} />
      <div className="motion-workspace">
      {isRoutePending && <div className="motion-route-progress" role="progressbar" aria-hidden="true" />}
      <Dialog.Portal>
        <Dialog.Backdrop className="hf-overlay-backdrop motion-sidebar-backdrop" />
        <Dialog.Popup id="om-project-navigation" className="motion-sidebar-drawer" aria-label={t('Project list')} onKeyDown={event => event.stopPropagation()}>
          <WorkspaceSidebar archives={archives} currentId={projectId} close={() => setSidebarOpen(false)} query={projectQuery} setQuery={setProjectQuery} openSettings={openSettings} openTemplates={openMotionTemplates} />
        </Dialog.Popup>
      </Dialog.Portal>
      {!narrow && editorRoute && <div id="om-project-navigation" className="om-project-navigation om-collapsible" data-collapsed={!sidebarOpen || navigationCollapsed} aria-hidden={!sidebarOpen || navigationCollapsed} inert={!sidebarOpen || navigationCollapsed}>
        <WorkspaceSidebar archives={archives} currentId={projectId} close={() => setSidebarOpen(false)} query={projectQuery} setQuery={setProjectQuery} openSettings={openSettings} openTemplates={openMotionTemplates} />
      </div>}
      <div className="motion-workspace-content" hidden={!editorRoute} aria-hidden={!editorRoute} inert={!editorRoute}>
        {visibleNotice && <ErrorNotice key={noticeKey} message={notice}
          onDismiss={() => { setDismissedNotice(noticeKey); if (workspaceNotice) workspace.clearError(); }} />}
        {children}
      </div>
      <RouteViewport
        page={page}
        projectId={projectId}
        source={source}
        fromExplore={Boolean(fromExplore)}
        hostChrome={hostChrome}
        templatesPage={templatesPage}
        connectionsOpen={connectionsOpen}
        lastExplore={lastExplore.current}
        motionEditorDisabled={motionEditorDisabled}
        motionTemplatesOpen={motionTemplatesOpen}
        standaloneMcp={standaloneMcp}
        visibleSettings={visibleSettings}
        showStudioBackToExplore={Boolean(showStudioBackToExplore)}
        selectedCinemaTemplate={selectedCinemaTemplate}
        connectionEntry={connectionEntry.current}
        studioVisit={studioVisit}
        studioDrafts={studioDrafts}
        skillBriefs={skillBriefs}
        libraryTrigger={libraryTrigger}
        openLibrary={value.openLibrary}
        openModelSettings={value.openModelSettings}
        openProviderSettings={value.openProviderSettings}
        navigatePage={navigatePage}
        openHome={openHome}
        openSettings={openSettings}
        closeSettings={closeSettings}
        openMcp={openMcp}
        openSkill={openSkill}
        closeSkills={closeSkills}
        openStudio={openStudio}
        openStudioFromPage={openStudioFromPage}
        chooseStudio={chooseStudio}
        openModelFromPage={openModelFromPage}
        openModelHub={openModelHub}
        openScenarioHub={openScenarioHub}
        openScenario={openScenario}
        openMotionEditor={openMotionEditor}
        openMotionProject={id => workspace.open('projects', id)}
        returnToExplore={returnToExplore}
        selectAssetRoute={selectAssetRoute}
      />
      <OverlayLayer {...overlaySharedProps} placement="in-workspace" />
      </div>
    </div>
    </Dialog.Root>
    <OverlayLayer {...overlaySharedProps} placement="portal" />
  </WorkspaceChromeContext.Provider>;
}

function WorkspaceSidebar({ archives, currentId, close, expand, query, setQuery, onNavigate, openSettings, openTemplates }: {
  archives: ProjectArchiveActions; currentId?: string; close: () => void; expand?: () => void; query: string; setQuery: (query: string) => void; onNavigate?: () => void;
  openSettings: (section: SettingsSection) => void;
  openTemplates: (trigger?: HTMLElement) => void;
}) {
  const { t } = useI18n();
  const { workspace, switchingDisabled } = useWorkspaceChrome();
  const projects = workspace.projects;
  const filtered = projects.filter(project => project.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const loadingProjects = !workspace.status && !workspace.error && projects.length === 0;
  return <aside className="motion-sidebar" aria-label={t('Workspace navigation')}>
    <div className="motion-sidebar-brand">
      <strong className="om-subtitle">{t('Workspace')}</strong>
      {/* Collapsing the docked navigation toggles it back with the workspace menu button, so this icon-only control keeps a state-aware tooltip in both states. */}
      <Tooltip label={t(expand ? 'Open project list' : 'Close project list')} wrap><IconButton variant="ghost" type="button" className="motion-icon-button" onClick={expand ?? close} aria-expanded={!expand} aria-controls="om-project-navigation" aria-label={t(expand ? 'Open project list' : 'Close project list')} icon={<MotionIcon name="sidebar" size={16} />} /></Tooltip>
    </div>
    <div className="motion-session-heading">
      <span>{t('Projects')}</span>
      <div className="motion-session-heading-actions">
        <Tooltip label={t(archives.busy === 'import' ? 'Importing…' : 'Import projects')}>
          <IconButton variant="ghost" type="button" className="motion-icon-button" disabled={archives.locked} onClick={archives.chooseImport} aria-label={t(archives.busy === 'import' ? 'Importing…' : 'Import projects')} icon={<RemixIcon name="upload-2-line" size={16} />} />
        </Tooltip>
        <Tooltip label={t('New project')}>
          <IconButton variant="ghost" type="button" className="motion-icon-button" aria-label={t('New project')} disabled={switchingDisabled} onClick={event => {
            void trackMotion('ui_click', { page_name: 'studio', area: 'workspace', element: 'new_creation', interaction_method: event.detail === 0 ? 'keyboard' : 'pointer' });
            void workspace.create();
            onNavigate?.();
          }} icon={<MotionIcon name="plus-thin" size={20} />} />
        </Tooltip>
      </div>
    </div>
    <label data-form-field="regular" className="motion-session-search"><MotionIcon name="search" /><FieldInput appearance="embedded" type="search" value={query} onChange={event => { if (searchStarted(query, event.target.value)) trackStudioClick('project_drawer', 'project_search', currentId); setQuery(event.target.value); }} placeholder={t('Search projects…')} aria-label={t('Search projects')} /></label>
    <nav className="motion-session-list" aria-label={t('Project list')} aria-busy={loadingProjects}>
      {loadingProjects && ['75%', '55%', '65%'].map(width => <div key={width} className="motion-session pointer-events-none" data-testid="project-list-skeleton" aria-hidden="true">
        <Skeleton style={{ width, height: 'var(--motion-space-16)' }} />
      </div>)}
      {workspace.status && !filtered.length && <p className="motion-session-empty">{t(query ? 'No matching projects' : 'Create a project with your Agent to start editing.')}</p>}
      {filtered.map(project => <DisclosureRow key={project.id} className="om-project-sidebar-row" active={currentId === project.id}
        action={<ProjectArchiveMenu projectId={project.id} title={project.title} archives={archives} />}>
        <Tooltip label={project.title} wrap><Button variant="plain" aria-label={project.title} className="motion-session om-disclosure-row-label" aria-current={currentId === project.id ? 'page' : undefined}
        disabled={switchingDisabled} onClick={event => {
          if (project.id === currentId) return;
          void trackMotion('ui_click', { page_name: 'studio', area: 'workspace', element: 'open_project', interaction_method: event.detail === 0 ? 'keyboard' : 'pointer' });
          void workspace.open('projects', project.id);
          onNavigate?.();
        }}>
        <span className="motion-session-dot" aria-hidden="true" /><span><strong>{project.title}</strong></span>
      </Button></Tooltip>
      </DisclosureRow>)}
    </nav>
    <div className="motion-sidebar-footer">
      <div className="motion-sidebar-footer-actions">
        <Button variant="plain" type="button" className="om-nav-item" onClick={event => { openTemplates(event.currentTarget); onNavigate?.(); }}><RemixIcon name="movie-line" size={18} />{t('Motion templates')}</Button>
        <Button variant="plain" className="om-nav-item" type="button" aria-expanded={archives.open} data-active={archives.open || undefined} onClick={archives.showManager}><RemixIcon name="folder-open-line" size={18} />{t('All projects')}</Button>
      </div>
      <WorkspaceUtilityActions openSettings={section => { close(); openSettings(section); }} />
    </div>
  </aside>;
}

export function WorkspaceMenuButton() {
  const { t } = useI18n();
  const { toggleSidebar, sidebarOpen, navigationCollapsed, workspace } = useWorkspaceChrome();
  const visible = sidebarOpen && !navigationCollapsed;
  // Collapsing the docked navigation is a toggle, not a dismiss, so the icon-only
  // control keeps its tooltip in both states like the app-sidebar toggle.
  return <Tooltip label={t(visible ? 'Collapse project list' : 'Open project list')} wrap><IconButton variant="plain" className="motion-icon-button motion-workspace-menu" onClick={event => { if (!visible) trackStudioClick('header', 'open_project_drawer', workspace.status?.projectId, clickMethod(event)); toggleSidebar(); }} aria-expanded={visible} aria-label={t(visible ? 'Collapse project list' : 'Open project list')} icon={<MotionIcon name="sidebar" size={16} />} /></Tooltip>;
}
