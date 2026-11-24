import { useEffect, useRef, useState } from 'react';
import { AudioPreviewWaveform } from '../components/nle/AudioPreviewWaveform';
import '../components/nle/audioPreview.css';

/** Visual feedback for the library's existing native audio player. */
export function AssetAudioPreview({ src, autoPlay = false, onError }: { src: string; autoPlay?: boolean; onError: () => void }) {
  const media = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { const element = media.current; return () => element?.pause(); }, [src]);
  return <div className="om-asset-audio-player">
    <AudioPreviewWaveform media={media} playing={playing} />
    <audio ref={media} src={src} controls autoPlay={autoPlay} preload="metadata" onError={onError}
      onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onWaiting={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
  </div>;
}
