// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

const account = vi.hoisted(() => ({ state: 'signed-out' as string }));
vi.mock('./AccountSettings', () => ({ useAccountSummary: () => ({ account: { state: account.state } }) }));
vi.mock('./useMediaCatalog', () => ({ useMediaCatalog: () => ({ catalog: { models: [], status: { providers: [{ id: 'gemini', label: 'Gemini', available: false }] } }, failed: false, retry: () => {} }) }));
import { ModelHub } from './ModelHub';
import { I18nProvider } from '../i18n/I18n';

let container: HTMLDivElement;
afterEach(() => container?.remove());
async function render() {
  container = document.createElement('div'); document.body.append(container);
  const onProvider = vi.fn();
  await act(async () => createRoot(container).render(<I18nProvider initialLocale="en"><ModelHub id="gemini-4" onExplore={() => {}} onProvider={onProvider} onModel={() => {}} onUse={() => {}} onSettings={() => {}} /></I18nProvider>));
  return { onProvider, hero: () => [...container.querySelectorAll<HTMLButtonElement>('.om-model-hub-hero-copy button')].map(button => button.textContent) };
}

it('offers to connect when nothing is connected and shows the connection once signed in', async () => {
  account.state = 'signed-out';
  let view = await render();
  expect(view.hero()).toContain('Sign in to use Gemini 4 Neon now');
  expect(view.hero()).toContain('Connect your own API key');
  container.remove();
  account.state = 'signed-in';
  view = await render();
  expect(view.hero()).toContain('Connected to OpenDesign');
  await act(async () => container.querySelector<HTMLButtonElement>('.om-model-hub-connected')!.click());
  expect(view.onProvider).toHaveBeenCalledWith('account');
});
