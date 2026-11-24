import { describe, expect, it } from 'vitest';
import { timelineHoverTime, useTimelineHoverStore } from './timelineHoverStore';
import { usePlayerStore } from './playerStore';

describe('timeline hover coordinates', () => {
  it('accounts for the viewport, sticky labels, scroll and zoom', () => {
    expect(timelineHoverTime(420, 100, 500, 120, 100, 30, 30)).toBe(7);
    expect(timelineHoverTime(420, 100, 500, 120, 200, 30, 30)).toBe(3.5);
    expect(timelineHoverTime(200, 100, 500, 120, 100, 30, 30)).toBeNull();
  });
  it('keeps the final preview inside the last frame and ignores blank timeline space', () => {
    expect(timelineHoverTime(300, 0, 0, 0, 100, 3, 30)).toBe(89 / 30);
    expect(timelineHoverTime(301, 0, 0, 0, 100, 3, 30)).toBeNull();
    expect(timelineHoverTime(110, 0, 0, 0, 100, 3, 24)).toBe(26 / 24);
    expect(timelineHoverTime(100, 0, 0, 0, 0, 3, 24)).toBeNull();
  });
  it('never changes committed playback or selection', () => {
    usePlayerStore.setState({ currentTime: 2, selectedElementId: 'a' });
    useTimelineHoverStore.getState().setHover(8, 1);
    useTimelineHoverStore.getState().setHover(null);
    expect(usePlayerStore.getState()).toMatchObject({ currentTime: 2, selectedElementId: 'a' });
  });
});
