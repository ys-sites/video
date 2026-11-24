import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import * as tracking from './pageTracking';
import { Tooltip } from "../components/ui/Tooltip";
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AccountSummary } from '../../../shared/provider-directory';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useToast } from '../hooks/useToast';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { gatewayRequest } from './gatewayClient';
import { GITHUB_REPOSITORY } from './githubRepository';
import { notifyProvidersChanged } from './useProviderDirectory';
import { activeAccountOffer, MULTIMODAL_CAPABILITIES } from './accountOffer';
import { SettingsError, SettingsLoading } from './settingsPrimitives';

type GuideArea = 'account' | 'provider_detail';
type ShowToast = ReturnType<typeof useToast>['showToast'];
// The local service opens the subscription page in the system browser, where sign-in happened, with a fresh entry
// and a one-time account intent. When no browser could be launched, Studio tries the returned link itself; the
// request has used up the click by then, so a blocked popup leaves a link that opens it on the next click.
function useSubscriptionOpener(area: GuideArea, showToast: ShowToast, markCheckoutReturn: () => () => void) {
  const { t } = useI18n(), [subscriptionUrl, setSubscriptionUrl] = useState<string>();
  async function openSubscription(element: 'manage_subscription' | 'view_plans') {
    tracking.reportSettingsClick(area, element);
    setSubscriptionUrl(undefined);
    const cancelCheckoutReturn = markCheckoutReturn();
    try {
      const { url, opened } = await gatewayRequest<{ url: string; opened: boolean }>('settings/account/subscription', 'POST', {});
      if (opened) return;
      const page = window.open(url, '_blank');
      if (page) page.opener = null;
      else { cancelCheckoutReturn(); setSubscriptionUrl(url); }
    } catch {
      cancelCheckoutReturn();
      showToast(t("Couldn't open your browser. Try again."), 'error');
    }
  }
  const button = (element: 'manage_subscription' | 'view_plans', primary = false) => <Button variant="ghost" className="om-button h-auto" data-primary={primary || undefined} onClick={() => void openSubscription(element)}>
    {element === 'view_plans' && <RemixIcon name="sparkling-line" size={16} />}{t(element === 'view_plans' ? 'Upgrade to Plus' : 'Manage subscription')}<RemixIcon name="external-link-line" size={15} /></Button>;
  const link = subscriptionUrl && <a className="om-button" data-primary href={subscriptionUrl} target="_blank" rel="noreferrer" onClick={() => { markCheckoutReturn(); setSubscriptionUrl(undefined); }}>{t('Continue in browser')}<RemixIcon name="external-link-line" size={15} /></a>;
  return { button, link };
}

/** Free and Go accounts are guided to Plus; other plans, unknown billing and signed-out accounts are not. */
export function upgradePlan(account: AccountSummary | null | undefined): 'free' | 'go' | undefined {
  const plan = account?.state === 'signed-in' && !account.billingUnavailable ? account.plan?.trim().toLowerCase() : undefined;
  return plan === 'free' || plan === 'go' ? plan : undefined;
}

function GuideCapabilities() {
  const { t } = useI18n();
  return <ul className="om-account-capabilities" aria-label={t('Multimodal')}>{MULTIMODAL_CAPABILITIES.map(item => <li key={item.label}><RemixIcon name={item.icon} size={16} />{t(item.label)}</li>)}</ul>;
}

function GuideOffer({ callout = false }: { callout?: boolean }) {
  const { t } = useI18n(), offer = activeAccountOffer();
  return offer && <p className={callout ? 'om-account-offer om-account-offer-callout' : 'om-account-offer'}><RemixIcon name="sparkling-fill" size={15} /><strong>{t(offer.title)}</strong>{offer.detail && <span>{t(offer.detail)}</span>}</p>;
}

/** Signed-out guide shared by the account page and the OpenDesign provider: what signing in unlocks. */
export function SignInGuide({ action }: { action: ReactNode }) {
  const { t } = useI18n();
  return <section className="om-card om-plan-guide" data-guide="sign-in">
    <div className="om-plan-guide-head"><h2 className="om-title">{t('Sign in to start multimodal generation')}</h2><span className="om-badge">{t('Plus and above')}</span></div>
    <p className="om-muted" data-quiet>{t('Sign in, then upgrade to Plus to generate images, video, voiceovers and music right in OpenMotion. No API keys to set up.')}</p>
    <GuideCapabilities />
    <div className="om-settings-actions">{action}<GuideOffer callout /></div>
  </section>;
}

/** Free / Go guide shared by the account page and the OpenDesign provider: what upgrading to Plus unlocks. */
export function UpgradeGuide({ plan, subscription }: { plan: 'free' | 'go'; subscription: ReturnType<typeof useSubscriptionOpener> }) {
  const { t } = useI18n();
  return <section className="om-card om-plan-guide" data-guide="upgrade">
    <div className="om-plan-guide-head"><h2 className="om-title om-plan-name">{plan === 'free' ? t('Free plan') : 'Go'}</h2><span className="om-badge">{t('Current plan')}</span></div>
    <p className="om-muted">{t('Upgrade to Plus to generate images, video, voiceovers and music. Pro and Max include them too.')}</p>
    <GuideCapabilities />
    <GuideOffer />
    <div className="om-settings-actions">{subscription.button('view_plans', true)}{subscription.button('manage_subscription')}{subscription.link}</div>
  </section>;
}

export function useAccountSummary() {
  const [account, updateAccount] = useState<AccountSummary | null>(null), [error, setError] = useState(false);
  const request = useRef(0);
  const setAccount = useCallback((value: AccountSummary) => { request.current++; updateAccount(value); setError(false); }, []);
  const refresh = useCallback(async (billing = false) => {
    const current = ++request.current;
    try {
      const value = await gatewayRequest<AccountSummary>('settings/account' + (billing ? '?refresh=true' : ''));
      if (current !== request.current) return;
      updateAccount(value); setError(false);
      return value;
    } catch { if (current === request.current) setError(true); }
  }, []);
  useEffect(() => { void refresh(); const update = () => void refresh(); window.addEventListener('motion:account-changed', update); return () => { request.current++; window.removeEventListener('motion:account-changed', update); }; }, [refresh]);
  useEffect(() => {
    if (account?.state !== 'authorizing') return;
    const timer = setInterval(() => void refresh(), 1500); return () => clearInterval(timer);
  }, [account, refresh]);
  return { account, error, refresh, setAccount };
}
type AccountAction = 'login' | 'logout' | 'cancel';
/**
 * Sign-in state and actions shared by the account page and the OpenDesign provider, so either can sign in in place.
 * A finished sign-in reloads the provider directory and announces itself; plan details load with a billing refresh.
 */
export function useAccountSignIn(area: GuideArea, showToast: ShowToast, provider?: { id: string; custom?: boolean; protocol?: string }) {
  const { t } = useI18n(), state = useAccountSummary(), [busy, setBusy] = useState(false), previous = useRef<string | undefined>(undefined);
  const { account, refresh } = state;
  const accountState = account?.state;
  const pendingCheckout = useRef<symbol | undefined>(undefined);
  const subscription = useSubscriptionOpener(area, showToast, () => {
    const checkout = pendingCheckout.current = Symbol();
    return () => { if (pendingCheckout.current === checkout) pendingCheckout.current = undefined; };
  });
  const refreshBilling = useCallback(async () => {
    const updated = await refresh(true);
    if (updated && (updated.state !== account?.state || updated.plan?.trim().toLowerCase() !== account?.plan?.trim().toLowerCase()
      || Boolean(updated.billingUnavailable) !== Boolean(account?.billingUnavailable))) notifyProvidersChanged();
  }, [account, refresh]);
  useEffect(() => {
    const onReturn = () => {
      if (!pendingCheckout.current || document.visibilityState !== 'visible') return;
      pendingCheckout.current = undefined;
      void refreshBilling();
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [refreshBilling]);
  // Order matters: the event below triggers a plain refresh, so the billing refresh must be issued after it to win.
  useEffect(() => {
    if (previous.current === 'authorizing' && accountState === 'signed-in') {
      notifyProvidersChanged(); window.dispatchEvent(new Event('motion:account-changed')); showToast(t('Signed in to OpenDesign'), 'info');
    }
    previous.current = accountState;
  }, [accountState, t, showToast]);
  useEffect(() => { if (accountState === 'signed-in') void state.refresh(true); }, [accountState, state.refresh]);
  async function action(name: AccountAction) {
    tracking.reportSettingsClick(area, name === 'login' ? 'sign_in' : name === 'logout' ? 'sign_out' : 'cancel_sign_in', provider ? { provider } : {});
    setBusy(true);
    try { state.setAccount(await gatewayRequest<AccountSummary>('settings/account/' + name, 'POST', {})); notifyProvidersChanged(); window.dispatchEvent(new Event('motion:account-changed')); }
    catch (error) { showToast(error instanceof Error ? error.message : t('Could not update account'), 'error'); }
    finally { setBusy(false); }
  }
  return { state, busy, action, subscription, refreshBilling };
}

/** Signed out: the multimodal sign-in guide. Otherwise the sign-in status card: browser authorization, expiry, failure, connected. */
export function AccountStatus({ account, busy, action, showToast }: { account: AccountSummary; busy: boolean; action: (name: AccountAction) => void | Promise<void>; showToast: ShowToast }) {
  const { t } = useI18n();
  const signedIn = account.state === 'signed-in', pending = account.state === 'authorizing', expired = account.state === 'reauth-required';
  const syncing = pending && account.syncing, failure = !pending && !signedIn ? account.errorCode : undefined;
  const retry = failure === 'setup_failed' || failure === 'connector_unavailable';
  const signInIcon = expired || failure
    ? <RemixIcon name={retry ? 'refresh-line' : 'login-box-line'} size={17} />
    : <span className="om-opendesign-mark" aria-hidden="true" />;
  const signIn = <Button variant="ghost" className="om-button h-auto" data-primary disabled={busy} onClick={() => void action('login')}>{signInIcon}{t(retry ? 'Retry' : expired || failure ? 'Sign in again' : 'Sign in with OpenDesign')}</Button>;
  // When the service cannot install the sign-in component itself, this command installs it where the service looks,
  // independent of the terminal's PATH; Retry then finds it without a restart.
  const command = failure === 'connector_unavailable' ? account.connectorInstall?.command : undefined;
  async function copyCommand() {
    try { await navigator.clipboard.writeText(command!); showToast(t('Command copied'), 'info'); }
    catch { showToast(t('Copy failed. Check clipboard permissions and try again.'), 'error'); }
  }
  // The connector opens the activation page itself; the link is the fallback, and leads only when opening failed.
  const browserLink = account.authorizationUrl && !syncing && <a className="om-button" data-primary={account.browserOpened === false || undefined} href={account.authorizationUrl} target="_blank" rel="noreferrer">{t(account.browserOpened === false ? 'Continue in browser' : "Didn't open? Click here")}<RemixIcon name="external-link-line" size={15} /></a>;
  if (!signedIn && !pending && !expired && !failure) return <SignInGuide action={signIn} />;
  return <section className="om-card om-account-summary"><div><h2 className="om-subtitle">{t(signedIn ? 'Connected to OpenDesign' : syncing ? 'Finishing sign-in' : pending ? 'Complete sign-in in your browser' : expired ? 'OpenDesign sign-in expired' : 'Sign in to OpenDesign')}</h2><p className="om-muted">{t(signedIn ? 'Account models and your own providers can be selected side by side.' : expired ? 'Sign in again to keep using your account models, subscription and usage.' : 'Sign in with OpenDesign to sync your models, subscription and usage.')}</p>
    {pending && <p className="om-muted" role="status">{t(syncing ? 'Authorized. Syncing your account…' : account.authorizationUrl ? 'Waiting for browser authorization…' : 'Connecting to OpenDesign. Please wait…')}{account.userCode && !syncing && <strong className="om-account-code">{account.userCode}</strong>}</p>}
    {account.error && <p className="om-muted" role="alert">{t(account.error)}</p>}
    {command && <pre className="om-code-block">{command}</pre>}</div>
    <div className="om-settings-actions">{signedIn ? <Button variant="ghost" className="om-button h-auto" onClick={() => void action('logout')} disabled={busy}>{t('Sign out')}</Button> : pending ? <>{browserLink}<Button variant="ghost" className="om-button h-auto" disabled={busy || syncing} onClick={() => void action('cancel')}>{t('Cancel')}</Button></> : expired ? <>{signIn}<Button variant="ghost" className="om-button h-auto" onClick={() => void action('logout')} disabled={busy}>{t('Sign out')}</Button></> : <>{signIn}{command && <Button variant="ghost" className="om-button h-auto" onClick={() => void copyCommand()}>{t('Copy command')}</Button>}{failure === 'credentials_rejected' && <a className="om-button" href={`${GITHUB_REPOSITORY}/issues/new/choose`} target="_blank" rel="noreferrer">{t('Report an issue')}<RemixIcon name="external-link-line" size={15} /></a>}</>}</div>
  </section>;
}

export function AccountSettings({ subscription = false, openProviders }: { subscription?: boolean; openProviders: () => void }) {
  const { t } = useI18n(), toast = useToast(), { state, busy, action, subscription: subscriptionOpener, refreshBilling } = useAccountSignIn('account', toast.showToast);
  const [refreshing, setRefreshing] = useState(false);
  const signedIn = state.account?.state === 'signed-in';
  async function refreshUsage() {
    tracking.reportSettingsClick('account', 'refresh_billing');
    setRefreshing(true);
    try { await refreshBilling(); } finally { setRefreshing(false); }
  }
  const account = state.account;
  const plan = upgradePlan(account);
  const name = account?.user?.name?.trim(), email = account?.user?.email, named = Boolean(name) && name!.toLowerCase() !== email?.toLowerCase();
  const showGuestAvatar = !signedIn;
  return <div className="om-settings-page">
    {state.error ? <SettingsError retry={() => void state.refresh(true)} /> : !account ? <SettingsLoading /> : <>
      <div className="om-account-identity">
        <span className={showGuestAvatar ? 'om-avatar om-account-guest-avatar' : 'om-avatar'}><RemixIcon name="user-3-line" size={showGuestAvatar ? 26 : 36} /></span>
        <h1 className="om-title">{subscription ? t('Subscription & usage') : named ? name : email || t('Your OpenDesign account')}</h1>
        <p className="om-muted">{(subscription || named) && email ? email : t('Your creative workspace, connected.')}</p>
      </div>
      {(!subscription || !signedIn) && <AccountStatus account={account} busy={busy} action={action} showToast={toast.showToast} />}
      {subscription ? <>
        {plan && <UpgradeGuide plan={plan} subscription={subscriptionOpener} />}
        <section className="om-settings-section"><div className="om-settings-row"><h2 className="om-subtitle">{t('Subscription & usage')}</h2>{signedIn && <Tooltip label={t('Refresh account')} wrap><IconButton variant="ghost" className="motion-icon-button" aria-label={t('Refresh account')} disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshUsage()} icon={<RemixIcon name={refreshing ? 'loader-4-line' : 'refresh-line'} size={17} className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />} /></Tooltip>}</div>
          {!(signedIn && account.billingUnavailable) && <div className="om-account-metrics"><div className="om-card"><span className="om-muted">{t('Current plan')}</span><h3 className="om-title">{signedIn && account.plan ? account.plan === 'free' ? t('Free plan') : account.plan : '—'}</h3><p className="om-muted">{t(signedIn ? 'Managed by OpenDesign' : 'Sign in to view your plan')}</p></div><div className="om-card"><span className="om-muted">{t('Available balance')}</span><h3 className="om-title">{signedIn && account.balance != null ? `$${account.balance}` : '—'}</h3><p className="om-muted">{t(signedIn ? 'Account credits in USD' : 'Sign in to view usage')}</p></div></div>}
          {signedIn && account.billingUnavailable && <div className="om-settings-row"><p className="om-muted">{t(account.billingError?.status === 403 ? "The billing service declined this request. Open Manage subscription to check your plan in OpenDesign." : "Couldn't load your plan and balance. Account models are unaffected and can be used as usual.")}</p><Button variant="ghost" className="om-button h-auto" disabled={refreshing} aria-busy={refreshing} onClick={() => void refreshUsage()}><RemixIcon name={refreshing ? 'loader-4-line' : 'refresh-line'} size={15} className={refreshing ? 'animate-spin motion-reduce:animate-none' : undefined} />{t('Refresh')}</Button></div>}
          {signedIn && !plan && <>{subscriptionOpener.button('manage_subscription')}{subscriptionOpener.link}</>}
        </section>
      </> : <section className="om-card om-settings-row">
        <div className="om-account-models-copy">
          <h2 className="om-subtitle">{t('Your models, your choice')}</h2>
          <p className="om-muted" data-quiet>{t('Use account models or connect your own API keys. Choose a default for each capability.')}</p>
        </div>
        <Button variant="ghost" className="om-button h-auto" onClick={openProviders}>{t('Model providers')}<RemixIcon name="arrow-right-line" size={15} /></Button>
      </section>}
    </>}
    <StudioToastViewport {...toast} />
  </div>;
}
