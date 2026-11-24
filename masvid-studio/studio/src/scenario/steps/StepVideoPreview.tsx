import { Button } from 'open-design-ui/button';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/I18n';

export function StepVideoPreview({ src, active, label }: { src: string; active: boolean; label: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!active) el.pause();
  }, [active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pauseIfHidden = () => {
      if (document.hidden) el.pause();
    };
    document.addEventListener('visibilitychange', pauseIfHidden);
    let io: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        entries => {
          if (!entries.some(entry => entry.isIntersecting)) {
            el.pause();
          }
        },
        { threshold: 0.1 },
      );
      io.observe(el);
    }
    return () => {
      el.pause();
      document.removeEventListener('visibilitychange', pauseIfHidden);
      io?.disconnect();
    };
  }, [src, failed]);

  if (failed) {
    return (
      <div className="om-step-inline-error" role="status">
        <span>{t('Video preview unavailable.')}</span>
        <Button variant="ghost" size="sm" onClick={() => setFailed(false)}>{t('Retry')}</Button>
      </div>
    );
  }
  return (
    <video
      ref={ref}
      className="om-step-video-player"
      src={src}
      controls
      playsInline
      aria-label={label}
      preload="metadata"
      onError={() => setFailed(true)}
    />
  );
}
