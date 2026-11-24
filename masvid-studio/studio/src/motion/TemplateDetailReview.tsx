import { Button } from 'open-design-ui/button';
import { useEffect, useState } from 'react';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { Tooltip } from '../components/ui/Tooltip';
import { MotionIcon } from './icons';
import { TemplateMotionGuide } from './TemplateMotionGuide';
import { facetValues, templateRatio, type Facet } from './templateDiscovery';
import { templateGuideFacts, type TemplateGuideFacts } from './templateGuideFacts';
import styles from './TemplateLibraryDialog.module.css';

export function TemplateReviewSpecs({ template }: { template: GalleryTemplate }) {
  const { t } = useI18n();
  return <div className={styles.reviewSpecs} aria-label={t('Video specifications')}>
    <span className="om-badge">{t(isEditableTemplate(template) ? 'Editable project' : 'Reference creation')}</span>
    {template.duration != null && <span>{t('{value}s', { value: Number(template.duration.toFixed(1)) })}</span>}
    {(template.width || template.ratio) && <span>{templateRatio(template)}</span>}
  </div>;
}

export function TemplateDetailReview({ template, onCopyColor, onFilter }: {
  template: GalleryTemplate; onCopyColor: (color: string) => void;
  onFilter: (key: Facet, value: string) => void;
}) {
  const { t } = useI18n();
  const [facts, setFacts] = useState<{ id: string; value: TemplateGuideFacts }>();
  useEffect(() => {
    if (!template.motionGuideUrl) return;
    const controller = new AbortController();
    void fetch(template.motionGuideUrl, { signal: controller.signal, credentials: 'omit' }).then(async response => {
      if (!response.ok) return;
      const value = templateGuideFacts(await response.text());
      if (!controller.signal.aborted) setFacts({ id: template.id, value });
    }).catch(() => {});
    return () => controller.abort();
  }, [template.id, template.motionGuideUrl]);
  const guide = facts?.id === template.id ? facts.value : undefined;
  const purposes = facetValues(template, 'uses');
  return <div className={styles.reviewOverview} aria-label={t('About this starting point')}>
    <section className={styles.reviewModule} aria-label={t('Video information')}>
      <h3>{t('Video information')}</h3>
      <dl className={`${styles.metadata} ${styles.reviewMetadata}`}>
        {purposes.length > 0 && <div><dt>{t('Video purpose')}</dt><dd>{purposes.map(value => <Button variant="plain" className="om-badge" key={value} onClick={() => onFilter('uses', value)}>{t(value)}</Button>)}</dd></div>}
        {(['styles', 'creationModels'] as const).map(key => facetValues(template, key).length > 0 && <div key={key}><dt>{t(key === 'styles' ? 'Motion style' : 'Creation models')}</dt><dd>{facetValues(template, key).map(value => <Button variant="plain" className="om-badge" key={value} onClick={() => onFilter(key, value)}>{t(value)}</Button>)}</dd></div>)}
      </dl>
      {(guide?.palette.length || facetValues(template, 'colors').length > 0) ? <div className={styles.reviewColors}>
        <span>{t('Reference colors')}</span>
        {guide?.palette.length ? <div className={styles.palette}>{guide.palette.map(color => <Tooltip key={color} withinDialog wrap label={t('Copy color {color}', { color })}><Button variant="plain" className={styles.colorSwatch} style={{ backgroundColor: color }} aria-label={t('Copy color {color}', { color })} onClick={() => onCopyColor(color)} /></Tooltip>)}</div>
          : <div>{facetValues(template, 'colors').map(value => <Button variant="plain" className="om-badge" key={value} onClick={() => onFilter('colors', value)}>{t(value)}</Button>)}</div>}
      </div> : null}
    </section>
  </div>;
}

export function TemplateProductionNotes({ template, onGuide }: { template: GalleryTemplate; onGuide: () => void }) {
  const { t } = useI18n();
  if (!template.styleDescription && !template.reviewFocus && !template.motionGuideUrl) return null;
  return <section className={styles.productionNotes} aria-label={t('Production details')}>
    <h3>{t('Production details')}</h3>
    {(template.styleDescription || template.reviewFocus) && <div className={styles.productionText}>
      {template.styleDescription && <div><h4>{t('Visual style')}</h4><p>{template.styleDescription}</p></div>}
      {template.reviewFocus && <div><h4>{t('Production notes')}</h4><p>{template.reviewFocus}</p></div>}
    </div>}
    {template.motionGuideUrl && <TemplateGuideLaunch onGuide={onGuide} />}
  </section>;
}

function TemplateGuideLaunch({ onGuide }: { onGuide: () => void }) {
  const { t } = useI18n();
  return <div className={styles.reviewGuideEntry} aria-label={t('Production references')}>
    <Button variant="plain" className={`om-button ${styles.guideEntry}`} data-quiet aria-label={t('View motion.md guide')} onClick={onGuide}>
      <MotionIcon name="code" size={16} /><span><strong>{t('View motion.md guide')}</strong><small>{t('Shots, motion and examples')}</small></span><MotionIcon name="arrow-right" size={16} />
    </Button>
  </div>;
}

export function TemplateGuideReview({ template, open, onClose, onFullPage }: { template: GalleryTemplate; open: boolean; onClose: () => void; onFullPage?: () => void }) {
  const { t } = useI18n();
  if (!open) return null;
  return <section className={styles.guideDialog} aria-label={t('Interactive walkthrough')}
    onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
    <header><Button variant="ghost" className="om-button h-auto" data-quiet onClick={onClose}><MotionIcon name="arrow-left" size={16} />{t('Back to template')}</Button><div><strong>{t('Motion.md guide')}</strong><span>{template.title}</span></div>
      <a className="om-button" href={template.motionGuideUrl} target="_blank" rel="noreferrer" onClick={onFullPage}>{t('View full page')}<MotionIcon name="arrow-up-right" size={14} /></a>
    </header>
    <p>{t('Try the controls in the walkthrough. Changes affect this demo only, not the reference video or your project.')}
      <small>{t('Walkthrough content keeps its original language.')}</small></p>
    {open && template.motionGuideUrl && <TemplateMotionGuide expanded key={template.id} url={template.motionGuideUrl} title={t('Interactive walkthrough')} onEscape={onClose} />}
  </section>;
}
