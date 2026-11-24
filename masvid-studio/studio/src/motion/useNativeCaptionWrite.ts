import { useEffect, useRef, useState } from 'react';
import { useStudioShellContext } from '../contexts/StudioContext';
import { gatewayRequest } from './gatewayClient';
import { transcriptRequest } from './transcriptClient';
import { useCaptionWorkspace } from './captionWorkspace';
import { useI18n } from '../i18n/I18n';

/** Both entry points use the public, version-guarded native caption operation. */
export function useNativeCaptionWrite() {
  const shell = useStudioShellContext(), { t } = useI18n();
  const [busy, setBusy] = useState(false), active = useRef(false), alive = useRef(true), latest = useRef(shell);
  const pending = useRef<{ signature: string; payload: Record<string, unknown> } | null>(null);
  latest.current = shell;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const disabled = busy || Boolean(shell.writeBlockedReason) || shell.renderQueue.isRendering;
  async function write(input: Record<string, unknown>) {
    if (active.current || disabled) return false;
    active.current = true; setBusy(true);
    const projectId = shell.projectId, compositionPath = shell.activeCompPath || 'index.html';
    const valid = () => alive.current && latest.current.projectId === projectId && (latest.current.activeCompPath || 'index.html') === compositionPath && !latest.current.writeBlockedReason && !latest.current.renderQueue.isRendering;
    try {
      await shell.waitForPendingDomEditSaves(); if (!valid()) return false;
      const signature = JSON.stringify({ input, projectId, compositionPath });
      if (pending.current?.signature !== signature) {
        const detail = await gatewayRequest<{ revision: string; currentVersionId: string }>('phase1/call', 'POST', { name: 'openmotion_get_project', arguments: { projectId } });
        pending.current = { signature, payload: { ...input, projectId, compositionPath, expectedRevision: detail.revision, expectedVersionId: detail.currentVersionId, requestId: crypto.randomUUID() } };
      }
      if (!valid()) return false;
      const result = await transcriptRequest<{ trackId?: string }>(pending.current.payload);
      pending.current = null;
      if (!valid()) return false;
      // This operation changes an existing composition, not the file inventory.
      // The persisted-file coordinator refreshes that inventory in the background.
      // Do not hold caption selection or the add button behind a second tree scan.
      useCaptionWorkspace.getState().changed();
      if (result.trackId) useCaptionWorkspace.getState().open(projectId, { compositionPath, mode: 'style', trackId: result.trackId, selectClip: true });
      shell.showToast(t(input.textKind === 'text' ? 'Text added to the timeline' : 'Captions added to the video'), 'info');
      return true;
    } catch (error) {
      if (error instanceof Error && /CONFLICT/.test(error.message)) pending.current = null;
      if (valid()) shell.showToast(t(error instanceof Error ? error.message : 'Caption update failed'), 'error');
      return false;
    } finally { active.current = false; if (alive.current) setBusy(false); }
  }
  return { write, busy, disabled };
}
