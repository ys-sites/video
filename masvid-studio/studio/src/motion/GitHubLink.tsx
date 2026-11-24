import { Tooltip } from "../components/ui/Tooltip";
import { useEffect, useState } from 'react';
import { GitHubMark } from '../../../packages/design-system/react/GitHubMark';
import { useI18n } from '../i18n/I18n';
import { GITHUB_REPOSITORY, readRepositoryStars } from './githubRepository';
import styles from './GitHubLink.module.css';

export function GitHubLink({ className = '' }: { className?: string } = {}) {
  const { t, formatNumber } = useI18n();
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void readRepositoryStars().then(value => { if (!cancelled && value !== null) setStars(value); });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const count = stars === null ? '10K' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(stars);
  const label = stars === null ? t('OpenMotion on GitHub') : `${t('OpenMotion on GitHub')}, ${t('{count} GitHub stars', { count: formatNumber(stars) })}`;
  return <Tooltip label={t('Star us on GitHub')} side="bottom"><a className={`${styles.link} motion-github-link ${className}`} href={GITHUB_REPOSITORY} target="_blank" rel="noopener noreferrer"
    aria-label={label}>
    <GitHubMark /><span className={styles.count} aria-hidden="true">{count}</span>
  </a></Tooltip>;
}
