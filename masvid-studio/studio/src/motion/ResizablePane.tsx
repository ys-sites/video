import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export function readPaneWidth(key: string, fallback: number, min: number, max: number) {
  try { const value = Number(localStorage.getItem(key)); return value > 0 && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback; } catch { return fallback; }
}
export function ResizablePane({ children, className, storageKey, initial, min, max, edge, label }: { children: ReactNode; className: string; storageKey: string; initial: number; min: number; max: number; edge: 'left' | 'right'; label: string }) {
  const [width, setWidth] = useState(() => readPaneWidth(storageKey, initial, min, max));
  const pane = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; width: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [geometry, setGeometry] = useState({ width, limit: max });
  useLayoutEffect(() => {
    const element = pane.current!, parent = element.parentElement!;
    const measure = () => {
      if (!parent.clientWidth || !element.getBoundingClientRect().width) return;
      // CSS distributes the preferred widths in one layout pass. Measurements
      // only describe the separator; they never feed back into pane sizing.
      const occupied = [...parent.children].filter(child => child !== element && child.classList.contains('om-resizable-pane'))
        .reduce((sum, child) => {
          const style = getComputedStyle(child);
          return sum + (style.display === 'none' ? 0 : style.flexShrink === '0' ? child.getBoundingClientRect().width : parseFloat(style.minWidth) || 0);
        }, 0);
      const next = { width: Math.round(element.getBoundingClientRect().width), limit: Math.max(min, Math.min(max, parent.clientWidth - occupied - 280)) };
      setGeometry(current => current.width === next.width && current.limit === next.limit ? current : next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(parent); observer.observe(element);
    for (const sibling of parent.children) if (sibling !== element && sibling.classList.contains('om-resizable-pane')) observer.observe(sibling);
    measure(); return () => observer.disconnect();
  }, [min, max]);
  const commit = (value: number) => { try { localStorage.setItem(storageKey, String(value)); } catch { /* Private browsing can disable storage. */ } };
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(geometry.limit, value)));
  const effectiveWidth = geometry.width;
  return <div ref={pane} className={`om-resizable-pane ${className}`} data-resizing={dragging} style={{ width, '--om-pane-min-width': `${min}px` } as CSSProperties}>
    {children}
    <div className="om-pane-resizer" data-edge={edge} role="separator" tabIndex={0} aria-label={label} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={geometry.limit} aria-valuenow={effectiveWidth}
      onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: e.pointerId, x: e.clientX, width: pane.current!.getBoundingClientRect().width, value: width }; setDragging(true); }}
      onPointerMove={e => { const d = drag.current; if (!d || d.id !== e.pointerId) return; d.value = clamp(d.width + (e.clientX - d.x) * (edge === 'right' ? 1 : -1)); setWidth(d.value); }}
      onPointerUp={e => { if (drag.current?.id !== e.pointerId) return; commit(drag.current.value); drag.current = null; setDragging(false); e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
      onDoubleClick={() => { setWidth(initial); commit(initial); }}
      onKeyDown={e => { let next = effectiveWidth; const step = e.shiftKey ? 48 : 16;
        if (e.key === 'Home') next = min; else if (e.key === 'End') next = geometry.limit;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') next += (e.key === 'ArrowRight' ? step : -step) * (edge === 'right' ? 1 : -1); else return;
        e.preventDefault(); next = clamp(next); setWidth(next); commit(next);
      }}><span /></div>
  </div>;
}
