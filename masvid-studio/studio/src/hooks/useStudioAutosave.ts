import { useEffect, useRef } from 'react';
import { isStudioEditSaving } from '../utils/studioPendingEdits';

export const STUDIO_AUTOSAVE_INTERVAL_MS = 15_000;

/** Drain only staged edits. Existing writers retain deduplication, serialization and conflict guards. */
export function useStudioAutosave({ projectId, blocked, flush }: {
  projectId: string | null;
  blocked: boolean;
  flush: () => Promise<void>;
}) {
  const current = useRef({ blocked, flush });
  current.current = { blocked, flush };
  useEffect(() => {
    if (!projectId) return;
    let running = false;
    const save = async () => {
      if (running || current.current.blocked || isStudioEditSaving()) return;
      running = true;
      try { await current.current.flush(); }
      catch { /* The existing save queues own failure feedback and recovery. */ }
      finally { running = false; }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void save();
    }, STUDIO_AUTOSAVE_INTERVAL_MS);
    // Best effort on backgrounding; an abruptly terminated browser cannot guarantee completion.
    const onVisibility = () => { if (document.visibilityState === 'hidden') void save(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [projectId]);
}
