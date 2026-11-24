import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { ReviewMark, ReviewPoint } from '../../../shared/review-comments';
import { usePreviewOverlayContext } from '../components/editor/PreviewOverlayProvider';
import { useStudioPlaybackContext, useStudioShellContext } from '../contexts/StudioContext';
import { useDockLayoutStore } from '../components/dock/dockLayoutStore';
import { usePlayerStore } from '../player/store/playerStore';
import { useI18n } from '../i18n/I18n';
import { useReviewPresentationStore } from './reviewPresentationStore';
import { ReviewAnnotationGraphic } from './ReviewAnnotationGraphic';
import { reviewFrameMatches, useReviewMarkupStore } from './reviewMarkupStore';

export function ReviewAnnotationOverlay() {
  const active = useReviewMarkupStore(state => Boolean(state.draft || state.displayed));
  const visible = useDockLayoutStore(state => state.visiblePanels.has('comments') && !state.collapsedZones?.includes('right'));
  const drafting = useReviewMarkupStore(state => Boolean(state.draft));
  return active && (drafting || visible) ? <ActiveReviewAnnotationOverlay /> : null;
}

function ActiveReviewAnnotationOverlay() {
  const { t } = useI18n();
  const { projectId, activeCompPath, showToast } = useStudioShellContext();
  const { compositionLoading, isPlaying } = useStudioPlaybackContext();
  const { state: { compositionRect } } = usePreviewOverlayContext();
  const currentTime = usePlayerStore(state => state.currentTime);
  const visible = useDockLayoutStore(state => state.visiblePanels.has('comments') && !state.collapsedZones?.includes('right'));
  const draft = useReviewMarkupStore(state => state.draft);
  const displayed = useReviewMarkupStore(state => state.displayed);
  const active = draft?.projectId === projectId ? draft : null;
  const record = active ?? (displayed?.projectId === projectId ? displayed : null);
  const annotation = active?.annotation ?? displayed?.anchor.annotation;
  const shown = Boolean((active || visible) && record && annotation && !active?.stale && !compositionLoading && compositionRect.width > 0
    && reviewFrameMatches(record.anchor, activeCompPath ?? 'index.html', currentTime, isPlaying));
  const [pending, setPending] = useState<ReviewMark | null>(null);
  const stroke = useRef<{ pointerId: number; mark: ReviewMark } | null>(null);
  const cancel = () => { stroke.current = null; setPending(null); useReviewMarkupStore.getState().patch({ inProgress: false }); };
  useEffect(() => { if (!shown || active?.locked) cancel(); }, [shown, active?.locked]);
  useEffect(() => () => { useReviewMarkupStore.getState().patch({ inProgress: false }); }, []);
  if (!shown || !record || !annotation) return null;
  function point(event: PointerEvent<SVGSVGElement>): ReviewPoint {
    const rect = event.currentTarget.getBoundingClientRect();
    const clamp = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 100000) / 100000;
    return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
  }
  function add(mark: ReviewMark) {
    try { useReviewMarkupStore.getState().add(mark); useReviewPresentationStore.getState().compose(mark.points.at(-1)!); }
    catch { showToast(t('Annotation limit reached. Undo or clear some marks.'), 'error'); }
  }
  function update(event: PointerEvent<SVGSVGElement>) {
    const current = stroke.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = point(event);
    const points = current.mark.points;
    if (current.mark.kind === 'pen') {
      if (points.length < 1000 && Math.hypot(next.x - points.at(-1)!.x, next.y - points.at(-1)!.y) > 0.001) points.push(next);
    } else points[1] = next;
    setPending({ ...current.mark, points: [...points] });
  }
  return <svg aria-label={t('Annotation canvas')} tabIndex={active ? 0 : undefined} data-review-annotation-canvas data-studio-keyboard-owner
    className={`absolute z-50 touch-none ${active && !active.locked ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none'}`}
    style={{ left: compositionRect.left, top: compositionRect.top, width: compositionRect.width, height: compositionRect.height }}
    viewBox={`0 0 ${annotation.width} ${annotation.height}`} preserveAspectRatio="none"
    onPointerDown={event => {
      if (!active || active.locked || event.button !== 0 || stroke.current) return;
      event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
      useReviewPresentationStore.setState({ composerOpen: false });
      if (active.tool === 'text') {
        if (!active.label.trim()) { showToast(t('Enter a label, then click the frame to place it.'), 'info'); return; }
        add({ kind: 'text', points: [point(event)], text: active.label.trim() }); return;
      }
      const start = point(event);
      stroke.current = { pointerId: event.pointerId, mark: { kind: active.tool, points: active.tool === 'pen' ? [start] : [start, start] } };
      useReviewMarkupStore.getState().patch({ inProgress: true });
      event.currentTarget.setPointerCapture(event.pointerId); setPending(stroke.current.mark);
    }}
    onPointerMove={event => { event.stopPropagation(); update(event); }}
    onPointerUp={event => {
      if (stroke.current?.pointerId !== event.pointerId) return;
      event.stopPropagation(); update(event);
      const mark = stroke.current.mark, [first] = mark.points, last = mark.points.at(-1)!;
      if (mark.points.length > 1 && (mark.kind === 'pen' || Math.hypot(last.x - first.x, last.y - first.y) > 0.006)) add(mark);
      event.currentTarget.releasePointerCapture(event.pointerId); cancel();
    }} onPointerCancel={cancel} onLostPointerCapture={cancel}
    onKeyDown={event => {
      event.stopPropagation();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault(); cancel(); const store = useReviewMarkupStore.getState(); if (event.shiftKey) store.redo(); else store.undo();
      } else if (event.key === 'Escape') { event.preventDefault(); cancel(); useReviewPresentationStore.getState().request(projectId, 'cancel'); }
    }}>
    <ReviewAnnotationGraphic annotation={{ ...annotation, marks: pending ? [...annotation.marks, pending] : annotation.marks }} />
  </svg>;
}
