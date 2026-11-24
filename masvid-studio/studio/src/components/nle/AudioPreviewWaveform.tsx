import { useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "../../i18n/I18n";
import { RemixIcon } from "../../icons/RemixIcons";
import { acquireAudioPreviewAnalyser, AUDIO_PREVIEW_BARS } from "./audioPreviewAnalyser";

/** Mirrored live spectrum from the preview's media, with no duplicate download or playback clock. */
export function AudioPreviewWaveform({ media, playing }: {
  media: RefObject<HTMLMediaElement | null>; playing: boolean;
}) {
  const { t } = useI18n();
  const [failed, setFailed] = useState(false);
  const analyser = useRef<ReturnType<typeof acquireAudioPreviewAnalyser> | null>(null);
  const bars = useRef<Array<SVGRectElement | null>>([]);
  const displayed = useRef(new Float32Array(AUDIO_PREVIEW_BARS));
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    let lease: ReturnType<typeof acquireAudioPreviewAnalyser>;
    try {
      lease = acquireAudioPreviewAnalyser(element, () => setFailed(true));
      analyser.current = lease;
    } catch {
      setFailed(true);
      return;
    }
    const resume = () => { void lease.resume(); };
    const dialog = element.closest('[role="dialog"], .om-asset-audio-player');
    element.addEventListener("play", resume);
    dialog?.addEventListener("pointerdown", resume);
    dialog?.addEventListener("keydown", resume);
    resume();
    return () => {
      element.removeEventListener("play", resume);
      dialog?.removeEventListener("pointerdown", resume);
      dialog?.removeEventListener("keydown", resume);
      analyser.current = null;
      lease.release();
    };
  }, [media]);

  useEffect(() => {
    if (!playing || failed) return;
    let frame = 0;
    let previousTime: number | undefined;
    const draw = (now: number) => {
      const elapsed = previousTime === undefined ? 1 / 60 : Math.min(0.05, Math.max(0, (now - previousTime) / 1000));
      previousTime = now;
      const levels = analyser.current?.read();
      if (levels) levels.forEach((level, index) => {
        const previous = displayed.current[index];
        const response = level > previous ? 0.045 : 0.18;
        const next = previous + (level - previous) * (1 - Math.exp(-elapsed / response));
        displayed.current[index] = next;
        const height = Math.max(2, next * 104);
        bars.current[index]?.setAttribute("height", String(height));
        bars.current[index]?.setAttribute("y", String((120 - height) / 2));
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [playing, failed]);

  return <div className="motion-audio-preview-waveform">
    {failed ? <div role="status" className="flex flex-col items-center gap-2 text-step-12">
      <RemixIcon name="music-2-line" size={28} /><span>{t("waveform unavailable")}</span>
    </div> : <div className="motion-audio-preview-track">
      <svg viewBox="0 0 800 120" preserveAspectRatio="none" role="img" aria-label={t("Waveform")}>
        {Array.from({ length: AUDIO_PREVIEW_BARS }, (_, index) =>
          <rect key={index} ref={node => { bars.current[index] = node; }} x={(index + 0.38) * 800 / AUDIO_PREVIEW_BARS}
            y={59} width={800 / AUDIO_PREVIEW_BARS * 0.24} height={2} rx={1} fill="currentColor" />)}
      </svg>
    </div>}
  </div>;
}
