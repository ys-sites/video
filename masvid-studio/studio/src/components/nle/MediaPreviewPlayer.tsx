import { IconButton } from "open-design-ui/icon-button";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useI18n } from "../../i18n/I18n";
import { RemixIcon } from "../../icons/RemixIcons";
import { Tooltip } from "../ui";
import { VolumeControl } from "../../player/components/VolumeControl";
import { SpeedMenu } from "../../player/components/SpeedMenu";
import { formatTime } from "../../player/lib/time";
import { usePlayerStore } from "../../player/store/playerStore";
import { AudioPreviewWaveform } from "./AudioPreviewWaveform";
import "./audioPreview.css";

export function MediaPreviewPlayer({ url, kind, name, autoPlay = true, waveform, onError }: {
  url: string; kind: "video" | "audio" | "image"; name: string; autoPlay?: boolean;
  waveform?: readonly number[]; onError?: () => void;
}) {
  const audioMode = kind === "audio";
  const { t } = useI18n();
  const media = useRef<HTMLMediaElement | null>(null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const [volume, setVolume] = useState(() => usePlayerStore.getState().audioVolume);
  const [muted, setMuted] = useState(() => usePlayerStore.getState().audioMuted);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  useEffect(() => {
    if (!media.current) return;
    media.current.volume = volume;
    media.current.muted = muted;
    media.current.playbackRate = rate;
  }, [volume, muted, rate]);
  const toggle = () => {
    if (!media.current) return;
    if (media.current.paused) void media.current.play().catch(() => setPlaying(false));
    else media.current.pause();
  };
  const events = {
    onLoadedMetadata: () => setDuration(Number.isFinite(media.current?.duration) ? media.current!.duration : 0),
    onTimeUpdate: () => setTime(media.current?.currentTime ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: () => { setFailed(true); onError?.(); },
  };
  const seek = <input type="range" min={0} max={duration} step={waveform ? 0.1 : "any"} value={Math.min(time, duration)} disabled={!duration || failed}
    aria-label={t("Seek preview")} aria-valuetext={formatTime(time)} data-studio-control="seek-preview" className="w-full"
    style={{ "--preview-progress": `${duration ? time / duration * 100 : 0}%` } as CSSProperties}
    onChange={event => {
      if (!media.current) return;
      media.current.currentTime = event.currentTarget.valueAsNumber;
      setTime(media.current.currentTime);
    }} />;
  return <>
    <div className={`${audioMode ? "motion-audio-preview-surface " : ""}mx-3 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[var(--motion-inset)]`}>
      {failed ? <p role="alert" className="text-step-12 text-text-2">{t("Preview failed to load")}</p>
        : kind === "image" ? <img src={url} alt={name} onError={() => setFailed(true)} className="h-full w-full object-contain" />
        : kind === "video" ? <video ref={node => { media.current = node; }} src={url} autoPlay={autoPlay} playsInline muted={muted} loop={loop} disablePictureInPicture aria-label={name} className="h-full w-full object-contain" {...events} />
        : <audio preload="metadata" ref={node => { media.current = node; }} src={url} autoPlay={autoPlay} muted={muted} loop={loop} aria-label={name} {...events} />}
      {!failed && audioMode && (waveform ? <div className="motion-waveform-seek">
        <svg viewBox={`0 0 ${waveform.length * 5} 100`} preserveAspectRatio="none" aria-hidden="true">
          {waveform.map((height, index) => <rect key={index} x={index * 5} y={(100 - height) / 2} width={3} height={height} rx={1.5}
            data-played={duration > 0 && index / waveform.length < time / duration} />)}
        </svg>{seek}
      </div> : <AudioPreviewWaveform media={media} playing={playing} />)}
    </div>
    {kind !== "image" ? <div className={`${audioMode ? "motion-audio-preview-controls " : ""}motion-player-controls motion-player-responsive shrink-0 px-3 pb-2`}>
      {!waveform && seek}
      <div className={audioMode ? "motion-player-control-row motion-player-control-row-lg" : "motion-player-control-row"}>
        <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-text-2">{formatTime(time)} / {formatTime(duration)}</span>
        <Tooltip label={t(playing ? "Pause" : "Play")}><IconButton variant="plain" type="button" aria-label={t(playing ? "Pause" : "Play")} onClick={toggle} disabled={failed}
          className={`${audioMode ? "motion-audio-preview-play " : ""}flex h-7 w-8 items-center justify-center justify-self-center rounded-md hover:bg-hover disabled:opacity-30`} icon={<RemixIcon name={playing ? "pause-fill" : "play-fill"} size={20} />} /></Tooltip>
        <div className="motion-player-secondary flex min-w-0 items-center justify-self-end">
          <VolumeControl audioVolume={volume} audioMuted={muted} setAudioVolume={setVolume} setAudioMuted={setMuted} disabled={failed} />
          <span className="flex items-center gap-[inherit]">
            <SpeedMenu playbackRate={rate} setPlaybackRate={setRate} disabled={failed} />
            <Tooltip label={t(loop ? "Disable loop playback" : "Enable loop playback")}><IconButton variant="plain" type="button" aria-label={t(loop ? "Disable loop playback" : "Enable loop playback")} aria-pressed={loop} onClick={() => setLoop(!loop)} disabled={failed}
              className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-hover" icon={<RemixIcon name="repeat-line" size={16} />} /></Tooltip>
          </span>
        </div>
      </div>
    </div> : <div className="h-3 shrink-0" />}
  </>;
}
