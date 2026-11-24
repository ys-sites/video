import { Button } from 'open-design-ui/button';
import { GitHubMark } from '../../../packages/design-system/react/GitHubMark';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { GITHUB_REPOSITORY } from './githubRepository';

export function ComingSoonGuide({ description, action, compact = false, showStatus = true }: {
  description?: string;
  action?: { label: string; onClick: () => void; icon?: string };
  compact?: boolean;
  showStatus?: boolean;
}) {
  const { t } = useI18n();
  return <div className={compact ? 'om-coming-soon-guide om-coming-soon-guide-compact' : 'om-coming-soon-guide'}>
    {description && <p className="om-coming-soon-copy om-studio-coming-soon-copy">{t(description)}</p>}
    {showStatus && <p className="om-coming-soon-status om-studio-coming-soon-status om-specialty-status">{t('Coming soon')}</p>}
    <div className="om-coming-soon-actions om-studio-coming-soon-actions">
      {action && <Button variant="ghost" className="om-button h-auto" data-primary onClick={action.onClick}><RemixIcon name={action.icon ?? 'sparkling-line'} size={16} />{t(action.label)}</Button>}
      <a className="om-button" href={GITHUB_REPOSITORY} target="_blank" rel="noopener noreferrer"><GitHubMark />{t('Star us on GitHub')}</a>
    </div>
  </div>;
}
