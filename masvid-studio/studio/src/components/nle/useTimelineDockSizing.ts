import { useCallback, useLayoutEffect, useRef } from "react";
import { useMvpEditor } from "../../motion/StudioHost";
import { useDockLayoutStore } from "../dock/dockLayoutStore";

/** Track rows and wrapped controls both contribute to the preferred panel height. */
export function useTimelineDockSizing() {
  const mvp = useMvpEditor();
  const controller = useDockLayoutStore(state => state.controller);
  const toolbar = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const content = useRef(128);
  const measure = useCallback(() => {
    if (mvp) controller?.setTimelineContentHeight?.(content.current + (toolbar.current?.offsetHeight ?? 0) + (footer.current?.offsetHeight ?? 0) + 8);
  }, [controller, mvp]);
  useLayoutEffect(() => {
    const observer = new ResizeObserver(measure);
    if (toolbar.current) observer.observe(toolbar.current);
    if (footer.current) observer.observe(footer.current);
    measure();
    return () => observer.disconnect();
  }, [measure]);
  const onContentHeightChange = useCallback((height: number) => {
    content.current = height;
    measure();
  }, [measure]);
  return { toolbar, footer, onContentHeightChange };
}
