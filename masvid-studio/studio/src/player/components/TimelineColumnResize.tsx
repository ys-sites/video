import { useEffect, useRef } from 'react';
import { useI18n } from '../../i18n/I18n';
import { useTimelineContext } from './TimelineProvider';
import { MVP_LABEL_COL_W } from './timelineLayout';

/** A viewport-fixed hit target, independent of horizontal and vertical track scroll. */
export function TimelineColumnResize() {
  const { actions } = useTimelineContext();
  const column = actions.labelColumn;
  const { t } = useI18n();
  const gesture = useRef<{ x: number; width: number; next: number; id: number } | null>(null);
  const frame = useRef<number | null>(null);
  const cancelFrame = () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  useEffect(() => cancelFrame, []);
  if (!column) return null;
  return <div role="separator" tabIndex={0} aria-orientation="vertical"
    aria-label={t('Resize track controls')} aria-valuemin={column.min} aria-valuemax={column.max} aria-valuenow={Math.round(column.width)}
    className="motion-track-column-resize" style={{ left: column.width - 4 }}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      gesture.current = { x: event.clientX, width: column.width, next: column.width, id: event.pointerId };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      drag.next = drag.width + event.clientX - drag.x;
      if (frame.current === null) frame.current = requestAnimationFrame(() => {
        frame.current = null;
        if (gesture.current) column.resize(gesture.current.next);
      });
    }}
    onPointerUp={event => {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      cancelFrame(); gesture.current = null;
      column.resize(drag.width + event.clientX - drag.x, true);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onLostPointerCapture={() => { cancelFrame(); if (gesture.current) column.resize(gesture.current.width); gesture.current = null; }}
    onPointerCancel={() => { cancelFrame(); if (gesture.current) column.resize(gesture.current.width); gesture.current = null; }}
    onDoubleClick={() => column.resize(MVP_LABEL_COL_W, true)}
    onKeyDown={event => {
      if (event.key === 'Escape' && gesture.current) {
        cancelFrame(); column.resize(gesture.current.width); gesture.current = null; event.stopPropagation(); return;
      }
      const next = event.key === 'ArrowLeft' ? column.width - (event.shiftKey ? 10 : 1)
        : event.key === 'ArrowRight' ? column.width + (event.shiftKey ? 10 : 1)
        : event.key === 'Home' ? column.min : event.key === 'End' ? column.max : null;
      if (next === null) return;
      event.preventDefault(); event.stopPropagation(); column.resize(next, true);
    }} />;
}
