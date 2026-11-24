import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18n';
import { projectHref, requestedProject, sessionHref } from './workspaceRouting';
import { availableSession, type CreativeSession, type CreationMode } from '../../../shared/session';
import { preservePresentation } from '../../../shared/workspace-url';
import { isStandaloneSpaPath } from '../../../shared/spa-routes';
import { diagnosticFetch } from './diagnosticRequests';
import { initializeWorkspaceHistory, WORKSPACE_LOCATION_CHANGED, workspaceHistoryIndex, workspaceHistorySession, writeWorkspaceHistory } from '../utils/workspaceHistory';
import { readWorkspacePage } from './workspacePageRouting';

export type SavedProject = { id: string; title: string; titleKey?: 'OpenMotion Sample Video' | null; templateId?: string; createdAt?: number; openedAt?: number; trashedAt?: number };
type Job = { id: string; state: 'pending' | 'running' | 'completed' | 'failed'; error?: string };
export type WorkspaceStatus = { revision: string; projectId: string; projectTitle: string; exportJob: Job | null; sessionId?: string;
  historyRestoreError?: { requestId: string; message: string } | null };
export type ProjectCatalog = { activeId: string; projects: SavedProject[]; sessions?: CreativeSession[]; activeSessionId?: string };
export async function motionApi<T>(path: string, init?: RequestInit, projectId?: string): Promise<T> {
  const response = await diagnosticFetch((path.startsWith('/sessions') || path.startsWith('/modes') ? '/design-api' : '/motion-api') + path
    + (projectId ? (path.includes('?') ? '&' : '?') + 'projectId=' + encodeURIComponent(projectId) : ''), init);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '本地工作室连接失败');
  return data as T;
}
export function navigateWorkspace(url: string, replace = false) {
  // A document navigation releases every old edit session, observer and upload handler.
  const target = preservePresentation(url, location.search);
  if (replace) window.location.replace(target);
  else window.location.assign(target);
}
const jsonBody = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function useWorkspace(
  waitForSaves: () => Promise<void>,
  projectId?: string,
  sessionId?: string,
  navigate = navigateWorkspace,
  options?: { externalHistoryGuard?: boolean },
) {
  const externalHistoryGuard = Boolean(options?.externalHistoryGuard);
  const { t } = useI18n();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const displayedProjects = useMemo(() => projects.map(project => project.id === 'project' && project.titleKey === 'OpenMotion Sample Video'
    ? { ...project, title: t(project.titleKey) } : project), [projects, t]);
  const [sessions, setSessions] = useState<CreativeSession[]>([]);
  const visibleSessions = useMemo(() => {
    const trashed = new Set(projects.filter(project => project.trashedAt).map(project => project.id));
    return sessions.flatMap(session => availableSession(session, trashed) ?? []);
  }, [projects, sessions]);
  const [status, setStatus] = useState<WorkspaceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [navigationError, setNavigationError] = useState<{ message: string } | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [connectionCheck, setConnectionCheck] = useState(0);
  const [checkingConnection, setCheckingConnection] = useState(false);
  const retryConnection = useCallback(() => { setCheckingConnection(true); setConnectionCheck(value => value + 1); }, []);
  const acting = useRef(false);
  const pendingSession = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    acting.current = false;
    setBusy(false);
    setStatus(null);
    setError('');
    setNavigationError(null);
    setConnectionError('');
  }, [projectId, sessionId]);
  const request = useCallback(<T,>(path: string, init?: RequestInit) => motionApi<T>(path, init, projectId), [projectId]);
  const updateCatalog = useCallback((catalog: ProjectCatalog) => {
    // The catalog keeps project order; opening a project must not move its sidebar row.
    const ordered = catalog.projects;
    setActiveProjectId(catalog.activeId);
    setProjects(previous => JSON.stringify(previous) === JSON.stringify(ordered) ? previous : ordered);
    const nextSessions = [...(catalog.sessions ?? [])].sort((a, b) => (b.openedAt ?? b.createdAt ?? 0) - (a.openedAt ?? a.createdAt ?? 0));
    setSessions(previous => JSON.stringify(previous) === JSON.stringify(nextSessions) ? previous : nextSessions);
  }, []);
  useEffect(() => {
    if (navigate === navigateWorkspace || externalHistoryGuard) return;
    initializeWorkspaceHistory();
    let previousUrl = location.href, previousIndex = workspaceHistoryIndex(), previousSession = workspaceHistorySession();
    let cancelled = false, generation = 0;
    let restoringUrl: string | null = null;
    const accepted = () => { previousUrl = location.href; previousIndex = workspaceHistoryIndex(); previousSession = workspaceHistorySession(); generation++; };
    const restore = async () => {
      const target = location.href, targetIndex = workspaceHistoryIndex(), attempt = ++generation;
      if (target === restoringUrl) {
        restoringUrl = null;
        writeWorkspaceHistory(target, true);
        return;
      }
      const previous = new URL(previousUrl), next = new URL(target);
      const sameProject = requestedProject(next.search, next.hash, next.pathname) === requestedProject(previous.search, previous.hash, previous.pathname)
        && next.searchParams.get('session') === previous.searchParams.get('session');
      try {
        if (acting.current) throw new Error(t('Switching projects. Please try again shortly.'));
        // Page switches preserve the mounted editor. Leaving a busy template
        // library or replacing the project still uses the existing save guard.
        if (!sameProject || (readWorkspacePage(previous.search, previous.hash, previous.pathname).templates && !readWorkspacePage(next.search, next.hash, next.pathname).templates)) await waitForSaves();
        if (cancelled || attempt !== generation || location.href !== target) return;
        setNavigationError(null);
        if (sameProject) writeWorkspaceHistory(target, true);
        else navigate(target, true);
      } catch (err) {
        if (cancelled || attempt !== generation || location.href !== target) return;
        // Restore our entry without truncating Forward history. Older/external
        // entries have no index, so replace only that unknown entry as a fallback.
        if (previousSession === workspaceHistorySession() && previousIndex !== null && targetIndex !== null && previousIndex !== targetIndex) {
          restoringUrl = previousUrl;
          history.go(previousIndex - targetIndex);
        }
        else writeWorkspaceHistory(previousUrl, true);
        setNavigationError({ message: (err as Error).message });
      }
    };
    window.addEventListener(WORKSPACE_LOCATION_CHANGED, accepted);
    window.addEventListener('popstate', restore);
    return () => { cancelled = true; window.removeEventListener(WORKSPACE_LOCATION_CHANGED, accepted); window.removeEventListener('popstate', restore); };
  }, [navigate, projectId, sessionId, waitForSaves, externalHistoryGuard]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [data, catalog] = await Promise.all([
          request<WorkspaceStatus>('/project/status', { signal: controller.signal }),
          motionApi<ProjectCatalog>('/projects', { signal: controller.signal }).then(catalog => {
            if (!controller.signal.aborted) updateCatalog(catalog);
            return catalog;
          }),
        ]);
        if (controller.signal.aborted) return;
        if (projectId && data.projectId !== projectId && !acting.current) {
          throw new Error('项目状态与当前页面不匹配，请重新打开对应项目。');
        }
        const savedSession = !projectId && sessionId ? catalog.sessions?.find(item => item.id === sessionId) : undefined;
        const session = savedSession && availableSession(savedSession, new Set(catalog.projects.filter(project => project.trashedAt).map(project => project.id)));
        const generated = session?.artifacts.find(item => item.id === session.activeArtifactId) ?? session?.artifacts.at(-1);
        if (generated && !acting.current && !isStandaloneSpaPath(location.pathname, location.search, location.hash)) { navigate(sessionHref(sessionId!, generated.projectId, true), true); return; }
        setStatus(data); setConnectionError('');
      } catch (err) { if (!controller.signal.aborted) setConnectionError((err as Error).message); }
      finally { if (!controller.signal.aborted) setCheckingConnection(false); }
      if (!controller.signal.aborted) timer = setTimeout(poll, 1800);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [projectId, sessionId, updateCatalog, request, connectionCheck, navigate]);

  const transition = useCallback(async (path?: string, options?: { instruction?: string; mode?: string; templateId?: string; projectId?: string }, sessionRoute = false, revealArtifact = true) => {
    if (acting.current) return false;
    acting.current = true; setBusy(true); setError('');
    try {
      await waitForSaves();
      if (!path) { navigate('/'); return true; }
      const current = await request<WorkspaceStatus>('/project/status');
      if (projectId && current.projectId !== projectId) throw new Error('当前项目已切换，请刷新后重试。');
      const next = await request<WorkspaceStatus>(path, {
        method: 'POST', ...jsonBody({ expectedRevision: current.revision, expectedProjectId: current.projectId, ...options }),
      });
      if (options?.instruction) { try { localStorage.removeItem('motion.home.draft.v1'); } catch {} }
      navigate(sessionRoute && next.sessionId ? sessionHref(next.sessionId, next.projectId, revealArtifact) : projectHref(next.projectId));
      return true;
    } catch (err) { setError((err as Error).message); return false; }
    finally { acting.current = false; setBusy(false); }
  }, [waitForSaves, projectId, request, navigate]);
  const open = useCallback((kind: 'templates' | 'projects', id: string) => transition(`/${kind}/${encodeURIComponent(id)}/open`), [transition]);
  const followActiveProject = useCallback((id: string) => navigate(projectHref(id), true), [navigate]);
  const create = useCallback((instruction?: string) => transition('/projects', instruction?.trim() ? { instruction: instruction.trim() } : undefined), [transition]);
  const home = useCallback(() => transition(), [transition]);
  const startSession = useCallback(async (instruction?: string, templateId?: string, mode: CreationMode = 'motion') => {
    if (acting.current) return false;
    acting.current = true; setBusy(true); setError('');
    let createdId: string | undefined;
    const options = { mode, ...(instruction?.trim() ? { instruction: instruction.trim() } : {}), ...(templateId ? { templateId } : {}) };
    const key = JSON.stringify(options);
    if (pendingSession.current?.key !== key) pendingSession.current = { key, id: crypto.randomUUID() };
    try {
      await waitForSaves();
      const created = await motionApi<{ sessionId: string; session: CreativeSession }>('/sessions', { method: 'POST', ...jsonBody({ ...options, id: pendingSession.current.id }) });
      createdId = created.sessionId;
      try { localStorage.removeItem('motion.home.draft.v1'); } catch {}
      const existing = created.session?.artifacts.find(item => item.id === created.session.activeArtifactId) ?? created.session?.artifacts[0];
      if (existing) { navigate(sessionHref(createdId, existing.projectId, true)); return true; }
      const current = await request<WorkspaceStatus>('/project/status');
      const next = await request<WorkspaceStatus>(`/sessions/${createdId}/artifacts`, { method: 'POST', ...jsonBody({ expectedRevision: current.revision, expectedProjectId: current.projectId }) });
      navigate(sessionHref(createdId, next.projectId, true)); return true;
    } catch (err) {
      if (createdId) {
        try { sessionStorage.setItem(`opendesign.session-error:${createdId}`, (err as Error).message); } catch {}
        navigate(sessionHref(createdId)); return true;
      }
      setError((err as Error).message); return false;
    }
    finally { acting.current = false; setBusy(false); }
  }, [waitForSaves, request, navigate]);
  const openSession = useCallback((id: string, artifactProjectId?: string) => transition(`/sessions/${encodeURIComponent(id)}/open`, artifactProjectId ? { projectId: artifactProjectId } : undefined, true, Boolean(artifactProjectId)), [transition]);
  const createArtifact = useCallback((id: string, templateId?: string) => transition(`/sessions/${encodeURIComponent(id)}/artifacts`, templateId ? { templateId } : undefined, true), [transition]);
  const renameItem = useCallback(async (id: string, title: string, kind: 'projects' | 'sessions') => {
    if (acting.current) return false;
    acting.current = true; setBusy(true); setError('');
    try {
      updateCatalog(await motionApi<ProjectCatalog>(`/${kind}/${encodeURIComponent(id)}`, { method: 'PATCH', ...jsonBody({ title }) }));
      return true;
    } catch (err) { setError((err as Error).message); return false; }
    finally { acting.current = false; setBusy(false); }
  }, [updateCatalog]);
  const rename = useCallback((id: string, title: string) => renameItem(id, title, 'projects'), [renameItem]);
  const renameSession = useCallback((id: string, title: string) => renameItem(id, title, 'sessions'), [renameItem]);
  const clearError = useCallback(() => { setError(''); }, []);
  return { projects: displayedProjects.filter(project => !project.trashedAt), activeProjectId, trashedProjects: displayedProjects.filter(project => Boolean(project.trashedAt)), sessions: visibleSessions, session: visibleSessions.find(item => item.id === sessionId), status, busy, actingRef: acting, navigationError, connectionError, error: error || connectionError, errorSource: error ? 'operation' as const : 'connection' as const, checkingConnection, retryConnection, open, followActiveProject, create, home, rename, startSession, openSession, createArtifact, renameSession, clearError };
}
