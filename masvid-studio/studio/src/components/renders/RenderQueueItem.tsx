import { RemixIcon } from "../../icons/RemixIcons";
import { useI18n } from "../../i18n/I18n";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { clickMethod, trackStudioClick } from "../../motion/editorTracking";
import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { RenderQueueInfo } from "./RenderQueueInfo";
import { RenderPreview } from "./RenderPreview";
import { Button } from "open-design-ui/button";
import { IconButton } from "open-design-ui/icon-button";
import { Tooltip } from "../ui/Tooltip";
import { ErrorNotice } from "../ui/ErrorNotice";
import type { RenderJob } from "./useRenderQueue";
import { studioApiFetch, studioProjectUrl } from "../../utils/studioApiFetch";
import { redactDiagnostic } from "../../../../scripts/diagnostic-redaction.mjs";
import { useToast } from "../../hooks/useToast";
import { StudioToastViewport } from "../StudioToastViewport";
import { beginStudioIo } from "../../telemetry/ioRecovery";

interface RenderQueueItemProps {
  job: RenderJob;
  projectId: string;
  onDelete: () => void;
  onCancel: () => void;
  onRecheck?: () => void;
  checking?: boolean;
}

type FileAccess = 'unchecked' | 'available' | 'unavailable' | 'unknown';
type CheckedFileAccess = Exclude<FileAccess, 'unchecked'>;

function fileCheckOutcome(status: CheckedFileAccess) {
  return status === 'available' ? 'success' : status === 'unavailable' ? 'failure' : 'unknown';
}

function exportDiagnostic(job: RenderJob, projectId: string): string {
  // Never copy the entire settings object: it may contain variables, source or
  // provider data. These existing scalar fields identify this export only.
  const settings = Object.fromEntries(['format', 'quality', 'fps', 'resolution', 'composition'].flatMap(key => {
    const value = job.settings?.[key] ?? job.settings?.[`render_${key}`];
    return ['string', 'number', 'boolean'].includes(typeof value) ? [[key, String(value).slice(0, 512)]] : [];
  }));
  return redactDiagnostic(JSON.stringify({
    projectId, taskId: job.id, nativeTaskId: job.nativeJobId, requestId: job.requestId, filename: job.filename,
    status: job.status, workerActive: job.workerActive, requestNotFound: job.requestNotFound, stage: job.stage, progress: job.progress,
    startedAt: new Date(job.createdAt).toISOString(),
    lastCheckedAt: job.lastCheckedAt === undefined ? undefined : new Date(job.lastCheckedAt).toISOString(),
    settings, ...(job.error ? { error: job.error.slice(0, 8192) } : {}),
  }, null, 2));
}

export const RenderQueueItem = memo(function RenderQueueItem({
  job,
  projectId,
  onDelete,
  onCancel,
  onRecheck,
  checking = false,
}: RenderQueueItemProps) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fileAccess, setFileAccess] = useState<FileAccess>(job.fileAvailable === false ? 'unavailable' : 'unchecked');
  const [checkingFile, setCheckingFile] = useState(false);
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const fileRequest = useRef<AbortController | null>(null);
  const diagnosticId = useId();
  const toast = useToast();
  const diagnostic = exportDiagnostic(job, projectId);

  // Managed attempts retain task-bound URLs after refresh or restart. A name
  // alone could resolve to another export after its original record is deleted.
  const legacyFileSrc = buildProjectApiPath(projectId, `/renders/file/${encodeURIComponent(job.filename)}`);
  const fileSrc = job.nativeJobId
    ? studioProjectUrl(`/api/render/${encodeURIComponent(job.nativeJobId)}/view`, projectId)
    : legacyFileSrc;
  const downloadSrc = job.nativeJobId
    ? studioProjectUrl(`/api/render/${encodeURIComponent(job.nativeJobId)}/download`, projectId)
    : legacyFileSrc + "?download=1";

  useEffect(() => {
    setFileAccess(job.fileAvailable === false ? 'unavailable' : 'unchecked');
    setCheckingFile(false);
    return () => {
      fileRequest.current?.abort();
      fileRequest.current = null;
    };
  }, [fileSrc, job.fileAvailable]);

  const checkFile = useCallback(async (): Promise<CheckedFileAccess> => {
    if (fileRequest.current) return 'unknown';
    const controller = new AbortController();
    fileRequest.current = controller;
    setCheckingFile(true);
    const deadline = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await studioApiFetch(fileSrc, { method: 'HEAD', cache: 'no-store', signal: controller.signal });
      if (fileRequest.current !== controller) return 'unknown';
      const status = response.ok ? 'available' : [403, 404, 410].includes(response.status) ? 'unavailable' : 'unknown';
      setFileAccess(status);
      return status;
    } catch {
      if (fileRequest.current === controller) setFileAccess('unknown');
      return 'unknown';
    } finally {
      clearTimeout(deadline);
      if (fileRequest.current === controller) {
        fileRequest.current = null;
        setCheckingFile(false);
      }
    }
  }, [fileSrc]);

  const handleOpen = async () => {
    if (fileRequest.current) return;
    const finish = beginStudioIo('open_render');
    // Reserve the tab during the click so the file check does not turn the
    // eventual open into a browser-blocked asynchronous popup.
    let tab: Window | null;
    try {
      tab = window.open('', '_blank');
      if (tab) tab.opener = null;
    } catch {
      finish({ outcome: 'failure', file_status: 'unknown', delivery_status: 'popup_blocked' });
      toast.showToast('Could not open a new tab. Allow pop-ups or download this file.', 'error', 'feedback');
      return;
    }
    const fileStatus = await checkFile();
    if (fileStatus !== 'available') {
      tab?.close();
      finish({ outcome: fileCheckOutcome(fileStatus), file_status: fileStatus });
      return;
    }
    if (tab) {
      tab.location.href = fileSrc;
      finish({ outcome: 'success', file_status: fileStatus, delivery_status: 'opened' });
    } else {
      finish({ outcome: 'failure', file_status: fileStatus, delivery_status: 'popup_blocked' });
      toast.showToast('Could not open a new tab. Allow pop-ups or download this file.', 'error', 'feedback');
    }
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (fileRequest.current) return;
    trackStudioClick("export_panel", "download_render", projectId, clickMethod(e));
    const finish = beginStudioIo('download_render');
    const fileStatus = await checkFile();
    if (fileStatus !== 'available') {
      finish({ outcome: fileCheckOutcome(fileStatus), file_status: fileStatus });
      return;
    }
    try {
      const a = document.createElement("a");
      a.href = downloadSrc;
      a.download = "";
      a.click();
      // The browser does not report whether the user saved the file.
      finish({ outcome: 'unknown', file_status: 'available', delivery_status: 'browser_save_requested' });
    } catch {
      finish({ outcome: 'failure', file_status: 'available' });
      toast.showToast('Download failed. Please try again.', 'error', 'feedback');
    }
  };

  const handleRecheckFile = async () => {
    if (fileRequest.current) return;
    const finish = beginStudioIo('recheck_file');
    const fileStatus = await checkFile();
    finish({ outcome: fileCheckOutcome(fileStatus), file_status: fileStatus });
  };

  const copyDiagnostic = async () => {
    try { await navigator.clipboard.writeText(diagnostic); toast.showToast('Copied!', 'info', 'feedback'); }
    catch {
      setShowDiagnostic(true);
      toast.showToast('Copy failed. Select the details to copy them.', 'error', 'feedback');
    }
  };

  const viewSrc = fileSrc;
  const isComplete = job.status === "complete";
  const isRendering = job.status === "rendering";
  const awaitingResult = job.status === 'unknown' || job.status === 'cancelling';
  const canAccessFile = isComplete && fileAccess !== 'unavailable' && fileAccess !== 'unknown' && !checkingFile;

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        setVideoReady(false);
        setConfirmingDelete(false);
      }}
      className="px-3 py-2.5 border-b border-border last:border-0 transition-colors duration-150 hover:bg-hover/30"
    >
      <div className="flex flex-wrap items-center gap-2.5">
        {/* Thumbnail — static frame; swaps to live video on hover.
            A real button so keyboard users can open the render too. */}
        <Button variant="plain"
          type="button"
          onClick={canAccessFile ? () => void handleOpen() : undefined}
          disabled={!canAccessFile}
          aria-label={isComplete ? t("Open {value0} in a new tab", { value0: job.filename }) : undefined}
          className={[
            "w-20 h-[45px] rounded-md overflow-hidden bg-input shrink-0 relative",
            "outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-accent",
            canAccessFile ? "cursor-pointer" : "cursor-default",
          ].join(" ")}
        >
          {isComplete && fileAccess !== 'unavailable' && fileAccess !== 'unknown' && (
            <RenderPreview
              filename={job.filename}
              src={viewSrc}
              hovered={hovered}
              ready={videoReady}
              onReady={() => setVideoReady(true)}
            />
          )}
          {(awaitingResult || (isComplete && (fileAccess === 'unavailable' || fileAccess === 'unknown'))) && (
            <div className="w-full h-full flex items-center justify-center text-text-4">
              <RemixIcon name={job.status === 'cancelling' ? 'loader-4-line' : 'question-line'} size={18} />
            </div>
          )}
          {isRendering && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse motion-reduce:animate-none" />
            </div>
          )}
          {job.status === "failed" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-danger-ink" />
            </div>
          )}
          {job.status === "cancelled" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-text-5" />
            </div>
          )}
        </Button>

        <RenderQueueInfo job={job} />

        {/* Actions — always visible to prevent layout shifts */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isRendering ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                trackStudioClick("export_panel", "cancel_render", projectId, clickMethod(e));
                onCancel();
              }}
            >
              {t("Cancel")}</Button>
          ) : awaitingResult ? (
            onRecheck && <Button size="sm" variant="secondary" disabled={checking} onClick={onRecheck}>
              {t(checking ? 'Checking…' : 'Recheck')}
            </Button>
          ) : confirmingDelete ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                  trackStudioClick("export_panel", "delete_render", projectId, clickMethod(e));
                  onDelete();
                }}
              >
                {t("Delete?")}</Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmingDelete(false);
                }}
              >
                {t("Keep")}</Button>
            </>
          ) : (
            <>
              {/* The tooltip explains the control whether or not it is
                  reachable; `disabled:` on the shared Button keeps pointer
                  events alive precisely so a disabled one can still say why. */}
              <Tooltip label={isComplete ? t(canAccessFile ? 'Download' : checkingFile ? 'Checking file…' : 'Recheck the file before downloading') : t("Available when the render finishes")}>
                <IconButton
                  size="sm"
                  onClick={(event) => void handleDownload(event)}
                  disabled={!canAccessFile}
                  aria-label={t("Download {value0}", { value0: job.filename })}
                  icon={
                    <RemixIcon name="download-2-line" size={14} />
                  }
                />
              </Tooltip>
              <Tooltip label={t("Delete")}>
                <IconButton
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmingDelete(true);
                  }}
                  aria-label={t("Delete {value0}", { value0: job.filename })}
                  icon={
                    <RemixIcon name="delete-bin-line" size={14} />
                  }
                />
              </Tooltip>
            </>
          )}
        </div>
      </div>
      {job.status === 'unknown' && <div className="mt-2">
        <p className="text-step-11 text-text-4">{t(job.requestNotFound && !job.nativeJobId
          ? 'No matching task was found. Copy diagnostics, then reload the editor before exporting again.'
          : job.workerActive === false
            ? 'No active worker is attached. A new export keeps this unknown record.'
            : 'The export result is not confirmed. Recheck the original task.')}</p>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {job.requestNotFound && !job.nativeJobId && <Button size="sm" variant="secondary" onClick={() => {
            const finish = beginStudioIo('reload_editor');
            finish({ outcome: 'unknown' });
            window.location.reload();
          }}>{t('Reload editor')}</Button>}
          <Button size="sm" variant="ghost" onClick={() => void copyDiagnostic()}>{t('Copy diagnostics')}</Button>
          <Button size="sm" variant="ghost" aria-expanded={showDiagnostic} aria-controls={diagnosticId} onClick={() => setShowDiagnostic(value => !value)}>{t(showDiagnostic ? 'Hide diagnostics' : 'Diagnostic information')}</Button>
        </div>
        {showDiagnostic && <pre id={diagnosticId} tabIndex={0} aria-label={t('Diagnostic information')} className="mt-1 p-2 rounded-md bg-input text-step-11 text-text-3 whitespace-pre-wrap break-all max-h-40 overflow-auto">{diagnostic}</pre>}
      </div>}
      {isComplete && (checkingFile || fileAccess === 'unavailable' || fileAccess === 'unknown') && <div className="mt-2 flex flex-wrap items-center gap-2">
        <p className="text-step-11 text-text-4">{t(checkingFile ? 'Checking file…' : fileAccess === 'unavailable' ? 'Export completed. The original file is currently unavailable; the record is kept.' : 'Export completed. File access could not be confirmed.')}</p>
        <Button size="sm" variant="secondary" disabled={checkingFile} onClick={() => void handleRecheckFile()}>{t(checkingFile ? 'Checking file…' : 'Recheck file')}</Button>
      </div>}
      {job.status === "failed" && job.error && <div className="mt-2"><ErrorNotice key={job.error} message={job.error} diagnostic={diagnostic} context="export" compact /></div>}
      <StudioToastViewport {...toast} />
    </div>
  );
});
