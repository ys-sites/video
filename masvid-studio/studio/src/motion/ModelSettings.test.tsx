// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelSettings, providerListStatus } from './ModelSettings';
import { I18nProvider } from '../i18n/I18n';
import { providerSettingsPreview, type ProviderSetupEntry } from '../../../shared/workspace-url';
import { readWorkspacePage } from './workspacePageRouting';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const originalUrl = window.location.href;
afterEach(() => {
  act(() => root?.unmount()); root = undefined; document.body.innerHTML = '';
  history.replaceState(null, '', originalUrl); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function type(label: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function click(text: string) { const button = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === text)!; expect(button).toBeTruthy(); button.click(); }
async function mount(providerId?: string | null) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><ModelSettings openAccount={() => {}} providerId={providerId} /></I18nProvider>));
}
function handoff(entry: ProviderSetupEntry) {
  const url = new URL(providerSettingsPreview(location.origin, { entry }).previewUrl);
  history.replaceState(null, '', url);
  return readWorkspacePage(url.search, url.hash, url.pathname).provider;
}
// The OpenDesign provider also reads the account summary for its guides; count only directory loads.
const directoryCalls = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls.filter(([url]) => String(url).endsWith('/settings/providers')).length;
const account = { id: 'account', label: 'OpenDesign', protocol: 'account', category: 'account', kinds: ['text', 'image'], configured: false, enabled: false, available: false };
it('hides text-only providers across search and direct links while preserving media and unclassified custom connections', async () => {
  const text = { ...account, id: 'text-only', label: 'Text only', protocol: 'openai', category: 'language', kinds: ['text'], configured: true, custom: false };
  const fetcher = vi.fn(async () => Response.json({ providers: [account, text,
    { ...text, id: 'media', label: 'Media models', kinds: ['text', 'image'] },
    { ...text, id: 'discovered-media', label: 'Discovered media' },
    { ...text, id: 'custom-new', label: 'New connection', custom: true },
    { ...text, id: 'custom-text', label: 'Custom text', custom: true }],
    models: [{ provider: 'custom-text', kind: 'text' }, { provider: 'discovered-media', kind: 'image' }], defaults: {} }));
  vi.stubGlobal('fetch', fetcher); await mount('text-only');
  const names = [...document.querySelectorAll('.om-provider-item-name')].map(node => node.firstChild?.textContent);
  expect(names).toEqual(['OpenDesign', 'Media models', 'Discovered media', 'New connection']);
  expect(document.querySelector('.om-provider-heading h1')?.textContent).toBe('OpenDesign');
  await act(async () => type('Search providers', 'Text only'));
  expect(document.querySelectorAll('.om-provider-item')).toHaveLength(0);
  expect(document.body.textContent).toContain('No matching providers');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Clear filters"]')!.click());
  expect(document.querySelectorAll('.om-provider-item')).toHaveLength(4);
  expect(directoryCalls(fetcher)).toBe(1);
});
for (const [id, label] of [['fal', 'fal.ai'], ['atlascloud', 'Atlas Cloud'], ['wavespeed', 'WaveSpeedAI']]) it(`saves and removes ${label} credentials without revealing the key or making a paid call`, async () => {
  let configured = false; const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { expect(url).toBe(`/motion-api/settings/providers/${id}`); const body = JSON.parse(String(init.body)); writes.push(body); configured = !!body.apiKey; return Response.json({}); }
    expect(url).toBe('/motion-api/settings/providers');
    return Response.json({ providers: [account, { id, label, protocol: 'media', category: 'multimodal', kinds: ['image', 'video', 'audio'], baseUrl: 'https://api.example', baseUrlEditable: false, configured, enabled: configured, available: configured, credentialSource: configured ? 'stored' : 'none' }], models: [], defaults: {} });
  }));
  await mount();
  expect(document.body.textContent).toContain('One account. Your models, together.');
  await act(async () => document.querySelectorAll<HTMLButtonElement>('.om-provider-item')[1].click());
  await act(async () => type(`${label} API key`, 'synthetic-private-key'));
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(writes).toEqual([{ apiKey: 'synthetic-private-key' }]);
  expect(document.querySelector<HTMLInputElement>(`[aria-label="${label} API key"]`)!.value).toBe('');
  expect(document.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('true');
  expect(document.body.textContent).not.toContain('synthetic-private-key');
  await act(async () => click('Remove saved key'));
  expect(writes[1]).toEqual({ apiKey: null });
  expect(document.querySelector('[role=switch]')?.getAttribute('aria-checked')).toBe('false');
});

it('searches providers without mutating credentials and recovers from failed directory loading', async () => {
  let failed = true;
  const fetcher = vi.fn(async () => failed ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ providers: [account], models: [], defaults: {} }));
  vi.stubGlobal('fetch', fetcher); await mount();
  expect(document.body.textContent).toContain('Could not load settings');
  failed = false; await act(async () => click('Retry'));
  await act(async () => type('Search providers', 'absent'));
  expect(document.body.textContent).toContain('No matching providers');
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Clear filters"]')!.click());
  expect(document.querySelectorAll('.om-provider-item')).toHaveLength(1);
  expect(directoryCalls(fetcher)).toBe(2);
});

it('marks only runnable providers with a dot and configured-but-switched-off providers as Disabled', async () => {
  expect(providerListStatus({ configured: true, enabled: true, available: true })).toBe('available');
  expect(providerListStatus({ configured: true, enabled: false, available: false })).toBe('disabled');
  expect(providerListStatus({ configured: false, enabled: true, available: false })).toBeNull();
  expect(providerListStatus({ configured: false, enabled: false, available: false })).toBeNull();
  expect(providerListStatus({ configured: true, enabled: true, available: false })).toBeNull();
  const media = { protocol: 'media', category: 'multimodal', kinds: ['image', 'video'], baseUrl: 'https://api.example', custom: false, credentialSource: 'stored' };
  const providers = [
    { ...media, id: 'ready', label: 'Ready', configured: true, enabled: true, available: true },
    { ...media, id: 'off', label: 'Off', configured: true, enabled: false, available: false },
    { ...media, id: 'empty', label: 'Empty', configured: false, enabled: false, available: false, credentialSource: 'none' },
  ];
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ providers, models: [], defaults: {} })));
  await mount();
  const row = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(node => node.textContent?.includes(label))!;
  expect(row('Ready').querySelector('.om-status-dot')).toBeTruthy();
  expect(row('Ready').getAttribute('aria-label')).toContain('Available');
  expect(row('Off').dataset.status).toBe('disabled');
  expect(row('Off').querySelector('.om-badge')?.textContent).toBe('Disabled');
  expect(row('Off').querySelector('.om-status-dot')).toBeNull();
  expect(row('Empty').querySelector('.om-status-dot, .om-badge, .ri-check-line')).toBeNull();
});

it('validates a custom provider at its fields and only writes corrected values', async () => {
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { writes.push(JSON.parse(String(init.body))); return Response.json({ id: 'custom-new' }); }
    return Response.json({ providers: [account], models: [], defaults: {} });
  }));
  await mount(); await act(async () => click('Add provider'));
  const submit = async () => act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await submit();
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Provider name');
  await act(async () => { type('Provider name', 'x'.repeat(81)); type('API base URL', 'http://api.example.com/v1'); });
  expect(document.body.textContent).toContain('Provider name cannot exceed 80 characters.');
  expect(document.body.textContent).toContain('Use an HTTPS API URL.');
  await act(async () => { type('Provider name', 'Test'); type('API base URL', 'https://api.example.com/v1?key=x'); });
  await submit();
  expect(document.activeElement?.getAttribute('aria-label')).toBe('API base URL');
  expect(document.body.textContent).toContain('Remove credentials, query parameters and fragments');
  expect(writes).toHaveLength(0);
  await act(async () => type('API base URL', 'https://api.example.com/v1'));
  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  await submit(); expect(writes).toEqual([{ label: 'Test', baseUrl: 'https://api.example.com/v1', protocol: 'openai' }]);
});
it.each(['', 'not-a-url', 'https://api.example.com/v1'])('allows editing a stored-key provider with no parseable origin or an unchanged origin (%s)', async baseUrl => {
  const writes: unknown[] = [];
  const provider = { ...account, id: 'new-api', label: 'New API', protocol: 'openai', category: 'multimodal', baseUrl, configured: true, credentialSource: 'stored' };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)); writes.push(body); provider.baseUrl = body.baseUrl;
      return Response.json({});
    }
    return Response.json({ providers: [provider], models: [], defaults: {} });
  }));
  await mount('new-api');
  await act(async () => type('API base URL', 'https://api.example.com/v2'));
  expect(document.querySelector<HTMLInputElement>('[aria-label="API base URL"]')?.value).toBe('https://api.example.com/v2');
  await act(async () => click('Save settings'));
  expect(writes).toEqual([{ baseUrl: 'https://api.example.com/v2' }]);
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  expect(document.querySelector<HTMLInputElement>('[aria-label="New API API key"]')?.value).toBe('');
  expect(document.body.textContent).toContain('Provider settings saved');
});
it('shows origin-change key requirements inline and keeps operational save failures in Toasts', async () => {
  const writes: unknown[] = [];
  const custom = { ...account, id: 'custom', label: 'Custom', custom: true, protocol: 'openai', category: 'custom', baseUrl: 'https://old.example.com/v1', configured: true, credentialSource: 'stored' };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') { writes.push(JSON.parse(String(init.body))); return Response.json({ error: 'Service unavailable' }, { status: 503 }); }
    return Response.json({ providers: [account, custom], models: [], defaults: {} });
  }));
  await mount('custom');
  await act(async () => { type('Provider name', 'x'.repeat(81)); type('API base URL', 'https://new.example.com/v1'); });
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2);
  expect(document.body.textContent).toContain('Enter the API key again when changing the API origin.');
  expect(writes).toHaveLength(0);
  await act(async () => { type('Provider name', 'Custom'); type('Custom API key', 'synthetic-key'); });
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(writes).toHaveLength(1);
  expect(document.querySelector('.studio-toast')?.textContent ?? document.body.textContent).toContain('Action not completed. Please try again.');
  expect(document.querySelector<HTMLInputElement>('[aria-label="Custom API key"]')!.value).toBe('synthetic-key');
});
it('clears validated field errors after a successful origin change while the directory refreshes', async () => {
  const custom = { ...account, id: 'custom', label: 'Custom', custom: true, protocol: 'openai', baseUrl: 'https://old.example.com', configured: true, credentialSource: 'stored' };
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'PUT' ? Response.json({}) : Response.json({ providers: [custom], models: [], defaults: {} })));
  await mount('custom');
  await act(async () => { type('API base URL', 'https://new.example.com'); type('Custom API key', 'synthetic-key'); });
  await act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(document.querySelector<HTMLInputElement>('[aria-label="Custom API key"]')!.value).toBe('');
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
});

it('keeps the provider directory guidance and text models when the account summary request fails', async () => {
  const goAccount = { ...account, configured: true, enabled: true, available: true, credentialSource: 'account',
    reason: 'Signed in; multimodal generation requires OpenDesign Plus or above' };
  const textModel = { id: 'account:language-one', provider: 'account', modelId: 'language-one', label: 'Language One', kind: 'text', enabled: true, source: 'live' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.endsWith('/settings/account')
    ? Response.json({ error: 'unavailable' }, { status: 503 })
    : Response.json({ providers: [goAccount], models: [textModel], defaults: {} })));
  await mount('account');
  expect(document.body.textContent).toContain('Signed in; multimodal generation requires OpenDesign Plus or above');
  expect(document.body.textContent).toContain('Manage account');
  expect(document.body.textContent).toContain('Language One');
  const useDefault = document.querySelector<HTMLButtonElement>('[aria-label="Use Language One as default"]')!;
  expect(useDefault.disabled).toBe(false);
});

for (const [summary, heading, action] of [
  [{ state: 'signed-out' }, 'Sign in to start multimodal generation', 'Sign in with OpenDesign'],
  [{ state: 'signed-in', plan: 'go' }, 'Go', 'Upgrade to Plus'],
  [{ state: 'signed-in', plan: 'free' }, 'Free plan', 'Upgrade to Plus'],
] as const) it(`shows the account page ${heading} guide on the OpenDesign provider and keeps its models`, async () => {
  const textModel = { id: 'account:language-one', provider: 'account', modelId: 'language-one', label: 'Language One', kind: 'text', enabled: true, source: 'live' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(String(url))
    ? Response.json({ consoleUrl: 'https://console.example', ...summary })
    : Response.json({ providers: [{ ...account, configured: summary.state === 'signed-in' }], models: [textModel], defaults: {} })));
  await mount('account');
  const guide = document.querySelector('.om-plan-guide')!;
  expect(guide.querySelector('.om-plan-guide-head h2')?.textContent).toBe(heading);
  expect(guide.textContent).toContain('Images'); expect(guide.textContent).toContain('Music'); expect(guide.textContent).toContain('Multimodal from $14/mo');
  expect(guide.textContent).toContain(action);
  expect(document.querySelector('.om-account-callout')).toBeNull();
  expect(document.querySelector('.om-provider-detail-inner > .om-settings-tags')).toBeNull();
  expect(document.body.textContent).toContain('Language One');
});

it('starts with OpenDesign detail open on the embedded signed-out handoff', async () => {
  vi.stubGlobal('innerWidth', 420);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(url)
    ? Response.json({ state: 'signed-out' }) : Response.json({ providers: [account], models: [], defaults: {} })));
  await mount(handoff('agent_media_signed_out'));
  expect(location.search).toContain('embed=1');
  expect(document.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('true');
  expect(document.querySelector('.om-provider-heading h1')?.textContent).toBe('OpenDesign');
  expect(document.querySelector('[data-guide="sign-in"]')?.textContent).toContain('Sign in with OpenDesign');
});

it('explains unavailable billing on the upgrade handoff and retries inline', async () => {
  let summary: object = { state: 'signed-in', billingUnavailable: true };
  const fetcher = vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(url) ? Response.json(summary)
    : Response.json({ providers: [{ ...account, configured: true }], models: [], defaults: {} }));
  vi.stubGlobal('fetch', fetcher);
  await mount(handoff('agent_media_upgrade_go'));
  expect(document.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('true');
  expect(document.body.textContent).toContain("Couldn't verify your OpenDesign plan and balance right now.");
  expect(document.body.textContent).toContain('Multimodal generation requires OpenDesign Plus or above.');
  expect(document.body.textContent).toContain('Manage subscription');
  fetcher.mockClear();
  summary = { state: 'signed-in', plan: 'go', billingUnavailable: false };
  await act(async () => click('Refresh'));
  expect(fetcher).toHaveBeenCalledWith('/motion-api/settings/account?refresh=true', expect.anything());
  expect(document.querySelector('[data-guide="upgrade"]')?.textContent).toContain('Upgrade to Plus');
  expect(document.body.textContent).not.toContain('OpenDesign billing is unavailable');
  expect(directoryCalls(fetcher)).toBe(1);
});

it('explains a low balance in place and refreshes billing when returning to the visible tab', async () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith('/subscription')) return Response.json({ opened: true });
    if (/\/settings\/account(\?|$)/.test(url)) return Response.json({ state: 'signed-in', plan: 'plus', balance: '0.00' });
    return Response.json({ providers: [{ ...account, configured: true }], models: [], defaults: {} });
  });
  vi.stubGlobal('fetch', fetcher);
  await mount(handoff('agent_media_balance_low'));
  expect(document.body.textContent).toContain('Your OpenDesign balance was too low for the media request.');
  expect(document.querySelector('[data-guide="upgrade"]')).toBeNull();
  expect(document.body.textContent).toContain('Refresh');
  fetcher.mockClear();
  await act(async () => click('Manage subscription'));
  expect(fetcher).toHaveBeenCalledWith('/motion-api/settings/account/subscription', expect.objectContaining({ method: 'POST' }));
  const billingReads = () => fetcher.mock.calls.filter(([url]) => url.endsWith('account?refresh=true')).length;
  visibility.mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  expect(billingReads()).toBe(0);
  visibility.mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  expect(billingReads()).toBe(1);
  expect(directoryCalls(fetcher)).toBe(0);
});

it('opens the first configured rejected key and lets the user return to the provider list', async () => {
  const rejected = (id: string, configured = true) => ({
    ...account, id, label: id, protocol: 'media', category: 'media', kinds: ['image'], configured, enabled: true,
    verification: 'rejected', credentialSource: 'stored', baseUrlEditable: false,
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(url)
    ? Response.json({ state: 'signed-out' })
    : Response.json({ providers: [account, rejected('Unconfigured', false), rejected('First key'), rejected('Second key')], models: [], defaults: {} })));
  await mount(handoff('agent_media_key_rejected'));
  expect(document.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('true');
  expect(document.querySelector('.om-provider-heading h1')?.textContent).toBe('First key');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('Credentials or permissions rejected; update the key');
  expect(document.querySelector('[aria-label="First key API key"]')).toBeTruthy();
  await act(async () => click('Providers'));
  expect(document.querySelector('.om-provider-settings')?.getAttribute('data-detail')).toBe('false');
});

it('keeps explicitly linked providers selected even on a rejected-key entry', async () => {
  handoff('agent_media_key_rejected');
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(url)
    ? Response.json({ state: 'signed-out' })
    : Response.json({ providers: [account, { ...account, id: 'rejected', label: 'Rejected', protocol: 'media', configured: true, verification: 'rejected' }], models: [], defaults: {} })));
  await mount('account');
  expect(document.querySelector('.om-provider-heading h1')?.textContent).toBe('OpenDesign');
});

it('signs in in place from the OpenDesign provider guide without leaving the page', async () => {
  const openAccount = vi.fn(), posts: string[] = [];
  const signedOut = { consoleUrl: 'https://console.example', state: 'signed-out' };
  let summary: object = signedOut;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(String(url)); summary = String(url).endsWith('/login') ? { consoleUrl: 'https://console.example', state: 'authorizing', authorizationUrl: 'https://console.example/activate', userCode: 'ABCD-1234' } : signedOut; return Response.json(summary); }
    return /\/settings\/account(\?|$)/.test(String(url)) ? Response.json(summary)
      : Response.json({ providers: [account], models: [], defaults: {} });
  }));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><ModelSettings openAccount={openAccount} providerId="account" /></I18nProvider>));
  await act(async () => click('Sign in with OpenDesign'));
  expect(posts).toEqual(['/motion-api/settings/account/login']);
  expect(openAccount).not.toHaveBeenCalled();
  expect(document.querySelector('.om-provider-heading h1')?.textContent).toBe('OpenDesign');
  expect(document.body.textContent).toContain('Complete sign-in in your browser');
  expect(document.body.textContent).toContain('ABCD-1234');
  await act(async () => click('Cancel'));
  expect(posts).toEqual(['/motion-api/settings/account/login', '/motion-api/settings/account/cancel']);
});

it('signs in in place even before the account summary loads', async () => {
  const openAccount = vi.fn(), posts: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push(String(url)); return Response.json({ consoleUrl: 'https://console.example', state: 'authorizing' }); }
    return /\/settings\/account(\?|$)/.test(String(url)) ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ providers: [account], models: [], defaults: {} });
  }));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(<I18nProvider initialLocale="en"><ModelSettings openAccount={openAccount} providerId="account" /></I18nProvider>));
  await act(async () => click('Sign in with OpenDesign'));
  expect(posts).toEqual(['/motion-api/settings/account/login']);
  expect(openAccount).not.toHaveBeenCalled();
});

it('merges configured account identity into the header, exposes modality tabs, pins defaults and prioritizes configured providers', async () => {
  const configuredAccount = {
    ...account,
    kinds: ['text', 'image', 'video', 'audio'],
    configured: true,
    enabled: true,
    available: true,
    reason: 'Included with your account',
  };
  const providers = [
    configuredAccount,
    { id: 'fal', label: 'fal.ai', protocol: 'media', category: 'multimodal', kinds: ['image', 'video'], configured: false, enabled: false, available: false },
    { id: 'cloud', label: 'OpenDesign Cloud', protocol: 'media', category: 'multimodal', kinds: ['image', 'video'], configured: true, enabled: true, available: true },
  ];
  const models = [
    { id: 'account:claude-fable-5', provider: 'account', modelId: 'claude-fable-5', label: 'claude-fable-5', kind: 'text', enabled: true, source: 'live' },
    { id: 'account:flux-pro', provider: 'account', modelId: 'flux-pro-1.1', label: 'FLUX Pro', kind: 'image', enabled: true, source: 'live' },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(String(url))
    ? Response.json({ consoleUrl: 'https://console.example', state: 'signed-in', plan: 'plus', user: { email: 'creator@example.com' } })
    : Response.json({ providers, models, defaults: { image: 'account:flux-pro' } })));
  await mount('account');

  // Configured providers float right beneath OpenDesign.
  const sidebarNames = [...document.querySelectorAll('.om-provider-item-name')].map(node => node.firstChild?.textContent);
  expect(sidebarNames).toEqual(['OpenDesign', 'OpenDesign Cloud', 'fal.ai']);

  // Paid configured account folds plan, status, identity and Manage account into the header without an extra callout card.
  const header = document.querySelector('.om-provider-header')!;
  expect(header.querySelector('.om-provider-plan-badge')?.textContent).toBe('Plus');
  expect(header.querySelector('.om-provider-status-badge')?.textContent).toBe('Configured');
  expect(header.querySelector('.om-provider-meta')?.textContent).toBe('creator@example.com · Your account');
  const manageBtn = [...header.querySelectorAll('button')].find(btn => btn.textContent?.includes('Manage account'))!;
  expect(manageBtn.hasAttribute('data-primary')).toBe(false);
  expect(document.querySelector('.om-account-callout')).toBeNull();
  expect(document.querySelector('.om-provider-detail-inner > .om-settings-tags')).toBeNull();

  // Active default model pins to the top of default order and highlights; managed account rows show one clean display name with raw ID in tooltip.
  const rows = [...document.querySelectorAll('.om-model-row')];
  expect(rows[0].querySelector('.om-model-name strong')?.textContent).toBe('FLUX Pro');
  expect(rows[0].querySelector('.om-model-name strong')?.getAttribute('title')).toBe('flux-pro-1.1');
  expect(rows[0].querySelector('.om-model-name .om-model-id')).toBeNull();
  expect(rows[0].querySelector('.om-model-default-button')?.getAttribute('data-active')).toBe('true');
  expect(rows[1].querySelector('.om-model-name strong')?.textContent).toBe('claude-fable-5');
  expect(rows[1].querySelector('.om-model-name strong')?.getAttribute('title')).toBeNull();
  expect(rows[1].querySelector('.om-model-name small')).toBeNull();
  expect(rows[1].querySelector('.om-model-default-button')?.getAttribute('data-active')).toBeNull();

  // Modality tabs switch directly between All, Text and Image, and heading avoids duplicating total count.
  expect(document.querySelector('.om-model-section h2')?.textContent).toBe('Models');
  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  expect(tabs.map(tab => tab.textContent)).toEqual(['All2', 'Text1', 'Image1']);
  await act(async () => tabs[1].click());
  expect([...document.querySelectorAll('.om-model-row .om-model-name strong')].map(el => el.textContent)).toEqual(['claude-fable-5']);
});

it('hides model edit menu for managed account/agent providers, renders verified media capabilities and ignores stale descriptive overrides', async () => {
  const configuredAccount = {
    ...account,
    kinds: ['text', 'image', 'video', 'audio'],
    configured: true,
    enabled: true,
    available: true,
    reason: 'Included with your account',
  };
  const codex = { id: 'codex', label: 'Codex', protocol: 'agent', category: 'local', kinds: ['image'], configured: true, enabled: true, available: true, reason: 'Signed in' };
  const fal = { id: 'fal', label: 'fal.ai', protocol: 'media', category: 'multimodal', kinds: ['image', 'video', 'audio'], configured: true, enabled: true, available: true, baseUrl: 'https://fal.run', baseUrlEditable: false };
  const models = [
    {
      id: 'account:gpt-image-2.6-sunburst',
      provider: 'account',
      modelId: 'gpt-image-2.6-sunburst',
      label: 'gpt-image-2.6-sunburst',
      kind: 'image',
      mode: 'text-to-image',
      enabled: true,
      source: 'live',
      supportsImageReference: true,
      maxInputImages: 16,
      // Legacy stale overrides from earlier editor versions must not render fake badges.
      capabilities: ['reasoning', 'tools'],
      inputs: ['vision', 'audio'],
      contextWindow: 1_000_000,
    },
    {
      id: 'account:brand-new-image',
      provider: 'account',
      modelId: 'brand-new-image',
      label: 'brand-new-image',
      kind: 'image',
      enabled: true,
      source: 'live',
    },
    {
      id: 'account:byteplus-tts-2',
      provider: 'account',
      modelId: 'byteplus-tts-2',
      label: 'BytePlus Voice',
      kind: 'audio',
      mode: 'text-to-speech',
      enabled: true,
      source: 'builtin',
    },
    {
      id: 'codex:image-generation',
      provider: 'codex',
      modelId: 'image-generation',
      label: 'Codex Image',
      kind: 'image',
      mode: 'text-to-image',
      supportsImageReference: true,
      enabled: true,
      source: 'builtin',
    },
    {
      id: 'fal:fal-ai/flux/schnell',
      provider: 'fal',
      modelId: 'fal-ai/flux/schnell',
      label: 'FLUX Schnell',
      kind: 'image',
      mode: 'text-to-image',
      enabled: true,
      source: 'builtin',
    },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(String(url))
    ? Response.json({ consoleUrl: 'https://console.example', state: 'signed-in', plan: 'plus', user: { email: 'creator@example.com' } })
    : Response.json({ providers: [configuredAccount, codex, fal], models, defaults: {} })));
  await mount();

  // OpenDesign account rows hide the Model options / Edit menu, resolve one clean friendly name (keeping raw ID in tooltip), and render verified capabilities only.
  expect(document.querySelector('[aria-label="Model options"]')).toBeNull();
  const accountRows = [...document.querySelectorAll('.om-model-row')];
  expect(accountRows[0].querySelector('.om-model-title strong')?.textContent).toBe('GPT Image 2.6 Sunburst');
  expect(accountRows[0].querySelector('.om-model-title strong')?.getAttribute('title')).toBe('gpt-image-2.6-sunburst');
  expect(accountRows[0].querySelector('.om-model-title .om-model-id')).toBeNull();
  expect(accountRows[0].querySelector('.om-model-capabilities')?.textContent).toBe('Image editing (up to 16) · Transparent background');
  expect(accountRows[0].textContent).not.toContain('Reasoning');
  expect(accountRows[0].textContent).not.toContain('context tokens');
  // Brand-new model without capability metadata keeps its raw ID without duplicating an inline ID or empty capability row.
  expect(accountRows[1].querySelector('.om-model-title strong')?.textContent).toBe('brand-new-image');
  expect(accountRows[1].querySelector('.om-model-title .om-model-id')).toBeNull();
  expect(accountRows[1].querySelector('.om-model-capabilities')).toBeNull();
  expect(accountRows[2].querySelector('.om-model-title strong')?.textContent).toBe('BytePlus Voice');
  expect(accountRows[2].querySelector('.om-model-title strong')?.getAttribute('title')).toBe('byteplus-tts-2');
  expect(accountRows[2].querySelector('.om-model-title .om-model-id')).toBeNull();
  expect(accountRows[2].querySelector('.om-model-capabilities')?.textContent).toBe('Speech');

  // Local Agent (Codex) rows also omit Model options, remove duplicate Sync models & single-model search, and display verified capabilities.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(el => el.textContent?.includes('Codex'))!.click());
  expect(document.querySelector('[aria-label="Model options"]')).toBeNull();
  expect(document.querySelector('.om-agent-status-bar')?.textContent).toContain('Signed in');
  expect(document.querySelector('.om-model-section')?.textContent).not.toContain('Sync models');
  expect(document.querySelector('[aria-label="Search models"]')).toBeNull();
  expect(document.querySelector('.om-model-capabilities')?.textContent).toBe('Image editing · Transparent background');

  // Media providers (fal.ai) retain Model options and keep informative endpoint paths inline beside friendly labels.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(el => el.textContent?.includes('fal.ai'))!.click());
  expect(document.querySelector('[aria-label="Model options"]')).not.toBeNull();
  expect(document.querySelector('.om-model-title strong')?.textContent).toBe('FLUX Schnell');
  expect(document.querySelector('.om-model-title .om-model-id')?.textContent).toBe('fal-ai/flux/schnell');
});

it('groups and pins Official channels together, sinks setupRequired providers without empty model sections, and discloses non-media protocol limits', async () => {
  const providers = [
    { ...account, configured: true, enabled: true, available: true, reason: 'Included with your account' },
    { id: 'codex', label: 'Codex', protocol: 'agent', category: 'local', kinds: ['image'], configured: true, enabled: true, available: true, reason: 'Local Codex is ready' },
    { id: 'comfyui', label: 'ComfyUI', protocol: 'openai', category: 'local', kinds: ['text', 'image'], configured: false, enabled: false, available: false, setupRequired: true, reason: 'Local workflow integration required' },
    { id: 'opendesign', label: 'OpenDesign Cloud', protocol: 'media', category: 'multimodal', kinds: ['image', 'video', 'audio'], configured: false, enabled: false, available: false, baseUrl: '', baseUrlEditable: true, reason: 'Add API key' },
    { id: 'gemini', label: 'Gemini', protocol: 'google', category: 'multimodal', kinds: ['text', 'image'], configured: false, enabled: false, available: false, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', baseUrlEditable: true, reason: 'Add API key' },
  ];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => /\/settings\/account(\?|$)/.test(String(url))
    ? Response.json({ consoleUrl: 'https://console.example', state: 'signed-in', plan: 'plus', user: { email: 'creator@example.com' } })
    : Response.json({ providers, models: [], defaults: {} })));
  await mount();

  // Official channels stay pinned together above Codex/BYOK even when OpenDesign Cloud is unconfigured, and setupRequired sinks last.
  const sidebarNames = [...document.querySelectorAll('.om-provider-item-name')].map(node => node.firstChild?.textContent);
  expect(sidebarNames).toEqual(['OpenDesign', 'OpenDesign Cloud', 'Codex', 'Gemini', 'ComfyUI']);
  expect(document.querySelector('.om-provider-divider')).not.toBeNull();
  expect(document.querySelectorAll('.om-provider-items .om-official-badge')).toHaveLength(2);
  expect(document.querySelector('.om-provider-header .om-official-badge')?.textContent).toBe('Official');

  // OpenDesign Cloud shows its Official badge and explicit Official API role.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(el => el.textContent?.includes('OpenDesign Cloud'))!.click());
  expect(document.querySelector('.om-provider-header .om-official-badge')?.textContent).toBe('Official');
  expect(document.querySelector('.om-provider-meta')?.textContent).toBe('Official API · API key');

  // Google Gemini discloses its non-media protocol boundary before the user enters a key.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(el => el.textContent?.includes('Gemini'))!.click());
  expect(document.querySelector('.om-provider-meta')?.textContent).toBe('Google Gemini');
  expect(document.querySelector('.om-provider-notice')?.textContent).toContain('image, video and audio generation are not executed through it');

  // Setup-required providers (ComfyUI) hide the dead Models 0 section.
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.om-provider-item')].find(el => el.textContent?.includes('ComfyUI'))!.click());
  expect(document.querySelector('.om-model-section')).toBeNull();
});
