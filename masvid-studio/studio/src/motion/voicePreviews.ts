import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Model } from '../../../shared/gateway';
import { generationOptions } from '../../../shared/generation-options';
import type { SoundPlayableTrack } from './SoundPlayerDock';
import { deterministicWaveform } from './soundPresets';

function inferredPreviewMime(src: string): string | undefined {
  const clean = src.split(/[?#]/, 1)[0].toLowerCase();
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  if (clean.endsWith('.m4a') || clean.endsWith('.mp4')) return 'audio/mp4';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.ogg')) return 'audio/ogg';
  return undefined;
}

export interface VoicePreviewSource {
  src: string;
  /** Fetch through a blob URL when same-origin or CORS-enabled with non-audio Content-Type (e.g. GCS text/plain MP3s). */
  blobSource?: boolean;
}

export interface VoicePreviewTarget {
  value: string;
  name: string;
  detail: string;
  previewUrl?: string;
}

export interface VoicePreviewController {
  activeTrackId?: string;
  playing: boolean;
  loading: boolean;
  resolve: (model: Model, voice: VoicePreviewTarget) => VoicePreviewSource | undefined;
  toggle: (model: Model, voice: VoicePreviewTarget) => void;
}

const kokoroModules = import.meta.glob<string>('./voice-previews/kokoro/kokoro-*.m4a', {
  eager: true,
  query: '?url',
  import: 'default',
});

const kokoroPreviewUrls: Record<string, string> = Object.fromEntries(
  Object.entries(kokoroModules).flatMap(([filePath, url]) => {
    const match = filePath.match(/\/kokoro-([a-z0-9_]+)\.m4a$/i);
    return match ? [[match[1], url]] : [];
  }),
);

const byteplusModules = import.meta.glob<string>('./voice-previews/byteplus/byteplus-*.m4a', {
  eager: true,
  query: '?url',
  import: 'default',
});

const byteplusPreviewUrls: Record<string, string> = Object.fromEntries(
  Object.entries(byteplusModules).flatMap(([filePath, url]) => {
    const match = filePath.match(/\/byteplus-([a-z0-9_]+)\.m4a$/i);
    return match ? [[match[1], url]] : [];
  }),
);

export function voicePreviewTrackId(modelId: string, voiceValue: string): string {
  return `voice:${modelId}:${voiceValue}`;
}

function compiledChoicePreviewUrl(model: Model, voiceValue: string): string | undefined {
  const voiceField = generationOptions(model)?.fields.find(field => field.key === 'voice');
  return voiceField?.choices?.find(choice => String(choice.value) === voiceValue)?.previewUrl;
}

/** Resolve an authentic audition sample for a voice: bundled local sample or official provider preview URL. */
export function resolveVoicePreview(
  model: Model,
  voiceValue: string,
  choicePreviewUrl?: string,
): VoicePreviewSource | undefined {
  if (model.modelId === 'fal-ai/kokoro/american-english') {
    const bundled = Object.hasOwn(kokoroPreviewUrls, voiceValue) ? kokoroPreviewUrls[voiceValue] : undefined;
    if (bundled) return { src: bundled, blobSource: true };
  }

  if (model.modelId === 'byteplus-tts-2') {
    const bundled = Object.hasOwn(byteplusPreviewUrls, voiceValue) ? byteplusPreviewUrls[voiceValue] : undefined;
    if (bundled) return { src: bundled, blobSource: true };
  }

  const remoteUrl = choicePreviewUrl ?? compiledChoicePreviewUrl(model, voiceValue);
  if (remoteUrl && /^https:\/\//i.test(remoteUrl)) {
    const normalizeGcsAudio = remoteUrl.startsWith('https://storage.googleapis.com/eleven-public-prod/');
    return { src: remoteUrl, blobSource: normalizeGcsAudio };
  }

  return undefined;
}

export function buildVoicePreviewTrack(
  model: Model,
  voice: VoicePreviewTarget,
  source: VoicePreviewSource,
  t: (text: string) => string,
): SoundPlayableTrack {
  const subtitle = [model.label, voice.detail ? t(voice.detail) : ''].filter(Boolean).join(' · ');
  return {
    id: voicePreviewTrackId(model.id, voice.value),
    kind: 'voice',
    title: voice.name,
    subtitle,
    src: source.src,
    blobSource: source.blobSource,
    waveform: deterministicWaveform(`voice:${model.id}:${voice.value}`, 44),
  };
}

/**
 * Isolated voice-audition playback controller with session-scoped Blob URL caching.
 * Keeps right-side track playback & bottom Player Dock intact instead of unloading them.
 */
export function useVoiceAudition({
  active,
  onPlayStart,
  onError,
}: {
  active: boolean;
  onPlayStart?: () => void;
  onError?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobCacheRef = useRef<Map<string, string>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const autoplayRef = useRef(false);
  const onPlayStartRef = useRef(onPlayStart);
  const onErrorRef = useRef(onError);
  onPlayStartRef.current = onPlayStart;
  onErrorRef.current = onError;

  const [activeTrack, setActiveTrack] = useState<{ id: string; title: string } | null>(null);
  const [resolvedSrc, setResolvedSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    autoplayRef.current = false;
    const el = audioRef.current;
    if (el) {
      el.pause();
      try { el.currentTime = 0; } catch {}
    }
    setPlaying(false);
    setLoading(false);
    setActiveTrack(null);
    setResolvedSrc('');
  }, []);

  // Pause and clean up when leaving Sound Studio or switching tabs.
  useEffect(() => {
    const pauseIfHidden = () => {
      if (!active || document.hidden) audioRef.current?.pause();
    };
    pauseIfHidden();
    document.addEventListener('visibilitychange', pauseIfHidden);
    return () => document.removeEventListener('visibilitychange', pauseIfHidden);
  }, [active]);

  // Revoke session-cached preview blobs cleanly on unmount.
  useEffect(() => {
    const cache = blobCacheRef.current;
    return () => {
      abortRef.current?.abort();
      audioRef.current?.pause();
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  // Autoplay once the resolved audio source mounts.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !resolvedSrc || !autoplayRef.current) return;
    autoplayRef.current = false;
    void el.play().catch(() => setPlaying(false));
  }, [resolvedSrc]);

  const toggle = useCallback((model: Model, voice: VoicePreviewTarget) => {
    const source = resolveVoicePreview(model, voice.value, voice.previewUrl);
    if (!source) return;
    const trackId = voicePreviewTrackId(model.id, voice.value);

    // Clicking the currently active orb toggles play/pause (or cancels in-flight loading).
    if (activeTrack?.id === trackId) {
      if (loading) {
        stop();
        return;
      }
      const el = audioRef.current;
      if (el && resolvedSrc) {
        if (el.paused) {
          onPlayStartRef.current?.();
          if (el.ended) el.currentTime = 0;
          void el.play().catch(() => setPlaying(false));
        } else {
          el.pause();
        }
        return;
      }
    }

    abortRef.current?.abort();
    abortRef.current = null;
    audioRef.current?.pause();
    onPlayStartRef.current?.();
    setPlaying(false);
    setActiveTrack({ id: trackId, title: voice.name });

    if (!source.blobSource) {
      autoplayRef.current = true;
      setLoading(false);
      setResolvedSrc(source.src);
      return;
    }

    const cached = blobCacheRef.current.get(source.src);
    if (cached) {
      autoplayRef.current = true;
      setLoading(false);
      setResolvedSrc(cached);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setResolvedSrc('');
    setLoading(true);
    fetch(source.src, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(response => {
        if (!response.ok) throw new Error('Audio preview unavailable');
        return response.blob();
      })
      .then(blob => {
        if (controller.signal.aborted) return;
        const mime = inferredPreviewMime(source.src);
        const normalized = (!blob.type || blob.type === 'text/plain' || blob.type === 'application/octet-stream') && mime
          ? new Blob([blob], { type: mime })
          : blob;
        const objectUrl = URL.createObjectURL(normalized);
        blobCacheRef.current.set(source.src, objectUrl);
        autoplayRef.current = true;
        setResolvedSrc(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setPlaying(false);
          setActiveTrack(null);
          setResolvedSrc('');
          onErrorRef.current?.();
        }
      });
  }, [activeTrack?.id, loading, resolvedSrc, stop]);

  const controller: VoicePreviewController = useMemo(() => ({
    activeTrackId: activeTrack?.id,
    playing,
    loading,
    resolve: (model, voice) => resolveVoicePreview(model, voice.value, voice.previewUrl),
    toggle,
  }), [activeTrack?.id, playing, loading, toggle]);

  const audioProps = activeTrack && resolvedSrc ? {
    ref: audioRef,
    src: resolvedSrc,
    preload: 'metadata' as const,
    'aria-label': activeTrack.title,
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => {
      setPlaying(false);
      setActiveTrack(null);
    },
    onError: () => {
      setPlaying(false);
      setLoading(false);
      setActiveTrack(null);
      setResolvedSrc('');
      onErrorRef.current?.();
    },
  } : null;

  return { controller, audioProps, stop };
}
