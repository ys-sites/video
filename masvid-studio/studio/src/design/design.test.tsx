// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { readWorkspacePage, workspacePageHref } from '../motion/workspacePageRouting';
import { CodeViewer } from './CodeViewer';
import { DesignApiError, designClient } from './designClient';
import { DesignProjectEditor, buildPresenterPopupHtml, overlayLocalPoint } from './DesignProjectEditor';
import { DesignProjectList } from './DesignProjectList';
import { buildBridgeSrcDoc, looksLikeDeck, parseDeckSlides, parseSpeakerNotes } from './previewBridge';

const projectId = '22222222-2222-4222-8222-222222222222';
const revision = 'b'.repeat(64);

const mockProject = {
  id: projectId,
  title: 'Test Prototype',
  scenario: 'prototype' as const,
  entry: 'index.html',
  designSystemId: 'stripe',
  templateId: null,
  source: 'blank' as const,
  createdAt: 1700000000000,
  updatedAt: 1700000001000,
  trashedAt: null,
  revision,
  versionId: 'v-1',
  versionLabel: 'v1',
  files: [{ path: 'index.html', size: 80, sha256: revision, kind: 'html' as const }],
  path: '/tmp/design/projects/' + projectId,
  previewUrl: `/motion-api/design/raw/${projectId}/index.html`,
  editorUrl: `/?page=design&scene=projects&designProject=${projectId}`,
  openComments: 1,
};

const mockComment = {
  id: '33333333-3333-4333-8333-333333333333',
  projectId,
  text: 'Increase hero button contrast',
  status: 'open' as const,
  anchor: {
    filePath: 'index.html',
    viewport: { id: 'desktop' as const, width: 1440, height: 900 },
    element: { selector: 'h1', tagName: 'h1', label: 'Hero', box: { x: 40, y: 40, width: 300, height: 48 } },
  },
  sourceRevision: revision,
  author: 'user' as const,
  createdAt: 1700000000500,
  updatedAt: 1700000000500,
  commentRevision: 1,
};

describe('Design Studio client, bridge and routing', () => {
  it('parses structured API errors with code and status', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'VERSION_CONFLICT', message: 'Stale revision' } }), { status: 409 }),
    );
    try {
      await expect(designClient.getProject(projectId)).rejects.toMatchObject({
        code: 'VERSION_CONFLICT',
        status: 409,
        message: 'Stale revision',
      });
      await expect(designClient.getProject(projectId).catch(e => e)).resolves.toBeInstanceOf(Error);
    } finally { spy.mockRestore(); }
  });

  it('extracts deck slides, speaker notes and injects base href into bridge srcdoc', () => {
    const deckHtml = `<!doctype html><html><head><title>Deck</title></head><body>
      <section class="slide active" data-screen-label="Intro"><h1>Welcome</h1></section>
      <section class="slide"><h2>Details</h2></section>
      <script type="application/json" id="speaker-notes">["First note", "Second note"]</script>
    </body></html>`;
    expect(looksLikeDeck(deckHtml)).toBe(true);
    expect(parseSpeakerNotes(deckHtml)).toEqual(['First note', 'Second note']);
    expect(parseDeckSlides(deckHtml)).toEqual([
      { index: 0, label: 'Intro' },
      { index: 1, label: 'Details' },
    ]);
    const wrapped = buildBridgeSrcDoc(deckHtml, 'http://localhost/motion-api/design/raw/id/', 'tok-1', true);
    expect(wrapped).toContain('<base href="http://localhost/motion-api/design/raw/id/" />');
    expect(wrapped).toContain('om:design-pick');
  });

  it('routes design HTML scenarios and project editor separately from image media scenes', () => {
    const img = readWorkspacePage('?page=design&scene=text-to-image');
    expect(img.studio?.studio.id).toBe('design');
    expect(img.studio?.scene.id).toBe('text-to-image');
    expect(img.designScene).toBeUndefined();

    expect(readWorkspacePage('?page=design').designScene).toBe('prototype');
    const proto = readWorkspacePage('?page=design&scene=prototype');
    expect(proto.designScene).toBe('prototype');
    expect(proto.studio).toBeNull();

    const editor = readWorkspacePage(`?page=design&scene=projects&designProject=${projectId}`);
    expect(editor.designScene).toBe('projects');
    expect(editor.designProject).toBe(projectId);
    expect(editor.studio).toBeNull();

    const href = workspacePageHref('http://localhost/?page=explore', { designScene: 'deck', designProject: projectId });
    expect(href).toBe(`/design/projects/${projectId}?scene=deck`);
    const parsedDeckProject = new URL(href, 'http://localhost');
    expect(readWorkspacePage(parsedDeckProject.search, parsedDeckProject.hash, parsedDeckProject.pathname)).toMatchObject({
      designScene: 'deck',
      designProject: projectId,
      studio: null,
    });
    const projectsHref = workspacePageHref('http://localhost/?page=explore', { designScene: 'projects', designProject: projectId });
    expect(projectsHref).toBe(`/design/projects/${projectId}`);
    const parsedProjectsEditor = new URL(projectsHref, 'http://localhost');
    expect(readWorkspacePage(parsedProjectsEditor.search, parsedProjectsEditor.hash, parsedProjectsEditor.pathname)).toMatchObject({
      designScene: 'projects',
      designProject: projectId,
      studio: null,
    });
  });
});

describe('DesignProjectEditor', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.remove();
    vi.restoreAllMocks();
  });

  it('switches Preview/Code, lists comments and resolves an open annotation', async () => {
    let resolved = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(`/projects/${projectId}`) && (!init?.method || init.method === 'GET')) {
        return Response.json({ project: mockProject });
      }
      if (url.includes('/versions')) {
        return Response.json({ versions: [{ id: 'v-1', label: 'v1', number: 1, createdAt: 1700000000000, source: 'create', summary: 'Initial', prompt: null, restoredFrom: null, files: [] }], currentVersionId: 'v-1', nextCursor: null });
      }
      if (url.includes('/comments/') && init?.method === 'PATCH') {
        resolved = true;
        return Response.json({ comment: { ...mockComment, status: 'resolved', commentRevision: 2 } });
      }
      if (url.includes('/comments')) {
        return Response.json({ comments: [mockComment], sourceRevision: revision });
      }
      if (url.includes('/files/')) {
        return Response.json({ path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>', revision, size: 56, nextOffset: null });
      }
      if (url.includes('/editors')) {
        return Response.json({ editors: [{ id: 'cursor', label: 'Cursor', icon: 'code-s-slash-line', available: true }] });
      }
      if (url.includes('/state')) {
        return Response.json({ revision, versionId: 'v-1', openComments: resolved ? 0 : 1, updatedAt: 1700000001000 });
      }
      return Response.json({});
    });

    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectEditor projectId={projectId} onBack={() => {}} />
        </I18nProvider>,
      );
    });

    expect(container.querySelector<HTMLInputElement>('input[aria-label="Project title"]')?.value).toBe('Test Prototype');

    // Switch to Code view
    const codeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Code'));
    expect(codeBtn).toBeTruthy();
    await act(async () => { codeBtn!.click(); });
    expect(container.textContent).toContain('<h1>Hello</h1>');

    // Switch sidebar to Comments and resolve the open comment
    const commentsTab = Array.from(container.querySelectorAll('[role="tablist"] button')).find(b => b.textContent?.includes('Comments'));
    expect(commentsTab).toBeTruthy();
    await act(async () => { commentsTab!.click(); });
    expect(container.textContent).toContain('Increase hero button contrast');

    const resolveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Resolve');
    expect(resolveBtn).toBeTruthy();
    await act(async () => { resolveBtn!.click(); });
    expect(resolved).toBe(true);
    expect(DesignApiError).toBeDefined();
  });

  it('renders line numbers and syntax token classes in CodeViewer', async () => {
    await act(async () => {
      root.render(<CodeViewer content={'<!-- hero -->\n<h1 class="title">Hello</h1>\nconst count = 42;'} />);
    });
    const lines = container.querySelectorAll('.om-design-code-line');
    expect(lines.length).toBe(3);
    expect(container.querySelector('.om-design-tok-comment')?.textContent).toBe('<!-- hero -->');
    expect(container.querySelector('.om-design-tok-tag')?.textContent).toBe('<h1');
    expect(container.querySelector('.om-design-tok-string')?.textContent).toBe('"title"');
    expect(container.querySelector('.om-design-tok-keyword')?.textContent).toBe('const');
    expect(container.querySelector('.om-design-tok-number')?.textContent).toBe('42');
  });

  it('lists design projects and opens a project from DesignProjectList', async () => {
    const opened: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/editors')) return Response.json({ editors: [{ id: 'vscode', label: 'VS Code', icon: 'code-s-slash-line', available: true }] });
      if (url.includes('/projects')) return Response.json({ projects: [mockProject] });
      return Response.json({});
    });
    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectList onOpen={id => opened.push(id)} />
        </I18nProvider>,
      );
    });
    expect(container.textContent).toContain('Test Prototype');
    expect(container.textContent).toContain('v1');
    const openBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Open');
    expect(openBtn).toBeTruthy();
    await act(async () => { openBtn!.click(); });
    expect(opened).toEqual([projectId]);
  });

  it('sandboxes Presenter popup iframe and escapes title and speaker notes', () => {
    const html = buildPresenterPopupHtml(
      'Deck </title><script>alert(1)</script>',
      'http://127.0.0.1:4197/motion-api/design/raw/id/index.html',
      ['Note </script><script>alert(2)</script>'],
      2,
    );
    expect(html).toContain('sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"');
    expect(html).not.toContain('sandbox="allow-same-origin');
    expect(html).not.toContain('</title><script>alert(1)');
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('</script><script>alert(2)');
    expect(html).toContain('\\u003c/script\\u003e');
  });

  it('normalizes annotation coordinates for scrolled viewport picks and zoomed overlays', () => {
    const srcdoc = buildBridgeSrcDoc('<html><body><h1 id="hero">Hi</h1></body></html>', 'http://127.0.0.1/raw/', 'tok-scroll', true);
    expect(srcdoc).toContain('box: { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) }');
    expect(srcdoc).not.toContain('rect.top + scrollY');

    // At 50% zoom, an overlay with clientWidth=1000 renders at rect.width=500.
    const fakeOverlay = {
      clientWidth: 1000,
      clientHeight: 600,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 500, height: 300, right: 600, bottom: 350, x: 100, y: 50, toJSON: () => ({}) }),
    };
    const start = overlayLocalPoint(fakeOverlay, 200, 110);
    const end = overlayLocalPoint(fakeOverlay, 350, 210);
    expect(start.x).toBe(200);
    expect(start.y).toBe(120);
    expect(end.x - start.x).toBe(300);
    expect(end.y - start.y).toBe(200);
    expect(start.width).toBe(1000);
    expect(start.height).toBe(600);
  });

  it('submits edit-start expectedRevision on manual save, preserves draft on VERSION_CONFLICT, and allows conflict overwrite retry', async () => {
    const newRevision = 'c'.repeat(64);
    const savedRevision = 'd'.repeat(64);
    let currentRevision = revision;
    let storedContent = '<h1>v1</h1>';
    const submittedRevisions: string[] = [];
    vi.spyOn(designClient, 'getProject').mockImplementation(async () => ({ project: { ...mockProject, revision: currentRevision } }));
    vi.spyOn(designClient, 'listVersions').mockResolvedValue({ versions: [], currentVersionId: 'v-1', nextCursor: null });
    vi.spyOn(designClient, 'listComments').mockResolvedValue({ comments: [], sourceRevision: revision });
    vi.spyOn(designClient, 'detectEditors').mockResolvedValue({ editors: [] });
    vi.spyOn(designClient, 'readFile').mockImplementation(async () => ({ path: 'index.html', content: storedContent, offset: 0, limit: 100, totalBytes: storedContent.length, hasMore: false, nextOffset: null }));
    vi.spyOn(designClient, 'writeFiles').mockImplementation(async (_id, payload) => {
      submittedRevisions.push(payload.expectedRevision);
      if (payload.expectedRevision !== currentRevision) {
        throw new DesignApiError('VERSION_CONFLICT', 'Expected revision mismatch', 409);
      }
      currentRevision = savedRevision;
      storedContent = payload.files?.[0]?.content ?? storedContent;
      return {
        project: { ...mockProject, revision: savedRevision, versionLabel: 'v3' },
        version: { id: 'v-3', label: 'v3', number: 3, createdAt: 1700000002000, source: 'manual', summary: 'Manual edit', prompt: null, restoredFrom: null, files: [] },
      };
    });

    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectEditor projectId={projectId} onBack={() => {}} />
        </I18nProvider>,
      );
    });

    const codeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Code'));
    await act(async () => { codeBtn!.click(); });

    const editBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Edit source'));
    await act(async () => { editBtn!.click(); });

    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!;
    expect(editor).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editor, '<h1>Unsaved manual draft</h1>');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Simulate external Agent write advancing revision before the user clicks Save.
    currentRevision = newRevision;
    const reloadBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Reload preview"]');
    if (reloadBtn) await act(async () => { reloadBtn.click(); });

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Save version'));
    await act(async () => { saveBtn!.click(); });

    expect(submittedRevisions).toEqual([revision]);
    // Draft stays open in the editor so user edits are not lost on conflict.
    const stillEditing = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]');
    expect(stillEditing?.value).toBe('<h1>Unsaved manual draft</h1>');

    // User explicitly clicks "Overwrite with my draft" to rebase onto the latest revision and retry save.
    const overwriteBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Overwrite with my draft'));
    expect(overwriteBtn).toBeTruthy();
    await act(async () => { overwriteBtn!.click(); });

    expect(submittedRevisions).toEqual([revision, newRevision]);
    // After successful retry, editing exits cleanly and the saved draft is displayed.
    expect(container.querySelector('textarea[aria-label="Source editor"]')).toBeNull();
    expect(container.textContent).toContain('Unsaved manual draft');
  });

  it('reads latest file content when clicking Discard draft & reload latest before post-conflict read resolves', async () => {
    const newRevision = 'e'.repeat(64);
    const savedRevision = 'f'.repeat(64);
    let currentRevision = revision;
    let storedContent = '<h1>v1</h1>';
    const submittedWrites: { expectedRevision: string; content: string }[] = [];
    let readCallCount = 0;
    let resolveDeferredEffectRead: ((value: { path: string; content: string; offset: number; limit: number; totalBytes: number; hasMore: boolean; nextOffset: null }) => void) | null = null;

    vi.spyOn(designClient, 'getProject').mockImplementation(async () => ({ project: { ...mockProject, revision: currentRevision } }));
    vi.spyOn(designClient, 'listVersions').mockResolvedValue({ versions: [], currentVersionId: 'v-1', nextCursor: null });
    vi.spyOn(designClient, 'listComments').mockResolvedValue({ comments: [], sourceRevision: revision });
    vi.spyOn(designClient, 'detectEditors').mockResolvedValue({ editors: [] });
    vi.spyOn(designClient, 'readFile').mockImplementation(async () => {
      readCallCount += 1;
      // 1st read: initial load (v1). 2nd read: post-conflict useEffect read held in flight.
      if (readCallCount === 2) {
        return new Promise(resolve => {
          resolveDeferredEffectRead = resolve;
        });
      }
      return { path: 'index.html', content: storedContent, offset: 0, limit: 100, totalBytes: storedContent.length, hasMore: false, nextOffset: null };
    });
    vi.spyOn(designClient, 'writeFiles').mockImplementation(async (_id, payload) => {
      const content = payload.files?.[0]?.content ?? '';
      submittedWrites.push({ expectedRevision: payload.expectedRevision, content });
      if (payload.expectedRevision !== currentRevision) {
        throw new DesignApiError('VERSION_CONFLICT', 'Expected revision mismatch', 409);
      }
      currentRevision = savedRevision;
      storedContent = content;
      return {
        project: { ...mockProject, revision: savedRevision, versionLabel: 'v3' },
        version: { id: 'v-3', label: 'v3', number: 3, createdAt: 1700000003000, source: 'manual', summary: 'Manual edit', prompt: null, restoredFrom: null, files: [] },
      };
    });

    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectEditor projectId={projectId} onBack={() => {}} />
        </I18nProvider>,
      );
    });

    const codeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Code'));
    await act(async () => { codeBtn!.click(); });

    const editBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Edit source'));
    await act(async () => { editBtn!.click(); });

    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editor, '<h1>Stale user draft</h1>');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // External Agent updates project revision and file content on disk before user saves.
    currentRevision = newRevision;
    storedContent = '<h1>External Agent v2</h1>';

    const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Save version'));
    await act(async () => { saveBtn!.click(); });

    // Post-conflict effect read (#2) is still unresolved when user clicks Discard.
    expect(resolveDeferredEffectRead).not.toBeNull();
    const discardBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Discard draft & reload latest'));
    expect(discardBtn).toBeTruthy();

    await act(async () => { discardBtn!.click(); });

    // Editor now holds the freshly fetched v2 content, NOT pre-conflict v1 content.
    const reloadedEditor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!;
    expect(reloadedEditor.value).toBe('<h1>External Agent v2</h1>');
    expect(container.querySelector('[role="alert"]')).toBeNull();

    // Even if the earlier deferred read resolves late with stale content, it must not overwrite fileContent/draft.
    await act(async () => {
      resolveDeferredEffectRead!({ path: 'index.html', content: '<h1>v1</h1>', offset: 0, limit: 100, totalBytes: 11, hasMore: false, nextOffset: null });
    });
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!.value).toBe('<h1>External Agent v2</h1>');

    // Saving now rebases onto newRevision with the fresh content.
    const saveAfterDiscard = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Save version'));
    await act(async () => { saveAfterDiscard!.click(); });
    expect(submittedWrites).toEqual([
      { expectedRevision: revision, content: '<h1>Stale user draft</h1>' },
      { expectedRevision: newRevision, content: '<h1>External Agent v2</h1>' },
    ]);
  });

  it('clears codeLoading when discard reload fails after invalidating an in-flight post-conflict read', async () => {
    const newRevision = '1'.repeat(64);
    let currentRevision = revision;
    let readCallCount = 0;

    vi.spyOn(designClient, 'getProject').mockImplementation(async () => ({ project: { ...mockProject, revision: currentRevision } }));
    vi.spyOn(designClient, 'listVersions').mockResolvedValue({ versions: [], currentVersionId: 'v-1', nextCursor: null });
    vi.spyOn(designClient, 'listComments').mockResolvedValue({ comments: [], sourceRevision: revision });
    vi.spyOn(designClient, 'detectEditors').mockResolvedValue({ editors: [] });
    vi.spyOn(designClient, 'readFile').mockImplementation(async () => {
      readCallCount += 1;
      if (readCallCount === 1) {
        return { path: 'index.html', content: '<h1>v1</h1>', offset: 0, limit: 100, totalBytes: 11, hasMore: false, nextOffset: null };
      }
      if (readCallCount === 2) {
        // Post-conflict effect read stays pending so Discard invalidates its sequence.
        return new Promise(() => {});
      }
      throw new Error('Transient read failure');
    });
    vi.spyOn(designClient, 'writeFiles').mockRejectedValue(new DesignApiError('VERSION_CONFLICT', 'Expected revision mismatch', 409));

    await act(async () => {
      root.render(
        <I18nProvider>
          <DesignProjectEditor projectId={projectId} onBack={() => {}} />
        </I18nProvider>,
      );
    });

    const codeBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Code'));
    await act(async () => { codeBtn!.click(); });

    const editBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Edit source'));
    await act(async () => { editBtn!.click(); });

    const editor = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
      setter.call(editor, '<h1>Unsaved draft</h1>');
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });

    currentRevision = newRevision;
    const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Save version'));
    await act(async () => { saveBtn!.click(); });

    const discardBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Discard draft & reload latest'));
    expect(discardBtn).toBeTruthy();
    await act(async () => { discardBtn!.click(); });

    // Failure keeps the conflict banner and draft intact.
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Source editor"]')!.value).toBe('<h1>Unsaved draft</h1>');

    // Clicking Cancel must exit edit mode cleanly without stranding the code panel in "Loading file…".
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Cancel');
    expect(cancelBtn).toBeTruthy();
    await act(async () => { cancelBtn!.click(); });

    expect(container.textContent).not.toContain('Loading file');
    expect(container.querySelector('.om-design-code-pre')).toBeTruthy();
  });
});
