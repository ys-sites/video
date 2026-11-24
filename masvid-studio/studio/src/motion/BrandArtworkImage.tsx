import { useEffect, useRef, type ComponentPropsWithoutRef } from 'react';

// Website artwork can wait on remote hosts even though its URL is local.
// Keep browser connections free for detail navigation, playback and downloads,
// and isolate fast favicons from slower cover downloads.
type ArtworkChannel = 'cover' | 'favicon';
const queues: Record<ArtworkChannel, { max: number; inFlight: number; waiting: Set<() => void> }> = {
  cover: { max: 6, inFlight: 0, waiting: new Set() },
  favicon: { max: 6, inFlight: 0, waiting: new Set() },
};
const visibility = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

function drain(channel: ArtworkChannel) {
  const queue = queues[channel];
  while (queue.inFlight < queue.max && queue.waiting.size) {
    const start = queue.waiting.values().next().value!;
    queue.waiting.delete(start);
    start();
  }
}

function observeVisibility(node: Element, onChange: (visible: boolean) => void) {
  if (typeof IntersectionObserver === 'undefined') { onChange(true); return () => {}; }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) visibility.get(entry.target)?.(entry.isIntersecting);
  }, { rootMargin: '240px' });
  visibility.set(node, onChange);
  observer.observe(node);
  return () => {
    visibility.delete(node);
    observer?.unobserve(node);
    if (!visibility.size) { observer?.disconnect(); observer = undefined; }
  };
}

export function BrandArtworkImage({ src, channel = 'cover', onLoad, onError, ...props }: ComponentPropsWithoutRef<'img'> & { src: string; channel?: ArtworkChannel }) {
  const image = useRef<HTMLImageElement>(null);
  const finish = useRef<() => void>(() => {});
  useEffect(() => {
    const node = image.current;
    if (!node) return;
    const queue = queues[channel];
    let active = false, started = false;
    let stop = () => {};
    const release = () => {
      queue.waiting.delete(start);
      if (active) { active = false; queue.inFlight--; drain(channel); }
    };
    const start = () => {
      started = true;
      active = true;
      queue.inFlight++;
      stop();
      node.src = src;
    };
    finish.current = release;
    stop = observeVisibility(node, visible => {
      if (started) return;
      if (visible) { queue.waiting.add(start); drain(channel); }
      else queue.waiting.delete(start);
    });
    return () => { stop(); release(); node.removeAttribute('src'); };
  }, [src, channel]);
  return <img {...props} ref={image} data-artwork-src={src} decoding="async" fetchPriority="low"
    onLoad={event => { finish.current(); onLoad?.(event); }}
    onError={event => { finish.current(); onError?.(event); }} />;
}
