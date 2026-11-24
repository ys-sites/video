import { usePlayerStore } from "../store/playerStore";
import { formatTime } from "../lib/time";

/** Subscribe separately so playback does not redraw the ruler's ticks. */
export function TimelineTimecode() {
  const time = usePlayerStore(state => state.currentTime);
  const hundredths = Math.max(0, Math.round(time * 100));
  return <time className="motion-timeline-timecode">{formatTime(hundredths / 100)}.{String(hundredths % 100).padStart(2, "0")}</time>;
}
