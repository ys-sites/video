import { useCallback, useEffect, useRef, useState } from "react";
import { useAssetPreviewStore } from "../utils/assetPreviewStore";
import { usePlayerStore } from "../player/store/playerStore";

// Includes pending play promises: a later click must own the only audition.
let stopCurrentPreview: ((reset?: boolean) => void) | null = null;
let lastPreview: ((reset?: boolean) => void) | null = null;

export function useAudioAssetPreview(url: string, visible: boolean, onError: () => void) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const attempt = useRef(0);
  const errorRef = useRef(onError);
  errorRef.current = onError;
  const [playing, setPlaying] = useState(false);
  const [pending, setPending] = useState(false);
  const [duration, setDuration] = useState(0);
  const stop = useCallback((reset = false) => {
    attempt.current++;
    audio.current?.pause();
    if (reset && audio.current) { audio.current.currentTime = 0; }
    setPlaying(false);
    setPending(false);
    if (stopCurrentPreview === stop) stopCurrentPreview = null;
  }, []);
  const ensureAudio = useCallback(() => {
    if (audio.current) return audio.current;
    const element = new Audio();
    element.preload = "metadata";
    element.onloadedmetadata = () => setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    element.onended = () => { stop(); element.currentTime = 0; };
    element.onerror = () => {
      const auditioning = stopCurrentPreview === stop;
      stop();
      if (lastPreview === stop) lastPreview = null;
      if (auditioning) errorRef.current();
    };
    // Native playback remains audible even when the source cannot enter Web Audio.
    element.src = url;
    audio.current = element;
    return element;
  }, [stop, url]);

  useEffect(() => {
    setDuration(0);
    return () => {
      stop();
      if (lastPreview === stop) lastPreview = null;
      const element = audio.current;
      if (!element) return;
      element.onloadedmetadata = element.ontimeupdate = element.onended = element.onerror = null;
      element.removeAttribute("src");
      element.load();
      audio.current = null;
    };
  }, [stop, url]);
  useEffect(() => { if (visible) ensureAudio(); }, [ensureAudio, visible]);
  useEffect(() => {
    const unsubscribePreview = useAssetPreviewStore.subscribe(state => {
      if (state.previewAsset || state.catalogPreview) stop();
    });
    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      if (state.isPlaying && !previous.isPlaying) stop();
    });
    const onVisibility = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      unsubscribePreview(); unsubscribePlayer();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [stop]);

  const toggle = useCallback(async () => {
    if (stopCurrentPreview === stop) { stop(); return; }
    if (lastPreview !== stop) lastPreview?.(true);
    useAssetPreviewStore.getState().clearPreviewAsset();
    usePlayerStore.getState().requestPlayback(false);
    const element = ensureAudio();
    // Switching between assets starts a fresh audition; pausing this row resumes it.
    stopCurrentPreview = stop;
    lastPreview = stop;
    const id = ++attempt.current;
    setPending(true);
    try {
      await element.play();
      if (attempt.current === id) { setPlaying(true); setPending(false); }
    } catch {
      if (attempt.current === id) { stop(); errorRef.current(); }
    }
  }, [ensureAudio, stop]);
  return { playing, pending, duration, toggle, stop };
}
