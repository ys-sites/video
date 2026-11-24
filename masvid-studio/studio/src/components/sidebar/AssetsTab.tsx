import { Button } from 'open-design-ui/button';
import { AssetImportMenu } from '../../motion/AssetLibraryImport';
import { useFileManagerContextOptional } from '../../contexts/FileManagerContext';
import { ManualImportResults } from './ManualImportResults';
import { RemixIcon } from "../../icons/RemixIcons";
import { clickOption, searchStarted, trackStudioClick } from "../../motion/editorTracking";
import { useMvpEditor } from "../../motion/StudioHost";
import { useI18n } from "../../i18n/I18n";
import { useMediaGateway } from "../../motion/MediaGatewayContext";
import { mediaPopoverAnchor } from "../../motion/mediaPopoverPosition";
import { buildProjectApiPath } from "../../utils/projectRouting";
// fallow-ignore-file code-duplication
import { memo, useState, useCallback, useRef, useMemo, useEffect, useId } from "react";
import { SearchInput } from "../ui/SearchInput";
import { FilterChip } from "../ui/FilterChip";
import { MEDIA_EXT, FONT_EXT } from "../../utils/mediaTypes";
import { copyTextToClipboard } from "../../utils/clipboard";
import { usePlayerStore } from "../../player/store/playerStore";
import {
  type MediaCategory,
  type CopyFeedback,
  getCategory,
  filename,
  CATEGORY_LABELS,
  FILTER_ORDER,
} from "./assetHelpers";
import { AudioRow } from "./AudioRow";
import { assetSourcePath, deriveAssetUsages } from "./assetUsage";
import { useAssetUsageNavigation } from "./useAssetUsageNavigation";
import { AssetCard, FontRow } from "./AssetCard";
import { useProjectAssetManifest } from "../../hooks/useProjectAssetManifest";
import type { FileTreeRefreshOptions } from '../../hooks/useFileTree';

interface AssetsTabProps {
  projectId: string;
  assets: string[];
  assetNames?: Record<string, string>;
  onImport?: (files: FileList, entryPoint?: "assets_button" | "assets_drop") => void | Promise<void>;
  onLibraryImport?: (options: FileTreeRefreshOptions) => Promise<void>;
  onDelete?: (path: string) => void;
  onRename?: (oldPath: string, newPath: string) => void;
  onAddAssetToTimeline?: (path: string) => unknown;
}

export type UsageFilter = "all" | "used" | "unused";

/** Filter assets by whether the composition references them. Pure — unit-tested. */
export function filterByUsage(
  assets: string[],
  usedPaths: Set<string>,
  usageFilter: UsageFilter,
): string[] {
  if (usageFilter === "used") return assets.filter((a) => usedPaths.has(a));
  if (usageFilter === "unused") return assets.filter((a) => !usedPaths.has(a));
  return assets;
}

/** Count used vs unused over a media set. Pure — unit-tested. */
export function countUsage(
  assets: string[],
  usedPaths: Set<string>,
): { used: number; unused: number } {
  let used = 0;
  for (const a of assets) if (usedPaths.has(a)) used++;
  return { used, unused: assets.length - used };
}

/**
 * Project-relative asset paths referenced by composition elements — the set the
 * "in use" badge, used-first sort, and usage filter all key on. Element src is
 * populated from the core runtime's `resolveNodeAssetUrl` which calls
 * `new URL(raw, document.baseURI).toString()`, turning authored relative paths
 * into fully-absolute URLs with percent-encoded characters, e.g.
 *   "assets/my file (1).mp4"
 *   → "http://localhost:3012/api/projects/demo/preview/assets/my%20file%20(1).mp4"
 *
 * This function normalizes every src shape to the bare project-relative path so
 * it matches the asset-list entries:
 *   - Absolute URL  → strip origin + /api/projects/<id>/preview/ prefix, decode %XX
 *   - Server-relative /api/…preview/… → same strip + decode
 *   - Relative "./"-prefixed or bare → strip leading ./ or /
 *   - ?query / #hash → dropped
 *
 * Pure — unit-tested.
 */
export function deriveUsedPaths(elements: Array<{ src?: string; sourceFile?: string }>, manifest: readonly { assetUrl?: string | null }[] = []): Set<string> {
  const references = [...elements, ...manifest.map(clip => ({ src: clip.assetUrl ?? undefined, sourceFile: undefined }))];
  return new Set(references.flatMap(el => {
    const path = el.src && assetSourcePath(el.src, el.sourceFile);
    return path ? [path] : [];
  }));
}

/** Empty list body. A query that matched nothing says so and offers a way out;
 *  a genuinely empty project gets the drop hint. */
function EmptyState({
  searchQuery,
  onClearSearch,
}: {
  searchQuery: string;
  onClearSearch: () => void;
}) {
  const { t } = useI18n();
  if (searchQuery) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
        <p className="text-[11px] text-neutral-500 text-center">
          {t("No assets match “")}{searchQuery}&rdquo;
        </p>
        <Button variant="plain"
          type="button"
          onClick={onClearSearch}
          className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-panel-input text-panel-text-3 hover:text-panel-text-1 active:scale-[0.98] transition-colors"
        >
          {t("Clear search")}</Button>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center h-full px-4">
      <div className="motion-panel-empty-content motion-assets-empty-drop">
        <RemixIcon name="upload-2-line" size={18} className="text-text-off" />
        <p className="text-[10px] text-neutral-600 text-center">{t("Drop media files here")}</p>
      </div>
    </div>
  );
}

export const AssetsTab = memo(function AssetsTab({
  projectId,
  assets,
  assetNames,
  onImport,
  onLibraryImport,
  onDelete,
  onRename,
  onAddAssetToTimeline,
}: AssetsTabProps) {
  const { t } = useI18n();
  const mediaGateway = useMediaGateway();
  const fileManager = useFileManagerContextOptional();
  const importBatch = fileManager?.importBatch?.projectId === projectId ? fileManager.importBatch : null;
  const mvp = useMvpEditor();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const projectRef = useRef(projectId);
  projectRef.current = projectId;
  const [latestImport, setLatestImport] = useState<{ projectId: string; path: string }>();
  const importedPath = latestImport?.projectId === projectId ? latestImport.path : undefined;
  const [dragOver, setDragOver] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [importing, setImporting] = useState(false);
  const [activeFilter, setActiveFilter] = useState<MediaCategory | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const chooseFilter = (next: MediaCategory | "all") => {
    if (next !== activeFilter) trackStudioClick("assets", "asset_filter", projectId, undefined, clickOption(next));
    setActiveFilter(next);
  };
  const groupId = useId();
  const [collapsedCategories, setCollapsedCategories] = useState<Set<MediaCategory>>(new Set());
  useEffect(() => {
    setCollapsedCategories((previous) => (previous.size ? new Set() : previous));
  }, [projectId, searchQuery, activeFilter]);
  const manifest = useProjectAssetManifest(projectId, assets);

  const handleLibraryImport = useCallback(async (owner: string, paths: string[]) => {
    await onLibraryImport!({ projectId: owner, requiredPaths: paths });
    if (projectRef.current !== owner) return;
    setSearchQuery('');
    setActiveFilter(getCategory(paths[0]) ?? 'all');
    setLatestImport({ projectId: owner, path: paths[0] });
  }, [onLibraryImport]);
  useEffect(() => {
    if (importedPath && listRef.current) listRef.current.scrollTop = 0;
  }, [latestImport, importedPath]);

  const handleImport = useCallback(
    async (files: FileList, entryPoint: "assets_button" | "assets_drop") => {
      if (!onImport) return;
      setImporting(true);
      try {
        await onImport(files, entryPoint);
      } finally {
        setImporting(false);
      }
    },
    [onImport],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length) void handleImport(e.dataTransfer.files, "assets_drop");
    },
    [handleImport],
  );

  const handleCopyPath = useCallback(async (path: string) => {
    const copied = await copyTextToClipboard(path);
    setCopyFeedback({ path, ok: copied });
    setTimeout(() => setCopyFeedback(null), copied ? 1500 : 3000);
  }, []);
  const elements = usePlayerStore((s) => s.elements);
  const clipManifest = usePlayerStore(s => s.clipManifest);
  const timelineProjectId = usePlayerStore(s => s.timelineProjectId);
  const { reveal, activePath } = useAssetUsageNavigation(projectId);
  const usages = useMemo(() => timelineProjectId && timelineProjectId !== projectId ? new Map() : deriveAssetUsages(elements, clipManifest, projectId, activePath), [elements, clipManifest, projectId, activePath, timelineProjectId]);
  const usedPaths = useMemo(() => new Set<string>(usages.keys()), [usages]);

  // Unfiltered pool — header controls (search, chips) are gated on THIS, not
  // the search-filtered list, so a no-match query can't unmount its own input.
  const allMediaAssets = useMemo(
    () => assets.filter((a) => MEDIA_EXT.test(a) || FONT_EXT.test(a)),
    [assets],
  );

  const mediaAssets = useMemo(() => {
    const all = allMediaAssets;
    if (!searchQuery) return all;
    const q = searchQuery.toLowerCase();
    return all.filter((a) => {
      if ((assetNames?.[a] ?? filename(a)).toLowerCase().includes(q)) return true;
      if (filename(a).toLowerCase().includes(q)) return true;
      const rec = manifest.get(a);
      return rec?.description?.toLowerCase().includes(q);
    });
  }, [allMediaAssets, searchQuery, manifest, assetNames]);

  const categorized = useMemo(() => {
    const groups: Record<MediaCategory, string[]> = { audio: [], images: [], video: [], fonts: [] };
    for (const a of mediaAssets) {
      const cat = getCategory(a);
      if (cat) groups[cat].push(a);
    }
    // Sort: used assets first within each category
    for (const cat of FILTER_ORDER) {
      groups[cat].sort((a, b) => {
        if (a === importedPath) return -1;
        if (b === importedPath) return 1;
        const aUsed = usedPaths.has(a) ? 0 : 1;
        const bUsed = usedPaths.has(b) ? 0 : 1;
        return aUsed - bUsed;
      });
    }
    return groups;
  }, [mediaAssets, usedPaths, importedPath]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mediaAssets.length };
    for (const cat of FILTER_ORDER) c[cat] = categorized[cat].length;
    return c;
  }, [mediaAssets, categorized]);
  const visibleCategories =
    activeFilter === "all"
      ? FILTER_ORDER.filter((c) => categorized[c].length > 0)
      : [activeFilter as MediaCategory].filter((c) => categorized[c].length > 0);
  return (
    <div
      className={`flex-1 flex flex-col min-h-0 transition-colors ${dragOver ? "bg-studio-accent/5" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className={`shrink-0 space-y-1.5 border-b ${mvp ? "border-transparent" : "border-panel-border"} px-2 py-2`} data-assets-toolbar>
        <div className="flex items-center gap-1.5">
          <SearchInput
            value={searchQuery}
            onChange={(e) => {
              if (searchStarted(searchQuery, e.target.value)) trackStudioClick("assets", "asset_search", projectId);
              setSearchQuery(e.target.value);
            }}
            placeholder={t("Search assets...")}
            aria-label={t("Search assets")}
            className="min-w-0 flex-1"
          />
          {onImport && <AssetImportMenu projectId={projectId} importing={importing || Boolean(importBatch?.busy)} onUpload={() => fileInputRef.current?.click()} onImported={onLibraryImport ? handleLibraryImport : undefined} />}
        </div>
        {!mvp && onImport && mediaGateway && <Button variant="plain" className="motion-asset-generate" onClick={event => mediaGateway.openGenerator({ anchor: mediaPopoverAnchor(event.currentTarget) })}>{t("Generate media")}</Button>}
        {onImport && (
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*,image/*,audio/*,font/*"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) {
                void handleImport(e.target.files, "assets_button");
                e.target.value = "";
              }
            }}
          />
        )}

        {/* Filter chips */}
        {allMediaAssets.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            <FilterChip
              onClick={() => chooseFilter("all")}
              className="max-w-full [overflow-wrap:anywhere]"
              active={activeFilter === "all"}
            >
              {t("All")}{" "}{counts.all}
            </FilterChip>
            {FILTER_ORDER.map((cat) =>
              counts[cat] > 0 || activeFilter === cat ? (
                <FilterChip
                  key={cat}
                  onClick={() => chooseFilter(activeFilter === cat ? "all" : cat)}
                  className="max-w-full [overflow-wrap:anywhere]"
                  active={activeFilter === cat}
                >
                  {t(CATEGORY_LABELS[cat])} {counts[cat]}
                </FilterChip>
              ) : null,
            )}
          </div>
        )}
      </div>

      <div
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-1 motion-sidebar-scroll"
        role="region"
        aria-label={t("Project assets")}
        tabIndex={0}
        data-assets-list
        ref={listRef}
      >
        {importBatch && fileManager && <ManualImportResults
          key={importBatch.id}
          batch={importBatch}
          onReplace={fileManager.importFailedReplacements}
          onReload={fileManager.reloadImportAssets}
          onRetryPending={fileManager.pendingImport?.attempt?.batchId === importBatch.id ? fileManager.retryPendingImport : undefined}
          onReveal={importBatch.paths.some(path => MEDIA_EXT.test(path) || FONT_EXT.test(path)) ? paths => {
            setSearchQuery('');
            const path = paths.find(candidate => MEDIA_EXT.test(candidate) || FONT_EXT.test(candidate))!;
            setActiveFilter(getCategory(path) ?? 'all');
            setCollapsedCategories(new Set());
            setLatestImport({ projectId, path });
          } : undefined}
        />}
        {mediaAssets.length === 0 ? (
          <EmptyState searchQuery={searchQuery} onClearSearch={() => setSearchQuery("")} />
        ) : (
          visibleCategories.map((cat) => (
            <div key={cat} className="mb-1" data-assets-category={cat}>
              {activeFilter === "all" && (
                <h3>
                  <Button variant="plain"
                    type="button"
                    className="om-nav-item flex w-full items-center gap-2 px-2 py-1.5 text-left"
                    aria-expanded={!collapsedCategories.has(cat)}
                    aria-controls={`${groupId}-${cat}`}
                    onClick={() => setCollapsedCategories((previous) => {
                      const next = new Set(previous);
                      if (next.has(cat)) next.delete(cat);
                      else next.add(cat);
                      return next;
                    })}
                  >
                    <RemixIcon name={collapsedCategories.has(cat) ? "arrow-right-s-line" : "arrow-down-s-line"} size={14} />
                    <span className="text-[12px] font-semibold text-panel-text-1">{t(CATEGORY_LABELS[cat])}</span>
                    <span className="text-[11px] text-panel-text-5">{categorized[cat].length}</span>
                  </Button>
                </h3>
              )}
              <div id={`${groupId}-${cat}`} hidden={collapsedCategories.has(cat)}>
                {!collapsedCategories.has(cat) && (
                  <>
                    {cat === "audio" &&
                      categorized[cat].map((a) => (
                        <AudioRow
                          key={a}
                          projectId={projectId}
                          asset={a}
                          usages={usages.get(a)}
                          onRevealUsage={reveal}
                          displayName={assetNames?.[a]}
                          used={usedPaths.has(a)}
                          meta={manifest.get(a)}
                          onCopy={handleCopyPath}
                          copyFeedback={copyFeedback}
                          onDelete={onDelete}
                          onRename={onRename}
                          onAddAssetToTimeline={onAddAssetToTimeline}
                        />
                      ))}
                    {(cat === "images" || cat === "video") && (
                      <div className="hf-media-card-grid pb-1">
                        {categorized[cat].map((a) => (
                          <AssetCard
                            key={a}
                            projectId={projectId}
                            asset={a}
                            displayName={assetNames?.[a]}
                            used={usedPaths.has(a)}
                            duration={manifest.get(a)?.duration}
                            onCopy={handleCopyPath}
                            copyFeedback={copyFeedback}
                            onDelete={onDelete}
                            onRename={onRename}
                            onAddAssetToTimeline={onAddAssetToTimeline}
                          />
                        ))}
                      </div>
                    )}
                    {cat === "fonts" &&
                      categorized[cat].map((a) => (
                        <FontRow
                          key={a}
                          asset={a}
                          displayName={assetNames?.[a]}
                          used={usedPaths.has(a)}
                          onCopy={handleCopyPath}
                          copyFeedback={copyFeedback}
                          onDelete={onDelete}
                          onRename={onRename}
                          onAddAssetToTimeline={onAddAssetToTimeline}
                        />
                      ))}
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
});
