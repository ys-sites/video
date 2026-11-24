// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline';
import { installTimelineMountEnv } from './timelineMountTestEnv';
import { usePlayerStore } from '../store/playerStore';
import { useTimelineHoverStore } from '../store/timelineHoverStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
installTimelineMountEnv();
let root: Root, viewport: HTMLElement, onSeek: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.useFakeTimers();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  usePlayerStore.setState({ duration: 10, currentTime: 2, isPlaying: false, activeTool: 'select',
    timelineReady: true, selectedElementId: 'card', elements: [{ id: 'card', label: 'Card', tag: 'div', start: 0, duration: 10, track: 0 }] });
  const host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); onSeek = vi.fn();
  // The model picker keeps a closed menu mounted; it must not disable inspection.
  const menu = document.createElement('div'); menu.setAttribute('role', 'menu'); menu.style.display = 'none'; document.body.append(menu);
  await act(async () => root.render(<Timeline onSeek={onSeek} />));
  viewport = host.querySelector('[data-timeline-scroll-viewport]')!;
  viewport.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 400 }) as DOMRect;
  Object.defineProperty(viewport, 'clientHeight', { value: 400 });
});
afterEach(() => { act(() => root.unmount()); vi.useRealTimers(); document.body.innerHTML = ''; });
const move = async (extra = {}) => { await act(async () => {
  viewport.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 15, pointerType: 'mouse', ...extra }));
  vi.advanceTimersByTime(150);
}); };
it('previews without seeking, and clears on leave', async () => {
  await move(); expect(useTimelineHoverStore.getState().time).not.toBeNull();
  expect(onSeek).not.toHaveBeenCalled(); expect(usePlayerStore.getState().currentTime).toBe(2);
  act(() => viewport.dispatchEvent(new PointerEvent('pointerleave')));
  expect(useTimelineHoverStore.getState().time).toBeNull();
});
it.each(['scroll', 'pointerdown'])('cancels a pending preview on %s', async event => {
  act(() => viewport.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 400, clientY: 15, pointerType: 'mouse' })));
  await act(async () => { viewport.dispatchEvent(new Event(event, { bubbles: true })); vi.advanceTimersByTime(150); });
  expect(useTimelineHoverStore.getState().time).toBeNull();
});
it('suppresses hover only for an actually visible menu', async () => {
  const menu = document.querySelector<HTMLElement>('[role=menu]')!;
  menu.style.display = 'block';
  menu.getClientRects = () => [{ width: 100, height: 100 }] as unknown as DOMRectList;
  await move(); expect(useTimelineHoverStore.getState().time).toBeNull();
});
it('ignores touch and drag moves, and closes when playback starts', async () => {
  await move({ pointerType: 'touch' }); expect(useTimelineHoverStore.getState().time).toBeNull();
  await move({ buttons: 1 }); expect(useTimelineHoverStore.getState().time).toBeNull();
  await move(); expect(useTimelineHoverStore.getState().time).not.toBeNull();
  act(() => usePlayerStore.setState({ isPlaying: true }));
  expect(useTimelineHoverStore.getState().time).toBeNull();
});
it('commits exactly the frame that was inspected on a ruler press', async () => {
  await move();
  const frame = useTimelineHoverStore.getState().time;
  act(() => viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 400, clientY: 15, button: 0, pointerId: 1 })));
  expect(onSeek).toHaveBeenLastCalledWith(frame);
  act(() => viewport.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 400, clientY: 15, button: 0, pointerId: 1 })));
});
