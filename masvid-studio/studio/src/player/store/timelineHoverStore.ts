import { create } from 'zustand';

/** Presentation only: never writes playback time, selection, history or project source. */
export const useTimelineHoverStore = create<{
  time: number | null;
  sessionEpoch: number;
  setHover: (time: number | null, sessionEpoch?: number) => void;
}>(set => ({
  time: null,
  sessionEpoch: -1,
  setHover: (time, sessionEpoch = -1) => set(state =>
    state.time === time && state.sessionEpoch === sessionEpoch ? state : { time, sessionEpoch }),
}));

export function timelineHoverTime(clientX: number, left: number, scrollLeft: number,
  contentOrigin: number, pps: number, duration: number, fps: number): number | null {
  if (![clientX, left, scrollLeft, contentOrigin, pps, duration, fps].every(Number.isFinite)
    || pps <= 0 || duration <= 0 || fps <= 0 || clientX < left + contentOrigin) return null;
  const time = (clientX - left + scrollLeft - contentOrigin) / pps;
  if (time < 0 || time > duration) return null;
  return timelineFrameTime(time, duration, fps);
}

/** Use the same frame for inspection and the ruler's committed seek. */
export function timelineFrameTime(time: number, duration: number, fps: number): number {
  return Math.min(Math.floor(Math.max(0, time) * fps + 1e-6), Math.max(0, Math.ceil(duration * fps) - 1)) / fps;
}
