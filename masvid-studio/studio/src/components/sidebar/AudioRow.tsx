import { IconButton } from "open-design-ui/icon-button";
import { Button } from "open-design-ui/button";
import { AssetQuickAdd } from "./AssetQuickAdd";
import { RemixIcon } from "../../icons/RemixIcons";
import { OverflowText } from "../ui/OverflowText";
import { useMvpEditor } from "../../motion/StudioHost";
import { useI18n } from "../../i18n/I18n";
import { useState, useRef, useEffect, useCallback, useId } from "react";
import { InlineAssetRename } from "./InlineAssetRename";
import { ContextMenu } from "./AssetContextMenu";
import { filename, formatDuration, type CopyFeedback } from "./assetHelpers";
import { TIMELINE_ASSET_MIME } from "../../utils/timelineAssetDrop";
import { usePlayerStore } from "../../player/store/playerStore";
import { useAssetPreviewStore } from "../../utils/assetPreviewStore";
import { findClipForAsset, isPointerClick } from "../../utils/assetClickBehavior";
import { resolveMediaPreviewUrl } from "../../player/components/thumbnailUtils";
import { timelineClipFocusId } from "../../player/components/timelineNavigationIdentity";

import type { AssetUsage } from "./assetUsage";
import { useAudioAssetPreview } from "../../hooks/useAudioAssetPreview";
import { useNearViewport } from "../../hooks/useNearViewport";
import { thumbnailRevisionOf } from "../../player/store/thumbnailSlice";
import { useToast } from "../../hooks/useToast";
import { StudioToastViewport } from "../StudioToastViewport";

export function AudioRow({
  projectId,
  asset,
  displayName,
  used,
  usages = [],
  onRevealUsage,
  meta,
  onCopy,
  copyFeedback,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: {
  projectId: string;
  asset: string;
  displayName?: string;
  used: boolean;
  usages?: readonly AssetUsage[];
  onRevealUsage?: (usage: AssetUsage) => void;
  meta?: { description?: string; duration?: number };
  onCopy: (path: string) => void;
  copyFeedback: CopyFeedback;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => unknown;
}) {
  const { t } = useI18n();
  const mvp = useMvpEditor();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [usageExpanded, setUsageExpanded] = useState(false);
  const usageListId = useId();
  useEffect(() => setUsageExpanded(false), [asset, projectId]);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const visible = useNearViewport(element);
  const sessionEpoch = usePlayerStore(s => s.timelineSessionEpoch);
  const revision = usePlayerStore(s => thumbnailRevisionOf(s.thumbnailRevisions, asset));
  const { toasts, showToast, dismissToast } = useToast();
  const name = displayName ?? filename(asset);
  const sourceUrl = resolveMediaPreviewUrl(asset, projectId);
  const serveUrl = `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}assetRevision=${revision}&session=${sessionEpoch}`;
  const { playing, pending, duration, toggle, stop } = useAudioAssetPreview(serveUrl, visible, () => showToast(t("Preview failed to load")));
  const durationLabel = formatDuration(duration || meta?.duration || 0);
  const timeLabel = durationLabel || "—";
  const isCopied = copyFeedback?.path === asset && copyFeedback.ok;
  const copyFailed = copyFeedback?.path === asset && !copyFeedback.ok;

  useEffect(() => {
    if (isCopied) showToast(t("Copied"), "info");
    if (copyFailed) showToast(t("Copy failed"));
  }, [isCopied, copyFailed, showToast, t]);

  // CapCut-style click behavior: drag-threshold gate.
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);
  const setSelectedElementId = usePlayerStore((s) => s.setSelectedElementId);
  const requestTimelineFocus = usePlayerStore((s) => s.requestTimelineFocus);
  const elements = usePlayerStore((s) => s.elements);
  const setPreviewAsset = useAssetPreviewStore((s) => s.setPreviewAsset);
  const clearPreviewAsset = useAssetPreviewStore((s) => s.clearPreviewAsset);

  // Legacy: reveal an existing clip. MVP: always preview the source. Otherwise open
  // the preview overlay. Shared by pointer-up and keyboard activation so the
  // row does the same thing however it is operated.
  const activateRow = useCallback(() => {
    if (used && !mvp) {
      const clip = findClipForAsset(elements, asset);
      if (clip) {
        // Dismiss any open preview overlay (from another asset) — the reveal
        // must not leave a stale preview card floating over the canvas.
        clearPreviewAsset();
        const clipKey = clip.key ?? clip.id;
        setSelectedElementId(clipKey);
        // Scroll the timeline so the selected clip is actually visible.
        requestTimelineFocus(timelineClipFocusId(clipKey));
        return;
      }
    }
    // Not added → preview overlay (audio player)
    setPreviewAsset(asset, projectId, onAddAssetToTimeline ? () => onAddAssetToTimeline(asset) : undefined);
  }, [
    mvp,
    used,
    elements,
    asset,
    projectId,
    setSelectedElementId,
    requestTimelineFocus,
    setPreviewAsset,
    onAddAssetToTimeline,
    clearPreviewAsset,
  ]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const origin = pointerDownRef.current;
      pointerDownRef.current = null;
      if (!origin) return;
      if (!isPointerClick(e.clientX - origin.x, e.clientY - origin.y)) return;
      activateRow();
    },
    [activateRow],
  );

  return (
    <>
      <div
        ref={setElement}
        data-playing={playing || undefined}
        draggable
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        role="button"
        tabIndex={0}
        aria-label={t("{name}: open, drag to timeline, right-click for actions", { name: name })}
        onKeyDown={(e) => {
          // Only when the row itself is focused — keydowns bubbling from the
          // inner controls (play button) must keep their native activation.
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activateRow();
          }
        }}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset, duration: meta?.duration }));
          e.dataTransfer.setData("text/plain", asset);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
        className="motion-audio-row om-asset-action-row"
        data-used={used || undefined}
      >
        <IconButton variant="plain"
          type="button"
          aria-label={playing || pending ? t("Pause preview of {name}", { name }) : t("Play preview of {name}", { name })}
          aria-pressed={playing || pending}
          aria-busy={pending || undefined}
          draggable={false}
          className="motion-audio-play-button"
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); void toggle(); }}
          icon={<RemixIcon name={playing || pending ? "pause-fill" : "play-fill"} size={16} />}
        />
        <div className="motion-audio-content">
          <div className="motion-audio-heading">
            {renaming && onRename ? <InlineAssetRename displayName={displayName} asset={asset} onRename={onRename} onDone={() => setRenaming(false)} /> :
              <OverflowText text={name} className="motion-audio-name" />}
            {onAddAssetToTimeline && <AssetQuickAdd compact asset={asset} onAdd={onAddAssetToTimeline} />}
            <IconButton variant="plain" type="button" className="motion-audio-menu-button" aria-label={t("Actions for {value0}", { value0: name })} title={t("Actions for {value0}", { value0: name })} aria-haspopup="menu" onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); const rect = e.currentTarget.getBoundingClientRect(); setContextMenu({ x: rect.left, y: rect.bottom }); }} icon={<RemixIcon name="more-line" size={16} />} />
          </div>
          <div className="motion-audio-detail">
            <div className="motion-audio-usages">
              <span className={used ? "motion-audio-used" : "motion-audio-unused"}>{t(used ? "In use" : "Unused")}</span>
              {usages.length > 1 && <Button variant="plain" type="button" className="motion-audio-usage-toggle" aria-expanded={usageExpanded} aria-controls={usageListId}
                onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); setUsageExpanded(value => !value); }}>{t("{count} uses", { count: usages.length })}</Button>}
              <span id={usageListId} className={usages.length > 1 ? "motion-audio-usage-list" : "contents"} hidden={usages.length > 1 && !usageExpanded}>
              {(usages.length > 1 && !usageExpanded ? [] : usages).map((usage, index) => {
                const start = formatDuration(usage.start) || "00:00", end = formatDuration(usage.end) || "00:00";
                return <Button variant="plain" type="button" key={`${usage.clipId}-${index}`} className="motion-audio-usage-range"
                  aria-label={t("Locate {name} at {start}–{end} on the timeline", { name, start, end })}
                  onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); stop(); onRevealUsage?.(usage); }}>
                  {start}–{end}
                </Button>;
              })}
              </span>
            </div>
            {!used && <span className="motion-audio-time">{timeLabel}</span>}
          </div>
        </div>
      </div>
      <StudioToastViewport toasts={toasts} dismissToast={dismissToast} />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          asset={asset}
          onClose={() => setContextMenu(null)}
          onCopy={onCopy}
          onDelete={onDelete}
          displayName={displayName}
          onRename={onRename}
          onStartRename={() => setRenaming(true)}
          onAddAtPlayhead={onAddAssetToTimeline}
          onPreview={path => setPreviewAsset(path, projectId)}
          downloadUrl={serveUrl}
        />
      )}
    </>
  );
}
