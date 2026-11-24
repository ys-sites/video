/** Keep tab-wheel input out of Dockview's competing strip and scrollbar handlers. */
export function installTabScroll(root: HTMLElement): () => void {
  const onWheel = (event: WheelEvent) => {
    const list = event.target instanceof Element
      ? event.target.closest<HTMLElement>(".dv-tabs-container")
      : null;
    if (!list || !root.contains(list)) return;

    // Dockview's strip uses deltaX || deltaY, while its parent scrollbar uses deltaY.
    // At an edge the strip lets the event bubble, so diagonal trackpad input can
    // reverse direction. One owner handles the entire gesture, including its edges.
    event.stopPropagation();
    if (event.ctrlKey) return; // Preserve browser pinch-to-zoom.
    const max = list.scrollWidth - list.clientWidth;
    if (max <= 0) return;
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) return;
    const unit = event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? list.clientWidth
      : event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? parseFloat(getComputedStyle(list).lineHeight) || list.clientHeight
        : 1;
    event.preventDefault();
    list.scrollLeft = Math.max(0, Math.min(max, list.scrollLeft + delta * unit));
  };
  root.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => root.removeEventListener("wheel", onWheel, true);
}
