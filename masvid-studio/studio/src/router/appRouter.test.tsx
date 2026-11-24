// @vitest-environment happy-dom
import { StrictMode, act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { RouterProvider, useLocation, useMatches, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StudioRouterProvider,
  createAppRouter,
  type AppRouteHandle,
} from './createAppRouter';
import { resolveLegacyQueryRedirect } from './LegacyQueryRedirect';
import { KeepAliveSlot, useKeepAliveVisited } from './KeepAliveOutlet';
import { useWorkspaceBlocker } from './useWorkspaceBlocker';
import type { WorkspaceRouteId } from './routeRegistry';
import {
  navigateWorkspaceHistory,
  readLocationWorkspaceSource,
  registerWorkspaceHistoryBridge,
  restoreWorkspaceSource,
  workspaceHistoryIndex,
  writeWorkspaceHistory,
} from '../utils/workspaceHistory';
import { I18nProvider, ensureLocaleLoaded } from '../i18n/I18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, '', '/');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('createAppRouter semantic route handles', () => {
  const cases: readonly [string, WorkspaceRouteId, boolean, boolean][] = [
    ['/explore', 'explore', true, true],
    ['/explore/product-films', 'explore', true, true],
    ['/create/text-to-image', 'studio', false, true],
    ['/motion', 'motion', false, true],
    ['/cinema', 'cinema', false, true],
    ['/cinema/text-to-video', 'studio', false, true],
    ['/design', 'design', false, true],
    ['/design/prototype', 'design', false, true],
    ['/design/projects/design-1', 'design', false, true],
    ['/sound', 'studio', false, true],
    ['/sound/speech', 'studio', false, true],
    ['/audio', 'studio', false, true],
    ['/audio/sfx', 'studio', false, true],
    ['/studios/game', 'game', false, true],
    ['/studios/3d', 'skills', false, true],
    ['/studios/3d/text-to-video', 'studio', false, true],
    ['/scenarios', 'scenarios', false, true],
    ['/scenarios/launch-video', 'scenario', false, true],
    ['/game', 'game', false, true],
    ['/skills', 'skills', false, true],
    ['/skills/editorial-poster', 'skills', false, true],
    ['/models/veo-3', 'model-overview', false, true],
    ['/models/fal:fal-ai/suno/v4', 'model-overview', false, true],
    ['/model-hub/gemini-4', 'model-hub', false, true],
    ['/models/hub/gemini-4', 'model-hub', false, true],
    ['/assets', 'assets', true, true],
    ['/assets/asset-1', 'assets', true, true],
    ['/brand-kit', 'brand-kit', false, true],
    ['/brand-kit/mine', 'brand-kit', false, true],
    ['/settings', 'settings', false, true],
    ['/settings/providers', 'settings', false, true],
    ['/mcp-setup', 'mcp', false, true],
    ['/mcp-setup/claude', 'mcp', false, true],
    ['/templates', 'templates', false, true],
    ['/editor', 'editor', true, false],
    ['/editor/proj-123', 'editor', true, false],
  ];

  it.each(cases)(
    'matches %s with handle id=%s keepAlive=%s standalone=%s',
    async (pathname, expectedId, expectedKeepAlive, expectedStandalone) => {
      let leafHandle: AppRouteHandle | undefined;
      function Inspector() {
        const matches = useMatches();
        leafHandle = matches.at(-1)?.handle as AppRouteHandle | undefined;
        return null;
      }

      const router = createAppRouter(<Inspector />, {
        memory: true,
        initialEntries: [pathname],
      });
      try {
        await act(async () => root.render(<RouterProvider router={router} />));
        expect(leafHandle).toMatchObject({
          id: expectedId,
          keepAlive: expectedKeepAlive,
          standalone: expectedStandalone,
        });
      } finally {
        router.dispose();
      }
    },
  );
});

describe('KeepAliveSlot and useKeepAliveVisited', () => {
  it('retains keepAlive routes with hidden/inert while unmounting non-keepAlive routes, and does not eagerly mount explore on root editor URL', async () => {
    let setActive!: (id: WorkspaceRouteId) => void;
    function Harness() {
      const [activeId, setActiveId] = useState<WorkspaceRouteId>('editor');
      setActive = setActiveId;
      const visited = useKeepAliveVisited(activeId);
      return (
        <>
          <KeepAliveSlot routeId="explore" active={activeId === 'explore'} visited={visited} className="slot-explore">
            <input aria-label="Explore filter" defaultValue="initial" />
          </KeepAliveSlot>
          <KeepAliveSlot routeId="assets" active={activeId === 'assets'} visited={visited} className="slot-assets">
            <input aria-label="Assets filter" defaultValue="initial" />
          </KeepAliveSlot>
          <KeepAliveSlot routeId="settings" active={activeId === 'settings'} visited={visited} className="slot-settings">
            <input aria-label="Settings input" defaultValue="initial" />
          </KeepAliveSlot>
        </>
      );
    }

    await act(async () =>
      root.render(
        <StudioRouterProvider memory initialEntries={['/editor/first#project/first']}>
          <Harness />
        </StudioRouterProvider>,
      ),
    );

    // Cold-loading editor at `/` must not eagerly mount Explore or Assets.
    expect(container.querySelector('.slot-explore')).toBeNull();
    expect(container.querySelector('.slot-assets')).toBeNull();
    expect(container.querySelector('.slot-settings')).toBeNull();

    // Visit Explore and type into it.
    await act(async () => setActive('explore'));
    const exploreSlot = container.querySelector<HTMLElement>('.slot-explore')!;
    expect(exploreSlot.hidden).toBe(false);
    const exploreInput = container.querySelector<HTMLInputElement>('[aria-label="Explore filter"]')!;
    exploreInput.value = 'kept-explore';

    // Visit Settings (non-KeepAlive) — Explore stays mounted but hidden + inert.
    await act(async () => setActive('settings'));
    expect(exploreSlot.hidden).toBe(true);
    expect(exploreSlot.getAttribute('aria-hidden')).toBe('true');
    expect(exploreSlot.inert).toBe(true);
    const settingsInput = container.querySelector<HTMLInputElement>('[aria-label="Settings input"]')!;
    settingsInput.value = 'ephemeral';

    // Switch to Assets — Settings must unmount, Explore stays preserved.
    await act(async () => setActive('assets'));
    expect(container.querySelector('.slot-settings')).toBeNull();
    expect(container.querySelector('[aria-label="Explore filter"]')).toBe(exploreInput);
    expect(exploreInput.value).toBe('kept-explore');
    const assetsSlot = container.querySelector<HTMLElement>('.slot-assets')!;
    expect(assetsSlot.hidden).toBe(false);

    // Return to Settings — fresh input mounted (non-KeepAlive).
    await act(async () => setActive('settings'));
    expect(assetsSlot.hidden).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Settings input"]')?.value).toBe('initial');
  });
});

describe('useWorkspaceBlocker', () => {
  it('blocks rejected cross-project POP navigation without dropping history stack and proceeds once saves succeed', async () => {
    let shouldFail = true;
    const onError = vi.fn();
    const onProceed = vi.fn();
    let nav!: ReturnType<typeof useNavigate>;
    let currentHref = '';

    function GuardHarness() {
      const loc = useLocation();
      nav = useNavigate();
      currentHref = `${loc.pathname}${loc.search}`;
      const actingRef = useRef(false);
      useWorkspaceBlocker({
        enabled: true,
        actingRef,
        waitForSaves: async () => {
          if (shouldFail) throw new Error('Unsaved edit');
        },
        onBlockedError: onError,
        onProjectChangeProceed: onProceed,
      });
      return <div data-href={currentHref} />;
    }

    await act(async () =>
      root.render(
        <StudioRouterProvider memory initialEntries={['/editor/p1?session=s1#project/p1']}>
          <GuardHarness />
        </StudioRouterProvider>,
      ),
    );

    await act(async () => {
      void nav('/editor/p2?session=s2#project/p2');
    });
    expect(currentHref).toBe('/editor/p2?session=s2');

    // Attempt Back while save rejects — must stay on p2 and surface error.
    await act(async () => {
      void nav(-1);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(currentHref).toBe('/editor/p2?session=s2');
    expect(onError).toHaveBeenCalledWith('Unsaved edit');
    expect(onProceed).not.toHaveBeenCalled();

    // Allow save to succeed and retry Back — must move to p1 and notify proceed after commit.
    shouldFail = false;
    await act(async () => {
      void nav(-1);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(currentHref).toBe('/editor/p1?session=s1');
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(onProceed).toHaveBeenCalledTimes(1);

    // Forward destination (p2) is still preserved.
    await act(async () => {
      void nav(1);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(currentHref).toBe('/editor/p2?session=s2');
  });

  it('cancels an older pending blocked POP when another navigation commits first', async () => {
    let resolveSave!: () => void;
    const onProceed = vi.fn();
    let nav!: ReturnType<typeof useNavigate>;
    let currentHref = '';

    function PendingGuardHarness() {
      const loc = useLocation();
      nav = useNavigate();
      currentHref = `${loc.pathname}${loc.search}`;
      const actingRef = useRef(false);
      useWorkspaceBlocker({
        enabled: true,
        actingRef,
        waitForSaves: () => new Promise<void>(resolve => { resolveSave = resolve; }),
        onBlockedError: () => {},
        onProjectChangeProceed: onProceed,
      });
      return null;
    }

    await act(async () =>
      root.render(
        <StudioRouterProvider memory initialEntries={['/editor/p1?session=s1#project/p1']}>
          <PendingGuardHarness />
        </StudioRouterProvider>,
      ),
    );

    await act(async () => { void nav('/editor/p2?session=s2#project/p2'); });
    await act(async () => { void nav(-1); await new Promise(resolve => setTimeout(resolve, 0)); });
    // Blocked Back keeps the active URL on p2 while saves flush.
    expect(currentHref).toBe('/editor/p2?session=s2');

    // User navigates to a same-project page before the older save flush settles.
    await act(async () => { void nav('/mcp-setup?session=s2&host=codex#project/p2'); });
    expect(currentHref).toBe('/mcp-setup?session=s2&host=codex');

    await act(async () => { resolveSave(); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(currentHref).toBe('/mcp-setup?session=s2&host=codex');
    expect(onProceed).not.toHaveBeenCalled();
  });

  it('localizes the active-switch blocked navigation message across locales', async () => {
    await ensureLocaleLoaded('zh-CN');
    const onError = vi.fn();
    let nav!: ReturnType<typeof useNavigate>;

    function ActingGuardHarness() {
      nav = useNavigate();
      const actingRef = useRef(true);
      useWorkspaceBlocker({
        enabled: true,
        actingRef,
        waitForSaves: async () => {},
        onBlockedError: onError,
      });
      return null;
    }

    for (const [locale, expected] of [
      ['en', 'Switching projects. Please try again shortly.'],
      ['zh-CN', '正在切换项目，请稍后重试。'],
    ] as const) {
      onError.mockClear();
      await act(async () =>
        root.render(
          <I18nProvider key={locale} initialLocale={locale}>
            <StudioRouterProvider memory initialEntries={['/editor/p1?session=s1#project/p1', '/editor/p2?session=s2#project/p2']}>
              <ActingGuardHarness />
            </StudioRouterProvider>
          </I18nProvider>,
        ),
      );
      await act(async () => {
        void nav(-1);
        await new Promise(resolve => setTimeout(resolve, 0));
      });
      expect(onError).toHaveBeenCalledWith(expected);
    }
  });
});

describe('navigateWorkspaceHistory async commit ordering', () => {
  it('awaits an asynchronous Data Router navigation before resolving callers', async () => {
    let resolveNav!: () => void;
    const unregister = registerWorkspaceHistoryBridge({
      navigate: to => new Promise<void>(resolve => {
        resolveNav = () => {
          if (typeof to === 'string') history.pushState({ idx: 1 }, '', to);
          resolve();
        };
      }),
      getLocationState: () => null,
      getIndex: () => 0,
    });

    try {
      let committedHref = '';
      const done = navigateWorkspaceHistory('/?session=s2&project=p2#project/p2').then(() => {
        committedHref = location.search;
      });
      await Promise.resolve();
      expect(committedHref).toBe('');
      resolveNav();
      await done;
      expect(committedHref).toBe('?session=s2&project=p2');
    } finally {
      unregister();
    }
  });
});

describe('StudioRouterProvider StrictMode and location.state bridge', () => {
  it('propagates breadcrumb source via location.state and stays alive under StrictMode', async () => {
    let observedHref = '';
    let observedSourceHref: string | null = null;

    function BridgeProbe() {
      const loc = useLocation();
      observedHref = `${loc.pathname}${loc.search}${loc.hash}`;
      observedSourceHref = readLocationWorkspaceSource(loc.state)?.href ?? null;
      return null;
    }

    await act(async () =>
      root.render(
        <StrictMode>
          <StudioRouterProvider memory initialEntries={['/explore']}>
            <BridgeProbe />
          </StudioRouterProvider>
        </StrictMode>,
      ),
    );

    expect(observedHref).toBe('/explore');
    expect(workspaceHistoryIndex()).toBe(0);

    const originHref = `${location.origin}/explore`;
    await act(async () => {
      writeWorkspaceHistory('/mcp-setup?host=codex', false, {
        page: { href: originHref, index: 0 },
        settings: null,
      });
    });

    expect(observedHref).toBe('/mcp-setup?host=codex');
    expect(workspaceHistoryIndex()).toBe(1);
    expect(observedSourceHref).toBe(originHref);

    await act(async () => {
      expect(restoreWorkspaceSource({ href: originHref, index: 0 })).toBe(true);
    });
    expect(observedHref).toBe('/explore');
    expect(workspaceHistoryIndex()).toBe(0);
  });
});

describe('LegacyQueryRedirect', () => {
  it('computes canonical semantic paths for migrated Phase 4a, 4b, and 4c legacy query URLs while preserving orthogonal params and hashes', () => {
    expect(resolveLegacyQueryRedirect('/', '?page=brand-kit&kit=mine&embed=1', '#project/p1')).toBe(
      '/brand-kit/mine?embed=1#project/p1',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=brand-kit')).toBe('/brand-kit');
    expect(resolveLegacyQueryRedirect('/', '?page=mcp&host=claude&setup=manual&embed=1', '#project/p1?t=12')).toBe(
      '/mcp-setup?embed=1&host=claude&setup=manual#project/p1?t=12',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=mcp&templates=1&template=missing')).toBe(
      '/mcp-setup?host=codex&templates=1&template=missing',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=model&model=fal%3Afal-ai%2Fsuno%2Fv4&community=product-films')).toBe(
      '/models/fal%3Afal-ai%2Fsuno%2Fv4?community=product-films',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=model-hub&hub=gemini-4&embed=1')).toBe(
      '/model-hub/gemini-4?embed=1',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=skills&skill=manim&skillCategory=Motion+techniques')).toBe(
      '/skills/manim?category=Motion+techniques',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=skills')).toBe('/skills');

    // Phase 4b — creative studios domain
    expect(resolveLegacyQueryRedirect('/', '?page=assets&asset=a1&version=v2&embed=1', '#project/p1')).toBe(
      '/assets/a1?embed=1&version=v2#project/p1',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=assets')).toBe('/assets');
    expect(resolveLegacyQueryRedirect('/', '?page=scenarios&category=campaign&community=product-films')).toBe(
      '/scenarios?category=campaign&community=product-films',
    );
    expect(
      resolveLegacyQueryRedirect(
        '/',
        '?page=scenario&scenario=black-friday&run=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&step=sales-film&mode=agent',
      ),
    ).toBe('/scenarios/black-friday?run=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&step=sales-film&mode=agent');
    expect(resolveLegacyQueryRedirect('/', '?page=design')).toBe('/design/prototype');
    expect(resolveLegacyQueryRedirect('/', '?page=design&scene=deck')).toBe('/design/deck');
    expect(resolveLegacyQueryRedirect('/', '?page=design&scene=projects&designProject=d-1')).toBe(
      '/design/projects/d-1',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=design&scene=deck&designProject=d-1')).toBe(
      '/design/projects/d-1?scene=deck',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=design&scene=image-edit&model=p%3Am')).toBe(
      '/create/image-edit?model=p%3Am',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=cinema')).toBe('/cinema');
    expect(resolveLegacyQueryRedirect('/', '?page=cinema&scene=text-to-video&model=cloud%3Afilm%2Fv2')).toBe(
      '/cinema/text-to-video?model=cloud%3Afilm%2Fv2',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=sound&home=1')).toBe('/sound');
    expect(resolveLegacyQueryRedirect('/', '?page=sound&scene=sfx')).toBe('/sound/sfx');
    expect(resolveLegacyQueryRedirect('/', '?page=audio&scene=music&model=fal%3Asuno')).toBe(
      '/audio/music?model=fal%3Asuno',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=create&scene=text-to-image&embed=1')).toBe(
      '/create/text-to-image?embed=1',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=create&scene=shot-image')).toBe('/create/text-to-image');
    expect(resolveLegacyQueryRedirect('/', '?page=3d&skill=three-js&community=3d-motion')).toBe(
      '/studios/3d?skill=three-js&community=3d-motion',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=3d&scene=text-to-video')).toBe('/studios/3d/text-to-video');
    expect(resolveLegacyQueryRedirect('/', '?page=game&game=done')).toBe('/studios/game?game=done');
    expect(resolveLegacyQueryRedirect('/', '?page=shorts')).toBe('/studios/shorts');

    // Phase 4c — core surfaces and legacy root/editor entrypoints
    expect(resolveLegacyQueryRedirect('/', '')).toBe('/explore');
    expect(resolveLegacyQueryRedirect('/', '?embed=1')).toBe('/explore?embed=1');
    expect(resolveLegacyQueryRedirect('/', '?page=explore&community=product-films&medium=image')).toBe(
      '/explore?community=product-films&medium=image',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=motion&template=missing')).toBe('/motion?template=missing');
    expect(
      resolveLegacyQueryRedirect(
        '/',
        '?page=settings&section=providers&provider=account&entry_from=agent_media_upgrade_go&embed=1',
      ),
    ).toBe('/settings/providers?entry_from=agent_media_upgrade_go&embed=1&provider=account');
    expect(resolveLegacyQueryRedirect('/', '?page=settings&section=mcp&host=claude&setup=manual')).toBe(
      '/settings/mcp?host=claude&setup=manual',
    );
    expect(resolveLegacyQueryRedirect('/', '?page=settings')).toBe('/settings/general');
    expect(resolveLegacyQueryRedirect('/', '?page=editor')).toBe('/editor');
    expect(
      resolveLegacyQueryRedirect('/', '?project=p1&session=s1&embed=1', '#project/p1?v=1&t=12'),
    ).toBe('/editor/p1?session=s1&embed=1#project/p1?v=1&t=12');
    expect(resolveLegacyQueryRedirect('/', '', '#project/p1?t=12')).toBe('/editor/p1#project/p1?t=12');
    expect(resolveLegacyQueryRedirect('/', '?session=s1')).toBe('/editor?session=s1');
    expect(resolveLegacyQueryRedirect('/', '?page=api&tool=openmotion_media_use')).toBe('/explore');

    // Root template/hostChrome embeds and incomplete/unknown legacy URLs remain untouched.
    expect(resolveLegacyQueryRedirect('/', '?templates=1&embed=1')).toBeNull();
    expect(resolveLegacyQueryRedirect('/', '?hostChrome=1&templates=1')).toBeNull();
    expect(resolveLegacyQueryRedirect('/', '?page=create&scene=missing')).toBeNull();
    expect(resolveLegacyQueryRedirect('/', '?page=model')).toBeNull();
    expect(resolveLegacyQueryRedirect('/', '?page=model-hub')).toBeNull();
    expect(resolveLegacyQueryRedirect('/', '?page=unknown')).toBeNull();
    expect(resolveLegacyQueryRedirect('/mcp-setup', '?host=claude')).toBeNull();
  });

  it('replaces a legacy query URL in place on mount without growing the history stack', async () => {
    let observed = '';
    function Probe() {
      const loc = useLocation();
      observed = `${loc.pathname}${loc.search}${loc.hash}`;
      return null;
    }

    await act(async () =>
      root.render(
        <StudioRouterProvider
          memory
          initialEntries={['/?page=brand-kit&kit=mine&embed=1&templates=1#project/p1']}
        >
          <Probe />
        </StudioRouterProvider>,
      ),
    );

    expect(observed).toBe('/brand-kit/mine?embed=1&templates=1#project/p1');
    expect(workspaceHistoryIndex()).toBe(0);
  });
});
