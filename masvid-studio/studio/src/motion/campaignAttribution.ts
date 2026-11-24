import { useEffect, useState } from 'react';

/**
 * Black Friday campaign links from OpenMotion to the OpenDesign Pricing page.
 *
 * Each link carries the cross-product attribution the Pricing page already reads (`od_entry_id`, `od_entry_source`,
 * `od_entry_at`) and keeps as the first touch through checkout, plus `od_origin=openmotion` and standard UTM fields for
 * the website's session source. The same `entry_id` is reported on the OpenMotion click, so a click can be joined to
 * the Pricing visit and payment that followed it. No account, installation or device data is placed in the address.
 */
export const BLACK_FRIDAY_CAMPAIGN = 'black_friday_2026';

/**
 * When the campaign shows: the banner, the Pricing badge and the campaign fields on links and events. It runs from
 * 2026-11-21 18:00 to 2026-12-05 00:00 Beijing time; the end is also the countdown's end.
 */
export const BLACK_FRIDAY_STARTS_AT = Date.parse('2026-11-21T18:00:00+08:00');
export const BLACK_FRIDAY_ENDS_AT = Date.parse('2026-12-05T00:00:00+08:00');
export function blackFridayActive(now = Date.now()) {
  void now; // Masvid Studio: no upstream sales campaigns.
  return false && now >= BLACK_FRIDAY_STARTS_AT && now < BLACK_FRIDAY_ENDS_AT;
}

// A dismissed banner stays hidden for the rest of that local calendar day and returns the next day.
const DISMISSED_ON_KEY = 'openmotion.black-friday-banner.dismissed-on';
function localDay(now: Date) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
// Kept in memory as well, so a dismissal holds for the day in this page even when storage is unavailable.
let dismissedOnInPage: string | null = null;
export function bannerDismissedToday(now = new Date()) {
  const today = localDay(now);
  if (dismissedOnInPage === today) return true;
  try { return localStorage.getItem(DISMISSED_ON_KEY) === today; } catch { return false; }
}
export function dismissBannerToday(now = new Date()) {
  dismissedOnInPage = localDay(now);
  try { localStorage.setItem(DISMISSED_ON_KEY, dismissedOnInPage); } catch { /* The in-page record still applies. */ }
}
/** Test hook: forget an in-page dismissal. */
export function resetBannerDismissal() { dismissedOnInPage = null; }

/**
 * Re-reads a time-dependent condition every minute, so an open page picks up the campaign start and end and a new day
 * without reloading. React skips the update while the value is unchanged.
 */
export function useMinuteCondition(read: () => boolean) {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    const timer = window.setInterval(() => setValue(read()), 60_000);
    return () => window.clearInterval(timer);
  }, [read]);
  return [value, setValue] as const;
}
const readBlackFridayActive = () => blackFridayActive();
export const useBlackFridayActive = () => useMinuteCondition(readBlackFridayActive)[0];
export const shouldShowBlackFridayBanner = () => blackFridayActive() && !bannerDismissedToday();

/** Where the click happened: the top campaign banner or the header Pricing entry. */
export type CampaignEntrySource = 'openmotion_bf_banner' | 'openmotion_header_pricing';
/**
 * The `od_entry_source` sent for both entries. AMR keeps an attribution only for registered sources, and
 * `openmotion_manage_subscription` is the OpenMotion source it already accepts; an unregistered value would drop the
 * whole attribution, entry id included. The two entries are told apart by `utm_medium` and by the OpenMotion click
 * event that carries the same `entry_id`.
 */
const REGISTERED_ENTRY_SOURCE = 'openmotion_manage_subscription';
const utmMedium: Record<CampaignEntrySource, string> = { openmotion_bf_banner: 'banner', openmotion_header_pricing: 'header' };

export function newCampaignEntryId() {
  return crypto.randomUUID();
}

export function campaignPricingUrl(locale: string, source: CampaignEntrySource, entryId: string, at = new Date(), campaign = blackFridayActive(at.getTime())) {
  const url = new URL(locale.startsWith('zh') ? 'https://open-design.ai/zh/pricing/' : 'https://open-design.ai/pricing/');
  url.search = new URLSearchParams({
    od_origin: 'openmotion', od_entry_source: REGISTERED_ENTRY_SOURCE, od_entry_id: entryId, od_entry_at: at.toISOString(),
    utm_source: 'openmotion', utm_medium: utmMedium[source], ...(campaign ? { utm_campaign: BLACK_FRIDAY_CAMPAIGN } : {}),
  }).toString();
  return url.toString();
}
