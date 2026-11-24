// @vitest-environment happy-dom
import React, { act } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanupMounted, mountHost } from '../components/ui/mountHost.testHelpers';
import { I18nProvider, LOCALE_STORAGE_KEY } from '../i18n/I18n';
import { readStudioUiPreferences } from '../utils/studioUiPreferences';
import { ApplicationAccountMenu } from './ApplicationChrome';
import { SettingsCenter } from './SettingsCenter';

vi.mock('./WorkspaceFrame', () => ({ useWorkspaceChrome: () => ({ openHome: vi.fn(), openLibrary: vi.fn(), switchingDisabled: false, navigationCollapsed: false }) }));
vi.mock('./AccountSettings', () => ({ useAccountSummary: () => ({ account: null }), AccountSettings: () => null }));
vi.mock('./ModelSwitcher', () => ({ ModelSwitcher: () => null }));
vi.mock('./GitHubLink', () => ({ GitHubLink: () => null }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: vi.fn(async () => ({ version: 'test' })) }));

beforeEach(() => { localStorage.clear(); history.replaceState(null, '', '/'); });
afterEach(() => {
  cleanupMounted();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themePreference;
});
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const click = async (element: Element | null) => { expect(element).not.toBeNull(); act(() => (element as HTMLElement).click()); await settle(); };

it('switches the shared locale from the account submenu and keeps settings in sync', async () => {
  mountHost(<I18nProvider initialLocale="en"><ApplicationAccountMenu settings="general" openSettings={() => {}} /><SettingsCenter section="general" onSection={() => {}} openConnections={() => {}} /></I18nProvider>);
  await click(document.querySelector('[aria-label="Account menu"]'));
  const language = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('Language'))!;
  act(() => { language.focus(); language.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  await settle();
  expect(document.querySelector('[role="menu"][aria-label="Language"]')).not.toBeNull();
  await click([...document.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent === '简体中文')!);
  expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  expect(document.documentElement.lang).toBe('zh-CN');
  expect(document.querySelector('.om-preference-control')?.textContent).toContain('简体中文');
  expect(document.querySelector('.om-settings-main')?.getAttribute('aria-label')).toBe('通用');
  await click(document.querySelector('[aria-label="账户菜单"]'));
  const translatedLanguage = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes('语言'))!;
  await click(translatedLanguage);
  expect(document.querySelector('[role="menuitemradio"][aria-checked="true"]')?.textContent).toBe('简体中文');
});

it('uses the same direct GitHub destinations in the account menu and settings resources', async () => {
  mountHost(<I18nProvider initialLocale="en"><ApplicationAccountMenu settings="help" openSettings={() => {}} /><SettingsCenter section="help" onSection={() => {}} openConnections={() => {}} /></I18nProvider>);
  await settle();
  await click(document.querySelector('[aria-label="Account menu"]'));
  for (const [label, href] of [["What's new", 'https://github.com/nexu-io/openmotion/releases'], ['Feedback', 'https://github.com/nexu-io/openmotion/issues/new/choose']]) {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('a')].filter(link => link.textContent === label);
    expect(links).toHaveLength(2);
    expect(links.every(link => link.href === href && link.target === '_blank' && link.rel.includes('noopener'))).toBe(true);
    expect(links.some(link => link.getAttribute('role') === 'menuitem')).toBe(true);
    expect(links.some(link => link.closest('.om-settings-main'))).toBe(true);
  }
});

it('switches the theme from the appearance submenu without navigating to settings', async () => {
  const openSettings = vi.fn();
  mountHost(<I18nProvider initialLocale="en"><ApplicationAccountMenu settings={null} openSettings={openSettings} /></I18nProvider>);
  const avatar = document.querySelector('[aria-label="Account menu"]');
  const appearance = () => document.querySelector<HTMLElement>('.om-account-menu [role="menuitem"][aria-haspopup="menu"] .om-menu-label')!
    .closest<HTMLElement>('[role="menuitem"]')!;
  const submenu = () => document.querySelector('[role="menu"][aria-label="Appearance"]');
  const light = () => [...submenu()!.querySelectorAll('[role="menuitemradio"]')].find(item => item.textContent === 'Light')!;

  await click(avatar);
  expect(appearance().textContent).toBe('AppearanceDark');
  act(() => {
    appearance().focus();
    appearance().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  await settle();
  expect(submenu()?.querySelector('[aria-checked="true"]')?.textContent).toBe('Dark');
  expect([...submenu()!.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(['Light', 'Dark', 'System']);
  await click(light());

  expect(openSettings).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.theme).toBe('paper');
  expect(readStudioUiPreferences().theme).toBe('light');
  await click(avatar);
  expect(appearance().textContent).toBe('AppearanceLight');
  await click(appearance());
  expect(light().getAttribute('aria-checked')).toBe('true');
});
