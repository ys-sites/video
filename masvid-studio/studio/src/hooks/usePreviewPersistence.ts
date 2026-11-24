import { useCallback, useRef, useState } from "react";
import { saveFailureFeedback } from "../utils/saveFailureFeedback";
import { useMountEffect } from "./useMountEffect";
import {
  installStudioManualEditSeekReapply,
  reapplyPositionEditsAfterSeek,
} from "../components/editor/manualEdits";
import {
  afterStudioManualEditGestures,
  isStudioManualEditGestureLiveIn,
} from "../components/editor/manualEditsDom";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { markScenesStale } from "../player/sceneSwap";
import { createDomEditSaveQueue, type DomEditSaveDrainResult } from "../utils/domEditSaveQueue";
import {
  flushStudioPendingEdits,
  hasStudioPendingEdits,
  type StudioPendingEditsDrainResult,
} from "../utils/studioPendingEdits";
import { trackStudioEvent } from "../utils/studioTelemetry";
import {
  applyUndoRestoreToPreview,
  readUndoNestedFiles,
  showRestoreInPlace,
  type RestoreFiles,
} from "../utils/gsapUndoRestore";
import { settleNestedReads } from "../utils/gsapSoftReload";
import { readProjectFileContent } from "../utils/studioFileHistory";
import { usePlayerStore } from "../player";
import { syncRestoredTimelineFromPreview } from "../player/lib/timelineRestoreSync";
import { syncHistoryTimelineFromFiles } from "../player/lib/timelineHistoryRestore";
import { holdHistoryTimelineUntilPreviewReplaced } from "../player/timelineRestorePending";
import { studioFileRevision } from "../utils/studioFileVersion";

/** The restore payload the undo/redo preview-sync consumes (from the history store). */
interface HistoryPreviewRestore {
  paths?: string[];
  files?: RestoreFiles;
}

// ── Types ──

interface RecordEditInput {
  label: string;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export interface UsePreviewPersistenceParams {
  showToast: (message: string, tone?: "error" | "info", presentation?: "feedback") => void;
  readOptionalProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  activeCompPathRef: React.MutableRefObject<string | null>;
  /** Called to reload the preview after undo/redo or external file changes. */
  reloadPreview: () => void;
}

function readIframeDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

function installManualEditReapply(iframe: HTMLIFrameElement): void {
  const reapply = () => {
    const doc = readIframeDocument(iframe);
    if (doc) reapplyPositionEditsAfterSeek(doc);
  };
  const install = () => {
    reapply();
    if (iframe.contentWindow) installStudioManualEditSeekReapply(iframe.contentWindow, reapply);
  };
  const win = iframe.contentWindow;
  install();
  win?.requestAnimationFrame?.(install);
  for (const delayMs of [80, 250, 500, 1000, 2000]) {
    win?.setTimeout?.(install, delayMs);
  }
}

export async function drainStudioSaveQueues(
  flushPendingFields: () => Promise<StudioPendingEditsDrainResult>,
  waitForDomQueue: () => Promise<DomEditSaveDrainResult>,
): Promise<StudioPendingEditsDrainResult | DomEditSaveDrainResult> {
  const pending = await flushPendingFields();
  if (pending.status !== "clean") return pending;
  return waitForDomQueue();
}

// fallow-ignore-next-line complexity
async function clearLegacyStudioMotionFile(
  readOptionalProjectFile: (path: string) => Promise<string>,
  writeProjectFile: (path: string, content: string) => Promise<void>,
): Promise<void> {
  const content = await readOptionalProjectFile(STUDIO_MOTION_PATH).catch(() => null);
  if (!content) return;
  try {
    const parsed = JSON.parse(content) as { motions?: unknown[] };
    if (!Array.isArray(parsed.motions) || parsed.motions.length === 0) return;
  } catch {
    return;
  }
  await writeProjectFile(STUDIO_MOTION_PATH, JSON.stringify({ version: 1, motions: [] })).catch(
    () => {},
  );
}

// ── Hook ──

export function usePreviewPersistence({
  showToast,
  readOptionalProjectFile: _readOptionalProjectFile,
  writeProjectFile: _writeProjectFile,
  recordEdit: _recordEdit,
  previewIframeRef,
  activeCompPathRef,
  reloadPreview,
}: UsePreviewPersistenceParams) {
  void _recordEdit;

  const [domEditSaveQueuePaused, setDomEditSaveQueuePaused] = useState<string | null>(null);

  const domTextCommitVersionRef = useRef(0);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const domEditSaveQueueRef = useRef<ReturnType<typeof createDomEditSaveQueue> | null>(null);
  const applyStudioManualEditsToPreviewRef = useRef<
    (iframe?: HTMLIFrameElement | null) => Promise<void>
  >(async () => {});

  if (!domEditSaveQueueRef.current) {
    domEditSaveQueueRef.current = createDomEditSaveQueue({
      onOpen: (event) => {
        const message = saveFailureFeedback(event.statusCode, event.errorMessage);
        setDomEditSaveQueuePaused(message);
        showToastRef.current(message, "error", "feedback");
        trackStudioEvent("save_queue_paused", {
          source: "dom_edit",
          error_message: event.errorMessage,
          status_code: event.statusCode,
          consecutive_failures: event.consecutiveFailures,
        });
      },
      onReset: () => {
        setDomEditSaveQueuePaused(null);
      },
    });
  }

  // ── Queue / drain helpers ──

  const queueDomEditSave = useCallback(<T>(save: () => Promise<T>): Promise<T> => {
    return domEditSaveQueueRef.current?.enqueue(save) ?? save();
  }, []);

  const drainPendingDomEditSaves = useCallback(async (options?: { blur?: boolean }) => {
    return drainStudioSaveQueues(() => flushStudioPendingEdits(options), async () => {
      return (await domEditSaveQueueRef.current?.waitForIdle()) ?? { status: "clean" as const };
    });
  }, []);

  const waitForPendingDomEditSaves = useCallback(async (options?: { blur?: boolean }): Promise<void> => {
    const result = await drainPendingDomEditSaves(options);
    if (result.status !== "clean") throw result.error;
  }, [drainPendingDomEditSaves]);

  const settlePendingEdits = useCallback(async (): Promise<void> => {
    const queued = domEditSaveQueueRef.current?.waitForIdle();
    await flushStudioPendingEdits({ onlyCurrent: true });
    await queued;
  }, []);

  const resetDomEditSaveQueueBreaker = useCallback(() => {
    domEditSaveQueueRef.current?.reset();
    setDomEditSaveQueuePaused(null);
  }, []);

  useMountEffect(() => () => {
    domEditSaveQueueRef.current?.destroy();
  });

  // ── Apply manual edits (HTML-baked — install seek hooks) ──
  // reapplyPositionEditsAfterSeek now also handles motion reapply from DOM attributes.

  const applyCurrentStudioManualEditsToPreview = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      if (!iframe) return;
      if (!readIframeDocument(iframe)) return;
      installManualEditReapply(iframe);
    },
    [previewIframeRef],
  );

  const applyStudioManualEditsToPreview = useCallback(
    async (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      applyCurrentStudioManualEditsToPreview(iframe);
    },
    [applyCurrentStudioManualEditsToPreview, previewIframeRef],
  );
  applyStudioManualEditsToPreviewRef.current = applyStudioManualEditsToPreview;

  // ── Sync preview after undo/redo ──

  // Undo never repaints under a live gesture; the preview reloads once the last one ends.
  const heldPreviewDoc = useCallback(() => {
    const doc = previewIframeRef.current?.contentDocument;
    return doc && isStudioManualEditGestureLiveIn(doc) ? doc : null;
  }, [previewIframeRef]);

  const syncHistoryPreviewAfterApply = useCallback(
    async (restore: HistoryPreviewRestore) => {
      const iframe = previewIframeRef.current;
      const doc = iframe?.contentDocument;
      const activePath = activeCompPathRef.current;
      const projectId = usePlayerStore.getState().timelineProjectId;
      const revision = studioFileRevision();
      const isCurrent = () => previewIframeRef.current === iframe && iframe?.contentDocument === doc &&
        activeCompPathRef.current === activePath && usePlayerStore.getState().timelineProjectId === projectId;
      const deferUnderGesture = () => {
        const held = heldPreviewDoc();
        if (!held) return false;
        const paths = restore.paths ?? Object.keys(restore.files ?? {});
        afterStudioManualEditGestures(held, () => {
          if (!isCurrent()) return;
          if (studioFileRevision() === revision && syncHistoryTimelineFromFiles(activePath, restore.files))
            holdHistoryTimelineUntilPreviewReplaced(iframe);
          markScenesStale(iframe, paths);
          reloadPreview();
        });
        return true;
      };
      if (deferUnderGesture()) return;
      // A confirmed restore updates source-backed rows now. Structural previews
      // may load independently; their old messages must not undo these rows.
      const reloadRestoredPreview = () => {
        if (syncHistoryTimelineFromFiles(activePath, restore.files)) holdHistoryTimelineUntilPreviewReplaced(iframe);
        reloadPreview();
      };
      const nestedFiles = await settleNestedReads(
        readUndoNestedFiles(
          iframe,
          activePath,
          restore.files,
          (path) =>
            projectId
              ? readProjectFileContent(projectId, path)
              : Promise.reject(new Error("No project is open to read nested files from.")),
        ),
      );
      // A newer write owns the preview; discard the snapshot read before it.
      if (!isCurrent() || studioFileRevision() !== revision || deferUnderGesture()) return;
      const strategy = applyUndoRestoreToPreview(
        iframe,
        activePath,
        restore.files,
        usePlayerStore.getState().currentTime,
        reloadRestoredPreview,
        nestedFiles,
      );
      if (strategy === "full") return;
      syncRestoredTimelineFromPreview(previewIframeRef.current?.contentDocument);
    },
    [previewIframeRef, activeCompPathRef, reloadPreview, heldPreviewDoc],
  );

  // A restore the server has not confirmed yet: in place now, or not at all. A GSAP script re-run is not
  // synchronous, and a pending save would land under it.
  const showHistoryRestoreNow = useCallback(
    (files: RestoreFiles): (() => void) | null => {
      if (!domEditSaveQueueRef.current?.isIdle() || hasStudioPendingEdits() || heldPreviewDoc())
        return null;
      const iframe = previewIframeRef.current;
      const now = () => usePlayerStore.getState().currentTime;
      const putBack = showRestoreInPlace(iframe, activeCompPathRef.current, files, now());
      if (!putBack) return null;
      syncRestoredTimelineFromPreview(iframe?.contentDocument);
      return () => {
        if (!heldPreviewDoc() && putBack(now())) {
          syncRestoredTimelineFromPreview(iframe?.contentDocument);
        } else void syncHistoryPreviewAfterApply({ paths: Object.keys(files) });
      };
    },
    [previewIframeRef, activeCompPathRef, syncHistoryPreviewAfterApply, heldPreviewDoc],
  );

  // ── Migrate legacy studio-motion.json ──
  // Projects that used the old JSON-file approach may still have a populated
  // studio-motion.json in the project's .hyperframes folder. The studio no longer reads it, but
  // the legacy render-script injection in `preview.ts` / `vite.studioMotion.ts`
  // could still fire alongside the new seek-reapply runtime. Empty the file so
  // the legacy codepath no-ops.
  useMountEffect(() => {
    void clearLegacyStudioMotionFile(_readOptionalProjectFile, _writeProjectFile);
  });

  return {
    domTextCommitVersionRef,
    domEditSaveQueueRef,
    applyStudioManualEditsToPreviewRef,
    queueDomEditSave,
    drainPendingDomEditSaves,
    waitForPendingDomEditSaves,
    settlePendingEdits,
    domEditSaveQueuePaused,
    resetDomEditSaveQueueBreaker,
    applyCurrentStudioManualEditsToPreview,
    applyStudioManualEditsToPreview,
    syncHistoryPreviewAfterApply,
    showHistoryRestoreNow,
  };
}
