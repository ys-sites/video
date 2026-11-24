import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  Outlet,
  RouterProvider,
  createBrowserRouter,
  createMemoryRouter,
  type RouteObject,
} from 'react-router';
import { registerWorkspaceHistoryBridge, type WorkspaceLocationState } from '../utils/workspaceHistory';
import { LegacyQueryRedirect } from './LegacyQueryRedirect';
import { getRouteDefinition, type WorkspaceRouteId } from './routeRegistry';

export type AppRouteHandle = {
  id: WorkspaceRouteId;
  keepAlive: boolean;
  standalone: boolean;
  trackingPage: ReturnType<typeof getRouteDefinition>['trackingPage'];
};

function handleFor(id: WorkspaceRouteId): AppRouteHandle {
  const def = getRouteDefinition(id);
  return {
    id: def.id,
    keepAlive: def.keepAlive,
    standalone: def.standalone,
    trackingPage: def.trackingPage,
  };
}

/**
 * Declarative React Router route tree backed by `workspaceRouteRegistry`.
 * Every semantic path prefix from `shared/spa-routes.ts` plus root `/` renders
 * through the unified App Shell layout while attaching route metadata via `handle`.
 */
export function createAppRouteObjects(shellElement: ReactNode): RouteObject[] {
  const leaf = (path: string, id: WorkspaceRouteId): RouteObject => ({
    path,
    handle: handleFor(id),
    element: null,
  });

  return [
    {
      path: '/',
      element: shellElement,
      children: [
        { index: true, handle: handleFor('explore'), element: <LegacyQueryRedirect /> },
        leaf('explore', 'explore'),
        leaf('explore/:community', 'explore'),
        leaf('create/:scene', 'studio'),
        leaf('motion', 'motion'),
        leaf('cinema', 'cinema'),
        leaf('cinema/:scene', 'studio'),
        leaf('design', 'design'),
        leaf('design/projects/:projectId', 'design'),
        leaf('design/:scene', 'design'),
        leaf('sound', 'studio'),
        leaf('sound/:tab', 'studio'),
        leaf('audio', 'studio'),
        leaf('audio/:tab', 'studio'),
        leaf('studios/game', 'game'),
        leaf('studios/:studioId', 'skills'),
        leaf('studios/:studioId/:scene', 'studio'),
        leaf('scenarios', 'scenarios'),
        leaf('scenarios/:id', 'scenario'),
        leaf('game', 'game'),
        leaf('skills', 'skills'),
        leaf('skills/:id', 'skills'),
        leaf('model-hub', 'model-hub'),
        leaf('model-hub/:id', 'model-hub'),
        leaf('models/hub/:id', 'model-hub'),
        leaf('models/:id', 'model-overview'),
        leaf('models/*', 'model-overview'),
        leaf('assets', 'assets'),
        leaf('assets/:id', 'assets'),
        leaf('brand-kit', 'brand-kit'),
        leaf('brand-kit/:id', 'brand-kit'),
        leaf('settings', 'settings'),
        leaf('settings/:section', 'settings'),
        leaf('mcp-setup', 'mcp'),
        leaf('mcp-setup/:client', 'mcp'),
        leaf('templates', 'templates'),
        leaf('editor', 'editor'),
        leaf('editor/:projectId', 'editor'),
        leaf('*', 'explore'),
      ],
    },
  ];
}

export type AppRouterOptions = {
  memory?: boolean;
  initialEntries?: string[];
};

export function createAppRouter(shellElement: ReactNode, options?: AppRouterOptions) {
  const routes = createAppRouteObjects(shellElement);
  return options?.memory
    ? createMemoryRouter(routes, { initialEntries: options.initialEntries ?? ['/'] })
    : createBrowserRouter(routes);
}

const ShellSlotContext = createContext<ReactNode>(null);

function ShellSlot() {
  const children = useContext(ShellSlotContext);
  return (
    <>
      {children}
      <Outlet />
    </>
  );
}

/**
 * Root React Router Data Router provider that connects `workspaceHistory`
 * to the active router instance, stays safe across React StrictMode remounts,
 * and cleans up on unmount.
 */
export function StudioRouterProvider({
  children,
  memory,
  initialEntries,
}: {
  children: ReactNode;
  memory?: boolean;
  initialEntries?: string[];
}) {
  const [router, setRouter] = useState(() => createAppRouter(<ShellSlot />, { memory, initialEntries }));
  const disposedRef = useRef(false);

  useLayoutEffect(() => {
    if (disposedRef.current) {
      disposedRef.current = false;
      setRouter(createAppRouter(<ShellSlot />, { memory, initialEntries }));
      return;
    }

    const memoryKeys: string[] = [router.state.location.key];
    let memoryIdx = 0;
    const unsubscribe = memory
      ? router.subscribe(state => {
          const key = state.location.key;
          if (state.historyAction === 'PUSH') {
            memoryKeys.splice(memoryIdx + 1, memoryKeys.length - (memoryIdx + 1), key);
            memoryIdx = memoryKeys.length - 1;
          } else if (state.historyAction === 'REPLACE') {
            memoryKeys[memoryIdx] = key;
          } else if (state.historyAction === 'POP') {
            const found = memoryKeys.indexOf(key);
            if (found >= 0) memoryIdx = found;
          }
        })
      : null;

    const unregister = registerWorkspaceHistoryBridge({
      navigate: (to, options) => {
        if (typeof to === 'number') {
          return Promise.resolve(router.navigate(to)).then(() => undefined);
        }
        return Promise.resolve(
          router.navigate(to, {
            replace: options?.replace,
            state: options?.state as WorkspaceLocationState | undefined,
          }),
        ).then(() => undefined);
      },
      getLocationState: () => router.state.location.state,
      getIndex: () => {
        if (memory) return memoryIdx;
        const rrIdx = history.state?.idx;
        if (Number.isSafeInteger(rrIdx) && rrIdx >= 0) return rrIdx;
        return 0;
      },
    });

    return () => {
      unsubscribe?.();
      unregister();
      router.dispose();
      disposedRef.current = true;
    };
  }, [router, memory]);

  return (
    <ShellSlotContext.Provider value={children}>
      <RouterProvider router={router} />
    </ShellSlotContext.Provider>
  );
}
