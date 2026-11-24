import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useMatches } from 'react-router';
import { isKeepAliveRoute, type WorkspaceRouteId } from './routeRegistry';

export type KeepAliveRouteHandle = {
  id: WorkspaceRouteId;
  keepAlive: boolean;
  standalone: boolean;
};

/**
 * Track which `keepAlive: true` routes from `workspaceRouteRegistry` have been
 * visited in this session. Reads semantic path handles from React Router matches
 * when on a non-root path, and combines them with the active workspace route ID.
 */
export function useKeepAliveVisited(
  activeRouteId: WorkspaceRouteId,
  initiallyActive: readonly WorkspaceRouteId[] = [],
): ReadonlySet<WorkspaceRouteId> {
  const routerLocation = useLocation();
  const matches = useMatches();
  const matchedKeepAliveId =
    routerLocation.pathname !== '/'
      ? [...matches]
          .reverse()
          .map(match => (match.handle as Partial<KeepAliveRouteHandle> | undefined)?.id)
          .find((id): id is WorkspaceRouteId => Boolean(id && isKeepAliveRoute(id)))
      : undefined;

  const [visited, setVisited] = useState<Set<WorkspaceRouteId>>(() => {
    const initial = new Set<WorkspaceRouteId>();
    for (const id of initiallyActive) {
      if (isKeepAliveRoute(id)) initial.add(id);
    }
    if (isKeepAliveRoute(activeRouteId)) initial.add(activeRouteId);
    if (matchedKeepAliveId) initial.add(matchedKeepAliveId);
    return initial;
  });

  useEffect(() => {
    const toAdd: WorkspaceRouteId[] = [];
    if (isKeepAliveRoute(activeRouteId) && !visited.has(activeRouteId)) toAdd.push(activeRouteId);
    if (matchedKeepAliveId && !visited.has(matchedKeepAliveId)) toAdd.push(matchedKeepAliveId);
    if (!toAdd.length) return;
    setVisited(previous => {
      const next = new Set(previous);
      for (const id of toAdd) next.add(id);
      return next;
    });
  }, [activeRouteId, matchedKeepAliveId, visited]);

  return visited;
}

/**
 * KeepAlive container slot wired directly to `workspaceRouteRegistry.keepAlive`.
 * Non-KeepAlive routes unmount immediately when inactive; KeepAlive routes stay
 * mounted once visited and toggle `hidden`, `aria-hidden`, and `inert`.
 */
export function KeepAliveSlot({
  routeId,
  active,
  visited,
  className,
  children,
}: {
  routeId: WorkspaceRouteId;
  active: boolean;
  visited: ReadonlySet<WorkspaceRouteId>;
  className: string;
  children: ReactNode;
}) {
  const keepAlive = isKeepAliveRoute(routeId);
  const mounted = active || (keepAlive && visited.has(routeId));
  if (!mounted) return null;

  return (
    <div
      className={className}
      hidden={!active}
      aria-hidden={!active}
      inert={!active}
    >
      {children}
    </div>
  );
}
