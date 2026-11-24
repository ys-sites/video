import { Button } from 'open-design-ui/button';
import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { isEditableTemplate, type GalleryTemplate } from '../../../shared/catalog';
import { useI18n } from '../i18n/I18n';
import { Skeleton } from '../components/ui/Skeleton';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';
import { MotionIcon } from './icons';
import { BrandArtworkImage } from './BrandArtworkImage';
import { templateAspect } from './templateDiscovery';
import figmaLogo from './template-brands/figma.png';
import lovableLogo from './template-brands/lovable.svg';
import linearLogo from './template-brands/linear.svg';
import firecrawlLogo from './template-brands/firecrawl.png';
import kimiLogo from './template-brands/kimi.png';
import pondLogo from './template-brands/pond.svg';
import notionLogo from './template-brands/notion.png';
import higgsfieldLogo from './template-brands/higgsfield.png';

const brandLogos: Record<string, string> = { Notion: notionLogo, Higgsfield: higgsfieldLogo, Figma: figmaLogo, Lovable: lovableLogo, Linear: linearLogo, Firecrawl: firecrawlLogo, Kimi: kimiLogo, Pond: pondLogo };

export function TopBrandsLabel() {
  const { t } = useI18n();
  return <span className="ui-collection-label" aria-hidden="true"><span className="ui-collection-label__title">TOP 100</span><span>{t('Brands')}</span></span>;
}

export function TemplateIdentity({ template, brand = false, favicon = false }: { template: GalleryTemplate; brand?: boolean; favicon?: boolean }) {
  const name = brand ? template.brand || template.author : template.authorName || template.author || template.brand || 'OpenMotion';
  const [failedUrls, setFailedUrls] = useState<string[]>([]);
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const candidates = favicon ? [template.brandLogoUrl] : [!brand && template.authorAvatarUrl, template.brandLogoUrl, brandLogos[template.brand ?? '']];
  const url = candidates.find((candidate): candidate is string => Boolean(candidate) && !failedUrls.includes(candidate as string));
  const loadingFavicon = Boolean(favicon && url && loadedUrl !== url);
  return <span className="om-gallery-avatar" data-favicon={favicon || undefined} data-loading={loadingFavicon || undefined} aria-hidden="true">
    {loadingFavicon ? <Skeleton className="om-gallery-avatar-skeleton" /> : (!favicon || !url) ? name.slice(0, 1).toUpperCase() : null}
    {url && (favicon ? <BrandArtworkImage src={url} channel="favicon" alt="" style={{ opacity: loadedUrl === url ? 1 : 0 }}
        onLoad={() => setLoadedUrl(url)} onError={() => setFailedUrls(previous => [...previous, url])} />
      : <img src={url} alt="" loading="lazy" onError={() => setFailedUrls(previous => [...previous, url])} />)}
  </span>;
}

/** A separate anchor keeps website navigation independent from opening the preview. */
export function TemplateSourceLink({ template, className }: { template: GalleryTemplate; className: string }) {
  const { t } = useI18n();
  if (!template.sourceUrl) return null;
  const domain = new URL(template.sourceUrl).hostname.replace(/^www\./, '');
  return <a className={className} href={template.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t('Source')}: ${template.title} · ${domain}`} title={template.sourceUrl}>
    <TemplateIdentity template={template} brand favicon />
    <span className="om-gallery-source-caption"><strong>{template.title}</strong><small>{domain}</small></span>
    <MotionIcon name="arrow-up-right" size={16} />
  </a>;
}

export function TemplatePoster({ template, eager = false, coverUrl, brandedFallback = false }: { template: Pick<GalleryTemplate, 'posterUrl' | 'title'>; eager?: boolean; coverUrl?: string; brandedFallback?: boolean }) {
  const [loaded, setLoaded] = useState(false), [failed, setFailed] = useState(false);
  const [loadedCover, setLoadedCover] = useState<string>(), [failedCover, setFailedCover] = useState<string>();
  const usingCover = Boolean(coverUrl && coverUrl !== failedCover);
  const coverLoaded = Boolean(usingCover && loadedCover === coverUrl);
  const posterReady = usingCover ? coverLoaded : loaded;
  return <div className="om-gallery-poster" data-loaded={posterReady}>
    {brandedFallback && !posterReady && <CoverPlaceholder fill />}
    {!brandedFallback && (usingCover ? (!coverLoaded && <Skeleton className="om-gallery-poster-skeleton" />) : (!loaded && !failed && template.posterUrl && <Skeleton className="om-gallery-poster-skeleton" animated={false} />))}
    {!brandedFallback && !usingCover && (!template.posterUrl || failed) && <div className="om-gallery-poster-fallback"><MotionIcon name="film" size={26} /><span>{template.title}</span></div>}
    {!usingCover && template.posterUrl && !failed && <img src={template.posterUrl} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} style={{ opacity: loaded ? 1 : 0 }} />}
    {usingCover && coverUrl && <BrandArtworkImage className="om-gallery-poster-cover" channel="cover" src={coverUrl} alt="" onLoad={() => setLoadedCover(coverUrl)} onError={() => setFailedCover(coverUrl)} style={{ opacity: coverLoaded ? 1 : 0 }} />}
  </div>;
}

export const TemplateGalleryCard = memo(function TemplateGalleryCard({
  template, onSelect, active, onPriority, playbackId, footer, brandCredit = false, resourceKind = 'template', animatedPreview, coverUrl, showAvatar = true, showCoverDuration = true, brandedFallback = false,
}: {
  template: GalleryTemplate;
  onSelect: (template: GalleryTemplate, trigger: HTMLButtonElement) => void;
  active: boolean;
  onPriority: (id: string | null) => void;
  playbackId?: string;
  footer?: ReactNode;
  brandCredit?: boolean;
  resourceKind?: 'template' | 'brand-kit';
  animatedPreview?: string;
  coverUrl?: string;
  showAvatar?: boolean;
  showCoverDuration?: boolean;
  brandedFallback?: boolean;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    if (!active || !animatedPreview) { setAnimate(false); return; }
    const intent = setTimeout(() => setAnimate(true), 250);
    return () => clearTimeout(intent);
  }, [active, animatedPreview]);
  useEffect(() => {
    const element = video.current;
    if (!element || !active || !template.previewUrl || failed) return;
    let cancelled = false;
    element.src = template.previewUrl;
    void element.play().catch(() => { if (!cancelled) setPlaying(false); });
    return () => {
      cancelled = true; element.pause(); element.removeAttribute('src'); element.load(); setPlaying(false);
    };
  }, [active, template.previewUrl, failed]);
  const brandName = brandCredit ? template.brand?.trim() : undefined;
  const credit = template.authorName || template.author || template.brand;
  const linkedSource = resourceKind === 'brand-kit' && Boolean(template.sourceUrl);
  return <article className="om-gallery-card" data-template-id={template.id} data-playback-id={template.previewUrl ? playbackId : undefined} data-has-video={Boolean(template.previewUrl || animatedPreview)} data-website-cover={Boolean(coverUrl)}>
    <div className="om-gallery-card-media">
    <Button variant="plain" className="motion-gallery-card-cover om-gallery-cover" style={{ aspectRatio: templateAspect(template) }} onClick={event => onSelect(template, event.currentTarget)}
      onMouseEnter={() => onPriority(playbackId ?? template.id)} onMouseLeave={() => onPriority(null)} onFocus={() => onPriority(playbackId ?? template.id)} onBlur={() => onPriority(null)}
      aria-label={t(resourceKind === 'brand-kit' ? 'Preview Brand Kit {title}' : 'Preview template {title}', { title: template.title })}>
      <TemplatePoster key={template.posterUrl} template={template} coverUrl={coverUrl} brandedFallback={brandedFallback} />
      {template.previewUrl && <video ref={video} muted playsInline loop preload="none" aria-hidden="true" onPlaying={() => setPlaying(true)} onError={() => { setFailed(true); setPlaying(false); }} style={{ opacity: active && playing ? 1 : 0 }} />}
      {animatedPreview && active && animate && <iframe className="om-gallery-animation" src={animatedPreview} loading="lazy" sandbox="allow-scripts" title={template.title} tabIndex={-1} aria-hidden="true" />}
      <span className="om-gallery-card-shade" />
      <span className="om-gallery-card-top">{resourceKind === 'brand-kit' && <span>{t('Brand Kit')}</span>}{resourceKind === 'template' && <span>{t(isEditableTemplate(template) ? 'Ready to edit' : template.styles?.[0] || 'Motion design')}</span>}{showCoverDuration && template.duration != null && <span>{t('{value}s', { value: Number(template.duration.toFixed(1)) })}</span>}</span>
      {!linkedSource && <span className="om-gallery-card-bottom">
        {showAvatar && <TemplateIdentity template={template} brand={Boolean(brandName)} />}
        <span className="om-gallery-card-caption" data-brand-credit={brandName ? true : undefined}><strong>{brandName || template.title}</strong><small>{brandName ? template.title : credit}</small></span>
        <span className="om-gallery-card-arrow"><MotionIcon name="arrow-up-right" size={18} /></span>
      </span>}
    </Button>
    </div>
    {linkedSource && <TemplateSourceLink template={template} className="om-gallery-card-source" />}
    {footer}
  </article>;
});
