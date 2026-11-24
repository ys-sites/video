import { Children, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from 'open-design-ui/button';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';

type Props = {
  label: string;
  className?: string;
  viewportClassName: string;
  selection?: string | null;
  plainArrows?: boolean;
  children: ReactNode;
};

export function HorizontalRail({ label, className = '', viewportClassName, selection, plainArrows = false, children }: Props) {
  const { t } = useI18n();
  const id = useId();
  const count = Children.count(children);
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useLayoutEffect(() => {
    const list = viewport.current!;
    function measure() {
      const left = list.clientWidth > 0 && list.scrollLeft > 1;
      const right = list.clientWidth > 0 && list.scrollWidth - list.clientWidth - list.scrollLeft > 1;
      const focused = document.activeElement;
      if (focused?.getAttribute('aria-controls') === id &&
        ((focused.getAttribute('data-edge') === 'left' && !left) || (focused.getAttribute('data-edge') === 'right' && !right))) {
        list.focus({ preventScroll: true });
      }
      setEdges(old => old.left === left && old.right === right ? old : { left, right });
    }
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    // Category labels may change width after localization or catalog loading.
    if (list.firstElementChild) observer.observe(list.firstElementChild);
    list.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); list.removeEventListener('scroll', measure); };
  }, [id, count]);

  useLayoutEffect(() => {
    if (selection === undefined) return;
    const list = viewport.current!;
    const choice = list.querySelector('[aria-pressed="true"], [role="tab"][aria-selected="true"]');
    if (!choice || !list.clientWidth) return;
    const bounds = list.getBoundingClientRect(), target = choice.getBoundingClientRect();
    const padding = getComputedStyle(list);
    const left = bounds.left + (parseFloat(padding.scrollPaddingLeft) || 0);
    const right = bounds.right - (parseFloat(padding.scrollPaddingRight) || 0);
    if (target.left < left) list.scrollLeft += target.left - left;
    else if (target.right > right) list.scrollLeft += target.right - right;
  }, [selection]);

  function scroll(direction: number) {
    const list = viewport.current!;
    list.scrollBy({ left: direction * list.clientWidth * 0.8, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  const arrow = (edge: 'left' | 'right') => <Button type="button" variant={plainArrows ? 'plain' : 'secondary'}
    className={`${plainArrows ? 'om-nav-item' : 'om-button'} om-icon-button om-rail-arrow`} data-edge={edge}
    aria-controls={id} aria-label={t(edge === 'left' ? 'Previous' : 'Next') + ' · ' + t(label)} onClick={() => scroll(edge === 'left' ? -1 : 1)}>
    <RemixIcon name="arrow-right-s-line" mirrored={edge === 'left'} size={22} />
  </Button>;
  return <div className={'om-horizontal-rail ' + className} data-plain-arrows={plainArrows || undefined}>
    <div id={id} ref={viewport} className={'om-rail-viewport om-overflow-fade ' + viewportClassName} data-fade-start={edges.left || undefined} data-fade-end={edges.right || undefined} tabIndex={-1} role="group" aria-label={t(label)}>{children}</div>
    {edges.left && arrow('left')}
    {edges.right && arrow('right')}
  </div>;
}
