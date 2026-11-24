import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

export function BackToExploreButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return <Button variant="plain" type="button" className="om-nav-item om-back-to-explore" onClick={onClick}>
    <RemixIcon name="arrow-left-line" size={16} />{t('Back to Explore')}
  </Button>;
}
