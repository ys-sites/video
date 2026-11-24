import { ExportCompositionSelect } from "./ExportCompositionSelect";
import { memo, useState } from "react";
import { NativeRuntimeNotice } from "../NativeRuntimeNotice";
import { useFileManagerContextOptional } from "../../contexts/FileManagerContext";
import { RenderQueue } from "./RenderQueue";
import type { RenderJob } from "./useRenderQueue";
import { useStudioShellContext } from "../../contexts/StudioContext";
import { usePreviewVariablesStore } from "../../hooks/previewVariablesStore";

/**
 * The Renders tab, wired to the shell context.
 *
 * Split out of StudioRightPanels because every field it needs already lives in
 * that context, so routing them through the panel only made the panel longer
 * without giving anything a second reader.
 */
export const RenderQueuePanel = memo(function RenderQueuePanel() {
  const { projectId, activeCompPath, compositionDimensions, waitForPendingDomEditSaves, renderQueue } =
    useStudioShellContext();
  const [chosen, setChosen] = useState<{ projectId: string; path: string } | null>(null);
  const composition = chosen?.projectId === projectId ? chosen.path : activeCompPath || 'index.html';
  const current = composition === (activeCompPath || 'index.html');
  const fileManager = useFileManagerContextOptional();

  return (
    <div data-testid="export-panel" className="flex h-full min-h-0 flex-col">
      <NativeRuntimeNotice
        status={renderQueue.ffmpeg}
        checking={renderQueue.ffmpegChecking}
        onRetry={renderQueue.recheckFfmpeg}
        pendingImport={fileManager?.pendingImport ? { count: fileManager.pendingImport.files.length, retry: () => { void fileManager.retryPendingImport(); } } : undefined}
      />
      <ExportCompositionSelect value={composition} onChange={path => setChosen({ projectId, path })} disabled={renderQueue.isRendering} />
      <div className="min-h-0 flex-1">
        <RenderQueue
          jobs={renderQueue.jobs as RenderJob[]}
          projectId={projectId}
          onDelete={renderQueue.deleteRender}
          onCancel={renderQueue.cancelRender}
          onRecheck={renderQueue.recheckRender ?? renderQueue.reloadRenders}
          checking={renderQueue.checking}
          loadError={renderQueue.loadError}
          onRetryLoad={renderQueue.recheckRender ?? renderQueue.reloadRenders}
          actionError={renderQueue.actionError}
          onDismissActionError={renderQueue.dismissActionError}
          onClearCompleted={renderQueue.clearCompleted}
          ffmpeg={renderQueue.ffmpeg}
          ffmpegChecking={renderQueue.ffmpegChecking}
          onRecheckFfmpeg={renderQueue.recheckFfmpeg}
          onStartRender={async (format, quality, resolution, fps, gpu, gifLoop) => {
            await waitForPendingDomEditSaves();
            // Use the explicit selected composition without changing the editor preview.
            await renderQueue.startRender({
              composition,
              fps,
              quality,
              format,
              resolution,
              gpu,
              gifLoop,
              origin: "export_panel",
              // Render what the user is previewing: active variable overrides
              // from the Variables panel ride along (undefined = defaults).
              variables: current ? usePreviewVariablesStore.getState().values ?? undefined : undefined,
            });
          }}
          compositionDimensions={current ? compositionDimensions : null}
          isRendering={renderQueue.isRendering}
          emptyComposition={current && renderQueue.emptyComposition}
        />
      </div>
    </div>
  );
});
