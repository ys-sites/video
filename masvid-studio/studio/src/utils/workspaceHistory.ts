export const WORKSPACE_LOCATION_CHANGED = 'motion:workspace-location';
const entryKey = 'openmotionHistoryIndex';
const sessionKey = 'openmotionHistorySession';
const sourceKey = 'openmotionHistorySource';
const settingsSourceKey = 'openmotionSettingsSource';

export type WorkspaceSource = { href: string; index: number };
export type WorkspaceLocationState = {
  [sourceKey]?: WorkspaceSource | null;
  [settingsSourceKey]?: WorkspaceSource | null;
};

type RouterHistoryBridge = {
  navigate: (to: string | number, options?: { replace?: boolean; state?: WorkspaceLocationState }) => Promise<void> | void;
  getLocationState: () => unknown;
  getIndex: () => number | null;
};

let activeBridge: RouterHistoryBridge | null = null;
let fallbackSessionCounter = 0;

function generateSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  fallbackSessionCounter += 1;
  return `om-${Date.now().toString(36)}-${fallbackSessionCounter.toString(36)}`;
}

/**
 * Connect the active React Router Data Router instance so history mutations
 * flow through the Data Router (`location.state` + `idx`) instead of raw
 * `history.pushState`.
 */
export function registerWorkspaceHistoryBridge(bridge: RouterHistoryBridge | null): () => void {
  activeBridge = bridge;
  return () => {
    if (activeBridge === bridge) activeBridge = null;
  };
}

export function workspaceHistoryIndex(): number | null {
  const fromBridge = activeBridge?.getIndex();
  if (typeof fromBridge === 'number' && Number.isSafeInteger(fromBridge) && fromBridge >= 0) {
    return fromBridge;
  }
  const legacy = history.state?.[entryKey];
  if (Number.isSafeInteger(legacy) && legacy >= 0) return legacy;
  const rrIdx = history.state?.idx;
  if (Number.isSafeInteger(rrIdx) && rrIdx >= 0) return rrIdx;
  return null;
}

export function workspaceHistorySession(): string | null {
  const value = history.state?.[sessionKey];
  return typeof value === 'string' && value ? value : null;
}

export function initializeWorkspaceHistory() {
  if (activeBridge) return;
  if (workspaceHistoryIndex() === null || workspaceHistorySession() === null) {
    const session = generateSessionToken();
    history.replaceState(
      { ...history.state, [entryKey]: 0, [sessionKey]: session, [sourceKey]: null, [settingsSourceKey]: null },
      '',
      location.href,
    );
  }
}

function readSourceFromRecord(record: Record<string, unknown> | null | undefined, key: string): WorkspaceSource | null {
  const source = record?.[key] as WorkspaceSource | null | undefined;
  const index = workspaceHistoryIndex();
  if (!source || index === null || !Number.isSafeInteger(source.index) || source.index < 0 || source.index >= index) return null;
  if (typeof source.href !== 'string' || !source.href.startsWith(location.origin + '/')) return null;
  return source;
}

export function readLocationWorkspaceSource(locationState: unknown): WorkspaceSource | null {
  const fromLocation = readSourceFromRecord(locationState as Record<string, unknown> | null | undefined, sourceKey);
  if (fromLocation) return fromLocation;
  return workspaceHistorySource();
}

function readWorkspaceSource(key: string): WorkspaceSource | null {
  const fromBridge = readSourceFromRecord(activeBridge?.getLocationState() as Record<string, unknown> | null | undefined, key);
  if (fromBridge) return fromBridge;
  const fromUsr = readSourceFromRecord(history.state?.usr as Record<string, unknown> | null | undefined, key);
  if (fromUsr) return fromUsr;
  return readSourceFromRecord(history.state as Record<string, unknown> | null | undefined, key);
}

export function workspaceHistorySource(): WorkspaceSource | null {
  return readWorkspaceSource(sourceKey);
}

export function workspaceSettingsSource(): WorkspaceSource | null {
  return readWorkspaceSource(settingsSourceKey);
}

export function restoreWorkspaceSource(source: WorkspaceSource): boolean {
  const index = workspaceHistoryIndex();
  if (index === null || index <= source.index) return false;
  const delta = source.index - index;
  if (activeBridge) void activeBridge.navigate(delta);
  else history.go(delta);
  return true;
}

/**
 * Navigate through the active Data Router (or legacy History fallback) and
 * resolve once the router navigation has committed.
 */
export function navigateWorkspaceHistory(
  target: string | URL,
  replace = false,
  sources?: { page: WorkspaceSource | null; settings: WorkspaceSource | null },
): Promise<void> {
  const url = new URL(target, location.href);
  if (url.origin !== location.origin) throw new Error('Workspace navigation must stay on this origin');
  const relativeTarget = `${url.pathname}${url.search}${url.hash}`;

  if (activeBridge) {
    const existing = (activeBridge.getLocationState() as WorkspaceLocationState | null | undefined) ?? {};
    const nextState: WorkspaceLocationState = sources
      ? { ...existing, [sourceKey]: sources.page, [settingsSourceKey]: sources.settings }
      : existing;
    const shouldReplace = replace || url.href === location.href;
    const stateChanged = Boolean(
      sources && (existing[sourceKey] !== sources.page || existing[settingsSourceKey] !== sources.settings),
    );
    if (url.href !== location.href || stateChanged) {
      return Promise.resolve(
        activeBridge.navigate(relativeTarget, { replace: shouldReplace, state: nextState }),
      ).then(() => {
        window.dispatchEvent(new Event(WORKSPACE_LOCATION_CHANGED));
      });
    }
    window.dispatchEvent(new Event(WORKSPACE_LOCATION_CHANGED));
    return Promise.resolve();
  }

  initializeWorkspaceHistory();
  const index = workspaceHistoryIndex()!;
  const session = workspaceHistorySession()!;
  const sourceState = sources ? { [sourceKey]: sources.page, [settingsSourceKey]: sources.settings } : {};
  if (url.href === location.href || replace) {
    if (url.href !== location.href || Object.entries(sourceState).some(([key, value]) => history.state?.[key] !== value)) {
      history.replaceState({ ...history.state, ...sourceState }, '', url);
    }
  } else {
    history.pushState({ [entryKey]: index + 1, [sessionKey]: session, ...sourceState }, '', url);
  }
  window.dispatchEvent(new Event(WORKSPACE_LOCATION_CHANGED));
  return Promise.resolve();
}

/** Keep history identity when the editor updates its hash or the shell resolves a project. */
export function writeWorkspaceHistory(
  target: string | URL,
  replace = false,
  sources?: { page: WorkspaceSource | null; settings: WorkspaceSource | null },
): void {
  void navigateWorkspaceHistory(target, replace, sources);
}
