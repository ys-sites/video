import { useCallback, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { PlayerControls } from "../../player";
import { useMvpEditor } from "../../motion/StudioHost";
import { PreviewCanvasMenu } from "../../motion/PreviewCanvasMenu";
import type { TimelineElement } from "../../player";
import { useDockHeaderSlot } from "../dock/DockHeaderSlots";
import { PreviewEmptyState } from "./PreviewEmptyState";
import { useEmptyPreview } from "./useEmptyPreview";
import { TimelineHoverPreview } from "./TimelineHoverPreview";
import { NLEPreview } from "./NLEPreview";
import { CompositionBreadcrumb } from "./CompositionBreadcrumb";
import { usePreviewBlockDrop } from "./usePreviewBlockDrop";
import { useNLEContext } from "./NLEContext";
import { AssetPreviewOverlay } from "./AssetPreviewOverlay";
import { PreviewGuides } from "../editor/PreviewGuides";
import { PreviewOverlayProvider } from "../editor/PreviewOverlayProvider";
import { ReviewComposerOverlay } from '../../motion/ReviewComposerOverlay';
import { ReviewAnnotationOverlay } from '../../motion/ReviewAnnotationOverlay';
import { ReviewPlayerControls } from '../../motion/ReviewPlayerControls';

import { useFullscreenPlayback } from './useFullscreenPlayback';
import { togglePreviewFullscreen } from '../../player/lib/previewFullscreen';
import { useToast } from '../../hooks/useToast';
import { StudioToastViewport } from '../StudioToastViewport';
import { useI18n } from '../../i18n/I18n';

// Clear the timeline selection when a pointer lands outside the composition
// frame (clicks *inside* the frame are handled by the DOM-edit overlay).
// fallow-ignore-next-line complexity
function deselectIfPointerOutsideFrame(
  e: React.PointerEvent,
  iframe: HTMLIFrameElement | null,
  onDeselect?: (element: null) => void,
): void {
  const el = iframe?.parentElement ?? iframe;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const outside =
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom;
  if (outside) onDeselect?.(null);
}

export interface PreviewPaneProps {
  portrait?: boolean;
  /** Slot for overlays rendered on top of the preview (cursors, highlights, etc.) */
  previewOverlay?: ReactNode;
  onSelectTimelineElement?: (element: TimelineElement | null) => void;
  onPreviewBlockDrop?: (
    blockName: string,
    position: { left: number; top: number },
  ) => Promise<void> | void;
}

// fallow-ignore-next-line complexity
export function PreviewPane({
  portrait,
  previewOverlay,
  onSelectTimelineElement,
  onPreviewBlockDrop,
}: PreviewPaneProps) {
  const mvp = useMvpEditor();
  const { t } = useI18n(), toast = useToast();
  const previewHeader = useDockHeaderSlot("preview");
  const {
    projectId,
    iframeRef,
    togglePlay,
    pause,
    seek,
    onIframeLoad,
    previewSlots,
    onShadowIframeLoad,
    onShadowReadyChange,
    onShadowError,
    setShadowIframeNode,
    resetPreviewSlots,
    compositionStack,
    handleNavigateComposition,
    setCompositionLoading,
    timelineDisabled,
    compositionLoading,
    hasLoadedOnceRef,
    previewCompositionSize,
    setPreviewCompositionSize,
  } = useNLEContext();

  const stageRefForDrop = useRef<HTMLDivElement | null>(null);
  const handleStageRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    stageRefForDrop.current = ref.current;
  }, []);

  const {
    isDragOver: previewDragOver,
    handleDragEnter: handlePreviewDragEnter,
    handleDragOver: handlePreviewDragOver,
    handleDragLeave: handlePreviewDragLeave,
    handleDrop: handlePreviewDrop,
  } = usePreviewBlockDrop({
    portrait,
    compositionSize: previewCompositionSize,
    stageRef: stageRefForDrop as React.RefObject<HTMLDivElement | null>,
    onBlockDrop: onPreviewBlockDrop,
  });

  // Preview-only fullscreen: fullscreen targets THIS pane's container, so the
  // browser shows only the preview (sidebars + timeline are excluded naturally).
  const containerRef = useRef<HTMLDivElement>(null);
  const { fullscreen: isFullscreen, controlsHidden } = useFullscreenPlayback(containerRef);
  const toggleFullscreen = () => { void togglePreviewFullscreen(containerRef.current, message => toast.showToast(t(message), 'error')); };

  const currentLevel = compositionStack[compositionStack.length - 1];
  const directUrl = compositionStack.length > 1 ? currentLevel.previewUrl : undefined;
  const empty = useEmptyPreview(projectId, mvp && !compositionLoading && compositionStack.length === 1);

  return (
    <div
      ref={containerRef}
      // MVP insets only the canvas; the transport background reaches the panel edges.
      // Fullscreen removes the inset so the preview fills the screen.
      className={`motion-preview-player relative scheme-dark flex-1 min-h-0 flex flex-col overflow-hidden ${mvp ? "bg-transparent" : "bg-[var(--studio-preview-bg,var(--color-neutral-950))]"} ${
        isFullscreen ? "" : mvp ? (empty ? "mb-3" : "") : "m-3 rounded-md border border-border"
      }`}
      data-studio-fullscreen-target=""
      data-controls-hidden={controlsHidden || undefined}
    >
      {previewHeader && !isFullscreen && createPortal(<PreviewCanvasMenu />, previewHeader)}
      <div
        className={`flex-1 min-h-0 relative overflow-hidden ${mvp && !isFullscreen ? "motion-preview-viewport" : ""}`}
        data-preview-pan-surface="true"
        onPointerDown={(e) =>
          !isFullscreen && deselectIfPointerOutsideFrame(e, iframeRef.current, onSelectTimelineElement)
        }
        onDragEnter={isFullscreen ? undefined : handlePreviewDragEnter}
        onDragOver={isFullscreen ? undefined : handlePreviewDragOver}
        onDragLeave={isFullscreen ? undefined : handlePreviewDragLeave}
        onDrop={isFullscreen ? undefined : handlePreviewDrop}
      >
        <div className="absolute inset-0 overflow-hidden">
          <NLEPreview
            presentationMode={isFullscreen}
            fillBox={isFullscreen}
            zoomControlsTarget={mvp && !isFullscreen ? previewHeader : null}
            projectId={projectId}
            iframeRef={iframeRef}
            onIframeLoad={onIframeLoad}
            previewSlots={previewSlots}
            onShadowIframeLoad={onShadowIframeLoad}
            onShadowReadyChange={onShadowReadyChange}
            onShadowError={onShadowError}
            setShadowIframeNode={setShadowIframeNode}
            resetPreviewSlots={resetPreviewSlots}
            onCompositionLoadingChange={setCompositionLoading}
            portrait={portrait}
            directUrl={directUrl}
            suppressLoadingOverlay={hasLoadedOnceRef.current}
            onStageRef={handleStageRef}
            onCompositionSizeChange={setPreviewCompositionSize}
          />
          {!isFullscreen && previewDragOver && (
            <div className="absolute inset-2 z-40 rounded-lg border-2 border-dashed border-studio-accent/50 bg-studio-accent/4 pointer-events-none" />
          )}
          {!mvp && !isFullscreen && <AssetPreviewOverlay />}
        </div>
        {!empty && !isFullscreen && <PreviewOverlayProvider>
          <PreviewGuides />
          {previewOverlay}
          {mvp && <><ReviewAnnotationOverlay /><ReviewComposerOverlay /></>}
        </PreviewOverlayProvider>}
        {empty && <PreviewEmptyState />}
        {!empty && !isFullscreen && <TimelineHoverPreview />}
        {isFullscreen && <button type="button" data-fullscreen-playback-surface="" className="absolute inset-0 border-0 bg-transparent" aria-label={t('Play or pause preview')} onClick={togglePlay} />}
      </div>
      {/* The MVP transport fills both side edges and the bottom inset. */}
      {!empty && <div data-preview-transport="" className={`shrink-0 ${mvp ? "motion-preview-transport" : ""}`}>
        {!mvp && !isFullscreen && compositionStack.length > 1 && (
          <CompositionBreadcrumb stack={compositionStack} onNavigate={handleNavigateComposition} />
        )}
        <PlayerControls
          reviewControls={mvp && !isFullscreen ? <ReviewPlayerControls projectId={projectId} disabled={timelineDisabled || compositionLoading} /> : undefined}
          onTogglePlay={togglePlay}
          onSeek={seek}
          disabled={timelineDisabled}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
      }
      {mvp && !isFullscreen && <AssetPreviewOverlay modal onOpen={pause} />}
      <StudioToastViewport {...toast} />
    </div>
  );
}
