import { useEffect, useRef, type RefObject } from 'react';

const targets = '.om-skills-intro, .om-skills-toolbar, .om-skill-gallery-card';
type Snapshot = { width: number; scrollTop: number; rects: Map<HTMLElement, DOMRect> };

/** FLIP the visible discovery items when the detail panel changes their layout. */
export function useSkillLayoutMotion(main: RefObject<HTMLDivElement | null>, instant: boolean) {
  const snapshot = useRef<Snapshot | null>(null);
  const animations = useRef(new Set<Animation>());
  const instantRef = useRef(instant);
  instantRef.current = instant;
  const cancel = () => {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  };
  const capture = () => {
    const element = main.current;
    snapshot.current = null;
    if (!element || instantRef.current || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      cancel();
      return;
    }
    const width = element.getBoundingClientRect().width;
    if (!width) return;
    // Capture current visual positions, including any animation interrupted by a new click.
    snapshot.current = {
      width, scrollTop: element.scrollTop,
      rects: new Map([...element.querySelectorAll<HTMLElement>(targets)].map(node => [node, node.getBoundingClientRect()])),
    };
  };
  useEffect(() => {
    const element = main.current;
    if (!element || typeof element.animate !== 'function') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reset = () => { snapshot.current = null; cancel(); };
    const observer = new ResizeObserver(() => {
      const before = snapshot.current;
      if (!before) return;
      const viewport = element.getBoundingClientRect();
      if (Math.abs(viewport.width - before.width) < 1) return;
      snapshot.current = null;
      cancel();
      if (!viewport.width || instantRef.current || reducedMotion.matches) return;
      const style = getComputedStyle(element);
      const time = style.getPropertyValue('--motion-duration-normal').trim();
      const duration = Number.parseFloat(time) * (time.endsWith('ms') ? 1 : 1000);
      const easing = style.getPropertyValue('--motion-ease-out').trim();
      if (!Number.isFinite(duration) || !easing) return;
      const scrollDelta = element.scrollTop - before.scrollTop;
      // Batch all geometry reads before starting compositor-only animations.
      const moves = [...before.rects].filter(([node]) => node.isConnected).map(([node, from]) => ({ node, from, to: node.getBoundingClientRect() }));
      for (const { node, from, to } of moves) {
        if (!from.width || !from.height || !to.width || !to.height) continue;
        const oldTop = from.top - scrollDelta;
        const wasVisible = oldTop < viewport.bottom && oldTop + from.height > viewport.top;
        const isVisible = to.top < viewport.bottom && to.bottom > viewport.top;
        if (!wasVisible && !isVisible) continue;
        const x = from.left - to.left, y = oldTop - to.top;
        // Text-only headers move without stretching; cards also interpolate their size.
        const card = node.classList.contains('om-skill-gallery-card');
        const scaleX = card ? from.width / to.width : 1, scaleY = card ? from.height / to.height : 1;
        if (Math.abs(x) < 1 && Math.abs(y) < 1 && Math.abs(scaleX - 1) < .001 && Math.abs(scaleY - 1) < .001) continue;
        const animation = node.animate([
          { transform: `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`, transformOrigin: '0 0' },
          { transform: 'none', transformOrigin: '0 0' },
        ], { duration, easing });
        animations.current.add(animation);
        animation.addEventListener('finish', () => animations.current.delete(animation), { once: true });
      }
    });
    observer.observe(element);
    reducedMotion.addEventListener('change', reset);
    return () => { observer.disconnect(); reducedMotion.removeEventListener('change', reset); reset(); };
  }, [main]);
  return capture;
}
