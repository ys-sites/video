import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import registry from 'open-design-ui/registry.json';
import { mountFeedbackLayer } from '../../../web/feedback-layer';
import { useI18n } from '../i18n/I18n';
import './componentInspector.css';

const outsideInspector = ':not(.odui-inspector, .odui-inspector *)';
const outsideComponent = ':not([data-odui-component], [data-odui-component] *)';
const groups = [
  ...registry.items.map(({ name, title }) => ({ title, native: false, selector: `[data-odui-component="${name}"]` })),
  { title: 'Native buttons', native: true, selector: 'button' + outsideComponent },
  { title: 'Native sliders', native: true, selector: 'input[type="range"]' + outsideComponent },
].map(group => ({ ...group, selector: group.selector + outsideInspector }));

function HighlightPanel() {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [counts, setCounts] = useState<number[]>([]);
  useLayoutEffect(() => {
    const count = () => groups.map(group => document.querySelectorAll(group.selector).length);
    let frame = 0;
    const observer = new MutationObserver(records => {
      if (frame || records.every(record => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest('.odui-inspector'))) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const next = count();
        setCounts(prev => next.every((n, i) => n === prev[i]) ? prev : next);
      });
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-odui-component', 'type'] });
    setCounts(count());
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []);
  return <section id="odui-inspector-panel" className="odui-inspector-panel">
    <p>{t('Select to outline mounted controls.')}</p>
    <style>{groups.filter(group => selected.includes(group.title)).map(group =>
      `${group.selector} { outline: 2px ${group.native ? 'dashed var(--motion-warning)' : 'solid var(--motion-accent)'} !important; outline-offset: 0 !important; }`
    ).join('\n')}</style>
    {groups.map(({ title, native }, i) => <Button key={title} type="button" variant="plain"
      className="odui-inspector-row" aria-pressed={selected.includes(title)}
      onClick={() => setSelected(prev => prev.includes(title) ? prev.filter(item => item !== title) : [...prev, title])}>
      <span className={native ? 'odui-swatch native' : 'odui-swatch'} aria-hidden="true" />
      {native ? t(title) : title}<span className="odui-count">{counts[i]}</span>
    </Button>)}
  </section>;
}

function move(layer: HTMLElement, left: number, top: number) {
  layer.style.left = `${Math.max(0, Math.min(left, window.innerWidth - layer.offsetWidth))}px`;
  layer.style.top = `${Math.max(0, Math.min(top, window.innerHeight - layer.offsetHeight))}px`;
  layer.style.right = 'auto';
}

function InspectorControls({ layer, onClose }: { layer: HTMLElement; onClose: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const moved = useRef(false);
  useLayoutEffect(() => {
    const fit = () => { if (layer.style.left) move(layer, layer.offsetLeft, layer.offsetTop); };
    const observer = new ResizeObserver(fit);
    observer.observe(layer);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [layer]);

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    const { left, top } = layer.getBoundingClientRect();
    drag.current = { x: event.clientX, y: event.clientY, left, top };
    moved.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function slide(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current || !event.isPrimary) return;
    const { x, y, left, top } = drag.current;
    const dx = event.clientX - x, dy = event.clientY - y;
    if (!moved.current && Math.hypot(dx, dy) < 4) return;
    moved.current = true;
    move(layer, left + dx, top + dy);
  }
  function keyMove(event: KeyboardEvent<HTMLButtonElement>) {
    const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    move(layer, layer.offsetLeft + delta[0], layer.offsetTop + delta[1]);
  }
  return <>
    <div className="odui-inspector-bar">
      <Button type="button" variant="ghost" className="odui-inspector-launcher"
        title={t('Drag or use arrow keys to move')} aria-expanded={open} aria-controls={open ? 'odui-inspector-panel' : undefined}
        onPointerDown={start} onPointerMove={slide} onLostPointerCapture={() => { drag.current = null; }}
        onKeyDown={keyMove} onClick={event => { if (!event.detail || !moved.current) setOpen(value => !value); }}>
        {t('UI inspector')}
      </Button>
      <IconButton type="button" size="sm" aria-label={t('Close')} icon={<span aria-hidden="true">×</span>} onClick={onClose} />
    </div>
    {open && <HighlightPanel />}
  </>;
}

export default function ComponentInspector() {
  const [closed, setClosed] = useState(false);
  const [layer] = useState(() => document.createElement('div'));
  useLayoutEffect(() => {
    if (closed) return;
    layer.className = 'odui-inspector';
    document.body.append(layer);
    const unmount = mountFeedbackLayer(layer);
    return () => { unmount(); layer.remove(); };
  }, [closed, layer]);
  return closed ? null : createPortal(<InspectorControls layer={layer} onClose={() => setClosed(true)} />, layer);
}
