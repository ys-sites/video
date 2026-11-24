import { motionApi } from '../motion/useWorkspace';
import { useI18n } from "../i18n/I18n";
import { importValidationMessage } from "../i18n/importMessages";
import { useState, useCallback, useRef, useEffect } from "react";
import type { EditingFile } from "../utils/studioHelpers";
import { FONT_EXT, isMediaFile } from "../utils/mediaTypes";
import { type ImportedFontAsset, type FontImportInput } from "../components/editor/fontAssets";
import { findTagByTarget, type PatchTarget } from "../utils/sourcePatcher";
import { StudioFileConflictError } from "../utils/studioSaveDiagnostics";
import { serializeStudioFileMutation } from "../utils/studioFileMutationCoordinator";
import { useFileTree } from "./useFileTree";
import { useEditorSave } from "./useEditorSave";
import { useProjectFileWriter } from "./useProjectFileWriter";
import { studioApiFetch } from "../utils/studioApiFetch";
import { importErrorCategory, reportAssetImport, reportEdit, setProjectInventory, type ImportEntryPoint, type ImportErrorCategory } from "../motion/editorTracking";
import { encodeUrlPath } from "@hyperframes/parsers";
import { beginStudioIo } from "../telemetry/ioRecovery";
import { prepareFontImport } from "../components/editor/fontImport";
import { manualImportResults, UNKNOWN_IMPORT_REASON, type ManualImportBatch, type ManualImportItem, type ManualImportAttempt, type UploadResponse } from './manualImportResults';

// ── Types ──

interface RecordEditInput {
  label: string;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseFileManagerOptions {
  projectId: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  setRefreshKey: React.Dispatch<React.SetStateAction<number>>;
}

// ── Hook ──

export function useFileManager({
  projectId,
  showToast,
  recordEdit,
  setRefreshKey,
}: UseFileManagerOptions) {
  const { t } = useI18n();
  // ── Shared refs ──

  const [pendingImport, setPendingImport] = useState<{ projectId: string; files: File[]; dir?: string; entryPoint?: ImportEntryPoint; attempt?: ManualImportAttempt } | null>(null);
  const [importBatch, setImportBatch] = useState<ManualImportBatch | null>(null);
  const importBatchRef = useRef(importBatch);
  importBatchRef.current = importBatch;
  const importSequence = useRef(0);
  const manualImportsInFlight = useRef(new Set<string>());
  const importBatchEntry = useRef<{ id: string; entryPoint?: ImportEntryPoint } | null>(null);
  const manualRefreshesInFlight = useRef(new Set<string>());
  const updateImportBatch = useCallback((pid: string, id: string, update: (batch: ManualImportBatch) => ManualImportBatch) => {
    setImportBatch(previous => previous?.projectId === pid && previous.id === id ? update(previous) : previous);
  }, []);
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [revealSourceOffset, setRevealSourceOffset] = useState<number | null>(null);

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;

  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  const importedFontAssetsRef = useRef<ImportedFontAsset[]>([]);
  const {
    fileVersions,
    readProjectFile,
    writeProjectFile: writeProjectFileRaw,
    readOptionalProjectFile,
    observeProjectFileVersion,
  } = useProjectFileWriter({ projectId });

  // ── File tree ──

  const {
    projectDir,
    fileTree,
    fileTreeLoaded,
    refreshFileTree,
    compositions,
    assets,
    fontAssets,
    assetNames,
  } = useFileTree({ projectId, projectIdRef });
  // Counts Studio already holds, for bucketed project-scale fields. Unknown until the tree loads.
  useEffect(() => {
    setProjectInventory(fileTreeLoaded ? { assets: assets.length, compositions: compositions.length } : null);
    return () => setProjectInventory(null);
  }, [fileTreeLoaded, assets.length, compositions.length]);

  useEffect(() => { importedFontAssetsRef.current = []; }, [projectId]);

  const updateEditingFileContent = useCallback((path: string, content: string) => {
    if (editingPathRef.current === path) {
      setEditingFile({ path, content });
    }
  }, []);

  // Studio's own editor tab mirrors whatever it just wrote, on top of the
  // shared writer — a host mounting useProjectFileWriter directly has no
  // editor tab and does not need this.
  const writeProjectFile = useCallback(
    async (path: string, content: string, expectedContent?: string): Promise<void> => {
      const writeProjectId = projectIdRef.current;
      await writeProjectFileRaw(path, content, expectedContent);
      if (projectIdRef.current === writeProjectId && editingPathRef.current === path) {
        setEditingFile({ path, content });
      }
    },
    [writeProjectFileRaw],
  );

  // ── Editor save (debounced content change) ──

  const editorSave = useEditorSave({
    editingPathRef,
    projectIdRef,
    readProjectFile,
    writeProjectFile,
    recordEdit,
    setRefreshKey,
    showToast,
  });
  const { saveRafRef, handleContentChange } = editorSave;

  const overwriteExternalConflict = useCallback(
    async (conflict: StudioFileConflictError) => {
      await serializeStudioFileMutation(writeProjectFile, conflict.filePath, async () => {
        if (conflict.currentContent != null) {
          await writeProjectFile(
            conflict.filePath,
            conflict.attemptedContent,
            conflict.currentContent,
          );
        } else {
          fileVersions.set(conflict.filePath, conflict.currentVersion);
          await writeProjectFile(conflict.filePath, conflict.attemptedContent);
        }
      });
      updateEditingFileContent(conflict.filePath, conflict.attemptedContent);
    },
    [fileVersions, updateEditingFileContent, writeProjectFile],
  );

  // ── File select ──

  const revealRequestIdRef = useRef(0);
  const revealAbortRef = useRef<AbortController | null>(null);

  const handleFileSelect = useCallback(
    (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      revealAbortRef.current?.abort();
      revealAbortRef.current = null;
      revealRequestIdRef.current++;
      // Skip fetching binary content for media files — just set the path for preview
      if (isMediaFile(path)) {
        setEditingFile({ path, content: null });
        return;
      }
      studioApiFetch(`/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(path)}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Failed to load ${path} (${r.status})`);
          return r.json();
        })
        .then((data: { content?: string; version?: string }) => {
          if (data.content != null) {
            fileVersions.set(path, data.version ?? null);
            setEditingFile({ path, content: data.content });
          }
        })
        .catch((err: unknown) => {
          showToast(err instanceof Error ? err.message : `Failed to load ${path}`, "error");
        });
    },
    [fileVersions, showToast],
  );

  // ── Click-to-source ──

  const openSourceForSelection = useCallback(
    (sourceFile: string, target: PatchTarget) => {
      const pid = projectIdRef.current;
      if (!pid || !sourceFile) return;
      revealAbortRef.current?.abort();
      revealAbortRef.current = null;
      if (editingPathRef.current === sourceFile && editingFile?.content != null) {
        const match = findTagByTarget(editingFile.content, target);
        setRevealSourceOffset(match ? match.start : null);
        return;
      }
      const requestId = ++revealRequestIdRef.current;
      const controller = new AbortController();
      revealAbortRef.current = controller;
      studioApiFetch(
        `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(sourceFile)}`,
        {
          signal: controller.signal,
        },
      )
        .then((r) => r.json())
        .then((data: { content?: string; version?: string }) => {
          if (requestId !== revealRequestIdRef.current) return;
          if (data.content != null) {
            fileVersions.set(sourceFile, data.version ?? null);
            setEditingFile({ path: sourceFile, content: data.content });
            const match = findTagByTarget(data.content, target);
            setRevealSourceOffset(match ? match.start : null);
          }
        })
        .catch(() => {});
    },
    [editingFile?.content, fileVersions],
  );

  // ── Upload ──

  const uploadProjectFiles = useCallback(
    async (files: Iterable<File>, dir?: string, entryPoint?: ImportEntryPoint, attempt?: ManualImportAttempt): Promise<string[]> => {
      const pid = projectIdRef.current;
      let fileList = Array.from(files);
      if (!pid || fileList.length === 0 || (attempt && manualImportsInFlight.current.has(pid))) return [];
      let itemIds = attempt?.itemIds ?? fileList.map((_, index) => String(index));
      const requestedCount = fileList.length;
      const finish = attempt ? beginStudioIo(attempt.action ?? 'import_files', { requested_count: requestedCount }) : undefined;
      const results = new Map<string, ManualImportItem['status']>(itemIds.map(id => [id, 'pending']));
      const addedPaths = new Set<string>();
      let listingStatus: ManualImportBatch['listing'] = attempt && importBatchRef.current?.id === attempt.batchId ? importBatchRef.current.listing : 'ready';
      let cancelledBeforeUpload = false;
      let failureCategory: ImportErrorCategory | undefined;
      const update = (change: (batch: ManualImportBatch) => ManualImportBatch) => {
        if (attempt) updateImportBatch(pid, attempt.batchId, change);
      };
      const markResults = (items: ManualImportItem[], paths: string[] = []) => {
        for (const item of items) results.set(item.id, item.status);
        for (const path of paths) addedPaths.add(path);
        update(batch => ({ ...batch,
          items: batch.items.map(item => items.find(result => result.id === item.id) ?? item),
          paths: [...new Set([...batch.paths, ...paths])],
        }));
      };
      if (attempt) manualImportsInFlight.current.add(pid);
      update(batch => ({ ...batch, busy: true }));
      try {
        // Access failures discovered before transmission are safe to reselect.
        // A transport failure after POST is unknown, never proof of rejection.
        if (attempt) {
          const readable: File[] = [], readableIds: string[] = [];
          for (let index = 0; index < fileList.length; index++) {
            const file = fileList[index];
            try {
              await file.slice(0, 1).arrayBuffer();
              readable.push(file); readableIds.push(itemIds[index]);
            } catch {
              failureCategory = 'unreadable';
              markResults([{ id: itemIds[index], name: file.name, status: 'failed', reason: t('Cannot access this file. Choose it again.') }]);
            }
          }
          fileList = readable; itemIds = readableIds;
          if (!fileList.length) return [];
          if (projectIdRef.current !== pid) {
            cancelledBeforeUpload = true;
            markResults(fileList.map((file, index) => ({ id: itemIds[index], name: file.name, status: 'failed', reason: t('Import did not start because the active project changed. Choose the file again.') })));
            return [];
          }
        }
        const formData = new FormData();
        for (const file of fileList) formData.append('file', file);
        const qs = dir ? `?dir=${encodeURIComponent(dir)}` : '';
        const res = await studioApiFetch(`/api/projects/${encodeURIComponent(pid)}/upload${qs}`, { method: 'POST', body: formData });
        if (res.ok) {
          const data: UploadResponse = await res.json();
          const paths = Array.isArray(data.files) ? data.files : [];
          const fileResults = manualImportResults(fileList, itemIds, data, t);
          markResults(fileResults, paths);
          update(batch => ({ ...batch, diagnostic: fileResults.some(item => item.status === 'unknown') ? 'The response could not be matched to every selected file.' : undefined }));
          failureCategory = data.skipped?.length ? 'too_large'
            : data.invalid?.length ? importErrorCategory(String(data.invalid[0].reason)) : failureCategory;
          // Manual batches already show each result and its reason. Repeating
          // legacy notices can imply that the entire batch failed.
          if (!attempt) {
            if (data.skipped?.length) showToast(`"${data.skipped.join(', ')}" exceeds the size limit. Compress or replace the file.`, 'error');
            if (data.invalid?.length) {
              const names = data.invalid.map(entry => entry.name).join(', ');
              showToast(`Cannot add "${names}". Re-export or replace the file.`, 'error');
            }
            if (data.unchecked?.length) {
              const names = data.unchecked.map(entry => entry.name).join(', ');
              showToast(t('Added {name}, {message}', { name: names, message: importValidationMessage(data.unchecked[0].reason, t) }), 'info');
            }
          }
          setPendingImport(previous => previous?.projectId === pid && previous.dir === dir && previous.files.length === fileList.length && previous.files.every((file, index) => file === fileList[index]) ? null : previous);
          // Bind the strict refresh to the upload owner; failures do not undo a
          // confirmed import or turn the upload into a retryable failure.
          listingStatus = 'loading';
          update(batch => ({ ...batch, listing: 'loading' }));
          try {
            await refreshFileTree({ projectId: pid, requiredPaths: paths });
            listingStatus = 'ready';
            update(batch => ({ ...batch, listing: 'ready' }));
            if (projectIdRef.current === pid) setRefreshKey(k => k + 1);
          } catch {
            listingStatus = 'failed';
            update(batch => ({ ...batch, listing: 'failed' }));
            if (projectIdRef.current === pid) showToast(t(paths.length ? 'Files were imported, but the asset list could not reload.' : 'The asset list could not reload. Check the connection and try again.'), 'error');
          }
          return paths;
        }
        const body = await res.clone().json().catch(() => null);
        if (res.status === 409 && body?.code === 'NATIVE_RUNTIME_NOT_READY') {
          if (projectIdRef.current === pid) setPendingImport({ projectId: pid, files: fileList, dir, entryPoint, attempt: attempt ? { ...attempt, itemIds } : undefined });
          failureCategory = 'runtime_not_ready';
          markResults(fileList.map((file, index) => ({ id: itemIds[index], name: file.name, status: 'pending', reason: t('Media components are preparing. Selected files are kept for retry.') })));
          showToast(t('Media components are preparing. Selected files are kept for retry.'), 'info');
        } else {
          update(batch => ({ ...batch, diagnostic: `HTTP ${res.status}${typeof body?.error === 'string' ? `: ${body.error}` : ''}` }));
          const knownRejection = res.status === 413 || body?.applied === false;
          if (knownRejection) failureCategory = res.status === 413 ? 'too_large' : 'other';
          const reason = res.status === 413 ? t('Upload rejected: payload too large. Choose smaller files.') : knownRejection ? t('The server rejected this upload before adding files. Choose the files again.') : t(UNKNOWN_IMPORT_REASON);
          markResults(fileList.map((file, index) => ({ id: itemIds[index], name: file.name, status: knownRejection ? 'failed' : 'unknown', reason })));
          if (attempt) setPendingImport(previous => previous?.attempt?.batchId === attempt.batchId ? null : previous);
          showToast(reason, 'error');
        }
      } catch (error) {
        update(batch => ({ ...batch, diagnostic: error instanceof Error ? `${error.name}: ${error.message}` : 'Upload response unavailable' }));
        markResults(fileList.map((file, index) => ({ id: itemIds[index], name: file.name, status: 'unknown', reason: t(UNKNOWN_IMPORT_REASON) })));
        if (attempt) setPendingImport(previous => previous?.attempt?.batchId === attempt.batchId ? null : previous);
        showToast(t(UNKNOWN_IMPORT_REASON), 'error');
      } finally {
        // Both event families describe this selection, never the accumulated
        // batch. Unknown receipts and pending preparation are not failures.
        const statuses = [...results.values()];
        const added = Math.min(requestedCount, addedPaths.size);
        const failed = statuses.filter(status => status === 'failed').length;
        const pending = statuses.filter(status => status === 'pending').length;
        const unknown = Math.max(0, requestedCount - added - failed - pending);
        reportAssetImport({ projectId: pid, entryPoint, requested: requestedCount, added,
          failed, unknown, pending, category: failureCategory });
        if (finish) {
          const outcome = cancelledBeforeUpload ? 'cancelled' : unknown || pending
            ? added || failed ? 'partial' : 'unknown'
            : added ? failed ? 'partial' : 'success' : failed ? 'failure' : 'unknown';
          finish({ outcome, requested_count: requestedCount, added_count: added, failed_count: failed,
            unknown_count: unknown, pending_count: pending, listing_status: listingStatus });
        }
        if (attempt) manualImportsInFlight.current.delete(pid);
        update(batch => ({ ...batch, busy: false }));
      }
      return [];
    },
    [refreshFileTree, setRefreshKey, showToast, t, updateImportBatch],
  );

  // ── File CRUD ──

  const handleCreateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      let content = "";
      if (path.endsWith(".html")) {
        content =
          '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="UTF-8">\n</head>\n<body>\n\n</body>\n</html>\n';
      }
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(path)}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: content,
        },
      );
      if (res.ok) {
        await refreshFileTree();
        handleFileSelect(path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create file failed: ${err.error}`);
        showToast(`Couldn't create ${path}: ${err.error}`, "error");
      }
    },
    [refreshFileTree, handleFileSelect, showToast],
  );

  const handleCreateFolder = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(path + "/.gitkeep")}`,
        {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: "",
        },
      );
      if (res.ok) {
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Create folder failed: ${err.error}`);
        showToast(`Couldn't create folder ${path}: ${err.error}`, "error");
      }
    },
    [refreshFileTree, showToast],
  );

  const handleDeleteFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(path)}`,
        {
          method: "DELETE",
        },
      );
      if (isMediaFile(path) || FONT_EXT.test(path)) reportEdit("asset_delete", "assets", res.ok, pid);
      if (res.ok) {
        if (editingPathRef.current === path) setEditingFile(null);
        await refreshFileTree();
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Delete failed: ${err.error}`);
        showToast(`Couldn't delete ${path}: ${err.error}`, "error");
      }
    },
    [refreshFileTree, showToast],
  );

  const handleRenameAsset = useCallback(async (assetPath: string, name: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    try {
      await editorSave.flushPendingSave();
      const current = await motionApi<{ revision: string; currentVersionId: string }>('/phase1/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'openmotion_get_project', arguments: { projectId: pid } }),
      });
      if (projectIdRef.current !== pid) return;
      await motionApi('/phase1/call', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'openmotion_edit_project', arguments: { projectId: pid, requestId: crypto.randomUUID(),
          expectedRevision: current.revision, expectedVersionId: current.currentVersionId, files: [], assetNames: [{ path: assetPath, name }] } }),
      });
      reportEdit('asset_rename', 'assets', true, pid);
      if (projectIdRef.current === pid) await refreshFileTree();
    } catch (error) {
      reportEdit('asset_rename', 'assets', false, pid);
      showToast(t("Couldn't rename {path}: {message}", { path: assetNames?.[assetPath] ?? assetPath, message: (error as Error).message }), 'error');
    }
  }, [editorSave.flushPendingSave, refreshFileTree, showToast, t, assetNames]);

  const handleRenameFile = useCallback(
    async (oldPath: string, newPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await studioApiFetch(
        `/api/projects/${encodeURIComponent(pid)}/files/${encodeURIComponent(oldPath)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ newPath }),
        },
      );
      if (isMediaFile(oldPath) || FONT_EXT.test(oldPath)) reportEdit("asset_rename", "assets", res.ok, pid);
      if (res.ok) {
        if (editingPathRef.current === oldPath) {
          handleFileSelect(newPath);
        }
        await refreshFileTree();
        setRefreshKey((k) => k + 1);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Rename failed: ${err.error}`);
        showToast(`Couldn't rename ${oldPath}: ${err.error}`, "error");
      }
    },
    [refreshFileTree, handleFileSelect, setRefreshKey, showToast],
  );

  const handleDuplicateFile = useCallback(
    async (path: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const res = await studioApiFetch(`/api/projects/${encodeURIComponent(pid)}/duplicate-file`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      if (res.ok) {
        const data = await res.json();
        await refreshFileTree();
        if (data.path) handleFileSelect(data.path);
      } else {
        const err = await res.json().catch(() => ({ error: "unknown" }));
        console.error(`Duplicate failed: ${err.error}`);
        showToast(`Couldn't duplicate ${path}: ${err.error}`, "error");
      }
    },
    [refreshFileTree, handleFileSelect, showToast],
  );

  const handleMoveFile = handleRenameFile;

  const retryPendingImport = useCallback(() => pendingImport?.projectId === projectIdRef.current
    ? uploadProjectFiles(pendingImport.files, pendingImport.dir, pendingImport.entryPoint, pendingImport.attempt) : Promise.resolve([]), [pendingImport, uploadProjectFiles]);

  const handleImportFiles = useCallback(
    async (files: FileList | File[], dir?: string, entryPoint?: ImportEntryPoint) => {
      const pid = projectIdRef.current, selected = Array.from(files);
      if (!pid || !selected.length || manualImportsInFlight.current.has(pid)) return [];
      const id = `manual-import-${++importSequence.current}`;
      const items: ManualImportItem[] = selected.map((file, index) => ({ id: `${id}-${index}`, name: file.name, status: 'pending' }));
      importBatchEntry.current = { id, entryPoint };
      setImportBatch({ id, projectId: pid, dir, items, paths: [], busy: true, listing: 'ready' });
      return uploadProjectFiles(selected, dir, entryPoint, { batchId: id, itemIds: items.map(item => item.id), action: 'import_files' });
    },
    [uploadProjectFiles],
  );

  const importFailedReplacements = useCallback(async (batchId: string, replacements: { itemId: string; file: File }[]) => {
    const batch = importBatchRef.current;
    if (!batch || batch.id !== batchId || batch.projectId !== projectIdRef.current || manualImportsInFlight.current.has(batch.projectId)) return [];
    // Item identities, rather than names or old File references, constrain retry
    // to confirmed failures. Unknown and imported rows are never resubmitted.
    const selected = replacements.filter((replacement, index) => replacements.findIndex(item => item.itemId === replacement.itemId) === index && batch.items.some(item => item.id === replacement.itemId && item.status === 'failed'));
    if (!selected.length) return [];
    updateImportBatch(batch.projectId, batch.id, previous => ({ ...previous, items: previous.items.map(item => {
      const replacement = selected.find(entry => entry.itemId === item.id);
      return replacement ? { id: item.id, name: replacement.file.name, status: 'pending' } : item;
    }) }));
    return uploadProjectFiles(selected.map(entry => entry.file), batch.dir, importBatchEntry.current?.id === batchId ? importBatchEntry.current.entryPoint : undefined, { batchId, itemIds: selected.map(entry => entry.itemId), action: 'replace_failed_import' });
  }, [updateImportBatch, uploadProjectFiles]);

  const reloadImportAssets = useCallback(async (batchId: string) => {
    const batch = importBatchRef.current;
    if (!batch || batch.id !== batchId || batch.projectId !== projectIdRef.current || batch.busy || batch.listing === 'loading' || manualRefreshesInFlight.current.has(batchId)) return;
    manualRefreshesInFlight.current.add(batchId);
    const finish = beginStudioIo('refresh_import_list');
    updateImportBatch(batch.projectId, batch.id, previous => ({ ...previous, listing: 'loading' }));
    try {
      await refreshFileTree({ projectId: batch.projectId, requiredPaths: batch.paths });
      finish({ outcome: 'success', listing_status: 'ready' });
      updateImportBatch(batch.projectId, batch.id, previous => ({ ...previous, listing: 'ready' }));
    } catch {
      finish({ outcome: 'failure', listing_status: 'failed' });
      updateImportBatch(batch.projectId, batch.id, previous => ({ ...previous, listing: 'failed' }));
      if (projectIdRef.current === batch.projectId) showToast(t('The asset list could not reload. Check the connection and try again.'), 'error');
    } finally {
      manualRefreshesInFlight.current.delete(batchId);
    }
  }, [refreshFileTree, showToast, t, updateImportBatch]);

  const handleImportFonts = useCallback(
    async (files: FontImportInput): Promise<ImportedFontAsset[]> => {
      const pid = projectIdRef.current;
      if (!pid) return [];
      let imported: ImportedFontAsset[];
      if (typeof files === "string") {
        const response = await studioApiFetch(`/api/projects/${encodeURIComponent(pid)}/fonts/import`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ family: files }),
        });
        if (!response.ok) throw new Error("Installed font import failed");
        const font = await response.json();
        imported = [{ ...font, url: `/api/projects/${encodeURIComponent(pid)}/preview/${encodeUrlPath(font.path)}` }];
        await refreshFileTree();
      } else {
        const prepared: Awaited<ReturnType<typeof prepareFontImport>>[] = [];
        for (const file of Array.from(files).filter((file) => FONT_EXT.test(file.name))) prepared.push(await prepareFontImport(file));
        if (projectIdRef.current !== pid) throw new Error("Active project changed before font import");
        const uploaded = await uploadProjectFiles(prepared.map(font => font.file), "assets/fonts", "properties");
        if (uploaded.length !== prepared.length) throw new Error("Font import did not complete");
        imported = uploaded.map((asset, index) => ({ ...prepared[index].metadata,
          path: asset, url: `/api/projects/${encodeURIComponent(pid)}/preview/${encodeUrlPath(asset)}`,
        }));
      }
      if (projectIdRef.current !== pid) throw new Error("Active project changed before font import");
      importedFontAssetsRef.current = [
        ...imported,
        ...importedFontAssetsRef.current.filter(
          (existing) =>
            !imported.some((font) => font.family.toLowerCase() === existing.family.toLowerCase()),
        ),
      ];
      return imported;
    },
    [uploadProjectFiles, refreshFileTree],
  );

  // ── Return ──

  return {
    // State
    editingFile,
    setEditingFile,
    projectDir,
    fileTree,
    fileTreeLoaded,

    // Refs
    editingPathRef,
    projectIdRef,
    saveRafRef,
    flushPendingSourceSave: editorSave.flushPendingSave,
    discardPendingSourceSave: editorSave.discardPendingSave,
    getPendingSourceCandidate: editorSave.getPendingCandidate,
    importedFontAssetsRef,

    // Core I/O
    readProjectFile,
    writeProjectFile,
    overwriteExternalConflict,
    readOptionalProjectFile,
    observeProjectFileVersion,
    updateEditingFileContent,

    // Click-to-source
    revealSourceOffset,
    openSourceForSelection,

    // Callbacks
    handleFileSelect,
    handleContentChange,
    refreshFileTree,
    uploadProjectFiles,
    pendingImport: pendingImport?.projectId === projectId ? pendingImport : null,
    retryPendingImport,
    importBatch: importBatch?.projectId === projectId ? importBatch : null,
    importFailedReplacements,
    reloadImportAssets,
    handleCreateFile,
    handleCreateFolder,
    handleDeleteFile,
    handleRenameFile,
    handleRenameAsset,
    handleDuplicateFile,
    handleMoveFile,
    handleImportFiles,
    handleImportFonts,

    // Derived
    compositions,
    assets,
    fontAssets,
    assetNames,
  };
}
