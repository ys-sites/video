import { Button } from 'open-design-ui/button';
import { IconButton } from 'open-design-ui/icon-button';
import { Slider } from 'open-design-ui/slider';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetVersion, LibraryAsset } from '../../../shared/asset-library';
import { Menu, MenuRadioGroup, MenuRadioItem } from '../components/ui/Menu';
import { Tooltip } from '../components/ui/Tooltip';
import { useI18n } from '../i18n/I18n';
import { RemixIcon } from '../icons/RemixIcons';
import { formatDuration } from '../components/sidebar/assetHelpers';
import { formatTime } from '../player/lib/time';

export interface SoundPlayableTrack {
  id: string;
  kind: 'asset' | 'demo' | 'voice';
  title: string;
  subtitle: string;
  src: string;
  /** Bundled demo files load through a blob URL so seeking works on static hosts without byte ranges. */
  blobSource?: boolean;
  waveform: readonly number[];
  durationHint?: number;
  prompt?: string;
  downloadUrl?: string;
  asset?: LibraryAsset;
  version?: AssetVersion;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function inferredAudioMime(src: string): string | undefined {
  const clean = src.split(/[?#]/, 1)[0].toLowerCase();
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  if (clean.endsWith('.m4a') || clean.endsWith('.mp4')) return 'audio/mp4';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.ogg')) return 'audio/ogg';
  return undefined;
}

export function useSoundPlayer({
  active,
  playlist,
  onVoiceError,
  onPlayStart,
}: {
  active: boolean;
  playlist: readonly SoundPlayableTrack[];
  onVoiceError?: () => void;
  onPlayStart?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoplayRef = useRef(false);
  const pendingSeekRatioRef = useRef<number | null>(null);
  const onVoiceErrorRef = useRef(onVoiceError);
  const onPlayStartRef = useRef(onPlayStart);
  onVoiceErrorRef.current = onVoiceError;
  onPlayStartRef.current = onPlayStart;
  const [track, setTrack] = useState<SoundPlayableTrack | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState('');
  const [loadNonce, setLoadNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  // Sync audio element volume, mute and speed whenever the user adjusts controls or switches tracks.
  // Short inline voice previews always play at normal 1x speed.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const isVoiceSample = track?.kind === 'voice';
    el.volume = volume;
    el.muted = muted;
    el.playbackRate = isVoiceSample ? 1 : rate;
  }, [volume, muted, rate, resolvedSrc, track?.kind]);

  // Resolve blob URL for bundled demo tracks; stream library assets directly.
  useEffect(() => {
    if (!track) {
      setResolvedSrc('');
      setLoading(false);
      setError(false);
      return;
    }
    setError(false);
    setCurrentTime(0);
    setDuration(track.durationHint ?? 0);
    if (!track.blobSource) {
      setResolvedSrc(track.src);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResolvedSrc('');
    setLoading(true);
    fetch(track.src, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(response => {
        if (!response.ok) throw new Error('Audio preview unavailable');
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        const audioMime = inferredAudioMime(track.src);
        const normalized = (!blob.type || blob.type === 'text/plain' || blob.type === 'application/octet-stream') && audioMime
          ? new Blob([blob], { type: audioMime })
          : blob;
        objectUrl = URL.createObjectURL(normalized);
        setResolvedSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setPlaying(false);
          if (track.kind === 'voice') {
            setTrack(null);
            onVoiceErrorRef.current?.();
          } else {
            setError(true);
          }
        }
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [track?.id, track?.src, track?.blobSource, track?.kind, loadNonce]);

  // Trigger playback cleanly once the resolved source is mounted on the <audio> element.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !resolvedSrc || !autoplayRef.current) return;
    autoplayRef.current = false;
    void el.play().catch(() => setPlaying(false));
  }, [resolvedSrc]);

  // Pause immediately when leaving Sound Studio or switching browser tabs.
  useEffect(() => {
    const pause = () => {
      if (!active || document.hidden) audioRef.current?.pause();
    };
    pause();
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [active]);

  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const pause = useCallback(() => {
    autoplayRef.current = false;
    audioRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el || !resolvedSrc || error) return;
    if (el.paused) {
      onPlayStartRef.current?.();
      if (el.ended) {
        el.currentTime = 0;
        setCurrentTime(0);
      }
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, [resolvedSrc, error]);

  const seekTo = useCallback((seconds: number) => {
    const el = audioRef.current;
    const clamped = Math.max(0, Math.min(duration || seconds, seconds));
    setCurrentTime(clamped);
    if (el && Number.isFinite(el.duration) && el.duration > 0) {
      el.currentTime = Math.max(0, Math.min(el.duration, clamped));
    }
  }, [duration]);

  const playTrack = useCallback((next: SoundPlayableTrack, seekRatio?: number) => {
    if (track?.id === next.id) {
      const el = audioRef.current;
      if (seekRatio !== undefined && el) {
        const targetDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (duration || next.durationHint || 0);
        if (targetDuration > 0) {
          const target = Math.max(0, Math.min(targetDuration, seekRatio * targetDuration));
          setCurrentTime(target);
          if (Number.isFinite(el.duration) && el.duration > 0) el.currentTime = target;
          else pendingSeekRatioRef.current = seekRatio;
        }
        if (el.paused && resolvedSrc) {
          onPlayStartRef.current?.();
          void el.play().catch(() => setPlaying(false));
        }
        return;
      }
      if (error) {
        autoplayRef.current = true;
        setLoadNonce(n => n + 1);
        return;
      }
      togglePlay();
      return;
    }
    audioRef.current?.pause();
    onPlayStartRef.current?.();
    pendingSeekRatioRef.current = seekRatio ?? null;
    autoplayRef.current = true;
    setPlaying(false);
    setTrack(next);
  }, [track?.id, duration, error, resolvedSrc, togglePlay]);

  const currentIndex = track ? playlist.findIndex(item => item.id === track.id) : -1;
  const canStepPrev = currentIndex > 0;
  const canStepNext = currentIndex >= 0 && currentIndex < playlist.length - 1;

  const stepTrack = useCallback((delta: -1 | 1) => {
    if (currentIndex < 0) return;
    const next = playlist[currentIndex + delta];
    if (next) playTrack(next);
  }, [currentIndex, playlist, playTrack]);

  const retryLoad = useCallback(() => {
    if (!track) return;
    autoplayRef.current = true;
    setError(false);
    setLoadNonce(n => n + 1);
  }, [track]);

  const close = useCallback(() => {
    audioRef.current?.pause();
    autoplayRef.current = false;
    pendingSeekRatioRef.current = null;
    setPlaying(false);
    setTrack(null);
  }, []);

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;
    const loadedDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : (track?.durationHint ?? 0);
    setDuration(loadedDuration);
    if (pendingSeekRatioRef.current !== null && loadedDuration > 0) {
      const target = Math.max(0, Math.min(loadedDuration, pendingSeekRatioRef.current * loadedDuration));
      pendingSeekRatioRef.current = null;
      el.currentTime = target;
      setCurrentTime(target);
    }
  };

  return {
    audioRef,
    track,
    resolvedSrc,
    loading,
    error,
    playing,
    currentTime,
    duration,
    volume,
    muted,
    rate,
    canStepPrev,
    canStepNext,
    setVolume: (next: number) => {
      setVolume(next);
      if (muted && next > 0) setMuted(false);
    },
    setMuted,
    setRate,
    playTrack,
    pause,
    togglePlay,
    seekTo,
    stepTrack,
    retryLoad,
    close,
    audioEvents: {
      onLoadedMetadata: handleLoadedMetadata,
      onTimeUpdate: () => setCurrentTime(audioRef.current?.currentTime ?? 0),
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => {
        const el = audioRef.current;
        if (el && Number.isFinite(el.duration) && el.duration > 0) {
          setCurrentTime(el.duration);
        }
        setPlaying(false);
        if (track?.kind === 'voice') setTrack(null);
      },
      onError: () => {
        setPlaying(false);
        setLoading(false);
        if (track?.kind === 'voice') {
          setTrack(null);
          onVoiceErrorRef.current?.();
        } else {
          setError(true);
        }
      },
    },
  };
}

export type SoundPlayerController = ReturnType<typeof useSoundPlayer>;

export function SoundPlayerDock({
  player,
  onLocateTrack,
}: {
  player: SoundPlayerController;
  onLocateTrack?: (track: SoundPlayableTrack) => void;
}) {
  const { t } = useI18n();
  const [speedOpen, setSpeedOpen] = useState(false);
  const { track, resolvedSrc, loading, error, playing, currentTime, duration, volume, muted, rate } = player;
  const [smoothTime, setSmoothTime] = useState(currentTime);

  useEffect(() => {
    setSmoothTime(currentTime);
  }, [currentTime, track?.id]);

  // Smooth 60fps scrubber & timecode progression isolated inside the dock without re-rendering the track list.
  useEffect(() => {
    if (!playing || !track || track.kind === 'voice') return;
    let rafId = 0;
    const tick = () => {
      const el = player.audioRef.current;
      if (el && Number.isFinite(el.currentTime)) setSmoothTime(el.currentTime);
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [playing, track?.id, track?.kind, player.audioRef]);

  if (!track) return null;

  const audioElement = resolvedSrc ? (
    <audio
      ref={player.audioRef}
      src={resolvedSrc}
      preload="metadata"
      aria-label={track.title}
      {...player.audioEvents}
    />
  ) : null;

  // Short voice auditions play inline on the voice card without summoning the full bottom dock.
  if (track.kind === 'voice') {
    return audioElement ? <span className="om-sound-voice-audio-host" hidden>{audioElement}</span> : null;
  }

  const effectiveDuration = duration > 0 ? duration : (track.durationHint ?? 0);
  const silent = muted || volume === 0;
  const volumePercent = silent ? 0 : Math.round(volume * 100);
  const canLocate = track.kind === 'asset' && Boolean(onLocateTrack);

  const metaInner = (
    <>
      <span className="om-sound-dock-emblem" data-playing={playing || undefined} aria-hidden="true">
        {playing ? (
          <span className="om-creation-wave"><i /><i /><i /><i /><i /></span>
        ) : (
          <RemixIcon name={track.kind === 'demo' ? 'music-2-line' : 'voiceprint-line'} size={15} />
        )}
      </span>
      <span className="om-sound-dock-copy">
        <span className="om-sound-dock-title-row">
          <strong>{track.title}</strong>
          {track.kind === 'demo' && <span className="om-badge">{t('Sample')}</span>}
        </span>
        {track.subtitle && <small className="om-sound-dock-subtitle">{track.subtitle}</small>}
      </span>
    </>
  );

  return (
    <section className="om-sound-player-dock" aria-label={t('Audio player')}>
      {audioElement}

      <div className="om-sound-dock-meta">
        {canLocate ? (
          <Tooltip label={t('Locate in list')}>
            <Button
              type="button"
              variant="plain"
              className="om-sound-dock-locate"
              aria-label={t('Locate {name}', { name: track.title })}
              onClick={() => onLocateTrack?.(track)}
            >
              {metaInner}
            </Button>
          </Tooltip>
        ) : (
          <Tooltip label={track.title} wrap>
            <div className="om-sound-dock-static-meta">{metaInner}</div>
          </Tooltip>
        )}
      </div>

      <div className="om-sound-dock-center">
        {error ? (
          <div className="om-sound-dock-error" role="status">
            <RemixIcon name="error-warning-line" size={15} />
            <span>{t('Preview failed to load')}</span>
            <Button type="button" variant="plain" className="om-nav-item" onClick={player.retryLoad}>
              <RemixIcon name="refresh-line" size={14} />
              {t('Retry')}
            </Button>
          </div>
        ) : (
          <>
            <div className="om-sound-dock-transport">
              <Tooltip label={t('Previous track')}>
                <IconButton
                  type="button"
                  variant="plain"
                  className="om-nav-item om-sound-dock-icon"
                  disabled={!player.canStepPrev}
                  aria-label={t('Previous track')}
                  onClick={() => player.stepTrack(-1)}
                  icon={<RemixIcon name="skip-left-fill" size={15} />}
                />
              </Tooltip>
              <Tooltip label={t(playing ? 'Pause' : 'Play')}>
                <IconButton
                  type="button"
                  variant="plain"
                  className="om-sound-dock-play hf-od-primary"
                  disabled={loading || !resolvedSrc}
                  aria-label={t(playing ? 'Pause' : 'Play')}
                  onClick={player.togglePlay}
                  icon={<RemixIcon name={loading ? 'loader-4-line' : playing ? 'pause-fill' : 'play-fill'} size={16} className={loading ? 'animate-spin motion-reduce:animate-none' : !playing ? 'om-sound-play-glyph' : undefined} />}
                />
              </Tooltip>
              <Tooltip label={t('Next track')}>
                <IconButton
                  type="button"
                  variant="plain"
                  className="om-nav-item om-sound-dock-icon"
                  disabled={!player.canStepNext}
                  aria-label={t('Next track')}
                  onClick={() => player.stepTrack(1)}
                  icon={<RemixIcon name="skip-right-fill" size={15} />}
                />
              </Tooltip>
            </div>

            <div className="om-sound-dock-scrub">
              <span className="om-sound-timecode om-sound-timecode-current" data-playing={playing || undefined}>{formatTime(smoothTime)}</span>
              <Slider
                label={t('Seek preview')}
                min={0}
                max={effectiveDuration > 0 ? effectiveDuration : 1}
                step={0.05}
                value={effectiveDuration > 0 ? Math.min(smoothTime, effectiveDuration) : 0}
                disabled={loading || !resolvedSrc || effectiveDuration <= 0}
                onPreview={v => { setSmoothTime(v); player.seekTo(v); }}
                onCommit={v => { setSmoothTime(v); player.seekTo(v); }}
                className="om-sound-dock-slider"
              />
              <span className="om-sound-timecode">{effectiveDuration > 0 ? (formatDuration(effectiveDuration) || formatTime(effectiveDuration)) : '--:--'}</span>
            </div>
          </>
        )}
      </div>

      <div className="om-sound-dock-tools">
        <Menu
          open={speedOpen}
          onOpenChange={setSpeedOpen}
          side="top"
          align="end"
          aria-label={t('Playback speed options')}
          className="om-menu-panel om-sound-speed-menu"
          trigger={
            <Button
              type="button"
              variant="plain"
              className="om-nav-item om-sound-speed-trigger"
              aria-label={t('Playback speed')}
            >
              {rate}x
            </Button>
          }
        >
          <MenuRadioGroup
            value={rate}
            onValueChange={value => {
              player.setRate(Number(value));
              setSpeedOpen(false);
            }}
          >
            {PLAYBACK_RATES.map(option => (
              <MenuRadioItem key={option} value={option} className="om-sound-speed-option">
                {option}x
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </Menu>

        <div className="om-sound-dock-volume">
          <Tooltip label={t(silent ? 'Unmute audio' : 'Mute audio')}>
            <IconButton
              type="button"
              variant="plain"
              className="om-nav-item om-sound-dock-icon"
              aria-label={t(silent ? 'Unmute audio' : 'Mute audio')}
              aria-pressed={silent}
              onClick={() => {
                if (silent && volume === 0) player.setVolume(1);
                player.setMuted(!silent);
              }}
              icon={<RemixIcon name={silent ? 'volume-mute-line' : volume >= 0.5 ? 'volume-up-line' : 'volume-down-line'} size={15} />}
            />
          </Tooltip>
          <Slider
            label={t('Preview volume')}
            min={0}
            max={100}
            step={1}
            value={volumePercent}
            onPreview={v => player.setVolume(v / 100)}
            onCommit={v => player.setVolume(v / 100)}
            className="om-sound-volume-slider"
          />
        </div>

        <Tooltip label={t('Close player')}>
          <IconButton
            type="button"
            variant="plain"
            className="om-nav-item om-sound-dock-icon"
            aria-label={t('Close player')}
            onClick={player.close}
            icon={<RemixIcon name="close-line" size={15} />}
          />
        </Tooltip>
      </div>
    </section>
  );
}
