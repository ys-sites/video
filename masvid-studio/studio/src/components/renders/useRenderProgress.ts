import { useCallback, useEffect, useRef } from "react";
import { studioProjectUrl } from "../../utils/studioApiFetch";
import type { RenderJob } from "./useRenderQueue";
import { readRenderStatus } from "./renderQueueState";

type UpdateJobs = (update: (jobs: RenderJob[]) => RenderJob[]) => void;

export function useRenderProgress(projectId: string | null, jobs: RenderJob[], updateJobs: UpdateJobs) {
  const streams = useRef(new Map<string, EventSource>());
  const project = useRef(projectId);
  project.current = projectId;
  const closeProgress = useCallback((id?: string) => {
    if (id) {
      streams.current.get(id)?.close();
      streams.current.delete(id);
    } else {
      for (const stream of streams.current.values()) stream.close();
      streams.current.clear();
    }
  }, []);

  useEffect(() => () => closeProgress(), [projectId, closeProgress]);

  useEffect(() => {
    const watching = new Set(jobs.filter(job => job.status === "rendering" || job.status === "cancelling").map(job => job.id));
    for (const id of streams.current.keys()) if (!watching.has(id)) closeProgress(id);
    if (!projectId) return;
    for (const job of jobs) {
      if (!watching.has(job.id) || !job.nativeJobId || streams.current.has(job.id)) continue;
      const stream = new EventSource(studioProjectUrl(`/api/render/${encodeURIComponent(job.nativeJobId)}/progress`, projectId));
      streams.current.set(job.id, stream);
      const current = () => project.current === projectId && streams.current.get(job.id) === stream;
      stream.addEventListener("progress", event => {
        if (!current()) return;
        try {
          const data = JSON.parse(event.data);
          const status = readRenderStatus(data.status);
          updateJobs(previous => previous.map(old => old.id !== job.id ? old : {
            ...old,
            status: old.status === "cancelling" && status === "rendering" ? "cancelling" : status ?? old.status,
            progress: typeof data.progress === "number" ? data.progress : old.progress,
            stage: data.stage ?? data.message ?? old.stage,
            error: data.error,
            lastCheckedAt: Date.now(),
            durationMs: status === "complete" ? data.durationMs ?? Date.now() - old.createdAt : old.durationMs,
            fileAvailable: typeof data.fileAvailable === "boolean" ? data.fileAvailable : old.fileAvailable,
            workerActive: typeof data.workerActive === "boolean" ? data.workerActive : old.workerActive,
          }));
          if (status === "complete" || status === "failed" || status === "cancelled") closeProgress(job.id);
        } catch { /* A malformed progress event is not an execution result. */ }
      });
      stream.onerror = () => {
        if (!current()) return;
        closeProgress(job.id);
        updateJobs(previous => previous.map(old => old.id === job.id && (old.status === "rendering" || old.status === "cancelling")
          ? { ...old, status: "unknown", workerActive: undefined, requestNotFound: false, error: "Progress connection lost. Check the original export." } : old));
      };
    }
  }, [projectId, jobs, updateJobs, closeProgress]);

  return closeProgress;
}
