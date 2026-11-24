import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { loadPlayerModule } from '../../player/components/Player';
import { usePlayerStore } from '../../player/store/playerStore';
import { useTimelineHoverStore } from '../../player/store/timelineHoverStore';
import { useCompositionFps } from '../../utils/linkedClipPreferences';
import { formatTime } from '../../player/lib/time';
import { useI18n } from '../../i18n/I18n';
import { Skeleton } from '../ui/Skeleton';
import { useNLEContext } from './NLEContext';

interface HoverPlayer extends HTMLElement {
  ready: boolean;
  pause: () => void;
  stopMedia: () => void;
  seek: (time: number) => void;
}

/** A separate, silent runtime. The editor's live iframe and playhead are never sought. */
function HoverFrame({ source, time, width, height }: { source: string; time: number; width: number; height: number }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<HoverPlayer | null>(null);
  const latestTime = useRef(time);
  latestTime.current = time;
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let disposed = false, failed = false;
    let cleanup: (() => void) | undefined;
    const fail = () => {
      failed = true; cleanup?.(); cleanup = undefined;
      if (!disposed) setStatus('error');
    };
    const deadline = setTimeout(fail, 10000);
    void loadPlayerModule().then(() => {
      if (disposed || failed || !host.current) return;
      const element = document.createElement('hyperframes-player') as HoverPlayer;
      player.current = element;
      element.setAttribute('muted', '');
      element.setAttribute('audio-locked', '');
      element.setAttribute('low-power-idle', '');
      element.setAttribute('assets-loading-ui', 'none');
      element.setAttribute('shader-capture-scale', '0.25');
      element.setAttribute('width', String(width));
      element.setAttribute('height', String(height));
      element.style.cssText = 'display:block;width:100%;height:100%;pointer-events:none';
      const ready = () => { element.pause(); element.seek(latestTime.current); };
      const painted = () => {
        ready(); clearTimeout(deadline);
        if (!disposed) setStatus('ready');
      };
      element.addEventListener('ready', ready);
      element.addEventListener('painted', painted);
      element.addEventListener('error', fail);
      element.setAttribute('src', source);
      host.current.append(element);
      cleanup = () => {
        element.removeEventListener('ready', ready);
        element.removeEventListener('painted', painted);
        element.removeEventListener('error', fail);
        element.pause(); element.stopMedia(); element.remove();
        player.current = null;
      };
    }).catch(fail);
    return () => { disposed = true; clearTimeout(deadline); cleanup?.(); };
  }, [source, width, height]);
  useEffect(() => { if (player.current?.ready) player.current.seek(time); }, [time]);
  return <div className="motion-timeline-hover-frame" style={{ aspectRatio: `${width} / ${height}` }} data-hover-preview-status={status}>
    <div ref={host} className="absolute inset-0" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }} />
    {status === 'loading' && <Skeleton className="absolute inset-0" />}
    {status === 'error' && <span>{t('Frame preview unavailable. Move away and try again.')}</span>}
  </div>;
}

export function TimelineHoverPreview() {
  const { t } = useI18n();
  const { iframeRef, timelineSessionEpoch, timelineDisabled, projectId, previewCompositionSize } = useNLEContext();
  const hover = useTimelineHoverStore();
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const revisions = usePlayerStore(s => s.thumbnailRevisions);
  const fps = useCompositionFps();
  const source = iframeRef.current?.getAttribute('src');
  if (hover.time === null || hover.sessionEpoch !== timelineSessionEpoch || timelineDisabled || isPlaying || !source) return null;
  const size = previewCompositionSize && [previewCompositionSize.width, previewCompositionSize.height].every(value => Number.isFinite(value) && value > 0)
    ? previewCompositionSize : { width: 1920, height: 1080 };
  const frame = Math.floor(hover.time * fps + 1e-6);
  return <div className="motion-timeline-hover-container"><aside className="motion-timeline-hover-preview" style={{ '--motion-hover-ratio': size.width / size.height } as CSSProperties} aria-label={t('Timeline frame preview')} data-testid="timeline-hover-preview" data-time={hover.time}>
    <HoverFrame key={`${projectId}:${source}:${size.width}:${size.height}:${JSON.stringify(revisions)}`} source={source} time={hover.time} {...size} />
    <div className="motion-timeline-hover-caption"><span>{formatTime(hover.time)} · {frame}f</span><span>{t('Click the ruler to jump')}</span></div>
  </aside></div>;
}
