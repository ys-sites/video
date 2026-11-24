import { useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import flameArtUrl from './bf-dusk-flame.jpg';
import styles from './BlackFridayTopBanner.module.css';
import { BLACK_FRIDAY_CAMPAIGN, BLACK_FRIDAY_ENDS_AT, blackFridayActive, campaignPricingUrl, newCampaignEntryId } from './campaignAttribution';
import type { CreativePage } from './exploreTracking';
import { trackMotion } from './tracking';

export const COUNTDOWN_CYCLE_SECONDS = 24 * 60 * 60; // 24h rolling cycle

export function readBlackFridayCountdown(now = Date.now()) {
  const remainingMs = Math.max(0, BLACK_FRIDAY_ENDS_AT - now);
  const diffSec = remainingMs > 0 ? Math.floor((remainingMs - 1) / 1000) : 0;
  const remaining = remainingMs > 0 ? diffSec % COUNTDOWN_CYCLE_SECONDS : 0;
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return {
    hours: hh,
    minutes: mm,
    seconds: ss,
    datetime: `PT${hh}H${mm}M${ss}S`,
  };
}

// One impression per page load: the banner remounts when the workspace frame does, which is not a new view.
let impressionReported = false;
/** Test hook: start a fresh page load. */
export function resetBlackFridayImpression() { impressionReported = false; }

/** `onClose` is the visitor's dismissal; `onExpire` hides the banner when the campaign window ends while the page is open. */
export function BlackFridayTopBanner({ onClose, onExpire, trackingPage }: { onClose: () => void; onExpire?: () => void; trackingPage: CreativePage }) {
  const { locale, t } = useI18n();
  const [time, setTime] = useState(() => readBlackFridayCountdown());

  // The link's entry id is reported with the click and replaced afterwards, so each click is its own Pricing entry.
  const [entryId, setEntryId] = useState(newCampaignEntryId);
  useEffect(() => {
    if (impressionReported) return;
    impressionReported = true;
    void trackMotion('surface_view', { page_name: trackingPage, area: 'campaign_banner', element: 'banner', campaign_id: BLACK_FRIDAY_CAMPAIGN });
  }, [trackingPage]);

  useEffect(() => {
    let timer: number | undefined;
    const stopTimer = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const tick = () => {
      if (document.hidden) {
        stopTimer();
        return;
      }
      if (!blackFridayActive()) {
        stopTimer();
        onExpire?.();
        return;
      }
      setTime(readBlackFridayCountdown());
      if (timer === undefined) {
        timer = window.setInterval(tick, 1000);
      }
    };
    if (!document.hidden) {
      timer = window.setInterval(tick, 1000);
    }
    document.addEventListener('visibilitychange', tick);
    return () => {
      stopTimer();
      document.removeEventListener('visibilitychange', tick);
    };
  }, [onExpire]);

  const pricingHref = campaignPricingUrl(locale, 'openmotion_bf_banner', entryId);
  const method = (event: MouseEvent) => event.detail === 0 ? 'keyboard' as const : 'pointer' as const;
  function claimOffer(event: MouseEvent<HTMLAnchorElement>) {
    void trackMotion('ui_click', { page_name: trackingPage, area: 'campaign_banner', element: 'claim_offer', campaign_id: BLACK_FRIDAY_CAMPAIGN, entry_id: entryId, interaction_method: method(event) });
    // Stamp the click time on the address the browser is about to open, then replace the id for the next click.
    event.currentTarget.href = campaignPricingUrl(locale, 'openmotion_bf_banner', entryId);
    window.setTimeout(() => setEntryId(newCampaignEntryId()), 0);
  }
  function close(event: MouseEvent) {
    void trackMotion('ui_click', { page_name: trackingPage, area: 'campaign_banner', element: 'close_banner', campaign_id: BLACK_FRIDAY_CAMPAIGN, interaction_method: method(event) });
    onClose();
  }
  const bannerStyle = {
    '--bf-flame-art': `url("${flameArtUrl}")`,
  } as CSSProperties;

  const copy = {
    aria: t('Black Friday campaign banner'),
    timerLabel: t('Ends in'),
    offerBefore: t('Black Friday lowest of the year! DeepSeek V4.1 Flash & Eco '),
    offerHighlight: t('7-day unlimited'),
    offerAfter: t(', up to 50% off annual'),
    bfCta: t('Claim offer'),
    closeLabel: t('Close campaign banner'),
  };

  return (
    <aside className={styles.banner} aria-label={copy.aria} style={bannerStyle}>
      <div className={styles.content}>
        <div className={styles.countdown} role="timer" aria-live="off">
          <span className={styles.timerLabel}>{copy.timerLabel}</span>
          <time className={styles.timer} dateTime={time.datetime}>
            <span className={styles.timerSeg}>{time.hours}</span>
            <span className={styles.timerSep} aria-hidden="true">:</span>
            <span className={styles.timerSeg}>{time.minutes}</span>
            <span className={styles.timerSep} aria-hidden="true">:</span>
            <span className={styles.timerSeg}>{time.seconds}</span>
          </time>
        </div>
        <p className={styles.offer}>
          {copy.offerBefore}
          <b>{copy.offerHighlight}</b>
          {copy.offerAfter}
        </p>
        <a className={styles.cta} href={pricingHref} target="_blank" rel="noopener noreferrer" onClick={claimOffer} onAuxClick={event => { if (event.button === 1) claimOffer(event); }}>
          {copy.bfCta}
        </a>
      </div>

      <Button variant="plain" className={styles.close} type="button" aria-label={copy.closeLabel} onClick={close}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </Button>
    </aside>
  );
}
