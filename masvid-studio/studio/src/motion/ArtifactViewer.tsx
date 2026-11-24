import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from 'react';
import type { ArtifactKind, SessionArtifact } from '../../../shared/session';
import { EditorLoading, type EditorLoadingLayout } from './EditorLoading';
import { usePlayerStore } from '../player/store/playerStore';
import { useOptionalWorkspaceChrome } from './WorkspaceFrame';
import { lazyWithChunkReload } from '../utils/chunkReload';

// Add a viewer adapter here when a mode introduces a new artifact kind.
// The session and browser shell do not own the editor's internal state.
const viewers: Record<ArtifactKind, ComponentType<{ resolvedProjectId: string }>> = {
  'motion-project': lazyWithChunkReload(() => import('../App').then(module => ({ default: module.StudioApp }))),
};
export function ArtifactViewer({ artifact, loadingLayout }: { artifact: SessionArtifact; loadingLayout?: EditorLoadingLayout | null }) {
  const Viewer = viewers[artifact.kind];
  const surface = useRef<HTMLDivElement>(null);
  const [presented, setPresented] = useState(false);
  const [slow, setSlow] = useState(false);
  const booted = usePlayerStore(state => state.timelineProjectId === artifact.projectId && state.previewBooted && state.timelineReady);
  const chrome = useOptionalWorkspaceChrome();
  const statusReady = !chrome || chrome.workspace.status?.projectId === artifact.projectId || Boolean(chrome.workspace.error);
  useEffect(() => {
    if (presented) return;
    // Let the existing editor loading/retry UI take over if startup cannot settle.
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [presented]);
  useLayoutEffect(() => {
    if (presented) return;
    const content = surface.current!;
    let frame = 0, previous = '', stableFrames = 0;
    const showError = () => {
      const error = [...content.querySelectorAll<HTMLElement>('[role="alert"], [data-testid="composition-preview-error"]')].some(alert => {
        if (!alert.textContent?.trim() || !alert.getClientRects().length) return false;
        for (let node: HTMLElement | null = alert; node && node !== content; node = node.parentElement) {
          if (node.hidden || node.getAttribute('aria-hidden') === 'true' || getComputedStyle(node).display === 'none') return false;
        }
        return true;
      });
      if (error) { cancelAnimationFrame(frame); setPresented(true); return true; }
      return false;
    };
    const observer = new MutationObserver(showError);
    observer.observe(content, { childList: true, subtree: true });
    const settle = () => {
      if (showError()) return;
      const geometry = [...content.querySelectorAll('.hf-dock, .dv-groupview')].map(node => {
        const box = node.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      });
      const next = JSON.stringify(geometry);
      stableFrames = next === previous ? stableFrames + 1 : 0;
      previous = next;
      if (geometry.length && stableFrames >= 2) setPresented(true);
      else frame = requestAnimationFrame(settle);
    };
    if (!showError() && ((booted && statusReady) || slow)) frame = requestAnimationFrame(settle);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [artifact.projectId, booted, statusReady, presented, slow]);
  return <div className="motion-project-presentation" data-editor-initializing={!presented} aria-busy={!presented}>
    <div ref={surface} className="motion-project-editor" inert={!presented} aria-hidden={!presented}>
      <Suspense fallback={null}><Viewer resolvedProjectId={artifact.projectId} /></Suspense>
    </div>
    {!presented && <EditorLoading layout={loadingLayout} />}
  </div>;
}
