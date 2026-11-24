import type { ComponentType } from 'react';
import { lazyWithChunkReload } from '../utils/chunkReload';

/**
 * Canonical source paths (relative to `studio/src/`) for lazy-loaded workspace
 * surfaces and overlays. Shared with `shellBoundary.test.ts` so the static
 * shell boundary guard stays aligned with the lazy route registry.
 */
export const LAZY_PAGE_MODULE_PATHS = [
  'motion/ExploreStudios.tsx',
  'motion/MotionStudioPage.tsx',
  'motion/CinemaStudioPage.tsx',
  'motion/CreativeWorkspace.tsx',
  'design/scenes/DesignScenePage.tsx',
  'design/DesignProjectEditor.tsx',
  'scenario/ScenarioHub.tsx',
  'scenario/ScenarioWorkspace.tsx',
  'motion/game/GameStudio.tsx',
  'motion/AssetsPage.tsx',
  'motion/SkillsPage.tsx',
  'motion/ModelOverview.tsx',
  'motion/ModelHub.tsx',
  'motion/SettingsCenter.tsx',
  'motion/McpConnectionPage.tsx',
  'motion/BrandKitPage.tsx',
  'motion/ConnectionDialog.tsx',
] as const;

export type LazyPageKey =
  | 'explore'
  | 'motion'
  | 'cinema'
  | 'creative'
  | 'design'
  | 'designEditor'
  | 'scenarioHub'
  | 'scenario'
  | 'game'
  | 'assets'
  | 'skills'
  | 'modelOverview'
  | 'modelHub'
  | 'settings'
  | 'mcp'
  | 'brandKit'
  | 'connectionDialog';

const preloaders = new Map<LazyPageKey, () => Promise<unknown>>();

function shouldSkipPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return Boolean(connection?.saveData);
}

function lazyPage<T extends ComponentType<any>>(key: LazyPageKey, importer: () => Promise<{ default: T }>) {
  let pending: Promise<{ default: T }> | null = null;
  const load = () => {
    if (!pending) {
      pending = importer().catch(error => {
        pending = null;
        throw error;
      });
    }
    return pending;
  };
  preloaders.set(key, load);
  return lazyWithChunkReload(load);
}

/** Warm a single lazy page chunk on user navigation intent (hover / focus). */
export function preloadWorkspacePage(key: LazyPageKey): void {
  if (shouldSkipPrefetch()) return;
  const load = preloaders.get(key);
  if (!load) return;
  void load().catch(() => {});
}

/** Map a top-bar studio or navigation id to its lazy chunk(s) and warm them. */
export function preloadStudioRoute(target: string): void {
  if (target === 'explore') { preloadWorkspacePage('explore'); return; }
  if (target === 'design') { preloadWorkspacePage('design'); return; }
  if (target === 'motion') { preloadWorkspacePage('motion'); return; }
  if (target === 'cinema') { preloadWorkspacePage('cinema'); return; }
  if (target === 'game') { preloadWorkspacePage('game'); return; }
  if (target === 'workflows') { preloadWorkspacePage('scenarioHub'); preloadWorkspacePage('scenario'); return; }
  if (target === 'mcp') { preloadWorkspacePage('mcp'); return; }
  if (target === 'assets') { preloadWorkspacePage('assets'); return; }
  if (target === 'brand-kit') { preloadWorkspacePage('brandKit'); return; }
  if (target === 'settings') { preloadWorkspacePage('settings'); return; }
  if (target === 'skills') { preloadWorkspacePage('skills'); return; }
  preloadWorkspacePage('creative');
}

/** Preload all lazy workspace page chunks (used by tests to avoid transform-time suspense races). */
export function preloadAllWorkspacePages(): Promise<unknown[]> {
  return Promise.all(Array.from(preloaders.values(), load => load()));
}

export const LazyExploreStudios = lazyPage('explore', () =>
  import('../motion/ExploreStudios').then(module => ({ default: module.ExploreStudios })),
);

export const LazyMotionStudioPage = lazyPage('motion', () =>
  import('../motion/MotionStudioPage').then(module => ({ default: module.MotionStudioPage })),
);

export const LazyCinemaStudioPage = lazyPage('cinema', () =>
  import('../motion/CinemaStudioPage').then(module => ({ default: module.CinemaStudioPage })),
);

export const LazyCreativeWorkspace = lazyPage('creative', () =>
  import('../motion/CreativeWorkspace').then(module => ({ default: module.CreativeWorkspace })),
);

export const LazyDesignScenePage = lazyPage('design', () =>
  import('../design/scenes/DesignScenePage').then(module => ({ default: module.DesignScenePage })),
);

export const LazyDesignProjectEditor = lazyPage('designEditor', () =>
  import('../design/DesignProjectEditor').then(module => ({ default: module.DesignProjectEditor })),
);

export const LazyScenarioHub = lazyPage('scenarioHub', () =>
  import('../scenario/ScenarioHub').then(module => ({ default: module.ScenarioHub })),
);

export const LazyScenarioWorkspace = lazyPage('scenario', () =>
  import('../scenario/ScenarioWorkspace').then(module => ({ default: module.ScenarioWorkspace })),
);

export const LazyGameStudio = lazyPage('game', () =>
  import('../motion/game/GameStudio').then(module => ({ default: module.GameStudio })),
);

export const LazyAssetsPage = lazyPage('assets', () =>
  import('../motion/AssetsPage').then(module => ({ default: module.AssetsPage })),
);

export const LazySkillsPage = lazyPage('skills', () =>
  import('../motion/SkillsPage').then(module => ({ default: module.SkillsPage })),
);

export const LazyModelOverview = lazyPage('modelOverview', () =>
  import('../motion/ModelOverview').then(module => ({ default: module.ModelOverview })),
);

export const LazyModelHub = lazyPage('modelHub', () =>
  import('../motion/ModelHub').then(module => ({ default: module.ModelHub })),
);

export const LazySettingsCenter = lazyPage('settings', () =>
  import('../motion/SettingsCenter').then(module => ({ default: module.SettingsCenter })),
);

export const LazyMcpConnectionPage = lazyPage('mcp', () =>
  import('../motion/McpConnectionPage').then(module => ({ default: module.McpConnectionPage })),
);

export const LazyBrandKitPage = lazyPage('brandKit', () =>
  import('../motion/BrandKitPage').then(module => ({ default: module.BrandKitPage })),
);

export const LazyConnectionDialog = lazyPage('connectionDialog', () =>
  import('../motion/ConnectionDialog').then(module => ({ default: module.ConnectionDialog })),
);
