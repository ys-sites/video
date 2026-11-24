import { useCallback, useEffect, useState } from 'react';
import { useStudioShellContextOptional } from '../../contexts/StudioContext';
import { usePlayerStore } from '../../player/store/playerStore';
import { useAssetPreviewStore } from '../../utils/assetPreviewStore';
import { timelineClipFocusId } from '../../player/components/timelineNavigationIdentity';
import { assetSourcePath, type AssetUsage } from './assetUsage';

/** Wait for the destination composition's rows before selecting or seeking. No source edits. */
export function useAssetUsageNavigation(projectId: string) {
  const shell = useStudioShellContextOptional();
  const elements = usePlayerStore(s => s.elements);
  const [pending, setPending] = useState<{ projectId: string; usage: AssetUsage } | null>(null);
  const activePath = shell?.activeCompPath ?? 'index.html';
  const reveal = useCallback((usage: AssetUsage) => {
    useAssetPreviewStore.getState().clearPreviewAsset();
    usePlayerStore.getState().requestPlayback(false);
    setPending({ projectId, usage });
    if (shell && usage.compositionPath !== activePath) shell.setActiveCompPath(usage.compositionPath);
  }, [projectId, shell, activePath]);
  useEffect(() => {
    if (!pending) return;
    if (pending.projectId !== projectId) { setPending(null); return; }
    const { usage } = pending;
    if (shell && activePath !== usage.compositionPath) return;
    const matches = elements.filter(el => assetSourcePath(el.src ?? '', el.sourceFile ?? activePath, projectId) === usage.asset);
    const target = matches.find(el => [el.id, el.domId, el.hfId].includes(usage.clipId))
      ?? matches.slice().sort((a, b) => Math.abs(a.start - usage.localStart) - Math.abs(b.start - usage.localStart))[0]
      ?? (!shell ? elements.find(el => (el.key ?? el.id) === usage.targetId) : undefined);
    if (!target) return;
    const state = usePlayerStore.getState(), key = target.key ?? target.id;
    state.setSelectedElementId(key);
    state.requestSeek(shell ? usage.localStart : usage.start);
    state.requestTimelineFocus(timelineClipFocusId(key));
    setPending(null);
  }, [pending, projectId, elements, shell, activePath]);
  return { reveal, activePath };
}
