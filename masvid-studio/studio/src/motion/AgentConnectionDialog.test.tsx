// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18n';
import { ConnectionDialog } from './ConnectionDialog';

vi.mock('./StudioHost', () => ({ useMvpEditor: () => true }));
vi.mock('./TemplateLibraryDialog', () => ({ TemplateLibraryDialog: () => <div>Template library fixture</div> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const info = { name: 'OpenMotion', version: '1.2.3', previewUrl: 'http://127.0.0.1:4567', dataDirectory: '/fixture/data',
  transport: { type: 'stdio', command: 'node', args: ['/fixture/mcp.ts'], cwd: '/fixture', env: { MOTION_DATA_DIR: '/fixture/data' } }, tools: [] };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount(section: 'setup' | 'templates' = 'setup') {
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  const close = vi.fn();
  await act(async () => root!.render(<I18nProvider initialLocale="en"><ConnectionDialog open section={section} busy={false} error="" onClose={close} onOpen={() => {}} /></I18nProvider>));
  return close;
}
function button(name: string) { return [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name)!; }

it('opens connection setup in the MVP and copies public installation instructions', async () => {
  const fetcher = vi.fn(async () => Response.json(info)); vi.stubGlobal('fetch', fetcher);
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const close = await mount();
  expect(document.querySelector('[role=dialog]')?.textContent).toContain('Connect Agent');
  expect(document.body.textContent).not.toContain('Template library fixture');
  expect(document.body.textContent).toContain('Workspace reachable');
  await act(async () => button('Copy connection instruction').click());
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('https://github.com/nexu-io/openmotion#quick-start'));
  expect(document.querySelector('[role=status]')?.textContent).toContain('Copied to clipboard');
  expect(document.querySelector('.om-agent-connection [role=status]')).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe('/motion-api/integration');
  await act(async () => button('Close').click()); expect(close).toHaveBeenCalledOnce();
});

it('keeps template browsing separate from connection setup', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await mount('templates'); expect(document.body.textContent).toBe('Template library fixture'); expect(fetcher).not.toHaveBeenCalled();
});

it('recovers from an unavailable integration without showing stale configuration', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async () => fail ? Response.json({}, { status: 503 }) : Response.json(info)));
  await mount(); expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not reach this workspace');
  expect(button('Copy connection instruction').disabled).toBe(false);
  expect(document.querySelector('a[download]')).toBeNull();
  expect(document.querySelector('pre')?.textContent).not.toContain('/fixture');
  fail = false; await act(async () => button('Retry').click());
  expect(button('Copy connection instruction')).toBeTruthy();
  fail = true; await act(async () => button('Refresh status').click());
  expect(button('Copy connection instruction').disabled).toBe(false);
  expect(document.querySelector('a[download]')).toBeNull();
});

it('updates manual setup with the selected client and explains unsupported cloud access', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(info)));
  await mount();
  const select = async (name: string) => {
    await act(async () => document.querySelector<HTMLButtonElement>('[role=combobox]')!.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role=option]')].find(node => node.textContent?.includes(name))!;
    expect(option).toBeTruthy();
    await act(async () => option.click());
  };
  await select('Claude Code');
  expect(document.querySelector('.om-agent-connection')?.textContent).toContain('connect OpenMotion in Claude Code');
  expect(document.querySelector('a[download]')?.getAttribute('href')).toBe('/connect/config?host=claude');
  expect(document.querySelector('details pre')?.textContent).toContain('claude mcp add');
  await select('ChatGPT');
  expect(document.body.textContent).toContain('Remote connection unavailable');
  expect(button('Copy connection instruction')).toBeUndefined();
  expect(document.querySelector('a[download]')).toBeNull();
});
