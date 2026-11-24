import { useEffect, useState } from 'react';
import { skillPreviewSnapshot } from './skillCatalog';

export function useSkillPreview(url: string | undefined, active: boolean, onFailure?: (failed: boolean) => void) {
  const [source, setSource] = useState<{ original: string; playable: string }>();
  const snapshot = url?.startsWith(skillPreviewSnapshot);
  useEffect(() => {
    if (!active || !url || !snapshot) return;
    const controller = new AbortController();
    let playable: string | undefined;
    // GitHub Raw serves archived MP4s as octet-stream.
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
    void fetch(url, { signal, credentials: 'omit', redirect: 'error' }).then(async response => {
      if (!response.ok) throw new Error('Skill preview unavailable');
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      playable = URL.createObjectURL(new Blob([blob], { type: 'video/mp4' }));
      setSource({ original: url, playable });
    }).catch(() => { if (!controller.signal.aborted) onFailure?.(true); });
    return () => {
      controller.abort();
      if (playable) URL.revokeObjectURL(playable);
      setSource(undefined);
    };
  }, [url, snapshot, active, onFailure]);
  if (!active) return undefined;
  if (!snapshot) return url;
  return source?.original === url ? source?.playable : undefined;
}
