import { IconButton } from 'open-design-ui/icon-button';
import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { brandCatalogFile } from '../../../shared/brand-catalog';
import { Skeleton } from '../components/ui/Skeleton';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

export function BrandKitLivePreview({ id, poster, enabled }: { id: string; poster?: string; enabled: boolean }) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [inView, setInView] = useState(true);
  const [playing, setPlaying] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPlaying(!preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (state !== 'loading') return;
    const receive = (event: MessageEvent) => {
      if (frame.current && event.source === frame.current.contentWindow && event.data?.type === 'openmotion:brand-preview-ready')
        setState('ready');
    };
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      clearTimeout(timeout);
      if (!document.hidden) timeout = setTimeout(() => setState('failed'), 8000);
    };
    window.addEventListener('message', receive);
    document.addEventListener('visibilitychange', schedule);
    schedule();
    return () => {
      window.removeEventListener('message', receive);
      document.removeEventListener('visibilitychange', schedule);
      clearTimeout(timeout);
    };
  }, [state, attempt]);

  useEffect(() => {
    if (state === 'failed' || typeof IntersectionObserver === 'undefined' || !frame.current) return;
    const observer = new IntersectionObserver(([entry]) => setInView(Boolean(entry?.isIntersecting)));
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, [state, attempt]);

  useEffect(() => {
    if (state === 'ready')
      frame.current?.contentWindow?.postMessage({ type: 'openmotion:brand-playback', playing: playing && enabled && inView }, '*');
  }, [state, playing, enabled, inView]);

  const label = t(playing ? 'Pause' : 'Play');
  return <div className="om-media-detail-media om-brand-video" aria-busy={state === 'loading'}>
    {poster && <img className="om-brand-preview-poster" src={poster} alt="" />}
    {state !== 'failed' && <iframe key={attempt} ref={frame} className="om-gallery-animation"
      src={brandCatalogFile(id, 'showcase') + '&detail=1'}
      title={t('Brand Kit preview')} sandbox="allow-scripts" tabIndex={-1} hidden={state !== 'ready'}
      onError={() => setState('failed')} />}
    {state === 'ready' && <div className="om-brand-preview-transport">
      <IconButton variant="ghost" type="button" className="om-button om-icon-button" onClick={() => setPlaying(value => !value)} aria-label={label} title={label} icon={<RemixIcon name={playing ? 'pause-line' : 'play-line'} size={18} />} />
    </div>}
    {state === 'loading' && <div className="om-media-detail-loading" role="status"><span>{t('Loading preview…')}</span><Skeleton className="om-media-detail-progress" /></div>}
    {state === 'failed' && <div className="om-media-detail-failure" role="status"><span>{t('Preview unavailable. Try again.')}</span>
      <Button variant="plain" onClick={() => { setState('loading'); setAttempt(value => value + 1); }}>{t('Retry')}</Button>
    </div>}
  </div>;
}
