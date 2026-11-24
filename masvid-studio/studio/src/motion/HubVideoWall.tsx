import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useToast } from '../hooks/useToast';
import { Tooltip } from '../components/ui/Tooltip';
import { Popover } from '../components/ui/Popover';
import { MotionIcon } from './icons';
import { TemplateHandoffSteps } from './TemplateHandoffInfo';
import { templateSubmissionPrompt } from './templateContribution';
import type { GalleryTemplate } from '../../../shared/catalog';
import styles from './TemplateLibraryDialog.module.css';
import { StudioToastViewport } from '../components/StudioToastViewport';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import type { HubVideo } from './gemini4Videos';
import { reportHubClick } from './exploreTracking';
import { designSystemAsset } from '../../../packages/design-system/index.js';
import { platformIcons } from '../../../packages/design-system/platform-icons.js';

/** Per-video motion.md written from each reference film, keyed by video id. */
const motionDocuments: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob('./model-hubs/gemini-4/motion/*.md', { query: '?url', import: 'default', eager: true }) as Record<string, string>)
  .map(([path, url]) => [path.split('/').pop()!.replace(/\.md$/, ''), url]));

/** The X mark tinted by the surrounding text color. */
const xMark = <span className="om-hub-x-mark" aria-hidden="true" style={{ ['--mark' as string]: `url(${designSystemAsset(platformIcons.x)})` }} />;

/** Same clamp as template cards so the waterfall keeps their rhythm. */
const aspect = (video: HubVideo) => { const [w, h] = video.ratio.split('/').map(Number); return Math.max(0.8, Math.min(1.9, w / h)); };
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
/** The X media CDN rejects requests that carry another site's referrer, so previews play in a document that sends none. */
/** Card previews stay transparent until frames arrive, so the card poster shows instead of a black flash. */
const previewDocument = (video: HubVideo, src = video.video, controls = false) => `<meta name="referrer" content="no-referrer"><style>html,body{margin:0;height:100%;overflow:hidden;background:${controls ? 'black' : 'transparent'}}video{width:100%;height:100%;object-fit:${controls ? 'contain' : 'cover'};display:block}</style><video src="${escape(src)}"${controls ? ` poster="${escape(video.poster)}"` : ''} muted autoplay loop playsinline${controls ? ' controls' : ''}></video>`;
type Filter = 'all' | string;

/** Same breakpoints as the template gallery's masonry columns. */
function useGalleryColumns() {
  const count = () => innerWidth >= 1800 ? 5 : innerWidth < 850 ? 2 : innerWidth < 1200 ? 3 : 4;
  const [columns, setColumns] = useState(count);
  useEffect(() => { const update = () => setColumns(count()); addEventListener('resize', update); return () => removeEventListener('resize', update); }, []);
  return columns;
}
/** Waterfall that reads left to right: each card, in rank order, joins the currently shortest column. */
function rowMajorColumns(videos: HubVideo[], count: number) {
  const columns: HubVideo[][] = Array.from({ length: count }, () => []), heights = new Array<number>(count).fill(0);
  for (const video of videos) {
    const column = heights.indexOf(Math.min(...heights));
    columns[column].push(video); heights[column] += 1 / aspect(video) + .12;
  }
  return columns;
}

/** Community videos for a model hub. Each card plays its original post's media and links back to the author. */
export function HubVideoWall({ hubId, signedIn, videos, title, query = '' }: { hubId: string; signedIn?: boolean; videos: HubVideo[]; title: string; query?: string }) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>('all');
  // Cards autoplay while on screen, like the template gallery; reduced motion keeps posters.
  const [inView, setInView] = useState<ReadonlySet<string>>(new Set());
  const [still, setStill] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const grid = useRef<HTMLDivElement>(null);
  // Rebind when the tab returns: the observer does not re-report cards that stayed in place.
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  useEffect(() => { const update = () => setPageVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  const [open, setOpen] = useState<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Scenes ordered by how many videos they hold, so the busiest scenes come first.
  const scenes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const video of videos) counts.set(video.category, (counts.get(video.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]).map(([scene]) => scene);
  }, [videos]);
  const shown = useMemo(() => videos
    .filter(video => filter === 'all' || video.category === filter)
    .filter(video => { const q = query.trim().toLocaleLowerCase(); return !q || [video.title, t(video.title), video.author, video.authorName, t(video.category), video.notes, video.notesEn ?? "", video.variant].some(text => text.toLocaleLowerCase().includes(q)); })
    .sort((a, b) => b.views - a.views), [videos, filter, query, t]);
  const visible = shown;
  const columns = useGalleryColumns();  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setStill(preference.matches);
    preference.addEventListener('change', change);
    return () => preference.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    const root = grid.current;
    setInView(new Set());
    if (!root || !pageVisible || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setInView(current => {
      const next = new Set(current);
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.videoId!;
        if (entry.isIntersecting && !document.hidden) next.add(id); else next.delete(id);
      }
      return next;
    }), { rootMargin: '120px 0px' });
    // Rebind whenever the shown cards or their columns change; the observer reports current visibility again.
    root.querySelectorAll('[data-video-id]').forEach(card => observer.observe(card));
    return () => observer.disconnect();
  }, [visible, columns, pageVisible]);
  const tabs: [Filter, string][] = [['all', t('All')], ...scenes.map(scene => [scene, t(scene)] as [Filter, string])];

  return <section className="om-hub-videos" aria-label={t('Made with {model}', { model: title })}>
    <div className="om-discovery-heading"><div className="om-hub-video-title">
      <h2 className="om-subtitle">{t('Made with {model}', { model: title })}</h2><span className="om-hub-video-sort">{xMark}{t('Ranked by X popularity')}</span>
    </div>
      <div className="om-hub-video-filters">
      <nav className="om-choice-tabs" aria-label={t('Filter videos')}>{tabs.map(([id, label]) => <Button variant="plain" key={id} className="om-nav-item" aria-pressed={filter === id}
        onClick={() => { reportHubClick(hubId, 'hub_videos', 'filter_option', { filter: id, signedIn }); setFilter(id); }}>{label}</Button>)}</nav></div>
    </div>
    {!visible.length && <p className="om-muted om-hub-video-empty">{t('No videos match. Try another title, creator or scene.')}</p>}
    <div ref={grid} className="om-hub-video-grid">{rowMajorColumns(visible, columns).map((column, c) => <div key={c} className="om-hub-video-column">{column.map(video => <article key={video.id} className="om-gallery-card om-hub-video" data-has-video="true" data-video-id={video.id}>
      <div className="om-gallery-card-media">
        <Button variant="plain" className="om-gallery-cover" style={{ aspectRatio: aspect(video) }}
          aria-label={t('Preview video {title}', { title: t(video.title) })} onClick={event => {
            reportHubClick(hubId, 'hub_videos', 'open_detail', { video: video.id, position: shown.indexOf(video), signedIn });
            returnFocus.current = event.currentTarget; setOpen(video.id);
          }}>
          <div className="om-gallery-poster" data-loaded="true"><img src={video.poster} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /></div>
          <span className="om-gallery-card-shade" />
          <span className="om-gallery-card-top"><span>{video.variant}</span>{video.code && <span>{t('Made in code')}</span>}<span>{t('{value}s', { value: video.duration })}</span></span>
          {video.platform === 'x' && <span className="om-hub-video-heat" aria-label={t('{count} views on X', { count: compact.format(video.views) })}>{xMark}<RemixIcon name="eye-line" size={12} />{compact.format(video.views)}</span>}
          <span className="om-gallery-card-bottom">
            <span className="om-gallery-avatar" aria-hidden="true">{video.authorName.slice(0, 1).toUpperCase()}{video.avatar && <img src={video.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />}</span>
            <span className="om-gallery-card-caption"><strong>{t(video.title)}</strong><small>{video.author}{video.platform === 'x' && <> · {t('{count} views', { count: compact.format(video.views) })}</>}</small></span>
            <span className="om-gallery-card-arrow"><RemixIcon name="arrow-right-up-line" size={18} /></span>
          </span>
        </Button>
        {/* Previews sit beside the button, never inside it; the button stays the single click target. */}
        {!still && inView.has(video.id) && video.platform !== 'x' && <video className="om-gallery-animation" src={video.video} muted loop playsInline autoPlay aria-hidden="true" />}
        {!still && inView.has(video.id) && video.platform === 'x' && <iframe className="om-gallery-animation" srcDoc={previewDocument(video)} sandbox="allow-scripts" allow="autoplay" tabIndex={-1} aria-hidden="true" title="" />}
      </div>
    </article>)}</div>)}</div>
    {open && <HubVideoDetail videos={shown} id={open} onChange={setOpen} onClose={() => setOpen(null)} returnFocus={returnFocus} title={title}
      track={(element, fields) => reportHubClick(hubId, 'hub_video_detail', element, { ...fields, signedIn })} />}
  </section>;
}

/** Recreation brief in the same shape as template handoffs, pointing at the public post instead of a catalog resource. */
export function hubVideoPrompt(video: HubVideo, model: string, locale: string) {
  return locale === 'zh-CN' ? `使用说明：请使用已连接的 OpenMotion 插件；未安装时先按 https://github.com/nexu-io/openmotion 安装并验证连接。
参考视频：${video.author} ${video.platform === 'x' ? '在 X 上发布' : '在网页上发布'}的「${video.notes}」（${video.post}，视频直链 ${video.source}）；资源类型：参考创作，仅有公开参考视频，没有原片工程。
制作方式：原片由 ${model} ${video.variant} ${video.code ? '用代码直接生成' : '生成的交互页面录屏'}，请在 OpenMotion 中用可编辑的动画工程重做同类效果。
创作要求：先看参考视频，根据参考和我的内容创建独立作品，不承诺精确复刻，不直接使用原视频画面；保留已有工程。先核对产品名、功能文案；缺必要材料先说明。未提供音频时静音。交付时返回准确工程链接，后续在同一工程接着改。
我的要求：
` : `Instructions: Use the connected OpenMotion plugin. If needed, install it from https://github.com/nexu-io/openmotion and verify the connection.
Reference video: posted ${video.platform === 'x' ? 'on X' : 'on the web'} by ${video.author} (${video.post}; direct video ${video.source}). Resource: public reference video only; no original editable project.
How it was made: ${model} ${video.variant} ${video.code ? 'generated it directly in code' : 'built the interactive page shown in this recording'}. Rebuild a similar effect as an editable OpenMotion project.
Creation requirements: Watch the reference first. Create an independent work from the reference and my content; do not promise an exact reconstruction or reuse the original footage. Preserve existing projects. Check product name and copy; ask for missing essential inputs. Use silence if no audio is supplied. Return the exact project link and continue in that same project.
My request:
`;
}

/** The template detail, field for field: same native dialog, module classes, copy and actions as TemplateLibraryDialog's review mode. */
function HubVideoDetail({ videos, id, onChange, onClose, returnFocus, title, track }: {
  videos: HubVideo[]; id: string; onChange: (id: string) => void; onClose: () => void; returnFocus: RefObject<HTMLElement | null>; title: string;
  track: (element: Parameters<typeof reportHubClick>[2], fields: Parameters<typeof reportHubClick>[3]) => void;
}) {
  const { t, locale } = useI18n();
  const { toasts, showToast, dismissToast } = useToast();
  const dialog = useRef<HTMLDialogElement>(null), scroll = useRef<HTMLDivElement>(null), footer = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false), [manualCopy, setManualCopy] = useState(''), [downloading, setDownloading] = useState(false);
  async function downloadMotion() {
    const url = motionDocuments[video.id]; if (!url) return;
    track('download_guide', { video: video.id });
    setDownloading(true);
    try {
      const response = await fetch(url); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = href; link.download = 'motion.md'; link.click();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch { showToast(t('Could not download motion.md. Try again.'), 'error'); }
    finally { setDownloading(false); }
  }
  const index = Math.max(0, videos.findIndex(video => video.id === id)), video = videos[index];
  const step = (delta: number) => {
    const next = videos[(index + delta + videos.length) % videos.length].id;
    track(delta < 0 ? 'detail_previous' : 'detail_next', { video: next });
    onChange(next);
  };
  useEffect(() => {
    const element = dialog.current, focus = returnFocus.current;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); focus?.focus(); };
  }, [returnFocus]);
  useEffect(() => { setExpanded(false); setManualCopy(''); scroll.current?.scrollTo({ top: 0 }); }, [id]);
  useEffect(() => {
    const element = footer.current; if (!element) return;
    const measure = () => dialog.current?.style.setProperty('--review-action-height', `${element.getBoundingClientRect().height}px`);
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); return () => observer.disconnect();
  }, []);
  const ratio = aspect(video), prompt = hubVideoPrompt(video, title, locale);
  const similar = videos.filter(item => item.id !== video.id && item.category === video.category)
    .concat(videos.filter(item => item.id !== video.id && item.category !== video.category && item.variant === video.variant)).slice(0, 8);
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  async function copy(submit = false) {
    track('start_use', { video: video.id, action: submit ? 'recreate_submit' : 'recreate' });
    const text = submit ? templateSubmissionPrompt(prompt, locale) : prompt;
    try {
      await navigator.clipboard.writeText(text); setManualCopy('');
      showToast(t(submit ? 'Contribution instruction copied. Paste into your Agent to prepare a reusable template and contribution PR.' : 'Copied. Paste into your Agent, add your materials and requirements, then send.'), 'info');
    } catch { setManualCopy(text); setExpanded(true); showToast(t('Copy failed. Select the instruction in this section to copy manually, or try again.'), 'error', 'feedback'); }
  }
  const copyColor = (color: string) => {
    track('copy_color', { video: video.id });
    void navigator.clipboard.writeText(color).then(() => showToast(t('Copied {color}', { color }), 'info')).catch(() => showToast(t('Could not copy color. Try again.'), 'error'));
  };
  return <div className={styles.library} style={{ display: 'contents' }}>
    <dialog ref={dialog} className={`${styles.detail} ${styles.reviewDetail} om-hub-video-detail`} aria-label={t('Video preview')}
      onCancel={event => { if (event.target !== dialog.current) return; event.preventDefault(); onClose(); }}
      onKeyDown={event => {
        if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, video')) return;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
      }}>
      <div ref={scroll} className={styles.reviewScroll}>
        <div className={`${styles.detailGrid} ${styles.reviewGrid}`}>
          <div className={styles.stage}>
            <img className={styles.ambient} src={video.poster} alt="" aria-hidden="true" referrerPolicy="no-referrer" />
            <div className={styles.stageGlass} />
            <div className={styles.stageMedia} style={{ aspectRatio: ratio, width: `min(100%, calc(var(--stage-media-height) * ${ratio}))` }}>
              {video.platform === 'x'
                ? <iframe key={video.id} className="om-hub-video-stage" srcDoc={previewDocument(video, video.source, true)} sandbox="allow-scripts" allow="autoplay; fullscreen" title={t(video.title)} />
                : <video key={video.id} className="om-hub-video-stage" src={video.source} poster={video.poster} controls autoPlay muted playsInline loop preload="metadata" />}
            </div>
            <nav className={styles.stageNavigation} aria-label={t('Browse videos')}>
              <Button variant="ghost" className="om-button h-auto" disabled={videos.length < 2} onClick={() => step(-1)}><MotionIcon name="arrow-left" size={16} />{t('Previous template')}</Button>
              <span>{index + 1} / {videos.length}</span>
              <Button variant="ghost" className="om-button h-auto" disabled={videos.length < 2} onClick={() => step(1)}>{t('Next template')}<MotionIcon name="arrow-right" size={16} /></Button>
            </nav>
          </div>
          <div className={styles.detailInfo}>
            <div className={styles.detailNav}>
              <Tooltip withinDialog wrap label={t('Close template preview')}><IconButton variant="plain" className={styles.iconButton} autoFocus onClick={() => { track('close_detail', { video: video.id }); onClose(); }} aria-label={t('Close template preview')} icon={<MotionIcon name="close" size={20} />} /></Tooltip>
              <span className={styles.detailCount}>{index + 1} / {videos.length}</span>
              <Tooltip withinDialog wrap label={t('Previous template')}><IconButton variant="plain" className={styles.iconButton} disabled={videos.length < 2} onClick={() => step(-1)} aria-label={t('Previous template')} icon={<MotionIcon name="arrow-left" size={18} />} /></Tooltip>
              <Tooltip withinDialog wrap label={t('Next template')}><IconButton variant="plain" className={styles.iconButton} disabled={videos.length < 2} onClick={() => step(1)} aria-label={t('Next template')} icon={<MotionIcon name="arrow-right" size={18} />} /></Tooltip>
            </div>
            <div className={styles.detailBody}>
              <h2 className="om-media-detail-title">{t(video.title)}</h2>
              <div className={styles.creator}>
                <span className="om-gallery-avatar" aria-hidden="true">{video.authorName.slice(0, 1).toUpperCase()}{video.avatar && <img src={video.avatar} alt="" referrerPolicy="no-referrer" />}</span>
                <div><strong>{video.author}</strong></div>
                <Tooltip withinDialog wrap label={t('Source')}><a className={styles.sourceLink} href={video.post} target="_blank" rel="noreferrer" onClick={() => track('view_source', { video: video.id })} aria-label={t('Source')}><MotionIcon name="arrow-up-right" size={18} /></a></Tooltip>
              </div>
              <section className={styles.reviewResources} aria-label={t('Video info')}>
                <a className={`om-text-link ${styles.repositoryLink}`} data-quiet href={video.post} target="_blank" rel="noreferrer" onClick={() => track('view_source', { video: video.id })}>{video.platform === 'x' ? <>{xMark}{t('View on X')}</> : <><MotionIcon name="arrow-up-right" size={16} />{t('View original')}</>}</a>
                <div className={styles.reviewResourceActions}>{motionDocuments[video.id] && <Tooltip withinDialog wrap label="motion.md" description={t('Download the shot and motion notes.')}>
                  <Button variant="plain" className={`om-text-link ${styles.repositoryLink}`} data-quiet disabled={downloading} onClick={() => void downloadMotion()}><MotionIcon name="download" size={17} />{t(downloading ? 'Downloading…' : 'Download motion.md')}</Button>
                </Tooltip>}</div>
              </section>
              <div className={styles.reviewOverview} aria-label={t('About this starting point')}>
                <section className={styles.reviewModule} aria-label={t('Video information')}>
                  <h3>{t('Video information')}</h3>
                  <dl className={`${styles.metadata} ${styles.reviewMetadata}`}>
                    <div><dt>{t('Video purpose')}</dt><dd><span className="om-badge">{t(video.category)}</span></dd></div>
                    <div><dt>{t('Motion style')}</dt><dd><span className="om-badge">{t(video.code ? 'Made in code' : 'Interactive recording')}</span></dd></div>
                    <div><dt>{t('Creation models')}</dt><dd><span className="om-badge">{title} {video.variant}</span></dd></div>
                    {video.platform === 'x' && <div><dt>{t('X popularity')}</dt><dd className="om-hub-video-views">{xMark}<RemixIcon name="eye-line" size={14} />{new Intl.NumberFormat(locale).format(video.views)}</dd></div>}
                  </dl>
                  {video.palette.length > 0 && <div className={styles.reviewColors}>
                    <span>{t('Reference colors')}</span>
                    <div className={styles.palette}>{video.palette.map(color => <Tooltip key={color} withinDialog wrap label={t('Copy color {color}', { color })}><Button variant="plain" className={styles.colorSwatch} style={{ backgroundColor: color }} aria-label={t('Copy color {color}', { color })} onClick={() => copyColor(color)} /></Tooltip>)}</div>
                  </div>}
                </section>
              </div>
              <section className={`${styles.instruction} ${styles.reviewCreation}`} aria-label={t('Template recreation instruction')}>
                <header><h3>{t('Template recreation instruction')}</h3>
                  <Popover key={video.id} container={dialog} align="end" openOnHover aria-label={t('After copying')} className={styles.handoffPopover} initialFocus={false}
                    trigger={<Button variant="plain" className={`om-text-link ${styles.handoffHelp}`} data-quiet>{t('Next steps')}<MotionIcon name="info" size={14} /></Button>}>
                    <div onKeyDown={event => event.stopPropagation()}><TemplateHandoffSteps template={{ id: video.id } as GalleryTemplate} /></div>
                  </Popover>
                </header>
                {manualCopy ? <textarea className={styles.manualCopy} readOnly rows={8} value={manualCopy} aria-label={t('Content to copy')} onFocus={event => event.currentTarget.select()} />
                  : <p className={expanded ? styles.fullInstruction : styles.shortInstruction}>{prompt}</p>}
                <Button variant="plain" className={`om-text-link ${styles.expandInstruction}`} data-quiet aria-expanded={expanded} onClick={() => { track('expand_instruction', { video: video.id }); setExpanded(!expanded); }}>{t(expanded ? 'Show less' : 'Show instruction')}<MotionIcon name="chevron-down" size={14} /></Button>
              </section>
              <section className={styles.productionNotes} aria-label={t('Production details')}>
                <h3>{t('Production details')}</h3>
                <div className={styles.productionText}><div><h4>{t('Visual style')}</h4><p>{locale === 'zh-CN' ? video.notes : video.notesEn ?? video.notes}</p></div></div>
              </section>
            </div>
            <div ref={footer} className={styles.reviewFooter} role="group" aria-label={t('Template actions')}>
              <div className={styles.handoffActions}>
                <div className={styles.recreateActions}>
                  <Button variant="ghost" className="om-button h-auto" data-primary onClick={() => void copy()}>{t('Recreate this template')}<MotionIcon name="sparkles" size={16} /></Button>
                  <Tooltip withinDialog wrap label={t('Contribute a template')} description={t('Copy contribution instructions for source, a preview and credits.')}>
                    <IconButton variant="plain" className={`om-button ${styles.submitTemplate}`} aria-label={t('Copy contribution brief')} onClick={() => void copy(true)} icon={<MotionIcon name="git-branch" size={17} />} />
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>
        {similar.length > 0 && <section className={`om-gallery-results ${styles.relatedShelf}`} aria-label={t('Similar videos')}>
          <header className={styles.relatedHeading}><h3>{t('Similar templates')}</h3><p>{t(video.category)}</p></header>
          <div className="om-gallery-masonry">{similar.map(item => <article key={item.id} className="om-gallery-card om-hub-video">
            <div className="om-gallery-card-media"><Button variant="plain" className="om-gallery-cover" style={{ aspectRatio: aspect(item) }} aria-label={t('Preview video {title}', { title: t(item.title) })} onClick={() => { track('open_detail', { video: item.id, position: similar.indexOf(item) }); onChange(item.id); }}>
              <div className="om-gallery-poster" data-loaded="true"><img src={item.poster} alt="" loading="lazy" referrerPolicy="no-referrer" /></div>
              <span className="om-gallery-card-shade" />
              {item.platform === 'x' && <span className="om-hub-video-heat">{xMark}<RemixIcon name="eye-line" size={12} />{compact.format(item.views)}</span>}
              <span className="om-gallery-card-bottom"><span className="om-gallery-avatar" aria-hidden="true">{item.authorName.slice(0, 1).toUpperCase()}{item.avatar && <img src={item.avatar} alt="" loading="lazy" referrerPolicy="no-referrer" />}</span><span className="om-gallery-card-caption"><strong>{t(item.title)}</strong><small>{item.author}</small></span></span>
            </Button></div>
          </article>)}</div>
        </section>}
      </div>
      <StudioToastViewport toasts={toasts} dismissToast={dismissToast} />
    </dialog>
  </div>;
}
