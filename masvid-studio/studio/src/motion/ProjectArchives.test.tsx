// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useProjectArchives, ProjectArchiveMenu } from './ProjectArchives';
import { motionApi, type useWorkspace } from './useWorkspace';
import { I18nProvider } from '../i18n/I18n';
import { languages, translate } from '../i18n/messages';
import messages from '../i18n/project-ui.json';

vi.mock('./useWorkspace', () => ({ motionApi: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const save = vi.fn(async () => {}), open = vi.fn(async () => true), refresh = vi.fn(), followActiveProject = vi.fn();
const workspace = { projects: [{ id: 'project', title: 'First film' }, { id: 'another', title: 'Second film' }], trashedProjects: [],
  status: { projectId: 'project' }, error: '', retryConnection: refresh, open, followActiveProject } as unknown as ReturnType<typeof useWorkspace>;
function Harness() {
  const archives = useProjectArchives(workspace, save, false, () => {});
  return <><button onClick={archives.showManager}>Manage</button><ProjectArchiveMenu archives={archives} projectId="project" title="First film" />{archives.manager}</>;
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === label)!;
const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role=menuitem]')].find(element => element.textContent === label)!;
beforeEach(async () => {
  vi.clearAllMocks(); save.mockResolvedValue(); workspace.trashedProjects = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<I18nProvider initialLocale="en"><Harness /></I18nProvider>));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it('lists projects and waits for pending saves before exporting all through the shared tool', async () => {
  let saved!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve; }));
  vi.mocked(motionApi).mockResolvedValue({ downloadUrl: '/motion-api/project-archives/archive/file', filename: 'projects.zip', projects: [] });
  await act(async () => button('Manage').click());
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Second film');
  await act(async () => button('Export all projects').click());
  expect(motionApi).not.toHaveBeenCalled();
  expect(button('Exporting…').disabled).toBe(true);
  await act(async () => saved());
  const [url, init] = vi.mocked(motionApi).mock.calls[0];
  expect(url).toBe('/phase1/call');
  expect(JSON.parse(init!.body as string)).toMatchObject({ name: 'openmotion_project_archive', arguments: { action: 'export', all: true, requestId: expect.any(String) } });
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Project ZIP ready');
  expect(document.querySelector('.om-project-manager [role=status]')).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('exports the selected project from an opened menu and retries with the same request identity', async () => {
  vi.mocked(motionApi).mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValueOnce({ downloadUrl: '/zip', filename: 'film.zip' });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for First film"]')!.click());
  await act(async () => menuItem('Export project').click());
  const first = JSON.parse(vi.mocked(motionApi).mock.calls[0][1]!.body as string);
  expect(first.arguments.projectIds).toEqual(['project']);
  expect(first.arguments.all).toBeUndefined();
  await act(async () => button('Retry').click());
  expect(JSON.parse(vi.mocked(motionApi).mock.calls[1][1]!.body as string)).toEqual(first);
});

it('uploads ZIP bytes, refreshes the project list and never automatically opens imported projects', async () => {
  vi.mocked(motionApi).mockResolvedValue({ projects: [{ projectId: 'new' }] });
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  const file = new File(['zip bytes'], 'shared.zip', { type: 'application/zip' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(vi.mocked(motionApi).mock.calls[0][0]).toMatch(/^\/project-archives\/import\?requestId=/);
  expect(vi.mocked(motionApi).mock.calls[0][1]!.body).toBe(file);
  expect(refresh).toHaveBeenCalledOnce();
  expect(open).not.toHaveBeenCalled();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('All projects');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Imported 1 projects');
});

it('keeps the bounded archive rejection reason visible for repair', async () => {
  vi.mocked(motionApi).mockRejectedValueOnce(new Error('INVALID_PROJECT_ARCHIVE: Missing index.html'));
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['zip bytes'], 'shared.zip', { type: 'application/zip' })] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  const feedback = document.querySelector('.motion-feedback-layer')?.textContent ?? '';
  expect(feedback).toContain('Missing index.html');
  expect(feedback).not.toContain('This ZIP is damaged or does not contain a supported project.');
});

it('rejects oversized or non-ZIP selections locally with floating feedback', async () => {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['text'], 'note.txt')] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  expect(motionApi).not.toHaveBeenCalled();
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Choose a ZIP file');
});

it('localizes project sharing and preserves placeholders in every supported language', () => {
  for (const { locale } of languages.filter(item => item.locale !== 'en')) {
    const dictionary = messages[locale as keyof typeof messages];
    expect(Object.keys(dictionary)).toEqual(Object.keys(messages['zh-CN']));
    for (const [key, value] of Object.entries(dictionary)) {
      expect(translate(locale, key)).toBe(value);
      expect(value.match(/\{\w+\}/g)).toEqual(key.match(/\{\w+\}/g));
    }
  }
});

it('duplicates the chosen project from All projects after saves and keeps retry identity', async () => {
  let saved!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { saved = resolve; }));
  vi.mocked(motionApi).mockRejectedValueOnce(new Error('PROJECT_ARCHIVE_VALIDATION_UNAVAILABLE: The HyperFrames validator could not run.')).mockResolvedValueOnce({ projectId: 'copy' });
  await act(async () => button('Manage').click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for Second film"]')!.click());
  await act(async () => menuItem('Duplicate project').click());
  expect(motionApi).not.toHaveBeenCalled();
  await act(async () => saved());
  const first = JSON.parse(vi.mocked(motionApi).mock.calls[0][1]!.body as string);
  expect(first).toMatchObject({ name: 'openmotion_manage_project', arguments: { action: 'duplicate', projectId: 'another', title: 'Second film (copy)' } });
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Project validation is temporarily unavailable.');
  await act(async () => button('Retry').click());
  expect(JSON.parse(vi.mocked(motionApi).mock.calls[1][1]!.body as string)).toEqual(first);
  expect(refresh).toHaveBeenCalledOnce(); expect(open).not.toHaveBeenCalled();
  await act(async () => button('Open project').click());
  expect(open).toHaveBeenCalledWith('projects', 'copy');
});

it('renames with the saved title as a conflict guard and uses floating confirmation', async () => {
  vi.mocked(motionApi).mockResolvedValueOnce({ title: 'Saved title', projectId: 'project' }).mockResolvedValueOnce({ title: 'First film' });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for First film"]')!.click());
  await act(async () => menuItem('Rename project').click());
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Project name');
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(JSON.parse(vi.mocked(motionApi).mock.calls[1][1]!.body as string)).toMatchObject({ name: 'openmotion_manage_project', arguments: { action: 'rename', projectId: 'project', title: 'Saved title', expectedTitle: 'Saved title' } });
  expect(refresh).toHaveBeenCalledOnce();
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Project renamed');
});

it('copies the actual project directory and reports clipboard failure through a Toast', async () => {
  const writeText = vi.fn().mockRejectedValueOnce(new Error('Clipboard denied')).mockResolvedValueOnce(undefined);
  vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
  vi.mocked(motionApi).mockResolvedValue({ path: '/data/projects/selected' });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for First film"]')!.click());
  await act(async () => menuItem('Copy path').click());
  expect(writeText).toHaveBeenCalledWith('/data/projects/selected');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Clipboard denied');
  await act(async () => button('Retry').click());
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Project path copied');
});

it('moves a project to Trash through the same management action', async () => {
  vi.mocked(motionApi).mockResolvedValueOnce({ projectId: 'project', title: 'First film', trashed: true, activeProjectId: 'another' });
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Actions for First film"]')!.click());
  await act(async () => menuItem('Move to trash').click());
  expect(JSON.parse(vi.mocked(motionApi).mock.calls[0][1]!.body as string)).toMatchObject({
    name: 'openmotion_manage_project', arguments: { action: 'trash', projectId: 'project', requestId: expect.any(String) },
  });
  expect(refresh).toHaveBeenCalledOnce();
  expect(followActiveProject).toHaveBeenCalledWith('another');
});

const choice = (label: string) => document.querySelector<HTMLElement>(`[role=checkbox][aria-label="${label}"]`)!;
const tab = (label: string) => [...document.querySelectorAll<HTMLElement>('[role=tab]')].find(element => element.textContent === label)!;
const argumentsAt = (index: number) => JSON.parse(vi.mocked(motionApi).mock.calls[index][1]!.body as string).arguments;

it('exports exactly the selected project ids, including separate rows with the same name', async () => {
  workspace.projects.push({ id: 'copy', title: 'First film' });
  try {
    vi.mocked(motionApi).mockResolvedValue({ downloadUrl: '/zip', filename: 'selection.zip' });
    await act(async () => button('Manage').click());
    const rows = document.querySelectorAll<HTMLElement>('[role=checkbox][aria-label="Select First film"]');
    expect(rows).toHaveLength(2);
    await act(async () => { rows[0].click(); rows[1].click(); });
    expect(choice('Select visible projects').getAttribute('aria-checked')).toBe('mixed');
    await act(async () => button('Export selected').click());
    expect(argumentsAt(0)).toMatchObject({ action: 'export', projectIds: ['project', 'copy'] });
    expect(argumentsAt(0).all).toBeUndefined();
  } finally { workspace.projects.pop(); }
});

it('restores checked projects and requires explicit confirmation before deleting Trash entries', async () => {
  workspace.trashedProjects = [{ id: 'a', title: 'Draft A', trashedAt: 1 }, { id: 'b', title: 'Draft B', trashedAt: 2 }];
  vi.mocked(motionApi).mockResolvedValue({ activeProjectId: 'project' });
  await act(async () => button('Manage').click());
  await act(async () => tab('Trash').click());
  await act(async () => choice('Select visible projects').click());
  await act(async () => button('Restore').click());
  expect(argumentsAt(0)).toMatchObject({ action: 'restore', projectId: 'a' });
  expect(argumentsAt(1)).toMatchObject({ action: 'restore', projectId: 'b' });

  await act(async () => choice('Select visible projects').click());
  await act(async () => button('Delete permanently').click());
  const confirm = () => [...document.querySelectorAll<HTMLElement>('[role=dialog]')].at(-1)!;
  expect(confirm().textContent).toContain('This permanently deletes 2 selected projects');
  expect(motionApi).toHaveBeenCalledTimes(2);
  await act(async () => button('Cancel').click());
  expect(motionApi).toHaveBeenCalledTimes(2);
  await act(async () => button('Delete permanently').click());
  await act(async () => [...confirm().querySelectorAll('button')].find(el => el.textContent === 'Delete permanently')!.click());
  expect(argumentsAt(2)).toMatchObject({ action: 'delete', projectId: 'a' });
  expect(argumentsAt(3)).toMatchObject({ action: 'delete', projectId: 'b' });
});
