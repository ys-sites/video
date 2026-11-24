import { useEmptyPreview } from "../nle/useEmptyPreview";
import { useMvpEditor } from "../../motion/StudioHost";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { CanvasResolution } from "@hyperframes/parsers";
import { trackStudioRenderStart } from "../../telemetry/events";
import { getAnonymousId } from "../../telemetry/config";
import { browserTelemetryAllowed } from "../../telemetry/policy";
import { generateId } from "../../utils/generateId";
import { readServerError } from "./serverError";
import { ffmpegInstallMessage, useFfmpegStatus } from "./useFfmpegStatus";
import { requestStudioFeedback, type FeedbackContext } from "../feedback/feedbackTrigger";
import { studioApiFetch, studioProjectUrl } from "../../utils/studioApiFetch";
import { blocksProjectWork, isPendingRender, mergeRenderJobs, readRenderStatus, serverRenderJobs } from "./renderQueueState";
import { useRenderProgress } from "./useRenderProgress";
import { beginStudioIo } from "../../telemetry/ioRecovery";
import { usePlayerStore } from "../../player/store/playerStore";
import { durationBucket, exportRejection, exportSettings, openTemplateFields, projectScaleFields, projectFields,
  reportExportRequest, reportExportResult, type ExportOrigin } from "../../motion/editorTracking";

export interface RenderJob {
  id: string;
  nativeJobId?: string;
  requestId?: string;
  workerActive?: boolean;
  requestNotFound?: boolean;
  status: "rendering" | "cancelling" | "unknown" | "complete" | "failed" | "cancelled";
  progress: number;
  stage?: string;
  error?: string;
  filename: string;
  createdAt: number;
  durationMs?: number;
  lastCheckedAt?: number;
  fileAvailable?: boolean;
  settings?: Record<string, unknown>;
}

// The CLI consumes this same source through @hyperframes/core's re-export.
// Importing from the browser-safe parsers package avoids the core barrel's
// Node-only transitive modules without duplicating the preset union in Studio.
export type ResolutionPreset = CanvasResolution;

export interface StartRenderOptions {
  fps?: number;
  quality?: "draft" | "standard" | "high";
  format?: "mp4" | "webm" | "mov" | "gif";
  /** `"auto"` (default) renders at the composition's authored dimensions. */
  resolution?: ResolutionPreset | "auto";
  gpu?: boolean;
  gifLoop?: number;
  /**
   * Render a specific composition file. Omit it to render the composition the
   * user currently has open — only the sidebar's per-composition Render button
   * names one, because it renders a card the user is not looking at.
   */
  composition?: string;
  /**
   * Composition-variable overrides ({variableId: value}), forwarded to the
   * render route and injected as window.__hfVariables — the same channel
   * `hyperframes render --variables` uses.
   */
  variables?: Record<string, unknown>;
  origin?: ExportOrigin;
}

// "Hide" (formerly "Clear") is a view operation, not a delete: hidden ids are
// remembered here so hidden renders don't resurrect from the on-disk history
// on the next load. Per-project key so projects don't hide each other's rows.
function hiddenIdsKey(projectId: string): string {
  return `hf-studio-hidden-renders:${projectId}`;
}

function readHiddenIds(projectId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(hiddenIdsKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

function writeHiddenIds(projectId: string, ids: Set<string>): void {
  try {
    // Cap the list so it doesn't grow unbounded across months of renders.
    window.localStorage.setItem(hiddenIdsKey(projectId), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* localStorage may be unavailable or full */
  }
}


export function useRenderQueue(
  projectId: string | null,
  // A ref, not the value: the render target has to be read at click time, and
  // threading the value through would rebuild every callback below on each
  // composition switch.
  activeCompPathRef: { current: string | null },
) {
  const mvp = useMvpEditor();
  const emptyComposition = useEmptyPreview(projectId ?? "", mvp);
  const currentProject = useRef(projectId);
  currentProject.current = projectId;
  const [queueState, setQueueState] = useState({ projectId, jobs: [] as RenderJob[] });
  const jobs = queueState.projectId === projectId ? queueState.jobs : [];
  const setJobs = useCallback((update: (previous: RenderJob[]) => RenderJob[]) => {
    setQueueState(previous => currentProject.current !== projectId ? previous : {
      projectId,
      jobs: update(previous.projectId === projectId ? previous.jobs : []),
    });
  }, [projectId]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  const closeActiveEventSource = useRenderProgress(projectId, jobs, setJobs);
  const startingRef = useRef<string | null>(null);
  const [startingProject, setStartingProject] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const historyRequest = useRef(0);
  const rechecking = useRef(false);
  // History fetch failure — distinguished from "no renders yet" so the panel
  // never shows a false empty state.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Failure of a user action (delete/cancel), surfaced inline in the panel.
  const [actionError, setActionError] = useState<string | null>(null);
  // Owned here rather than in the panel: Studio renders from three places —
  // the panel's Export button, the header's, and each composition card in the
  // left sidebar — and a check living in one of them leaves the rest free to
  // start a render this machine cannot finish. Every caller routes through
  // `startRender`, so that is where the refusal belongs. Call sites still
  // read `ffmpegMissing` to put the prompt on screen, because a refusal the
  // user cannot see reads as a broken button.
  const { status: ffmpeg, checking: ffmpegChecking, recheck: recheckFfmpeg } = useFfmpegStatus();
  // A null status means the probe gave no answer (older server, failed
  // request), which is not evidence of a missing encoder. Unknown fails open.
  const ffmpegMissing = ffmpeg !== null && !ffmpeg.ok;
  // Renders started in THIS tab, mapped to the settings they ran with.
  // `loadRenders` also injects finished jobs from disk history, and those must
  // never trigger a feedback prompt — the user did not just watch them happen.
  const sessionJobs = useRef(new Map<string, FeedbackContext>());
  const promptedJobIds = useRef(new Set<string>());
  const requestSettings = useRef(new Map<string, FeedbackContext>());
  // Keep one business export identity across an uncertain receipt and its
  // later lookup. Neither a connection loss nor a cancel acknowledgement is terminal.
  const trackedExports = useRef(new Map<string, {
    exportId: string;
    reported: boolean;
    settings: ReturnType<typeof exportSettings> & { video_duration_bucket: ReturnType<typeof durationBucket>; template_id?: string };
  }>());

  /**
   * The one way a render started here enters the list. Every start path — the
   * happy one and all three failure shortcuts — goes through here, so both
   * "this render belongs to this session" and "these are the settings it ran
   * with" have a single owner. A report about a render is only actionable if
   * it arrives with the settings that produced it.
   */
  const addSessionJob = useCallback((job: RenderJob, settings: FeedbackContext) => {
    sessionJobs.current.set(job.id, settings);
    if (job.requestId) requestSettings.current.set(job.requestId, settings);
    setJobs((prev) => mergeRenderJobs(prev, [job]));
  }, [setJobs]);

  useEffect(() => {
    sessionJobs.current.clear();
    promptedJobIds.current.clear();
    requestSettings.current.clear();
    trackedExports.current.clear();
    setLoadError(null);
    setActionError(null);
    setChecking(false);
  }, [projectId]);

  const loadRenders = useCallback(async () => {
    if (!projectId) return;
    const request = ++historyRequest.current;
    setChecking(true);
    try {
      const res = await studioApiFetch(buildProjectApiPath(projectId, `/renders`));
      if (currentProject.current !== projectId || request !== historyRequest.current) return;
      if (!res.ok) throw new Error(`Couldn't load render history (server error ${res.status}).`);
      const data = await res.json();
      if (currentProject.current !== projectId || request !== historyRequest.current) return;
      if (!Array.isArray(data.renders)) throw new Error("Couldn't read render history. Check the original export.");
      const hidden = readHiddenIds(projectId);
      const incoming = serverRenderJobs(data.renders).filter(job => !hidden.has(job.id));
      for (const job of incoming) {
        const settings = job.requestId && requestSettings.current.get(job.requestId);
        if (settings) sessionJobs.current.set(job.id, settings);
      }
      setJobs(previous => mergeRenderJobs(previous, incoming));
      setLoadError(null);
      setActionError(null);
      return incoming;
    } catch (error) {
      if (currentProject.current === projectId && request === historyRequest.current) {
        setLoadError(error instanceof Error ? error.message : "Couldn't load render history. Is the studio server running?");
      }
    } finally {
      if (currentProject.current === projectId && request === historyRequest.current) setChecking(false);
    }
  }, [projectId, setJobs]);

  useEffect(() => { void loadRenders(); }, [loadRenders]);

  const recheckRender = useCallback(async (jobId?: string) => {
    if (!projectId || rechecking.current) return;
    rechecking.current = true;
    const finish = beginStudioIo("recheck_render");
    try {
      const incoming = await loadRenders();
      const requestId = jobId && jobsRef.current.find(old => old.id === jobId)?.requestId;
      const target = jobId ? incoming?.find(job => job.id === jobId || Boolean(requestId && requestId === job.requestId))
        : incoming?.toSorted((a, b) => b.createdAt - a.createdAt)[0];
      if (incoming && jobId && !target) {
        setJobs(previous => previous.map(job => job.id === jobId && job.status === "unknown" && !job.nativeJobId
          ? { ...job, requestNotFound: true } : job));
      }
      finish({ outcome: incoming ? "success" : "unknown", ...(target ? { state_after: target.status } : {}) });
    } finally { rechecking.current = false; }
  }, [projectId, loadRenders, setJobs]);

  // Start a render and track progress via SSE
  // Pre-existing branchy fetch/poll flow — the variables passthrough added one branch.
  const startRender = useCallback(
    // fallow-ignore-next-line complexity
    async (opts: StartRenderOptions = {}) => {
      if (!projectId) return;
      if (emptyComposition && (!opts.composition || opts.composition === activeCompPathRef.current)) {
        setActionError("No content to export. Add media first.");
        return;
      }
      const exportId = generateId();
      const player = usePlayerStore.getState();
      const openComposition = !opts.composition || opts.composition === activeCompPathRef.current;
      const timeline = openComposition && player.timelineReady;
      const tracked = { ...exportSettings(opts.origin, opts),
        video_duration_bucket: durationBucket(timeline ? player.duration : undefined), ...openTemplateFields() };
      const scale = projectScaleFields(timeline ? player.elements.length : undefined);
      let requestKey: string | undefined;
      let reportedRequest = false;
      const requestResult = (outcome: "accepted" | "rejected" | "unknown",
        error_code?: Parameters<typeof reportExportRequest>[0]["error_code"]) => {
        if (reportedRequest) return;
        reportedRequest = true;
        reportExportRequest({ export_id: exportId, outcome, ...tracked, ...scale,
          ...(error_code ? { error_code } : {}), ...projectFields(projectId) });
        if (requestKey) {
          const pending = trackedExports.current.get(requestKey);
          if (outcome === "rejected") trackedExports.current.delete(requestKey);
          else if (pending) pending.reported = true;
        }
      };
      // The server would answer this with a 503 anyway. Refusing here keeps
      // the reason and the fix in the message, and keeps a control that
      // forgot to disable itself from producing a mystery failure.
      if (ffmpegMissing) {
        requestResult("rejected", ffmpeg?.runtime ? "RUNTIME_NOT_READY" : "FFMPEG_MISSING");
        if (ffmpeg?.runtime) return;
        addSessionJob(
          {
            id: generateId(),
            status: "failed",
            progress: 0,
            error: ffmpegInstallMessage(ffmpeg),
            filename: "Export blocked",
            createdAt: Date.now(),
          },
          {},
        );
        return;
      }

      if (startingRef.current === projectId || jobsRef.current.some(blocksProjectWork)) {
        requestResult("rejected", "REQUEST_REJECTED");
        setActionError("An export is already in progress. Check the original task.");
        return;
      }
      startingRef.current = projectId;
      setStartingProject(projectId);
      setActionError(null);
      try {
      // A separate export is a new explicit action, never a replay. Recheck
      // the service before proceeding past an unresolved but inactive record.
      if (jobsRef.current.some(job => job.status === "unknown")) {
        const confirmed = await loadRenders();
        if (currentProject.current !== projectId) return;
        if (!confirmed) {
          requestResult("rejected", "SERVER_UNREACHABLE");
          setActionError("Couldn't check the original export. Check the connection before starting another export.");
          return;
        }
        if (confirmed.some(blocksProjectWork)) {
          requestResult("rejected", "REQUEST_REJECTED");
          setActionError("An export is already in progress. Check the original task.");
          return;
        }
      }
      const requestId = generateId();
      requestKey = requestId;
      trackedExports.current.set(requestId, { exportId, reported: false, settings: tracked });
      const fps = opts.fps ?? 30;
      const quality = opts.quality ?? "standard";
      const format = opts.format ?? "mp4";
      const resolution = opts.resolution;
      // Which composition a render targets belongs here, with the same
      // argument the FFmpeg gate above makes: Studio starts renders from three
      // controls, and a default living in one of them leaves the others
      // exporting a file the user is not looking at. The header's Export
      // passed no options at all, so every render it started went to
      // index.html no matter which composition was selected (#3549).
      const composition = opts.composition ?? activeCompPathRef.current ?? undefined;

      trackStudioRenderStart({
        fps,
        quality,
        format,
        resolution,
        composition,
      });

      const startTime = Date.now();
      // Travels with any feedback about this render. Settings only: the
      // composition path is a name the user chose, not file contents.
      const settings: FeedbackContext = {
        render_format: format,
        render_quality: quality,
        render_fps: fps,
        render_resolution: resolution ?? "auto",
        render_composition: composition ?? "index.html",
        render_has_variables: Boolean(opts.variables && Object.keys(opts.variables).length > 0),
      };
      // "auto" / undefined means "render at the composition's authored size".
      // Omit the field entirely — sending "auto" would trip the route's
      // enum validation set.
      const body: {
        requestId: string;
        fps: number;
        quality: string;
        format: string;
        resolution?: string;
        composition?: string;
        variables?: Record<string, unknown>;
        gpu?: boolean;
        gifLoop?: number;
        telemetryDistinctId?: string;
        telemetryOptOut?: boolean;
      } = {
        requestId,
        fps,
        quality,
        format,
      };
      // The id is MINTED by getAnonymousId(), so calling it unconditionally
      // created a telemetry identity for a profile that had opted out — and
      // then shipped it to the server. The server's own policy cannot see this
      // browser's localStorage or DoNotTrack, so it has to be told: an
      // explicit `telemetryOptOut` suppresses the render outcome, which
      // omitting the id alone does NOT (an old client omits it too, and that
      // falls back to the install id).
      if (browserTelemetryAllowed()) {
        // So the server-emitted render_complete/render_error is attributed to
        // this browser user (same id studio_* events use), making the render
        // funnel joinable. Matches studio_render_start fired just above.
        body.telemetryDistinctId = getAnonymousId();
      } else {
        body.telemetryOptOut = true;
      }
      if (resolution && resolution !== "auto") body.resolution = resolution;
      if (composition) body.composition = composition;
      if (opts.gpu) body.gpu = true;
      if (format === "gif" && opts.gifLoop !== undefined) body.gifLoop = opts.gifLoop;
      if (opts.variables && Object.keys(opts.variables).length > 0) {
        body.variables = opts.variables;
      }
      const keepUnconfirmedRequest = (cause: string,
        errorCode: Parameters<typeof reportExportRequest>[0]["error_code"] = "SERVER_UNREACHABLE") => {
        requestResult("unknown", errorCode);
        const pendingJob: RenderJob = {
          id: `request-${requestId}`,
          requestId,
          status: "unknown",
          progress: 0,
          error: `Could not confirm the export request: ${cause}. Check the original export before trying again.`,
          filename: "Export result pending",
          createdAt: startTime,
          settings,
        };
        if (currentProject.current === projectId) addSessionJob(pendingJob, settings);
      };
      let res: Response;
      try {
        res = await studioApiFetch(buildProjectApiPath(projectId, `/render`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
        keepUnconfirmedRequest(err instanceof Error ? err.message : String(err));
        return;
      }
      if (currentProject.current !== projectId) return;
      if (!res.ok) {
        const refusal = await res.clone().json().catch(() => null);
        if (["EXPORT_BUSY", "RENDER_BUSY"].includes(refusal?.code)) {
          requestResult("rejected", "REQUEST_REJECTED");
          await loadRenders();
          setActionError("An export is already in progress. Check the original task.");
          return;
        }
        if (res.status === 409 && (await res.clone().json().catch(() => null))?.code === 'NATIVE_RUNTIME_NOT_READY') {
          requestResult("rejected", "RUNTIME_NOT_READY");
          setActionError('Video components are not ready. Check preparation status.');
          recheckFfmpeg(false);
          return;
        }
        // A host error can occur after the renderer has accepted the job.
        // Only a definite client rejection permits declaring this attempt failed.
        if (refusal?.applied !== false && (res.status >= 500 || ![400, 401, 403, 404, 405, 409, 413, 422].includes(res.status))) {
          keepUnconfirmedRequest(await readServerError(res), exportRejection(res.status));
          return;
        }
        requestResult("rejected", exportRejection(res.status));
        const failedJob: RenderJob = {
          id: generateId(),
          status: "failed",
          progress: 0,
          error: await readServerError(res),
          filename: "Export failed",
          createdAt: startTime,
        };
        addSessionJob(failedJob, settings);
        return;
      }
      let receipt: { jobId?: unknown; filename?: string; createdAt?: number };
      try {
        receipt = await res.json();
        if (typeof receipt?.jobId !== "string" || !receipt.jobId) throw new Error("Export receipt has no task identity");
      } catch (error) {
        keepUnconfirmedRequest(error instanceof Error ? error.message : String(error), "INVALID_RESPONSE");
        return;
      }
      const { jobId: nativeJobId, filename, createdAt } = receipt as { jobId: string; filename?: string; createdAt?: number };
      requestResult("accepted");
      if (currentProject.current !== projectId) return;
      const job: RenderJob = {
        nativeJobId,
        requestId,
        id: nativeJobId,
        status: "rendering",
        progress: 0,
        filename: filename ?? `${nativeJobId}.${format}`,
        createdAt: createdAt ?? startTime,
        settings,
      };
      addSessionJob(job, settings);
      return nativeJobId;
      } finally {
        if (startingRef.current === projectId) startingRef.current = null;
        setStartingProject(previous => previous === projectId ? null : previous);
      }
    },
    [projectId, activeCompPathRef, addSessionJob, ffmpeg, ffmpegMissing, recheckFfmpeg, emptyComposition, loadRenders],
  );

  const cancelRender = useCallback(async (jobId: string) => {
    const job = jobsRef.current.find(candidate => candidate.id === jobId);
    if (!projectId || !job?.nativeJobId || !isPendingRender(job)) return;
    setActionError(null);
    setJobs(previous => previous.map(candidate => candidate.id === jobId ? { ...candidate, status: "cancelling" } : candidate));
    try {
      const res = await studioApiFetch(studioProjectUrl(`/api/render/${encodeURIComponent(job.nativeJobId)}/cancel`, projectId), { method: "POST" });
      if (currentProject.current !== projectId) return;
      if (!res.ok) throw new Error("Couldn't confirm cancellation. Check the original export.");
      const data = await res.json();
      const status = readRenderStatus(data.status);
      if (!status) throw new Error("Couldn't confirm cancellation. Check the original export.");
      setJobs(previous => previous.map(candidate => candidate.id === jobId && isPendingRender(candidate)
        ? { ...candidate, status, lastCheckedAt: Date.now() } : candidate));
    } catch (error) {
      if (currentProject.current !== projectId) return;
      const message = error instanceof Error ? error.message : "Couldn't confirm cancellation. Check the original export.";
      setJobs(previous => previous.map(candidate => candidate.id === jobId && isPendingRender(candidate)
        ? { ...candidate, status: "unknown", error: message } : candidate));
      setActionError(message);
    }
  }, [projectId, setJobs]);

  const deleteRender = useCallback(
    async (jobId: string) => {
      setActionError(null);
      closeActiveEventSource(jobId);
      try {
        const res = await studioApiFetch(studioProjectUrl(`/api/render/${encodeURIComponent(jobId)}`, projectId), { method: "DELETE" });
        if (!res.ok) {
          setActionError("Couldn't delete the render. It's still on disk.");
          return;
        }
      } catch {
        setActionError("Couldn't reach the server to delete the render.");
        return;
      }
      setJobs((prev) => prev.filter((j) => j.id !== jobId));
    },
    [closeActiveEventSource, projectId, setJobs],
  );

  // Hide finished rows from the list (view-only — files stay on disk and can
  // be recovered from the renders/ directory). Remembered per project so the
  // rows don't resurrect from history on reload.
  const clearCompleted = useCallback(() => {
    setJobs((prev) => {
      const finished = prev.filter((j) => !isPendingRender(j));
      if (projectId && finished.length > 0) {
        const hidden = readHiddenIds(projectId);
        for (const j of finished) hidden.add(j.id);
        writeHiddenIds(projectId, hidden);
      }
      return prev.filter(isPendingRender);
    });
  }, [projectId, setJobs]);

  const dismissActionError = useCallback(() => setActionError(null), []);

  // Ask for feedback the moment a render this tab started reaches its outcome.
  // Watching the list (rather than each of the four places a job can finish)
  // keeps one trigger for every path, including SSE drops and cancels-that-
  // finished-anyway. `requestStudioFeedback` decides whether to actually ask.
  useEffect(() => {
    for (const job of jobs) {
      if (!["complete", "failed", "cancelled"].includes(job.status)) continue;
      const started = job.requestId && trackedExports.current.get(job.requestId);
      if (!started || !started.reported || !job.requestId) continue;
      trackedExports.current.delete(job.requestId);
      reportExportResult({ export_id: started.exportId,
        job_state: job.status === "complete" ? "completed" : job.status === "cancelled" ? "cancelled" : "failed",
        duration_ms: Math.min(86_400_000, Math.max(0, Math.round(job.durationMs ?? Date.now() - job.createdAt))),
        ...started.settings, ...(job.status === "failed" ? { error_code: "RENDER_FAILED" as const } : {}),
        ...projectFields(projectId) });
    }
    for (const job of jobs) {
      if (job.status !== "complete" && job.status !== "failed") continue;
      const settings = sessionJobs.current.get(job.id);
      if (!settings || promptedJobIds.current.has(job.id)) continue;
      promptedJobIds.current.add(job.id);
      requestStudioFeedback({
        reason: job.status === "complete" ? "render_complete" : "render_failed",
        detail: job.error,
        context: {
          ...settings,
          // How far it got and how long it took separate "died on frame one"
          // from "died during encode", which need different fixes.
          render_progress: job.progress,
          render_duration_ms: job.durationMs ?? Date.now() - job.createdAt,
          render_stage: job.stage,
          render_error: job.error,
          // Earlier renders this session: a first-render failure and a
          // failure after nine successes are different bugs.
          renders_this_session: sessionJobs.current.size,
        },
      });
    }
  }, [jobs, projectId]);

  const isRendering = Boolean(projectId && (startingProject === projectId || jobs.some(blocksProjectWork)));
  return useMemo(
    () => ({
      jobs,
      isRendering,
      checking,
      loadError,
      actionError,
      dismissActionError,
      reloadRenders: loadRenders,
      recheckRender,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender: startRender as (options: unknown) => Promise<void>,
      // Every Export control reads these, so no caller has to decide for
      // itself whether this machine can encode.
      ffmpeg,
      ffmpegMissing,
      emptyComposition,
      ffmpegChecking,
      recheckFfmpeg,
    }),
    [
      jobs,
      isRendering,
      checking,
      loadError,
      actionError,
      dismissActionError,
      loadRenders,
      recheckRender,
      deleteRender,
      cancelRender,
      clearCompleted,
      startRender,
      ffmpeg,
      ffmpegMissing,
      emptyComposition,
      ffmpegChecking,
      recheckFfmpeg,
    ],
  );
}
