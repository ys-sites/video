import type { StoreApi } from "zustand";
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
import { defaultThumbnailMode, type ThumbnailMode } from "../lib/thumbnailPolicy";

/** Revision that moves every composition's thumbnails at once. */
const EVERY_COMPOSITION = "*";

/** Mounts may be written `./scene.html`; the server reports `scene.html`. */
function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function revisionKey(path: string): string {
  return normalizeFilePath(path.split(/[?#]/)[0] ?? "");
}

// Accept decoded project-relative filenames from the watcher or the preview URL.
function mediaFileRevisionKey(path: string): string {
  return "file:" + normalizeFilePath(path);
}

export function mediaThumbnailRevisionOf(
  revisions: Readonly<Record<string, number>>,
  assetPath: string,
): number {
  return (revisions[mediaFileRevisionKey(".")] ?? 0) + (revisions[mediaFileRevisionKey(assetPath)] ?? 0);
}

export interface ThumbnailSlice {
  thumbnailMode: ThumbnailMode;
  /** Monotonic identity, per composition path, for persisted content shown by mounted thumbnails. */
  thumbnailRevisions: Readonly<Record<string, number>>;
  setThumbnailMode: (mode: ThumbnailMode) => void;
  /** `null` refreshes all composition thumbnails. Media strips refresh for the
   * changed file only, or for every media file when a merged/reconnect event
   * reports "." and the individual filenames are unavailable. */
  bumpThumbnailRevisions: (compositions: readonly string[] | null, changedFile?: string) => void;
}

export function thumbnailRevisionOf(
  revisions: Readonly<Record<string, number>>,
  compositionPath: string,
): number {
  return (revisions[EVERY_COMPOSITION] ?? 0) + (revisions[revisionKey(compositionPath)] ?? 0);
}

export function createThumbnailSlice(set: StoreApi<ThumbnailSlice>["setState"]): ThumbnailSlice {
  return {
    thumbnailMode: defaultThumbnailMode(readStudioUiPreferences().thumbnailMode),
    thumbnailRevisions: {},
    setThumbnailMode: (mode) => {
      writeStudioUiPreferences({ thumbnailMode: mode });
      set({ thumbnailMode: mode });
    },
    bumpThumbnailRevisions: (compositions, changedFile) =>
      set(({ thumbnailRevisions }) => {
        const next = { ...thumbnailRevisions };
        for (const path of compositions?.map(revisionKey) ?? [EVERY_COMPOSITION]) {
          next[path] = (next[path] ?? 0) + 1;
        }
        if (changedFile) {
          const key = mediaFileRevisionKey(changedFile);
          next[key] = (next[key] ?? 0) + 1;
        }
        return { thumbnailRevisions: next };
      }),
  };
}
