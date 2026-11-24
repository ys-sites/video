import type { AccountSummary } from '../shared/provider-directory.ts';
import type { AccountMediaEntitlement } from '../shared/gateway.ts';

export function planMediaEntitlement(plan?: string): AccountMediaEntitlement['mediaEntitlement'] {
  const normalized = plan?.trim().toLowerCase();
  if (normalized === 'plus' || normalized === 'pro' || normalized === 'max') return 'included';
  if (normalized === 'free' || normalized === 'go') return 'not-included';
  return 'unknown';
}

/** Advisory media metadata only. Identity and server-side model enforcement remain separate. */
export function accountMediaState(account: AccountSummary): Partial<AccountMediaEntitlement> & { reason: string } {
  const signedIn = account.state === 'signed-in';
  const normalizedPlan = signedIn && account.billingUnavailable === false && typeof account.plan === 'string'
    ? account.plan.trim().toLowerCase() : '';
  const plan = normalizedPlan || undefined;
  // Missing, empty and malformed balances must not become zero through Number coercion.
  const balance = typeof account.balance === 'string' && account.balance.trim() !== '' ? Number(account.balance) : NaN;
  const hasBalance = plan !== undefined && Number.isFinite(balance) ? balance > 0 : undefined;
  // Free and Go entitle text models only; credits never unlock media models on these plans.
  const mediaEntitlement = signedIn ? planMediaEntitlement(plan) : undefined;
  const reason = !signedIn ? account.state === 'reauth-required'
    ? 'OpenDesign sign-in expired; sign in again to use your account models' : 'Sign in to use your account models'
    : mediaEntitlement === 'included' ? 'Included with your account'
    : mediaEntitlement === 'not-included' ? 'Signed in; multimodal generation requires OpenDesign Plus or above'
    : 'Signed in; model access and balance are checked when generating';
  return {
    ...(mediaEntitlement ? { mediaEntitlement } : {}),
    ...(plan ? { plan } : {}),
    ...(mediaEntitlement !== 'included' && hasBalance !== undefined ? { hasBalance } : {}),
    reason,
  };
}
