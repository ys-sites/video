import { IconButton, Tooltip } from '../components/ui';
import { Menu, MenuItem } from '../components/ui/Menu';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { useReviewPresentationStore } from './reviewPresentationStore';
import { ReviewCommentsAction } from './ReviewCommentsAction';

export function ReviewCommentsListSlot() {
  return <div ref={useReviewPresentationStore.getState().setListHost} className="h-full min-h-0" />;
}

/** Review tools share the existing transport row; activating them never resizes the video. */
export function ReviewPlayerControls({ projectId, disabled }: { projectId: string; disabled: boolean }) {
  const { t } = useI18n();
  const mode = useReviewPresentationStore(state => state.mode);
  const busy = useReviewPresentationStore(state => state.busy);
  const request = useReviewPresentationStore.getState().request;
  return <div className="motion-review-player flex shrink-0 items-center" data-review-player data-studio-keyboard-owner onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); request(projectId, 'cancel'); } }}>
    <Tooltip label={t('Comment here')}><IconButton size="sm" aria-label={t('Comment here')} aria-pressed={mode === 'comment'} variant={mode === 'comment' ? 'primary' : 'ghost'} disabled={disabled || busy} icon={<RemixIcon name="chat-1-line" size={16} />} onClick={() => request(projectId, 'comment')} /></Tooltip>
    <Tooltip label={t('Draw a comment')}><IconButton size="sm" aria-label={t('Draw a comment')} aria-pressed={mode === 'annotate'} variant={mode === 'annotate' ? 'primary' : 'ghost'} disabled={disabled || busy} icon={<RemixIcon name="edit-line" size={16} />} onClick={() => request(projectId, 'annotate')} /></Tooltip>
    <ReviewCommentsAction compact />
    <Menu modal={false} align="start" side="top" aria-label={t('More review options')} trigger={<IconButton size="sm" disabled={disabled || busy} aria-label={t('More review options')} icon={<RemixIcon name="more-line" size={16} />} />}>
      <MenuItem disabled={Boolean(mode)} onClick={() => request(projectId, 'project')}>{t('Comment on the whole video')}</MenuItem>
    </Menu>
  </div>;
}
