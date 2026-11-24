// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/I18n';
import { PlatformExportPanel } from './PlatformExportPanel';

const state = vi.hoisted(() => ({
  projectId: 'project-a', statusId: 'project-a', blocked: false, empty: false, loading: false, failed: false,
  save: vi.fn<() => Promise<void>>(), connect: vi.fn(), retry: vi.fn(), close: vi.fn(),
  info: { name: 'OpenMotion', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/workspace', transport: { env: { SECRET: 'must-not-copy' } } },
}));
vi.mock('../../contexts/StudioContext', () => ({ useStudioShellContext: () => ({ projectId: state.projectId, renderQueue: { emptyComposition: state.empty } }) }));
vi.mock('../../motion/WorkspaceChromeContext', () => ({ useWorkspaceChrome: () => ({
  workspace: { status: { projectId: state.statusId }, projects: [{ id: state.projectId, title: `Title ${state.projectId}` }] },
  switchingDisabled: state.blocked, beforeViewChange: state.save, openConnections: state.connect,
}) }));
vi.mock('../../motion/useIntegrationInfo', () => ({ useIntegrationInfo: () => ({ info: state.loading || state.failed ? null : state.info, failed: state.failed, retry: state.retry }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!;
const render = () => act(async () => root.render(<I18nProvider initialLocale="en"><PlatformExportPanel onClose={state.close} /></I18nProvider>));
beforeEach(async () => {
  state.projectId = state.statusId = 'project-a'; state.blocked = state.empty = state.loading = state.failed = false;
  state.save.mockReset().mockResolvedValue(); state.connect.mockReset(); state.close.mockReset(); state.retry.mockReset();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render();
});
afterEach(() => { act(() => root.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); });

it('waits for saves, coalesces double clicks and copies a project-bound instruction with floating feedback', async () => {
  let finish!: () => void; state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await act(async () => { button('Copy for Agent').click(); button('Copy for Agent').click(); });
  expect(state.save).toHaveBeenCalledOnce(); expect(copy).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(copy).toHaveBeenCalledOnce();
  const prompt = copy.mock.calls[0][0];
  for (const value of ['Project ID: project-a', '/fixture/workspace', '/#project/project-a', 'YouTube Shorts', 'openmotion_manage_project', 'openmotion_export_request']) expect(prompt).toContain(value);
  expect(prompt).not.toContain('must-not-copy');
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Copied. Paste into your Agent.');
  expect(document.querySelector('[data-testid=platform-export-panel] .motion-feedback-layer')).toBeNull();
});
it('copies the selected platform and goal instead of hidden defaults', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await act(async () => document.querySelector<HTMLElement>('[role=radio][aria-label=Bilibili]')!.click());
  await act(async () => button('Goal').click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(node => node.textContent?.includes('Adapt the full video'))!.click());
  await act(async () => button('Copy for Agent').click());
  expect(copy.mock.calls[0][0]).toContain('Bilibili'); expect(copy.mock.calls[0][0]).toContain('16:9'); expect(copy.mock.calls[0][0]).toContain('original duration');
});
it('offers exact manual copy content after clipboard denial', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
  await act(async () => button('Copy for Agent').click());
  expect(document.querySelector<HTMLTextAreaElement>('[aria-label="Platform export instruction"]')?.value).toBe(copy.mock.calls[0][0]);
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Could not copy');
});
it('stops at failed saves with a recoverable toast', async () => {
  state.save.mockRejectedValue(new Error('Conflict')); const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await act(async () => button('Copy for Agent').click()); expect(copy).not.toHaveBeenCalled();
  expect(document.querySelector('.motion-feedback-layer')?.textContent).toContain('Could not save the project');
  expect(button('Copy for Agent').disabled).toBe(false);
});
it('cancels a pending handoff when the project changes', async () => {
  let finish!: () => void; state.save.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await act(async () => button('Copy for Agent').click()); state.projectId = state.statusId = 'project-b'; await render();
  await act(async () => finish()); expect(copy).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Title project-b');
});
it('blocks empty, mismatched or switching projects and pending integration', async () => {
  for (const flag of ['empty', 'blocked', 'loading'] as const) {
    state[flag] = true; await render(); expect(button('Copy for Agent').disabled).toBe(true); state[flag] = false;
  }
  state.statusId = 'project-b'; await render(); expect(button('Copy for Agent').disabled).toBe(true);
});
it('recovers failed integration and opens the existing MCP handbook', async () => {
  state.failed = true; await render(); expect(button('Copy for Agent').disabled).toBe(true);
  await act(async () => button('Retry').click()); expect(state.retry).toHaveBeenCalledOnce();
  await act(async () => button('Connection help').click()); expect(state.close).toHaveBeenCalledOnce(); expect(state.connect).toHaveBeenCalledExactlyOnceWith('platform_export');
  expect(state.save).not.toHaveBeenCalled();
});

const choose = async (label: string, option: string) => {
  await act(async () => button(label).click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role=option]')].find(node => node.textContent?.includes(option))!.click());
};
it('copies configured canvas, duration, clip count and caption policy; adaptation suppresses shortening', async () => {
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  expect(document.querySelectorAll('[role=radio] img')).toHaveLength(7);
  await choose('Goal', 'Extract highlights');
  await choose('Aspect ratio', '4:5');
  await choose('Duration', '15–30');
  await choose('Clip count', 'Up to 2');
  await choose('Captions', 'No captions');
  await act(async () => button('Copy for Agent').click());
  const brief = copy.mock.calls[0][0];
  for (const text of ['1080×1350', '15–30 seconds each', 'up to two', 'remove editable caption layers', 'burned-in captions']) expect(brief).toContain(text);
  expect(document.querySelector('[data-testid=platform-export-summary]')?.textContent).toContain('1080 × 1350');
  await choose('Goal', 'Adapt the full video');
  expect(button('Duration').disabled).toBe(true);
  expect(document.querySelector('button[aria-label="Clip count"]')).toBeNull();
  await act(async () => button('Copy for Agent').click());
  const adapted = copy.mock.calls[1][0];
  expect(adapted).toContain('original duration'); expect(adapted).not.toContain('15–30'); expect(adapted).not.toContain('up to two');
});
it('updates platform defaults while preserving an explicit canvas and clears stale manual-copy instructions', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Denied'));
  await act(async () => button('Copy for Agent').click());
  expect(document.querySelector('[aria-label="Platform export instruction"]')).not.toBeNull();
  await act(async () => document.querySelector<HTMLElement>('[role=radio][aria-label=Bilibili]')!.click());
  expect(document.querySelector('[aria-label="Platform export instruction"]')).toBeNull();
  expect(document.querySelector('[data-testid=platform-export-summary]')?.textContent).toContain('1920 × 1080');
  await choose('Aspect ratio', '1:1');
  await act(async () => document.querySelector<HTMLElement>('[role=radio][aria-label=Douyin]')!.click());
  expect(document.querySelector('[data-testid=platform-export-summary]')?.textContent).toContain('1080 × 1080');
});
