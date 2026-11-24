import { useEffect, useMemo, useRef, useState } from 'react';
import { Skeleton } from '../components/ui/Skeleton';
import { CoverPlaceholder } from '../components/ui/CoverPlaceholder';

const VIRTUAL_WIDTH = 960;
const VIRTUAL_HEIGHT = 600;

function withThumbParam(src: string): string {
  if (!src.startsWith('/motion-api/design/')) return src;
  return src.includes('?') ? `${src}&thumb=1` : `${src}?thumb=1`;
}

/**
 * Viewport-aware, edge-to-edge scaled sandboxed iframe thumbnail for Design Studio templates and projects.
 * - Unmounts off-screen iframes so WebGL/rAF contexts are freed immediately when scrolling away.
 * - Appends ?thumb=1 so heavy WebGL/rAF animations paint their initial frame and freeze at 0% GPU until hovered.
 */
export function ScaledPreviewThumb({
  src,
  title,
  badge,
  brandedFallback = false,
}: {
  src: string;
  title: string;
  badge?: string;
  brandedFallback?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [scale, setScale] = useState(0.32);

  const waitForReady = brandedFallback && src?.startsWith('/motion-api/design/catalog/templates/');
  const thumbSrc = useMemo(() => src ? withThumbParam(src) + (waitForReady ? '&thumbReady=1' : '') : '', [src, waitForReady]);

  useEffect(() => {
    if (!waitForReady) return;
    const receiveReady = (event: MessageEvent) => {
      if (event.source === iframeRef.current?.contentWindow && event.data?.type === 'om:thumb-ready') setLoaded(true);
    };
    window.addEventListener('message', receiveReady);
    return () => window.removeEventListener('message', receiveReady);
  }, [waitForReady]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const width = el.getBoundingClientRect().width;
      if (width > 0) setScale(width / VIRTUAL_WIDTH);
    };
    update();
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    }
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return () => ro?.disconnect();
    }
    const io = new IntersectionObserver(entries => {
      const inView = entries.some(e => e.isIntersecting);
      setVisible(inView);
      if (!inView) setLoaded(false);
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => { io.disconnect(); ro?.disconnect(); };
  }, []);

  const setPlaying = (play: boolean) => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'om:thumb-play', play }, '*');
    } catch { /* ignore */ }
  };

  return (
    <div
      ref={hostRef}
      className="om-design-card-thumb"
      data-loaded={loaded}
      onMouseEnter={() => setPlaying(true)}
      onMouseLeave={() => setPlaying(false)}
    >
      {!loaded && (brandedFallback ? <CoverPlaceholder fill /> : <Skeleton className="om-design-thumb-skeleton" />)}
      {visible && thumbSrc && (
        <iframe
          ref={iframeRef}
          title={title}
          src={thumbSrc}
          loading="lazy"
          sandbox="allow-scripts"
          tabIndex={-1}
          onLoad={waitForReady ? undefined : () => setLoaded(true)}
          style={{
            width: VIRTUAL_WIDTH,
            height: VIRTUAL_HEIGHT,
            transform: `scale(${scale})`,
            opacity: loaded ? 1 : 0,
          }}
        />
      )}
      {badge && <span className="om-design-thumb-badge">{badge}</span>}
    </div>
  );
}
