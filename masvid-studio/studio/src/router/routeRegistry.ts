import type { CreativePage } from '../motion/exploreTracking';
import type { WorkspacePage } from '../motion/workspacePageRouting';

export type WorkspaceRouteId =
  | 'templates'
  | 'explore'
  | 'mcp'
  | 'brand-kit'
  | 'settings'
  | 'model-overview'
  | 'model-hub'
  | 'studio'
  | 'motion'
  | 'cinema'
  | 'design'
  | 'scenarios'
  | 'scenario'
  | 'game'
  | 'skills'
  | 'assets'
  | 'editor';

export type WorkspaceRouteMatchContext = {
  templatesPage: boolean;
  standaloneMcp: boolean;
};

export type WorkspaceRouteDefinition = {
  id: WorkspaceRouteId;
  /** Keep mounted once visited (hidden + inert while inactive) so edits/scroll persist. */
  keepAlive: boolean;
  /** Standalone surfaces do not require a local native project session to render. */
  standalone: boolean;
  trackingPage: CreativePage;
  matches: (page: WorkspacePage, context: WorkspaceRouteMatchContext) => boolean;
};

/**
 * Declarative workspace route table ordered by match precedence.
 * Phase 2 keeps existing query-driven URLs intact while decoupling route metadata
 * and lazy surface ownership from WorkspaceFrame.
 */
export const workspaceRouteRegistry: readonly WorkspaceRouteDefinition[] = [
  {
    id: 'templates',
    keepAlive: false,
    standalone: true,
    trackingPage: 'studio',
    matches: (_page, { templatesPage }) => templatesPage,
  },
  {
    id: 'explore',
    keepAlive: true,
    standalone: true,
    trackingPage: 'explore',
    matches: page => page.explore,
  },
  {
    id: 'mcp',
    keepAlive: false,
    standalone: true,
    trackingPage: 'mcp',
    matches: (_page, { standaloneMcp }) => standaloneMcp,
  },
  {
    id: 'brand-kit',
    keepAlive: false,
    standalone: true,
    trackingPage: 'brand_kit',
    matches: page => page.settings === 'brand-kit',
  },
  {
    id: 'settings',
    keepAlive: false,
    standalone: true,
    trackingPage: 'settings',
    matches: page => Boolean(page.settings),
  },
  {
    id: 'model-overview',
    keepAlive: false,
    standalone: true,
    trackingPage: 'model_overview',
    matches: page => Boolean(page.modelOverview),
  },
  {
    id: 'model-hub',
    keepAlive: false,
    standalone: true,
    trackingPage: 'model_hub',
    matches: page => Boolean(page.modelHub),
  },
  {
    id: 'studio',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => Boolean(page.studio),
  },
  {
    id: 'motion',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => page.motion,
  },
  {
    id: 'cinema',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => Boolean(page.cinemaLanding),
  },
  {
    id: 'design',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => Boolean(page.designScene),
  },
  {
    id: 'scenarios',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => page.scenarioHub,
  },
  {
    id: 'scenario',
    keepAlive: false,
    standalone: true,
    trackingPage: 'creative_studio',
    matches: page => Boolean(page.scenario),
  },
  {
    id: 'game',
    keepAlive: false,
    standalone: true,
    trackingPage: 'skills',
    matches: page => page.specialty?.id === 'game' && !page.skills,
  },
  {
    id: 'skills',
    keepAlive: false,
    standalone: true,
    trackingPage: 'skills',
    matches: page => page.skills || Boolean(page.specialty),
  },
  {
    id: 'assets',
    keepAlive: true,
    standalone: true,
    trackingPage: 'assets',
    matches: page => page.assets,
  },
  {
    id: 'editor',
    keepAlive: true,
    standalone: false,
    trackingPage: 'studio',
    matches: () => true,
  },
];

export function getRouteDefinition(id: WorkspaceRouteId): WorkspaceRouteDefinition {
  const found = workspaceRouteRegistry.find(route => route.id === id);
  if (!found) throw new Error(`Unknown workspace route id: ${id}`);
  return found;
}

export const KEEP_ALIVE_ROUTE_IDS: readonly WorkspaceRouteId[] = workspaceRouteRegistry
  .filter(route => route.keepAlive)
  .map(route => route.id);

export function isKeepAliveRoute(id: WorkspaceRouteId): boolean {
  return getRouteDefinition(id).keepAlive;
}

export function resolveActiveWorkspaceRoute(
  page: WorkspacePage,
  context: WorkspaceRouteMatchContext,
): WorkspaceRouteDefinition {
  return workspaceRouteRegistry.find(route => route.matches(page, context))
    ?? workspaceRouteRegistry[workspaceRouteRegistry.length - 1]!;
}

export function resolveNavTrackingPage(
  page: WorkspacePage,
  context: WorkspaceRouteMatchContext,
): CreativePage {
  return resolveActiveWorkspaceRoute(page, context).trackingPage;
}

export function isWorkspacePageOpen(page: WorkspacePage, templatesPage: boolean): boolean {
  return templatesPage
    || page.motion
    || Boolean(page.cinemaLanding)
    || Boolean(page.designScene)
    || Boolean(page.modelOverview)
    || Boolean(page.modelHub)
    || Boolean(page.specialty)
    || page.explore
    || page.scenarioHub
    || Boolean(page.scenario)
    || page.assets
    || page.skills
    || Boolean(page.studio);
}

/** Count arrivals to template and discovery pages. Media forms report their own scene views. */
export function resolveRouteArrival(page: WorkspacePage, templatesPage: boolean): string | null {
  if (templatesPage) return null;
  if (page.explore) return 'explore';
  if (page.motion) return 'motion';
  if (page.designScene && page.designScene !== 'projects' && !page.designProject) return 'design';
  if (page.cinemaLanding) return 'cinema';
  if (page.modelOverview) return 'model:' + page.modelOverview;
  return null;
}
