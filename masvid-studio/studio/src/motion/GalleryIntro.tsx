import { Button } from 'open-design-ui/button';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { MotionIcon } from './icons';

/** The introductory tile participates in the same masonry flow as media cards. */
export function GalleryIntro({ eyebrow, title, description, count, disabled, onSurprise, submitLabel, submitUrl, onSubmit, createAction, afterActions }: {
  eyebrow: string; title: string; description?: string; count: string; disabled: boolean;
  onSurprise: () => void; submitLabel: string; submitUrl: string; onSubmit?: () => void;
  createAction?: { label: string; onClick: () => void };
  afterActions?: ReactNode;
}) {
  const { t } = useI18n();
  const submit = <a className={createAction ? "om-button" : "om-gallery-submit"} href={submitUrl} onClick={onSubmit} target="_blank" rel="noreferrer">{submitLabel}<MotionIcon name="arrow-up-right" size={15} /></a>;
  const surprise = <Button variant="plain" type="button" className={createAction ? "om-nav-item" : "om-gallery-surprise"} disabled={disabled} onClick={onSurprise}><MotionIcon name="sparkles" size={17} />{t('Surprise me')}{!createAction && <MotionIcon name="arrow-up-right" size={16} />}</Button>;
  return <section className="om-gallery-intro">
    <span className="om-gallery-eyebrow">{eyebrow}</span><h1>{title}</h1>
    {description && <p>{description}</p>}
    <div className="om-gallery-intro-actions">
      {createAction ? <>
        <Button variant="ghost" type="button" className="om-button h-auto" data-primary onClick={createAction.onClick}><RemixIcon name="add-line" size={16} />{createAction.label}</Button>
        {submit}
        <div className="om-gallery-intro-auxiliary">{surprise}</div>
      </> : <>{surprise}{submit}</>}
    </div>
    {afterActions}
    <small>{count}</small>
  </section>;
}
