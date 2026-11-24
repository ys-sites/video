import { Button } from 'open-design-ui/button';
import { PreviewCard } from '@base-ui/react/preview-card';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { floatingMotion, POPUP_LAYER } from '../components/ui/Menu';
import { Skeleton } from '../components/ui/Skeleton';
import { TemplateGalleryCard, TemplatePoster } from './TemplateGalleryCard';
import { useTemplatePlayback } from './useTemplatePlayback';
import { useTemplateImpressions } from './useTemplateImpressions';
import { reportRelatedShown, reportRelatedCardShown, type DetailView } from './templateLibraryTracking';
import { relatedTemplateMatches } from './templateDiscovery';
import styles from './TemplateLibraryDialog.module.css';

function PreviewMedia({ template }: { template: GalleryTemplate }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false);
  const [attempt, retry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!element || !template.previewUrl || reducedMotion || failed) return;
    let cancelled = false;
    element.src = template.previewUrl;
    const unavailable = () => { if (!cancelled) { setFailed(true); setPlaying(false); } };
    // A stalled request must return to a usable poster instead of loading indefinitely.
    const timeout = window.setTimeout(unavailable, 15000);
    const ready = () => window.clearTimeout(timeout);
    element.addEventListener('playing', ready);
    void element.play().catch(unavailable);
    return () => {
      cancelled = true; window.clearTimeout(timeout); element.removeEventListener('playing', ready);
      element.pause(); element.removeAttribute('src'); element.load(); setPlaying(false);
    };
  }, [template.previewUrl, reducedMotion, failed, attempt]);
  return <>
    <TemplatePoster template={template} eager />
    {template.previewUrl && !reducedMotion && !failed && <video ref={video} muted playsInline loop preload="none" aria-hidden="true"
      style={{ opacity: playing ? 1 : 0 }} onPlaying={() => setPlaying(true)} onError={() => { setFailed(true); setPlaying(false); }} />}
    {template.previewUrl && !reducedMotion && !playing && !failed && <div className={styles.relatedPreviewStatus} role="status"><Skeleton className={styles.mediaProgress} /><span>{t('Loading preview…')}</span></div>}
    {failed && <div className={styles.relatedPreviewStatus} role="status"><span>{t('Preview unavailable. Try again.')}</span><Button variant="ghost" className="om-button h-auto" onClick={() => { setFailed(false); retry(value => value + 1); }}>{t('Retry')}</Button></div>}
    <span className={styles.relatedPreviewCaption}>{template.title}</span>
  </>;
}

/** One lazy player shared by all related cards, kept inside the native dialog's top layer. */
function LegacyRelatedTemplatePreviews({ templates, panel, onSelect, wide = false }: {
  templates: GalleryTemplate[];
  panel: RefObject<HTMLDivElement | null>;
  onSelect: (template: GalleryTemplate, position: number) => void;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const section = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false), [trigger, setTrigger] = useState<Element | null>(null);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 699px)').matches);
  useEffect(() => {
    const preference = matchMedia('(max-width: 699px)');
    const update = () => { setCompact(preference.matches); setOpen(false); };
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open) return;
    const dismiss = () => setOpen(false);
    const hidden = () => { if (document.hidden) dismiss(); };
    const anchorScrolled = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(trigger)) dismiss();
    };
    document.addEventListener('visibilitychange', hidden);
    document.addEventListener('scroll', anchorScrolled, true);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('scroll', anchorScrolled, true);
      window.removeEventListener('blur', dismiss);
    };
  }, [open, trigger]);
  const anchor = useMemo(() => trigger ? {
    contextElement: trigger,
    getBoundingClientRect: () => {
      const rect = trigger.getBoundingClientRect();
      // Both thumbnail columns open over the stage, never over neighboring cards.
      return compact || wide ? rect : new DOMRect(panel.current?.getBoundingClientRect().left ?? rect.left, rect.top, 0, rect.height);
    },
  } : null, [trigger, panel, compact, wide]);

  return <PreviewCard.Root<GalleryTemplate> open={open} onOpenChange={(next, details) => {
    if (next && document.hidden) { details.cancel(); return; }
    if (details.trigger) setTrigger(details.trigger);
    setOpen(next);
  }}>{({ payload }) => <>
    <section ref={section} className={`${styles.related} ${wide ? styles.relatedShelf : ''}`} aria-label={t('Related templates')}>
      <h3>{t('Related templates')}</h3>
      {wide && <p>{t('Keep exploring. Select a video to view it here.')}</p>}
      <div>{templates.map((item, index) => <PreviewCard.Trigger key={item.id} payload={item} delay={150} closeDelay={100}
        render={<Button variant="plain" type="button" onClick={() => { setOpen(false); onSelect(item, index + 1); }}
          aria-label={t('Preview template {title}', { title: item.title })} />}>
        <TemplatePoster template={item} /><span className={styles.relatedCaption}>{item.title}{wide && <small>{item.authorName || item.author || item.brand}{item.duration != null ? ` · ${t('{value}s', { value: Number(item.duration.toFixed(1)) })}` : ''}</small>}</span>
      </PreviewCard.Trigger>)}</div>
    </section>
    <PreviewCard.Portal container={section.current?.closest('dialog')}>
      <PreviewCard.Positioner anchor={anchor} side={compact || wide ? 'top' : 'left'} sideOffset={20} collisionPadding={16}
        positionMethod="fixed" collisionAvoidance={{ side: compact || wide ? 'flip' : 'none', align: 'shift' }} className={`${POPUP_LAYER} ${styles.relatedPreviewPositioner}`}>
        <PreviewCard.Popup className={`${styles.relatedPreview} ${floatingMotion('duration-open')}`} aria-label={payload?.title}>
          {open && payload && <PreviewMedia key={payload.id} template={payload} />}
        </PreviewCard.Popup>
      </PreviewCard.Positioner>
    </PreviewCard.Portal>
  </>}</PreviewCard.Root>;
}

/** Reuse the home module's cards and observer/player lifecycle; no hover popup. */
function RelatedTemplateShelf({ templates, currentTemplate, detailView, onSelect }: {
  templates: GalleryTemplate[]; currentTemplate?: GalleryTemplate; detailView?: DetailView; onSelect: (template: GalleryTemplate, position: number) => void;
}) {
  const { t } = useI18n();
  const scroller = useRef<HTMLElement>(null);
  const masonry = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState(templates.length);
  useLayoutEffect(() => {
    const element = masonry.current;
    if (!element) return;
    // Read the shared gallery recipe rather than duplicating its breakpoints.
    // Two complete rows avoid balancing only six landscape cards over four columns.
    const update = () => {
      const columns = Number.parseInt(getComputedStyle(element).columnCount, 10);
      if (columns > 0) setCapacity(columns * 2);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const visible = templates.slice(0, capacity);
  const [priority, setPriority] = useState<string | null>(null);
  const active = useTemplatePlayback(scroller, visible.map(item => item.id).join(','), true, true, priority, false, 2);
  const seen = useRef(new Set<string>());
  useTemplateImpressions(scroller, visible.map(item => item.id).join(','), Boolean(detailView), detailView?.id ?? '', id => {
    const index = visible.findIndex(item => item.id === id);
    if (!currentTemplate || !detailView || index < 0) return true;
    if (!seen.current.has(detailView.id)) {
      seen.current.add(detailView.id);
      reportRelatedShown(currentTemplate, visible.length, detailView);
    }
    const key = `${detailView.id}:${id}`;
    if (!seen.current.has(key)) {
      seen.current.add(key);
      reportRelatedCardShown(visible[index], index + 1, currentTemplate, detailView);
    }
    return true;
  });
  const matches = currentTemplate ? visible.map(item => relatedTemplateMatches(currentTemplate, item)) : [];
  const purpose = matches[0]?.purposes.find(value => matches.every(item => item.purposes.includes(value)));
  const motion = matches[0]?.styles.find(value => matches.every(item => item.styles.includes(value)));
  const labels = [purpose, motion].filter((value): value is string => Boolean(value));
  const context = labels.length ? labels.map(value => t(value)).join(' · ')
    : currentTemplate ? t('Similar purpose or motion') : undefined;
  return <section ref={element => { scroller.current = element?.closest('dialog') ?? element; }} className={`om-gallery-results ${styles.relatedShelf}`} aria-label={t('Similar templates')}>
    <header className={styles.relatedHeading}><h3>{t('Similar templates')}</h3>{context && <p>{context}</p>}</header>
    <div ref={masonry} className="om-gallery-masonry">{visible.map((template, index) => <TemplateGalleryCard key={template.id}
      template={template} active={active.has(template.id)} onPriority={setPriority} onSelect={item => onSelect(item, index + 1)} />)}</div>
  </section>;
}

export function RelatedTemplatePreviews(props: {
  templates: GalleryTemplate[]; panel: RefObject<HTMLDivElement | null>; currentTemplate?: GalleryTemplate; detailView?: DetailView;
  onSelect: (template: GalleryTemplate, position: number) => void; wide?: boolean;
}) {
  return props.wide ? <RelatedTemplateShelf templates={props.templates} currentTemplate={props.currentTemplate} detailView={props.detailView} onSelect={props.onSelect} /> : <LegacyRelatedTemplatePreviews {...props} />;
}
