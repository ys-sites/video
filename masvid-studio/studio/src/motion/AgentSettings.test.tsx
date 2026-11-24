// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AgentSettings, DefaultAgentCard } from './AgentSettings';
import { I18nProvider } from '../i18n/I18n';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => { act(() => root?.unmount()); document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function button(text: string) { const el = [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === text); expect(el).toBeTruthy(); return el!; }
async function mount(child: React.ReactNode) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root.render(<I18nProvider initialLocale="en">{child}</I18nProvider>)); }
const codex = { id: 'codex', bin: 'codex', label: 'Codex', icon: 'codex', website: 'https://github.com/openai/codex', installed: true, auth: 'signed-in', checkedAt: 'now', modelFlag: '--model', models: [{ id: 'fixture-model', label: 'Fixture model', source: 'cli', reasoning: ['high'] }] };
it('guides missing Agents to installation and uses installed Agent model in the launch preview without launching automatically', async () => {
  const calls: { url: string; body: any }[] = []; let choice = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') { const body = JSON.parse(String(init.body)); calls.push({ url, body }); if (url.endsWith('default-agent')) choice = body.choice; if (url.includes('/prepare')) return Response.json({ command: "codex --model fixture-model", instruction: 'Connect the fixture workspace', modelInCommand: true, terminalAvailable: true }); return Response.json(codex); }
    return Response.json({ agents: [codex, { ...codex, id: 'kimi', label: 'Kimi Code', installed: false, auth: 'unknown', models: [] }], default: choice });
  }));
  await mount(<AgentSettings />);
  await act(async () => button('Kimi Code').click());
  expect([...document.querySelectorAll('a')].some(el => el.textContent?.includes('Download & install'))).toBe(true);
  expect(button('Open sign-in').disabled).toBe(true);
  await act(async () => button('Codex').click());
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-agent-model-list button')].find(el => el.textContent?.includes('Fixture model'))!.click());
  await act(async () => button('Set as default Agent').click());
  expect(choice).toEqual({ agent: 'codex', model: 'fixture-model' });
  await act(async () => button('Use in this project').click());
  expect(document.body.textContent).toContain('codex --model fixture-model');
  expect(calls.filter(call => call.url.includes('/prepare'))[0].body).toMatchObject({ agent: 'codex', model: 'fixture-model', action: 'launch' });
  expect(calls.some(call => call.url.endsWith('/open'))).toBe(false);
  await act(async () => button('Open terminal').click());
  expect(calls.filter(call => call.url.endsWith('/open'))).toHaveLength(1);
});
it('refreshes a saved default Agent model catalogue after a service restart', async () => {
  let inspected = false;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => { if (init?.method && init.method !== 'GET') { inspected = true; return Response.json(codex); } return Response.json({ agents: [{ ...codex, ...(inspected ? {} : { checkedAt: undefined, models: [] }) }], default: { agent: 'codex', model: 'fixture-model' } }); });
  vi.stubGlobal('fetch', fetcher); await mount(<DefaultAgentCard />);
  expect(fetcher.mock.calls.some(([url]) => url.endsWith('/codex/inspect'))).toBe(true);
  expect(document.body.textContent).toContain('Fixture model');
});
it('preserves the saved reasoning effort when saving and launching from default settings', async () => {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return Response.json({ command: 'codex --model fixture-model', instruction: 'Connect this workspace' });
    }
    return Response.json({ agents: [codex], default: { agent: 'codex', model: 'fixture-model', reasoning: 'high' } });
  }));
  await mount(<DefaultAgentCard />);
  await act(async () => button('Save default').click());
  expect(calls.find(call => call.url.endsWith('default-agent'))?.body.choice).toEqual({ agent: 'codex', model: 'fixture-model', reasoning: 'high' });
  await act(async () => button('Use in this project').click());
  expect(calls.find(call => call.url.includes('/prepare'))?.body).toMatchObject({ agent: 'codex', model: 'fixture-model', reasoning: 'high' });
});
