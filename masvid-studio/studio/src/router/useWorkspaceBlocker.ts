import { useEffect, useRef, type RefObject } from 'react';
import { useBlocker, useLocation } from 'react-router';
import { editorProjectIdFromPath } from '../../../shared/spa-routes';
import { useI18n } from '../i18n/I18n';
import { requestedProject } from '../motion/workspaceRouting';
import { readWorkspacePage } from '../motion/workspacePageRouting';

export type WorkspaceBlockerOptions = {
  enabled: boolean;
  actingRef: RefObject<boolean>;
  waitForSaves: () => Promise<void>;
  onBlockedError: (message: string | null) => void;
  onProjectChangeProceed?: (targetHref?: string) => void;
};

type LocationLike = { pathname: string; search: string; hash: string };

function locationKey(loc: LocationLike): string {
  return `${loc.pathname}${loc.search}${loc.hash}`;
}

function isSameProjectAndSession(current: LocationLike, next: LocationLike): boolean {
  const prevProject = editorProjectIdFromPath(current.pathname) ?? requestedProject(current.search, current.hash);
  const nextProject = editorProjectIdFromPath(next.pathname) ?? requestedProject(next.search, next.hash);
  const prevSession = new URLSearchParams(current.search).get('session');
  const nextSession = new URLSearchParams(next.search).get('session');
  return prevProject === nextProject && prevSession === nextSession;
}

/**
 * React Router `useBlocker`-powered navigation guard for browser history
 * traversal (Back/Forward). Preserves the Forward/Back stack cleanly via
 * `blocker.proceed()` / `blocker.reset()` instead of rolling back with
 * manual `history.go(...)` bookkeeping.
 */
export function useWorkspaceBlocker({
  enabled,
  actingRef,
  waitForSaves,
  onBlockedError,
  onProjectChangeProceed,
}: WorkspaceBlockerOptions): void {
  const { t } = useI18n();
  const routerLocation = useLocation();
  const latestLocation = useRef<LocationLike>(routerLocation);
  latestLocation.current = routerLocation;
  const latestWait = useRef(waitForSaves);
  latestWait.current = waitForSaves;
  const latestOnError = useRef(onBlockedError);
  latestOnError.current = onBlockedError;
  const latestOnProceed = useRef(onProjectChangeProceed);
  latestOnProceed.current = onProjectChangeProceed;
  const latestTranslate = useRef(t);
  latestTranslate.current = t;
  const pendingProceedKey = useRef<string | null>(null);
  const attemptRef = useRef(0);
  const lastLocationKey = useRef(locationKey(routerLocation));

  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    if (!enabled || historyAction !== 'POP') return false;
    const sameProject = isSameProjectAndSession(currentLocation, nextLocation);
    const leavingTemplates =
      readWorkspacePage(currentLocation.search, currentLocation.hash, currentLocation.pathname).templates &&
      !readWorkspacePage(nextLocation.search, nextLocation.hash, nextLocation.pathname).templates;
    return actingRef.current || !sameProject || leavingTemplates;
  });

  // Invalidate any older pending save-flush guard if another navigation commits first.
  useEffect(() => {
    const currentKey = locationKey(routerLocation);
    if (currentKey === lastLocationKey.current) return;
    lastLocationKey.current = currentKey;
    attemptRef.current += 1;
    if (blocker.state === 'blocked') {
      pendingProceedKey.current = null;
      blocker.reset();
    }
  }, [routerLocation, blocker]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    const attempt = ++attemptRef.current;
    const sameProject = isSameProjectAndSession(latestLocation.current, blocker.location);
    const targetKey = locationKey(blocker.location);

    void (async () => {
      try {
        if (actingRef.current) throw new Error(latestTranslate.current('Switching projects. Please try again shortly.'));
        await latestWait.current();
        if (cancelled || attempt !== attemptRef.current) return;
        latestOnError.current(null);
        if (!sameProject) pendingProceedKey.current = targetKey;
        blocker.proceed();
      } catch (err) {
        if (cancelled || attempt !== attemptRef.current) return;
        pendingProceedKey.current = null;
        blocker.reset();
        latestOnError.current(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blocker, actingRef]);

  useEffect(() => {
    const targetKey = pendingProceedKey.current;
    if (!targetKey || blocker.state !== 'unblocked') return;
    if (locationKey(routerLocation) !== targetKey) return;
    pendingProceedKey.current = null;
    latestOnProceed.current?.(targetKey);
  }, [blocker.state, routerLocation]);
}
