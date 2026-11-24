// @vitest-environment happy-dom
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionApp, resolveWorkspaceProject } from './MotionApp';
import { I18nProvider, translate } from '../i18n/I18n';
import { trackMotion } from './tracking';
import { preloadAllWorkspacePages } from '../router/lazyPages';

vi.mock('../App', () => ({ StudioApp: ({ resolvedProjectId }: { resolvedProjectId: string }) => <div data-viewer-project={resolvedProjectId} /> }));
vi.mock('./ArtifactViewer', () => ({ ArtifactViewer: ({ artifact }: { artifact: { projectId: string } }) => <div data-viewer-project={artifact.projectId} /> }));
vi.mock('./tracking', () => ({ trackMotion: vi.fn() }));
const id = '11111111-1111-1111-1111-111111111111';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => preloadAllWorkspacePages());
afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('prepares only existing projects while browsing, and creates only the selected template (existing=%s)', async existing => {
  history.replaceState(null, '', '/?templates=1&embed=1');
  sessionStorage.clear();
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
  const artifact = { id, kind: 'motion-project', projectId: id, title: 'Existing project' };
  const preparedId = '22222222-2222-2222-2222-222222222222';
  const preparedSessionId = '33333333-3333-3333-3333-333333333333';
  const catalog = { activeId: existing ? id : 'project', projects: existing ? [{ id, title: 'Existing project' }] : [], sessions: existing ? [{ id, artifacts: [artifact] }] : [] };
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    const parsed = new URL(url, location.origin);
    const scopedProject = parsed.searchParams.get('projectId') ?? catalog.activeId;
    const revision = scopedProject === preparedId ? 'new-revision' : 'original-revision';
    if (parsed.pathname.endsWith('/artifacts') && init?.method === 'POST') {
      catalog.activeId = preparedId;
      catalog.projects.push({ id: preparedId, title: 'Product Promo' });
      catalog.sessions.push({ id: preparedSessionId, artifacts: [{ id: preparedId, kind: 'motion-project', projectId: preparedId, title: 'Product Promo' }] });
      return Response.json({ sessionId: preparedSessionId, projectId: preparedId, projectTitle: 'Product Promo' });
    }
    if (parsed.pathname.endsWith(`/projects/${preparedId}/open`)) {
      const guard = JSON.parse(String(init?.body));
      if (guard.expectedProjectId !== scopedProject || guard.expectedRevision !== revision) return Response.json({ error: 'stale guard' }, { status: 409 });
      return Response.json({ projectId: preparedId, revision: 'new-revision' });
    }
    return Response.json(
      url.includes('/template-catalog') ? { items: [{ id: 'product-promo', title: 'Product Promo', kind: 'builtin', tags: [], author: 'OpenMotion', hasHtmlProject: true }], total: 1, next: null, catalogVersion: 'test' }
      : parsed.pathname.endsWith('/projects') ? catalog
      : parsed.pathname.endsWith('/sessions') && init?.method === 'POST' ? { sessionId: preparedSessionId, session: { artifacts: [] } }
      : parsed.pathname.includes('/sessions/') ? catalog.sessions.find(session => session.id === parsed.pathname.split('/').at(-1))
      : { projectId: scopedProject, revision },
    );
  });
  vi.stubGlobal('fetch', fetcher);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider initialLocale="en"><MotionApp /></I18nProvider>));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('dialog[aria-label="Template library"]')).not.toBeNull();
    expect(fetcher.mock.calls.some(([url]) => url.includes('/preview/open'))).toBe(existing);
    const posts = () => fetcher.mock.calls.filter(([url, init]) => init?.method === 'POST' && !url.includes('/preview/open'));
    expect(posts()).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-template-id="product-promo"] button')!.click());
    expect(posts()).toHaveLength(0);
    const open = [...container.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('Open and edit'))!;
    await act(async () => open.click());
    expect(posts().map(([url]) => url.split('?')[0])).toEqual([
      '/design-api/sessions', `/design-api/sessions/${preparedSessionId}/artifacts`, `/motion-api/projects/${preparedId}/open`,
    ]);
    expect(JSON.parse(String(posts()[0][1]!.body)).templateId).toBe('product-promo');
    expect(JSON.parse(String(posts()[1][1]!.body))).toEqual({ templateId: 'product-promo', expectedRevision: 'original-revision', expectedProjectId: existing ? id : 'project' });
    expect(posts()[2][0]).toBe(`/motion-api/projects/${preparedId}/open${existing ? `?projectId=${id}` : ''}`);
    expect(JSON.parse(String(posts()[2][1]!.body))).toEqual({ expectedRevision: existing ? 'original-revision' : 'new-revision', expectedProjectId: existing ? id : preparedId });
    expect(assign).not.toHaveBeenCalled();
    expect(location.pathname).toBe(`/editor/${preparedId}`);
    expect(location.hash).toBe(`#project/${preparedId}`);
    expect(location.search).not.toContain('templates=1');
    expect(container.querySelector('dialog[aria-label="Template library"]')).toBeNull();
  } finally {
    act(() => root.unmount()); container.remove(); assign.mockRestore(); history.replaceState(null, '', '/'); sessionStorage.clear();
  }
});
it('resolves a bookmark without switching another page globally', async () => {
  const fetcher = vi.fn(async (url: string, _init?: RequestInit) => new Response(JSON.stringify(url.endsWith('/projects') ? { activeId: 'project', projects: [{ id }, { id: 'project' }] } : { projectId: id })));
  vi.stubGlobal('fetch', fetcher);
  await resolveWorkspaceProject(id, new AbortController().signal);
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/motion-api/projects', `/motion-api/preview/open?projectId=${id}`]);
  expect(fetcher.mock.calls[1][1]).toEqual({ method: 'POST', signal: expect.any(AbortSignal) });
});

it('records an explicit editor visit as Studio after its active project resolves', async () => {
  const artifact = { id: 'project', kind: 'motion-project', projectId: 'project', title: 'Existing project' };
  const catalog = { activeId: 'project', projects: [{ id: 'project', title: 'Existing project' }], sessions: [{ id: 'project', artifacts: [artifact] }] };
  history.replaceState(null, '', '/?page=editor');
  vi.mocked(trackMotion).mockClear();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/projects') ? catalog : url.includes('/sessions/') ? { id: 'project', artifacts: [artifact] } : { projectId: 'project', revision: 'r' },
  ))));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider><MotionApp /></I18nProvider>));
    expect(trackMotion).toHaveBeenCalledExactlyOnceWith('page_view', expect.objectContaining({ page_name: 'studio', has_project: true }));
  } finally {
    act(() => root.unmount());
    container.remove();
    history.replaceState(null, '', '/');
  }
});
it('invalid, deleted and conflicting links cannot silently open a different project', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ activeId: 'project', projects: [{ id: 'project' }] })));
  vi.stubGlobal('fetch', fetcher);
  await expect(resolveWorkspaceProject('../escape', new AbortController().signal)).rejects.toThrow('项目链接无效');
  expect(fetcher).not.toHaveBeenCalled();
  await expect(resolveWorkspaceProject(id, new AbortController().signal)).rejects.toThrow('项目不存在');
  expect(fetcher).toHaveBeenCalledOnce();
  fetcher.mockImplementation(async () => new Response(JSON.stringify({ error: '正在切换' }), { status: 409 }));
  await expect(resolveWorkspaceProject('project', new AbortController().signal)).rejects.toThrow('正在切换');
});
it('warms an already selected bookmark before mounting its editor', async () => {
  const fetcher = vi.fn(async (_url: string) => new Response(JSON.stringify({ activeId: id, projects: [{ id }] })));
  vi.stubGlobal('fetch', fetcher);
  await resolveWorkspaceProject(id, new AbortController().signal);
  expect(fetcher.mock.calls[1][0]).toBe(`/motion-api/preview/open?projectId=${id}`);
});
it('does not mount a bookmark when its scoped native context cannot open', async () => {
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/projects') ? { projects: [{ id }] } : { error: 'Native opening timed out' }), { status: url.endsWith('/projects') ? 200 : 400 }));
  vi.stubGlobal('fetch', fetcher);
  await expect(resolveWorkspaceProject(id, new AbortController().signal)).rejects.toThrow('Native opening timed out');
});

it.each(['deleted project', 'empty session'])('keeps the project drawer reachable from a %s', async route => {
  const artifact = { id: 'project', kind: 'motion-project', projectId: 'project', title: 'Existing project' };
  const catalog = { activeId: 'project', projects: [{ id: 'project', title: 'Existing project' }], sessions: [{ id: 'project', artifacts: [artifact] }] };
  history.replaceState(null, '', route === 'empty session' ? `/?session=${id}` : `/?project=${id}`);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(
    url.endsWith('/projects') ? catalog : url.includes('/sessions/') ? { id, artifacts: [] } : { projectId: 'project', revision: 'r' },
  ))));
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><MotionApp /></I18nProvider>));
    const toggle = container.querySelector<HTMLButtonElement>('.motion-workspace-menu');
    expect(toggle).not.toBeNull();
    await act(async () => toggle!.click());
    expect(document.querySelector('.motion-session')?.textContent).toContain('Existing project');
    expect(document.querySelector<HTMLButtonElement>('.motion-session')?.disabled).toBe(false);
  } finally {
    act(() => root.unmount());
    container.remove();
    history.replaceState(null, '', '/');
  }
});

it('shows the brand while opening and exposes failures instead of leaving the splash stuck', async () => {
  let fail!: (error: Error) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_resolve, reject) => { fail = reject; })));
  history.replaceState(null, '', '/?project=project');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider><MotionApp /></I18nProvider>));
    expect(container.querySelector('[role="status"] .motion-loading-mark')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="project-list-skeleton"]')).toHaveLength(3);
    expect(container.querySelector('.motion-session-list')?.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('.motion-session-list')?.textContent).toBe('');
    await act(async () => fail(new Error('Project unavailable')));
    expect(container.querySelector('.motion-loading')).toBeNull();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.querySelector('pre')).toBeNull();
    const details = container.querySelector<HTMLButtonElement>('.motion-error-notice-actions button')!;
    await act(async () => details.click());
    expect(container.querySelector('pre')?.textContent).toBe('Project unavailable');
  } finally {
    act(() => root.unmount());
    container.remove();
    history.replaceState(null, '', '/');
  }
});

it('keeps chrome, sidebar search and geometry mounted while replacing only the project viewer', async () => {
  const second = '22222222-2222-2222-2222-222222222222';
  const artifacts = [id, second].map((projectId, index) => ({ id: projectId, kind: 'motion-project', projectId, title: `Project ${index + 1}` }));
  const catalog = { activeId: id, projects: artifacts.map((item, index) => ({ id: item.projectId, title: item.title, createdAt: 200 - index * 100, openedAt: 200 - index * 100 })), sessions: artifacts.map(item => ({ id: item.id, artifacts: [item] })) };
  let finishOpening!: () => void;
  const opening = new Promise<void>(resolve => { finishOpening = resolve; });
  history.replaceState(null, '', `/?project=${id}&embed=1&tracking_context=33333333-3333-3333-3333-333333333333#project/${id}`);
  const assign = vi.spyOn(location, 'assign').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const projectId = new URL(url, location.origin).searchParams.get('projectId') ?? id;
    if (init?.method === 'POST' && url.includes('/projects/') && url.split('?')[0].endsWith('/open')) {
      const opened = new URL(url, location.origin).pathname.split('/').at(-2)!;
      catalog.projects.find(project => project.id === opened)!.openedAt = Date.now();
    }
    if ((url.includes('/preview/open') || url.includes('/project/status')) && projectId === second) await opening;
    return Response.json(url.endsWith('/projects') && !init?.method ? catalog
      : url.includes('/design-api/sessions/') ? catalog.sessions.find(item => url.includes(item.id))
      : url.includes('/open') && url.includes('/projects/') ? { projectId: new URL(url, location.origin).pathname.split('/').at(-2), revision: 'r' }
      : { projectId, revision: 'r' });
  }));
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<I18nProvider initialLocale="en"><MotionApp /></I18nProvider>));
    const header = container.querySelector('.om-app-header');
    const rail = container.querySelector('.om-app-rail');
    const sidebar = container.querySelector('.motion-sidebar');
    const content = container.querySelector('.motion-workspace-content');
    const firstViewer = container.querySelector('[data-viewer-project]');
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(search, 'Project');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const row = [...container.querySelectorAll<HTMLButtonElement>('.motion-session')].find(button => button.textContent === 'Project 2')!;
    const originalRows = [...sidebar!.querySelectorAll('.motion-session')];
    expect(originalRows.map(item => item.textContent)).toEqual(['Project 1', 'Project 2']);
    await act(async () => row.click());
    expect(assign).not.toHaveBeenCalled();
    expect(container.querySelector('.om-app-header')).toBe(header);
    expect(container.querySelector('.om-app-rail')).toBe(rail);
    expect(container.querySelector('.motion-sidebar')).toBe(sidebar);
    expect(container.querySelector('.motion-workspace-content')).toBe(content);
    expect(search.value).toBe('Project');
    expect(sidebar?.querySelector('[data-testid="project-list-skeleton"]')).toBeNull();
    expect(sidebar?.querySelector('.motion-session-empty')).toBeNull();
    expect([...sidebar!.querySelectorAll('.motion-session')]).toEqual(originalRows);
    expect(firstViewer?.isConnected).toBe(false);
    expect(content?.querySelectorAll('.motion-loading')).toHaveLength(1);
    expect(row.disabled).toBe(true);
    await act(async () => finishOpening());
    expect(content?.querySelector('[data-viewer-project]')?.getAttribute('data-viewer-project')).toBe(second);
    expect(content?.querySelector('.motion-loading')).toBeNull();
    expect([...sidebar!.querySelectorAll('.motion-session')]).toEqual(originalRows);
    expect(row.getAttribute('aria-current')).toBe('page');
    expect(row.closest('.om-project-sidebar-row')?.getAttribute('data-active')).toBe('true');
    expect(row.closest('.om-project-sidebar-row')?.querySelector('[aria-label="Actions for Project 2"]')).not.toBeNull();
    expect(location.search).toContain('embed=1');
    expect(location.search).toContain('tracking_context=33333333-3333-3333-3333-333333333333');
    const firstRow = [...container.querySelectorAll<HTMLButtonElement>('.motion-session')].find(button => button.textContent === 'Project 1')!;
    expect(firstRow.disabled).toBe(false);
    await act(async () => firstRow.click());
    expect(content?.querySelector('[data-viewer-project]')?.getAttribute('data-viewer-project')).toBe(id);
    expect(container.querySelector('.motion-sidebar')).toBe(sidebar);
    expect([...sidebar!.querySelectorAll('.motion-session')]).toEqual(originalRows);
    expect(firstRow.closest('.om-project-sidebar-row')?.getAttribute('data-active')).toBe('true');
    expect(row.closest('.om-project-sidebar-row')?.getAttribute('data-active')).toBe('false');
  } finally {
    act(() => root.unmount()); container.remove(); assign.mockRestore(); history.replaceState(null, '', '/');
  }
});
