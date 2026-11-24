// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useWorkspace } from './useWorkspace';
import { I18nProvider, useI18n } from '../i18n/I18n';
import { languages, translate } from '../i18n/messages';

const first = '11111111-1111-1111-1111-111111111111';
const second = '22222222-2222-2222-2222-222222222222';
const status = { revision: 'a'.repeat(64), projectId: first, projectTitle: 'First', exportJob: null };
let workspace: ReturnType<typeof useWorkspace>;
let root: Root;
let container: HTMLDivElement;
let fetcher: ReturnType<typeof vi.fn>;
let navigate: ReturnType<typeof vi.spyOn>;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeEach(() => {
  history.replaceState(null, '', '/');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  navigate = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
  fetcher = vi.fn(async (url: string, init?: RequestInit) => new Response(JSON.stringify(
    init?.method === 'POST' ? { ...status, projectId: second } : url.endsWith('/projects') ? { activeId: first, projects: [{ id: first, title: 'First' }] } : status,
  )));
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(wait: () => Promise<void>, projectId?: string, sessionId?: string, onNavigate?: (url: string, replace?: boolean) => void) {
  function Harness() { workspace = useWorkspace(wait, projectId, sessionId, onNavigate); return null; }
  await act(async () => root.render(<Harness />));
}
const writes = () => fetcher.mock.calls.filter(call => call[1]?.method === 'POST');

it('keeps drafts and mixed sessions in recent conversations but hides sessions with only trashed projects', async () => {
  const live = { id: first, title: 'Live' }, removed = { id: second, title: 'Removed', trashedAt: 10 };
  const other = { id: 'third', title: 'Also removed', trashedAt: 20 };
  const artifact = ({ id: projectId, title }: typeof live) => ({ id: projectId, projectId, title, kind: 'motion-project' });
  const sessions = [
    { id: 'mixed', title: 'Mixed', mode: 'motion', artifacts: [artifact(removed), artifact(live)], activeArtifactId: second },
    { id: 'hidden', title: 'Hidden', mode: 'motion', artifacts: [artifact(other)], activeArtifactId: other.id },
    { id: 'draft', title: 'Draft', mode: 'motion', artifacts: [] },
  ];
  let projects = [live, removed, other];
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects') ? { projects, sessions } : status));
  await mount(async () => {}, first, 'mixed');
  expect(workspace.sessions.map(session => session.id)).toEqual(['mixed', 'draft']);
  expect(workspace.session?.artifacts.map(item => item.projectId)).toEqual([first]);
  expect(workspace.session?.activeArtifactId).toBe(first);
  projects = [live, removed, { id: other.id, title: other.title, trashedAt: undefined }];
  await act(async () => workspace.retryConnection());
  expect(workspace.sessions.map(session => session.id)).toEqual(['mixed', 'hidden', 'draft']);
});

it('preserves the saved catalog order when project metadata changes', async () => {
  let projects = [
    { id: second, title: 'Second', createdAt: 200, openedAt: 200 },
    { id: first, title: 'First', createdAt: 200, openedAt: 100 },
    { id: 'project', title: 'Legacy project', openedAt: 9999 },
  ];
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects') ? { projects } : status));
  await mount(async () => {}, first);
  expect(workspace.projects.map(project => project.id)).toEqual([second, first, 'project']);
  projects = projects.map(project => ({ ...project, title: 'Renamed ' + project.title, openedAt: project.id === first ? 20000 : 1 }));
  await act(async () => workspace.retryConnection());
  expect(workspace.projects.map(project => project.id)).toEqual([second, first, 'project']);
  projects.unshift({ id: 'new', title: 'Newest', createdAt: 300, openedAt: 0 });
  await act(async () => workspace.retryConnection());
  expect(workspace.projects.map(project => project.id)).toEqual(['new', second, first, 'project']);
});

it('switches the default project label in all interface languages without saving or translating custom names', async () => {
  let locale: ReturnType<typeof useI18n>;
  let custom = false;
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects') ? {
    activeId: 'project', projects: [
      { id: 'project', title: 'OpenMotion 示例短片', titleKey: custom ? null : 'OpenMotion Sample Video' },
      { id: second, title: 'OpenMotion 示例短片' },
    ],
  } : { ...status, projectId: 'project' }));
  const wait = async () => {};
  function Harness() { locale = useI18n(); workspace = useWorkspace(wait, 'project'); return null; }
  await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><Harness /></I18nProvider>));
  for (const { locale: language } of languages) {
    act(() => locale.setLocale(language));
    expect(workspace.projects[0].title).toBe(translate(language, 'OpenMotion Sample Video'));
    if (language !== 'en') expect(workspace.projects[0].title).not.toBe('OpenMotion Sample Video');
    expect(workspace.projects[1].title).toBe('OpenMotion 示例短片');
  }
  custom = true;
  await act(async () => workspace.retryConnection());
  act(() => locale.setLocale('en'));
  expect(workspace.projects[0].title).toBe('OpenMotion 示例短片');
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});

it('reconnects with read requests only and clears a recovered polling failure', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
  await mount(async () => {}, first);
  expect(workspace.errorSource).toBe('connection');
  expect(workspace.error).toBe('Failed to fetch');
  fetcher.mockImplementation(original);
  await act(async () => workspace.retryConnection());
  expect(workspace.error).toBe('');
  expect(workspace.checkingConnection).toBe(false);
  expect(writes()).toHaveLength(0);
  expect(navigate).not.toHaveBeenCalled();
});

it('does not erase a failed operation when a later connection check succeeds', async () => {
  await mount(async () => { throw new Error('Unsaved edit'); }, first);
  await act(() => workspace.create());
  await act(async () => workspace.retryConnection());
  expect(workspace.error).toBe('Unsaved edit');
  expect(workspace.errorSource).toBe('operation');
  expect(writes()).toHaveLength(0);
});

it('keeps connection state independent of operation errors and clearing them', async () => {
  vi.useFakeTimers();
  try {
    const original = fetcher.getMockImplementation()!;
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    await mount(async () => { throw new Error('Unsaved edit'); }, first);
    await act(async () => workspace.create());
    expect(workspace.errorSource).toBe('operation');
    expect(workspace.connectionError).toBe('Failed to fetch');
    act(() => workspace.clearError());
    expect(workspace.connectionError).toBe('Failed to fetch');
    await act(async () => workspace.create());
    fetcher.mockImplementation(original);
    await act(async () => vi.advanceTimersByTimeAsync(1800));
    expect(workspace.connectionError).toBe('');
    expect(workspace.error).toBe('Unsaved edit');
    expect(writes()).toHaveLength(0);
  } finally { vi.useRealTimers(); }
});

it('waits for saves, deduplicates rapid actions and opens the new project in a new document', async () => {
  let saved!: () => void;
  const pending = new Promise<void>(resolve => { saved = resolve; });
  await mount(() => pending, first);
  let operation!: Promise<boolean>;
  act(() => { operation = workspace.create(); });
  await act(async () => { await workspace.open('projects', second); });
  expect(writes()).toHaveLength(0);
  await act(async () => { saved(); await operation; });
  expect(writes()).toHaveLength(1);
  expect(writes()[0][0]).toBe(`/motion-api/projects?projectId=${first}`);
  expect(JSON.parse(writes()[0][1]!.body as string)).toEqual({ expectedRevision: status.revision, expectedProjectId: first });
  expect(navigate).toHaveBeenCalledWith(`/editor/${second}#project/${second}`);
});
it('save failures prevent creating, switching and leaving for home', async () => {
  await mount(async () => { throw new Error('Unsaved edit'); }, first);
  for (const action of [() => workspace.create(), () => workspace.open('projects', second), () => workspace.home()]) {
    await act(action);
    expect(workspace.busy).toBe(false);
    expect(workspace.error).toBe('Unsaved edit');
  }
  expect(writes()).toHaveLength(0);
  expect(navigate).not.toHaveBeenCalled();
});
it('a rejected switch stays in the original session and can be retried', async () => {
  await mount(async () => {}, first);
  fetcher.mockImplementation(async (_url: string, init?: RequestInit) => new Response(JSON.stringify(init?.method === 'POST' ? { error: 'Revision changed' } : status), { status: init?.method === 'POST' ? 409 : 200 }));
  await act(() => workspace.open('projects', second));
  expect(workspace.error).toBe('Revision changed');
  expect(workspace.busy).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
});
it('home stays home when another client switches the active project', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  await mount(async () => {});
  expect(workspace.status?.projectId).toBe(first);
  expect(replace).not.toHaveBeenCalled();
  await act(() => workspace.home());
  expect(navigate).toHaveBeenCalledWith('/');
  expect(writes()).toHaveLength(0);
});
it('an existing project page polls its own project without following another client', async () => {
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects')
    ? { activeId: second, projects: [{ id: first }, { id: second }] }
    : new URL(url, location.origin).searchParams.get('projectId') === first ? status : { ...status, projectId: second }));
  await mount(async () => {}, first, first);
  expect(workspace.status?.projectId).toBe(first);
  expect(replace).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.some(([url]) => url === `/motion-api/project/status?projectId=${first}`)).toBe(true);
});
it('an empty conversation opens its own first artifact even when another project is globally active', async () => {
  history.replaceState(null, '', '/editor?session=conversation');
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects')
    ? { projects: [], sessions: [{ id: 'conversation', artifacts: [{ id: 'artifact-a', projectId: first }], activeArtifactId: 'artifact-a' }] }
    : { ...status, projectId: second }));
  await mount(async () => {}, undefined, 'conversation');
  expect(replace).toHaveBeenCalledWith(`/editor/${first}?session=conversation&openArtifact=1#project/${first}`);
});
it('keeps a home request after failure and clears it only once the project was created with that request', async () => {
  await mount(async () => {});
  localStorage.setItem('motion.home.draft.v1', 'Make a launch video');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => init?.method === 'POST'
    ? new Response(JSON.stringify({ error: 'Creation failed' }), { status: 503 }) : original(url, init));
  await act(() => workspace.create('Make a launch video'));
  expect(localStorage.getItem('motion.home.draft.v1')).toBe('Make a launch video');
  expect(navigate).not.toHaveBeenCalled();
  fetcher.mockImplementation(original);
  await act(() => workspace.create('Make a launch video'));
  expect(JSON.parse(writes()[1][1]!.body as string).instruction).toBe('Make a launch video');
  expect(localStorage.getItem('motion.home.draft.v1')).toBeNull();
  expect(navigate).toHaveBeenCalledWith(`/editor/${second}#project/${second}`);
});
it('creates the conversation before generating an artifact and retains it when generation fails', async () => {
  await mount(async () => {});
  localStorage.setItem('motion.home.draft.v1', 'New film');
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/design-api/sessions' && init?.method === 'POST') return new Response(JSON.stringify({ sessionId: 'new-session' }));
    if (url.endsWith('/artifacts')) return new Response(JSON.stringify({ error: 'Generation failed' }), { status: 503 });
    return original(url, init);
  });
  await act(() => workspace.startSession('New film', 'product-promo'));
  expect(writes().map(call => call[0])).toEqual(['/design-api/sessions', '/design-api/sessions/new-session/artifacts']);
  expect(navigate).toHaveBeenCalledWith('/editor?session=new-session');
  expect(localStorage.getItem('motion.home.draft.v1')).toBeNull();
  expect(sessionStorage.getItem('opendesign.session-error:new-session')).toBe('Generation failed');
});
it('activates the viewer when an external Agent produces an artifact for an open empty conversation', async () => {
  history.replaceState(null, '', '/editor?session=conversation');
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/projects') ? new Response(JSON.stringify({ projects: [], sessions: [{ id: 'conversation', artifacts: [{ id: 'artifact', projectId: first }] }] })) : original(url, init));
  await mount(async () => {}, undefined, 'conversation');
  expect(replace).toHaveBeenCalledWith(`/editor/${first}?session=conversation&openArtifact=1#project/${first}`);
});

it.each([
  '/explore?session=conversation',
  '/motion?session=conversation',
  '/settings/providers?session=conversation',
  '/settings/mcp?session=conversation',
  '/model-hub/gemini-4?session=conversation',
  '/models/custom%3Aprovider%2Fmodel?session=conversation',
  '/mcp-setup?session=conversation&host=codex',
  '/brand-kit/mine?session=conversation',
  '/skills/manim?session=conversation',
  '/studios/3d?session=conversation',
  '/studios/3d/text-to-video?session=conversation',
  '/studios/game?session=conversation&game=done',
  '/scenarios?session=conversation',
  '/scenarios/black-friday?session=conversation',
  '/assets?session=conversation',
  '/assets/asset-1?session=conversation',
  '/design/prototype?session=conversation',
  '/design/projects/d-1?session=conversation',
  '/cinema?session=conversation',
  '/cinema/text-to-video?session=conversation',
  '/sound?session=conversation',
  '/sound/sfx?session=conversation',
  '/audio/music?session=conversation',
  '/create/text-to-image?session=conversation',
])('keeps migrated standalone path %s open when a retained session gains an artifact', async standaloneHref => {
  history.replaceState(null, '', standaloneHref);
  const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => {});
  const onNavigate = vi.fn();
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url: string, init?: RequestInit) => url.endsWith('/projects')
    ? new Response(JSON.stringify({ projects: [], sessions: [{ id: 'conversation', artifacts: [{ id: 'artifact', projectId: first }] }] }))
    : original(url, init));
  await mount(async () => {}, undefined, 'conversation', onNavigate);
  expect(replace).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
});

it('unlocks actions after an in-page switch and scopes subsequent polling to the next project', async () => {
  const onNavigate = vi.fn();
  await mount(async () => {}, first, first, onNavigate);
  await act(() => workspace.open('projects', second));
  expect(onNavigate).toHaveBeenCalledWith(`/editor/${second}#project/${second}`);
  expect(navigate).not.toHaveBeenCalled();
  expect(workspace.busy).toBe(false);
  fetcher.mockImplementation(async (url: string) => Response.json(url.endsWith('/projects') ? { projects: [] } : { ...status, projectId: second }));
  await mount(async () => {}, second, second, onNavigate);
  expect(workspace.status?.projectId).toBe(second);
  expect(workspace.error).toBe('');
});

it.each([false, true])('guards browser history navigation before replacing the project (save failure=%s)', async failure => {
  const originalUrl = `/editor/${first}?session=${first}#project/${first}`;
  const targetUrl = `/editor/${second}?session=${second}#project/${second}`;
  history.replaceState(null, '', originalUrl);
  let finishSave!: () => void;
  const pending = new Promise<void>(resolve => { finishSave = resolve; });
  const onNavigate = vi.fn();
  await mount(async () => { await pending; if (failure) throw new Error('Unsaved edit'); }, first, first, onNavigate);
  await act(async () => {
    history.replaceState(null, '', targetUrl);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(onNavigate).not.toHaveBeenCalled();
  await act(async () => finishSave());
  if (failure) {
    expect(onNavigate).not.toHaveBeenCalled();
    expect(location.href).toBe(new URL(originalUrl, location.origin).href);
    expect(workspace.navigationError?.message).toBe('Unsaved edit');
  } else expect(onNavigate).toHaveBeenCalledWith(new URL(targetUrl, location.origin).href, true);
});
