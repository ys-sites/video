// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccountSummary } from '../../../shared/provider-directory';
import { I18nProvider, type Locale } from '../i18n/I18n';
import { AccountSettings } from './AccountSettings';
import { GITHUB_REPOSITORY } from './githubRepository';
import { notifyProvidersChanged } from './useProviderDirectory';

const hooks = vi.hoisted(() => ({ account: undefined as unknown, request: vi.fn() }));
vi.mock('./gatewayClient', () => ({ gatewayRequest: hooks.request }));
vi.mock('./useProviderDirectory', () => ({ notifyProvidersChanged: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ''; vi.clearAllMocks(); });

const activation = 'https://open-design.ai/activate?code=TEST-123';
async function open(account: Partial<AccountSummary>, locale: Locale = 'en', section: 'account' | 'subscription' = 'account') {
  hooks.account = { consoleUrl: 'https://open-design.ai/cloud', ...account };
  hooks.request.mockImplementation(async () => hooks.account);
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root!.render(<I18nProvider initialLocale={locale}><AccountSettings subscription={section === 'subscription'} openProviders={() => {}} /></I18nProvider>));
  return container;
}
const button = (container: HTMLElement, label: string) => [...container.querySelectorAll<HTMLElement>('.om-settings-actions .om-button')].find(item => item.textContent === label);
const actions = (container: HTMLElement) => [...container.querySelectorAll('.om-settings-actions .om-button')].map(item => item.textContent);

it('leaves the activation page to the browser and leads with the link only when the browser did not open', async () => {
  let page = await open({ state: 'authorizing', authorizationUrl: activation, userCode: 'TEST-123', browserOpened: true });
  expect(page.querySelector('[role=status]')?.textContent).toBe('Waiting for browser authorization…TEST-123');
  const fallback = button(page, "Didn't open? Click here") as HTMLAnchorElement;
  expect(fallback.href).toBe(activation); expect(fallback.hasAttribute('data-primary')).toBe(false);
  expect(actions(page)).toEqual(["Didn't open? Click here", 'Cancel']);
  act(() => root!.unmount()); document.body.innerHTML = '';
  page = await open({ state: 'authorizing', authorizationUrl: activation, userCode: 'TEST-123', browserOpened: false });
  expect(button(page, 'Continue in browser')?.hasAttribute('data-primary')).toBe(true);
  expect(page.querySelectorAll(`a[href="${activation}"]`)).toHaveLength(1);
});

it('says it is connecting until the link exists, then syncing with nothing left to click', async () => {
  let page = await open({ state: 'authorizing' }, 'zh-CN');
  expect(page.querySelector('[role=status]')?.textContent).toBe('正在连接 OpenDesign，请稍候…');
  expect(page.textContent).not.toMatch(/组件|下载/);
  expect(actions(page)).toEqual(['取消']);
  act(() => root!.unmount()); document.body.innerHTML = '';
  page = await open({ state: 'authorizing', syncing: true, browserOpened: true }, 'zh-CN');
  expect(page.querySelector('[role=status]')?.textContent).toBe('已授权，正在同步账户信息…');
  expect(page.querySelector('.om-account-summary h2')?.textContent).toBe('正在完成登录');
  expect(actions(page)).toEqual(['取消']); expect((button(page, '取消') as HTMLButtonElement).disabled).toBe(true);
});

it('explains a missing sign-in component, offers Retry and a copyable command that installs it where the service looks', async () => {
  const command = "npm install --prefix '/opt/openmotion/data/account/runtime' --ignore-scripts @powerformer/vela-cli@0.1.10";
  const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  const page = await open({ state: 'signed-out', errorCode: 'connector_unavailable', connectorInstall: { command },
    error: "OpenMotion couldn't find npm to set up the OpenDesign sign-in component. Run this command in a terminal, then select Retry:" }, 'zh-CN');
  expect(page.querySelector('[role=alert]')?.textContent).toBe('OpenMotion 找不到 npm，无法安装 OpenDesign 登录组件。请在终端运行下面的命令，然后点「重试」：');
  expect(page.querySelector('.om-account-summary .om-code-block')?.textContent).toBe(command);
  expect(actions(page)).toEqual(['重试', '复制口令']);
  await act(async () => button(page, '复制口令')!.click());
  expect(writeText).toHaveBeenCalledWith(command);
  await act(async () => button(page, '重试')!.click());
  expect(hooks.request).toHaveBeenCalledWith('settings/account/login', 'POST', {});
});

it('offers a retry after a connection failure, and sign-in again with a feedback link after rejected credentials', async () => {
  let page = await open({ state: 'signed-out', errorCode: 'setup_failed', error: "Can't connect to OpenDesign right now. Check your network and try again." });
  expect(actions(page)).toEqual(['Retry']); expect(page.querySelector('[role=alert]')?.textContent).toContain("Can't connect to OpenDesign");
  await act(async () => button(page, 'Retry')!.click());
  expect(hooks.request).toHaveBeenCalledWith('settings/account/login', 'POST', {});
  act(() => root!.unmount()); document.body.innerHTML = '';
  page = await open({ state: 'signed-out', errorCode: 'credentials_rejected', error: 'Account credentials could not be verified. Sign in again, and contact us if this keeps happening.' });
  expect(actions(page)).toEqual(['Sign in again', 'Report an issue']);
  expect((button(page, 'Report an issue') as HTMLAnchorElement).href).toBe(`${GITHUB_REPOSITORY}/issues/new/choose`);
  act(() => root!.unmount()); document.body.innerHTML = '';
  page = await open({ state: 'signed-out', errorCode: 'authorization_expired', error: 'Browser authorization expired or was cancelled. Sign in again.' });
  expect(actions(page)).toEqual(['Sign in again']);
});

it('shows the account email once, under the name only when the account has a different one', async () => {
  const identity = async (user: AccountSummary['user']) => {
    const page = await open({ state: 'signed-in', user, plan: 'pro', balance: '1.00' });
    const result = [page.querySelector('.om-account-identity h1')?.textContent, page.querySelector('.om-account-identity p')?.textContent];
    act(() => root!.unmount()); document.body.innerHTML = '';
    return result;
  };
  expect(await identity({ email: 'ada@example.test' })).toEqual(['ada@example.test', 'Your creative workspace, connected.']);
  expect(await identity({ name: 'Ada@Example.test', email: 'ada@example.test' })).toEqual(['ada@example.test', 'Your creative workspace, connected.']);
  expect(await identity({ name: 'Ada', email: 'ada@example.test' })).toEqual(['Ada', 'ada@example.test']);
});

it('refreshes Go on checkout return and updates providers only after the plan changes', async () => {
  const page = await open({ state: 'signed-in', plan: 'go', balance: '0.00' }, 'en', 'subscription');
  const original = hooks.account;
  hooks.request.mockImplementation(async (route: string) => route === 'settings/account/subscription' ? { opened: true } : hooks.account);
  hooks.request.mockClear();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(hooks.request).not.toHaveBeenCalled();
  await act(async () => button(page, 'Upgrade to Plus')!.click());
  expect(hooks.request).toHaveBeenCalledWith('settings/account/subscription', 'POST', {});
  hooks.account = { ...original as AccountSummary, plan: 'plus', balance: '4.00' };
  await act(async () => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const billingReads = () => hooks.request.mock.calls.filter(([route]) => route === 'settings/account?refresh=true').length;
  expect(billingReads()).toBe(1);
  expect(page.querySelector('[data-guide="upgrade"]')).toBeNull();
  expect(page.querySelector('.om-account-metrics')?.textContent).toContain('plus');
  expect(notifyProvidersChanged).toHaveBeenCalledTimes(1);
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(billingReads()).toBe(1);
});

it('explains that account models still work when the plan and balance cannot be read', async () => {
  const page = await open({ state: 'signed-in', user: { email: 'ada@example.test' }, billingUnavailable: true }, 'zh-CN', 'subscription');
  expect(page.textContent).toContain('暂时无法读取订阅和余额。账户模型不受影响，可以照常使用。');
});

it('asks the local service to open the subscription page in the system browser, and opens it itself only as a fallback', async () => {
  const page = await open({ state: 'signed-in', user: { email: 'ada@example.test' }, plan: 'plus', balance: '12.00' }, 'en', 'subscription');
  const manage = page.querySelector<HTMLButtonElement>('.om-settings-section button.om-button')!;
  expect(manage.textContent).toBe('Manage subscription');
  expect(page.querySelector('.om-settings-section a')).toBeNull();
  const popup = vi.spyOn(window, 'open').mockReturnValue(null);
  const handoff = 'https://open-design.ai/cloud/login?intentId=intent-1';
  hooks.request.mockImplementation(async (route: string) => route === 'settings/account/subscription' ? { url: handoff, opened: true } : hooks.account);
  await act(async () => manage.click());
  expect(hooks.request).toHaveBeenCalledWith('settings/account/subscription', 'POST', {});
  expect(popup).not.toHaveBeenCalled();
  const fallback = { opener: window as Window | null };
  popup.mockReturnValue(fallback as unknown as Window);
  hooks.request.mockImplementation(async (route: string) => route === 'settings/account/subscription' ? { url: handoff, opened: false } : hooks.account);
  await act(async () => manage.click());
  expect(popup).toHaveBeenCalledWith(handoff, '_blank'); expect(fallback.opener).toBeNull();
  expect(page.querySelector('.om-settings-section a')).toBeNull();
  popup.mockReturnValue(null);
  await act(async () => manage.click());
  const link = page.querySelector<HTMLAnchorElement>('.om-settings-section > a.om-button')!;
  expect(link.textContent).toBe('Continue in browser'); expect(link.href).toBe(handoff); expect(link.target).toBe('_blank');
  await act(async () => link.click());
  expect(page.querySelector('.om-settings-section a')).toBeNull();
  hooks.request.mockImplementation(async (route: string) => { if (route === 'settings/account/subscription') throw new Error('offline'); return hooks.account; });
  await act(async () => manage.click());
  expect(document.body.textContent).toContain("Couldn't open your browser. Try again.");
  popup.mockRestore();
});

it('replaces missing billing metrics with a dashboard link on 403 and restores them on retry', async () => {
  const page = await open({ state: 'signed-in', billingUnavailable: true, billingError: { status: 403 } }, 'zh-CN', 'subscription');
  expect(page.textContent).toContain('账单服务拒绝了本次查询');
  expect(page.querySelector('.om-account-metrics')).toBeNull();
  expect([...page.querySelectorAll('.om-settings-section button.om-button')].some(item => item.textContent === '管理订阅')).toBe(true);
  hooks.account = { state: 'signed-in', plan: 'pro', balance: '0.00', consoleUrl: 'https://open-design.ai/cloud' };
  await act(async () => page.querySelector<HTMLButtonElement>('button[aria-busy]')!.click());
  expect(page.querySelector('.om-account-metrics')?.textContent).toContain('$0.00');
  expect(page.textContent).not.toContain('账单服务拒绝了本次查询');
});

it('keeps the account page focused on sign-in and account management', async () => {
  const page = await open({ state: 'signed-out' });
  expect(actions(page)).toEqual(['Sign in with OpenDesign']);
  expect(page.querySelector('.om-account-metrics, [data-guide="upgrade"]')).toBeNull();
  await act(async () => button(page, 'Sign in with OpenDesign')!.click());
  expect(hooks.request).toHaveBeenCalledWith('settings/account/login', 'POST', {});

  hooks.account = { state: 'signed-in', plan: 'go', balance: '12.00' };
  await act(async () => window.dispatchEvent(new Event('motion:account-changed')));
  expect(actions(page)).toEqual(['Sign out']);
  expect(page.querySelector('.om-account-metrics, .om-plan-guide')).toBeNull();
  expect(page.textContent).toContain('Model providers');
});

it.each(['account', 'subscription'] as const)('shows the same sign-in benefits on the %s page', async section => {
  const page = await open({ state: 'signed-out' }, 'zh-CN', section);
  expect(page.querySelector('.om-plan-guide h2')?.textContent).toBe('登录 OpenDesign，开始多模态生成');
  expect(page.querySelector('.om-plan-guide .om-badge')?.textContent).toBe('Plus 及以上');
  expect(page.querySelector('.om-plan-guide .om-button')?.textContent).toBe('使用 OpenDesign 登录');
  expect([...page.querySelectorAll('.om-account-capabilities li')].map(item => item.textContent)).toEqual(['图片', '视频', '配音', '音乐']);
  expect(page.querySelector('.om-plan-guide p')?.textContent).toBe('登录后升级到 Plus，即可在 OpenMotion 里直接生成图片、视频、配音和音乐，不用配置 API 密钥。');
  expect(page.querySelector('.om-account-offer')?.textContent).toBe('多模态 $14/月起');
  expect(page.querySelectorAll('.om-account-metrics .om-card')).toHaveLength(section === 'subscription' ? 2 : 0);
  expect(page.querySelector('[data-guide="upgrade"]')).toBeNull();
});

it('offers Free and Go accounts an upgrade through the registered entry source, and nothing to paid plans', async () => {
  for (const plan of ['free', 'go']) {
    const page = await open({ state: 'signed-in', user: { email: 'ada@example.test' }, plan, balance: '0.00' }, 'en', 'subscription');
    const [upgrade, manage] = page.querySelectorAll<HTMLButtonElement>('[data-guide="upgrade"] button');
    expect(page.querySelector('.om-plan-name')?.textContent).toBe(plan === 'free' ? 'Free plan' : 'Go');
    expect(upgrade.textContent).toContain('Upgrade to Plus'); expect(upgrade.hasAttribute('data-primary')).toBe(true);
    expect(manage.textContent).toContain('Manage subscription');
    expect(page.querySelector('.om-settings-section .om-button')).toBeNull();
    expect(page.querySelector('.om-account-summary')).toBeNull();
  }
  const paid = await open({ state: 'signed-in', user: { email: 'ada@example.test' }, plan: 'plus', balance: '12.00' }, 'en', 'subscription');
  expect(paid.querySelector('[data-guide="upgrade"]')).toBeNull();
});
