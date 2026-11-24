import { Button } from 'open-design-ui/button';
import { useState } from 'react';
import type { ReviewComment } from '../../../shared/review-comments';
import { IconButton, Tooltip } from '../components/ui';
import { Menu, MenuItem } from '../components/ui/Menu';
import { Checkbox } from '../components/ui/Checkbox';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { ReviewAnnotationGraphic } from './ReviewAnnotationGraphic';
import { reviewTime } from './reviewCommentsClient';

export function ReviewCommentCard({ comment, stale, busy, locatingDisabled, selecting, checked, onCheck, onLocate, onComplete, onDelete }: {
  comment: ReviewComment; stale: boolean; busy: boolean; locatingDisabled: boolean; selecting: boolean; checked: boolean;
  onCheck: (checked: boolean) => void; onLocate: () => void; onComplete: () => void; onDelete: () => void;
}) {
  const { t } = useI18n();
  const [details, setDetails] = useState(false);
  return <article className="flex flex-col gap-2 rounded-lg border border-border p-3">
    <div className="flex items-center gap-2">
      {selecting && <Checkbox aria-label={t('Select comment') + ' ' + comment.text} checked={checked} onCheckedChange={onCheck} />}
      <Button variant="plain" className="om-text-link min-w-0 flex-1 text-left disabled:opacity-40" disabled={busy || locatingDisabled} onClick={onLocate}>
        <span className="font-mono text-step-11 tabular-nums">{comment.anchor.time === undefined ? t('Whole video') : reviewTime(comment.anchor.time)}</span>
        {comment.anchor.annotation && <span className="ml-2 inline-flex items-center gap-1 text-step-11"><RemixIcon name="edit-line" size={12} />{t('Annotated')}</span>}
      </Button>
      <Tooltip label={t(comment.status === 'open' ? 'Mark complete' : 'Reopen')}><IconButton size="sm" aria-label={t(comment.status === 'open' ? 'Mark complete' : 'Reopen')} disabled={busy} onClick={onComplete} icon={<RemixIcon name={comment.status === 'open' ? 'check-line' : 'arrow-go-back-line'} size={14} />} /></Tooltip>
      <Menu modal={false} align="end" aria-label={t('Comment options')} trigger={<IconButton size="sm" aria-label={t('Comment options')} disabled={busy} icon={<RemixIcon name="more-line" size={14} />} />}>
        <MenuItem onClick={() => setDetails(value => !value)}>{t('Saved context')}</MenuItem>
        <MenuItem tone="danger" onClick={onDelete}>{t('Delete comment')}</MenuItem>
      </Menu>
    </div>
    <p className="whitespace-pre-wrap break-words text-text-1">{comment.text}</p>
    {comment.anchor.element && <span className="truncate text-text-3">{comment.anchor.element.label}</span>}
    {stale && <span className="text-text-3">{t('Earlier project revision')}</span>}
    {details && <div className="flex flex-col gap-2 text-text-3">
      {comment.anchor.annotation && <svg aria-label={t('Saved annotation')} viewBox={`0 0 ${comment.anchor.annotation.width} ${comment.anchor.annotation.height}`}
        className="w-full rounded-md border border-border bg-bg-2" style={{ aspectRatio: `${comment.anchor.annotation.width} / ${comment.anchor.annotation.height}` }}><ReviewAnnotationGraphic annotation={comment.anchor.annotation} /></svg>}
      <dl className="flex flex-col gap-1 break-words"><dt>{t('Composition')}</dt><dd>{comment.anchor.compositionPath}</dd>
        {comment.anchor.element && <><dt>{t('Element')}</dt><dd>{comment.anchor.element.sourceFile} · {comment.anchor.element.tagName}{comment.anchor.element.domId && `#${comment.anchor.element.domId}`}</dd>
          <dt>{t('Text at capture')}</dt><dd>{comment.anchor.element.text || '—'}</dd></>}
        <dt>{t('Source revision')}</dt><dd title={comment.sourceRevision}>{comment.sourceRevision.slice(0, 12)}</dd>
      </dl>
    </div>}
  </article>;
}
