import { Button } from 'open-design-ui/button';
import { Tooltip } from '../components/ui';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useReviewPresentationStore } from './reviewPresentationStore';

export function ReviewCommentsAction({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const activate = useDockLayoutStore(state => state.activatePanel);
  const controller = useDockLayoutStore(state => state.controller);
  const visible = useDockLayoutStore(state => state.visiblePanels.has('comments') && !state.collapsedZones?.includes('right'));
  const unavailable = useDockLayoutStore(state => state.controller?.canExpandSide?.('comments') === false);
  const count = useReviewPresentationStore(state => state.count);
  return <Tooltip label={t(unavailable ? 'Screen too small to expand this panel' : 'Review list')}><Button size="sm" className={compact ? "px-1.5" : undefined} aria-label={t('Review list')}
    aria-expanded={visible} disabled={!controller || unavailable} variant="ghost"
    onClick={() => { activate('comments'); controller?.rememberWorkspace?.(); }}
    icon={<RemixIcon name="clipboard-line" size={14} />}>{!compact && t('Review list')}{count > 0 && ` (${count})`}</Button></Tooltip>;
}
