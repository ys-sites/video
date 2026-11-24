import { buildProjectApiPath } from "../utils/projectRouting";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { FONT_EXT } from "../utils/mediaTypes";
import { fontFamilyFromAssetPath, type ImportedFontAsset } from "../components/editor/fontAssets";
import { captureProjectProvenance } from "../components/feedback/projectProvenance";
import { studioApiFetch } from "../utils/studioApiFetch";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { errorProps } from "../utils/rejectionTelemetry";
import { encodeUrlPath } from "@hyperframes/parsers";

interface UseFileTreeOptions {
  projectId: string | null;
  projectIdRef: React.RefObject<string | null>;
}

export interface FileTreeRefreshOptions {
  projectId: string;
  requiredPaths: readonly string[];
}

interface FetchedFileTree {
  projectId: string;
  loaded: boolean;
  fileTree: string[];
  compositionPaths: string[];
  projectDir: string | null;
  assetNames?: Record<string, string>;
  fonts?: Array<Omit<ImportedFontAsset, "url">>;
}

// Stable references so a mismatched projectId doesn't create a new array every render
// and defeat useMemo/useCallback deps downstream (e.g. the `assets` memo below).
const EMPTY_FILE_LIST: string[] = [];

type TreeListing = { assetNames?: Record<string, string>; dir?: string; files?: string[]; compositions?: string[]; fonts?: Array<Omit<ImportedFontAsset, "url">> };

async function readTreeListing(projectId: string, signal: AbortSignal): Promise<TreeListing> {
  const res = await studioApiFetch(buildProjectApiPath(projectId), { signal });
  if (!res.ok) throw new Error(`tree fetch failed: ${res.status}`);
  return res.json();
}

function reportRefreshFailure(err: unknown): void {
  const { error_name, error_message } = errorProps(err);
  trackStudioEvent("file_tree_refresh_failed", { error_name, error_message });
}

/**
 * Holds the tree with the `projectId` it was fetched for; exposes empty/not-loaded
 * whenever that id doesn't match the current one, so a switch can't read another project's tree.
 */
export function useFileTree({ projectId, projectIdRef }: UseFileTreeOptions) {
  const [fetched, setFetched] = useState<FetchedFileTree | null>(null);
  const refreshRequestRef = useRef(0);
  const appliedRequestRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const failureReportedRef = useRef(false);
  const current = fetched?.projectId === projectId ? fetched : null;
  const fileTree = current?.fileTree ?? EMPTY_FILE_LIST;
  const compositionPaths = current?.compositionPaths ?? EMPTY_FILE_LIST;
  const projectDir = current?.projectDir ?? null;
  const fileTreeLoaded = current?.loaded ?? false;

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    const requestId = ++refreshRequestRef.current;
    setFetched({ projectId, loaded: false, fileTree: [], compositionPaths: [], projectDir: null });
    studioApiFetch(buildProjectApiPath(projectId))
      // An unresolvable project answers 404 with a JSON body, so without this
      // the error path parsed cleanly and the success branch below recorded an
      // empty tree — and an empty provenance snapshot — for a project that was
      // never read. Throwing hands it to the catch instead.
      .then((r) => {
        if (!r.ok) throw new Error(`tree fetch failed: ${r.status}`);
        return r.json();
      })
      .then((data: TreeListing) => {
        if (cancelled || requestId < appliedRequestRef.current) return;
        appliedRequestRef.current = requestId;
        setFetched({
          projectId,
          loaded: true,
          fileTree: data.files ?? [],
          compositionPaths: data.compositions ?? [],
          projectDir: typeof data.dir === "string" ? data.dir : null,
          fonts: data.fonts,
          assetNames: data.assetNames,
        });
        // Snapshot how this project was made, while the listing is in hand and
        // the app is still alive. A crash later has no other way to learn it.
        void captureProjectProvenance(projectId, data.files ?? [], data.compositions ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setFetched((prev) => (prev?.projectId === projectId ? { ...prev, loaded: true } : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const refreshFileTree = useCallback(async (options?: FileTreeRefreshOptions) => {
    const pid = options?.projectId ?? projectIdRef.current;
    if (!pid) return;
    if (options && projectIdRef.current !== pid) throw new Error('Active project changed before asset refresh');
    // Same id+abort pair as useFileManager.ts's openSourceForSelection: cancel the
    // superseded request instead of letting it complete and discarding the result.
    refreshAbortRef.current?.abort();
    const requestId = ++refreshRequestRef.current;
    const controller = new AbortController();
    // A verified import refresh must finish even if an external file event also
    // refreshes the tree. Ordinary background refreshes remain cancellable.
    refreshAbortRef.current = options ? null : controller;
    let data: TreeListing;
    try {
      data = await readTreeListing(pid, controller.signal);
      if (options && (!Array.isArray(data.files) || options.requiredPaths.some(path => !data.files!.includes(path)))) {
        throw new Error('Imported files are missing from the project listing');
      }
    } catch (err) {
      if (!options && err instanceof DOMException && err.name === "AbortError") return;
      if (!failureReportedRef.current) reportRefreshFailure(err);
      failureReportedRef.current = true;
      if (options) throw err;
      return;
    }
    failureReportedRef.current = false;
    if (options && projectIdRef.current !== pid) throw new Error('Active project changed during asset refresh');
    if (data.files && !controller.signal.aborted && projectIdRef.current === pid && requestId >= appliedRequestRef.current) {
      appliedRequestRef.current = requestId;
      setFetched((prev) =>
        prev?.projectId === pid
          ? {
              ...prev,
              loaded: true,
              projectDir: typeof data.dir === 'string' ? data.dir : prev.projectDir,
              fileTree: data.files ?? prev.fileTree,
              // A response that omits `compositions` must not wipe out a
              // known-good list — only replace it when the field is present.
              compositionPaths: data.compositions ?? prev.compositionPaths,
              fonts: data.fonts ?? prev.fonts,
              assetNames: data.assetNames ?? prev.assetNames,
            }
          : prev,
      );
    }
  }, [projectIdRef]);

  const assets = useMemo(
    () =>
      fileTree.filter((f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json")),
    [fileTree],
  );

  const fontAssets = useMemo<ImportedFontAsset[]>(
    () =>
      current?.fonts?.map(font => ({ ...font, url: buildProjectApiPath(projectId!, `/preview/${encodeUrlPath(font.path)}`) })) ?? (projectId ? assets : [])
        .filter((asset) => FONT_EXT.test(asset))
        .map((asset) => ({
          family: fontFamilyFromAssetPath(asset),
          path: asset,
          url: projectId ? buildProjectApiPath(projectId, `/preview/${encodeUrlPath(asset)}`) : "",
        })),
    [assets, projectId, current?.fonts],
  );

  return {
    projectDir,
    fileTree,
    fileTreeLoaded,
    refreshFileTree,
    compositions: compositionPaths,
    assets,
    fontAssets,
    assetNames: current?.assetNames,
  };
}
