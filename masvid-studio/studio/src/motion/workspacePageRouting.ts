import { findTemplateCollection, type TemplateCollection } from './templateCollections';
import { skillCategories, type SkillCategory } from './skillCategories';
import { blackFridaySkillIds } from '../../../shared/black-friday-collection';
import { isDesignScenario, type DesignScenarioId } from '../../../shared/design-project';
import { editorProjectIdFromPath, isSpaRoutePath, spaPathnameToSearch } from '../../../shared/spa-routes';
import { workspacePageName } from '../../../shared/workspace-url';
import { isValidProjectId, parseProjectIdFromHash } from '../utils/projectRouting';
import { mcpClients, type McpClient } from './mcpClients';
import { exploreCommunities, findLandingScene, findMediaStudio, findTechniqueStudio, type ExploreCommunity, type TechniqueStudio, type StudioScene } from '../../../shared/studio-catalog';
import { findCinemaTemplate } from './cinemaTemplates';
import { hasStudioHome, isStudioTechnique, sceneDestination, studioDestination, type StudioDestination } from './creativeStudios';
import { findSoundTab, isExtendedSoundTab, type SoundTabId } from './soundTabs';
import { findScenario, findScenarioStep, scenarioCategories, type ScenarioCategory, type ScenarioId } from '../../../shared/scenarios';

const scenarioRunUuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

/** Query or semantic Design Studio image URLs parsed for compatibility and rewritten to `/create/:scene`. */
export function isLegacyWorkspaceHref(search: string, page: WorkspacePage, pathname = '') {
  const effectiveSearch = pathname && pathname !== '/' ? spaPathnameToSearch(pathname, search) : search;
  return new URLSearchParams(effectiveSearch).get('page') === 'design' && Boolean(page.studio?.landing);
}

/** Canonical application pages live in semantic pathnames; `#project/<id>` remains owned by the editor. */
export const settingsSections = ['account', 'subscription', 'providers', 'models', 'local', 'general', 'appearance', 'privacy', 'about', 'help', 'mcp', 'brand-kit'] as const;
export type SettingsSection = typeof settingsSections[number];
export type ExploreFilters = { community: ExploreCommunity['id'] | null; medium: StudioScene['modality'] | null };
export { findTemplateCollection, type TemplateCollection } from './templateCollections';
export const defaultDesignScene = 'prototype';
export type DesignSceneTarget = DesignScenarioId | 'projects';
export type ScenarioWorkspaceMode = 'manual' | 'agent';
export type WorkspacePage = ExploreFilters & { motion: boolean; cinemaLanding?: true; cinemaTemplate?: string | null; designScene?: DesignSceneTarget | null; designProject?: string | null; soundTab?: SoundTabId | null; specialty: TechniqueStudio | null; assetId: string | null; assetVersion: string | null; explore: boolean; scenarioHub: boolean; scenarioCategory: ScenarioCategory | null; scenario: ScenarioId | null; scenarioRun: string | null; scenarioStep: string | null; scenarioMode: ScenarioWorkspaceMode | null; studio: StudioDestination | null; settings: SettingsSection | null; assets: boolean; skills: boolean; skillCategory: SkillCategory | null; skill: string | null; templates: boolean; templateCollection: TemplateCollection | null; modelOverview: string | null; modelHub: string | null; creators: boolean; creator: string | null; mcpInSettings: boolean; mcpExample?: string | null; client: McpClient; setup: 'agent' | 'manual'; provider: string | null; template: string | null; brandKit: string | null };

export function changesWorkspaceDestination(patch: Partial<WorkspacePage>): boolean {
  return ['explore', 'motion', 'cinemaLanding', 'designScene', 'scenario', 'scenarioHub', 'studio', 'modelOverview', 'modelHub', 'specialty', 'assets', 'skills', 'settings'].some(key => key in patch);
}

export function readWorkspacePage(search: string, hash = '', pathname = ''): WorkspacePage {
  const effectiveSearch = pathname && pathname !== '/' ? spaPathnameToSearch(pathname, search) : search;
  const query = new URLSearchParams(effectiveSearch), page = workspacePageName(query, hash), section = query.get('section');
  const settings = page === 'brand-kit' ? 'brand-kit' : page === 'mcp' ? 'mcp' : page === 'settings'
    ? settingsSections.find(value => value === section) ?? 'general' : null;
  const sceneId = query.get('scene'), model = query.get('model') || null;
  const rawDesignProject = page === 'design' ? query.get('designProject') || null : null;
  const isDesignHtmlScene = page === 'design' && (!sceneId || isDesignScenario(sceneId) || sceneId === 'projects' || Boolean(rawDesignProject));
  const designScene: DesignSceneTarget | null = !isDesignHtmlScene ? null
    : isDesignScenario(sceneId) ? sceneId : sceneId === 'projects' || rawDesignProject ? 'projects' : defaultDesignScene;
  const designProject = isDesignHtmlScene ? rawDesignProject : null;
  const matchedScenario = page === 'scenario' ? findScenario(query.get('scenario')) : undefined;
  const scenario: ScenarioId | null = matchedScenario?.id ?? null;
  const scenarioHub = page === 'scenarios' || (page === 'scenario' && !matchedScenario);
  const scenarioCategory: ScenarioCategory | null = scenarioHub
    ? scenarioCategories.find(item => item.id === query.get('category'))?.id ?? null : null;
  const rawRun = matchedScenario ? query.get('run') : null;
  const scenarioRun = rawRun && scenarioRunUuidPattern.test(rawRun) ? rawRun : null;
  const scenarioStep = matchedScenario ? findScenarioStep(matchedScenario, query.get('step'))?.id ?? null : null;
  const rawMode = matchedScenario ? query.get('mode') : null;
  const scenarioMode: ScenarioWorkspaceMode | null =
    rawMode === 'agent' || rawMode === 'manual' ? rawMode : null;
  const cinemaLanding = page === 'cinema' && !sceneId && !model;
  const template = page === 'cinema' || page === 'create' ? findCinemaTemplate(query.get('cinemaTemplate')) : undefined;
  const cinemaTemplate = template && template.scene === sceneId ? template.id : undefined;
  const isAudioTab = page === 'audio';
  const extendedSoundTab = (page === 'sound' || isAudioTab) && isExtendedSoundTab(sceneId) ? findSoundTab(sceneId) : undefined;
  const collection = findTechniqueStudio(page);
  const studioKind = collection?.scenes.some(id => id === sceneId) ? collection
    : isDesignHtmlScene || cinemaLanding ? undefined : findMediaStudio(isAudioTab ? 'sound' : page);
  // Bookmarked Design Studio image links open the unified Image editor; HTML design scenarios keep their own page.
  const legacyDesignImage = page === 'design' && !isDesignHtmlScene
    ? findMediaStudio('design')!.scenes.map(id => findLandingScene(id)!).find(scene => scene.id === sceneId) ?? findLandingScene('text-to-image')
    : undefined;
  const landing = page === 'create' ? findLandingScene(sceneId) : legacyDesignImage;
  const home = Boolean(!landing && !isAudioTab && studioKind && hasStudioHome(studioKind) && query.get('home') === '1');
  const studio = landing ? sceneDestination(landing, null, model)
    : studioKind ? { ...studioDestination(studioKind, extendedSoundTab?.backingScene ?? sceneId, model), ...(home ? { home: true as const } : {}), ...(isAudioTab ? { mediaTab: true as const } : {}) } : null;
  const specialty = studio ? null : collection ?? null;
  const community = exploreCommunities.find(item => item.id === query.get('community'))?.id ?? null;
  const medium = (['image', 'video', 'audio'] as const).find(value => value === query.get('medium')) ?? null;
  const skill = query.get('skill') || null;
  const templates = query.get('templates') === '1';
  const creators = templates && query.get('view') === 'creators';
  const templateCollection = templates && !creators ? findTemplateCollection(query.get('collection')) : null;
  const selectedSkill = templateCollection === 'black-friday' ? blackFridaySkillIds.find(id => id === skill) ?? null
    : page === 'skills' || collection?.techniques.some(id => id === skill) || (landing && isStudioTechnique(skill)) ? skill : null;
  return { motion: page === 'motion', ...(cinemaLanding && { cinemaLanding: true }), ...(cinemaTemplate && { cinemaTemplate }),
    ...(designScene ? { designScene } : {}), ...(designProject ? { designProject } : {}), ...(extendedSoundTab ? { soundTab: extendedSoundTab.id } : {}),
    modelOverview: page === 'model' ? model : null, modelHub: page === 'model-hub' ? query.get('hub') || null : null, creators, creator: creators ? query.get('creator')?.trim() || null : null, specialty, community, medium, assetId: page === 'assets' ? query.get('asset') || null : null,
    assetVersion: page === 'assets' && query.get('asset') ? query.get('version') || null : null, explore: page === 'explore', scenarioHub, scenarioCategory, scenario, scenarioRun, scenarioStep, scenarioMode, studio, settings, brandKit: settings === 'brand-kit' ? query.get('kit') || null : null, assets: page === 'assets', skills: page === 'skills', skillCategory: page === 'skills' ? skillCategories.find(value => value === (query.get('category') ?? query.get('skillCategory'))) ?? null : null, skill: selectedSkill, templates, templateCollection,
    mcpInSettings: page === 'settings' && settings === 'mcp',
    mcpExample: settings === 'mcp' ? query.get('example') : null,
    client: mcpClients.find(value => value.id === query.get('host'))?.id ?? 'codex',
    setup: query.get('setup') === 'manual' ? 'manual' : 'agent',
    provider: settings === 'providers' ? query.get('provider') || null : null,
    template: query.get('template') || null };
}

export function workspacePageHref(href: string, patch: Partial<WorkspacePage>): string {
  const url = new URL(href), current = readWorkspacePage(url.search, url.hash, url.pathname), page = { ...current, ...patch };
  const originalPathname = url.pathname;
  const pathProject = editorProjectIdFromPath(originalPathname);
  const rawRetainedProject = pathProject ?? url.searchParams.get('project') ?? parseProjectIdFromHash(url.hash);
  const retainedProject = rawRetainedProject && isValidProjectId(rawRetainedProject) ? rawRetainedProject : null;
  const isSpaRoute = originalPathname !== '/' && isSpaRoutePath(originalPathname);
  const currentSearchPage = new URLSearchParams(
    isSpaRoute ? spaPathnameToSearch(originalPathname, url.search) : url.search,
  ).get('page');
  if (isSpaRoute) url.pathname = '/';
  for (const key of ['page', 'home', 'section', 'templates', 'host', 'setup', 'provider', 'template', 'skill', 'skillCategory', 'kit', 'community', 'medium', 'collection', 'hub', 'designProject', 'cinemaTemplate', 'scenario', 'run', 'step', 'mode', 'category']) url.searchParams.delete(key);
  if (current.settings === 'mcp' || page.settings === 'mcp') url.searchParams.delete('example');
  if (currentSearchPage === 'api') url.searchParams.delete('tool');
  if (current.creators || page.creators) { url.searchParams.delete('view'); url.searchParams.delete('creator'); }
  if (current.assets || page.assets) { url.searchParams.delete('asset'); url.searchParams.delete('version'); }
  if (current.studio || current.specialty || current.designScene || page.studio || page.designScene || currentSearchPage === 'create' || currentSearchPage === 'model') {
    url.searchParams.delete('scene');
    url.searchParams.delete('model');
  }
  // A primary destination replaces its peers. Overlay and detail patches retain their parent.
  if (changesWorkspaceDestination(patch)) {
    page.motion = Boolean(patch.motion);
    page.cinemaLanding = patch.cinemaLanding;
    page.cinemaTemplate = patch.cinemaTemplate ?? null;
    page.designScene = patch.designScene ?? null;
    page.designProject = patch.designScene ? (patch.designProject ?? null) : null;
    page.explore = Boolean(patch.explore);
    page.scenarioHub = Boolean(patch.scenarioHub);
    page.scenarioCategory = patch.scenarioHub ? (patch.scenarioCategory ?? null) : null;
    page.scenario = patch.scenario ?? null;
    page.scenarioRun = patch.scenario ? (patch.scenarioRun ?? null) : null;
    page.scenarioStep = patch.scenario ? (patch.scenarioStep ?? null) : null;
    page.scenarioMode = patch.scenario ? (patch.scenarioMode ?? null) : null;
    page.studio = patch.studio ?? null;
    page.soundTab = patch.studio?.studio.id === 'sound' && !patch.studio.landing && isExtendedSoundTab(patch.soundTab) ? patch.soundTab : null;
    page.modelOverview = patch.modelOverview ?? null;
    page.modelHub = patch.modelHub ?? null;
    page.specialty = patch.specialty ?? null;
    page.assets = Boolean(patch.assets);
    page.skills = Boolean(patch.skills);
    page.settings = patch.settings ?? null;
    page.mcpInSettings = page.settings === 'mcp' && Boolean(patch.mcpInSettings);
  } else if ('soundTab' in patch) {
    page.soundTab = page.studio?.studio.id === 'sound' && !page.studio.landing && isExtendedSoundTab(patch.soundTab) ? patch.soundTab : null;
  }
  if (current.specialty?.id === 'game' && page.specialty?.id !== 'game') url.searchParams.delete('game');
  const inSettings = Boolean(page.settings) && page.settings !== 'brand-kit' && (page.settings !== 'mcp' || page.mcpInSettings);
  if (!inSettings) url.searchParams.delete('entry_from');
  if (page.explore) {
    url.pathname = '/explore';
  } else if (page.motion) {
    url.pathname = '/motion';
  } else if (page.cinemaLanding) {
    url.pathname = '/cinema';
  } else if (page.designScene) {
    if (page.designProject) {
      url.pathname = `/design/projects/${encodeURIComponent(page.designProject)}`;
      if (page.designScene !== 'projects') url.searchParams.set('scene', page.designScene);
    } else {
      url.pathname = `/design/${encodeURIComponent(page.designScene)}`;
    }
  } else if (page.modelOverview) {
    url.pathname = `/models/${encodeURIComponent(page.modelOverview)}`;
  } else if (page.modelHub) {
    url.pathname = `/model-hub/${encodeURIComponent(page.modelHub)}`;
  } else if (page.specialty) {
    url.pathname = `/studios/${encodeURIComponent(page.specialty.id)}`;
    if (page.specialty.techniques.some(id => id === page.skill)) url.searchParams.set('skill', page.skill!);
  } else if (page.scenario) {
    const matched = findScenario(page.scenario);
    if (matched) {
      url.pathname = `/scenarios/${encodeURIComponent(matched.id)}`;
      if (page.scenarioRun && scenarioRunUuidPattern.test(page.scenarioRun)) url.searchParams.set('run', page.scenarioRun);
      if (page.scenarioStep && findScenarioStep(matched, page.scenarioStep)) url.searchParams.set('step', page.scenarioStep);
      if (page.scenarioMode === 'agent') url.searchParams.set('mode', 'agent');
    } else {
      url.pathname = '/scenarios';
    }
  } else if (page.scenarioHub) {
    url.pathname = '/scenarios';
    if (page.scenarioCategory) url.searchParams.set('category', page.scenarioCategory);
  } else if (page.studio) {
    const soundSegment = page.studio.studio.id === 'sound' && !page.studio.landing && !page.studio.home && page.soundTab
      ? page.soundTab
      : page.studio.scene.id;
    if (page.studio.landing) {
      url.pathname = `/create/${encodeURIComponent(page.studio.scene.id)}`;
    } else if (page.studio.mediaTab) {
      url.pathname = `/${encodeURIComponent(page.studio.scene.modality)}/${encodeURIComponent(soundSegment)}`;
    } else if (page.studio.studio.id === 'sound') {
      url.pathname = page.studio.home ? '/sound' : `/sound/${encodeURIComponent(soundSegment)}`;
    } else if (page.studio.studio.id === 'cinema') {
      url.pathname = `/cinema/${encodeURIComponent(page.studio.scene.id)}`;
    } else if (page.studio.studio.surface === 'techniques') {
      url.pathname = `/studios/${encodeURIComponent(page.studio.studio.id)}/${encodeURIComponent(page.studio.scene.id)}`;
    } else {
      url.pathname = `/${encodeURIComponent(page.studio.studio.id)}/${encodeURIComponent(page.studio.scene.id)}`;
    }
    if (page.studio.studio.surface === 'techniques' ? page.studio.studio.techniques.some(id => id === page.skill) : page.studio.landing && isStudioTechnique(page.skill)) url.searchParams.set('skill', page.skill!);
    if (page.studio.model) url.searchParams.set('model', page.studio.model);
    if (findCinemaTemplate(page.cinemaTemplate)?.scene === page.studio.scene.id && (page.studio.landing || page.studio.studio.id === 'cinema')) url.searchParams.set('cinemaTemplate', page.cinemaTemplate!);
  } else if (page.skills) {
    url.pathname = page.skill ? `/skills/${encodeURIComponent(page.skill)}` : '/skills';
    if (page.skillCategory) url.searchParams.set('category', page.skillCategory);
  } else if (page.assets) {
    url.pathname = page.assetId ? `/assets/${encodeURIComponent(page.assetId)}` : '/assets';
    if (page.assetId && page.assetVersion) url.searchParams.set('version', page.assetVersion);
  } else if (page.settings === 'brand-kit') {
    url.pathname = page.brandKit ? `/brand-kit/${encodeURIComponent(page.brandKit)}` : '/brand-kit';
  } else if (page.settings === 'mcp') {
    url.pathname = page.mcpInSettings ? '/settings/mcp' : '/mcp-setup';
    url.searchParams.set('host', page.client);
    if (page.mcpExample) url.searchParams.set('example', page.mcpExample);
    if (page.setup === 'manual') url.searchParams.set('setup', 'manual');
  } else if (page.settings) {
    url.pathname = `/settings/${encodeURIComponent(page.settings)}`;
    if (page.settings === 'providers' && page.provider) url.searchParams.set('provider', page.provider);
  } else if (retainedProject) {
    const encodedProject = encodeURIComponent(retainedProject);
    url.pathname = `/editor/${encodedProject}`;
    url.searchParams.delete('project');
    if (!url.hash.startsWith('#project/')) url.hash = `project/${encodedProject}`;
  } else if (!page.templates) {
    url.pathname = '/editor';
  }
  if (pathProject && isValidProjectId(pathProject) && !url.pathname.startsWith('/editor') && !url.searchParams.has('project') && !parseProjectIdFromHash(url.hash)) {
    url.searchParams.set('project', pathProject);
  }
  if (page.explore || page.motion || page.cinemaLanding || page.modelOverview || page.modelHub || page.specialty || page.scenarioHub || page.scenario || page.studio || page.skills) {
    if (page.community) url.searchParams.set('community', page.community);
    if (page.medium) url.searchParams.set('medium', page.medium);
  }
  if (page.templates) {
    url.searchParams.set('templates', '1');
    if (page.creators) {
      url.searchParams.set('view', 'creators');
      if (page.creator) url.searchParams.set('creator', page.creator);
    } else if (page.templateCollection) {
      url.searchParams.set('collection', page.templateCollection);
      if (page.templateCollection === 'black-friday' && page.skill) url.searchParams.set('skill', page.skill);
    }
  }
  // Closing a collection or switching destinations also dismisses its current detail.
  const template = patch.templates === false ? patch.template : page.template;
  if (template) url.searchParams.set('template', template);
  return url.pathname + url.search + url.hash;
}
