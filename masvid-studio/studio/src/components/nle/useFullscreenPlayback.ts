import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { usePlayerStore } from '../../player/store/playerStore';

const subscribe = (changed: () => void) => {
  document.addEventListener('fullscreenchange', changed);
  return () => document.removeEventListener('fullscreenchange', changed);
};
const snapshot = () => document.fullscreenElement;

/** Keep the live player mounted, preserve focus, and reveal transport only when useful. */
export function useFullscreenPlayback(container: RefObject<HTMLDivElement | null>) {
  const element = useSyncExternalStore(subscribe, snapshot);
  const fullscreen = Boolean(element && element === container.current);
  const playing = usePlayerStore(state => state.isPlaying);
  const [hidden, setHidden] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!fullscreen) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    container.current?.querySelector<HTMLButtonElement>('[data-fullscreen-playback-surface]')?.focus({ preventScroll: true });
    return () => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); };
  }, [fullscreen, container]);
  useEffect(() => {
    const host = container.current;
    setHidden(false);
    if (!fullscreen || !host || !playing) return;
    let timer: ReturnType<typeof setTimeout>;
    const hide = () => {
      const controls = host.querySelector('[data-preview-transport]');
      if (controls?.matches(':hover') || controls?.querySelector(':focus-visible') || host.querySelector('[role=menu], [role=dialog]')) {
        timer = setTimeout(hide, 2000); return;
      }
      setHidden(true);
    };
    const reveal = () => { setHidden(false); clearTimeout(timer); timer = setTimeout(hide, 2000); };
    for (const event of ['pointermove', 'pointerdown', 'keydown', 'focusin']) host.addEventListener(event, reveal);
    reveal();
    return () => { clearTimeout(timer); for (const event of ['pointermove', 'pointerdown', 'keydown', 'focusin']) host.removeEventListener(event, reveal); };
  }, [container, fullscreen, playing]);
  return { fullscreen, controlsHidden: fullscreen && playing && hidden };
}
