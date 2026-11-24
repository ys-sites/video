import { useId, useState, type MouseEvent } from 'react';
import { useI18n } from '../i18n/I18n';
import { BLACK_FRIDAY_CAMPAIGN, campaignPricingUrl, newCampaignEntryId, useBlackFridayActive } from './campaignAttribution';
import type { CreativePage } from './exploreTracking';
import { trackMotion } from './tracking';
import styles from './PricingEntry.module.css';

export function PricingEntry({ trackingPage }: { trackingPage: CreativePage }) {
  const { locale, t } = useI18n();
  const gradientId = useId();
  // Each click is its own Pricing entry: its id is on the link and on the click event, then replaced.
  const [entryId, setEntryId] = useState(newCampaignEntryId);
  const href = campaignPricingUrl(locale, 'openmotion_header_pricing', entryId);
  // Outside the campaign window the entry stays as plain Pricing: no badge, campaign label or campaign fields.
  const campaign = useBlackFridayActive();
  const aria = campaign ? t('Pricing · Black Friday up to 50% off') : 'Pricing';

  function open(event: MouseEvent<HTMLAnchorElement>) {
    void trackMotion('ui_click', { page_name: trackingPage, area: 'header', element: 'open_pricing', ...(campaign ? { campaign_id: BLACK_FRIDAY_CAMPAIGN } : {}), entry_id: entryId,
      interaction_method: event.detail === 0 ? 'keyboard' : 'pointer' });
    // Stamp the click time on the address the browser is about to open, then replace the id for the next click.
    event.currentTarget.href = campaignPricingUrl(locale, 'openmotion_header_pricing', entryId);
    window.setTimeout(() => setEntryId(newCampaignEntryId()), 0);
  }

  return (
    <a
      className={styles.trigger}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={aria}
      onClick={open}
      onAuxClick={event => { if (event.button === 1) open(event); }}
    >
      <svg className={styles.icon} viewBox="0 0 24 24" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: 'var(--motion-black-friday-flame)' }} />
            <stop offset="100%" style={{ stopColor: 'var(--motion-black-friday-amber)' }} />
          </linearGradient>
        </defs>
        <path
          fill={`url(#${gradientId})`}
          fillRule="evenodd"
          clipRule="evenodd"
          d="M3.5 5.25C3.5 4.2835 4.2835 3.5 5.25 3.5H10.5251C11.1219 3.5 11.6942 3.73705 12.1161 4.15901L19.841 11.8839C20.7197 12.7626 20.7197 14.1872 19.841 15.0659L15.0659 19.841C14.1872 20.7197 12.7626 20.7197 11.8839 19.841L4.15901 12.1161C3.73705 11.6942 3.5 11.1219 3.5 10.5251V5.25ZM8 9.25C8.69036 9.25 9.25 8.69036 9.25 8C9.25 7.30964 8.69036 6.75 8 6.75C7.30964 6.75 6.75 7.30964 6.75 8C6.75 8.69036 7.30964 9.25 8 9.25Z"
        />
      </svg>
      <span className={styles.label}>Pricing</span>
      {campaign ? (
        <span className={styles.badge} aria-hidden="true">
          <span className={styles.badgeText}>50% OFF</span>
        </span>
      ) : (
        <span className={styles.cornerBadge} aria-hidden="true">
          <span className={styles.cornerBadgeText}>{t('Free credits')}</span>
        </span>
      )}
    </a>
  );
}
