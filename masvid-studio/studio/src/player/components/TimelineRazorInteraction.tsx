import { useCallback, useLayoutEffect, useRef, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { getTimelineContentXFromClient } from "./timelineLayout";

interface TimelineRazorInteractionOptions {
  active: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentOrigin: number;
  pixelsPerSecond: number;
  sessionEpoch?: number;
  onSplitAll?: (time: number) => void;
}

export function useTimelineRazorInteraction({
  active,
  scrollRef,
  contentOrigin,
  pixelsPerSecond,
  sessionEpoch,
  onSplitAll,
}: TimelineRazorInteractionOptions) {
  const razorGuideRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const sampleRef = useRef<{ clientX: number; target: EventTarget } | null>(null);

  const clearRazorGuide = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    sampleRef.current = null;
    if (razorGuideRef.current) razorGuideRef.current.style.visibility = "hidden";
  }, []);

  useLayoutEffect(() => {
    clearRazorGuide();
    return clearRazorGuide;
  }, [active, contentOrigin, pixelsPerSecond, sessionEpoch, clearRazorGuide]);

  const updateRazorGuide = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!active) return;
      sampleRef.current = { clientX: event.clientX, target: event.target };
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const sample = sampleRef.current;
        const scroll = scrollRef.current;
        const guide = razorGuideRef.current;
        if (!sample || !scroll || !guide) return;
        const clip = sample.target instanceof Element && sample.target.closest('[data-clip="true"]');
        if (!clip || !scroll.contains(clip)) {
          guide.style.visibility = "hidden";
          return;
        }
        const x = sample.clientX - scroll.getBoundingClientRect().left + scroll.scrollLeft;
        // Pointer-only feedback must not rerender the timeline provider and all
        // its consumers. Like the playhead, the guide owns a single DOM transform.
        guide.style.transform = `translateX(${x}px)`;
        guide.style.visibility = "visible";
      });
    },
    [active, scrollRef],
  );

  const splitAllAtPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const scroll = scrollRef.current;
      if (!active || !event.shiftKey || event.button !== 0 || !scroll) return false;
      const rect = scroll.getBoundingClientRect();
      const x = getTimelineContentXFromClient({
        clientX: event.clientX,
        rectLeft: rect.left,
        scrollLeft: scroll.scrollLeft,
        contentOrigin,
      });
      onSplitAll?.(Math.max(0, x / pixelsPerSecond));
      return true;
    },
    [active, contentOrigin, onSplitAll, pixelsPerSecond, scrollRef],
  );

  return { razorGuideRef, updateRazorGuide, clearRazorGuide, splitAllAtPointer };
}

export function TimelineRazorGuideOverlay({ guideRef }: { guideRef: RefObject<HTMLDivElement | null> }) {
  return (
    <div
      ref={guideRef}
      data-timeline-razor-guide=""
      aria-hidden="true"
      className="absolute top-0 bottom-0 pointer-events-none z-30"
      style={{ left: 0, visibility: "hidden", width: 1, background: "var(--timeline-danger)" }}
    />
  );
}
