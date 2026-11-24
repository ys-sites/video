// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TimelineHoverPreview } from './TimelineHoverPreview';
import { useTimelineHoverStore } from '../../player/store/timelineHoverStore';
import { usePlayerStore } from '../../player/store/playerStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const context = vi.hoisted(() => ({ iframeRef: { current: null as HTMLIFrameElement | null },
  projectId: 'p', timelineSessionEpoch: 4, timelineDisabled: false,
  previewCompositionSize: null as { width: number; height: number } | null }));
vi.mock('./NLEContext', () => ({ useNLEContext: () => context }));
vi.mock('../../player/components/Player', () => ({ loadPlayerModule: () => Promise.resolve() }));
class FakePlayer extends HTMLElement {
  ready = true;
  pause = vi.fn(); stopMedia = vi.fn(); seek = vi.fn();
}
customElements.define('hyperframes-player', FakePlayer);
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.useFakeTimers();
  context.iframeRef.current = document.createElement('iframe');
  context.iframeRef.current.src = '/api/projects/p/preview';
  context.previewCompositionSize = null;
  usePlayerStore.setState({ isPlaying: false, currentTime: 2 });
  useTimelineHoverStore.getState().setHover(5, 4);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
it.each([[1080, 1920], [1080, 1080], [1440, 1080], [1080, 1440], [1920, 1080]])('uses the composition dimensions %s × %s for the frame and runtime', async (width, height) => {
  context.previewCompositionSize = { width, height };
  await act(async () => root.render(<TimelineHoverPreview />));
  const player = host.querySelector('hyperframes-player')!;
  expect(player.getAttribute('width')).toBe(String(width));
  expect(player.getAttribute('height')).toBe(String(height));
  expect((host.querySelector('.motion-timeline-hover-frame') as HTMLElement).style.aspectRatio).toBe(`${width} / ${height}`);
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); document.body.innerHTML = ''; });
it('seeks only the silent secondary runtime, coalesces boot to the latest time and releases on dismissal', async () => {
  await act(async () => root.render(<TimelineHoverPreview />));
  const player = host.querySelector('hyperframes-player') as FakePlayer;
  expect(player.hasAttribute('muted')).toBe(true); expect(player.hasAttribute('audio-locked')).toBe(true);
  act(() => useTimelineHoverStore.getState().setHover(8, 4));
  act(() => player.dispatchEvent(new Event('painted')));
  expect(player.seek).toHaveBeenLastCalledWith(8);
  expect(usePlayerStore.getState().currentTime).toBe(2);
  expect(host.querySelector('[data-hover-preview-status=ready]')).not.toBeNull();
  act(() => useTimelineHoverStore.getState().setHover(null));
  expect(player.stopMedia).toHaveBeenCalled(); expect(player.isConnected).toBe(false);
});
it('bounds a slow load and releases the runtime with a recoverable reserved error', async () => {
  await act(async () => root.render(<TimelineHoverPreview />));
  const player = host.querySelector('hyperframes-player') as FakePlayer;
  act(() => vi.advanceTimersByTime(10000));
  expect(host.querySelector('[data-hover-preview-status=error]')).not.toBeNull();
  expect(player.stopMedia).toHaveBeenCalled(); expect(player.isConnected).toBe(false);
});
it('does not mount previews from another project session or while playing', async () => {
  useTimelineHoverStore.getState().setHover(5, 3);
  await act(async () => root.render(<TimelineHoverPreview />));
  expect(host.querySelector('hyperframes-player')).toBeNull();
  act(() => { usePlayerStore.setState({ isPlaying: true }); useTimelineHoverStore.getState().setHover(5, 4); });
  expect(host.querySelector('hyperframes-player')).toBeNull();
});
