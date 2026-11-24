export const FULLSCREEN_UNAVAILABLE = 'Fullscreen is unavailable in this window. Open Studio in a browser and try again.';

/** A user gesture must call this directly; do not await a save or open a second player first. */
export async function togglePreviewFullscreen(
  target: HTMLElement | null = document.querySelector('[data-studio-fullscreen-target]'),
  onError?: (message: string, tone: 'error') => void,
) {
  if (!target) return;
  try {
    if (document.fullscreenElement === target) await document.exitFullscreen();
    else {
      if (!target.requestFullscreen || document.fullscreenEnabled === false) throw new Error(FULLSCREEN_UNAVAILABLE);
      await target.requestFullscreen();
    }
  } catch { onError?.(FULLSCREEN_UNAVAILABLE, 'error'); }
}
