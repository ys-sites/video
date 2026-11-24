import { useEffect } from 'react';
import { useCompositionFps } from '../../utils/linkedClipPreferences';
import { isPreviewChanging } from '../previewReloading';
import { usePlayerStore } from '../store/playerStore';
import { timelineHoverTime, useTimelineHoverStore } from '../store/timelineHoverStore';
import { useTimelineContext } from './TimelineProvider';

/** Listens in capture phase, without taking pointer capture from edit/scrub gestures. */
export function TimelineHoverIndicator() {
  const { state } = useTimelineContext();
  const { scrollRef, pps, contentOrigin, effectiveDuration, isScrubbing,
    draggedClip, resizingClip, beatDragging, dropPreview, marqueeRect } = state.canvas;
  const fps = useCompositionFps();
  const isPlaying = usePlayerStore(s => s.isPlaying);
  const activeTool = usePlayerStore(s => s.activeTool);
  const blocked = isPlaying || activeTool !== 'select' || isScrubbing || !!draggedClip
    || !!resizingClip || beatDragging || !!dropPreview || !!marqueeRect || !state.timelineReady;
  const time = useTimelineHoverStore(s => s.time);
  const epoch = state.sessionEpoch;

  useEffect(() => {
    const viewport = scrollRef.current;
    const clear = () => {
      clearTimeout(delay);
      cancelAnimationFrame(raf);
      delay = 0; raf = 0; pending = null;
      useTimelineHoverStore.getState().setHover(null);
    };
    let delay = 0, raf = 0;
    let pending: number | null = null;
    clear();
    if (!viewport || blocked) return;
    const publish = () => {
      raf = 0;
      if (pending !== null) useTimelineHoverStore.getState().setHover(pending, epoch);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons || document.hidden || document.fullscreenElement
        || isPreviewChanging() || [...document.querySelectorAll('[role="menu"], [role="dialog"]')]
          .some(el => {
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.getClientRects().length > 0;
          })) return clear();
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('button, input, [role="slider"]') && !target.closest('[data-clip]')) return clear();
      const rect = viewport.getBoundingClientRect();
      if (event.clientX >= rect.left + viewport.clientWidth || event.clientY >= rect.top + viewport.clientHeight) return clear();
      pending = timelineHoverTime(event.clientX, rect.left, viewport.scrollLeft,
        contentOrigin, pps, effectiveDuration, fps);
      if (pending === null) return clear();
      if (useTimelineHoverStore.getState().time === null) {
        if (!delay) delay = window.setTimeout(() => { delay = 0; publish(); }, 120);
      } else if (!raf) raf = requestAnimationFrame(publish);
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') clear(); };
    viewport.addEventListener('pointermove', move, true);
    viewport.addEventListener('pointerleave', clear);
    viewport.addEventListener('scroll', clear, { passive: true });
    window.addEventListener('pointerdown', clear, true);
    window.addEventListener('blur', clear);
    window.addEventListener('resize', clear);
    window.addEventListener('keydown', key);
    document.addEventListener('visibilitychange', clear);
    document.addEventListener('fullscreenchange', clear);
    return () => {
      clear();
      viewport.removeEventListener('pointermove', move, true);
      viewport.removeEventListener('pointerleave', clear);
      viewport.removeEventListener('scroll', clear);
      window.removeEventListener('pointerdown', clear, true);
      window.removeEventListener('blur', clear);
      window.removeEventListener('resize', clear);
      window.removeEventListener('keydown', key);
      document.removeEventListener('visibilitychange', clear);
      document.removeEventListener('fullscreenchange', clear);
    };
  }, [scrollRef, pps, contentOrigin, effectiveDuration, fps, blocked, epoch]);

  return time === null || blocked ? null : <div aria-hidden="true"
    className="motion-timeline-hover-line" data-timeline-hover-time={time}
    style={{ left: contentOrigin + time * pps }} />;
}
