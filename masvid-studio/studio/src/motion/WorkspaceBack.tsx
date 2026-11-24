import { IconButton } from 'open-design-ui/icon-button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { workspaceHistoryIndex } from '../utils/workspaceHistory';

export function WorkspaceBack({ fallback, inline = false, onBack }: { fallback: () => void; inline?: boolean; onBack?: () => void }) {
  const { t } = useI18n();
  const back = () => {
    onBack?.();
    if ((workspaceHistoryIndex() ?? 0) > 0) window.history.back();
    else fallback();
  };
  const button = <IconButton type="button" className="om-studio-back" size="lg" onClick={back}
    aria-label={t('Back')} title={t('Back')} icon={<RemixIcon name="arrow-left-line" size={16} />} />;
  return inline ? button : <div className="om-page-back-row">{button}</div>;
}
