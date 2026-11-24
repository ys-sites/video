// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ProjectAgentAction } from './ProjectAgentAction';

const state = vi.hoisted(() => ({
  projectId: 'project-a', blocked: false,
  save: vi.fn<() => Promise<void>>(), connect: vi.fn(),
  info: { name: 'OpenMotion', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/workspace',
    transport: { env: { SECRET: 'must-not-copy' } } },
}));
vi.mock('../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: state.projectId }) }));
vi.mock('./WorkspaceChromeContext', () => ({ useWorkspaceChrome: () => ({
  workspace: { status: { projectId: state.projectId }, projects: [{ id: state.projectId, title: `Title ${state.projectId}` }] },
  switchingDisabled: state.blocked, beforeViewChange: state.save, openConnections: state.connect,
}) }));
vi.mock('./useIntegrationInfo', () => ({ useIntegrationInfo: () => ({ info: state.info, failed: false, retry: vi.fn() }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const render = () => act(async () => root.render(<I18nProvider initialLocale="en"><ProjectAgentAction /></I18nProvider>));
beforeEach(async () => {
  state.projectId = 'project-a'; state.blocked = false; state.save.mockReset().mockResolvedValue(); state.connect.mockReset();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
async function open() { await act(async () => button('MCP').click()); }

it('waits for saves and copies the exact project and workspace without credentials', async () => {
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await open();
  await act(async () => button('Copy instruction').click());
  expect(copy).not.toHaveBeenCalled();
  await act(async () => finish());
  const prompt = copy.mock.calls[0][0];
  expect(prompt).toContain('Project ID: project-a');
  expect(prompt).toContain('/fixture/workspace');
  expect(prompt).toContain('http://127.0.0.1:4567/#project/project-a');
  expect(prompt).toMatch(/^Project: Title project-a\nProject ID: project-a/);
  expect(prompt).toContain('Read the latest content first');
  expect(prompt).toContain('preserving existing content and edit history');
  expect(prompt).not.toContain('must-not-copy');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Instruction copied');
});

it('finishes copying when the popover is dismissed during a pending save', async () => {
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await open();
  await act(async () => button('Copy instruction').click());
  await act(async () => button('Close').click());
  expect(button('MCP').getAttribute('aria-expanded')).toBe('false');
  expect(copy).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('Project ID: project-a'));
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Instruction copied');
});

it('reopens the dismissed panel when copying fails so the fallback is visible', async () => {
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
  await open();
  await act(async () => button('Copy instruction').click());
  await act(async () => button('Close').click());
  expect(button('MCP').getAttribute('aria-expanded')).toBe('false');
  await act(async () => finish());
  expect(button('MCP').getAttribute('aria-expanded')).toBe('true');
  const fallback = document.querySelector('textarea')!;
  expect(fallback.value).toContain('Project ID: project-a');
  expect(fallback.closest('[hidden], [aria-hidden="true"]')).toBeNull();
});

it('does not copy when saving fails', async () => {
  state.save.mockRejectedValue(new Error('Conflict'));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await open(); await act(async () => button('Copy instruction').click());
  expect(copy).not.toHaveBeenCalled();
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Could not save the project');
});

it('offers the same instruction for manual copying when the clipboard is unavailable', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
  await open(); await act(async () => button('Copy instruction').click());
  expect(document.querySelector('textarea')?.value).toContain('Project ID: project-a');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Could not copy');
});

it('cancels an unfinished handoff when the project changes', async () => {
  let finish!: () => void;
  state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await open(); await act(async () => button('Copy instruction').click());
  state.projectId = 'project-b'; await render();
  await act(async () => finish());
  expect(copy).not.toHaveBeenCalled();
  await open();
  expect(document.body.textContent).toContain('Title project-b');
});

it('disables the trigger when the editor cannot hand off safely', async () => {
  state.blocked = true; await render();
  expect(button('MCP').disabled).toBe(true);
});

it('opens the existing connection guide without starting an Agent', async () => {
  await open(); await act(async () => button('Connection help').click());
  expect(state.connect).toHaveBeenCalledOnce();
  expect(state.save).not.toHaveBeenCalled();
});
