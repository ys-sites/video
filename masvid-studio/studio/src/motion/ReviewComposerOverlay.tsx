import { Button } from 'open-design-ui/button';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePreviewOverlayContext } from '../components/editor/PreviewOverlayProvider';
import { IconButton } from '../components/ui';
import { useStudioShellContext } from '../contexts/StudioContext';
import { RemixIcon } from '../icons/RemixIcons';
import { useI18n } from '../i18n/I18n';
import { usePlayerStore } from '../player/store/playerStore';
import { reviewFrameMatches } from './reviewMarkupStore';
import { useReviewPresentationStore } from './reviewPresentationStore';

/** Canvas-relative UI only. The absolute host cannot participate in player layout. */
export function ReviewComposerOverlay() {
  const { t } = useI18n();
  const { projectId, activeCompPath, setActiveCompPath } = useStudioShellContext();
  const { state: { compositionRect, iframeRef } } = usePreviewOverlayContext();
  const { mode, drafting, busy, composerOpen, point, frame } = useReviewPresentationStore();
  const time = usePlayerStore(state => state.currentTime), playing = usePlayerStore(state => state.isPlaying);
  const layer = useRef<HTMLDivElement>(null), slot = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, cardWidth: 320, cardHeight: 180 });
  const store = useReviewPresentationStore.getState();
  const setHost = useCallback((node: HTMLDivElement | null) => { slot.current = node; useReviewPresentationStore.getState().setPlayerHost(node); }, []);
  const atFrame = Boolean(frame && reviewFrameMatches(frame, activeCompPath ?? 'index.html', time, playing));
  useLayoutEffect(() => {
    const observer = new ResizeObserver(() => {
      const bounds = layer.current?.getBoundingClientRect(), card = slot.current?.getBoundingClientRect();
      if (bounds && card) setSize(previous => {
        const next = { width: bounds.width, height: bounds.height, cardWidth: card.width, cardHeight: card.height };
        return Object.keys(next).every(key => next[key as keyof typeof next] === previous[key as keyof typeof next]) ? previous : next;
      });
    });
    if (layer.current) observer.observe(layer.current);
    if (slot.current) observer.observe(slot.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { if (mode === 'comment' && drafting && !composerOpen && !busy) canvas.current?.focus(); }, [mode, drafting, composerOpen, busy]);
  const x = compositionRect.left + point.x * compositionRect.width;
  const y = compositionRect.top + point.y * compositionRect.height;
  const clamp = (n: number, max: number) => Math.max(8, Math.min(n, max - 8));
  const left = clamp(x + 20 + size.cardWidth <= size.width ? x + 20 : x - size.cardWidth - 20, size.width - size.cardWidth);
  const top = clamp(y >= size.cardHeight + 20 ? y - size.cardHeight - 20 : y + 20, size.height - size.cardHeight);
  const cancel = () => store.request(projectId, 'cancel');
  const place = (clientX: number, clientY: number) => {
    const rect = canvas.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height || busy) return;
    const iframe = iframeRef.current, bounds = iframe?.getBoundingClientRect();
    const target = iframe && bounds?.width ? iframe.contentDocument?.elementFromPoint(
      (clientX - bounds.left) * iframe.clientWidth / bounds.width,
      (clientY - bounds.top) * iframe.clientHeight / bounds.height,
    ) ?? null : null;
    store.place({ x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)) }, target);
  };
  return <div ref={layer} className="pointer-events-none absolute inset-0 z-60" data-review-overlay data-studio-keyboard-owner>
    {drafting && mode === 'comment' && atFrame && <div ref={canvas} role="button" tabIndex={0} aria-label={t('Click the frame to comment')} data-review-comment-canvas
      className="pointer-events-auto absolute cursor-crosshair outline-hidden"
      style={{ left: compositionRect.left, top: compositionRect.top, width: compositionRect.width, height: compositionRect.height }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); place(event.clientX, event.clientY); }}
      onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') cancel(); if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); place(rect.left + rect.width / 2, rect.top + rect.height / 2); } }} />}
    {drafting && !composerOpen && <div className="motion-review-hint absolute left-1/2 top-2 flex max-w-full -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1 text-step-11" role="status">
      {atFrame ? <span className="truncate">{t(mode === 'annotate' ? 'Draw on the frame. Release to comment.' : 'Click the frame to comment')}</span>
        : <Button variant="plain" className="pointer-events-auto truncate" onClick={() => { if (!frame) return; usePlayerStore.getState().requestPlayback(false); setActiveCompPath(frame.compositionPath); usePlayerStore.getState().requestSeek(frame.time ?? 0); }}>{t('Return to annotated frame')}</Button>}
      <IconButton className="pointer-events-auto shrink-0" size="sm" aria-label={t('Cancel')} disabled={busy} icon={<RemixIcon name="close-line" size={14} />} onClick={cancel} />
    </div>}
    {drafting && composerOpen && atFrame && <svg className="absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
      <path className="om-review-annotation-outline" strokeWidth={3} fill="none" d={`M${x},${y} L${Math.max(left + 12, Math.min(x, left + size.cardWidth - 12))},${top > y ? top : top + size.cardHeight}`} />
      <path className="om-review-annotation-ink" strokeWidth={1} fill="none" d={`M${x},${y} L${Math.max(left + 12, Math.min(x, left + size.cardWidth - 12))},${top > y ? top : top + size.cardHeight}`} />
      <circle className="motion-review-pin" cx={x} cy={y} r={5} />
    </svg>}
    <div ref={setHost} data-review-composer-overlay
      className="pointer-events-auto absolute" style={{ left, top, width: 'min(320px, calc(100% - 16px))', maxHeight: Math.max(0, size.height - 16) }}
      onPointerDown={event => event.stopPropagation()} />
  </div>;
}
