// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { FULLSCREEN_UNAVAILABLE, togglePreviewFullscreen } from './previewFullscreen';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
it('targets only the preview and uses the browser exit operation', async () => {
  const target = document.createElement('div'); target.setAttribute('data-studio-fullscreen-target', ''); document.body.append(target);
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  const enter = vi.fn().mockResolvedValue(undefined), exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(target, 'requestFullscreen', { configurable: true, value: enter });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  await togglePreviewFullscreen(); expect(enter).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: target });
  await togglePreviewFullscreen(); expect(exit).toHaveBeenCalledOnce();
});
it('handles unsupported or rejected browser permission without an unhandled rejection', async () => {
  const target = document.createElement('div'), feedback = vi.fn();
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: false });
  await togglePreviewFullscreen(target, feedback); expect(feedback).toHaveBeenCalledWith(FULLSCREEN_UNAVAILABLE, 'error');
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
  Object.defineProperty(target, 'requestFullscreen', { configurable: true, value: vi.fn().mockRejectedValue(new Error('Permissions policy')) });
  await togglePreviewFullscreen(target, feedback); expect(feedback).toHaveBeenCalledTimes(2);
});
