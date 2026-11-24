// @vitest-environment happy-dom
import { skillCategories } from './skillCategories';
import { skillSubmissionUrl } from './SkillSubmissionLink';
import { templateContributionUrl } from './templateContribution';
import { act, useEffect } from 'react';
import { gemini4Videos } from './gemini4Videos';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { StudioCreation } from './CreativeWorkspace';
import { MotionApp } from './MotionApp';
import { I18nProvider } from '../i18n/I18n';
import { useWorkspaceChrome } from './WorkspaceFrame';
import { readWorkspacePage, settingsSections } from './workspacePageRouting';
import { editorProjectIdFromPath } from '../../../shared/spa-routes';
import { workspaceHistoryIndex, writeWorkspaceHistory } from '../utils/workspaceHistory';
import { preloadAllWorkspacePages } from '../router/lazyPages';
import { resetBannerDismissal } from './campaignAttribution';

const editor = vi.hoisted(() => ({ mounts: 0, fail: false, wait: async () => {} }));
vi.mock('./AssetsPage', () => ({ AssetsPage: ({ studio }: { studio?: StudioCreation }) => <input aria-label="Asset draft" defaultValue={studio?.initialDraft?.prompt ?? 'Asset prompt'} /> }));
vi.mock('./tracking', () => ({ trackMotion: vi.fn() }));
vi.mock('./ArtifactViewer', () => ({ ArtifactViewer: ({ artifact }: { artifact: { projectId: string } }) => {
  const { registerEditor } = useWorkspaceChrome();
  useEffect(() => {
    editor.mounts++;
    registerEditor({ blocked: false, saveState: '', message: '', waitForSaves: async () => {
      await editor.wait(); if (editor.fail) throw new Error('Unsaved edit');
    } });
    return () => registerEditor(null);
  }, [registerEditor]);
  return <input aria-label="Editor draft" data-project={artifact.projectId} defaultValue="Uncommitted text" />;
} }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => preloadAllWorkspacePages());
const first = '11111111-1111-1111-1111-111111111111', second = '22222222-2222-2222-2222-222222222222';
const firstUrl = `/?session=${first}&project=${first}&embed=1#project/${first}?v=1&t=12&tab=design&rc=0`;
const artifacts = [first, second].map(projectId => ({ id: projectId, projectId, kind: 'motion-project', title: projectId === first ? 'First project' : 'Second project' }));
const catalog = { activeId: first, projects: artifacts.map(item => ({ id: item.projectId, title: item.title })), sessions: artifacts.map(item => ({ id: item.id, artifacts: [item] })) };
const provider = { id: 'account', label: 'OpenDesign', protocol: 'account', category: 'account', kinds: ['text'], configured: false, enabled: false, available: false };
const info = { name: 'OpenMotion', version: '1.2.3', previewUrl: 'http://localhost', dataDirectory: '/fixture', templateSource: 'repository', tools: [], transport: { type: 'stdio', command: 'node', args: ['/fixture/mcp.ts'], env: { MOTION_DATA_DIR: '/fixture' } } };
let root: Root, container: HTMLDivElement, fetcher: ReturnType<typeof vi.fn>;
const page = () => readWorkspacePage(location.search, location.hash, location.pathname);
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)!;
const click = async (label: string) => { expect(button(label), label).toBeTruthy(); await act(async () => button(label).click()); };
async function accountAction(label: string) {
  await click('Account menu');
  const item = [...document.querySelectorAll<HTMLElement>('.om-account-menu [role="menuitem"]')].find(node => node.querySelector('.om-menu-label')?.textContent === label);
  expect(item, label).toBeTruthy();
  await act(async () => item!.click());
}
async function openMcp() {
  await click('MCP');
}
async function clickWorkspaceBack() {
  await act(async () => { button('Back').click(); await new Promise(resolve => setTimeout(resolve, 0)); });
}
const traverse = async (delta: number) => { await act(async () => { history.go(delta); await new Promise(resolve => setTimeout(resolve, 0)); }); };
const settingsBack = () => container.querySelector<HTMLButtonElement>('.om-settings-heading > button.om-nav-item');
const leaveSettings = async () => {
  expect(settingsBack()?.textContent).toBe('Go back');
  await act(async () => { settingsBack()!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
};
const breadcrumb = () => container.querySelector<HTMLAnchorElement>('.om-workspace-breadcrumb a');
const returnThroughBreadcrumb = async (label: string) => {
  const link = breadcrumb();
  expect(link?.textContent).toBe(label);
  await act(async () => { link!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
};
async function mount(key = 0) { await act(async () => root.render(<I18nProvider initialLocale="en"><MotionApp key={key} /></I18nProvider>)); }
beforeEach(() => {
  localStorage.clear(); history.replaceState(null, '', firstUrl);
  editor.mounts = 0; editor.fail = false; editor.wait = async () => {};
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, location.origin), projectId = url.searchParams.get('projectId') ?? first;
    if (url.pathname.endsWith('/projects') && !init?.method) return Response.json(catalog);
    if (url.pathname.includes('/sessions/')) return Response.json(catalog.sessions.find(item => url.pathname.endsWith(item.id)));
    if (url.pathname.includes('/projects/') && url.pathname.endsWith('/open')) return Response.json({ projectId: url.pathname.split('/').at(-2), revision: 'r' });
    // The OpenAI preset carries media kinds, so it stays visible in the provider list.
    if (url.pathname.endsWith('/settings/providers')) return Response.json({ providers: [provider, { ...provider, id: 'openai', label: 'OpenAI', protocol: 'openai', category: 'multimodal', kinds: ['text', 'image', 'audio'] }], models: [], defaults: {} });
    if (url.pathname.endsWith('/integration')) return Response.json(info);
    if (url.pathname.endsWith('/brand-kits')) return Response.json({ kits: [] });
    if (url.pathname.endsWith('/brand-kits/catalog')) return Response.json({ schemaVersion: 1, entries: [] });
    if (url.pathname.endsWith('/design/catalog/templates')) {
      const scenario = url.searchParams.get('scenario') ?? 'prototype';
      return Response.json({ items: [{ id: `fixture-${scenario}`, title: `Design ${scenario} fixture`, description: 'Starter design.', scenario, category: scenario, tags: [], previewUrl: 'data:text/html,Design%20template' }], nextCursor: null });
    }
    if (url.pathname.endsWith('/template-catalog')) return Response.json({ items: [{ id: 'product-promo', title: 'Product Promo', description: 'A slow product reveal.', kind: 'builtin', tags: [] }], next: null, catalogVersion: 'test' });
    return Response.json({ projectId, revision: 'r', version: '1.2.3', agents: [], defaults: {}, state: 'signed-out' });
  });
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

it('cold-loads whitelisted semantic SPA path URLs directly into the requested surface', async () => {
  history.replaceState(null, '', '/settings/providers');
  await mount(0);
  expect(container.querySelector('.om-provider-settings')).not.toBeNull();
  expect(container.querySelector('.om-settings-sections [aria-current=page]')?.textContent).toContain('Model providers');
  expect(container.querySelector('.om-explore-host')).toBeNull();

  history.replaceState(null, '', '/assets');
  await mount(1);
  expect(container.querySelector<HTMLElement>('.om-assets-host')?.hidden).toBe(false);
  expect(container.querySelector('[aria-label="Asset draft"]')).not.toBeNull();

  history.replaceState(null, '', '/motion');
  await mount(2);
  expect(container.querySelector('main[aria-label="Motion templates"]')).not.toBeNull();

  history.replaceState(null, '', '/mcp-setup/claude');
  await mount(3);
  expect(container.querySelector('#mcp-title')?.textContent).toContain('Claude Code');

  history.replaceState(null, '', `/editor/${second}`);
  await mount(4);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
});

it('redirects legacy Phase 4a, 4b, and 4c query bookmarks to canonical semantic paths via replace while preserving orthogonal params', async () => {
  const cases = [
    ['/?page=brand-kit&kit=mine&embed=1#project/' + first, '/brand-kit/mine', 'embed=1'],
    ['/?page=mcp&host=claude&setup=manual&embed=1#project/' + first, '/mcp-setup', 'host=claude'],
    ['/?page=model-hub&hub=gemini-4&embed=1', '/model-hub/gemini-4', 'embed=1'],
    ['/?page=skills&skillCategory=Motion+techniques&embed=1', '/skills', 'category=Motion+techniques'],
    ['/?page=assets&asset=a1&version=v1&embed=1#project/' + first, '/assets/a1', 'version=v1'],
    ['/?page=scenarios&category=campaign&embed=1', '/scenarios', 'category=campaign'],
    ['/?page=scenario&scenario=black-friday&mode=agent&embed=1', '/scenarios/black-friday', 'mode=agent'],
    ['/?page=design&scene=deck&embed=1', '/design/deck', 'embed=1'],
    ['/?page=cinema&scene=text-to-video&embed=1', '/cinema/text-to-video', 'embed=1'],
    ['/?page=sound&home=1&embed=1', '/sound', 'embed=1'],
    ['/?page=audio&scene=sfx&embed=1', '/audio/sfx', 'embed=1'],
    ['/?page=3d&skill=three-js&embed=1', '/studios/3d', 'skill=three-js'],
    ['/?page=explore&community=product-films&embed=1', '/explore', 'community=product-films'],
    ['/?page=motion&embed=1', '/motion', 'embed=1'],
    ['/?page=settings&section=providers&entry_from=agent_providers&embed=1', '/settings/providers', 'entry_from=agent_providers'],
    ['/?page=settings&section=mcp&host=claude&embed=1', '/settings/mcp', 'host=claude'],
    [`/?project=${first}&session=${first}&embed=1#project/${first}`, `/editor/${first}`, 'embed=1'],
  ] as const;
  for (const [index, [legacyHref, expectedPath, expectedQueryPart]] of cases.entries()) {
    history.replaceState(null, '', legacyHref);
    const beforeLength = history.length;
    await mount(index);
    expect(location.pathname).toBe(expectedPath);
    expect(location.search).toContain(expectedQueryPart);
    expect(history.length).toBe(beforeLength);
  }
});

it.each(settingsSections)('restores a copied %s page on a fresh mount', async section => {
  const query = section === 'mcp' ? 'page=mcp&host=claude&setup=manual' : `page=settings&section=${section}`;
  history.replaceState(null, '', firstUrl.replace('#', `&${query}#`));
  for (const key of [0, 1]) {
    await mount(key);
    expect(page().settings).toBe(section);
    expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(true);
    if (section === 'mcp') {
      expect(breadcrumb()).toBeNull();
      expect(container.querySelector('#mcp-title')?.textContent).toContain('Claude Code');
      expect(container.querySelector('[role=tab][data-state=active]') || container.querySelector('a[download]')).toBeTruthy();
      expect(container.querySelector('a[download]')?.getAttribute('href')).toBe('/connect/config?host=claude');
    } else if (section === 'brand-kit') expect(document.querySelector('.om-gallery-collection-tabs [aria-current=page]')?.textContent).toContain('Official collection');
    else expect(container.querySelector('.om-settings-sections [aria-current=page]')?.textContent).toBeTruthy();
    expect(location.hash).toContain('t=12');
  }
});

it('keeps the Brand Kit collection in browser history and copied URLs', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=brand-kit#'));
  const activeTab = () => document.querySelector('.om-gallery-collection-tabs [aria-current=page]')?.textContent;
  await mount();
  expect(activeTab()).toBe('Official collection');
  await click('My brand kits');
  expect(page().brandKit).toBe('mine');
  expect(activeTab()).toBe('My brand kits');
  await traverse(-1);
  expect(activeTab()).toBe('Official collection');
  await traverse(1);
  expect(activeTab()).toBe('My brand kits');
  await mount(1);
  expect(activeTab()).toBe('My brand kits');
});

it('navigates settings, MCP tabs and history without remounting or flushing the editor', async () => {
  await mount(); const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  draft.value = 'Keep this edit'; const wait = vi.fn(async () => {}); editor.wait = wait;
  await accountAction('Settings'); expect(page().settings).toBe('general');
  expect(settingsBack()).not.toBeNull();
  expect(button('Close settings')).toBeUndefined();
  await click('Appearance'); expect(page().settings).toBe('appearance');
  await openMcp(); expect(page().settings).toBe('mcp');
  expect(breadcrumb()).toBeNull();
  await click('Claude Code'); await click('Manual setup');
  expect(page()).toMatchObject({ client: 'claude', setup: 'manual' });
  await traverse(-1); expect(page().setup).toBe('agent');
  expect(container.querySelector('[role=tab][aria-selected=true]')?.textContent).toBe('Claude Code');
  await traverse(-1); expect(page().client).toBe('codex');
  await traverse(-1); expect(page().settings).toBe('appearance');
  await traverse(1); expect(page().settings).toBe('mcp');
  expect(settingsBack()).toBeNull();
  expect(button('Close settings')).toBeUndefined();
  await click('Explore'); expect(page()).toMatchObject({ explore: true, settings: null });
  expect(container.querySelector('input[aria-label="Editor draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this edit'); expect(editor.mounts).toBe(1); expect(wait).not.toHaveBeenCalled();
  expect(location.search).toContain('embed=1'); expect(location.hash).toContain('t=12');
});

it('keeps one history entry per page and returns to the resolved editor after a reload', async () => {
  history.replaceState(null, '', '/?page=editor');
  const initialLength = history.length;
  await mount();
  const home = location.href;
  expect(editorProjectIdFromPath(new URL(home).pathname)).toBe(first);
  expect(history.length).toBe(initialLength);

  await openMcp();
  await accountAction('Settings');
  await click('Appearance');
  expect(history.length).toBe(initialLength + 3);
  const entry = workspaceHistoryIndex();
  await click('Appearance');
  // The editor can update its playhead while hidden. This must update only the
  // current entry, preserving the page stack and its position through a reload.
  await act(async () => writeWorkspaceHistory(`#project/${first}?v=1&t=42`, true));
  expect(history.length).toBe(initialLength + 3);
  expect(workspaceHistoryIndex()).toBe(entry);
  await mount(1);
  expect(page().settings).toBe('appearance');

  await traverse(-1); expect(page().settings).toBe('general');
  await traverse(-1); expect(page().settings).toBe('mcp');
  await traverse(-1);
  expect(location.href).toBe(home);
  expect(page().settings).toBeNull();
  expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(false);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(first);
  await traverse(1); expect(page().settings).toBe('mcp');
  await traverse(1); expect(page().settings).toBe('general');
  await traverse(1); expect(page().settings).toBe('appearance');
  expect(location.hash).toContain('t=42');
  expect(history.length).toBe(initialLength + 3);
});

it('restores provider details and returns to the providers list through history', async () => {
  await mount(); await click('Model providers');
  await act(async () => [...container.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(node => node.textContent?.includes('OpenAI'))!.click());
  expect(page().provider).toBe('openai');
  await mount(1); expect(container.querySelector('.om-provider-items [aria-current=page]')?.textContent).toContain('OpenAI');
  expect(container.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('true');
  await traverse(-1); expect(page().provider).toBeNull();
  expect(container.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('false');
});

it('uses browser history across settings, reloads and new navigation branches', async () => {
  await mount();
  const header = container.querySelector('.om-app-header')!;
  expect(header.querySelector('button[aria-label="Back"], button[aria-label="Forward"]')).toBeNull();
  await openMcp(); await accountAction('Settings');
  await traverse(-1); expect(page().settings).toBe('mcp');
  await mount(1);
  await traverse(1); expect(page().settings).toBe('general');
  await traverse(-1); await traverse(-1);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(first);
  await traverse(1); expect(page().settings).toBe('mcp');
  await accountAction('Help'); await traverse(1); expect(page().settings).toBe('help');
});

it('uses browser history between the template gallery, its preview and the originating page', async () => {
  const detail = 'dialog[aria-label="Template preview"]';
  await mount(); await openMcp(); await click('Explore templates');
  const header = container.querySelector('dialog[aria-label="Template library"] header')!;
  expect(header.querySelector('button[aria-label="Back"], button[aria-label="Forward"]')).toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-template-id="product-promo"] button')!.click());
  expect(container.querySelector(`${detail} > header`)).toBeNull();
  expect(container.querySelector(`${detail} button[aria-label="Close template preview"]`)).not.toBeNull();
  expect(container.querySelector(`${detail} button[aria-label="Previous template"]`)).not.toBeNull();
  expect(container.querySelector(`${detail} button[aria-label="Next template"]`)).not.toBeNull();
  await traverse(-1); expect(page().template).toBeNull();
  await traverse(1); expect(page().template).toBe('product-promo');
  await traverse(-1); await traverse(-1);
  expect(page()).toMatchObject({ settings: 'mcp', templates: false });
});

it('restores template details from a copied link and closes back to the originating MCP page', async () => {
  await mount(); await openMcp(); await click('Claude Code'); await click('Explore templates');
  expect(page()).toMatchObject({ templates: true, settings: 'mcp' });
  await act(async () => container.querySelector<HTMLButtonElement>('[data-template-id="product-promo"] button')!.click());
  expect(page().template).toBe('product-promo');
  await mount(1);
  expect(container.querySelector('dialog[aria-label="Template preview"] h2')?.textContent).toBe('Product Promo');
  await traverse(-1); expect(page().template).toBeNull();
  expect(container.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')?.open).toBe(false);
  await traverse(1); expect(container.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')?.open).toBe(true);
  await click('Close template preview'); await click('Close template library');
  expect(page()).toMatchObject({ templates: false, template: null, settings: 'mcp', client: 'claude' });
  expect(container.querySelector('#mcp-title')?.textContent).toContain('Claude Code');
});

it('keeps an MCP showcase selection in the URL through history and reloads', async () => {
  await mount(); await openMcp(); await click('Claude Code');
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]');
  await click('Preview template Product Promo');
  expect(page()).toMatchObject({ templates: false, template: 'product-promo', settings: 'mcp', client: 'claude' });
  expect(container.querySelector('dialog[aria-label="Template preview"] h2')?.textContent).toBe('Product Promo');
  await traverse(-1);
  expect(page()).toMatchObject({ templates: false, template: null, settings: 'mcp', client: 'claude' });
  expect(container.querySelector('dialog[aria-label="Template library"]')).toBeNull();
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  expect(editor.mounts).toBe(1);
  await traverse(1);
  expect(container.querySelector('dialog[aria-label="Template preview"] h2')?.textContent).toBe('Product Promo');
  await mount(1);
  expect(container.querySelector('dialog[aria-label="Template preview"] h2')?.textContent).toBe('Product Promo');
  await click('Close template preview');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(container.querySelector('[data-motion-template-library]')).toBeNull();
  expect(page()).toMatchObject({ templates: false, template: null, settings: 'mcp', client: 'claude' });
});

it.each(['motion', 'marketing'])('opens a card over %s while the full catalogue is pending and restores the trigger', async studio => {
  history.replaceState(null, '', firstUrl.replace('#', `&page=${studio}#`));
  const fallback = fetcher.getMockImplementation()!;
  let catalogRequests = 0;
  fetcher.mockImplementation((input: string, options?: RequestInit) => {
    if (!input.includes('limit=60') || (studio === 'motion' && catalogRequests++ === 0)) return fallback(input, options);
    return new Promise<Response>(() => {});
  });
  await mount();
  const shelf = container.querySelector(studio === 'motion' ? '.om-explore-shelf[aria-label="Motion templates"]' : '.om-studio-template-shelf')!;
  const card = shelf.querySelector<HTMLButtonElement>('[data-template-id="product-promo"] button')!;
  await act(async () => card.click());
  const detail = container.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
  expect(detail.open).toBe(true);
  expect(detail.querySelector('h2')?.textContent).toBe('Product Promo');
  expect(container.querySelector('[data-motion-template-library]')).toBeNull();
  expect(shelf.isConnected).toBe(true);
  await act(async () => {
    detail.dispatchEvent(new Event('cancel', { cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  expect(page().template).toBeNull();
  expect(document.activeElement).toBe(card);
  expect(location.pathname).toBe(studio === 'marketing' ? '/studios/marketing' : '/motion');
  expect(location.hash).toContain('t=12');
});

it('keeps loading, retry and missing-link recovery inside a standalone preview', async () => {
  history.replaceState(null, '', '/?page=motion&template=missing');
  const fallback = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((input: string, options?: RequestInit) =>
    input.includes('limit=60') ? new Promise<Response>(resolve => { finish = resolve; }) : fallback(input, options));
  await mount();
  const detail = container.querySelector<HTMLDialogElement>('dialog[aria-label="Template preview"]')!;
  expect(detail.open).toBe(true);
  expect(detail.querySelector('[role=status]')?.textContent).toBe('Loading preview…');
  expect(container.querySelector('[data-motion-template-library]')).toBeNull();
  await act(async () => finish(Response.json({ error: 'Offline' }, { status: 503 })));
  expect(detail.querySelector('[role=alert]')?.textContent).toContain('Offline');
  await act(async () => [...detail.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
  await act(async () => finish(Response.json({ items: [], next: null })));
  expect(detail.querySelector('[role=alert]')?.textContent).toBe('This template is no longer available.');
  await click('Close template preview');
  expect(location.pathname).toBe('/motion');
  expect(location.search).toBe('');
  expect(container.querySelector('[data-motion-template-library]')).toBeNull();
});

it('keeps project rows in place while switching, updating selection and reloading', async () => {
  const original = fetcher.getMockImplementation()!;
  const opened: Record<string, number> = { [first]: 20, [second]: 10 };
  let activeId = first, clock = 20;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (url.pathname.endsWith('/projects') && !init?.method) return Response.json({
      ...catalog, activeId,
      projects: catalog.projects.map(project => ({ ...project, openedAt: opened[project.id] })),
      sessions: catalog.sessions.map(session => ({ ...session, openedAt: opened[session.id] })),
    });
    if (url.pathname.includes('/projects/') && url.pathname.endsWith('/open') && init?.method === 'POST') {
      activeId = url.pathname.split('/').at(-2)!;
      opened[activeId] = ++clock;
      return Response.json({ projectId: activeId, revision: 'r' });
    }
    return original(input, init);
  });
  const rows = () => [...container.querySelectorAll('.motion-session-list button strong')].map(node => node.textContent);
  const selected = () => container.querySelector('.motion-session-list button[aria-current="page"] strong')?.textContent;
  await mount();
  const initialOrder = rows();
  expect(initialOrder).toEqual(['First project', 'Second project']);
  expect(selected()).toBe('First project');
  for (const [title, projectId] of [['Second project', second], ['First project', first]]) {
    await click(title);
    expect(rows()).toEqual(initialOrder);
    expect(selected()).toBe(title);
    expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(projectId);
  }
  const switches = () => fetcher.mock.calls.filter(([, init]) => init?.method === 'POST');
  const completedSwitches = switches().length;
  await click('First project');
  expect(switches()).toHaveLength(completedSwitches);
  expect(rows()).toEqual(initialOrder);
  await mount(1);
  expect(rows()).toEqual(initialOrder);
  expect(selected()).toBe('First project');
});

it('restores a rejected project history entry without losing the later Forward destination', async () => {
  await mount(); await openMcp(); await click('Motion Studio'); await click('Open Motion Editor');
  await click('Second project');
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
  editor.fail = true;
  await traverse(-1); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(editorProjectIdFromPath(location.pathname)).toBe(second);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
  expect(document.querySelector('[data-feedback-layer] [role=alert]')).not.toBeNull();
  editor.fail = false;
  await traverse(-1); expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(first);
  await traverse(-1); expect(page().motion).toBe(true);
  await traverse(2); expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
});

it('opens settings without starting the retained project and resolves it only on entering the editor', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=mcp#'));
  await mount();
  expect(container.querySelector('#mcp-title')).not.toBeNull();
  expect(container.querySelector('[data-project]')).toBeNull();
  expect(fetcher.mock.calls.some(([url]) => url.includes('/preview/open'))).toBe(false);
  await click('OpenDesign · Back to Explore');
  expect(page().explore).toBe(true);
  expect(container.querySelector('.om-app-brand')?.getAttribute('aria-label')).toBe('OpenDesign');
  expect(container.querySelector('.om-app-rail, [data-project]')).toBeNull();
  await click('Motion Studio'); await click('Open Motion Editor');
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(first);
  expect(fetcher.mock.calls.some(([url]) => url.includes('/preview/open'))).toBe(true);
});

it('ignores an older pending history navigation after the user returns to the current project', async () => {
  await mount(); await click('Second project'); await openMcp(); await traverse(-1);
  let finish!: () => void;
  editor.wait = () => new Promise(resolve => { finish = resolve; });
  await traverse(-1);
  expect(editorProjectIdFromPath(location.pathname)).toBe(second);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
  // While the blocked Back save flush is pending, navigating to another page on the
  // current project and returning supersedes the older pending navigation.
  await traverse(1);
  await traverse(-1);
  await act(async () => finish());
  expect(editorProjectIdFromPath(location.pathname)).toBe(second);
  expect(container.querySelector('[data-project]')?.getAttribute('data-project')).toBe(second);
});

it('reports a missing bookmarked template and recovers without changing the retained page', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=mcp&templates=1&template=missing#'));
  await mount();
  expect(container.textContent).toContain('This template is no longer available.');
  await act(async () => container.querySelector<HTMLButtonElement>('dialog[aria-label="Template library"] [role=alert] button')!.click());
  expect(page()).toMatchObject({ settings: 'mcp', templates: true, template: null });
  expect(container.textContent).not.toContain('This template is no longer available.');
});


it('keeps Assets and editor drafts mounted across page history and restores the Assets deep link', async () => {
  await mount();
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  draft.value = 'Keep editor draft';
  const folder = container.querySelector<HTMLButtonElement>('.om-app-header-actions [aria-label="Workspace assets"]')!;
  const brandKit = container.querySelector<HTMLButtonElement>('.om-app-header-actions [aria-label="Brand Kit"]')!;
  const actions = [...container.querySelectorAll('.om-app-header-actions button')];
  expect(actions[actions.indexOf(brandKit) + 1]).toBe(folder);
  expect(container.querySelector('.om-app-rail :is([aria-label="Brand Kit"], [aria-label="Skills"], [aria-label="Template library"])')).toBeNull();
  expect(container.querySelector('.om-app-rail :is([aria-label="Workspace assets"], [aria-label="MCP · Connect Agent"])')).toBeNull();
  await act(async () => folder.click());
  expect(folder.getAttribute('aria-current')).toBe('page');
  expect(page().assets).toBe(true);
  const assetDraft = container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')!;
  assetDraft.value = 'Keep asset prompt';
  await act(async () => brandKit.click());
  expect(brandKit.getAttribute('aria-current')).toBe('page');
  expect(page()).toMatchObject({ assets: false, settings: 'brand-kit' });
  expect(container.querySelector<HTMLElement>('.om-assets-host')?.hidden).toBe(true);
  await click('New Brand Kit');
  expect(page().brandKit).toBe('new');
  await click('All brand kits'); await click('Close Brand Kit'); await click('Workspace assets');
  expect(page()).toMatchObject({ assets: true, settings: null, brandKit: null });
  expect(container.querySelector('[aria-label="Asset draft"]')).toBe(assetDraft);
  expect(assetDraft.value).toBe('Keep asset prompt');
  await accountAction('Settings');
  expect(page().assets).toBe(false);
  expect(container.querySelector<HTMLElement>('.om-assets-host')?.hidden).toBe(true);
  await traverse(-1);
  expect(page().assets).toBe(true);
  expect(container.querySelector('[aria-label="Asset draft"]')).toBe(assetDraft);
  expect(assetDraft.value).toBe('Keep asset prompt');
  await click('OpenDesign · Back to Explore');
  expect(page().assets).toBe(false);
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep editor draft');
  expect(editor.mounts).toBe(1);
  history.replaceState(null, '', firstUrl.replace('#', '&page=assets#'));
  await mount(1);
  expect(page().assets).toBe(true);
  expect(container.querySelector<HTMLElement>('.om-assets-host')?.hidden).toBe(false);
});

it('switches studios and restores a scene through history while retaining the editor', async () => {
  await mount();
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  await click('Design Studio');
  expect(page().designScene).toBe('prototype');
  const designPage = container.querySelector('.om-design-template-page')!;
  expect(designPage.querySelector('.om-studio-landing-hero + section h2')?.textContent).toBe('Design templates');
  const categories = [...designPage.querySelectorAll('nav button')].map(node => node.textContent);
  expect(categories).toEqual(['Prototype', 'Mobile App', 'Slide deck', 'Document', 'Website clone', 'Live artifact', 'WebGL']);
  await click('Design prototype fixture');
  expect(document.querySelector('[role="dialog"][aria-label="Design prototype fixture"]')?.classList.contains('om-design-tpl-detail-popup')).toBe(true);
  await click('Close');
  expect(document.querySelector('.om-design-tpl-detail-popup')).toBeNull();
  await click('Slide deck');
  expect(page().designScene).toBe('deck');
  expect(button('Design deck fixture')).toBeTruthy();
  await click('Cinema Studio');
  expect(page()).toMatchObject({ cinemaLanding: true, studio: null });
  await traverse(-1);
  expect(page().designScene).toBe('deck');
  await click('Motion Studio');
  expect(page().motion).toBe(true);
  expect(container.querySelector('main[aria-label="Motion templates"]')).toBeTruthy();
  expect(container.querySelector('.motion-sidebar')).toBeNull();
  expect(container.querySelector('.motion-session-list [aria-current="page"]')).toBeNull();
  expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(true);
  await click('Open Motion Editor');
  expect(page().motion).toBe(false);
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  expect(location.hash).toContain('t=12');
});

it('opens the Template library directly from sidebar Motion templates and returns to the retained editor', async () => {
  await mount();
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  draft.value = 'Keep this edit';
  await click('Motion templates');
  expect(page()).toMatchObject({ motion: false, templates: true, templateCollection: null });
  expect(container.querySelector('#om-project-navigation')).toBeNull();
  expect(button('Open project list')).toBeUndefined();
  expect(container.querySelector('main[aria-label="Motion templates"] .om-discovery-hero')).toBeNull();
  expect(container.querySelector('[data-workspace-gallery] .om-gallery-page-label')?.textContent).toBe('Template library');
  const template = container.querySelector<HTMLButtonElement>('[data-workspace-gallery] [data-template-id="product-promo"] button')!;
  await act(async () => template.click());
  expect(page()).toMatchObject({ motion: false, templates: true, template: 'product-promo' });
  await click('Close template preview');
  await click('Close template library');
  expect(page()).toMatchObject({ motion: false, templates: false, template: null });
  expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(false);
  expect(container.querySelector('#om-project-navigation')?.getAttribute('aria-hidden')).toBe('false');
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this edit');
  expect(location.hash).toContain('t=12');
});

it('shows Motion Studio landing from the header, opens templates, and returns to the retained editor', async () => {
  await mount();
  const draft = container.querySelector<HTMLInputElement>('[aria-label="Editor draft"]')!;
  draft.value = 'Keep this edit';
  await click('Motion Studio');
  expect(page()).toMatchObject({ motion: true, templates: false });
  expect(container.querySelector('#om-project-navigation')).toBeNull();
  expect(button('Open project list')).toBeUndefined();
  expect(container.querySelector('main[aria-label="Motion templates"] .om-discovery-hero h1')?.textContent).toBe('Motion Studio');
  expect(fetcher.mock.calls.some(([input]) => {
    const url = new URL(input, location.origin);
    return url.pathname.endsWith('/template-catalog') && url.searchParams.get('category') === 'all';
  })).toBe(true);
  await click('Template library');
  expect(page()).toMatchObject({ templates: true, templateCollection: null });
  await traverse(-1);
  expect(page()).toMatchObject({ motion: true, templates: false });
  const template = container.querySelector<HTMLButtonElement>('[aria-label="Motion templates"] [data-template-id="product-promo"] button')!;
  await act(async () => template.click());
  expect(page()).toMatchObject({ motion: true, templates: false, template: 'product-promo' });
  await traverse(-1);
  await click('Open Motion Editor');
  expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(false);
  expect(container.querySelector('#om-project-navigation')?.getAttribute('aria-hidden')).toBe('false');
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  expect(draft.value).toBe('Keep this edit');
  expect(location.hash).toContain('t=12');
});

it('tracks active and expanded state on the sidebar All projects action while the dialog is open', async () => {
  await mount();
  const allProjects = button('All projects');
  expect(allProjects.getAttribute('aria-expanded')).toBe('false');
  expect(allProjects.getAttribute('data-active')).toBeNull();
  await click('All projects');
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('All projects');
  expect(allProjects.getAttribute('aria-expanded')).toBe('true');
  expect(allProjects.getAttribute('data-active')).toBe('true');
  await act(async () => document.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label="Close"]')!.click());
  expect(document.querySelector('[role=dialog]')).toBeNull();
  expect(allProjects.getAttribute('aria-expanded')).toBe('false');
  expect(allProjects.getAttribute('data-active')).toBeNull();
});

it('browses the complete Motion catalog in batches and filters by its existing tags', async () => {
  const fallback = fetcher.getMockImplementation()!;
  const entries = Array.from({ length: 19 }, (_, index) => ({
    id: 'motion-fixture-' + index, title: 'Motion fixture ' + index, kind: index === 18 ? 'builtin' : 'reference',
    tags: [], uses: [index === 18 ? 'Product demo' : 'Product launch'], styles: ['UI motion'],
    brand: index < 2 ? 'Acme' : 'Studio ' + index,
    industries: index === 18 ? ['Design & creative tools'] : ['Business software'],
  }));
  fetcher.mockImplementation((input: string, options?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.endsWith('/template-catalog')) return fallback(input, options);
    const firstPage = url.searchParams.get('offset') === '0';
    return Promise.resolve(Response.json({ items: firstPage ? entries.slice(0, 9) : entries.slice(9), next: firstPage ? 9 : null, catalogVersion: 'test' }));
  });
  await mount();
  await click('Motion Studio');
  const shelf = container.querySelector('[aria-label="Motion templates"] .om-explore-shelf')!;
  const cards = () => [...shelf.querySelectorAll('[data-template-id]')];
  expect(shelf.querySelector('[role="status"]')?.textContent).toBe('19 templates');
  expect(cards()).toHaveLength(16);
  expect(cards()[0].querySelector('.om-motion-template-tags')?.textContent).toBe('Product launch filmsUI motion');
  await click('More templates');
  expect(cards()).toHaveLength(19);
  expect(button('More templates')).toBeUndefined();
  await click('By industry');
  const industry = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === 'Business software')!;
  await act(async () => industry.click());
  expect(shelf.querySelector('[role="status"]')?.textContent).toBe('18 templates');
  expect(cards().slice(0, 2).map(card => card.getAttribute('data-template-id'))).toEqual(['motion-fixture-0', 'motion-fixture-2']);
  await click('More templates');
  expect(cards().at(-1)?.getAttribute('data-template-id')).toBe('motion-fixture-1');
  await click('Product demos & explainers');
  expect(cards().map(card => card.getAttribute('data-template-id'))).toEqual(['motion-fixture-18']);
  await click('Editable templates');
  expect(cards()).toHaveLength(1);
  await click('All');
  expect(cards()).toHaveLength(16);
});

it('restores the narrow Motion Studio landing and opens the editor from its banner', async () => {
  vi.stubGlobal('innerWidth', 700);
  history.replaceState(null, '', firstUrl.replace('#', '&page=motion#'));
  await mount();
  expect(container.querySelector('h1')?.textContent).toBe('Motion Studio');
  expect(container.querySelector('.om-studio-template-grid > article')?.getAttribute('data-new-project')).toBe('true');
  expect(container.querySelector('[aria-label="Editor draft"]')).toBeNull();
  expect(button('Open project list')).toBeUndefined();
  expect(document.querySelector('.motion-sidebar-drawer')).toBeNull();
  await click('Open Motion Editor');
  expect(page().motion).toBe(false);
  expect(container.querySelector('[aria-label="Editor draft"]')).not.toBeNull();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('surfaces a visible error toast when creating a blank project from Motion templates fails', async () => {
  const fallback = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path === '/motion-api/projects' && init?.method === 'POST') {
      return Response.json({ error: 'Project workspace is busy' }, { status: 409 });
    }
    return fallback(input, init);
  });
  history.replaceState(null, '', firstUrl.replace('#', '&page=motion#'));
  await mount();
  const createButton = container.querySelector<HTMLButtonElement>('[data-new-project="true"] button')!;
  expect(createButton).toBeTruthy();
  await act(async () => { createButton.click(); await Promise.resolve(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(page().motion).toBe(true);
  const toast = document.querySelector<HTMLElement>('[role="alert"] .hf-toast-surface');
  expect(toast).toBeTruthy();
  expect(toast?.closest('[hidden]')).toBeNull();
  expect(toast?.textContent).toContain('Project workspace is busy');
  await click('Explore');
  await click('Motion Studio');
  expect(document.querySelectorAll('[role="alert"] .hf-toast-surface')).toHaveLength(1);
});

it('shows audio feature cards, selectable models and spotlight in the Audio hover menu without mutating defaults', async () => {
  const speech = { id: 'voice:read/v2', provider: 'voice', modelId: 'read/v2', label: 'Narrator', modality: 'audio', mode: 'text-to-speech' };
  const fallback = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path === '/motion-api/models') return Response.json({ models: [speech], nextOffset: null });
    if (path === '/motion-api/models/capabilities') return Response.json({ providers: [{ id: 'voice', available: true }], routes: {} });
    return fallback(input, init);
  });
  await mount();
  await click('Audio · Scenes');
  const menu = document.querySelector('.om-creative-menu.om-creative-menu-audio')!;
  expect(menu).toBeTruthy();
  expect(menu.querySelector('[role="img"][aria-label="Narrator"]')).toBeTruthy();
  expect(menu.querySelector('[data-audio-spotlight="voice:read/v2"]')).toBeTruthy();
  const scene = [...menu.querySelectorAll<HTMLButtonElement>('.om-scene-tile')].find(card => card.querySelector('strong')?.textContent === 'Text to speech')!;
  await act(async () => scene.click());
  expect(page().studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'speech', modality: 'audio' }, mediaTab: true });
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('default-model'))).toBe(false);
  expect(document.querySelector('.om-creative-menu')).toBeNull();
});

it('opens a Video feature scene from Explore under Video without a legacy Cinema Studio exit', async () => {
  await mount();
  await click('Explore');
  expect(page().explore).toBe(true);
  await click('Video · Scenes');
  await click('Multi-shot');
  expect(page().studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'video-multi-shot', modality: 'video' }, landing: true });
  expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Multi-shot');
  expect(button('Video').getAttribute('aria-current')).toBe('location');
  expect(button('Image').getAttribute('aria-current')).toBeNull();
  expect(button('Cinema Studio').getAttribute('aria-current')).toBeNull();
  expect(location.pathname).toBe('/create/video-multi-shot');
  expect(container.querySelector('.om-studio-bar')?.textContent).not.toContain('Open in');
  await traverse(-1);
  expect(page().explore).toBe(true);
  await click('Generate with Open Design MCP');
  const clients = [...document.querySelectorAll<HTMLButtonElement>('.om-creative-client-menu button')];
  expect(clients.some(button => button.textContent?.includes('ChatGPT'))).toBe(false);
  const client = clients.find(button => button.textContent === 'Claude Code')!;
  await act(async () => client.click());
  expect(page()).toMatchObject({ explore: false, settings: 'mcp', client: 'claude' });
});

it('reports Explore once per arrival and its spotlight, index links and top navigation as catalogue ids', async () => {
  const { trackMotion } = await import('./tracking') as unknown as { trackMotion: ReturnType<typeof vi.fn> };
  // Load the (mocked) transport first so every report below is delivered before it is read.
  await (await import('./reporting')).loadReportingTransport();
  trackMotion.mockClear();
  const rows = () => trackMotion.mock.calls.map(([event, properties]) => ({ event: event as string, properties: properties as Record<string, unknown> }));
  const clicks = () => rows().filter(row => row.event === 'ui_click').map(row => row.properties);
  const exploreViews = () => rows().filter(row => row.event === 'page_view' && row.properties.page_name === 'explore');
  const inside = (selector: string, label: string) => [...container.querySelectorAll<HTMLButtonElement>(selector + ' button')]
    .find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label)!;
  await mount(); await click('Explore');
  expect(clicks().at(-1)).toMatchObject({ page_name: 'studio', area: 'creative_nav', element: 'nav_explore', nav_target: 'explore' });
  expect(exploreViews()).toHaveLength(1);
  expect(exploreViews()[0].properties).toMatchObject({ medium: 'all', has_project: true });
  await act(async () => inside('.om-explore-shelf[aria-label="Templates"]', 'Editable templates').click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'explore', area: 'explore_feed', element: 'category_select', collection_id: 'builtin' });
  await act(async () => inside('.om-explore-shelf[aria-label="Skills"]', 'Motion techniques').click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'explore', area: 'explore_feed', element: 'skill_category', skill_category: 'motion_techniques' });
  await click('Featured · Black Friday collection');
  expect(clicks().at(-1)).toMatchObject({ area: 'explore_spotlight', element: 'slide_select', slide_id: 'black-friday' });
  expect(exploreViews()).toHaveLength(1);
  await act(async () => inside('.om-explore-shelf[aria-label="Templates"]', 'View collection').click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'explore', area: 'explore_feed', element: 'view_all_templates', collection_id: 'builtin' });
  await traverse(-1);
  await act(async () => inside('.om-explore-shelf[aria-label="Skills"]', 'View all').click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'explore', area: 'explore_feed', element: 'open_skills', skill_category: 'motion_techniques' });
  await traverse(-1);
  await act(async () => inside('.om-capability-index', 'Cinema Studio').click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'explore', area: 'capability_index', element: 'open_studio', studio_id: 'cinema' });
  await act(async () => inside('.om-cinema-home', 'Create video').click());
  expect(location.pathname).toBe('/create/text-to-video');
  const nav = container.querySelector('.om-creative-navigation')!;
  await act(async () => [...nav.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === 'Design Studio')!.click());
  expect(clicks().at(-1)).toMatchObject({ page_name: 'creative_studio', area: 'creative_nav', element: 'nav_studio', studio_id: 'design', in_overflow: false });
  const { validProperties } = await import('../../../tracking/core.ts');
  const { studioEvents } = await import('../../../tracking/events.ts');
  for (const row of rows()) expect(validProperties(studioEvents, row.event as keyof typeof studioEvents, row.properties), JSON.stringify(row)).toBe(true);
});

it('shows mixed media in one Explore feed and opens templates and editing presets', async () => {
  await mount(); await click('Explore');
  const explore = container.querySelector('.om-explore')!;
  expect(explore.querySelector('nav[aria-label="Communities"], [aria-label="Media type"]')).toBeNull();
  const sections = [...explore.querySelector('.om-explore-sections')!.children];
  expect(sections[0].classList.contains('om-explore-features')).toBe(true);
  expect(sections[0].querySelector('.om-featured-caption strong')?.textContent).toBe('Product Promo');
  expect(sections[1].getAttribute('aria-labelledby')).toBe('explore-workflows');
  expect(sections[1].querySelector('#explore-workflows')?.textContent).toBe('Workflows');
  expect(sections[1].querySelector('header button')?.textContent).toBe('All workflows');
  expect(sections[2].getAttribute('aria-labelledby')).toBe('explore-highlights');
  const scenes = [...explore.querySelectorAll<HTMLElement>('.om-feed-group [data-scene]')];
  expect(scenes.map(card => card.dataset.scene)).toEqual(expect.arrayContaining(['image-edit', 'image-to-video', 'music', 'speech']));
  await click('Featured · Gemini 4 Neon');
  expect(container.querySelector('.om-discovery-hero')?.getAttribute('data-scene')).toBe('hub-gemini-4');
  await click('Preview template Product Promo');
  expect(page()).toMatchObject({ explore: true, templates: false, template: 'product-promo' });
  await traverse(-1);
  const feed = explore.querySelector('.om-feed-group')!;
  expect(feed.querySelector('.om-feed-card-label, .om-feed-card-detail')).toBeNull();
  const preset = [...feed.querySelectorAll<HTMLButtonElement>('.om-scene-tile')].find(button => button.textContent?.includes('Scored shortlist before shorts'))!;
  expect(preset.querySelector('.om-feed-skill-badge')?.textContent).toBe('Skill');
  expect(preset.querySelector('.om-feed-prompt-action.om-nav-item')?.textContent).toBe('Use Skill');
  await act(async () => preset.click());
  expect(page()).toMatchObject({ specialty: { id: 'shorts' }, skill: 'openmotion-shortlist-shorts' });
});

it('opens a collection with its filters and opens individual Explore cards directly', async () => {
  const fallback = fetcher.getMockImplementation()!;
  const item = (id: string, brand?: string) => ({ id, title: id, brand, author: 'Studio', tags: [], kind: 'reference' });
  const entries = [
    item('Unbranded'), { ...item('First launch', 'Figma'), uses: ['Product launch'] },
    { ...item('Second launch', 'Figma'), uses: ['Partnership announcement'] },
    { ...item('AI release', 'OpenAI'), uses: ['Community stories'] },
  ];
  fetcher.mockImplementation((input: string, options?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.endsWith('/template-catalog')) return fallback(input, options);
    const firstPage = url.searchParams.get('limit') === '60' && url.searchParams.get('offset') === '0';
    return Promise.resolve(Response.json({ items: firstPage ? entries.slice(0, 2) : entries.slice(2), next: firstPage ? 2 : null, catalogVersion: 'test' }));
  });
  await mount(); await click('Explore');
  const shelf = container.querySelector<HTMLElement>('.om-explore-shelf[aria-label="Templates"]')!;
  const pick = async (label: string) => {
    const target = [...shelf.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label)!;
    await act(async () => target.click());
  };
  const works = (root: Element) => [...root.querySelectorAll<HTMLElement>('[data-template-id]')].map(work => work.dataset.templateId);
  const library = () => container.querySelector<HTMLElement>('[data-motion-template-library]')!;
  await pick('Partnership announcements');
  expect(works(shelf)).toEqual(['Second launch']);
  await pick('View collection');
  expect(page().templateCollection).toBe('purpose:Partnership announcements');
  expect(library().querySelector('[aria-label="Video purpose"] [aria-pressed="true"]')?.textContent).toBe('Partnership announcements');
  expect(works(library())).toEqual(['Second launch']);
  await traverse(-1);
  await pick('Community stories');
  expect(works(shelf)).toEqual(['AI release']);
  await pick('TOP 100 brands');
  expect(works(shelf)).toEqual(['First launch', 'AI release']);
  await pick('View collection');
  expect(page().templateCollection).toBe('top-100-brands');
  expect(library().querySelector('[aria-label="TOP 100 brands"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(works(library())).toEqual(['First launch', 'Second launch', 'AI release']);
  const all = library().querySelector<HTMLButtonElement>('[aria-label="Video purpose"] button')!;
  await act(async () => all.click());
  expect(page().templateCollection).toBeNull();
  expect(works(library())).toContain('Unbranded');
  await traverse(-1);
  expect(shelf.querySelector('[aria-label="TOP 100 brands"]')?.getAttribute('aria-pressed')).toBe('true');
  await pick('AI & technology');
  expect(works(shelf)).toEqual(['AI release']);
  await pick('Preview template AI release');
  expect(page()).toMatchObject({ explore: true, templates: false, template: 'AI release' });
  await mount(1);
  expect(library()).toBeNull();
  expect(container.querySelector('dialog[open] h2')?.textContent).toContain('AI release');
  await traverse(-1);
  expect(page()).toMatchObject({ explore: true, templates: false, template: null });
  const campaign = container.querySelector<HTMLButtonElement>('.om-explore-shelf [aria-label="Black Friday collection"]')!;
  await act(async () => campaign.click());
  const first = container.querySelector<HTMLElement>('.om-explore-shelf [data-template-id]')!;
  await act(async () => first.querySelector('button')!.click());
  expect(page()).toMatchObject({ explore: true, templates: false, template: first.dataset.templateId });
  expect(container.querySelector('dialog[open] h2')).toBeTruthy();
});

it('previews an Explore Design template from its cover and title and creates a project with Use', async () => {
  const fallback = fetcher.getMockImplementation()!;
  const createDesign = vi.fn<(body: RequestInit['body']) => Response>(() => Response.json({ project: { id: 'my-design' } }));
  fetcher.mockImplementation((input: string, init?: RequestInit) => {
    const { pathname } = new URL(input, location.origin);
    if (pathname.endsWith('/design/projects') && init?.method === 'POST') return Promise.resolve(createDesign(init.body));
    if (pathname.endsWith('/design/projects/my-design')) return Promise.resolve(new Response(null, { status: 404 }));
    return fallback(input, init);
  });
  await mount();
  await click('Explore');
  const card = container.querySelector<HTMLElement>('[data-design-explore-section] [data-design-template="fixture-prototype"]')!;
  const cover = card.querySelector<HTMLElement>('.om-design-card-thumb')!;
  const title = card.querySelector<HTMLButtonElement>('.om-design-card-open')!;
  const use = card.querySelector<HTMLButtonElement>('button.om-design-explore-use')!;
  const details = () => document.querySelector('[role="dialog"].om-design-tpl-detail-popup');
  expect([...card.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Use', 'Design prototype fixture']);
  await act(async () => cover.click());
  expect(page().explore).toBe(true);
  expect(page().designScene).toBeUndefined();
  expect(details()?.getAttribute('aria-label')).toBe('Design prototype fixture');
  const close = details()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!;
  await act(async () => { close.click(); });
  expect(details()).toBeNull();
  await act(async () => title.click());
  expect(page().explore).toBe(true);
  expect(page().designScene).toBeUndefined();
  expect(details()?.getAttribute('aria-label')).toBe('Design prototype fixture');
  expect(createDesign).not.toHaveBeenCalled();
  await act(async () => details()!.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  await act(async () => use.click());
  expect(createDesign).toHaveBeenCalledOnce();
  expect(JSON.parse(String(createDesign.mock.calls[0][0]))).toMatchObject({ scenario: 'prototype', templateId: 'fixture-prototype' });
  expect(page()).toMatchObject({ designScene: 'projects', designProject: 'my-design' });
  expect(details()).toBeNull();
});

it('browses both Explore shelves, opens exact details and restores the selected categories', async () => {
  const fallback = fetcher.getMockImplementation()!;
  let finish!: (value: Response) => void;
  fetcher.mockImplementation((input: string, options?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (url.pathname.endsWith('/template-catalog') && url.searchParams.get('category') === 'ads') {
      return new Promise<Response>(resolve => { finish = resolve; });
    }
    return fallback(input, options);
  });
  await mount(); await click('Explore');
  const shelf = (name: string) => container.querySelector<HTMLElement>(`.om-explore-shelf[aria-label="${name}"]`)!;
  const choose = async (section: HTMLElement, label: string) => {
    const trigger = [...section.querySelectorAll('button')].find(node => node.textContent?.trim() === label)!;
    await act(async () => trigger.click());
  };
  const templates = shelf('Templates'), skills = shelf('Skills');
  const templateSubmission = templates.querySelector('header a');
  expect(templateSubmission?.getAttribute('href')).toBe(templateContributionUrl);
  expect(templateSubmission?.textContent).toBe('Submit template');
  expect(skills.querySelector('header a')?.getAttribute('href')).toBe(skillSubmissionUrl);
  expect(skills.querySelector('.om-feed-skill-badge, .om-feed-card-detail')).toBeNull();
  expect([...skills.querySelectorAll('[aria-label="Skill category"] button')].map(button => button.textContent)).toEqual(['All', ...skillCategories]);
  await choose(templates, 'Product promos');
  expect(templates.querySelector('[aria-busy="true"]')).not.toBeNull();
  await choose(templates, 'Editable templates');
  await act(async () => finish(Response.json({ items: [{ id: 'late-result' }] })));
  expect(templates.querySelector('[data-template-id="late-result"]')).toBeNull();
  await act(async () => templates.querySelector<HTMLButtonElement>('[data-template-id="product-promo"] button')!.click());
  expect(page()).toMatchObject({ explore: true, templates: false, template: 'product-promo' });
  await traverse(-1);
  expect(templates.querySelector('[aria-pressed="true"]')?.textContent).toBe('Editable templates');
  await choose(skills, 'Motion techniques');
  const card = skills.querySelector<HTMLButtonElement>('[data-playback-id]')!;
  await act(async () => card.click());
  expect(page().skill).toBe(card.dataset.playbackId!.split('/')[1]);
  await traverse(-1);
  expect(skills.querySelector('[aria-pressed="true"]')?.textContent).toBe('Motion techniques');
  await choose(skills, 'View all');
  expect(page()).toMatchObject({ skills: true, skill: null, skillCategory: 'Motion techniques' });
  expect(container.querySelector('.om-skills-library [aria-label="Skill category"] [aria-pressed="true"]')?.textContent).toBe('Motion techniques');
  await traverse(-1);
  await choose(templates, 'View collection');
  expect(page()).toMatchObject({ explore: true, templates: true, template: null, templateCollection: 'builtin' });
});

it.each([
  ['black-friday', 'explore'],
  ['hub-gemini-4', 'model-hub'],
  ['text-to-image', 'create'],
])('uses the same Back to Explore control for the %s spotlight destination', async (slide, destination) => {
  await mount();
  await click('Explore');
  const origin = location.href;
  const feed = container.querySelector<HTMLElement>('.om-explore-host:not([hidden]) .om-explore')!;
  const carousel = feed.querySelector('.om-feature-carousel')!;
  const slides = [...carousel.querySelectorAll<HTMLElement>('.om-feature-slide')];
  const segments = carousel.querySelectorAll<HTMLButtonElement>('.om-media-segments button');
  await act(async () => segments[slides.findIndex(item => item.dataset.scene === slide)].click());
  feed.scrollTop = 56;
  await act(async () => carousel.querySelector<HTMLButtonElement>('.om-feature-slide:not([inert]) [data-slide-action="destination"]')!.click());
  if (destination === 'model-hub') expect(location.pathname).toBe('/model-hub/gemini-4');
  else if (destination === 'create') expect(location.pathname).toBe('/create/text-to-image');
  else expect(location.pathname).toBe('/explore');
  expect(breadcrumb()).toBeNull();
  const returnControl = container.querySelector<HTMLButtonElement>('.om-back-to-explore');
  expect(returnControl?.textContent).toBe('Back to Explore');
  if (slide === 'text-to-image') {
    const header = container.querySelector('.om-studio-bar')!;
    expect(returnControl?.nextElementSibling).toBe(header.querySelector('h1'));
    expect(header.querySelector('h1')?.textContent).toBe('Create image');
    expect([...header.querySelectorAll('nav button')].map(tab => tab.textContent)).toEqual(['Create image', 'Edit image', 'Remove background', 'Relight', 'Character reference']);
    expect(header.querySelector('[aria-current="page"]')?.textContent).toBe('Create image');
    expect(button('Image').getAttribute('aria-current')).toBe('location');
    expect(button('Design Studio').getAttribute('aria-current')).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')?.value).toContain('Photograph an amber glass bottle');
    const editTab = [...header.querySelectorAll<HTMLButtonElement>('nav button')].find(tab => tab.textContent === 'Edit image')!;
    await act(async () => editTab.click());
    expect(location.pathname).toBe('/create/image-edit');
    expect(button('Image').getAttribute('aria-current')).toBe('location');
    expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Edit image');
    expect(container.querySelector('.om-studio-bar [aria-current="page"]')?.textContent).toBe('Edit image');
    await traverse(-1);
  }
  await act(async () => { returnControl!.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  expect(location.href).toBe(origin);
  expect(carousel.getAttribute('data-scene')).toBe(slide);
  expect(feed.scrollTop).toBe(56);
});

it.each([
  ['motion', 'motion-full-chain'],
  ['black-friday', 'black-friday'],
  ['hub-gemini-4', 'gemini-4-neon'],
  ['text-to-image', 'design-full-chain'],
  ['ai-influencer', 'ai-influencer'],
] as const)('launches the %s workflow from the primary spotlight CTA and returns to Explore', async (slide, scenarioId) => {
  await mount();
  await click('Explore');
  const origin = location.href;
  const feed = container.querySelector<HTMLElement>('.om-explore-host:not([hidden]) .om-explore')!;
  const carousel = feed.querySelector('.om-feature-carousel')!;
  const slides = [...carousel.querySelectorAll<HTMLElement>('.om-feature-slide')];
  const segments = carousel.querySelectorAll<HTMLButtonElement>('.om-media-segments button');
  await act(async () => segments[slides.findIndex(item => item.dataset.scene === slide)].click());
  feed.scrollTop = 64;
  if (slide === 'ai-influencer') {
    expect(carousel.querySelector('.om-feature-slide:not([inert]) [data-slide-action="destination"]')).toBeNull();
  }
  const primaryCta = carousel.querySelector<HTMLButtonElement>('.om-feature-slide:not([inert]) [data-slide-action="workflow"]')!;
  expect(primaryCta.textContent).toBe('Start workflow');
  await act(async () => primaryCta.click());
  expect(location.pathname).toBe(`/scenarios/${scenarioId}`);
  expect(container.querySelector(`[data-scenario-workspace="${scenarioId}"]`)).not.toBeNull();
  const returnControl = container.querySelector<HTMLButtonElement>('.om-back-to-explore');
  if (returnControl) {
    await act(async () => { returnControl.click(); await new Promise(resolve => setTimeout(resolve, 0)); });
  } else {
    await traverse(-1);
  }
  expect(location.href).toBe(origin);
  expect(carousel.getAttribute('data-scene')).toBe(slide);
  expect(feed.scrollTop).toBe(64);
});

it('opens the Gemini 4 hub from the third Explore slide and returns with browser Back', async () => {
  await mount();
  await click('Explore');
  await click('Featured · Gemini 4 Neon');
  expect(container.querySelector('.om-feature-slide:not([inert]) h2')?.textContent).toBe('Gemini 4 Neon');
  await click('Try Gemini 4 Neon now');
  expect(page()).toMatchObject({ explore: false, modelHub: 'gemini-4' });
  expect(location.pathname).toBe('/model-hub/gemini-4');
  expect(location.search).not.toContain('hub=gemini-4');
  expect(container.querySelector('.om-model-hub-hero h1')?.textContent).toBe('Gemini 4 Neon');
  const wall = () => [...container.querySelectorAll<HTMLButtonElement>('.om-hub-video .om-gallery-cover')];
  expect(wall()).toHaveLength(gemini4Videos.length);
  await act(async () => wall()[0].click());
  const detail = () => document.querySelector<HTMLDialogElement>('dialog.om-hub-video-detail')!;
  const count = () => detail().textContent?.match(/(\d+) \/ \d+/)?.[1];
  expect(count()).toBe('1');
  expect(detail().querySelector<HTMLAnchorElement>('a[aria-label="Source"]')?.href).toMatch(/^https:\/\/x\.com\//);
  const firstTitle = detail().querySelector('.om-media-detail-title')?.textContent;
  await act(async () => detail().querySelector<HTMLButtonElement>('button[aria-label="Next template"]')!.click());
  expect(count()).toBe('2');
  expect(detail().querySelector('.om-media-detail-title')?.textContent).not.toBe(firstTitle);
  expect(detail().querySelector('button[aria-label="Copy contribution brief"]')).toBeTruthy();
  await act(async () => detail().querySelector<HTMLButtonElement>('button[aria-label="Close template preview"]')!.click());
  expect(document.querySelector('dialog.om-hub-video-detail')).toBeNull();
  expect(page().modelHub).toBe('gemini-4');
  const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('.om-hub-videos nav button')].find(node => node.textContent === label)!;
  expect(tab('Made in code')).toBeUndefined();
  expect(tab('Gemini 4 Neon')).toBeUndefined();
  await act(async () => tab('3D scene').click());
  expect(wall().length).toBeGreaterThan(0);
  expect(wall().length).toBeLessThan(gemini4Videos.length);
  expect(wall().every(card => card.querySelector('.om-gallery-avatar'))).toBe(true);
  await act(async () => tab('All').click());
  expect(wall()).toHaveLength(gemini4Videos.length);
  await click('Back to Explore');
  expect(page()).toMatchObject({ explore: true, modelHub: null });
  await act(async () => container.querySelector<HTMLElement>('.om-feature-slide:not([inert]) h2')!.click());
  expect(page()).toMatchObject({ explore: false, modelHub: 'gemini-4' });
  await traverse(-1);
  expect(page().explore).toBe(true);
});

it('opens the first project from the Motion Studio banner even if another project is open', async () => {
  history.replaceState(null, '', firstUrl.replaceAll(first, second));
  await mount();
  expect(container.querySelector('[aria-label="Editor draft"]')?.getAttribute('data-project')).toBe(second);
  await click('Motion Studio');
  await click('Open Motion Editor');
  expect(page()).toMatchObject({ explore: false, motion: false, templates: false });
  expect(container.querySelector('[aria-label="Editor draft"]')?.getAttribute('data-project')).toBe(first);
  expect(container.querySelector('.motion-session-list [aria-current="page"]')?.getAttribute('aria-label')).toBe('First project');
});

it('resumes the project from the Explore spotlight without remounting its editor', async () => {
  history.replaceState(null, '', firstUrl.replaceAll(first, second));
  await mount();
  const draft = container.querySelector('[aria-label="Editor draft"]');
  expect(draft?.getAttribute('data-project')).toBe(second);
  await click('Explore');
  await click('Featured · Motion Studio');
  expect(container.querySelector('.om-feature-slide:not([inert]) h2')?.textContent).toBe('Motion Studio');
  await click('Open in Motion Editor');
  expect(page()).toMatchObject({ explore: false, motion: false });
  expect(container.querySelector<HTMLElement>('.motion-workspace-content')?.hidden).toBe(false);
  expect(container.querySelector('[aria-label="Editor draft"]')).toBe(draft);
  await traverse(-1);
  expect(page().explore).toBe(true);
});

it.each([
  ['opens the first project on a fresh visit', first, 'First project'],
  ['restores the previously opened project on a new page load', second, 'Second project'],
])('%s from the Explore spotlight', async (_name, activeId, title) => {
  history.replaceState(null, '', '/?page=explore');
  const fallback = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input: string, init?: RequestInit) =>
    new URL(input, location.origin).pathname.endsWith('/projects') && !init?.method
      ? Promise.resolve(Response.json({ ...catalog, activeId }))
      : fallback(input, init));
  await mount();
  await click('Featured · Motion Studio');
  await click('Open in Motion Editor');
  expect(page()).toMatchObject({ explore: false, motion: false, templates: false });
  expect(container.querySelector('[aria-label="Editor draft"]')?.getAttribute('data-project')).toBe(activeId);
  expect(container.querySelector('.motion-session-list [aria-current="page"]')?.getAttribute('aria-label')).toBe(title);
});

it('shows every Studio in Explore and opens the selected example or technique', async () => {
  await mount(); await click('Explore');
  const collections = () => [...container.querySelectorAll<HTMLElement>('.om-studio-collection')].map(section => section.dataset.studio);
  expect(collections()).toEqual(['image', 'design', 'motion', 'cinema', 'sound', 'shorts', 'marketing', 'explainer', '3d', 'game']);
  const imageCollection = container.querySelector('.om-studio-collection[data-studio="image"]')!;
  expect(imageCollection.querySelector('h2')?.textContent).toBe('Image creation');
  expect(imageCollection.querySelector('[data-scene="image-edit"] .om-feed-card-label')).toBeNull();
  expect(container.querySelector('.om-studio-collection[data-studio="cinema"] .om-feed-card-label')).toBeNull();
  expect(container.querySelector('.om-studio-collection[data-studio="sound"] [data-scene="speech"] .om-feed-card-label')?.textContent).toBe('Audio · Text to speech');
  const designCollection = container.querySelector('.om-studio-collection[data-studio="design"]')!;
  expect(designCollection.querySelector('h2')?.textContent).toBe('Design Studio');
  expect(designCollection.querySelector('[data-design-explore-section]')).not.toBeNull();
  expect(imageCollection.querySelector('[data-design-explore-section]')).toBeNull();
  for (const studio of ['shorts', 'marketing', 'explainer', 'motion', '3d']) {
    const collection = container.querySelector(`.om-studio-collection[data-studio="${studio}"]`)!;
    expect(collection.querySelector('.om-feed-card-description')).not.toBeNull();
    expect(collection.querySelector('.om-feed-card-detail')).toBeNull();
  }
  const threeDDescriptions = container.querySelectorAll('.om-studio-collection[data-studio="3d"] .om-feed-card-description');
  expect(threeDDescriptions).toHaveLength(6);
  expect(threeDDescriptions[0].textContent).toBe('Rotate a globe or product and show it from different camera angles.');
  const select = async (selector: string) => {
    const item = container.querySelector<HTMLButtonElement>(selector);
    expect(item, selector).toBeTruthy();
    await act(async () => item!.click());
  };
  await select('.om-studio-collection [data-playback-id="motion/openmotion-liquid-glass-logo"]');
  expect(page()).toMatchObject({ skills: true, skill: 'openmotion-liquid-glass-logo' });
  await traverse(-1);
  await select('.om-studio-collection[data-studio="image"] [data-scene="image-edit"]');
  expect(page().studio).toMatchObject({ landing: true, scene: { id: 'image-edit' } });
  expect(button('Image').getAttribute('aria-current')).toBe('location');
  expect(container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')?.value).toContain('Keep the speaker in place');
  await traverse(-1);
  await select('.om-studio-collection[data-studio="marketing"] .om-scene-tile');
  expect(page()).toMatchObject({ specialty: { id: 'marketing' }, skill: 'openmotion-flat-lay-product' });
  await traverse(-1);
  await select('.om-studio-collection[data-studio="sound"] [data-scene="speech"]');
  expect(page().studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'speech' } });
  await traverse(-1);
  await act(async () => [...imageCollection.querySelectorAll<HTMLButtonElement>('header button')].find(node => node.textContent === 'Image')!.click());
  expect(location.pathname).toBe('/create/text-to-image');
  await traverse(-1);
  await act(async () => [...designCollection.querySelectorAll<HTMLButtonElement>('header button')].find(node => node.textContent === 'Design Studio')!.click());
  expect(page()).toMatchObject({ designScene: 'prototype', studio: null });
  await traverse(-1);
  expect(collections()).toHaveLength(10);
  await click('Creators');
  expect(page()).toMatchObject({ explore: true, templates: true, creators: true });
});

it('opens a saved media collection and returns to the full feed from the global Explore entry', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=explore&medium=audio#'));
  await mount();
  expect(container.querySelector('.om-explore h1')?.textContent).toBe('Audio');
  expect([...container.querySelectorAll<HTMLElement>('.om-studio-collection')].map(section => section.dataset.studio)).toEqual(['sound']);
  await click('Explore');
  expect(page()).toMatchObject({ explore: true, community: null, medium: null });
  expect(container.querySelectorAll('.om-studio-collection')).toHaveLength(10);
});

it('rotates the visible Explore spotlight and plays visible Skill previews without hovering', async () => {
  const observed = new Map<Element, (visible: boolean) => void>();
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {}
    observe(target: Element) {
      observed.set(target, visible => this.callback([{ target, isIntersecting: visible, intersectionRatio: Number(visible) }]));
    }
    disconnect() {}
  });
  await mount(); await click('Explore');
  const hero = container.querySelector<HTMLElement>('.om-feature-carousel')!;
  const cards = ['.om-feed-group', '.om-studio-collection-cards'].map(section =>
    container.querySelector<HTMLElement>(section + ' [data-playback-id]')!);
  vi.useFakeTimers();
  try {
    await act(async () => { observed.get(hero)!(true); cards.forEach(card => observed.get(card)!(true)); });
    expect(hero.dataset.scene).toBe('motion');
    expect(hero.querySelector('video[src]')?.getAttribute('src')).toMatch(/^blob:/);
    for (const card of cards) expect(card.querySelector('video[src]')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(hero.dataset.scene).toBe('black-friday');
    expect(hero.querySelectorAll('.om-feature-slide:not([inert])')).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(2500); });
    const segment = hero.querySelector<HTMLButtonElement>('.om-media-segments [aria-current]')!;
    act(() => segment.focus());
    act(() => { vi.advanceTimersByTime(6000); });
    expect(hero.dataset.scene).toBe('black-friday');
    act(() => segment.blur());
    act(() => { vi.advanceTimersByTime(3500); });
    expect(hero.dataset.scene).toBe('hub-gemini-4');
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(hero.dataset.scene).toBe('text-to-image');
    await act(async () => { vi.advanceTimersByTime(6000); });
    expect(hero.dataset.scene).toBe('ai-influencer');
    act(() => { observed.get(hero)!(false); cards.forEach(card => observed.get(card)!(false)); });
    expect(hero.querySelector('video[src]')).toBeNull();
    for (const card of cards) expect(card.querySelector('video[src]')).toBeNull();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(hero.dataset.scene).toBe('ai-influencer');
    await act(async () => hero.querySelector<HTMLButtonElement>('.om-media-segments [aria-label="Featured · Motion Studio"]')!.click());
    expect(hero.dataset.scene).toBe('motion');
  } finally { vi.useRealTimers(); }
});

it('opens Black Friday from the second Explore slide and reuses the native Skill detail in the collection', async () => {
  await mount();
  await click('Explore');
  const hero = container.querySelector<HTMLElement>('.om-feature-carousel')!;
  const segments = hero.querySelectorAll<HTMLButtonElement>('.om-media-segments button');
  expect(segments[1].getAttribute('aria-label')).toBe('Featured · Black Friday collection');
  await act(async () => segments[1].click());
  await click('View collection');
  expect(page()).toMatchObject({ explore: true, templates: true, templateCollection: 'black-friday' });
  expect(container.querySelector('[aria-label="Video purpose"]')).toBeNull();
  const collection = container.querySelector<HTMLElement>('[data-black-friday]')!;
  const getCarousel = () => collection.querySelector('section[aria-label="Black Friday Skills"]');
  const carousel = getCarousel()!;
  expect(collection.querySelector('header')?.nextElementSibling?.firstElementChild).toBe(carousel);
  const filters = carousel.nextElementSibling!.querySelector('nav[aria-label="Black Friday collection"]')!;
  expect(filters).toBeTruthy();
  expect([...filters.querySelectorAll('button')].map(node => node.textContent)).toEqual([
    'All', 'Before the sale', 'Sale launch', 'Cyber Monday and last call',
  ]);
  const allFilter = [...filters.querySelectorAll('button')].find(node => node.textContent === 'All')!;
  const featured = () => getCarousel()?.querySelector<HTMLButtonElement>('[data-carousel-position="current"]')!;
  expect(featured().getAttribute('aria-label')).toBe('Sale countdown');
  expect(featured().querySelector('.om-gallery-card-shade')).toBeTruthy();
  expect(document.getElementById(featured().getAttribute('aria-describedby')!)?.closest('button')).toBe(featured());
  const carouselHeader = carousel.querySelector('h2')!.parentElement!;
  expect(carouselHeader.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe('Sale countdown');
  expect(featured().parentElement?.children).toHaveLength(3);
  await act(async () => carousel.querySelector<HTMLButtonElement>('[data-carousel-position="next"]')!.click());
  const promo = featured();
  expect(promo.getAttribute('aria-label')).toBe('Holiday sale promo');
  expect(carousel.querySelector('[aria-current="true"]')?.getAttribute('aria-label')).toBe('Holiday sale promo');
  await act(async () => promo.querySelector<HTMLElement>('.om-gallery-card-arrow')!.click());
  expect(page().skill).toBe('openmotion-sale-promo');
  await click('Close skill');
  expect(document.activeElement).toBe(promo);
  const gallery = () => collection.querySelector('.om-gallery-masonry');
  expect(gallery()?.children).toHaveLength(59);
  expect(gallery()?.querySelectorAll('[data-template-id]')).toHaveLength(59);
  expect(collection.querySelector('.om-skill-gallery-card')).toBeNull();
  const search = collection.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(search.placeholder).toBe('Search templates…');
  const setKeyword = (keyword: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, keyword);
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const collectionUrl = location.href;
  const collectionScroll = collection.closest('dialog')!;
  collectionScroll.scrollTop = 240;
  await click('Before the sale');
  expect(collectionScroll.scrollTop).toBe(240);
  expect(collection.querySelectorAll('[data-template-id]')).toHaveLength(5);
  await setKeyword('Kuro');
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(1);
  expect(collection.querySelector('[data-search-recovery]')).toBeNull();
  expect(getCarousel()).toBe(carousel);
  expect(getCarousel()?.querySelectorAll('[data-carousel-position]')).toHaveLength(3);
  expect(featured()).toBe(promo);
  expect(allFilter.getAttribute('aria-pressed')).toBe('true');
  await setKeyword('Black Friday');
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(59);
  expect(getCarousel()?.querySelectorAll('[data-carousel-position]')).toHaveLength(3);
  await click('Sale launch');
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(48);
  expect(getCarousel()?.querySelectorAll('[data-carousel-position]')).toHaveLength(3);
  await setKeyword('Sale countdown');
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(0);
  expect(getCarousel()).toBe(carousel);
  expect(featured()).toBe(promo);
  await setKeyword('地方');
  expect(location.href).toBe(collectionUrl);
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(0);
  expect(getCarousel()).toBe(carousel);
  expect(getCarousel()?.querySelectorAll('[data-carousel-position]')).toHaveLength(3);
  expect(collection.querySelector('[data-search-recovery] h2')?.textContent).toBe('No templates match the current conditions.');
  expect(button('Edit search')).toBeUndefined();
  await click('Make a video from a reference');
  expect(collection.querySelector('[data-search-recovery] input[type="url"]')).toBe(document.activeElement);
  await setKeyword('');
  expect(location.href).toBe(collectionUrl);
  expect(search.value).toBe('');
  expect(collection.querySelector('[data-search-recovery]')).toBeNull();
  expect(button('Before the sale').getAttribute('aria-pressed')).toBe('true');
  expect(collection.querySelectorAll('.om-gallery-card')).toHaveLength(5);
  expect(collection.querySelector('.om-skill-gallery-card')).toBeNull();
  expect(getCarousel()?.querySelectorAll('[data-carousel-position]')).toHaveLength(3);
  await click('Back to Explore');
  expect(page()).toMatchObject({ explore: true, templates: false, templateCollection: null });
  expect(hero.dataset.scene).toBe('black-friday');
  await click('Template library');
  expect(container.querySelector('[aria-label="Video purpose"]')).toBeTruthy();
  expect(container.querySelector('[aria-label="Video purpose"] [aria-label="Black Friday collection"]')).toBeNull();
});

it('browses Cinema templates and opens editable generation drafts without submitting', async () => {
  const { trackMotion } = await import('./tracking');
  await mount();
  await click('Cinema Studio');
  expect(page()).toMatchObject({ cinemaLanding: true, studio: null });
  expect(container.querySelector('.om-cinema-home .om-discovery-page')?.firstElementChild?.className).toBe('om-discovery-hero');
  const grid = container.querySelector('.om-cinema-home .om-studio-template-grid')!;
  expect(grid.querySelectorAll('.om-design-gallery-card')).toHaveLength(5);
  expect(grid.querySelector('[data-template-id="drink-splash-slow-motion"] .om-design-thumb-badge')?.textContent).toBe('Create video');
  expect(grid.querySelector('[data-template-id="product-window-light-push-in"] .om-design-thumb-badge')?.textContent).toBe('Image to video');
  await click('Slow-motion drink splash');
  expect(page()).toMatchObject({ cinemaTemplate: 'drink-splash-slow-motion', studio: { landing: true, scene: { id: 'text-to-video' } } });
  expect(location.pathname).toBe('/create/text-to-video');
  expect(Object.fromEntries(new URLSearchParams(location.search))).toMatchObject({ cinemaTemplate: 'drink-splash-slow-motion' });
  expect(button('Video').getAttribute('aria-current')).toBe('location');
  expect(button('Cinema Studio').getAttribute('aria-current')).toBeNull();
  expect(container.querySelector('.om-studio-bar')?.textContent).not.toContain('Open in');
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toContain('orange soda bottle');
  await traverse(-1);
  await click('Warm window light product shot');
  expect(page()).toMatchObject({ cinemaTemplate: 'product-window-light-push-in', studio: { scene: { id: 'image-to-video' } } });
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toContain('supplied frame');
  await traverse(-1);
  await click('Product light reveal');
  expect(page()).toMatchObject({ cinemaTemplate: 'product-light-reveal', studio: { scene: { id: 'text-to-video' } } });
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toContain('vertical product shot');
  expect(trackMotion).toHaveBeenCalledWith('ui_click', expect.objectContaining({ area: 'studio_bar', element: 'try_prompt', studio_id: 'cinema', template_id: 'product-light-reveal' }));
  await traverse(-1);
  expect(page().cinemaLanding).toBe(true);
  await click('Interior slow push-in');
  expect(page()).toMatchObject({ cinemaTemplate: 'interior-first-frame', studio: { scene: { id: 'image-to-video' } } });
  await mount(1);
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toContain('as the first frame');
  expect(fetcher.mock.calls.some(([, options]) => options?.body && String(options.body).includes('"action":"generate"'))).toBe(false);
});

it('carries a community template brief and an audio example into the matching studio without submitting generation', async () => {
  await mount(); await click('Search workspace'); await click('Product films');
  expect(page().community).toBe('product-films');
  const collectionUrl = location.href;
  await click('Use this prompt');
  expect(page().studio).toMatchObject({ landing: true, scene: { id: 'text-to-video' } });
  expect(location.pathname).toBe('/create/text-to-video');
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toBe('A slow product reveal.');
  await returnThroughBreadcrumb('Product films');
  expect(location.href).toBe(collectionUrl);
  await click('Explore');
  const exploreUrl = location.href;
  const speechCard = container.querySelector<HTMLButtonElement>('.om-feed-group [data-scene="speech"]')!;
  expect(speechCard.querySelector('.om-feed-prompt-action.om-nav-item')?.textContent).toBe('Use this prompt');
  await act(async () => speechCard.click());
  expect(page().studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'speech' }, mediaTab: true });
  expect(location.pathname).toBe('/audio/speech');
  expect(container.querySelector<HTMLInputElement>('.om-creative-workspace input')?.value).toContain('Every idea deserves');
  await returnThroughBreadcrumb('Explore');
  expect(location.href).toBe(exploreUrl);
  expect(fetcher.mock.calls.some(([, options]) => options?.body && String(options.body).includes('"action":"generate"'))).toBe(false);
});

it('recovers community templates and opens the library from the community heading', async () => {
  const fallback = fetcher.getMockImplementation()!;
  const template = (id: string) => ({ id, title: id, description: 'A product reveal.', kind: 'builtin', tags: [] });
  let failures = 0;
  fetcher.mockImplementation(async (input: string, options?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.endsWith('/template-catalog')) return fallback(input, options);
    if (url.searchParams.get('limit') === '60') return fallback(input, options);
    if (failures++ === 0) return new Response(null, { status: 503 });
    return Response.json({ offset: 0, items: ['first', 'second', 'second'].map(template), next: 2 });
  });
  await mount(); await click('Explore');
  const spotlight = container.querySelector('.om-explore-features')!;
  expect(spotlight.textContent).toContain('Templates could not be loaded.');
  expect(container.querySelector('.om-feed-group [data-scene="music"]')).not.toBeNull();
  await click('Retry');
  expect(spotlight.querySelector('.om-featured-caption strong')?.textContent).toBe('first');
  const sections = [...container.querySelector('.om-explore-sections')!.children].slice(0, 8);
  expect(sections.map(section => section.getAttribute('aria-labelledby') ?? section.getAttribute('data-studio') ?? section.className))
    .toEqual(['om-explore-features', 'explore-workflows', 'explore-highlights', 'explore-claude', 'explore-community', 'explore-seedance', 'image', 'design']);
  for (const id of ['explore-seedance', 'explore-gpt-image']) {
    const heading = container.querySelector(`#${id}`)!;
    expect(heading.previousElementSibling).toBeNull();
    expect(heading.closest('section')!.querySelector('.om-feed-card-label')).toBeNull();
  }
  expect(sections[5].querySelector('.om-studio-collection-cards .om-feed-card-label')).toBeNull();
  const picks = container.querySelector('[aria-labelledby="explore-community"]')!;
  expect([...picks.querySelectorAll('[data-template-id]')].map(node => node.getAttribute('data-template-id'))).toEqual(['second']);
  const communityActions = [...container.querySelectorAll<HTMLButtonElement>('.om-explore-feed > header button')];
  expect(communityActions.map(action => action.textContent)).toEqual(['View all templates']);
  await act(async () => communityActions[0].click());
  expect(page()).toMatchObject({ explore: true, templates: true, creators: false });
});

it('keeps Agent Skills available while the 3D studio is pending and preserves the community feed', async () => {
  await mount(); await click('Search workspace'); await click('3D motion');
  const feed = container.querySelector<HTMLElement>('.om-explore')!;
  feed.scrollTop = 326;
  await act(async () => feed.querySelector<HTMLButtonElement>('.om-scene-tile')!.click());
  expect(page()).toMatchObject({ specialty: { id: '3d' }, skill: 'three-js', community: '3d-motion' });
  expect(container.querySelector('.om-studio-coming-soon')).toBeNull();
  expect(container.querySelector('.om-specialty-intro .om-specialty-status')?.textContent).toBe('Coming soon');
  expect(container.querySelector<HTMLAnchorElement>('.om-specialty-intro .om-coming-soon-actions a')?.href).toBe('https://github.com/nexu-io/openmotion');
  expect(container.querySelector('.om-specialty-intro .om-specialty-actions')).toBeNull();
  expect(container.querySelector('.om-studio-template-shelf')).not.toBeNull();
  expect([...container.querySelectorAll('.om-skills-grid [data-skill-id]')].map(node => node.getAttribute('data-skill-id'))).toEqual([
    'babylon-js', 'lume', 'blender', 'openmotion-isometric-card-flight', 'openmotion-surreal-3d-poster',
  ]);
  expect(container.querySelector('.om-specialty-feature')?.textContent).toContain('3D');
  expect(button('Create a shot from this brief')).toBeUndefined();
  await clickWorkspaceBack();
  expect(page()).toMatchObject({ explore: true, community: '3d-motion', specialty: null, skill: null });
  expect(container.querySelector('.om-explore')).toBe(feed);
  expect(feed.scrollTop).toBe(326);
});

it('lists each primary destination once in order, with the Image mega menu and the video first frame under Video', async () => {
  await mount();
  const nav = container.querySelector('.om-app-header nav.om-creative-navigation')!;
  const destinations = [...nav.querySelectorAll('button:not([aria-expanded]),a')].map(node => node.getAttribute('aria-label') ?? node.textContent?.trim());
  expect(destinations).toEqual(['Explore', 'Workflows', 'Image', 'Video', 'Audio', 'MCP', 'Design Studio', 'Motion Studio', 'Cinema Studio', 'Sound Studio', 'Shorts Studio', 'Marketing Studio', 'Explainer Studio', '3D Studio', 'Game Studio']);
  const badges = [...nav.querySelectorAll('button[aria-describedby]')].map(node =>
    [node.getAttribute('aria-label'), document.getElementById(node.getAttribute('aria-describedby')!)?.textContent]);
  expect(badges).toEqual([['Workflows', 'New'], ['Design Studio', 'New'], ['Motion Studio', 'Top'], ['Cinema Studio', 'Hot'], ['Game Studio', 'New']]);
  await click('Image · Scenes');
  const menu = document.querySelector('.om-creative-menu-image')!;
  expect([...menu.querySelectorAll('.om-media-mega-columns h2')].map(node => node.textContent)).toEqual(['Features', 'Models']);
  const entryCards = [...menu.querySelectorAll<HTMLButtonElement>('.om-media-mega-entries > button')];
  expect(entryCards.map(node => node.querySelector('strong')?.textContent)).toEqual(['Create image', 'Edit image', 'Character reference', '4K upscale']);
  expect(entryCards[2].disabled).toBe(false);
  expect(entryCards[2].textContent).not.toContain('Soon');
  expect(entryCards[3].disabled).toBe(true);
  expect(entryCards[3].textContent).toContain('Soon');
  // Background removal and relighting are live features; 2K resolution stays a Create image option, not a standalone feature.
  expect(menu.textContent).not.toContain('2K HD output');
  for (const label of ['Remove background', 'Relight']) {
    const row = [...menu.querySelectorAll<HTMLButtonElement>('.om-media-mega-row')].find(node => node.textContent === label)!;
    expect(row.disabled, label).toBe(false);
  }
  // Upcoming feature rows are visible with Soon (6 total features show directly without a 1-item More fold) and non-clickable.
  const imageFeatureLabels = [...menu.querySelectorAll('section[aria-label="Features"] .om-media-mega-label')].map(node => node.textContent);
  expect(imageFeatureLabels).not.toContain('4K upscale');
  const inpainting = [...menu.querySelectorAll<HTMLButtonElement>('.om-media-mega-row')].find(node => node.textContent?.includes('Inpaint'))!;
  expect(inpainting.disabled).toBe(true);
  expect(inpainting.textContent).toContain('Soon');
  expect(menu.textContent).toContain('Expand image');
  expect(menu.textContent).toContain('Batch');
  expect(menu.textContent).toContain('Image layers');
  expect(menu.querySelector('button[aria-label="More Features"]')).toBeNull();
  // The Models column is the fixed OpenDesign API list, without setup tags.
  const models = [...menu.querySelectorAll('section[aria-label="Models"] .om-media-mega-row .om-media-mega-label')].map(node => node.textContent);
  expect(models).toEqual(['GPT Image 2.6 Flare', 'GPT Image 2.6 Sunburst', 'Seedream 5.5', 'Seedream 5.0 Flash']);
  expect(menu.textContent).not.toContain('Nano Banana');
  expect(menu.textContent).not.toContain('Setup required');
  // Features never pin a model.
  await act(async () => entryCards[0].click());
  expect(page().studio).toMatchObject({ studio: { id: 'design' }, scene: { id: 'text-to-image' }, landing: true, model: null });
  expect(button('Design Studio').getAttribute('aria-current')).toBeNull();
  await click('Video · Scenes');
  const videoMenu = document.querySelector('.om-creative-menu-video')!;
  expect([...videoMenu.querySelectorAll('.om-scene-tile')].map(node => node.querySelector('strong')?.textContent)).toEqual(['Create video', 'Image to video', 'Camera control', 'Start & end frames']);
  // Top cards are never duplicated inside the Video Features list, and Omni reference merges image+video references.
  const videoFeatureLabels = [...videoMenu.querySelectorAll('section[aria-label="Features"] .om-media-mega-label')].map(node => node.textContent);
  expect(videoFeatureLabels).toEqual(['Multi-shot', 'Omni reference', 'Edit video', 'Extend', '4K upscale']);
  const moreVideoFeatures = videoMenu.querySelector<HTMLButtonElement>('button[aria-label="More Features"]')!;
  await act(async () => moreVideoFeatures.click());
  expect(videoMenu.textContent).toContain('Motion control');
  expect(videoMenu.textContent).toContain('Lip sync');
  const multiShot = [...videoMenu.querySelectorAll<HTMLButtonElement>('.om-media-mega-row')].find(node => node.textContent?.includes('Multi-shot'))!;
  await act(async () => multiShot.click());
  expect(page().studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'video-multi-shot' }, landing: true });
  const videoHeader = container.querySelector('.om-studio-bar')!;
  expect(videoHeader.getAttribute('data-video-bar')).toBe('true');
  expect(videoHeader.querySelector('h1.sr-only')?.textContent).toBe('Multi-shot');
  expect(videoHeader.querySelector('.om-studio-heading-icon')).toBeNull();
  expect(videoHeader.querySelector('nav button[aria-current="page"]')?.textContent).toBe('Multi-shot');
  expect(videoHeader.querySelectorAll('.om-video-scene-tab > svg')).toHaveLength(4);
  // Character reference and the live feature rows open their own landing pages without a pinned model.
  await click('Image · Scenes');
  const character = [...document.querySelectorAll<HTMLButtonElement>('.om-creative-menu-image .om-media-mega-entries > button')].find(node => node.querySelector('strong')?.textContent === 'Character reference')!;
  await act(async () => character.click());
  expect(page().studio).toMatchObject({ scene: { id: 'character' }, landing: true, model: null });
  expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Character reference');
  for (const [label, scene] of [['Remove background', 'remove-background'], ['Relight', 'relight']]) {
    await click('Image · Scenes');
    const row = [...document.querySelectorAll<HTMLButtonElement>('.om-creative-menu-image .om-media-mega-row')].find(node => node.textContent === label)!;
    await act(async () => row.click());
    expect(page().studio, label).toMatchObject({ scene: { id: scene }, landing: true, model: null });
    const header = container.querySelector('.om-studio-bar')!;
    expect(header.getAttribute('data-image-bar')).toBe('true');
    expect(header.querySelector('h1.sr-only')?.textContent).toBe(label);
    expect(header.querySelector('.om-studio-heading-icon')).toBeNull();
    expect(header.querySelector('nav button[aria-current="page"]')?.textContent).toBe(label);
    expect(header.querySelectorAll('.om-image-scene-tab > svg')).toHaveLength(5);
  }
});

it('localizes every top navigation Studio label in Chinese while keeping English badges', async () => {
  await act(async () => root.render(<I18nProvider initialLocale="zh-CN"><MotionApp /></I18nProvider>));
  const nav = container.querySelector('.om-app-header nav.om-creative-navigation')!;
  const destinations = [...nav.querySelectorAll('button:not([aria-expanded]),a')].map(node => node.getAttribute('aria-label') ?? node.textContent?.trim());
  expect(destinations).toEqual(['探索', '工作流', '图片', '视频', '音频', 'MCP', '设计工作室', 'Motion 工作室', '影视工作室', '音频工作室', '短视频工作室', '营销工作室', '讲解视频工作室', '3D 工作室', '游戏工作室']);
  const badges = [...nav.querySelectorAll('button[aria-describedby]')].map(node => {
    const badge = document.getElementById(node.getAttribute('aria-describedby')!);
    return [node.getAttribute('aria-label'), badge?.textContent, badge?.getAttribute('lang')];
  });
  expect(badges).toEqual([['工作流', 'New', 'en'], ['设计工作室', 'New', 'en'], ['Motion 工作室', 'Top', 'en'], ['影视工作室', 'Hot', 'en'], ['游戏工作室', 'New', 'en']]);
});

it.each([
  ['Image', 'design', 'Design Studio', 'text-to-image'],
  ['Video', 'cinema', 'Cinema Studio', 'text-to-video'],
  ['Audio', 'sound', 'Sound Studio', 'music'],
])('opens the %s focused generator without double-highlighting its Studio and restores history', async (label, studio, studioTitle, scene) => {
  await mount(); await click('Explore');
  await click(label);
  expect(page().studio).toMatchObject({
    studio: { id: studio },
    scene: { id: scene },
    ...(studio === 'sound' ? { mediaTab: true } : { landing: true }),
  });
  expect(breadcrumb()).toBeNull();
  expect(container.querySelector('.om-studio-bar [aria-label="Back to Explore"]')).toBeNull();
  expect(document.querySelector('.om-creative-menu')).toBeNull();
  expect(button(label).getAttribute('aria-current')).toBe('location');
  expect(button(studioTitle).getAttribute('aria-current')).toBeNull();
  expect(button(label + ' · Scenes').getAttribute('aria-expanded')).toBe('false');
  await click(studioTitle);
  if (studio === 'design') {
    expect(page().designScene).toBeTruthy();
    expect(page().studio).toBeNull();
  } else if (studio === 'cinema') {
    expect(page()).toMatchObject({ cinemaLanding: true, studio: null });
  } else {
    expect(page().studio).toMatchObject({ studio: { id: studio }, scene: { id: scene } });
    expect(page().studio?.landing).toBeUndefined();
  }
  expect(button(studioTitle).getAttribute('aria-current')).toBe('page');
  expect(button(label).getAttribute('aria-current')).toBeNull();
  await traverse(-2);
  expect(page().explore).toBe(true);
});

it.each([
  ['Video', 'Create video', 'text-to-video'],
  ['Audio', 'Text to speech', 'speech'],
])('opens the %s dropdown scene without a breadcrumb', async (label, sceneLabel, scene) => {
  await mount(); await click('Explore');
  await click(label + ' · Scenes');
  const shortcut = [...document.querySelectorAll<HTMLButtonElement>('.om-creative-menu button')]
    .find(node => node.querySelector('strong')?.textContent === sceneLabel)!;
  await act(async () => shortcut.click());
  expect(page().studio).toMatchObject({
    ...(label === 'Audio' ? { mediaTab: true } : { landing: true }),
    scene: { id: scene },
  });
  expect(button('Back to Explore')).toBeUndefined();
  expect(breadcrumb()).toBeNull();
});

it('returns from MCP client and setup tabs to Explore, and clears the source on a direct visit', async () => {
  await mount(); await click('Explore');
  const exploreUrl = location.href;
  await click('MCP · Connect Agent');
  expect(page().settings).toBe('mcp');
  expect(button('Close settings')).toBeUndefined();
  await click('Claude Code'); await click('Manual setup');
  expect(breadcrumb()?.href).toBe(exploreUrl);
  expect(container.querySelector('.om-mcp-page > .om-workspace-breadcrumb + .om-mcp-client-row')).not.toBeNull();
  await mount(1);
  await returnThroughBreadcrumb('Explore');
  expect(location.href).toBe(exploreUrl);
  await traverse(3);
  expect(breadcrumb()?.href).toBe(exploreUrl);
  const handbookUrl = location.href;
  const entries = history.length;
  await openMcp();
  expect(location.href).toBe(handbookUrl);
  expect(history.length).toBe(entries);
  expect(breadcrumb()).toBeNull();
  await click('Explore');
  expect(page().explore).toBe(true);
});

it('returns from the settings connection action to the originating section', async () => {
  await mount(); await accountAction('Settings');
  const settingsUrl = location.href;
  await click('Set up connection');
  expect(page()).toMatchObject({ settings: 'mcp', mcpInSettings: true });
  expect(container.querySelector('.om-settings-main .om-mcp-page')).not.toBeNull();
  expect(breadcrumb()?.href).toBe(settingsUrl);
  await returnThroughBreadcrumb('General');
  expect(page().settings).toBe('general');
});

it('returns from the settings header to the exact source after changing sections and reloading', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=explore&community=product-films#'));
  await mount();
  const exploreUrl = location.href;
  await accountAction('Settings');
  const generalUrl = location.href;
  await click('Set up connection');
  await click('Claude Code'); await click('Manual setup');
  await mount(1);
  expect(breadcrumb()?.href).toBe(generalUrl);
  await leaveSettings();
  expect(location.href).toBe(exploreUrl);
  expect(page()).toMatchObject({ explore: true, community: 'product-films' });
});

it('keeps the settings sidebar mounted across MCP, agent and provider sections', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=settings&section=local#'));
  await mount();
  const sidebar = container.querySelector('.om-settings-sections');
  await click('MCP · Connect Agent');
  expect(page()).toMatchObject({ settings: 'mcp', mcpInSettings: true });
  expect(container.querySelector('.om-settings-sections')).toBe(sidebar);
  expect(sidebar?.querySelector('[aria-current=page]')?.textContent).toBe('MCP · Connect Agent');
  expect(container.querySelector('.om-settings-main .om-mcp-page')).not.toBeNull();
  expect(button('MCP').getAttribute('aria-current')).toBeNull();
  expect(settingsBack()).not.toBeNull();
  expect(button('Close settings')).toBeUndefined();
  expect(breadcrumb()).toBeNull();
  await click('Claude Code'); await click('Manual setup');
  const setupUrl = location.href;
  expect(new URL(setupUrl).pathname).toBe('/settings/mcp');
  const providers = [...sidebar!.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Model providers')!;
  await act(async () => providers.click());
  expect(page().settings).toBe('providers');
  expect(container.querySelector('.om-settings-sections')).toBe(sidebar);
  await traverse(-1);
  expect(location.href).toBe(setupUrl);
  expect(page()).toMatchObject({ client: 'claude', setup: 'manual', mcpInSettings: true });
  await mount(1);
  expect(container.querySelector('.om-settings-main a[download]')?.getAttribute('href')).toBe('/connect/config?host=claude');
  await leaveSettings();
  expect(page()).toMatchObject({ explore: true, settings: null });
  await traverse(-1);
  expect(location.href).toBe(setupUrl);
  await openMcp();
  expect(page()).toMatchObject({ settings: 'mcp', mcpInSettings: false });
  expect(container.querySelector('.om-settings-sections')).toBeNull();
  expect(settingsBack()).toBeNull();
  expect(button('Close settings')).toBeUndefined();
  expect(breadcrumb()).toBeNull();
});

it('keeps the top-level Audio tab and Sound Studio home as independent navigation entries', async () => {
  await mount(); await click('Explore');
  await click('Audio');
  expect(location.pathname).toBe('/audio/music');
  expect(button('Audio').getAttribute('aria-current')).toBe('location');
  expect(button('Sound Studio').getAttribute('aria-current')).toBeNull();
  expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Audio');
  expect(container.querySelector('.om-studio-bar .om-workspace-back')).toBeNull();

  await click('Sound Studio');
  expect(location.pathname).toBe('/sound');
  expect(new URLSearchParams(location.search).has('page')).toBe(false);
  expect(new URLSearchParams(location.search).has('home')).toBe(false);
  expect(button('Sound Studio').getAttribute('aria-current')).toBe('page');
  expect(button('Audio').getAttribute('aria-current')).toBeNull();
});

it.each([
  ['?page=create&scene=text-to-image', 'Image', 'location', 'Design Studio'],
  ['?page=create&scene=text-to-video', 'Video', 'location', 'Cinema Studio'],
  ['?page=audio&scene=music', 'Audio', 'location', 'Sound Studio'],
  ['?page=design&scene=prototype', 'Design Studio', 'page', 'Image'],
  ['?page=cinema', 'Cinema Studio', 'page', 'Video'],
  ['?page=sound&home=1', 'Sound Studio', 'page', 'Audio'],
])('highlights only the matching top navigation entry for %s', async (search, current, kind, other) => {
  history.replaceState(null, '', '/' + search);
  await mount();
  expect(button(current).getAttribute('aria-current')).toBe(kind);
  expect(button(other).getAttribute('aria-current')).toBeNull();
});

it('rewrites a bookmarked Design Studio image link to the unified Image editor', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=design&scene=image-edit&model=p%3Am#'));
  await mount();
  expect(location.pathname).toBe('/create/image-edit');
  expect(Object.fromEntries(new URLSearchParams(location.search))).toMatchObject({ model: 'p:m' });
  expect(page().studio).toMatchObject({ landing: true, scene: { id: 'image-edit' }, model: 'p:m' });
  expect(button('Image').getAttribute('aria-current')).toBe('location');
  expect(button('Design Studio').getAttribute('aria-current')).toBeNull();
  expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Edit image');
  expect(container.querySelector('[data-design-scene-tabs], .om-design-scene-tabs')).toBeNull();
});

it('retains the active model and scene on same-modality entry and switches modalities cleanly', async () => {
  history.replaceState(null, '', firstUrl.replace('#', '&page=create&scene=speech&model=voice%3Anarrator#'));
  await mount(); await click('Audio');
  expect(page().studio).toMatchObject({ studio: { id: 'sound' }, scene: { id: 'speech' }, model: 'voice:narrator' });
  await click('Cinema Studio'); await click('Create video');
  expect(page().studio).toMatchObject({ landing: true, scene: { id: 'text-to-video' } });
  await click('Video · Scenes'); await click('Multi-shot');
  expect(page().studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'video-multi-shot' } });
  await click('Video');
  expect(page().studio).toMatchObject({ studio: { id: 'cinema' }, scene: { id: 'video-multi-shot' }, model: null });
  await click('Image');
  expect(page().studio).toMatchObject({ studio: { id: 'design' }, scene: { id: 'text-to-image' }, model: null });
});

it('opens image editing from its scene shortcut and returns to the same Explore collection', async () => {
  await mount(); await click('Search workspace'); await click('Product films');
  await click('Image · Scenes');
  const edit = [...document.querySelectorAll<HTMLButtonElement>('.om-creative-menu button')].find(node => node.querySelector('strong')?.textContent === 'Edit image')!;
  await act(async () => edit.click());
  expect(page()).toMatchObject({ community: 'product-films', studio: { landing: true, scene: { id: 'image-edit' } } });
  expect(container.querySelector('.om-studio-bar h1')?.textContent).toBe('Edit image');
  expect(breadcrumb()).toBeNull();
  expect(button('Back to Explore')).toBeUndefined();
  expect(container.querySelector('.om-studio-bar')?.textContent).not.toContain('Open in');
  await traverse(-1);
  expect(page()).toMatchObject({ explore: true, community: 'product-films' });
  const collection = location.href;
  const feed = container.querySelector<HTMLElement>('.om-explore')!;
  feed.scrollTop = 320;
  const imageExample = feed.querySelector<HTMLButtonElement>('button[data-scene="text-to-image"]')!;
  await act(async () => imageExample.click());
  expect(breadcrumb()?.href).toBe(collection);
  await returnThroughBreadcrumb('Product films');
  expect(location.href).toBe(collection);
  expect(feed.scrollTop).toBe(320);
});

it('opens a technique from the full Explore skill index in its dedicated studio', async () => {
  await mount(); await click('Explore');
  const index = container.querySelector('.om-index-skills')!;
  const category = [...index.querySelectorAll('button')].find(node => node.textContent === 'Motion techniques')!;
  await act(async () => category.click());
  const { motionSkills } = await import('./skillCatalog');
  const techniques = motionSkills.filter(skill => skill.category === 'Motion techniques');
  const links = [...index.querySelectorAll<HTMLButtonElement>('.om-index-skill-links button')];
  expect(links).toHaveLength(techniques.length);
  await act(async () => links[techniques.findIndex(skill => skill.id === 'three-js')].click());
  expect(page()).toMatchObject({ specialty: { id: '3d' }, skill: 'three-js' });
  await traverse(-1);
  expect(page().explore).toBe(true);
  expect(index.querySelector('.om-index-skill-links')).not.toBeNull();
});

it.each([
  ['Shorts Studio', 'Create a short clip', 'shorts', 'text-to-video', 'Video'],
  ['Marketing Studio', 'Create a product image', 'marketing', 'text-to-image', 'Image'],
  ['Marketing Studio', 'Create an ad clip', 'marketing', 'text-to-video', 'Video'],
  ['Explainer Studio', 'Create an explainer clip', 'explainer', 'text-to-video', 'Video'],
])('opens %s through %s in the unified editor without selecting a Skill', async (title, action, id, scene, tab) => {
  await mount();
  await click(title);
  await click(action);
  expect(page()).toMatchObject({ studio: { landing: true, scene: { id: scene } }, specialty: null, skill: null });
  expect(location.pathname).toBe(`/create/${scene}`);
  expect(button(tab).getAttribute('aria-current')).toBe('location');
  expect(button(title).getAttribute('aria-current')).toBeNull();
  await returnThroughBreadcrumb(title);
  expect(page()).toMatchObject({ specialty: { id }, studio: null, skill: null });
});

it('keeps Skill brief drafts from different studios apart in the unified editor across Back and Forward', async () => {
  const marketing = 'openmotion-ad-script', explainer = 'openmotion-clay-explainer';
  history.replaceState(null, '', firstUrl.replace('#', `&page=marketing&skill=${marketing}#`));
  await mount();
  const draft = () => container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')?.value;
  await click('Create a shot from this brief');
  expect(location.pathname).toBe('/create/text-to-video');
  expect(Object.fromEntries(new URLSearchParams(location.search))).toMatchObject({ skill: marketing });
  const marketingPrompt = draft();
  expect(marketingPrompt).toBeTruthy();
  await click('Explainer Studio');
  await act(async () => container.querySelector<HTMLElement>(`.om-skills-grid [data-skill-id="${explainer}"]`)!.click());
  expect(page()).toMatchObject({ specialty: { id: 'explainer' }, skill: explainer });
  await click('Create a shot from this brief');
  expect(page()).toMatchObject({ studio: { landing: true, scene: { id: 'text-to-video' } }, skill: explainer });
  const explainerPrompt = draft();
  expect(explainerPrompt).not.toBe(marketingPrompt);
  await click('Video');
  expect(page()).toMatchObject({ studio: { scene: { id: 'text-to-video' } }, skill: null });
  expect(draft()).toBe('Asset prompt');
  await traverse(-1);
  expect(page().skill).toBe(explainer);
  expect(draft()).toBe(explainerPrompt);
  await traverse(-3);
  expect(page()).toMatchObject({ studio: { landing: true, scene: { id: 'text-to-video' } }, skill: marketing });
  expect(breadcrumb()?.textContent).toBe('Marketing Studio');
  expect(draft()).toBe(marketingPrompt);
  await traverse(3);
  expect(page().skill).toBe(explainer);
  expect(draft()).toBe(explainerPrompt);
  await traverse(1);
  expect(page().skill).toBeNull();
  expect(draft()).toBe('Asset prompt');
});

it.each(['text-to-video', 'image-to-video'])('shows Coming soon for a direct 3D %s link', async scene => {
  history.replaceState(null, '', `/?page=3d&scene=${scene}`);
  await mount();
  expect(container.querySelector('.om-studio-coming-soon')?.textContent).toContain('Coming soon');
  expect(container.querySelector('.om-studio-coming-soon-copy')?.textContent).toContain('does not support direct generation');
  expect(container.querySelector('.om-asset-tabs')).toBeNull();
  expect(container.querySelector('[aria-label="Asset draft"]')).toBeNull();
  expect(button('3D Creative Skills')).toBeDefined();
  expect(container.querySelector<HTMLAnchorElement>('.om-studio-coming-soon a')?.href).toBe('https://github.com/nexu-io/openmotion');
  await click('3D Creative Skills');
  expect(page()).toMatchObject({ specialty: { id: '3d' }, skill: null });
  expect(container.querySelector('.om-studio-coming-soon')).toBeNull();
  await clickWorkspaceBack();
  expect(page().explore).toBe(true);
});

it('shows only templates tagged as 3D animation on the 3D studio shelf, eight at a time', async () => {
  const fallback = fetcher.getMockImplementation()!;
  const requests: URLSearchParams[] = [];
  const template = (id: string, tags: string[]) => ({ id, title: id, description: '', kind: 'prism', collection: 'reference', tags, poster: `/${id}.jpg` });
  fetcher.mockImplementation(async (input: string, options?: RequestInit) => {
    const url = new URL(input, location.origin);
    if (!url.pathname.endsWith('/template-catalog')) return fallback(input, options);
    requests.push(url.searchParams);
    return Response.json({ items: [
      template('uuid-3d0a-interface', ['Interface animation']),
      ...Array.from({ length: 10 }, (_, index) => template(`spatial-${index}`, ['Graphic animation', '3D animation'])),
    ], next: null, catalogVersion: 'test' });
  });
  history.replaceState(null, '', '/?page=3d');
  await mount();
  const shelf = container.querySelector<HTMLElement>('.om-studio-template-shelf')!;
  expect(requests.at(-1)?.get('query')).toBe('3D animation');
  const ids = () => [...shelf.querySelectorAll('[data-template-id]')].map(node => node.getAttribute('data-template-id'));
  expect(ids()).toHaveLength(8);
  expect(ids()).not.toContain('uuid-3d0a-interface');
  await act(async () => [...shelf.querySelectorAll('button')].find(node => node.textContent === 'More templates')!.click());
  expect(ids()).toHaveLength(10);
  expect([...shelf.querySelectorAll('button')].some(node => node.textContent === 'More templates')).toBe(false);
});

it.each(['three-js', 'babylon-js', 'lume', 'blender', 'openmotion-surreal-3d-poster', 'openmotion-isometric-card-flight'])('keeps %s usable through an Agent without offering 3D generation', async skill => {
  history.replaceState(null, '', `/?page=3d&skill=${skill}`);
  await mount();
  expect(button('Copy for Agent')).toBeDefined();
  expect(button('Connect Agent')).toBeDefined();
  expect(container.querySelector('.om-studio-skills-heading')?.textContent).toContain('copy its brief to your Agent');
  expect(button('Create a shot from this brief')).toBeUndefined();
  expect(container.querySelector('.om-studio-techniques-title')?.textContent).toBe('3D Creative Skills');
});

it('opens model cases with a compatible provider and the same prompt from both discovery entries', async () => {
  const baseFetch = fetcher.getMockImplementation()!;
  const image = { id: 'cloud:gpt-image-2.6-flare', provider: 'cloud', modelId: 'gpt-image-2.6-flare', label: 'GPT Image 2.6', modality: 'image', mode: 'text-to-image', source: 'live' };
  const edit = { ...image, id: 'cloud:gpt-image-2.6/edit', modelId: 'gpt-image-2.6/edit', supportsImageReference: true, mode: 'image-to-image' };
  const other = { ...image, id: 'other:gpt-image-2.6-flare', provider: 'other' };
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path === '/motion-api/models') return Response.json({ models: [other, edit, image], nextOffset: null });
    if (path === '/motion-api/models/capabilities') return Response.json({ providers: [{ id: 'cloud', available: true }], routes: {} });
    return baseFetch(input, init);
  });
  await mount(); await click('Explore');
  const section = () => container.querySelector('section[aria-labelledby="explore-gpt-image"]')!;
  const choose = async (scope: Element, selector: string) => {
    const target = scope.querySelector<HTMLButtonElement>(selector)!;
    expect(target).toBeTruthy();
    await act(async () => target.click());
  };
  await choose(section(), '.om-story-card');
  expect(page().studio).toMatchObject({ model: image.id, landing: true, scene: { id: 'text-to-image' } });
  expect(location.pathname).toBe('/create/text-to-image');
  const draft = () => container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')?.value;
  const prompt = draft();
  expect(prompt).toContain('young witch');
  await traverse(-1);
  await choose(section(), '.om-story-item:last-child button');
  expect(page().studio).toMatchObject({ model: edit.id, landing: true, scene: { id: 'image-edit' } });
  await traverse(-1);
  await choose(section(), 'header button');
  expect(page().modelOverview).toBe(image.id);
  expect(breadcrumb()?.textContent).toBe('Explore');
  const overview = container.querySelectorAll('.om-explore-host:not([hidden]) .om-story-gallery .om-story-card');
  expect(overview).toHaveLength(2);
  await act(async () => (overview[0] as HTMLButtonElement).click());
  expect(page().studio?.model).toBe(image.id);
  expect(draft()).toBe(prompt);
  await returnThroughBreadcrumb('Model details');
  expect(page().modelOverview).toBe(image.id);
  await returnThroughBreadcrumb('Explore');
  expect(page().explore).toBe(true);
  expect(fetcher.mock.calls.some(([url, init]) => String(url).endsWith('/generations') && init?.method === 'POST')).toBe(false);
});

it.each([
  ['image', 'gpt-image-2.6', 'image-to-image', 'Edit image'],
  ['video', 'seedance-2.5', 'image-to-video', 'Image to video'],
])('offers the same reference-only %s scene in the model overview and its cases', async (modality, family, mode, label) => {
  const model = { id: 'cloud:' + family, provider: 'cloud', modelId: family, label: family, modality, mode, supportsImageReference: true, maxInputImages: 1, source: 'live' };
  const baseFetch = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path === '/motion-api/models') return Response.json({ models: [model], nextOffset: null });
    if (path === '/motion-api/models/capabilities') return Response.json({ providers: [{ id: 'cloud', available: true }], routes: {} });
    return baseFetch(input, init);
  });
  history.replaceState(null, '', firstUrl.replace('#', '&page=model&model=' + encodeURIComponent(model.id) + '#'));
  await mount();
  const overview = container.querySelector('.om-explore-host:not([hidden])')!;
  expect([...overview.querySelectorAll('.om-studio-collection-cards strong')].map(node => node.textContent)).toEqual([label]);
  const cases = overview.querySelectorAll<HTMLButtonElement>('.om-story-card');
  expect(cases).toHaveLength(1);
  expect(cases[0].textContent).toContain(label);
  await act(async () => cases[0].click());
  expect(page().studio?.model).toBe(model.id);
  expect(page().studio?.scene.label).toBe(label);
  await returnThroughBreadcrumb('Model details');
  expect(page().modelOverview).toBe(model.id);
  expect(breadcrumb()).toBeNull();
});

it.each([
  ['fal:fal-ai/elevenlabs/sound-effects/v2', 'ElevenLabs Sound Effects v2', 'sfx'],
  ['fal:fal-ai/suno/v4', 'Suno v4', null],
] as const)('opens the Audio tab for %s from its model overview scene', async (id, label, soundTab) => {
  const model = { id, provider: 'fal', modelId: id.slice(4), label, modality: 'audio', mode: 'text-to-audio', source: 'live' };
  const baseFetch = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path === '/motion-api/models') return Response.json({ models: [model], nextOffset: null });
    if (path === '/motion-api/models/capabilities') return Response.json({ providers: [{ id: 'fal', available: true }], routes: {} });
    return baseFetch(input, init);
  });
  history.replaceState(null, '', firstUrl.replace('#', '&page=model&model=' + encodeURIComponent(id) + '#'));
  await mount();
  const overview = container.querySelector('.om-explore-host:not([hidden])')!;
  const tile = [...overview.querySelectorAll<HTMLButtonElement>('.om-studio-collection-cards .om-scene-tile')].find(node => node.querySelector('strong')?.textContent === 'Music & sound')!;
  await act(async () => tile.click());
  expect(page()).toMatchObject({ studio: { studio: { id: 'sound' }, scene: { id: 'music' }, model: id, mediaTab: true } });
  expect(page().soundTab ?? null).toBe(soundTab);
  expect(location.pathname).toBe(`/audio/${soundTab ?? 'music'}`);
  expect(Object.fromEntries(new URLSearchParams(location.search))).toMatchObject({ model: id });
  expect(button('Audio').getAttribute('aria-current')).toBe('location');
  await returnThroughBreadcrumb('Model details');
  expect(page().modelOverview).toBe(id);
});

it('keeps unlisted model briefs usable and links an Explore workflow to the Claude handbook example', async () => {
  await mount(); await click('Explore');
  const fallback = container.querySelector<HTMLButtonElement>('[aria-labelledby="explore-seedance"] .om-story-card')!;
  expect(fallback.querySelector('.om-feed-card-label')).toBeNull();
  await act(async () => fallback.click());
  expect(page().studio).toMatchObject({ model: null, studio: { id: 'cinema' }, scene: { id: 'text-to-video' } });
  expect(container.querySelector<HTMLInputElement>('[aria-label="Asset draft"]')?.value).toContain('floating city');
  await traverse(-1);
  const workflow = container.querySelector<HTMLButtonElement>('[aria-labelledby="explore-claude"] .om-story-card')!;
  await act(async () => workflow.click());
  expect(page()).toMatchObject({ settings: 'mcp', client: 'claude', mcpExample: 'anime-opening' });
  expect(breadcrumb()?.textContent).toBe('Explore');
  expect(document.activeElement?.id).toBe('mcp-example-anime-opening');
  await mount(1);
  expect(document.activeElement?.id).toBe('mcp-example-anime-opening');
});

it('opens the same libraries from the Explore header, shelf actions and Skills footer', async () => {
  await mount(); await click('Explore');
  const [templates, skills] = container.querySelectorAll<HTMLButtonElement>('.om-explore-nav button');
  const shelfAction = (name: string) => container.querySelector<HTMLButtonElement>(`.om-explore-shelf[aria-label="${name}"] header button`)!;

  await act(async () => templates.click());
  expect(page()).toMatchObject({ explore: true, templates: true, templateCollection: null });
  expect(container.querySelector('[data-workspace-gallery] .om-gallery-page-label')?.textContent).toBe('Template library');
  const templatesUrl = location.href;
  await click('Close template library');
  await act(async () => shelfAction('Templates').click());
  expect(location.href).toBe(templatesUrl);
  await click('Close template library');

  const footerSkills = container.querySelector<HTMLButtonElement>('.om-index-skills .om-subtitle button')!;
  for (const trigger of [skills, shelfAction('Skills'), footerSkills]) {
    await act(async () => trigger.click());
    expect(page()).toMatchObject({ skills: true, skillCategory: null, skill: null });
    expect(container.querySelector('.om-skills-intro h1')?.textContent).toBe('Teach your Agent new moves.');
    const close = container.querySelector<HTMLButtonElement>('.om-skills-heading-actions button[aria-label="Close"]')!;
    await act(async () => close.click());
    expect(page()).toMatchObject({ explore: true, skills: false });
    expect(document.activeElement).toBe(trigger);
  }
});

it('opens Creators in the shared Explore shell and keeps its search and history', async () => {
  const fallback = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input: string, init?: RequestInit) => {
    const path = new URL(input, location.origin).pathname;
    if (path.endsWith('/models')) return Response.json({ models: [], nextOffset: null });
    if (path.endsWith('/models/capabilities')) return Response.json({ providers: [], routes: {} });
    if (!path.endsWith('/template-catalog')) return fallback(input, init);
    return Response.json({ items: [
      { id: 'work-1', title: 'First work', authorName: 'Jane', kind: 'builtin', tags: [] },
      { id: 'work-2', title: 'Second work', authorName: 'Jules', kind: 'builtin', tags: [] },
    ], next: null, catalogVersion: 'test' });
  });
  await mount();
  await click('Explore');
  const header = container.querySelector('.om-app-header');
  const entry = container.querySelector<HTMLButtonElement>('[aria-labelledby="explore-community"] header button')!;
  expect(entry.className).toBe(button('Manage providers').className);
  await act(async () => { entry.focus(); entry.click(); });

  const directory = container.querySelector<HTMLElement>('[data-workspace-gallery][aria-label="Creators"]')!;
  expect(page()).toMatchObject({ explore: true, templates: true, creators: true });
  expect(container.querySelector('.om-app-header')).toBe(header);
  expect(container.querySelectorAll('.om-creative-navigation')).toHaveLength(1);
  expect(container.querySelector<HTMLElement>('.om-explore-host')?.hidden).toBe(true);
  expect(directory.querySelector('.om-gallery-wordmark')).toBeNull();
  expect(directory.querySelector('.om-gallery-page-intro h1')?.textContent).toBe('Creators');
  const search = directory.querySelector<HTMLInputElement>('input[aria-label="Search creators"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Jane');
    search.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const tiles = directory.querySelectorAll<HTMLButtonElement>('button.om-scene-tile');
  expect(tiles).toHaveLength(1);
  expect(tiles[0].textContent).toContain('Jane');
  await act(async () => tiles[0].click());
  expect(page().creator).toBe('credit/Jane');
  expect(directory.querySelector('.om-gallery-page-intro h1')?.textContent).toBe('Jane');
  await traverse(-1);
  expect(page().creator).toBeNull();
  await act(async () => {
    search.focus();
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  expect(page()).toMatchObject({ explore: true, templates: false, creators: false });
  expect(document.activeElement).toBe(entry);
});

it('does not restore the Skills trigger when navigating home via the wordmark', async () => {
  await mount(); await click('Explore');
  const skills = container.querySelectorAll<HTMLButtonElement>('.om-explore-nav button')[1];
  await act(async () => skills.click());
  expect(page().skills).toBe(true);

  const restoreFocus = vi.spyOn(skills, 'focus');
  const wordmark = container.querySelector<HTMLButtonElement>('.om-app-brand')!;
  await act(async () => wordmark.click());
  expect(page()).toMatchObject({ explore: true, skills: false });
  expect(restoreFocus).not.toHaveBeenCalled();
});

it('shows the Explore shortcuts, fills two complete rows across Skills and technique Studios and renders a full-bleed footer', async () => {
  await mount(); await click('Explore');
  expect(container.querySelector('.om-explore-title')?.textContent).toBe('Explore');
  expect([...container.querySelectorAll('.om-explore-nav button')].map(button => button.textContent)).toEqual(['Templates', 'Skills']);
  const skillsShelf = [...container.querySelectorAll('.om-explore-shelf')].find(section => section.querySelector('h2')?.textContent === 'Skills')!;
  const cards = [...skillsShelf.querySelectorAll<HTMLButtonElement>('.om-explore-preview-grid .om-scene-tile')];
  expect(cards).toHaveLength(8);
  expect(new Set(cards.map(card => card.dataset.playbackId)).size).toBe(8);
  for (const studio of ['motion', 'shorts', 'marketing', 'explainer', '3d']) {
    const studioCards = [...container.querySelectorAll<HTMLButtonElement>(`.om-studio-collection[data-studio="${studio}"] .om-studio-collection-cards .om-scene-tile`)];
    const expectedCount = studio === '3d' ? 6 : 8;
    expect(studioCards, studio).toHaveLength(expectedCount);
    expect(new Set(studioCards.map(card => card.dataset.playbackId)).size, studio).toBe(expectedCount);
  }
  expect(container.querySelectorAll('.om-studio-collection[data-studio="image"] .om-scene-tile')).toHaveLength(7);
  expect(container.querySelectorAll('.om-studio-collection[data-studio="cinema"] .om-scene-tile')).toHaveLength(4);
  expect(container.querySelectorAll('.om-studio-collection[data-studio="sound"] .om-scene-tile')).toHaveLength(2);
  const footer = container.querySelector('main.om-explore > footer.om-capability-index');
  expect(footer).not.toBeNull();
  expect(footer?.querySelector('h2')?.textContent).toBe('Open Design');
  expect(footer?.closest('.om-discovery-page')).toBeNull();
});
it('hides the Black Friday banner on Explore home, shows it on other tabs, and keeps dismissal for the day', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-11-25T12:00:00+08:00'));
  localStorage.clear();
  resetBannerDismissal();
  try {
    history.replaceState(null, '', '/?page=explore');
    await mount();
    const banner = () => container.querySelector('aside[aria-label="Black Friday campaign banner"]');
    expect(banner()).toBeNull();

    await click('Motion Studio');
    expect(banner()).not.toBeNull();

    await click('Explore');
    expect(banner()).toBeNull();

    await click('Design Studio');
    expect(banner()).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Close campaign banner"]')!.click());
    expect(banner()).toBeNull();

    await click('Motion Studio');
    expect(banner()).toBeNull();
  } finally {
    vi.useRealTimers();
    localStorage.clear();
    resetBannerDismissal();
  }
});
