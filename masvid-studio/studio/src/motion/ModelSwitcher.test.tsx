// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ModelSwitcher } from './ModelSwitcher';
import { I18nProvider } from '../i18n/I18n';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('keeps the model picker open after a failed selection and only retries on another click', async () => {
  let fail = true;
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT'
    ? Response.json(fail ? { error: 'Provider unavailable' } : {}, { status: fail ? 503 : 200 })
    : Response.json({ providers: [{ id: 'codex', label: 'Codex', protocol: 'agent', available: true }],
      models: [{ id: 'codex/image', modelId: 'image', label: 'Fixture image', kind: 'image', enabled: true, provider: 'codex' }], defaults: {} }));
  vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const choose = () => [...document.querySelectorAll<HTMLButtonElement>('.om-model-choice-list button')][0];
  try {
    await act(async () => root.render(<I18nProvider initialLocale="en"><ModelSwitcher openSettings={() => {}} /></I18nProvider>));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Select model"]')!.click());
    await act(async () => choose().click());
    expect(choose().disabled).toBe(false);
    expect(document.querySelector('.motion-feedback-layer [role=alert]')?.textContent).toContain('Action not completed. Please try again.');
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    fail = false;
    await act(async () => choose().click());
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(2);
    expect(document.querySelector('.om-model-choice-list')).toBeNull();
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
